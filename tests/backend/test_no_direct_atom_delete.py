"""Lint: only AtomPurgeService is allowed to delete atoms.

Background:
    The legal_hold discrimination for wb_field_provenance lives in
    ``services/atom_purge_service.py``. Any code path that deletes
    atoms directly bypasses the archive step and silently destroys
    BaFin-mandated audit trails.

This lint scans the backend source for direct atom-deletion patterns
and fails if any are found outside the allowlisted module.

Patterns blocked:
    - ``DELETE FROM atoms``  (raw SQL)
    - ``delete(Atom)``       (SQLAlchemy Core)
    - ``Atom.__table__.delete()``
    - ``session.delete(some_atom_instance)`` is harder to detect
      statically — flagged via a runtime guard in ``Atom`` if needed
      later; not in scope for sprint 2.

Allowlist:
    - services/atom_purge_service.py — the sanctioned path
    - tests/**                       — tests legitimately exercise both paths
    - alembic/versions/**            — migrations may need to touch atoms
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "src" / "backend"

ALLOWLIST = {
    "services/atom_purge_service.py",
}

# Patterns that indicate a direct atom deletion.
PATTERNS = [
    re.compile(r"DELETE\s+FROM\s+atoms\b", re.IGNORECASE),
    re.compile(r"\bdelete\(\s*Atom\s*\)"),
    re.compile(r"Atom\.__table__\.delete\(\s*\)"),
]


@pytest.mark.unit
def test_no_direct_atom_delete_outside_purge_service():
    """Fail if any backend file (outside the allowlist) deletes atoms directly."""
    offenders: list[tuple[str, int, str]] = []

    for py_file in BACKEND_ROOT.rglob("*.py"):
        rel = py_file.relative_to(BACKEND_ROOT).as_posix()
        if rel in ALLOWLIST:
            continue
        if rel.startswith("alembic/versions/"):
            continue
        try:
            text = py_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for pat in PATTERNS:
                if pat.search(line):
                    offenders.append((rel, lineno, line.strip()))

    if offenders:
        msg = (
            "Direct atom deletion detected. Route through "
            "AtomPurgeService.purge() to preserve legal_hold snapshots.\n"
        )
        for path, lineno, line in offenders:
            msg += f"  {path}:{lineno}  {line}\n"
        pytest.fail(msg)
