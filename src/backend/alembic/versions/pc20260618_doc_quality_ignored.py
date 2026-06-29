"""documents.quality_ignored — operator flag to skip low-quality-OCR cleanup

Revision ID: pc20260618_doc_quality_ignored
Revises: pc20260617b_drop_outlegacy
Create Date: 2026-06-18

Adds ``documents.quality_ignored``: a boolean the operator sets from the
Paperless Audit page's "low-quality OCR" tab to mark a document as deliberately
ignored, so it is skipped by the periodic low-quality-chunk cleanup
(``bin/purge_low_quality_chunks.py``) and can be filtered out of the audit UI.

Additive + NOT NULL with a ``false`` server default, so existing rows backfill
to "not ignored" without a separate UPDATE. Fully transactional (no
CONCURRENTLY).
"""
from alembic import op
import sqlalchemy as sa


revision = "pc20260618_doc_quality_ignored"
down_revision = "pc20260617b_drop_outlegacy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column(
            "quality_ignored",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("documents", "quality_ignored")
