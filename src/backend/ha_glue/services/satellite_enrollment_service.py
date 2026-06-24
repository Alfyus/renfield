"""Per-satellite enrollment credential service (security review H1, full fix).

A satellite proves its identity by presenting a random 256-bit PSK in its
register frame; the backend verifies it constant-time against the bcrypt hash
stored in the ``satellites`` table. This replaces the assertion-based trust
where any LAN device could register as any ``satellite_id``.

Effective-mode state machine (see docs/private/security/satellite-trust-design.md):

- ``satellite_enrollment_enabled=False`` (default): legacy — no PSK checks.
- enabled, not enforcing (PERMISSIVE): a presented PSK is verified; a wrong /
  unknown / revoked credential is rejected; NO credential is allowed (legacy
  soak) but flagged unenrolled.
- ENFORCING (auto-flip latched): a missing/invalid credential is rejected.

The module exposes pure helpers (no singleton); the WS handler and the admin
routes pass in an ``AsyncSession``.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Satellite, SatelliteFleetState
from services.auth_service import pwd_context
from utils.config import settings

# Verdicts from evaluating a presented credential.
VERDICT_OK = "ok"            # valid PSK → authenticated
VERDICT_NO_TOKEN = "no_token"  # no PSK presented (legacy / unenrolled)
VERDICT_BAD = "bad"          # PSK presented but invalid / unknown / revoked

_FLEET_STATE_ID = 1


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def enrollment_enabled() -> bool:
    return bool(settings.satellite_enrollment_enabled)


def generate_enrollment_token() -> str:
    """A random 256-bit URL-safe PSK (shown to the operator exactly once)."""
    return secrets.token_urlsafe(32)


async def enroll_satellite(
    db: AsyncSession,
    satellite_id: str,
    *,
    enrolled_by_user_id: int | None = None,
    room: str | None = None,
    rotate: bool = False,
) -> str | None:
    """Create (or rotate) a satellite enrollment and return the plaintext PSK.

    Returns the PSK on success, or ``None`` if the satellite is already enrolled
    and ``rotate`` is False (the caller maps that to HTTP 409).
    """
    existing = (
        await db.execute(select(Satellite).where(Satellite.satellite_id == satellite_id))
    ).scalar_one_or_none()

    token = generate_enrollment_token()
    token_hash = pwd_context.hash(token)

    if existing is not None:
        active = existing.is_enabled and existing.revoked_at is None
        if active and not rotate:
            return None
        # Rotate / re-activate: issue a fresh PSK, reset auth state so the
        # satellite must re-authenticate (and the auto-flip latch reflects it).
        existing.token_hash = token_hash
        existing.is_enabled = True
        existing.revoked_at = None
        existing.last_authenticated_at = None
        if room is not None:
            existing.room = room
        if enrolled_by_user_id is not None:
            existing.enrolled_by_user_id = enrolled_by_user_id
        existing.enrolled_at = _utcnow()
        await db.commit()
        logger.info(f"🔐 Satellite enrollment rotated: {satellite_id}")
        return token

    row = Satellite(
        satellite_id=satellite_id,
        token_hash=token_hash,
        room=room,
        enrolled_by_user_id=enrolled_by_user_id,
        enrolled_at=_utcnow(),
        is_enabled=True,
    )
    db.add(row)
    await db.commit()
    logger.info(f"🔐 Satellite enrolled: {satellite_id}")
    return token


async def revoke_satellite(db: AsyncSession, satellite_id: str) -> bool:
    """Revoke a satellite's enrollment. Returns False if not found."""
    row = (
        await db.execute(select(Satellite).where(Satellite.satellite_id == satellite_id))
    ).scalar_one_or_none()
    if row is None:
        return False
    row.is_enabled = False
    row.revoked_at = _utcnow()
    await db.commit()
    logger.warning(f"🔒 Satellite enrollment revoked: {satellite_id}")
    return True


