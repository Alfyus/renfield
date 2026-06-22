# Broadcast Announcement (announce to all occupied rooms)

Status: **PLANNED** (reviewed via `/plan-eng-review`, not yet implemented).
Scope: backend internal tool + agent routing only — no frontend.

## Problem

A user states an announcement in a room (e.g. *"Ansage an alle: Mittagessen"*)
and it is played (TTS) in **every room where any user is currently present**.

The **targeted** relay (*"sag Eduard, das Essen ist fertig"* → find his room →
speak there, with a fail-closed privacy gate) **already exists** in production as
`internal.announce_in_room` (see `docs/MESSAGE_RELAY.md`). This feature adds
**only** the broadcast variant.

## What already exists (reuse, do not rebuild)

| Capability | Where |
|---|---|
| Speak TTS into one room: synth → resolve room → privacy gate (BLE + optional camera/vision) → route (`OutputRoutingService`) → play (`AudioOutputService`) → raw-speaker fallback. 17 passing tests. | `_announce_in_room`, `src/backend/ha_glue/services/internal_tools.py:508` |
| List every occupied room: `{user_id: UserPresence(room_id, room_name)}` | `PresenceService.get_all_presence()`, `ha_glue/services/presence_service.py:517` |
| Parallel fan-out-to-all template (per-target error swallow) | `LedDimmingService.push_brightness_to_all_satellites()` |
| `presence` agent role already owns `get_user_location` + `announce_in_room` + `get_all_presence` | `config/agent_roles.yaml:112` |

## Decisions (from the eng review)

1. **Dedicated tool + reuse refactor.** New `internal.broadcast_announcement`.
   First extract a shared `_announce_core(room, text, audio_bytes, privacy,
   for_users, force)` out of `_announce_in_room`. `_announce_core` **opens its own
   `AsyncSessionLocal`** (it does **not** take a `db` param) — single-announce and
   broadcast call it identically. Rationale: a SQLAlchemy `AsyncSession` is **not
   concurrency-safe**, so the parallel broadcast cannot share one session.

