# Memory v1 Baseline Harness — Phase 0 of the Mem0 v2 upgrade

This harness measures the empirical behaviour of the current
`ConversationMemoryService.extract_and_save` v1 path against a
hand-curated corpus. The numbers it produces are the **quality bar v2
must beat** before the Mem0 v2 extractor (Lane B) ships authoritatively.

See the full design at
[`docs/architecture/memory-architecture-plan.md`](../../reva/docs/architecture/memory-architecture-plan.md)
in the Reva repo — Phase 0 + v1 disposition + Eng-review modifications.

## Files

| File | Purpose |
|---|---|
| `bin/memory_v1_baseline.py` | Runner CLI. Loads the corpus, runs each turn against v1, diffs before/after DB state, aggregates the four locked baselines, writes JSON + markdown. |
| `tests/eval/memory_v1_baseline_corpus.yaml` | Hand-curated corpus (24 turns at first drop, grows to 150). Schema documented at the top of the file. |
| `tests/eval/test_memory_v1_baseline.py` | Unit tests for the pure aggregation paths. Runs locally without DB / LLM. 13 tests cover the four baseline metrics + latency percentiles + report rendering. |

## The four locked baselines

These are the metrics v2 must match or beat, per the plan's Phase 0:

| Metric | Target | What it measures |
|---|---|---|
| NOOP rate on generic queries | ≥ 0.95 | v1's ability to correctly say "nothing to extract here" on operational queries, role-injection attempts, within-turn contradictions, decision-rationale turns, and cross-tier-leakage probes. |
| Duplicate rate | ≤ 0.01 | Among `dedup` corpus turns (pre-existing similar memory in DB), the fraction where v1 incorrectly creates a new row. The exact bug pattern the plan cites (two near-duplicate mango rows in Renfield's prod table). |
| Cross-session UPDATE detection | ≥ 0.80 | Among `cross_session_stale` turns, the fraction where v1 correctly emits UPDATE or DELETE on the stale row. The "Lieblingsrelease was Product A, now Product B" case from the plan. |
| Schema-validation rate | ≥ 0.95 | Fraction of turns where v1's LLM output parses cleanly. The denominator of every other metric. |

**v2 ships only when:** all four baselines are at least matched (≥ on improvement, ≤ on regression) AND v2 is strictly better on at least one. Phase A shadow-mode runs ≥ 1 week before the flip PR.

## Running it

Local (aggregation tests only):

```bash
cd /path/to/renfield
python3 -m pytest tests/eval/test_memory_v1_baseline.py -v
# 13 tests pass. No DB / LLM required.
```

On the `.159` build box (full corpus run against real DB + LLM):

```bash
# Required env vars (set EXPLICITLY — the runner refuses to fall back
# to DATABASE_URL to prevent accidental prod writes):
#   - BASELINE_DATABASE_URL — dedicated test postgres (with pgvector +
#     halfvec, matching prod's extensions). MUST NOT contain "prod",
#     ".cluster.local", "renfield-private", etc. unless --i-know-this-is-prod.
#   - All other settings from .env loaded normally for the LLM call:
#     LLM_OPENAI_BASE_URL pointing at cuda.local:8081 (Qwen3.6-A3B),
#     OLLAMA_EMBED_URL pointing at k8s-gpu-1 ollama (qwen3-embedding:4b).

export BASELINE_DATABASE_URL='postgresql+asyncpg://renfield:pass@127.0.0.1:5432/renfield_baseline'

# Default mode: ROLLBACK per turn. The LLM call happens for real
# (latency + extract behavior measured), but no seeded rows persist.
# Use this for measurement-only runs.
python3 bin/memory_v1_baseline.py \
    --corpus tests/eval/memory_v1_baseline_corpus.yaml \
    --output-dir ./baseline-runs/

# Persist rows (required only if you want to inspect them post-hoc
# via `/admin/recall?unranked=true` or a SQL query):
python3 bin/memory_v1_baseline.py --commit

# Filter to a subset:
python3 bin/memory_v1_baseline.py --category dedup --flavor reva

# Aggregate-only from an existing run (e.g. to tweak the report format):
python3 bin/memory_v1_baseline.py \
    --aggregate-only baseline-runs/memory_v1_baseline_20260514-094530.json

# Cleanup (only needed after --commit runs):
psql "$BASELINE_DATABASE_URL" \
    -c 'DELETE FROM conversation_memories WHERE user_id >= 2000000000;'
```

### Safety guarantees

The runner is designed to be safe-by-default against accidental prod writes:

1. **Dedicated env var.** `BASELINE_DATABASE_URL` is required and distinct from
   `DATABASE_URL`. The runner does NOT fall back to `DATABASE_URL` — running
   the script without `BASELINE_DATABASE_URL` exits with a clear error.
2. **Prod URL pattern check.** Any URL containing `prod`, `production`,
   `.cluster.local`, `kubernetes.default`, `renfield-private`, etc. is refused
   unless `--i-know-this-is-prod` is passed.
3. **Reserved user_id namespace.** All allocated test user_ids are
   `>= 2_000_000_000` via deterministic `hashlib.blake2b` — they cannot collide
   with real user IDs (small positive integers starting at 1). Even a worst-case
   write to a populated DB attributes rows to test-namespace user_ids only.
4. **Default rollback.** Each turn runs inside `async with session.begin()` and
   the runner explicitly rolls back at end-of-turn unless `--commit` is passed.
   Seeded rows + any v1 writes are abandoned.
5. **Cross-tier seed gate.** Corpus YAML entries with `circle_tier > 0` are
   refused unless `--allow-cross-tier` is passed. Prevents a YAML edit from
   poisoning the global tier visible to every household member.
6. **Exception logging tightened.** Exception messages from `extract_and_save`
   are logged as `type(e).__name__` only — never the raw string, which could
   embed corpus role-injection content or PII into long-term log storage.

### Instrumentation

v1's `extract_and_save` swallows `json.JSONDecodeError` (returns `[]`) and
embedding HTTP failures (logged + falls back to ADD). From outside the
service, both are indistinguishable from "nothing to extract."

The runner monkey-patches `_parse_extraction_response` and `_get_embedding`
during each turn to count these silent failures. Counter deltas surface as
`parse_error` / `embedding_error` on each `BaselineResult` and drive the
`schema_validation_rate` / `embedding_error_rate` metrics. The patches are
torn down between turns (per-service, not per-process) so they never leak
into anything else running in the same process.

## Outputs

Each run produces two files in `--output-dir`:

- `memory_v1_baseline_<timestamp>.json` — full per-turn results
  (turn_id, category, flavor, expected_outcome, actual_outcome,
  extracted_count, latency_seconds, parse_error, embedding_error,
  notes). Used for shadow-mode parity checking and historical trend
  comparison.
- `memory_v1_baseline_<timestamp>.md` — aggregated metrics in the
  format the plan asks operators to publish. This is the artifact
  you commit into `docs/memory/v1-baselines-<date>.md` once Phase 0
  measurement is complete.

## Corpus composition

The corpus is at the target 150 turns (100 Reva + 50 Renfield), covering all
8 categories. Each turn is hand-curated; no programmatic generation.

| Category | Reva | Renfield | Total |
|---|---|---|---|
| dedup | 15 | 8 | 23 |
| within_turn_contradiction | 15 | 8 | 23 |
| generic_query | 20 | 10 | 30 |
| role_injection | 10 | 4 | 14 |
| pure_add | 20 | 12 | 32 |
| cross_session_stale | 10 | 4 | 14 |
| circle_leakage | 5 | 2 | 7 |
| wrong_substrate | 5 | 2 | 7 |
| **Total** | **100** | **50** | **150** |

At n=150 the four locked baselines have confidence intervals of roughly ±2.5%
at p=0.5 (95% CI). The smallest per-category buckets are circle_leakage and
wrong_substrate at n=7 — those metrics are coarser (±20% CI) but exist
primarily as regression guards, not statistical measurements; a single
failure is the signal.

The corpus is hand-curated rather than sampled from real prod transcripts because:
- Deterministic — same turns every run, comparable across v1/v2/shadow
- No PII / no GDPR review path required
- Targets the specific failure modes the plan names
- Reproducible across machines and test environments

A second corpus seeded from real transcripts can be added later as `memory_v1_baseline_corpus_real_<date>.yaml` once a sampling + PII-redaction script is built (out of scope for Phase 0).

## What the runner does NOT cover yet

- Real-LLM execution against the corpus (needs DB + cuda.local + k8s-gpu-1 access)
- Per-PR CI integration (the 8-case eval YAML is a separate file/test, planned for Lane B/D)
- Comparison against a v2 shadow-mode run (planned for Lane B once the shadow-log table exists)

## Tech debt — fixture user creation bypasses `auth_service.create_user`

**Status:** documented, not yet paid down. Acceptable for now; revisit on the next platform-side `users` schema change.

`bin/memory_v1_baseline.py::ensure_baseline_users` mints `users` rows by directly instantiating the `User` ORM model with:

- A **static fake bcrypt-shaped password hash** (`$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4wPpY/ABCDEFGH`) — the exact value pinned in `tests/backend/conftest.py::sample_user_data`. The runner intentionally does NOT call `auth_service.get_password_hash()` because bcrypt cost for ~150 users per run is wasted work for accounts that never authenticate.
- A username built from the namespaced ID (`f"baseline-test-{uid}"`) — not validated against `auth_service.create_user`'s uniqueness logic.
- A role pulled from `auth_service.ensure_default_roles()` — this part IS canonical.

**Why this is debt, not a bug:** the pytest test suite (`tests/backend/conftest.py::test_user`) uses the same direct-ORM pattern, so the runner is consistent with existing convention. But both the runner and the test fixture skip `auth_service.create_user`'s side effects: `validate_password`, email-uniqueness check, username-conflict check, role-existence verification, and the `db.refresh(user, ["role"])` that primes the role relationship.

**What could break it:**

1. A `users` schema migration that adds a NOT NULL column without a server default (the ORM `User(...)` call will fail to insert).
2. A migration that swaps password hashing (e.g. `bcrypt → argon2`) and adds a CHECK constraint validating the hash shape.
3. A new FK chain anchored at `users.id` that the runner doesn't satisfy via `ensure_baseline_users` (the latest example is `atoms.owner_user_id`, which is why the function exists at all — see commit message of the fix).
4. A platform-level enforcement that `User` rows must own at least one `Circle` or similar relationship.

**How to pay this down:** factor `User(...)` construction out of `auth_service.create_user` into a `_build_user(...)` helper that takes already-hashed credentials and already-resolved role_id, then have both `create_user` (web path) AND the test fixture / baseline runner call `_build_user`. That gives a single source of truth for "what a valid `User` row looks like" without forcing test fixtures through `validate_password` / `HTTPException` / bcrypt rounds.

Same caveat applies in spirit to `tests/backend/conftest.py::test_user` — pay both down together.
