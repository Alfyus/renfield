"""Postgres-only tests for graph_expansion.expand_fused (Phase 4, post-RRF).

Operates on the fused AtomMatch list: finds kg_node pivots, walks kg_relations
1-2 hops (circle-filtered per hop), returns decay-scored neighbour kg_node atoms
+ leak-safe kg_edge atoms (both endpoints accessible). Real PG via pg_db_session.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import KGEntity, KGRelation, Role, User
from services import graph_expansion
from services.atom_types import Atom, AtomMatch
from utils.config import settings

pytestmark = [pytest.mark.postgres, pytest.mark.asyncio]


async def _make_user(db: AsyncSession, name: str) -> User:
    role = Role(name=f"{name}_role")
    db.add(role)
    await db.flush()
    u = User(username=name, email=f"{name}@ex.test", password_hash="x", role_id=role.id, is_active=True)
    db.add(u)
    await db.flush()
    return u


async def _entity(db, owner, name, *, tier=0, etype="person") -> KGEntity:
    e = KGEntity(user_id=owner.id, name=name, entity_type=etype, circle_tier=tier)
    db.add(e)
    await db.flush()
    return e


async def _rel(db, owner, s, o, pred="kennt") -> KGRelation:
    r = KGRelation(user_id=owner.id, subject_id=s.id, predicate=pred, object_id=o.id,
                   circle_tier=min(s.circle_tier, o.circle_tier), is_active=True)
    db.add(r)
    await db.flush()
    return r


def _pivot(e: KGEntity, score: float = 0.9) -> AtomMatch:
    now = datetime.now()
    return AtomMatch(
        atom=Atom(atom_id=f"kg_node:{e.id}", atom_type="kg_node", owner_user_id=0,
                  policy={"tier": e.circle_tier}, created_at=now, updated_at=now,
                  payload={"entity_id": e.id, "name": e.name, "entity_type": e.entity_type}),
        score=score, snippet=e.name, rank=1,
    )


def _on(monkeypatch, *, auth=False):
    monkeypatch.setattr(settings, "graph_expansion_enabled", True)
    monkeypatch.setattr(settings, "auth_enabled", auth)


def _nodes(out):
    return {m.atom.payload["entity_id"]: m for m in out if m.atom.atom_type == "kg_node"}


def _edges(out):
    return [m for m in out if m.atom.atom_type == "kg_edge"]


class TestExpandFused:
    async def test_flag_off_returns_empty(self, pg_db_session, monkeypatch):
        monkeypatch.setattr(settings, "graph_expansion_enabled", False)
        owner = await _make_user(pg_db_session, "gx_off")
        a = await _entity(pg_db_session, owner, "A")
        b = await _entity(pg_db_session, owner, "B")
        await _rel(pg_db_session, owner, a, b)
        assert await graph_expansion.expand_fused([_pivot(a)], owner.id, pg_db_session) == []

    async def test_one_hop_node_and_edge(self, pg_db_session, monkeypatch):
        _on(monkeypatch)
        owner = await _make_user(pg_db_session, "gx_1")
        a = await _entity(pg_db_session, owner, "Anna")
        b = await _entity(pg_db_session, owner, "Bonn", etype="place")
        await _rel(pg_db_session, owner, a, b, pred="wohnt_in")
        out = await graph_expansion.expand_fused([_pivot(a, 0.9)], owner.id, pg_db_session)
        nodes = _nodes(out)
        assert b.id in nodes and a.id not in nodes              # neighbour added, pivot not re-added
        assert nodes[b.id].atom.payload["hop"] == 1
        assert nodes[b.id].atom.payload["expanded"] is True     # provenance
        assert nodes[b.id].score == round(0.9 / 2, 6)           # decay
        edges = _edges(out)
        assert len(edges) == 1 and edges[0].atom.payload["object_id"] == b.id
        # edge score is endpoint-derived (RRF-scale), never above its node
        assert edges[0].score <= nodes[b.id].score

    async def test_two_hop_decay_order(self, pg_db_session, monkeypatch):
        _on(monkeypatch)
        owner = await _make_user(pg_db_session, "gx_2")
        a = await _entity(pg_db_session, owner, "A")
        b = await _entity(pg_db_session, owner, "B")
        c = await _entity(pg_db_session, owner, "C")
        await _rel(pg_db_session, owner, a, b)
        await _rel(pg_db_session, owner, b, c)
        out = await graph_expansion.expand_fused([_pivot(a, 0.9)], owner.id, pg_db_session, max_hops=2)
        nodes = _nodes(out)
        assert nodes[b.id].atom.payload["hop"] == 1 and nodes[b.id].score == round(0.9 / 2, 6)
        assert nodes[c.id].atom.payload["hop"] == 2 and nodes[c.id].score == round(0.9 / 3, 6)

    async def test_max_expanded_cap(self, pg_db_session, monkeypatch):
        _on(monkeypatch)
        owner = await _make_user(pg_db_session, "gx_cap")
        hub = await _entity(pg_db_session, owner, "Hub")
        for i in range(6):
            n = await _entity(pg_db_session, owner, f"N{i}")
            await _rel(pg_db_session, owner, hub, n)
        out = await graph_expansion.expand_fused([_pivot(hub)], owner.id, pg_db_session, max_expanded=3)
        assert len(_nodes(out)) == 3

    async def test_per_hop_circle_filter_and_leak_safe_edge(self, pg_db_session, monkeypatch):
        # CRITICAL: an inaccessible neighbour is dropped AND no edge names it.
        _on(monkeypatch, auth=True)
        a_user = await _make_user(pg_db_session, "gx_a")
        b_user = await _make_user(pg_db_session, "gx_b")
        mine = await _entity(pg_db_session, a_user, "Mine", tier=0)
        secret = await _entity(pg_db_session, b_user, "Secret", tier=0)  # B's self-tier
        await _rel(pg_db_session, a_user, mine, secret)
        out = await graph_expansion.expand_fused([_pivot(mine)], a_user.id, pg_db_session)
        assert all(m.atom.payload.get("entity_id") != secret.id for m in _nodes(out).values())
        # and no edge discloses the secret endpoint
        for e in _edges(out):
            assert e.atom.payload["object_id"] != secret.id
            assert "Secret" not in e.atom.snippet

    async def test_anonymous_asker_public_only(self, pg_db_session, monkeypatch):
        # asker_id=None (anonymous, auth on) must see ONLY public-tier neighbours.
        from models.database import TIER_PUBLIC
        _on(monkeypatch, auth=True)
        owner = await _make_user(pg_db_session, "gx_anon")
        pub = await _entity(pg_db_session, owner, "PublicOrg", tier=TIER_PUBLIC, etype="organization")
        priv = await _entity(pg_db_session, owner, "PrivatePerson", tier=0)
        await _rel(pg_db_session, owner, pub, priv)
        out = await graph_expansion.expand_fused([_pivot(pub)], None, pg_db_session)
        assert all(m.atom.payload.get("entity_id") != priv.id for m in _nodes(out).values())

    async def test_no_pivots_returns_empty(self, pg_db_session, monkeypatch):
        _on(monkeypatch)
        owner = await _make_user(pg_db_session, "gx_nop")
        # a fused list with no kg_node atoms → nothing to expand
        now = datetime.now()
        doc = AtomMatch(atom=Atom(atom_id="kb_document:1", atom_type="kb_document", owner_user_id=0,
                                  policy={"tier": 0}, created_at=now, updated_at=now, payload={}),
                        score=0.5, snippet="x", rank=1)
        assert await graph_expansion.expand_fused([doc], owner.id, pg_db_session) == []
