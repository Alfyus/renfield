"""
Unit tests for the Phase-0 memory v1 baseline runner — covers the pure
aggregation paths (no DB / LLM needed). The integration paths that hit
Postgres + Ollama / llama-server are covered by running the script
itself against the .159 build box per CLAUDE.md.

These tests exist to:
  1. Prove `aggregate_baseline_metrics` computes the four locked
     baselines correctly across the categories the plan asks about.
  2. Prove the report renderer produces a markdown string with the
     v1-vs-v2 quality bar header expected by Phase 0.
  3. Prevent the next engineer from quietly changing the metric
     definitions and silently moving the v2 quality bar.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

# Allow importing the script directly. It is under bin/ which is not
# on sys.path by default.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "bin") not in sys.path:
    sys.path.insert(0, str(ROOT / "bin"))

import memory_v1_baseline as runner  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _result(
    turn_id: str,
    category: str,
    expected: str,
    actual: str,
    *,
    flavor: str = "reva",
    parse_error: bool = False,
    embedding_error: bool = False,
    latency: float = 1.0,
    extracted: int = 0,
) -> runner.BaselineResult:
    return runner.BaselineResult(
        turn_id=turn_id,
        category=category,
        flavor=flavor,
        expected_outcome=expected,
        actual_outcome=actual,
        extracted_count=extracted,
        latency_seconds=latency,
        parse_error=parse_error,
        embedding_error=embedding_error,
    )


# ---------------------------------------------------------------------------
# aggregate_baseline_metrics
# ---------------------------------------------------------------------------

class TestAggregateBaselineMetrics:
    """The four locked baselines, computed per the plan's definitions."""

    @pytest.mark.unit
    def test_empty_input_returns_zeroed_report(self):
        report = runner.aggregate_baseline_metrics([])
        assert report.total_turns == 0
        # No turns means perfect schema rate by definition (no failures observed)
        assert report.schema_validation_rate == 1.0
        assert report.noop_rate_on_generic_queries == 0.0
        assert report.duplicate_rate == 0.0
        assert report.cross_session_update_detection == 0.0

    @pytest.mark.unit
    def test_noop_rate_only_counts_should_not_extract_categories(self):
        """Plan: NOOP rate measured across {generic_query,
        within_turn_contradiction, role_injection, wrong_substrate,
        circle_leakage}. pure_add and dedup turns NEVER count toward
        this metric."""
        results = [
            # 3 generic_query turns: 2 NOOP, 1 wrongly ADD
            _result("g1", "generic_query", "NOOP", "NOOP"),
            _result("g2", "generic_query", "NOOP", "NOOP"),
            _result("g3", "generic_query", "NOOP", "ADD"),
            # 2 pure_add turns — must NOT affect the NOOP rate
            _result("a1", "pure_add", "ADD", "ADD"),
            _result("a2", "pure_add", "ADD", "ADD"),
        ]
        report = runner.aggregate_baseline_metrics(results)
        # 2 of 3 generic_query turns NOOP'd correctly = 0.6667
        assert report.noop_rate_on_generic_queries == pytest.approx(2 / 3, abs=0.001)

    @pytest.mark.unit
    def test_noop_rate_spans_all_should_not_extract_categories(self):
        results = [
            _result("g1", "generic_query", "NOOP", "NOOP"),
            _result("w1", "within_turn_contradiction", "NOOP", "NOOP"),
            _result("i1", "role_injection", "NOOP", "ADD"),  # wrong
            _result("s1", "wrong_substrate", "NOOP", "NOOP"),
            _result("c1", "circle_leakage", "NOOP", "NOOP"),
        ]
        report = runner.aggregate_baseline_metrics(results)
        # 4 of 5 correct
        assert report.noop_rate_on_generic_queries == 0.8

    @pytest.mark.unit
    def test_duplicate_rate_counts_dedup_turns_wrongly_adding(self):
        results = [
            # 4 dedup turns: 1 wrongly ADD, 3 correctly NOOP
            _result("d1", "dedup", "NOOP", "ADD"),  # duplicate created
            _result("d2", "dedup", "NOOP", "NOOP"),
            _result("d3", "dedup", "NOOP", "NOOP"),
            _result("d4", "dedup", "NOOP", "NOOP"),
            # NON-dedup ADD turns must NOT count toward duplicate rate
            _result("a1", "pure_add", "ADD", "ADD"),
        ]
        report = runner.aggregate_baseline_metrics(results)
        assert report.duplicate_rate == 0.25

    @pytest.mark.unit
    def test_cross_session_update_detection_accepts_update_or_delete(self):
        """The plan treats UPDATE and DELETE+ADD as equivalent acceptable
        outcomes for a stale-fact contradiction. The metric counts both."""
        results = [
            _result("s1", "cross_session_stale", "UPDATE", "UPDATE"),
            _result("s2", "cross_session_stale", "UPDATE", "DELETE"),
            _result("s3", "cross_session_stale", "UPDATE", "ADD"),  # missed: stale row not touched
            _result("s4", "cross_session_stale", "UPDATE", "NOOP"),  # missed
        ]
        report = runner.aggregate_baseline_metrics(results)
        # 2 of 4 stale rows actually touched (UPDATE or DELETE)
        assert report.cross_session_update_detection == 0.5

    @pytest.mark.unit
    def test_schema_validation_rate_is_one_minus_parse_error_rate(self):
        results = [
            _result("a1", "pure_add", "ADD", "ADD", parse_error=False),
            _result("a2", "pure_add", "ADD", "ADD", parse_error=False),
            _result("a3", "pure_add", "ADD", "FALLBACK", parse_error=True),
            _result("a4", "pure_add", "ADD", "FALLBACK", parse_error=True),
        ]
        report = runner.aggregate_baseline_metrics(results)
        assert report.parse_error_rate == 0.5
        assert report.schema_validation_rate == 0.5

    @pytest.mark.unit
    def test_latency_percentiles_compute_correctly(self):
        # 20 latencies, evenly spaced 1.0..20.0
        results = [
            _result(f"t{i}", "pure_add", "ADD", "ADD", latency=float(i))
            for i in range(1, 21)
        ]
        report = runner.aggregate_baseline_metrics(results)
        assert report.latency_p50 == 11.0  # middle of 1..20 = index 10 (zero-indexed)
        # p95 of 20 entries: index 18 (int(20*0.95)-1 == 18) → value 19
        assert report.latency_p95 == 19.0
        assert report.latency_p99 == 19.0

    @pytest.mark.unit
    def test_outcome_distribution_counts_all_turns(self):
        results = [
            _result("a1", "pure_add", "ADD", "ADD"),
            _result("a2", "pure_add", "ADD", "ADD"),
            _result("n1", "generic_query", "NOOP", "NOOP"),
            _result("u1", "cross_session_stale", "UPDATE", "UPDATE"),
        ]
        report = runner.aggregate_baseline_metrics(results)
        assert report.outcome_distribution == {"ADD": 2, "NOOP": 1, "UPDATE": 1}
        assert report.turns_by_category == {
            "pure_add": 2,
            "generic_query": 1,
            "cross_session_stale": 1,
        }


