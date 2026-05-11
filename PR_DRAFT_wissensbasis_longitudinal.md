# feat(wissensbasis): longitudinal provenance substrate (4 tables + purge service)

**Branch:** `feat/wissensbasis-longitudinal-substrate`
**Target:** `main`
**Down-revision:** `a0b1c2d3e4f5` (add_speaker_vocabulary — current head of the active chain)
**Reva consumer plan:** `~/.gstack/projects/X-idra-Systems-GmbH-reva/evdb-main-plan-wissensbasis-longitudinal-20260511-181523.md`

---

## Summary

Adds three platform-level tables that turn Reva's in-memory `FieldProvenance` accumulator into durable substrate. The tables are not Reva-specific — they're the same primitives any plugin needs once it has to answer "what did the system know about X at time Y." Locating the schema in Renfield keeps the alembic chain unified and avoids the dual-chain operational cost.

- **`wb_field_provenance`** — snapshot-at-observation per (source, field, time). The audit-trail substrate.
- **`wb_field_provenance_archive`** — append-only destination for legal_hold rows that outlive their atom.
- **`wb_event_log`** — ordered events extracted from tool activity logs / phase histories. Substrate for vN+1 process conformance.
- **`wb_retrospective_annotation`** — per-atom retrospective notes. Substrate for vN+1 feedback aggregation.

Plus `services/atom_purge_service.py` — the single authorized path for deleting atoms.

Two of the three ship empty in this PR. Writers and readers land in Reva's Sprint 2 (`wb_field_provenance` consumer) and in subsequent Renfield platform features (`event_log`, `retrospective_annotation`). The migration is intentionally larger than the immediate consumer to avoid a vN+2 schema bump on a system already in audit-relevant use.

## What changed

| File | Change |
|------|--------|
| `src/backend/alembic/versions/pc20260511_wissensbasis_longitudinal.py` | NEW — 4 CREATE TABLE, no triggers (portable) |
| `src/backend/models/database.py` | +4 SQLAlchemy classes after `AtomExplicitGrant`; +`BigInteger` import |
| `src/backend/services/atom_purge_service.py` | NEW — single authorized atom-deletion path |
| `tests/backend/test_wb_longitudinal_schema.py` | NEW — 9 unit tests + 2 async service tests (sqlite-driven, no postgres needed) |
| `tests/backend/test_no_direct_atom_delete.py` | NEW — lint blocking direct `DELETE FROM atoms` outside the purge service |

## Key design decisions

### 1. Application-layer legal_hold discrimination (portable across DBs)

`wb_field_provenance.atom_id` uses `ON DELETE CASCADE`. The legal_hold semantics are enforced in `services/atom_purge_service.py`, not in a DB trigger:

```python
async def purge(session, *, atom_id: str, reason: str) -> int:
    hold_rows = SELECT * FROM wb_field_provenance
                 WHERE atom_id = ? AND legal_hold = TRUE
    INSERT hold_rows INTO wb_field_provenance_archive  (atom_id stripped)
    DELETE FROM atoms WHERE atom_id = ?  -- CASCADE wipes the rest
```

| legal_hold | What happens on atom purge | Why |
|------------|---------------------------|-----|
| TRUE | row copied to `wb_field_provenance_archive` (atom_id stripped), then live row CASCADE-deleted | BaFin audit reconstructability |
| FALSE | row deleted by CASCADE with the atom | GDPR Art. 17 right-to-be-forgotten |

**Why application-layer instead of a postgres trigger:**

- **Portable**: works on postgres, MySQL, MSSQL, sqlite. No dialect-specific trigger DDL.
- **Testable**: full flow verified against in-memory sqlite. No postgres fixture required for CI.
- **Auditable**: behavior is in Python, not buried in plpgsql.

**Enforcement:** `tests/backend/test_no_direct_atom_delete.py` greps the backend source for `DELETE FROM atoms`, `delete(Atom)`, and `Atom.__table__.delete()` patterns. Any match outside `services/atom_purge_service.py` fails the lint.

