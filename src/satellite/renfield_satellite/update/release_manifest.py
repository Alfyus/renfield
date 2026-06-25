"""Signed-source-manifest helpers for OTA package authenticity (security H6).

A release is authenticated by a manifest that lists the version plus a SHA256 of
every source file in the update package, signed offline with an Ed25519 release
key. The satellite extracts the downloaded tarball to a temp dir, recomputes the
file hashes, verifies they match the manifest, and verifies the manifest
signature against pinned public key(s) — all BEFORE installing. The OTA checksum
remains an integrity check; this adds authenticity (a compromised/spoofed
backend can't push code it didn't get signed offline).

This module is shared by:
- `bin/sign_satellite_release.py` (offline signer / verifier — build + sign)
- the satellite `update_manager` (verify before install)

The backend never imports this — it only forwards the manifest bytes + signature
it shipped in its image; it cannot mint a signature.

Wire format:
- manifest: canonical JSON bytes (sorted keys, compact separators) — the EXACT
  bytes that are signed and verified (never re-serialized on the verify side).
- signature: base64 of the 64-byte Ed25519 signature over those bytes.
- public keys: 64-hex-char (32-byte raw) Ed25519 public keys (safe in git).
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

MANIFEST_FILENAME = "RELEASE_MANIFEST.json"
SIGNATURE_FILENAME = "RELEASE_MANIFEST.json.sig"

# Top-level files included in an OTA package (mirrors satellite_update_service
# .build_update_package); only those that exist are listed.
_TOP_LEVEL_FILES = ("requirements.txt", "setup.py", "pyproject.toml")
# The code dir whose contents are hashed (recursively), excluding caches.
_CODE_DIR = "renfield_satellite"


def _is_excluded(relpath: str) -> bool:
    """Compiled-bytecode artifacts are regenerated and not security-relevant —
    excluded from BOTH the manifest and the package so verification is stable
    and a stale/injected .pyc can't slip past the source hashes."""
    parts = relpath.split("/")
    return "__pycache__" in parts or relpath.endswith(".pyc")


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _collect_package_files(source_root: Path, *, include_bytecode: bool = False) -> dict[str, str]:
    """relpath -> sha256 for every package source file under ``source_root``.

    ``include_bytecode=False`` (manifest/signer side) excludes __pycache__/*.pyc
    so the signed manifest is pure source. ``include_bytecode=True`` (verify side,
    over the EXTRACTED tree) includes them — since the manifest never lists a
    .pyc, any bytecode in the package then surfaces as an "unexpected file" in
    verify_extracted. This is the H6 .pyc-injection guard: an attacker forwarding
    a genuine signed manifest but smuggling a forged-header .pyc that shadows a
    trusted .py cannot pass (and _install_package strips bytecode anyway).
    """
    files: dict[str, str] = {}
    code_dir = source_root / _CODE_DIR
    if code_dir.is_dir():
        for root, dirs, names in os.walk(code_dir):
            if include_bytecode:
                dirs[:] = sorted(dirs)
            else:
                # Prune cache dirs so os.walk doesn't descend into them.
                dirs[:] = sorted(d for d in dirs if d != "__pycache__")
            for name in sorted(names):
                full = Path(root) / name
                rel = full.relative_to(source_root).as_posix()
                if not include_bytecode and _is_excluded(rel):
                    continue
                files[rel] = _sha256_file(full)
    for top in _TOP_LEVEL_FILES:
        p = source_root / top
        if p.is_file():
            files[top] = _sha256_file(p)
    return files


def build_manifest(source_root: Path, version: str) -> dict:
    """Build the manifest dict for ``source_root`` at ``version``."""
    return {"version": version, "files": _collect_package_files(source_root)}


def canonical_bytes(manifest: dict) -> bytes:
    """The exact bytes that are signed/verified — sorted keys, compact."""
    return json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")


def verify_extracted(extract_root: Path, manifest: dict) -> list[str]:
    """Recompute hashes of the extracted tree and diff against the manifest.

    Returns a list of human-readable problems (empty == clean). Checks BOTH
    directions: every manifest file present + matching, and no UNEXPECTED
    package source file in the extract (an injected file is a problem).
    """
    problems: list[str] = []
    expected: dict[str, str] = manifest.get("files", {})
    # Include bytecode on the verify side so an injected/forged .pyc (which the
    # signed manifest never lists) is caught as an "unexpected file" below.
    actual = _collect_package_files(extract_root, include_bytecode=True)

    for rel, want in expected.items():
        got = actual.get(rel)
        if got is None:
            problems.append(f"missing file: {rel}")
        elif got != want:
            problems.append(f"hash mismatch: {rel}")
    for rel in actual:
        if rel not in expected:
            problems.append(f"unexpected file: {rel}")
    return problems


def verify_signature(manifest_bytes: bytes, signature_b64: str, pubkeys_hex: list[str]) -> bool:
    """True if ``signature_b64`` over ``manifest_bytes`` verifies under ANY pinned
    public key (N-key rotation: ship old+new, accept either). False on any error.
    """
    try:
        from cryptography.hazmat.primitives.asymmetric import ed25519
    except Exception:
        # cryptography missing → cannot verify. Treat as not-verified (the caller
        # fails closed when a signature is required) but log LOUDLY — a silent
        # skip is the documented IRK "cryptography no-ops invisibly" trap.
        logger.error(
            "cryptography is NOT installed — OTA signature CANNOT be verified; "
            "rejecting. Install cryptography on this satellite."
        )
        return False
    try:
        sig = base64.b64decode(signature_b64, validate=True)
    except Exception:
        logger.warning("OTA release signature is not valid base64 — rejecting")
        return False
    for hexkey in pubkeys_hex:
        # Distinguish a MALFORMED pinned key (operator misconfiguration) from a
        # valid key that simply didn't sign this manifest (expected during
        # rotation). A silently-skipped bad key makes a config typo look exactly
        # like a signature failure.
        try:
            raw = bytes.fromhex(hexkey.strip())
            pub = ed25519.Ed25519PublicKey.from_public_bytes(raw)
        except Exception as e:
            logger.warning("Ignoring malformed release pubkey %r: %s", hexkey[:12], e)
            continue
        try:
            pub.verify(sig, manifest_bytes)
            return True
        except Exception:
            continue  # valid key, not the signer — normal during rotation
    return False
