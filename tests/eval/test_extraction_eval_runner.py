"""
Unit tests for the v2 CI eval runner — pure assertion-logic surface.

Covers check_expectations() against the five supported expect-block
assertion keys. Does NOT exercise the LLM call path; that's an
integration concern (run via the runner against .159).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


# Discover the runner script. Mirrors the baseline test's
# MEMORY_BASELINE_RUNNER_DIR pattern — local dev finds it at
# parents[2]/bin/, .159 docker container finds it via the env var
# pointing at a mounted path.
_env_dir = os.environ.get("MEMORY_BASELINE_RUNNER_DIR")
if _env_dir:
    _runner_dir = Path(_env_dir)
else:
    _runner_dir = Path(__file__).resolve().parents[2] / "bin"
if not (_runner_dir / "run_memory_extraction_eval.py").exists():
    raise RuntimeError(
        f"run_memory_extraction_eval.py not found in {_runner_dir}. "
        f"Set MEMORY_BASELINE_RUNNER_DIR or copy the runner into a "
        f"directory reachable from the test's mount."
    )
if str(_runner_dir) not in sys.path:
    sys.path.insert(0, str(_runner_dir))

import run_memory_extraction_eval as runner  # noqa: E402


# ---------------------------------------------------------------------------
# Fake ops-list type used in the tests — mirrors MemoryOpsList.ops shape
# ---------------------------------------------------------------------------

class _FakeOpType:
    def __init__(self, value):
        self.value = value

    def __eq__(self, other):
        if isinstance(other, _FakeOpType):
            return self.value == other.value
        if isinstance(other, str):
            return self.value == other
        return False

    def __hash__(self):
        return hash(self.value)


class _FakeOp:
    def __init__(self, op, target_id=None, content=None, category=None, importance=None, reason=None):
        self.op = _FakeOpType(op)
        self.target_id = target_id
        self.content = content
        self.category = category
        self.importance = importance
        self.reason = reason


class _FakeOpsList:
    def __init__(self, ops):
        self.ops = ops


# ---------------------------------------------------------------------------
# check_expectations — five assertion keys
# ---------------------------------------------------------------------------

class TestCheckExpectations:

    @pytest.mark.unit
    def test_none_result_always_fails(self):
        passed, failures = runner.check_expectations(None, {}, set())
        assert not passed
        assert any("LLM returned None" in f for f in failures)

    @pytest.mark.unit
    def test_empty_expect_passes_on_any_result(self):
        ops = _FakeOpsList([_FakeOp("ADD", content="x", category="fact")])
        passed, failures = runner.check_expectations(ops, {}, set())
        assert passed
        assert failures == []

    @pytest.mark.unit
    def test_ops_count_at_most_pass(self):
        ops = _FakeOpsList([_FakeOp("NOOP")])
        passed, _ = runner.check_expectations(ops, {"ops_count_at_most": 2}, set())
        assert passed

    @pytest.mark.unit
    def test_ops_count_at_most_fail(self):
        ops = _FakeOpsList([_FakeOp("ADD"), _FakeOp("ADD"), _FakeOp("ADD")])
        passed, failures = runner.check_expectations(ops, {"ops_count_at_most": 2}, set())
        assert not passed
        assert any("emitted 3 ops" in f for f in failures)

    @pytest.mark.unit
    def test_ops_must_contain_op_types(self):
        ops = _FakeOpsList([_FakeOp("ADD"), _FakeOp("NOOP")])
        # ADD is required → pass
        passed, _ = runner.check_expectations(
            ops, {"ops_must_contain_op_types": ["ADD"]}, set()
        )
        assert passed
        # UPDATE is required → fail
        passed, failures = runner.check_expectations(
            ops, {"ops_must_contain_op_types": ["UPDATE"]}, set()
        )
        assert not passed
        assert any("missing required op type: UPDATE" in f for f in failures)

    @pytest.mark.unit
    def test_ops_must_not_contain_op_types(self):
        ops = _FakeOpsList([_FakeOp("ADD"), _FakeOp("UPDATE", target_id=1)])
        # ADD is forbidden → fail
        passed, failures = runner.check_expectations(
            ops, {"ops_must_not_contain_op_types": ["ADD"]}, set()
        )
        assert not passed
        assert any("forbidden op type emitted: ADD" in f for f in failures)
        # DELETE is forbidden → pass (not emitted)
        passed, _ = runner.check_expectations(
            ops, {"ops_must_not_contain_op_types": ["DELETE"]}, set()
        )
        assert passed

    @pytest.mark.unit
    def test_target_id_in_candidates(self):
        ops = _FakeOpsList([
            _FakeOp("UPDATE", target_id=10, content="x"),
            _FakeOp("DELETE", target_id=20),
        ])
        # Both target_ids in candidates → pass
        passed, _ = runner.check_expectations(
            ops, {"ops_must_target_id_in_candidates": True}, {10, 20}
        )
        assert passed
        # target_id=999 not in candidates → fail
        ops2 = _FakeOpsList([_FakeOp("UPDATE", target_id=999, content="x")])
        passed, failures = runner.check_expectations(
            ops2, {"ops_must_target_id_in_candidates": True}, {10, 20}
        )
        assert not passed
        assert any("target_id=999 not in candidates" in f for f in failures)

    @pytest.mark.unit
    def test_target_id_check_skipped_when_flag_false(self):
        ops = _FakeOpsList([_FakeOp("UPDATE", target_id=999, content="x")])
        # Flag absent → no candidates check
        passed, _ = runner.check_expectations(ops, {}, set())
        assert passed
        # Flag explicitly False → also skip
        passed, _ = runner.check_expectations(
            ops, {"ops_must_target_id_in_candidates": False}, set()
        )
        assert passed

    @pytest.mark.unit
    def test_multiple_failures_all_reported(self):
        ops = _FakeOpsList([
            _FakeOp("ADD"),
            _FakeOp("UPDATE", target_id=999, content="x"),
            _FakeOp("DELETE", target_id=888),
        ])
        passed, failures = runner.check_expectations(ops, {
            "ops_count_at_most": 1,
            "ops_must_not_contain_op_types": ["ADD"],
            "ops_must_target_id_in_candidates": True,
        }, {10})
        assert not passed
        # Three independent failures
        assert any("emitted 3 ops" in f for f in failures)
        assert any("forbidden op type emitted: ADD" in f for f in failures)
        assert sum(1 for f in failures if "not in candidates" in f) == 2


# ---------------------------------------------------------------------------
# summarize_ops — short-form report
# ---------------------------------------------------------------------------

class TestSummarizeOps:

    @pytest.mark.unit
    def test_none(self):
        assert runner.summarize_ops(None).startswith("(None")

    @pytest.mark.unit
    def test_empty(self):
        assert runner.summarize_ops(_FakeOpsList([])) == "[]"

    @pytest.mark.unit
    def test_with_target_ids(self):
        ops = _FakeOpsList([
            _FakeOp("ADD"),
            _FakeOp("UPDATE", target_id=42),
            _FakeOp("DELETE", target_id=10),
            _FakeOp("NOOP"),
        ])
        s = runner.summarize_ops(ops)
        assert "ADD" in s
        assert "UPDATE(id=42)" in s
        assert "DELETE(id=10)" in s
        assert "NOOP" in s


# ---------------------------------------------------------------------------
# Render report — output shape
# ---------------------------------------------------------------------------

class TestRenderReport:

    @pytest.mark.unit
    def test_all_pass(self):
        results = [
            runner.CaseResult("case-1", True, [], "[NOOP]"),
            runner.CaseResult("case-2", True, [], "[ADD]"),
        ]
        report = runner.render_report(results)
        assert "Passed: 2 / 2" in report
        assert "[PASS]" in report
        assert "[FAIL]" not in report

    @pytest.mark.unit
    def test_mixed(self):
        results = [
            runner.CaseResult("case-1", True, [], "[NOOP]"),
            runner.CaseResult("case-2", False, ["forbidden op type emitted: ADD"], "[ADD]"),
        ]
        report = runner.render_report(results)
        assert "Passed: 1 / 2" in report
        assert "[PASS]  case-1" in report
        assert "[FAIL]  case-2" in report
        assert "forbidden op type emitted: ADD" in report