async def evaluate_credential(db: AsyncSession, satellite_id: str, psk: str | None) -> str:
    """Verify a presented PSK against the enrolled hash (constant-time).

    On a valid credential, stamps ``last_authenticated_at`` and commits.
    Returns one of the ``VERDICT_*`` constants.
    """
    if not psk:
        return VERDICT_NO_TOKEN

    row = (
        await db.execute(select(Satellite).where(Satellite.satellite_id == satellite_id))
    ).scalar_one_or_none()

    if row is None or not row.is_enabled or row.revoked_at is not None:
        # Burn a hash comparison so a missing/revoked row isn't a timing oracle
        # for whether a given satellite_id is enrolled. Guarded — dummy_verify is
        # best-effort hardening, never load-bearing for correctness.
        try:
            pwd_context.dummy_verify()
        except Exception:  # noqa: BLE001
            pass
        return VERDICT_BAD

    if not pwd_context.verify(psk, row.token_hash):
        return VERDICT_BAD

    row.last_authenticated_at = _utcnow()
    await db.commit()
    return VERDICT_OK


async def _get_or_create_fleet_state(db: AsyncSession) -> SatelliteFleetState:
    state = (
        await db.execute(
            select(SatelliteFleetState).where(SatelliteFleetState.id == _FLEET_STATE_ID)
        )
    ).scalar_one_or_none()
    if state is None:
        state = SatelliteFleetState(id=_FLEET_STATE_ID)
        db.add(state)
        await db.flush()
    return state


async def is_enforcing(db: AsyncSession) -> bool:
    """Whether the fleet is in ENFORCING mode (the latch is set)."""
    if not enrollment_enabled():
        return False
    state = (
        await db.execute(
            select(SatelliteFleetState).where(SatelliteFleetState.id == _FLEET_STATE_ID)
        )
    ).scalar_one_or_none()
    return bool(state and state.enrollment_enforced_at is not None)


async def maybe_autoflip(db: AsyncSession) -> bool:
    """Latch ENFORCING once every enrolled satellite has authenticated.

    Sets ``enrollment_enforced_at`` (idempotent, never cleared) when
    ``satellite_enrollment_autoflip_enabled`` is on AND there is ≥1 enrolled
    satellite AND none of them has a NULL ``last_authenticated_at``. Returns
    True if it flipped on this call.
    """
    if not (enrollment_enabled() and settings.satellite_enrollment_autoflip_enabled):
        return False

    state = await _get_or_create_fleet_state(db)
    if state.enrollment_enforced_at is not None:
        return False  # already latched

    # Count active (non-revoked) enrolled satellites and how many have never
    # authenticated. The fleet is "ready" only when there are some and all have.
    total = (
        await db.execute(
            select(func.count())
            .select_from(Satellite)
            .where(Satellite.is_enabled.is_(True), Satellite.revoked_at.is_(None))
        )
    ).scalar_one()
    if not total:
        return False
    pending = (
        await db.execute(
            select(func.count())
            .select_from(Satellite)
            .where(
                Satellite.is_enabled.is_(True),
                Satellite.revoked_at.is_(None),
                Satellite.last_authenticated_at.is_(None),
            )
        )
    ).scalar_one()
    if pending:
        return False

    state.enrollment_enforced_at = _utcnow()
    await db.commit()
    logger.warning(
        f"🔒 Satellite enrollment auto-flip: ENFORCING (all {total} enrolled "
        f"satellites have authenticated). Unenrolled satellites are now rejected."
    )
    return True


@dataclass
class AuthorizeResult:
    authenticated: bool  # presented a valid PSK → eligible for IRK push
    reject: bool         # connection must be closed
    reason: str


async def authorize_register(db: AsyncSession, satellite_id: str, psk: str | None) -> AuthorizeResult:
    """Decide whether a register frame is allowed, per the effective mode."""
    if not enrollment_enabled():
        return AuthorizeResult(False, False, "enrollment-disabled")

    verdict = await evaluate_credential(db, satellite_id, psk)
    if verdict == VERDICT_OK:
        await maybe_autoflip(db)
        return AuthorizeResult(True, False, "authenticated")
    if verdict == VERDICT_BAD:
        # A presented-but-invalid credential is always rejected — that is not
        # legacy behavior, it is an attack or a misconfigured device.
        return AuthorizeResult(False, True, "invalid-credential")
    # VERDICT_NO_TOKEN
    if await is_enforcing(db):
        return AuthorizeResult(False, True, "enrollment-required")
    logger.warning(
        f"⚠️ Satellite '{satellite_id}' registered WITHOUT an enrollment token "
        f"(PERMISSIVE soak). Enroll it before enabling auto-flip enforcement."
    )
    return AuthorizeResult(False, False, "unenrolled-permissive")
