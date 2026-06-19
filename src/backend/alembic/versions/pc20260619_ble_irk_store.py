"""per-person BLE IRK store (user_ble_irks)

Revision ID: pc20260619_ble_irk_store
Revises: pc20260618_message_branching
Create Date: 2026-06-19

Stores per-person BLE Identity Resolving Keys (encrypted at rest) used to
resolve rotating RPAs to a stable identity for presence. See
docs/design/ble-presence-improvement.md.
"""
import sqlalchemy as sa
from alembic import op

revision = "pc20260619_ble_irk_store"
down_revision = "pc20260618_message_branching"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_ble_irks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("irk_encrypted", sa.String(length=255), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_user_ble_irks_user_id", "user_ble_irks", ["user_id"])
    op.create_index("ix_user_ble_irks_label", "user_ble_irks", ["label"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_ble_irks_label", table_name="user_ble_irks")
    op.drop_index("ix_user_ble_irks_user_id", table_name="user_ble_irks")
    op.drop_table("user_ble_irks")
