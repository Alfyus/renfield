"""Postgres-only tests for the Phase 3b memory→KG bridge.

Covers the save-time bridge (ConversationMemoryService._bridge_subject_entity)
and the backfill script (bin/backfill_subject_entity_ids.py). Real PG via
``pg_db_session`` — resolve_entity uses jsonb @> + halfvec the sqlite shim
can't run. ``_get_embedding`` is mocked; commit/rollback -> flush so the
bridge's internal txn control doesn't break the fixture's rollback isolation.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    EMBEDDING_DIMENSION,
    MEMORY_CATEGORY_FACT,
    MEMORY_CATEGORY_INSTRUCTION,
    MEMORY_CATEGORY_PREFERENCE,
    ConversationMemory,
    KGEntity,
    Role,
    User,
)
from services import memory_bridge_backfill as backfill
from services.conversation_memory_service import ConversationMemoryService
from services.knowledge_graph_service import KnowledgeGraphService
from utils.config import settings

pytestmark = [pytest.mark.postgres, pytest.mark.asyncio]


def _vec(seed: int) -> list[float]:
    v = [0.0] * EMBEDDING_DIMENSION
    v[seed % EMBEDDING_DIMENSION] = 1.0
    return v


async def _make_user(db: AsyncSession, name: str) -> User:
    role = Role(name=f"{name}_role")
    db.add(role)
    await db.flush()
    u = User(username=name, email=f"{name}@ex.test", password_hash="x", role_id=role.id, is_active=True)
    db.add(u)
    await db.flush()
    return u


async def _entity(db, owner, name, *, tier=0, etype="person", **kw) -> KGEntity:
    e = KGEntity(user_id=owner.id, name=name, entity_type=etype, circle_tier=tier, **kw)
    db.add(e)
    await db.flush()
    return e


async def _memory(db, owner, *, category, subject_name, tier=0) -> ConversationMemory:
    m = ConversationMemory(
        content=f"fact about {subject_name}", category=category, user_id=owner.id,
        subject_name=subject_name, circle_tier=tier, importance=0.5, confidence=1.0,
        is_active=True,
    )
    db.add(m)
    await db.flush()
    return m


def _patch(db, monkeypatch, *, enabled=True):
    monkeypatch.setattr(db, "commit", db.flush)
    monkeypatch.setattr(db, "rollback", db.flush)
    monkeypatch.setattr(KnowledgeGraphService, "_get_embedding", AsyncMock(return_value=_vec(1)))
    monkeypatch.setattr(settings, "memory_kg_bridge_enabled", enabled)


class TestSaveTimeBridge:
    async def test_fact_creates_and_links_person(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "br_fact")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Jutta")
        svc = ConversationMemoryService(pg_db_session)

        await svc._bridge_subject_entity(m, "Jutta", MEMORY_CATEGORY_FACT)

        assert m.subject_entity_id is not None
        ent = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == m.subject_entity_id)
        )).scalar_one()
        assert ent.name == "Jutta" and ent.entity_type == "person"

    async def test_links_existing_person(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "br_link")
        existing = await _entity(pg_db_session, owner, "Jutta", etype="person")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_PREFERENCE, subject_name="Jutta")
        svc = ConversationMemoryService(pg_db_session)

        await svc._bridge_subject_entity(m, "Jutta", MEMORY_CATEGORY_PREFERENCE)
        assert m.subject_entity_id == existing.id  # linked, not duplicated

    async def test_disabled_flag_leaves_null(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=False)
        owner = await _make_user(pg_db_session, "br_off")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Jutta")
        svc = ConversationMemoryService(pg_db_session)

        await svc._bridge_subject_entity(m, "Jutta", MEMORY_CATEGORY_FACT)
        assert m.subject_entity_id is None

    async def test_non_decomposable_skipped(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "br_instr")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_INSTRUCTION, subject_name="Jutta")
        svc = ConversationMemoryService(pg_db_session)

        await svc._bridge_subject_entity(m, "Jutta", MEMORY_CATEGORY_INSTRUCTION)
        assert m.subject_entity_id is None

    async def test_created_entity_inherits_memory_tier(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "br_tier")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Opa", tier=2)
        svc = ConversationMemoryService(pg_db_session)

        await svc._bridge_subject_entity(m, "Opa", MEMORY_CATEGORY_FACT)
        ent = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == m.subject_entity_id)
        )).scalar_one()
        assert ent.circle_tier == 2  # never minted at the more-public default tier 0


class TestBackfill:
    async def test_commit_links_and_creates(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "bf_run")
        existing = await _entity(pg_db_session, owner, "Anna", etype="person")
        m_link = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Anna")
        m_new = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Bert", tier=2)

        rep = await backfill.run_backfill(pg_db_session, owner.id, None)
        assert rep.linked == 2 and rep.created == 1 and rep.failed == 0
        await pg_db_session.refresh(m_link)
        await pg_db_session.refresh(m_new)
        assert m_link.subject_entity_id == existing.id           # linked existing
        new_ent = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == m_new.subject_entity_id)
        )).scalar_one()
        assert new_ent.name == "Bert" and new_ent.circle_tier == 2  # created @ memory tier

    async def test_dry_run_writes_nothing(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "bf_dry")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Carla")

        rep = await backfill.dry_run_backfill(pg_db_session, owner.id, None)
        assert rep.candidates == 1 and rep.would_create == 1
        await pg_db_session.refresh(m)
        assert m.subject_entity_id is None  # estimate only, no write

    async def test_idempotent_second_run(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "bf_idem")
        await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_FACT, subject_name="Dora")

        assert (await backfill.run_backfill(pg_db_session, owner.id, None)).linked == 1
        assert (await backfill.run_backfill(pg_db_session, owner.id, None)).candidates == 0  # already linked, excluded

    async def test_skips_non_decomposable(self, pg_db_session, monkeypatch):
        _patch(pg_db_session, monkeypatch, enabled=True)
        owner = await _make_user(pg_db_session, "bf_skip")
        m = await _memory(pg_db_session, owner, category=MEMORY_CATEGORY_INSTRUCTION, subject_name="Egon")

        assert (await backfill.run_backfill(pg_db_session, owner.id, None)).candidates == 0
        await pg_db_session.refresh(m)
        assert m.subject_entity_id is None
