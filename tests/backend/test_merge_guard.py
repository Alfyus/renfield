"""Unit tests for the shared merge concurrency guard (D5)."""
import pytest

from services.merge_guard import is_already_merged

pytestmark = pytest.mark.unit


def test_live_unmerged_row_is_not_already_merged():
    assert is_already_merged(canonical_pointer=None, is_live=True) is False


def test_pointer_set_means_already_merged():
    assert is_already_merged(canonical_pointer=42, is_live=True) is True


def test_inactive_means_already_merged():
    assert is_already_merged(canonical_pointer=None, is_live=False) is True


def test_both_signals_means_already_merged():
    assert is_already_merged(canonical_pointer=7, is_live=False) is True
