"""message branching (edit-and-fork, Phase 1)

Revision ID: pc20260618_message_branching
Revises: pc20260618_doc_quality_ignored
Create Date: 2026-06-18

Chat message branching, Phase 1. Adds the conversation tree:

  * ``messages.parent_message_id`` — nullable self-FK (ON DELETE CASCADE) to the
    message immediately preceding this one on its branch (NULL = conversation
    root). Indexed (backs the recursive active-path walk).
  * ``conversations.active_leaf_message_id`` — nullable FK to ``messages.id``
    (ON DELETE SET NULL), the tip of the active branch. The active path is the
    recursive walk of ``parent_message_id`` upward from this leaf. SET NULL is
    required because a conversation delete cascade-deletes its messages first —
    without it the conversation row would still reference a deleted leaf and the
    DELETE would raise an FK violation on Postgres.

The self-FK + the conversation→message FK form a cycle at CREATE time, but both
tables already exist here, so we add the columns and constraints with plain
``add_column`` / ``create_foreign_key`` after the fact — no circular-create
problem.

BACKFILL (the riskiest part — reviewer please scrutinize): every existing
conversation is linearized. For each conversation, its messages are ordered by
``(timestamp ASC, id ASC)`` and each message's ``parent_message_id`` is set to
the id of the message immediately before it (the first stays NULL); the
conversation's ``active_leaf_message_id`` is set to the id of its last message.
This reproduces the EXACT current history order (``/api/chat/history`` orders by
the same ``timestamp ASC`` — id is the stable tiebreaker for equal timestamps),
so once the active-path CTE replaces the flat select, a linear (un-forked)
conversation renders byte-identical. Implemented as two window-function UPDATEs
(set-based, idempotent, safe on a few thousand rows). Re-running the upgrade body
on already-backfilled data yields the same result (it recomputes from
timestamp/id ordering, which is immutable).

Fully transactional (nullable ADD COLUMN is metadata-only on Postgres; the
window UPDATEs and FK/index creation are ordinary DDL/DML).
"""
from alembic import op
import sqlalchemy as sa


revision = "pc20260618_message_branching"
down_revision = "pc20260618_doc_quality_ignored"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Columns + index + FK constraints (both tables already exist).
    op.add_column(
        "messages",
        sa.Column("parent_message_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("active_leaf_message_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_messages_parent_message_id",
        "messages",
        ["parent_message_id"],
    )
    op.create_foreign_key(
        "fk_messages_parent_message_id",
        "messages",
        "messages",
        ["parent_message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # ON DELETE SET NULL: a conversation delete cascade-deletes its messages
    # (the ORM relationship cascade), so the leaf pointer must clear itself as
    # those rows go — else the conversation row still references a deleted leaf
    # and the DELETE raises an FK violation on Postgres.
    op.create_foreign_key(
        "fk_conversations_active_leaf_message_id",
        "conversations",
        "messages",
        ["active_leaf_message_id"],
        ["id"],
        ondelete="SET NULL",
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # Sqlite test harness: window-function UPDATE + ALTER ADD-CONSTRAINT
        # semantics differ and the test suite seeds its own tree explicitly.
        # Schema (the columns) is enough there; skip the backfill DML.
        return

    # 2a. parent_message_id = id of the previous message in (timestamp, id) order
    #     within the same conversation. First message stays NULL.
    op.execute(sa.text("""
        WITH ordered AS (
            SELECT
                id,
                LAG(id) OVER (
                    PARTITION BY conversation_id
                    ORDER BY timestamp ASC, id ASC
                ) AS prev_id
            FROM messages
        )
        UPDATE messages m
        SET parent_message_id = ordered.prev_id
        FROM ordered
        WHERE m.id = ordered.id
          AND ordered.prev_id IS NOT NULL
    """))

    # 2b. active_leaf_message_id = id of the last (most recent) message in each
    #     conversation by the same ordering.
    op.execute(sa.text("""
        WITH last_msg AS (
            SELECT DISTINCT ON (conversation_id)
                conversation_id,
                id AS leaf_id
            FROM messages
            ORDER BY conversation_id, timestamp DESC, id DESC
        )
        UPDATE conversations c
        SET active_leaf_message_id = last_msg.leaf_id
        FROM last_msg
        WHERE c.id = last_msg.conversation_id
    """))


def downgrade() -> None:
    # Drop FK on conversations first (it references messages), then the
    # messages-side constraint + index + columns.
    op.drop_constraint(
        "fk_conversations_active_leaf_message_id",
        "conversations",
        type_="foreignkey",
    )
    op.drop_column("conversations", "active_leaf_message_id")
    op.drop_constraint(
        "fk_messages_parent_message_id",
        "messages",
        type_="foreignkey",
    )
    op.drop_index("ix_messages_parent_message_id", table_name="messages")
    op.drop_column("messages", "parent_message_id")
