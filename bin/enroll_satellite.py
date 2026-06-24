#!/usr/bin/env python3
"""Mint (or rotate) a per-satellite enrollment PSK (security review H1).

Seeds the `satellites` table (stores only the bcrypt hash) and prints the
plaintext token EXACTLY ONCE. Provision the printed token to the satellite:

- bare-metal: paste into the gitignored host_vars/satellite-<name>.yml as
  `satellite_enrollment_token`, then re-provision with `--tags config`.
- k8s: `kubectl -n renfield create secret generic satellite-<room>-secret
  --from-literal=enrollment-token=<TOKEN>`.

This is the same code path the admin UI (`POST /api/satellite-enrollment/enroll`)
uses — either works; this script is for Ansible/headless operators.

Usage:
    python bin/enroll_satellite.py sat-wohnzimmer --room Wohnzimmer
    python bin/enroll_satellite.py sat-wohnzimmer --rotate   # re-issue a fresh PSK
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent / "src" / "backend"
sys.path.insert(0, str(_BACKEND))

from services.database import AsyncSessionLocal  # noqa: E402
import ha_glue.services.satellite_enrollment_service as enroll_svc  # noqa: E402


async def _run(satellite_id: str, room: str | None, rotate: bool) -> int:
    async with AsyncSessionLocal() as db:
        token = await enroll_svc.enroll_satellite(
            db, satellite_id, room=room, rotate=rotate
        )
    if token is None:
        print(
            f"❌ '{satellite_id}' is already enrolled. Re-run with --rotate to "
            f"issue a fresh token (invalidates the old one).",
            file=sys.stderr,
        )
        return 2
    verb = "rotated" if rotate else "enrolled"
    print(f"✅ Satellite {verb}: {satellite_id}", file=sys.stderr)
    print("   Provision this token to the satellite (shown once):", file=sys.stderr)
    print(token)  # stdout only → easy to capture: TOKEN=$(bin/enroll_satellite.py ...)
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Mint/rotate a satellite enrollment PSK")
    ap.add_argument("satellite_id", help="e.g. sat-wohnzimmer")
    ap.add_argument("--room", default=None, help="optional cosmetic room label")
    ap.add_argument("--rotate", action="store_true", help="re-issue for an already-enrolled satellite")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(_run(args.satellite_id, args.room, args.rotate)))


if __name__ == "__main__":
    main()
