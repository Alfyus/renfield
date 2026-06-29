"""Multilingual FTS + obligation index on document_facts.

Revision ID: pc20260602_df_fts
Revises: pc20260601_document_facts
Create Date: 2026-05-31 00:00:00.000000

Makes Schicht A ``document_facts`` readable. The table shipped write-only in
pc20260601; this migration adds the lookup surface that
``DocumentFactRetrieval`` queries:

  1. ``search_vector`` — a GENERATED STORED ``tsvector`` unioning
     ``to_tsvector`` across all ``services/fts_languages.FTS_LANGUAGES``
     (DE / EN / FR / IT / ES / NL) over
     ``value || normalized_value || excerpt || kind``. Self-maintaining for
     every existing AND future row; READ-ONLY from the app (the ORM column
     carries ``FetchedValue()`` so it never appears in INSERT/UPDATE — writes
     to a GENERATED column raise).
  2. GIN index on ``search_vector`` for the FTS read path.
  3. Partial index on ``obligation_date`` for the ``obligations()`` agenda
     query (``category='obligation' AND obligation_date IS NOT NULL``).

Pattern: simple DROP-IF-EXISTS-then-ADD (mirrors pc20260528, NOT the
atomic-swap of pc20260529) — ``document_facts`` has no pre-existing
``search_vector`` column and is a small, slow-growing table (a handful of
facts per document), so the zero-downtime swap is unnecessary. The
DROP IF EXISTS guards re-run after a mid-migration kill.

The GIN index is built CONCURRENTLY inside ``op.get_context().autocommit_block()``,
which works because ``env.py`` runs with ``transaction_per_migration=True``
(PR #625). Each migration commits independently, so a mid-chain failure
leaves preceding steps applied — the DROP IF EXISTS / CREATE IF NOT EXISTS
guards make every step idempotent on re-run.
"""
from alembic import op

from services.fts_languages import build_generated_tsvector_expression


revision = "pc20260602_df_fts"
down_revision = "pc20260601_document_facts"
branch_labels = None
depends_on = None


_GIN_INDEX = "idx_document_facts_search_vector_gin"
_OBLIGATION_INDEX = "idx_document_facts_obligation_due"

# value and kind are NOT NULL; normalized_value and excerpt are nullable, so
# they get their own coalesce inside the concatenation. The outer coalesce
# added by build_generated_tsvector_expression is harmless (the concat is
# never NULL given the NOT NULL anchors). `||` and `coalesce` are both
# IMMUTABLE, so the whole expression is accepted in GENERATED ALWAYS AS.
_CONTENT_EXPR = (
    "value || ' ' || coalesce(normalized_value, '') || ' ' || "
    "coalesce(excerpt, '') || ' ' || kind"
)


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"
    if dialect != "postgresql":
        # Sqlite test harness has no tsvector / partial-index-with-predicate
        # support; DocumentFactRetrieval's sqlite branch uses a LIKE fallback
        # and never touches search_vector. Skip silently.
        return

    # 1. GENERATED multilingual search_vector. Postgres populates it from the
    #    existing rows at column-add time. DROP IF EXISTS first so a re-run
    #    after a partial failure doesn't trip "column already exists".
    tsvector_expr = build_generated_tsvector_expression(_CONTENT_EXPR)
    op.execute("ALTER TABLE document_facts DROP COLUMN IF EXISTS search_vector")
    op.execute(
        f"ALTER TABLE document_facts "
        f"ADD COLUMN search_vector tsvector "
        f"GENERATED ALWAYS AS ({tsvector_expr}) STORED"
    )

    # 2. GIN index for the FTS read path, built CONCURRENTLY (no table lock).
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_GIN_INDEX}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY {_GIN_INDEX} "
            f"ON document_facts USING gin (search_vector)"
        )

        # 3. Partial index for the obligations() agenda query. Only obligation
        #    rows with a printed Frist participate, so the index stays tiny.
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_OBLIGATION_INDEX}")
        op.execute(
            f"CREATE INDEX CONCURRENTLY {_OBLIGATION_INDEX} "
            f"ON document_facts (obligation_date) "
            f"WHERE category = 'obligation' AND obligation_date IS NOT NULL"
        )

    # 4. Refresh planner stats — the new column + indexes have no scan history
    #    yet, so the planner has no selectivity estimate until autovacuum
    #    catches up. Cheap on the small facts corpus.
    op.execute("ANALYZE document_facts")


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else "postgresql"
    if dialect != "postgresql":
        return

    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_OBLIGATION_INDEX}")
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_GIN_INDEX}")
    op.execute("ALTER TABLE document_facts DROP COLUMN IF EXISTS search_vector")
