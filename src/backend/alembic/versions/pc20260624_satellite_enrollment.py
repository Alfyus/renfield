"""per-satellite enrollment credential (satellites + satellite_fleet_state)

Revision ID: pc20260624_satellite_enrollment
Revises: pc20260619_ble_irk_store
Create Date: 2026-06-24

Security review H1 (full fix): bind every /ws/satellite connection to a
per-satellite enrollment PSK instead of an asserted satellite_id string.

- ``satellites``: one row per enrolled satellite. ``token_hash`` is a bcrypt
  hash of the PSK (never the plaintext). ``last_authenticated_at`` drives the
  auto-flip readiness check.
- ``satellite_fleet_state``: singleton (id=1) holding the enforcement latch
  (``enrollment_enforced_at``). Latched once, never auto-cleared, so a later
  UI-enrolled-but-not-yet-connected satellite can't re-open the fleet.

Fully transactional. Chains off the real head ``pc20260619_ble_irk_store``.
Verify ``alembic heads`` and apply TARGETED (``alembic upgrade
pc20260624_satellite_enrollment``) rather than ``upgrade head`` — prod has
historically carried multiple alembic heads, so a targeted apply is the safe
default. See docs/private/security/satellite-trust-design.md.
"""
import sqlalchemy as sa
from alembic import op

revision = "pc20260624_satellite_enrollment"
down_revision = "pc20260619_ble_irk_store"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "satellites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("satellite_id", sa.String(length=100), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        sa.Column("room", sa.String(length=100), nullable=True),
        sa.Column("enrolled_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("enrolled_at", sa.DateTime(), nullable=True),
        sa.Column("last_authenticated_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_satellites_satellite_id", "satellites", ["satellite_id"], unique=True)

    op.create_table(
        "satellite_fleet_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enrollment_enforced_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    # Pre-seed the singleton row so the runtime never races to INSERT id=1
    # (two satellites authenticating concurrently across pods would otherwise
    # both INSERT → IntegrityError). The latch starts un-set (NULL).
    op.execute("INSERT INTO satellite_fleet_state (id, enrollment_enforced_at) VALUES (1, NULL)")


def downgrade() -> None:
    op.drop_table("satellite_fleet_state")
    op.drop_index("ix_satellites_satellite_id", table_name="satellites")
    op.drop_table("satellites")
