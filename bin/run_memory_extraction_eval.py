#!/usr/bin/env python3
"""
Memory Extraction CI Runner — Lane B/2 gate.

Reads `tests/eval/memory_extraction_eval.yaml` (9 plan-locked cases) and
invokes the v2 extraction LLM path per case. Asserts each case's `expect`
block — exits non-zero on any failure so this runs as a CI gate or a
pre-merge check on the .159 build box.

Distinct from the 150-turn baseline corpus runner
(`bin/memory_v1_baseline.py`):
  - Baseline runner measures statistical quality across many turns.
  - This runner asserts tight pass/fail on 9 canonical cases.
  - This runner does NOT touch the database (synthetic candidates only).
  - This runner does NOT require BASELINE_DATABASE_URL — only an LLM endpoint.

Supported expect-block assertion keys (per fixture schema):
  ops:                              exact MemoryOps list (deep equality)
  ops_count_at_most:                upper bound on emitted op count
  ops_must_contain_op_types:        op types that MUST appear
  ops_must_not_contain_op_types:    op types that MUST NOT appear
  ops_must_target_id_in_candidates: every UPDATE/DELETE target_id must be
                                    in the case's candidates list

Usage on .159:
  docker exec \\
    -e OLLAMA_HOST='http://cuda.local:11434' \\
    -e OLLAMA_MODEL='qwen3.6:latest' \\
    -e MEMORY_EXTRACTION_MODEL='qwen3.6:latest' \\
    -e PYTHONPATH=/app \\
    renfield-backend python /opt/renfield/bin/run_memory_extraction_eval.py \\
      /tests/eval/memory_extraction_eval.yaml

Exit codes:
  0  all cases passed
  1  one or more cases failed
  2  fixture load error / no cases found
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import logging
import sys
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Assertion checking — pure (covered by unit tests)
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class CaseResult:
    case_id: str
    passed: bool
    failures: list[str]
    actual_ops_summary: str


def check_expectations(
    ops_list,
    expect: dict,
    candidate_ids: set[int],
) -> tuple[bool, list[str]]:
    """Apply expect-block assertions to a MemoryOpsList result.

    Returns (passed, failures_list). Empty failures means pass.
    """
    failures: list[str] = []

    if ops_list is None:
        failures.append("LLM returned None (parse/schema reject)")
        return False, failures

    ops = ops_list.ops
    actual_types = {op.op.value for op in ops}

    if "ops" in expect:
        from services.memory_ops import MemoryOp, OpType
        expected_ops = [
            MemoryOp(
                op=OpType(o["op"]),
                target_id=o.get("target_id"),
                content=o.get("content"),
                category=o.get("category"),
                importance=o.get("importance"),
                reason=o.get("reason"),
            )
            for o in expect["ops"]
        ]
        if ops != expected_ops:
            failures.append(f"ops mismatch: expected {expected_ops}, got {ops}")

    if "ops_count_at_most" in expect:
        cap = int(expect["ops_count_at_most"])
        if len(ops) > cap:
            failures.append(
                f"emitted {len(ops)} ops; ops_count_at_most={cap}"
            )

    if "ops_must_contain_op_types" in expect:
        for required in expect["ops_must_contain_op_types"]:
            if required not in actual_types:
                failures.append(
                    f"missing required op type: {required} (actual: {sorted(actual_types) or '[]'})"
                )

    if "ops_must_not_contain_op_types" in expect:
        for forbidden in expect["ops_must_not_contain_op_types"]:
            if forbidden in actual_types:
                failures.append(f"forbidden op type emitted: {forbidden}")

    if expect.get("ops_must_target_id_in_candidates"):
        for op in ops:
            if op.target_id is not None and op.target_id not in candidate_ids:
                failures.append(
                    f"op {op.op.value} target_id={op.target_id} not in candidates {sorted(candidate_ids)}"
                )

    return not failures, failures


def summarize_ops(ops_list) -> str:
    """Short string summary of the emitted ops, for the report."""
    if ops_list is None:
        return "(None - LLM/schema reject)"
    if not ops_list.ops:
        return "[]"
    return "[" + ", ".join(
        f"{op.op.value}" + (f"(id={op.target_id})" if op.target_id is not None else "")
        for op in ops_list.ops
    ) + "]"


# ---------------------------------------------------------------------------
# Async runner — calls the real v2 LLM path
# ---------------------------------------------------------------------------

async def run_one_case(service, case: dict) -> CaseResult:
    """Invoke service._call_extract_v2_llm against one case + assert."""
    candidates = case.get("candidates") or []
    candidate_ids = {int(c["id"]) for c in candidates if "id" in c}

    # _call_extract_v2_llm builds the prompt, calls the LLM, parses JSON,
    # and validates via MemoryOpsList. Returns None on any failure.
    ops_list = await service._call_extract_v2_llm(
        user_message=case["user_message"],
        assistant_response=case["assistant_response"],
        existing_memories=candidates,
        lang=case.get("lang", "de"),
    )

    passed, failures = check_expectations(ops_list, case["expect"], candidate_ids)
    return CaseResult(
        case_id=case["id"],
        passed=passed,
        failures=failures,
        actual_ops_summary=summarize_ops(ops_list),
    )


async def run_all_cases(fixture_path: Path, case_filter: Optional[str] = None) -> list[CaseResult]:
    """Load the fixture, run each case, return results."""
    BACKEND_ROOT = Path(__file__).resolve().parent.parent / "src" / "backend"
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))

    try:
        import yaml
    except ImportError:
        sys.exit("pyyaml not installed. pip install pyyaml")

    from services.conversation_memory_service import ConversationMemoryService

    with open(fixture_path) as f:
        doc = yaml.safe_load(f)
    cases = doc.get("cases") or []
    if not cases:
        return []
    if case_filter:
        cases = [c for c in cases if c["id"] == case_filter]
        if not cases:
            sys.exit(f"no case with id {case_filter!r} in fixture")

    # No DB writes happen — _call_extract_v2_llm only reads prompts +
    # calls the chat LLM + validates the result. Passing db=None is
    # safe because that method does not touch self.db.
    service = ConversationMemoryService(db=None)

    results: list[CaseResult] = []
    for case in cases:
        try:
            result = await run_one_case(service, case)
        except Exception as e:
            logging.exception("Case %s raised: %s", case["id"], e)
            result = CaseResult(
                case_id=case["id"],
                passed=False,
                failures=[f"unhandled exception: {type(e).__name__}: {e}"],
                actual_ops_summary="(exception)",
            )
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def render_report(results: list[CaseResult]) -> str:
    lines = []
    lines.append("Memory Extraction CI Eval — results")
    lines.append("=" * 60)
    for r in results:
        marker = "PASS" if r.passed else "FAIL"
        lines.append(f"  [{marker}]  {r.case_id:30s} -> {r.actual_ops_summary}")
        for f in r.failures:
            lines.append(f"           ! {f}")
    lines.append("=" * 60)
    passed = sum(1 for r in results if r.passed)
    lines.append(f"  Passed: {passed} / {len(results)}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "fixture",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "tests" / "eval" / "memory_extraction_eval.yaml",
        help="Path to the CI eval YAML fixture (default: in-repo fixture).",
    )
    parser.add_argument("--case", help="Run only the case with this id.")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of the markdown report.",
    )
    args = parser.parse_args()

    if not args.fixture.exists():
        sys.exit(f"fixture not found: {args.fixture}")

    results = asyncio.run(run_all_cases(args.fixture, args.case))
    if not results:
        sys.exit(2)

    if args.json:
        print(json.dumps([dataclasses.asdict(r) for r in results], indent=2))
    else:
        print(render_report(results))

    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
