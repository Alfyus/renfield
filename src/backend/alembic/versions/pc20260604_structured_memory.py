"""Structured Memory Phase 0: KG canonicalization + multi-type + provenance + memory subject.

Revision ID: pc20260604_struct_mem
Revises: pc20260602_df_fts
Create Date: 2026-06-04 00:00:00.000000

Phase 0 of the Structured-Memory program (tasks/structured-memory-plan.md).
Additive schema only — no behavior change until Phase 1/2 wire the columns.

kg_entities:
  - canonical_id     self-FK (SET NULL). NULL == canonical/live; non-NULL ==
                     merge tombstone -> surviving entity (mirrors
                     procedural_skills.merged_into_id).
  - surface_forms    JSONB '[]'  absorbed alternate spellings on the canonical row.
  - entity_types     JSONB '[]'  multi-type superset; backfilled to [entity_type].
                     The scalar entity_type stays PRIMARY (back-compat).
  - external_id      VARCHAR(64) optional external grounding (column only).
  - GIN(surface_forms jsonb_path_ops) for the per-turn surface-form probe.

kg_relations:
  - stated_by_user_id  FK users — who ASSERTED the fact (provenance), != owner.
  - source_message_id  FK messages — the message it was extracted from.

conversation_memories (D9 — the visible-bug fix, pulled forward from Phase 3):
  - subject_entity_id  FK kg_entities (SET NULL) — WHO the fact is about.
  - subject_name       VARCHAR(255) — raw subject name when no entity resolves.

HNSW note: a halfvec(2560) HNSW index on kg_entities.embedding already exists
(idx_kg_entities_embedding_hnsw). The eng-review D7 correction is to make the
resolution query CAST to ::halfvec so it USES that index (a Phase-1 code change,
T4), NOT to create a second index. No HNSW DDL here.

Pattern: PG-only (the sqlite test harness builds these columns via create_all
from the ORM model). Column adds use ADD COLUMN IF NOT EXISTS and indexes use
IF NOT EXISTS / DROP CONCURRENTLY IF EXISTS so a mid-chain kill is re-runnable.
The GIN index builds CONCURRENTLY inside autocommit_block (env.py runs
transaction_per_migration=True, PR #625).
"""
from alembic import op


revision = "pc20260604_struct_mem"
down_revision = "pc20260602_df_fts"
branch_labels = None
depends_on = None


_GIN_SURFACE_FORMS = "idx_kg_entities_surface_forms_gin"


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"
    if dialect != "postgresql":
        # sqlite test harness gets these columns via Base.metadata.create_all
        # from the ORM model; JSONB/GIN/jsonb_build_array are PG-only.
        return

    # --- 1. kg_entities columns (FKs inline so the constraint lands too) ---
    op.execute(
        "ALTER TABLE kg_entities "
        "ADD COLUMN IF NOT EXISTS canonical_id integer "
        "REFERENCES kg_entities(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE kg_entities "
        "ADD COLUMN IF NOT EXISTS surface_forms jsonb NOT NULL DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE kg_entities "
        "ADD COLUMN IF NOT EXISTS entity_types jsonb NOT NULL DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE kg_entities ADD COLUMN IF NOT EXISTS external_id varchar(64)"
    )

    # Backfill multi-type from the existing scalar type (only rows still at the
    # default empty array — keeps the migration idempotent on re-run).
    op.execute(
        "UPDATE kg_entities "
        "SET entity_types = jsonb_build_array(entity_type) "
        "WHERE entity_types = '[]'::jsonb"
    )

    # --- 2. kg_relations provenance columns ---
    op.execute(
        "ALTER TABLE kg_relations "
        "ADD COLUMN IF NOT EXISTS stated_by_user_id integer REFERENCES users(id)"
    )
    op.execute(
        "ALTER TABLE kg_relations "
        "ADD COLUMN IF NOT EXISTS source_message_id integer REFERENCES messages(id)"
    )

    # --- 3. conversation_memories subject attribution (D9) ---
    op.execute(
        "ALTER TABLE conversation_memories "
        "ADD COLUMN IF NOT EXISTS subject_entity_id integer "
        "REFERENCES kg_entities(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE conversation_memories "
        "ADD COLUMN IF NOT EXISTS subject_name varchar(255)"
    )

    # --- 4. plain btree indexes for the new FK / lookup columns ---
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kg_entities_canonical_id "
        "ON kg_entities (canonical_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kg_entities_external_id "
        "ON kg_entities (external_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kg_relations_stated_by_user_id "
        "ON kg_relations (stated_by_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_conversation_memories_subject_entity_id "
        "ON conversation_memories (subject_entity_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_conversation_memories_subject_name "
        "ON conversation_memories (subject_name)"
    )

    # --- 5. GIN on surface_forms for the per-turn surface-form match probe ---
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_GIN_SURFACE_FORMS}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY {_GIN_SURFACE_FORMS} "
            f"ON kg_entities USING gin (surface_forms jsonb_path_ops)"
        )

    op.execute("ANALYZE kg_entities")


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"
    if dialect != "postgresql":
        return

    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_GIN_SURFACE_FORMS}")

    op.execute("DROP INDEX IF EXISTS ix_conversation_memories_subject_name")
    op.execute("DROP INDEX IF EXISTS ix_conversation_memories_subject_entity_id")
    op.execute("DROP INDEX IF EXISTS ix_kg_relations_stated_by_user_id")
    op.execute("DROP INDEX IF EXISTS ix_kg_entities_external_id")
    op.execute("DROP INDEX IF EXISTS ix_kg_entities_canonical_id")

    op.execute("ALTER TABLE conversation_memories DROP COLUMN IF EXISTS subject_name")
    op.execute("ALTER TABLE conversation_memories DROP COLUMN IF EXISTS subject_entity_id")
    op.execute("ALTER TABLE kg_relations DROP COLUMN IF EXISTS source_message_id")
    op.execute("ALTER TABLE kg_relations DROP COLUMN IF EXISTS stated_by_user_id")
    op.execute("ALTER TABLE kg_entities DROP COLUMN IF EXISTS external_id")
    op.execute("ALTER TABLE kg_entities DROP COLUMN IF EXISTS entity_types")
    op.execute("ALTER TABLE kg_entities DROP COLUMN IF EXISTS surface_forms")
    op.execute("ALTER TABLE kg_entities DROP COLUMN IF EXISTS canonical_id")
