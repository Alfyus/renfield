# Plan — H1 per-satellite enrollment credential (PSK)

Full design + rationale: `docs/private/security/satellite-trust-design.md` (RESOLVED
decisions + implementation plan). Closes H1 root cause (no per-satellite identity).
Ship DARK behind `satellite_enrollment_enabled` (default off → byte-identical).

## Locked decisions
- Credential = **PSK** (bcrypt-hashed server-side), carried in the **register
  first-frame** (`token` field) — smallest satellite transport change.
- Enrollment = **Ansible + UI**; issuance endpoint **ADMIN-gated**.
- Rollout = **auto-flip with persisted latch** ("all `satellites` rows seen
  authenticated", not just connected) behind `satellite_enrollment_autoflip_enabled`.
- Effective-mode state machine: OFF (legacy default) → PERMISSIVE (soak) → ENFORCING.

## PR-A — backend core (dark) — IMPLEMENTED (branch `security/satellite-enrollment-h1`)
- [x] `ha_glue/models/database.py` — `Satellite` + `SatelliteFleetState` models (+ re-export in `models/database.py`).
- [x] migration `pc20260624_satellite_enrollment` (down_revision = `pc20260619_ble_irk_store`,
      the real head; apply TARGETED); `satellites` + singleton `satellite_fleet_state`.
- [x] `ha_glue/services/satellite_enrollment_service.py` — enroll/rotate / verify (constant-time +
      dummy_verify) / revoke / is_enforcing / maybe_autoflip (latch) / authorize_register (state machine).
- [x] `ha_glue/api/websocket/satellite_handler.py` — register-handler PSK verify + reject + mode;
      passes `authenticated` to register + `is_enrolled_authenticated` to the IRK push. Flag-off skips the block.
- [x] `ha_glue/services/satellite_manager.py` — `SatelliteInfo.authenticated` + eviction guard
      (unauth newcomer cannot evict an authenticated incumbent) + `is_connected()`.
- [x] `ha_glue/services/presence_service.py` — BOTH IRK push paths (`irks_for_satellite` +
      `push_macs_to_satellites`) keyed on enrollment-auth when enabled; allowlist = OFF fallback.
- [x] `main.py` `/api/ws/token` — 401 when unauthenticated + WS auth on (inert in prod; ws_auth_enabled=False).
- [x] `utils/config.py` — `satellite_enrollment_enabled` + `_autoflip_enabled` (both False).
- [x] admin API (own prefix `/api/satellite-enrollment` to avoid the `/api/satellites/{id}` wildcard):
      `POST /enroll` (PSK once, rotate) · `GET ""` (list, no token) · `GET /status` · `DELETE /{id}`. Mounted in bootstrap.
- [x] tests authored (run on .159): `test_satellite_enrollment.py` (service + state machine + latch +
      both IRK gates) + `test_satellite_enrollment_routes.py` (routes + `/api/ws/token` 401 + eviction guard).
      Conftest route-mount spec added.
- [x] **Validated on .159**: `36 passed` (25 `test_satellite_enrollment.py` + 11 `test_satellite_enrollment_routes.py`).
      The only blocker was pre-existing box drift (`rag_service` missing `DuplicateDocumentError` on the stale
      `wip/lane-c` tree) — overlaid to confirm, box restored after. Local env lacks backend deps.
- [ ] **Remaining validation**: run the migration up/down on a throwaway PG DB (mechanically trivial; mirrors
      the proven `pc20260619` pattern; tables already exercised via `create_all` in the 36 tests).

## PR-B — satellite + provisioning — IMPLEMENTED (same branch)
- [x] satellite `config.py` — `ServerConfig.enrollment_token` + YAML load (blank→None) + `RENFIELD_ENROLLMENT_TOKEN` env.
- [x] `network/websocket_client.py` — `enrollment_token` ctor param; `_register()` includes `"token"` only when set
      (legacy frame shape preserved); wired through in `satellite.py`.
- [x] `satellite.yaml.j2` — `enrollment_token: "{{ satellite_enrollment_token | default('') }}"`; group_vars default `""`
      + comment (real token in gitignored host_vars); k8s per-pod `secretKeyRef` (`optional: true` so the pod still boots dark).
- [x] `bin/enroll_satellite.py` — server-side mint/rotate, prints PSK to stdout once (UI + Ansible share the service path).
- [x] satellite tests `tests/satellite/test_enrollment_token.py` — config (default/YAML/blank/env) + register frame include/omit.
- [x] **Validated on .159**: `34 passed` (6 new + 28 existing config/websocket regression). k8s manifest parses. Box restored.

## PR-C — UI — IMPLEMENTED (same branch)
- [x] `api/resources/satelliteEnrollment.ts` — list/status/enroll/revoke hooks (+ `keys.satellites.enrollment*`).
- [x] `components/satellites/SatelliteEnrollment.tsx` — status badges (enabled/enforcing/permissive/pending),
      enroll form (id datalist of connected sats + room), **one-time token reveal** (copy), enrolled list
      (connected dot + last-auth + rotate + revoke). Patterned on `IrkPairing.tsx`.
- [x] Wired into `SatellitesPage.tsx` (section after the satellite list).
- [x] i18n: 26 keys under `satellites.enrollment.*` in de.json + en.json (minimal-diff insert).
- [x] MSW default handlers for `/api/satellite-enrollment[/status]` (empty/disabled fleet).
- [x] Tests: `tests/frontend/react/components/SatelliteEnrollment.test.tsx` (mint+reveal / list+revoke / enforcing badge).
- [x] **Validated**: vitest 6/6 (3 new + 3 existing SatellitesPage regression — fixed a datalist room-text
      collision); `tsc --noEmit` clean for my files (2 errors pre-existing, unrelated); eslint clean for my
      files (2 errors pre-existing in SatellitesPage transcription line).

## Rollout (ops, post-merge, staged)
- [ ] enroll fleet → write PSKs to host_vars / k8s secrets → re-provision → flip
      `enabled=True` (PERMISSIVE) → verify all rows `last_authenticated_at` → flip
      `autoflip_enabled=True` → latch enforces. Break-glass: `enabled=False`.

## Open sub-decision (confirm during build)
- Enforcing-latch storage: recommend a tiny singleton `satellite_fleet_state` row
  (boolean + timestamp) in the same migration vs. overloading a generic settings table.
