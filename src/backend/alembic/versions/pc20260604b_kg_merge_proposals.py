"""Structured Memory Phase 1 (T5): kg_merge_proposals review queue.

Revision ID: pc20260604b_kgmp
Revises: pc20260604_struct_mem
Create Date: 2026-06-04 00:30:00.000000

The background reconciler auto-merges only same-tier high-confidence duplicates;
cross-tier and gray-zone pairs land in this queue for owner review (D3).

PG-only (the sqlite test harness builds the table via create_all from the ORM
model). Rerunnable: CREATE TABLE/INDEX IF NOT EXISTS.
"""
from alembic import op


revision = "pc20260604b_kgmp"
down_revision = "pc20260604_struct_mem"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if (bind.dialect.name if bind is not None else "postgresql") != "postgresql":
        return

    op.execute("""
        CREATE TABLE IF NOT EXISTS kg_merge_proposals (
            id                  serial PRIMARY KEY,
            user_id             integer REFERENCES users(id),
            loser_entity_id     integer NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
            winner_entity_id    integer NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
            similarity          double precision NOT NULL DEFAULT 0.0,
            loser_tier          integer NOT NULL DEFAULT 0,
            winner_tier         integer NOT NULL DEFAULT 0,
            reason              varchar(30) NOT NULL DEFAULT 'cross_tier',
            status              varchar(20) NOT NULL DEFAULT 'pending',
            created_at          timestamp without time zone DEFAULT now(),
            resolved_at         timestamp without time zone,
            resolved_by_user_id integer REFERENCES users(id)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kg_merge_proposals_user_status "
        "ON kg_merge_proposals (user_id, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kg_merge_proposals_status "
        "ON kg_merge_proposals (status)"
    )
    # At most one PENDING proposal per ordered (loser, winner) pair — the
    # reconciler relies on this to stay idempotent across runs.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_kg_merge_proposals_pending_pair "
        "ON kg_merge_proposals (loser_entity_id, winner_entity_id) "
        "WHERE status = 'pending'"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if (bind.dialect.name if bind is not None else "postgresql") != "postgresql":
        return
    op.execute("DROP TABLE IF EXISTS kg_merge_proposals")
