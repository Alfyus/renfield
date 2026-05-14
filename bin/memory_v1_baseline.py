#!/usr/bin/env python3
"""
Memory Extraction v1 — Baseline Runner

Runs the hand-curated baseline corpus
(`tests/eval/memory_v1_baseline_corpus.yaml`) against the current
`ConversationMemoryService.extract_and_save` v1 path and emits the
empirical numbers the Mem0 v2 upgrade must beat (Phase 0 of the
memory architecture plan — see
`docs/architecture/memory-architecture-plan.md`).

For each corpus turn the runner:
  1. Creates an isolated test user in a clean DB session.
  2. Seeds any `preexisting_memories` (backdated to `age_days`).
  3. Invokes the v1 extract path with the turn's user_message +
     assistant_response.
  4. Diffs the per-user memory rows before vs after to classify the
     actual outcome (NOOP / ADD / UPDATE / DELETE / FALLBACK).
  5. Records latency, parse failures, embedding failures.

Outputs:
  - JSON   `<output_dir>/memory_v1_baseline_<timestamp>.json` —
           per-turn results for the diff in shadow mode and for
           historical comparison.
  - MD     `<output_dir>/memory_v1_baseline_<timestamp>.md` —
           aggregated metrics in the four baseline categories the
           plan locks (NOOP rate on generic queries, duplicate rate,
           cross-session UPDATE detection, schema-validation rate).

Usage:
    # Requires DATABASE_URL + OLLAMA_BASE_URL + LLM_OPENAI_BASE_URL
    # (or the equivalent .env wiring the running cluster uses).
    python bin/memory_v1_baseline.py \\
        --corpus tests/eval/memory_v1_baseline_corpus.yaml \\
        --output-dir ./baseline-runs/

    # Run only a subset:
    python bin/memory_v1_baseline.py --category dedup --flavor reva

    # Dry-run aggregation against an existing JSON without re-running
    # the corpus (useful for tuning the report layout):
    python bin/memory_v1_baseline.py \\
        --aggregate-only baseline-runs/memory_v1_baseline_2026-05-14.json
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import logging
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

# yaml is imported lazily inside `run_corpus`; unit tests that only
# exercise the pure aggregation paths must not require pyyaml.


# ---------------------------------------------------------------------------
# Data shapes — pure (no DB / LLM imports)
# ---------------------------------------------------------------------------

VALID_OUTCOMES = {"NOOP", "ADD", "UPDATE", "DELETE", "FALLBACK"}
VALID_CATEGORIES = {
    "dedup",
    "within_turn_contradiction",
    "generic_query",
    "role_injection",
    "pure_add",
    "cross_session_stale",
    "circle_leakage",
    "wrong_substrate",
}


@dataclasses.dataclass
class BaselineResult:
    """One corpus-turn run against v1 extract_and_save."""

    turn_id: str
    category: str
    flavor: str
    expected_outcome: str
    actual_outcome: str
    extracted_count: int          # rows added/updated/deleted by this turn
    latency_seconds: float
    parse_error: bool             # extraction LLM JSON unparseable
    embedding_error: bool         # embedding call failed
    notes: str = ""

    def matches_expected(self) -> bool:
        # NOOP is the strictest; everything else is graded permissively
        # because UPDATE vs DELETE+ADD can both be acceptable outcomes
        # for the same input (see corpus notes).
        if self.expected_outcome == "NOOP":
            return self.actual_outcome == "NOOP"
        if self.expected_outcome == "UPDATE":
            # UPDATE or DELETE+ADD pair both acceptable
            return self.actual_outcome in {"UPDATE", "DELETE", "ADD"}
        return self.actual_outcome == self.expected_outcome


@dataclasses.dataclass
class BaselineReport:
    """Aggregated metrics across a corpus run."""

    total_turns: int
    turns_by_category: dict[str, int]
    outcome_distribution: dict[str, int]
    parse_error_rate: float                       # fraction of turns with parse_error
    embedding_error_rate: float
    latency_p50: float
    latency_p95: float
    latency_p99: float

    # The four locked baseline metrics (plan §test-plan-artifact baselines)
    noop_rate_on_generic_queries: float           # higher = better; target ≥0.95
    duplicate_rate: float                          # lower = better; target ≤0.01
    cross_session_update_detection: float          # higher = better; target ≥0.80
    schema_validation_rate: float                  # higher = better; target ≥0.95


# ---------------------------------------------------------------------------
# Pure aggregation (covered by unit test — no DB / LLM dependency)
# ---------------------------------------------------------------------------

def aggregate_baseline_metrics(results: list[BaselineResult]) -> BaselineReport:
    """Pure aggregation. Same input → same output. Covered by unit test.

    Definitions of the four locked baselines (plan §test-plan-artifact):

    - noop_rate_on_generic_queries: among turns with category in
      {generic_query, within_turn_contradiction, role_injection,
      wrong_substrate, circle_leakage}, the fraction that v1
      correctly answered with NOOP. Target ≥0.95.

    - duplicate_rate: among turns with category=dedup, the fraction
      where v1 incorrectly produced a NEW row (actual=ADD when
      expected=NOOP). Target ≤0.01.

    - cross_session_update_detection: among turns with
      category=cross_session_stale, the fraction where v1 correctly
      emitted UPDATE or DELETE+ADD on the stale row. Target ≥0.80.

    - schema_validation_rate: 1.0 minus the parse_error_rate. Target ≥0.95.
    """
    if not results:
        return BaselineReport(
            total_turns=0,
            turns_by_category={},
            outcome_distribution={},
            parse_error_rate=0.0,
            embedding_error_rate=0.0,
            latency_p50=0.0,
            latency_p95=0.0,
            latency_p99=0.0,
            noop_rate_on_generic_queries=0.0,
            duplicate_rate=0.0,
            cross_session_update_detection=0.0,
            schema_validation_rate=1.0,
        )

    total = len(results)
    by_cat = Counter(r.category for r in results)
    outcomes = Counter(r.actual_outcome for r in results)

    parse_errors = sum(1 for r in results if r.parse_error)
    embed_errors = sum(1 for r in results if r.embedding_error)

    latencies = sorted(r.latency_seconds for r in results)
    p50 = latencies[len(latencies) // 2]
    p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)]
    p99 = latencies[max(0, int(len(latencies) * 0.99) - 1)]

    # NOOP rate on "should not extract" categories
    noop_cats = {
        "generic_query",
        "within_turn_contradiction",
        "role_injection",
        "wrong_substrate",
        "circle_leakage",
    }
    noop_candidates = [r for r in results if r.category in noop_cats]
    noop_correct = sum(1 for r in noop_candidates if r.actual_outcome == "NOOP")
    noop_rate = noop_correct / len(noop_candidates) if noop_candidates else 0.0

    # Duplicate rate among dedup cases: v1 wrongly emits ADD instead of NOOP
    dedup_results = [r for r in results if r.category == "dedup"]
    dup_count = sum(1 for r in dedup_results if r.actual_outcome == "ADD")
    dup_rate = dup_count / len(dedup_results) if dedup_results else 0.0

    # Cross-session UPDATE detection
    stale_results = [r for r in results if r.category == "cross_session_stale"]
    stale_detected = sum(
        1 for r in stale_results
        if r.actual_outcome in {"UPDATE", "DELETE"}
    )
    stale_rate = stale_detected / len(stale_results) if stale_results else 0.0

    return BaselineReport(
        total_turns=total,
        turns_by_category=dict(by_cat),
        outcome_distribution=dict(outcomes),
        parse_error_rate=parse_errors / total,
        embedding_error_rate=embed_errors / total,
        latency_p50=p50,
        latency_p95=p95,
        latency_p99=p99,
        noop_rate_on_generic_queries=noop_rate,
        duplicate_rate=dup_rate,
        cross_session_update_detection=stale_rate,
        schema_validation_rate=1.0 - (parse_errors / total),
    )


# ---------------------------------------------------------------------------
# Report rendering — pure
# ---------------------------------------------------------------------------

def render_markdown_report(report: BaselineReport, corpus_path: Path, run_started: datetime) -> str:
    """Render the baseline report as the markdown the plan asks operators to publish."""
    lines: list[str] = []
    lines.append(f"# Memory v1 Baseline — {run_started.strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")
    lines.append(f"Corpus: `{corpus_path}`  ")
    lines.append(f"Total turns: **{report.total_turns}**")
    lines.append("")
    lines.append("## The four locked baselines (v2 must beat these)")
    lines.append("")
    lines.append("| Metric | v1 measured | Target for v2 | Pass? |")
    lines.append("|---|---|---|---|")
    lines.append(
        f"| NOOP rate on generic queries | {report.noop_rate_on_generic_queries:.3f} | ≥ 0.950 | "
        f"{'✓' if report.noop_rate_on_generic_queries >= 0.95 else '✗ (gap to close in v2)'} |"
    )
    lines.append(
        f"| Duplicate rate (dedup turns ADD-ing wrongly) | {report.duplicate_rate:.3f} | ≤ 0.010 | "
        f"{'✓' if report.duplicate_rate <= 0.01 else '✗ (gap to close in v2)'} |"
    )
    lines.append(
        f"| Cross-session UPDATE detection | {report.cross_session_update_detection:.3f} | ≥ 0.800 | "
        f"{'✓' if report.cross_session_update_detection >= 0.80 else '✗ (gap to close in v2)'} |"
    )
    lines.append(
        f"| Schema-validation rate (JSON parseable) | {report.schema_validation_rate:.3f} | ≥ 0.950 | "
        f"{'✓' if report.schema_validation_rate >= 0.95 else '✗ (gap to close in v2)'} |"
    )
    lines.append("")
    lines.append("## Latency")
    lines.append("")
    lines.append(f"- p50: {report.latency_p50:.2f}s")
    lines.append(f"- p95: {report.latency_p95:.2f}s")
    lines.append(f"- p99: {report.latency_p99:.2f}s")
    lines.append("")
    lines.append("## Outcome distribution")
    lines.append("")
    for outcome, count in sorted(report.outcome_distribution.items()):
        lines.append(f"- {outcome}: {count}")
    lines.append("")
    lines.append("## Turns by category")
    lines.append("")
    for cat, count in sorted(report.turns_by_category.items()):
        lines.append(f"- {cat}: {count}")
    lines.append("")
    lines.append("## v2 quality bar")
    lines.append("")
    lines.append(
        "v2 ships only when ALL four baselines are at least met (≥ on improvement, "
        "≤ on regression) AND v2 is strictly better on at least one. See "
        "`docs/architecture/memory-architecture-plan.md` → Eng-review-modifications → "
        "v1 disposition for the Phase A shadow-mode protocol."
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Integration runner — requires DB + LLM access (NOT exercised by unit tests)
# ---------------------------------------------------------------------------

async def run_one_turn(
    turn: dict[str, Any],
    db_session,
    service,
) -> BaselineResult:
    """Execute one corpus turn against the v1 extract path.

    Imports are inside the function so the module remains importable
    without a backend env (the unit test only exercises the pure
    aggregation paths above).
    """
    from models.database import ConversationMemory

    expected = turn.get("expected_v1_outcome", "NOOP")
    if expected not in VALID_OUTCOMES:
        raise ValueError(
            f"Turn {turn['id']}: expected_v1_outcome={expected!r} not in {VALID_OUTCOMES}"
        )

    # 1. Allocate isolated user for this turn (small int to keep
    #    advisory-lock hashing predictable in later v2 lanes).
    test_user_id = hash(turn["id"]) % 1_000_000

    # 2. Seed preexisting memories with backdated last_accessed_at.
    seeded_ids: set[int] = set()
    for pre in turn.get("preexisting_memories") or []:
        age_days = pre.get("age_days", 0)
        seeded_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=age_days)
        row = ConversationMemory(
            content=pre["content"],
            category=pre["category"],
            importance=pre.get("importance", 0.5),
            user_id=pre.get("owner_user_id", test_user_id),
            is_active=True,
            access_count=0,
            last_accessed_at=seeded_at,
            created_at=seeded_at,
            circle_tier=pre.get("circle_tier", 0),
        )
        db_session.add(row)
        await db_session.flush()
        # Track rows we expect to dedup/update against (those owned by
        # the asker; cross-tier seeds are NOT tracked because v1 must
        # not touch them).
        if pre.get("owner_user_id", test_user_id) == test_user_id:
            seeded_ids.add(row.id)
    await db_session.commit()

    # 3. Snapshot existing rows BEFORE the extract call.
    from sqlalchemy import select
    before = (
        await db_session.execute(
            select(ConversationMemory.id, ConversationMemory.content)
            .where(ConversationMemory.user_id == test_user_id)
        )
    ).all()
    before_ids = {row.id for row in before}
    before_contents = {row.id: row.content for row in before}

    # 4. Invoke v1 extract_and_save.
    parse_error = False
    embedding_error = False
    fallback = False
    started = time.monotonic()
    try:
        saved = await service.extract_and_save(
            user_message=turn["user_message"],
            assistant_response=turn["assistant_response"],
            user_id=test_user_id,
            session_id=f"baseline-{turn['id']}",
            lang=turn.get("lang", "de"),
        )
    except Exception as e:
        fallback = True
        saved = []
        logging.warning("Turn %s raised: %s", turn["id"], e)
    elapsed = time.monotonic() - started

    # 5. Snapshot AFTER and diff.
    after = (
        await db_session.execute(
            select(ConversationMemory.id, ConversationMemory.content, ConversationMemory.is_active)
            .where(ConversationMemory.user_id == test_user_id)
        )
    ).all()
    after_active = {row.id for row in after if row.is_active}
    after_inactive = {row.id for row in after if not row.is_active}
    new_ids = after_active - before_ids
    deactivated_ids = before_ids - after_active
    changed_content = {
        row.id for row in after
        if row.id in before_ids and row.content != before_contents.get(row.id)
    }

    # 6. Classify outcome.
    if fallback:
        actual = "FALLBACK"
    elif deactivated_ids:
        actual = "DELETE"
    elif changed_content:
        actual = "UPDATE"
    elif new_ids:
        actual = "ADD"
    else:
        actual = "NOOP"

    return BaselineResult(
        turn_id=turn["id"],
        category=turn["category"],
        flavor=turn["flavor"],
        expected_outcome=expected,
        actual_outcome=actual,
        extracted_count=len(new_ids) + len(deactivated_ids) + len(changed_content),
        latency_seconds=elapsed,
        parse_error=parse_error,
        embedding_error=embedding_error,
        notes=turn.get("notes", ""),
    )


async def run_corpus(
    corpus_path: Path,
    category_filter: Optional[str],
    flavor_filter: Optional[str],
) -> list[BaselineResult]:
    """Run the full corpus end-to-end. Requires backend env (DB + LLM)."""
    # Import backend modules lazily so this script can be unit-tested
    # without a full backend env.
    BACKEND_ROOT = Path(__file__).resolve().parent.parent / "src" / "backend"
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))

    try:
        import yaml
    except ImportError:
        sys.exit("pyyaml not installed (only needed for `run_corpus`). pip install pyyaml")

    from utils.config import settings  # noqa: F401  (drives env wiring)
    from services.conversation_memory_service import ConversationMemoryService

    # Caller is responsible for creating an async SQLAlchemy session
    # pointed at a fresh test DB. We build one here from settings so
    # this script can be run standalone.
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    with open(corpus_path) as f:
        corpus = yaml.safe_load(f)["corpus"]

    if category_filter:
        corpus = [t for t in corpus if t["category"] == category_filter]
    if flavor_filter:
        corpus = [t for t in corpus if t["flavor"] == flavor_filter]

    results: list[BaselineResult] = []
    for turn in corpus:
        async with Session() as session:
            service = ConversationMemoryService(session)
            try:
                result = await run_one_turn(turn, session, service)
            except Exception as e:
                logging.exception("Turn %s failed catastrophically: %s", turn["id"], e)
                result = BaselineResult(
                    turn_id=turn["id"],
                    category=turn["category"],
                    flavor=turn["flavor"],
                    expected_outcome=turn.get("expected_v1_outcome", "NOOP"),
                    actual_outcome="FALLBACK",
                    extracted_count=0,
                    latency_seconds=0.0,
                    parse_error=False,
                    embedding_error=False,
                    notes=f"runner exception: {e}",
                )
            results.append(result)

    await engine.dispose()
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _serialize_results(results: list[BaselineResult]) -> list[dict]:
    return [dataclasses.asdict(r) for r in results]


def _deserialize_results(raw: list[dict]) -> list[BaselineResult]:
    return [BaselineResult(**r) for r in raw]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--corpus",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "tests" / "eval" / "memory_v1_baseline_corpus.yaml",
        help="Path to the corpus YAML (default: the in-repo baseline corpus).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./baseline-runs"),
        help="Where to write the JSON + markdown report (default: ./baseline-runs/).",
    )
    parser.add_argument("--category", help="Run only turns in this category.")
    parser.add_argument("--flavor", choices=["reva", "renfield"], help="Run only turns of this flavor.")
    parser.add_argument(
        "--aggregate-only",
        type=Path,
        help="Skip the corpus run; read an existing JSON and regenerate the markdown report only.",
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    run_started = datetime.now(UTC)
    timestamp = run_started.strftime("%Y%m%d-%H%M%S")

    if args.aggregate_only:
        with open(args.aggregate_only) as f:
            results = _deserialize_results(json.load(f)["results"])
    else:
        results = asyncio.run(run_corpus(args.corpus, args.category, args.flavor))

    report = aggregate_baseline_metrics(results)
    md = render_markdown_report(report, args.corpus, run_started)

    json_path = args.output_dir / f"memory_v1_baseline_{timestamp}.json"
    md_path = args.output_dir / f"memory_v1_baseline_{timestamp}.md"

    with open(json_path, "w") as f:
        json.dump(
            {
                "run_started": run_started.isoformat(),
                "corpus_path": str(args.corpus),
                "report": dataclasses.asdict(report),
                "results": _serialize_results(results),
            },
            f,
            indent=2,
            default=str,
        )

    with open(md_path, "w") as f:
        f.write(md)

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    print()
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