### 2. Single composite index on `wb_field_provenance` lookup path

`(source_type, source_id, field_path)` B-tree covers the focus-resolver hot path. A partial index on `fetched_at WHERE > NOW() - 90d` covers freshness/staleness queries on recent data. Audit queries against older data fall back to sequential scan on the B-tree — acceptable because BaFin audit replay is rare and latency-tolerant.

Estimated 8-12 GB at 100k atoms × 30 fields × 3 snapshots average. Pg autovacuum handles bloat; legal-hold rows are GC-immune (intentional).

### 3. Dedup on `wb_event_log` via UC

`UNIQUE (source_type, source_id, event_type, event_at)` makes re-ingestion an `ON CONFLICT DO NOTHING` no-op. Without it, replaying a tool that returns the same activity log produces duplicate event rows and skews future conformance evaluation. The UC is structural — encoded in the schema, not enforced at the writer.

### 4. Asymmetric atom-delete behavior across the three tables

| Table | On atom delete | Why |
|-------|---------------|-----|
| `wb_field_provenance` | CASCADE; AtomPurgeService archives legal_hold rows first | Audit trail must survive on hold; GDPR wins otherwise |
| `wb_event_log` | No FK (source_id is opaque text) | Events outlive their atom natively |
| `wb_retrospective_annotation` | CASCADE | User-generated notes are not audit; GDPR wins |

## Testing

- 9 unit tests (`@pytest.mark.unit`) covering FK actions, nullability, default values, composite index columns, UC presence, archive-no-FK invariant, and Base.metadata registration.
- 2 async unit tests against in-memory sqlite that exercise the full `AtomPurgeService.purge()` flow with mixed `legal_hold` rows (FK enforcement enabled via `PRAGMA foreign_keys=ON`).
- 1 lint test (`tests/backend/test_no_direct_atom_delete.py`) that scans the backend source for direct atom-deletion patterns and fails if any are found outside `services/atom_purge_service.py`.

Tests run via `.159` per repo convention. Local: `pytest tests/backend/test_wb_longitudinal_schema.py tests/backend/test_no_direct_atom_delete.py`.

## Migration safety

- **Forward:** All `CREATE TABLE` / `CREATE INDEX` statements gated on `inspector.get_table_names()` / `_has_idx()` for idempotency. The partial `fetched_at` index is postgres-only; sqlite gets a full index (harmless for tests).
- **Backward:** `downgrade()` drops all four tables in reverse FK order. No data loss surface (tables are new).
- **Portability:** No triggers, no stored procedures. Works on postgres / MySQL / MSSQL / sqlite.

## Out of scope

- Writer logic for any of the three tables (lives in Reva for `wb_field_provenance`; ships with the vN+1 platform feature for the other two).
- Reader / query helpers (e.g. `services/wissensbasis_provenance_service.py`) — open as a follow-up PR once Reva's consumer pattern stabilizes.
- BRIN index variant on `fetched_at` (evaluated, rejected — see Reva plan-eng-review D5).

## Test plan

- [ ] `make test-backend` passes on `.159` (unit + lint tests)
- [ ] `alembic upgrade head` on a fresh dev DB completes without error
- [ ] `alembic downgrade -1` rolls back cleanly
- [ ] FK inspection: `\d wb_field_provenance` shows `atom_id` → `atoms.atom_id` ON DELETE CASCADE
- [ ] Composite index inspection: `\d wb_field_provenance` shows `idx_wb_fp_lookup` on the 3 expected columns AND `idx_wb_fp_atom_id` on atom_id
- [ ] Lint test catches a deliberately introduced `DELETE FROM atoms` (then revert) — proves the guardrail works

## Coordinated PRs

- Reva: sprint 2 implementation (consumer for `wb_field_provenance`) is BLOCKED on this PR landing + submodule bump.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