# ---------------------------------------------------------------------------
# matches_expected — the per-turn pass/fail used in the JSON report
# ---------------------------------------------------------------------------

class TestMatchesExpected:

    @pytest.mark.unit
    def test_noop_expected_is_strict(self):
        # NOOP-expected turns ONLY pass if actual is also NOOP
        assert _result("t", "generic_query", "NOOP", "NOOP").matches_expected()
        assert not _result("t", "generic_query", "NOOP", "ADD").matches_expected()
        assert not _result("t", "generic_query", "NOOP", "UPDATE").matches_expected()

    @pytest.mark.unit
    def test_update_expected_is_lenient(self):
        # UPDATE expected — UPDATE, DELETE, and ADD (DELETE+ADD path) all OK
        for actual in ("UPDATE", "DELETE", "ADD"):
            assert _result("t", "cross_session_stale", "UPDATE", actual).matches_expected()
        assert not _result("t", "cross_session_stale", "UPDATE", "NOOP").matches_expected()

    @pytest.mark.unit
    def test_add_expected_strict(self):
        assert _result("t", "pure_add", "ADD", "ADD").matches_expected()
        assert not _result("t", "pure_add", "ADD", "NOOP").matches_expected()


# ---------------------------------------------------------------------------
# render_markdown_report — shape of the published artifact
# ---------------------------------------------------------------------------

class TestRenderMarkdownReport:

    @pytest.mark.unit
    def test_report_includes_four_baselines_and_target_columns(self):
        results = [
            _result("g1", "generic_query", "NOOP", "NOOP"),
            _result("d1", "dedup", "NOOP", "NOOP"),
            _result("s1", "cross_session_stale", "UPDATE", "UPDATE"),
        ]
        report = runner.aggregate_baseline_metrics(results)
        md = runner.render_markdown_report(
            report,
            corpus_path=Path("tests/eval/memory_v1_baseline_corpus.yaml"),
            run_started=datetime(2026, 5, 14, 12, 0, 0, tzinfo=UTC),
        )
        # Four locked baselines all present
        assert "NOOP rate on generic queries" in md
        assert "Duplicate rate" in md
        assert "Cross-session UPDATE detection" in md
        assert "Schema-validation rate" in md
        # Target column (so future engineers can't drop the bars)
        assert "≥ 0.950" in md
        assert "≤ 0.010" in md
        assert "≥ 0.800" in md
        # Pointer to the plan
        assert "memory-architecture-plan.md" in md

    @pytest.mark.unit
    def test_report_marks_pass_or_gap_per_metric(self):
        # Construct a report where 3 of 4 baselines fail
        bad_results = [
            _result("g1", "generic_query", "NOOP", "ADD"),  # NOOP rate 0.0 (fails)
            _result("d1", "dedup", "NOOP", "ADD"),           # dup rate 1.0 (fails)
            _result("s1", "cross_session_stale", "UPDATE", "NOOP"),  # detection 0.0 (fails)
            _result("a1", "pure_add", "ADD", "ADD"),
        ]
        report = runner.aggregate_baseline_metrics(bad_results)
        md = runner.render_markdown_report(
            report,
            corpus_path=Path("tests/eval/memory_v1_baseline_corpus.yaml"),
            run_started=datetime(2026, 5, 14, tzinfo=UTC),
        )
        # Three gap markers expected
        assert md.count("gap to close in v2") >= 3