2. **Public-only.** Broadcast **rejects `privacy='personal'`** at the tool
   boundary with a clear message (*"broadcasts are public; use the targeted relay
   for confidential content"*). No per-room gate, **no camera/vision check** in
   broadcast. This avoids an N-way GPU vision-storm (N serialized vision
   inferences + fail-closed timeouts misreported as privacy blocks) and the
   semantic incoherence of a house-wide confidential message. The targeted relay
   still does personal.

3. **Per-room own session, parallel, capped.** Flow:
   `get_all_presence()` → dedup occupied rooms by `room_id` → skip `room_id=None` →
   synthesize TTS **once** → `asyncio.gather` `_announce_core` per room (each its
   own session), bounded by a small **semaphore** → per-room error swallowed.

4. **Honest summary.** Report succeeded/failed **room names + outcome**, not a
   ratio. Do **not** imply full people-coverage: presence only sees tracked BLE
   devices, so a phoneless person's room is invisible. Empty presence →
   *"niemand anwesend"*.

5. **Routing by phrasing.** Extend the `presence` role description to cover
   broadcast (*"Ansage an alle"*, *"sag allen"*, *"ruf alle zu…"*). A bare
   context-free *"Mittagessen"* may not trigger — documented limitation. The new
   tool gets an **unmistakable** name + description (*"fans out to all occupied
   rooms, public-only, no consent dialog"*) so the agent never confuses it with
   `announce_in_room`.

6. **Fix the pre-existing fallback bug** while in the code: the raw-speaker
   fallback (`internal_tools.py:692-707`) returns after the **first** speaker, so a
   room with 2+ raw satellite speakers only plays on one. Change to send to **all**
   speakers, fail only if none accept (+ test).

## Data flow

```
"Ansage an alle: Mittagessen"
  → presence role → internal.broadcast_announcement(text="Mittagessen")
  → get_all_presence() → dedup by room_id → {Arbeitszimmer, Küche}
  → PiperService.synthesize_to_bytes(text)            [ONCE]
  → semaphore-bounded asyncio.gather:
       _announce_core(Arbeitszimmer, …, privacy="public")   [own session]
       _announce_core(Küche,          …, privacy="public")   [own session]
  → "Angesagt in: Arbeitszimmer, Küche (2/2). Nicht erreicht: —"
```

## NOT in scope

- Personal/confidential broadcast — deliberately rejected (public-only). Targeted
  relay covers confidential content.
- Message persistence / inbox / deliver-on-arrival (queue for an absent user) — not
  requested; separate feature.
- Reply / confirmation-back-to-sender — not requested.
- A dedicated `broadcast` agent role — phrasing + presence-role description suffice.
- Idempotency key for retry-dedup — accepted at-least-once; mitigated by the
  per-room summary (the agent should not retry). Noted limitation.
- Self-room echo suppression — reuse the existing TTS barge-in handling; not
  special-cased.

## Failure modes

| Path | Failure | Test | Handling | User sees |
|---|---|---|---|---|
| synth | TTS fails (once, pre-fanout) | yes | abort whole broadcast | clear error |
| per-room | route/play throws | yes | swallowed, per-room | room named "nicht erreicht" |
| presence | nobody present | yes | no-op | "niemand anwesend" |
| concurrency | shared AsyncSession | yes (own session) | own session per room | n/a |
| retry | agent re-fires on partial | no (mitigation: summary) | none (at-least-once) | re-announce in done rooms |

No critical gaps (silent + untested + unhandled): none.

## Test plan

**Regression (mandatory):** all 17 existing relay tests
(`tests/backend/test_internal_tools.py::TestAnnounceInRoom`) stay green after the
`_announce_core` extraction.

New `TestBroadcastAnnouncement`:
1. 2 occupied rooms → 2 plays, summary names both
2. dedup: 2 users same room → 1 play
3. nobody present → no-op, no synth
4. `room_id=None` skipped
5. synth-once: `synthesize_to_bytes` called exactly once
6. one room throws → others complete, summary names the failed room
7. `privacy='personal'` → rejected at tool boundary (no fan-out)
8. semaphore bounds concurrency (≤ cap in flight)

Fallback fix test: room with 2 raw speakers → both receive the send.

Routing eval (~6–10 cases, negatives weighted):
- `+` "Ansage an alle: Mittagessen" → broadcast
- `+` "sag allen Bescheid, Essen ist fertig" → broadcast
- `+` "ruf alle zum Essen" → broadcast
- `-` "sag Eduard, das Essen ist fertig" → targeted relay, NOT broadcast
- `-` "ruf alle an" → phone call, NOT broadcast
- `-` "Mittagessen?" (question) → NOT broadcast

## Files to touch

1. `src/backend/ha_glue/services/internal_tools.py` — extract `_announce_core`,
   refactor `_announce_in_room`, add `_broadcast_announcement`, register in
   `TOOLS` + `_HANDLERS`, fix the fallback.
2. `config/agent_roles.yaml` — add `internal.broadcast_announcement` to
   `presence.internal_tools` + extend the presence description.
   **ConfigMap-served (`renfield-mcp-config`) — the live prod ConfigMap must be
   patched too, not just the image.**
3. `prompts/agent.yaml` — broadcast vs targeted-relay guidance (public-only).
4. `tests/backend/test_internal_tools.py` — `TestBroadcastAnnouncement` + fallback test.
5. `tests/eval/*.yaml` + `bin/run_*_eval.py` — routing eval.
6. `docs/MESSAGE_RELAY.md` + `CLAUDE.md` — broadcast section (PR-lifecycle doc gate).

## Parallelization

- **Lane A (sequential, one module):** `_announce_core` extraction →
  `_broadcast_announcement` → unit tests (all in `internal_tools.py` +
  `test_internal_tools.py`). `config/agent_roles.yaml` + `prompts/agent.yaml` are
  tiny and ride with Lane A.
- **Lane B (independent):** routing eval + docs.

Launch A and B in parallel; A is the critical path.

## Review status

Eng review (`/plan-eng-review`): **CLEARED**, 0 critical gaps. Outside-voice
(Claude subagent) drove the public-only decision and corrected the
`_announce_core` session ownership. No UI scope → no design review needed.
