#!/usr/bin/env python3
"""Offline signer for OTA release manifests (security review H6).

The private Ed25519 release key lives OFF the backend and build box (operator
workstation / hardware token). This tool runs on that machine to:

  --gen-key   generate a keypair (private key file + printed public-key hex)
  --sign      build RELEASE_MANIFEST.json from the satellite source + sign it
  --verify    re-derive the manifest and check it matches + the signature verifies

The signed manifest (RELEASE_MANIFEST.json + .sig) is committed under
src/satellite/ and baked into the backend image; the backend forwards it in the
OTA update_request; satellites verify it against pinned public keys (in
group_vars) before install. The backend NEVER holds the private key.

Usage:
    python bin/sign_satellite_release.py --gen-key --out ~/.renfield/ota_release_key
    python bin/sign_satellite_release.py --sign --key ~/.renfield/ota_release_key
    python bin/sign_satellite_release.py --verify --pubkey <hex>     # CI / pre-build check
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
_SATELLITE_SRC = _REPO / "src" / "satellite"
sys.path.insert(0, str(_SATELLITE_SRC))

from renfield_satellite.update.release_manifest import (  # noqa: E402
    MANIFEST_FILENAME,
    SIGNATURE_FILENAME,
    build_manifest,
    canonical_bytes,
    verify_signature,
)

_VERSION_RE = re.compile(r'^__version__\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)


def _read_version(source_root: Path) -> str:
    init = source_root / "renfield_satellite" / "__init__.py"
    m = _VERSION_RE.search(init.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"❌ could not read __version__ from {init}")
    return m.group(1)


def _load_private_key(key_path: Path):
    from cryptography.hazmat.primitives.asymmetric import ed25519

    raw = bytes.fromhex(key_path.read_text(encoding="utf-8").strip())
    if len(raw) != 32:
        raise SystemExit("❌ key file is not a 32-byte (64-hex) Ed25519 private key")
    return ed25519.Ed25519PrivateKey.from_private_bytes(raw)


def _gen_key(out: Path) -> int:
    from cryptography.hazmat.primitives.asymmetric import ed25519

    if out.exists():
        raise SystemExit(f"❌ refusing to overwrite existing key: {out}")
    priv = ed25519.Ed25519PrivateKey.generate()
    raw = priv.private_bytes_raw()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(raw.hex(), encoding="utf-8")
    os.chmod(out, 0o600)
    pub_hex = priv.public_key().public_bytes_raw().hex()
    print(f"✅ private key written (chmod 600): {out}", file=sys.stderr)
    print("   Add this PUBLIC key to group_vars satellite_release_pubkeys:", file=sys.stderr)
    print(pub_hex)
    return 0


def _sign(source_root: Path, key_path: Path) -> int:
    priv = _load_private_key(key_path)
    version = _read_version(source_root)
    manifest = build_manifest(source_root, version)
    body = canonical_bytes(manifest)
    sig = base64.b64encode(priv.sign(body)).decode("ascii")

    (source_root / MANIFEST_FILENAME).write_bytes(body)
    (source_root / SIGNATURE_FILENAME).write_text(sig + "\n", encoding="utf-8")
    pub_hex = priv.public_key().public_bytes_raw().hex()
    print(f"✅ signed release v{version}: {len(manifest['files'])} files", file=sys.stderr)
    print(f"   wrote {MANIFEST_FILENAME} + {SIGNATURE_FILENAME} under {source_root}", file=sys.stderr)
    print(f"   public key: {pub_hex}", file=sys.stderr)
    print("   Commit both files; verify the pubkey is in group_vars before release.", file=sys.stderr)
    return 0


def _verify(source_root: Path, pubkey_hex: str | None) -> int:
    manifest_path = source_root / MANIFEST_FILENAME
    sig_path = source_root / SIGNATURE_FILENAME
    if not manifest_path.exists() or not sig_path.exists():
        raise SystemExit(f"❌ {MANIFEST_FILENAME}/.sig missing under {source_root} — run --sign")

    committed_bytes = manifest_path.read_bytes()
    version = _read_version(source_root)
    fresh = canonical_bytes(build_manifest(source_root, version))
    if fresh != committed_bytes:
        raise SystemExit(
            "❌ committed RELEASE_MANIFEST.json does NOT match the current source "
            "(source changed without re-signing). Re-run --sign."
        )

    if pubkey_hex:
        sig = sig_path.read_text(encoding="utf-8").strip()
        if not verify_signature(committed_bytes, sig, [pubkey_hex]):
            raise SystemExit("❌ signature does NOT verify under the provided public key")
        print(f"✅ manifest matches source AND signature verifies (v{version})", file=sys.stderr)
    else:
        print(f"✅ manifest matches source (v{version}); pass --pubkey to also check the signature", file=sys.stderr)
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Sign/verify the satellite OTA release manifest")
    ap.add_argument("--source", default=str(_SATELLITE_SRC), help="satellite source root")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--gen-key", action="store_true")
    g.add_argument("--sign", action="store_true")
    g.add_argument("--verify", action="store_true")
    ap.add_argument("--key", help="private key file (for --sign)")
    ap.add_argument("--out", help="output key path (for --gen-key)")
    ap.add_argument("--pubkey", help="public key hex (for --verify)")
    args = ap.parse_args()

    source_root = Path(args.source).resolve()
    if args.gen_key:
        if not args.out:
            raise SystemExit("❌ --gen-key requires --out")
        raise SystemExit(_gen_key(Path(args.out).expanduser()))
    if args.sign:
        if not args.key:
            raise SystemExit("❌ --sign requires --key")
        raise SystemExit(_sign(source_root, Path(args.key).expanduser()))
    if args.verify:
        raise SystemExit(_verify(source_root, args.pubkey))


if __name__ == "__main__":
    main()
