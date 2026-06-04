"""Postgres-only tests for Phase 3c entity-augmented memory retrieval.

The bridge (Phase 3b) links memories to KG entities; here retrieval uses that
link so a fact about a query-named subject is returned even when its wording is
far from the query embedding — and the union branch stays circle-filtered.

Real PG via ``pg_db_session`` (pgvector + jsonb). ``_get_embedding`` is mocked so
the query vector is deterministic. Flags toggled per test via monkeypatch.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    EMBEDDING_DIMENSION,
    MEMORY_CATEGORY_FACT,
    ConversationMemory,
    KGEntity,
    Role,
    User,
)
from services.memory_retrieval import MemoryRetrieval
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


async def _memory(db, owner, *, content, subject_entity_id=None, emb=None,
                  category=MEMORY_CATEGORY_FACT, tier=0) -> ConversationMemory:
    m = ConversationMemory(
        content=content, category=category, user_id=owner.id, circle_tier=tier,
        importance=0.6, confidence=1.0, is_active=True, embedding=emb,
        subject_entity_id=subject_entity_id,
    )
    db.add(m)
    await db.flush()
    return m


def _svc(db, monkeypatch, *, query_vec, bridge=True, auth=False) -> MemoryRetrieval:
    svc = MemoryRetrieval(db)
    monkeypatch.setattr(svc, "_get_embedding", AsyncMock(return_value=query_vec))
    monkeypatch.setattr(settings, "memory_kg_bridge_enabled", bridge)
    monkeypatch.setattr(settings, "auth_enabled", auth)
    return svc


class TestEntityAugmentedRetrieval:
    async def test_gold_subject_fact_surfaced_despite_far_embedding(self, pg_db_session, monkeypatch):
        # The fact's embedding is orthogonal to the query, so embedding-only would
        # drop it. Naming "Jutta" resolves the entity and unions the fact in.
        owner = await _make_user(pg_db_session, "er_gold")
        jutta = await _entity(pg_db_session, owner, "Jutta")
        m = await _memory(pg_db_session, owner, content="Jutta mag Tee",
                          subject_entity_id=jutta.id, emb=_vec(50))
        svc = _svc(pg_db_session, monkeypatch, query_vec=_vec(99), bridge=True)

        res = await svc.retrieve("Was weiß ich über Jutta?", user_id=owner.id)
        hit = next((r for r in res if r["id"] == m.id), None)
        assert hit is not None and hit["similarity"] == 0.99  # surfaced via the union floor

    async def test_flag_off_is_embedding_only(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "er_off")
        jutta = await _entity(pg_db_session, owner, "Jutta")
        m = await _memory(pg_db_session, owner, content="Jutta mag Tee",
                          subject_entity_id=jutta.id, emb=_vec(50))
        svc = _svc(pg_db_session, monkeypatch, query_vec=_vec(99), bridge=False)

        res = await svc.retrieve("Was weiß ich über Jutta?", user_id=owner.id)
        assert all(r["id"] != m.id for r in res)  # far embedding, no union -> dropped

    async def test_no_entity_match_falls_back(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "er_nomatch")
        jutta = await _entity(pg_db_session, owner, "Jutta")
        m = await _memory(pg_db_session, owner, content="Jutta mag Tee",
                          subject_entity_id=jutta.id, emb=_vec(50))
        svc = _svc(pg_db_session, monkeypatch, query_vec=_vec(99), bridge=True)

        # query names no known entity -> union empty -> embedding-only (far -> absent)
        res = await svc.retrieve("voellig anderes thema heute", user_id=owner.id)
        assert all(r["id"] != m.id for r in res)

    async def test_dedupe_embedding_and_subject_hit(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "er_dedupe")
        jutta = await _entity(pg_db_session, owner, "Jutta")
        # embedding == query vector -> also an embedding hit AND a subject hit
        m = await _memory(pg_db_session, owner, content="Jutta wohnt in Bonn",
                          subject_entity_id=jutta.id, emb=_vec(99))
        svc = _svc(pg_db_session, monkeypatch, query_vec=_vec(99), bridge=True)

        res = await svc.retrieve("Was weiß ich über Jutta?", user_id=owner.id)
        ids = [r["id"] for r in res]
        assert ids.count(m.id) == 1  # appears once, not duplicated


class TestBySubjectEntity:
    async def test_tombstone_chase(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "bs_tomb")
        live = await _entity(pg_db_session, owner, "Anna")
        tomb = await _entity(pg_db_session, owner, "Anna", is_active=False, canonical_id=live.id)
        m = await _memory(pg_db_session, owner, content="Anna fact", subject_entity_id=tomb.id)
        svc = _svc(pg_db_session, monkeypatch, query_vec=_vec(1), bridge=True, auth=False)

        # querying the SURVIVOR returns the memory still linked to the tombstone
        rows = await svc.list_by_subject_entity(live.id, owner.id)
        assert any(r["id"] == m.id for r in rows)

    async def test_circle_filter_blocks_cross_user_leak(self, pg_db_session, monkeypatch):
        # CRITICAL: the by-subject path must be circle-filtered. A's query for an
        # entity that B's tier-0 (self) memory is about must NOT leak B's memory.
        a = await _make_user(pg_db_session, "bs_a")
        b = await _make_user(pg_db_session, "bs_b")
        ent = await _entity(pg_db_session, b, "Geheim")
        mem = await _memory(pg_db_session, b, content="geheimer Fakt",
                            subject_entity_id=ent.id, tier=0)
        svc = _svc(pg_db_session, monkeypatch, query_vec=_vec(1), bridge=True, auth=True)

        own = await svc.list_by_subject_entity(ent.id, b.id)   # owner sees it
        assert any(r["id"] == mem.id for r in own)
        leak = await svc.list_by_subject_entity(ent.id, a.id)  # peer must NOT
        assert all(r["id"] != mem.id for r in leak)
