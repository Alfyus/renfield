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
# Requires:
#   - DATABASE_URL pointing at a fresh test postgres (with pgvector +
#     halfvec, matching prod's extensions)
#   - LLM_OPENAI_BASE_URL pointing at cuda.local:8081 (Qwen3.6-A3B)
#   - OLLAMA_EMBED_URL pointing at k8s-gpu-1 ollama (qwen3-embedding:4b)
#   - All other settings from .env loaded normally

python3 bin/memory_v1_baseline.py \
    --corpus tests/eval/memory_v1_baseline_corpus.yaml \
    --output-dir ./baseline-runs/

# Filter to a subset:
python3 bin/memory_v1_baseline.py --category dedup --flavor reva

# Aggregate-only from an existing run (e.g. to tweak the report format):
python3 bin/memory_v1_baseline.py \
    --aggregate-only baseline-runs/memory_v1_baseline_20260514-094530.json
```

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

## Corpus growth plan

First drop ships 24 turns covering all 8 categories (8/8 represented):

| Category | First drop | Target |
|---|---|---|
| dedup | 4 (2 Reva + 2 Renfield) | 23 (15 + 8) |
| within_turn_contradiction | 2 (1+1) | 23 (15 + 8) |
| generic_query | 4 (3+1) | 30 (20 + 10) |
| role_injection | 3 (2+1) | 14 (10 + 4) |
| pure_add | 6 (4+2) | 32 (20 + 12) |
| cross_session_stale | 3 (2+1) | 14 (10 + 4) |
| circle_leakage | 2 (1+1) | 7 (5 + 2) |
| wrong_substrate | 2 (2+0) | 7 (5 + 2) |
| **Total** | **24** | **150 (100 + 50)** |

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
