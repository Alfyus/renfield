# Chat message branching (edit-and-fork)

Roadmap item 1 of `docs/design/chat-ui-modernization.md` — the heaviest Tier-1
item. Ships **dark behind `CHAT_BRANCHING_ENABLED`** (default false): the flag
gates the fork affordances + UI, NOT the schema or the active-path query (those
are always on; the one-time backfill makes flag-off byte-identical).

## Data model
- **`messages.parent_message_id`** — nullable self-FK (`ON DELETE CASCADE`),
  indexed. The conversation tree's source of truth. A *fork* = a new message
  sharing a parent with an existing one (siblings = branches). NULL = root.
- **`conversations.active_leaf_message_id`** — nullable FK → `messages.id`
  (`ON DELETE SET NULL`, `use_alter=True` to break the conversations↔messages
  FK cycle for `metadata.create_all`). The tip of the active branch.
- **Active branch = the root→leaf path**, resolved by a **recursive CTE walking
  `parent_message_id` upward from `active_leaf_message_id`**, ordered
  `timestamp ASC, id ASC` (reproduces the exact pre-branching history order for
  a linear conversation). NULL leaf → empty path. **Every recursive CTE scopes
  its recursive step to the same `conversation_id`** (`AND p.conversation_id =
  b.conversation_id`) so a stray cross-conversation parent pointer can never
  walk out of the conversation — defense in depth behind the request-level
  session scoping (see Security).
- **Migration `pc20260618_message_branching`** (down_revision
  `pc20260618_doc_quality_ignored`): adds the columns + index + FKs, then a
  one-time idempotent **backfill** — per conversation, chain messages by
  `(timestamp, id)` (`LAG`), set `active_leaf_message_id` to the last
  (`DISTINCT ON`). After backfill all reads use the walk uniformly; legacy
  conversations are a single linear branch. PG-only DML; sqlite test harness
  seeds its own trees.

## The four branch-aware seams
1. **History load** (`/api/chat/history/{session_id}`) — the active-path CTE
   replaces the flat select; also exposes `message.id` per row.
2. **conv_context replay** — self-heals: the agent reads the in-memory history
   the handler loaded via seam 1, so dead-branch
   `[VORHERIGE_FEHLGESCHLAGENE_AKTION]` markers can't leak.
3. **Memory deactivate-at-fork** — on a fork that abandons a branch, the
   abandoned subtree's memories are flipped `is_active=False` (a downward
   recursive CTE, conversation-scoped) so retrieval can't conflate the old and
   new branches' facts. Extraction stays per-active-turn (no double-extract).
4. **Message search** — the FTS query is filtered to the active-path ids and
   `message_index` is recomputed as the ordinal *within* the active branch (so
   jump-to-message scrolls correctly).

## Fork mechanics
- `conversation_service.save_message(..., parent_message_id=None)` always
  maintains the tree: normal turns chain onto the current leaf and advance it; a
  passed `parent_message_id` inserts a **sibling** under that parent.
- **WS turn** accepts an optional `fork_from_message_id` (honored only when
  `chat_branching_enabled`). Edit-vs-regenerate is disambiguated by the **role**
  of the target: a `user` target → regenerate (no duplicate user row); else
  edit-and-resubmit. The abandoned subtree's memories are deactivated before
  generation. The `done` frame carries the new `user_message_id` +
  `assistant_message_id`.
- **`PUT /api/chat/{session_id}/active-leaf` `{message_id}`** — ownership-gated;
  moves the active leaf to an existing message (no generation).

## Frontend (Phase 1)
- `id` on `ChatUiMessage`, carried through `historyToUiMessage` + the done frame.
- `ChatMessages.tsx`: keyboard-reachable **edit** (latest user message) +
  **regenerate** (latest assistant turn), behind the `chat_branching_enabled`
  feature flag. Dark + i18n (de/en).

## Security
The request-level fork-target lookup is scoped to the caller's conversation
(`Conversation.session_id == msg_session_id`); a foreign/nonexistent
`fork_from_message_id` is dropped and the turn becomes a normal append. The
recursive-CTE conversation scoping is the second layer. (A cross-conversation
IDOR — unscoped fork target + an unscoped recursive step — was caught in review
and fixed before merge; regression-tested on Postgres.)

## Documented limitations / Phase 2
- **Deactivate-at-fork race:** a still-running background extraction for the
  abandoned turn could re-add an active memory after deactivation. Narrow; left
  for Phase 2.
- **Phase 2** = fork-from-*any* prior message + the multi-sibling branch
  switcher (`‹2/3›`) in `ChatHeader.tsx` + delete-branch. The switcher will need
  memory **reactivation** (or active-path-scoped retrieval) since revisiting an
  abandoned branch must restore its memories — deactivate-at-fork is only safe
  in Phase 1 because you can't navigate back to an abandoned branch.

## Tests
`tests/backend/test_chat_branching.py` (sqlite tree-maintenance + deletion FK
metadata; Postgres recursive CTEs, active-path order, fork sibling + leaf
advance, memory deactivate, search filter+reindex, **cross-conversation IDOR
isolation**, SET-NULL deletion) — 16 pass on real PG. Frontend:
`ChatMessages.branching.test.tsx` + `historyToUiMessage` id carry.
