"""Add memory_v2_shadow_log table for Lane B/2 Phase A shadow-mode validation.

Revision ID: q1r2s3t4u5v6
Revises: pc20260511_wb_long
Create Date: 2026-05-14 18:00:00.000000

Records every turn the extract_and_save dispatcher routes through
v2-shadow mode. Stores both v1's outcome (committed, what the user
saw) and v2's outcome (rolled back via savepoint, what would have
been written). The daily diff report against this table is the
quantitative signal that gates the Phase B flip
(`memory_extraction_v2_authoritative=True`).

No FKs into this table — it's a write-only observability substrate;
pruning happens via a one-shot SQL after the Phase B flip lands, not
via cascade.

Indexes:
  - (created_at) for daily-diff windowing
  - (user_id, created_at) for per-user comparisons
  - (session_id) mirrors the ORM `index=True` on the column
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "q1r2s3t4u5v6"
down_revision = "pc20260511_wb_long"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `if_not_exists=True` is the idempotency guard. Avoids the
    # stale-inspector-snapshot anti-pattern where checks reading from
    # `sa.inspect(bind)` see a pre-DDL view of the schema even after
    # the create_table fires within the same upgrade.
    op.create_table(
        "memory_v2_shadow_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("session_id", sa.String(255), nullable=True),
        sa.Column("lang", sa.String(10), nullable=True),
        # v1 (authoritative)
        sa.Column("v1_outcome", sa.String(20), nullable=True),
        sa.Column("v1_extracted_count", sa.Integer(), nullable=True),
        sa.Column("v1_latency_seconds", sa.Float(), nullable=True),
        # v2 (rolled back, observed only)
        sa.Column("v2_outcome", sa.String(20), nullable=True),
        sa.Column("v2_ops_json", sa.Text(), nullable=True),
        sa.Column("v2_extracted_count", sa.Integer(), nullable=True),
        sa.Column("v2_fallback_reason", sa.String(40), nullable=True),
        sa.Column("v2_latency_seconds", sa.Float(), nullable=True),
        sa.Column("v2_error", sa.String(80), nullable=True),
        if_not_exists=True,
    )

    op.create_index(
        "idx_memv2sl_created_at", "memory_v2_shadow_log", ["created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_memv2sl_user_created", "memory_v2_shadow_log", ["user_id", "created_at"],
        if_not_exists=True,
    )
    # Mirrors the ORM `index=True` on session_id — without this the
    # ORM/migration schemas drift (detectable by `alembic check`).
    op.create_index(
        "idx_memv2sl_session_id", "memory_v2_shadow_log", ["session_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    for idx_name in (
        "idx_memv2sl_session_id",
        "idx_memv2sl_user_created",
        "idx_memv2sl_created_at",
    ):
        op.drop_index(idx_name, table_name="memory_v2_shadow_log", if_exists=True)
    op.drop_table("memory_v2_shadow_log", if_exists=True)
