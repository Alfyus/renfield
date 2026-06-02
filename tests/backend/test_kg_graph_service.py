"""
Tests for KGGraphService — the native backend behind the 3D Wissensgraph
(GraphView.tsx, ``/api/wissensbasis/{graph,focus,search}``).

Two layers:

- SQLite unit/behavioral tests with ``auth_enabled=False`` (circle filter
  bypassed) exercise the graph logic itself: union-find clustering, hub /
  namesake selection, loose-ends bucketing, BFS neighborhood + overflow, and
  search ordering. This is where the shapes the frontend depends on are pinned.
- A Postgres test (``@pytest.mark.postgres``) seeds a real circle world and
  proves the corpus / focus / search paths enforce circle visibility — the
  same helper (`kg_entities_circles_filter`) that `list_entities` relies on,
  exercised end-to-end so a future regression fails at PR time, not in prod.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import KGEntity, KGRelation
from services.kg_graph_service import (
    MAX_HUBS_PER_CLUSTER,
    KGGraphService,
    _union_find,
)
from utils.config import settings


@pytest.fixture
def single_user_mode(monkeypatch):
    """Force the single-user bypass so the circle filter is skipped."""
    monkeypatch.setattr(settings, "auth_enabled", False)


async def _entity(
    db: AsyncSession,
    name: str,
    *,
    entity_type: str = "person",
    mention_count: int = 1,
    circle_tier: int = 0,
    user_id: int | None = None,
    is_active: bool = True,
) -> KGEntity:
    e = KGEntity(
        name=name,
        entity_type=entity_type,
        mention_count=mention_count,
        circle_tier=circle_tier,
        user_id=user_id,
        is_active=is_active,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


async def _relation(
    db: AsyncSession, subject_id: int, predicate: str, object_id: int
) -> KGRelation:
    r = KGRelation(
        subject_id=subject_id, predicate=predicate, object_id=object_id,
        is_active=True,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


# ==========================================================================
# _union_find (pure)
# ==========================================================================

class TestUnionFind:
    @pytest.mark.unit
    def test_connects_transitively(self):
        # 1-2, 2-3 → one component {1,2,3}; 4 isolated.
        comps = _union_find([1, 2, 3, 4], [(1, 2), (2, 3)])
        sizes = sorted(len(c) for c in comps)
        assert sizes == [1, 3]
        big = next(c for c in comps if len(c) == 3)
        assert set(big) == {1, 2, 3}

    @pytest.mark.unit
    def test_preserves_input_order_within_component(self):
        # Input order encodes importance; namesake selection relies on it.
        comps = _union_find([10, 20, 30], [(30, 20), (20, 10)])
        assert comps[0] == [10, 20, 30]

    @pytest.mark.unit
    def test_ignores_edges_to_absent_nodes(self):
        comps = _union_find([1, 2], [(1, 99)])
        assert sorted(len(c) for c in comps) == [1, 1]


# ==========================================================================
# search
# ==========================================================================

class TestSearch:
    @pytest.mark.database
    async def test_substring_match_orders_by_mentions(
        self, db_session, single_user_mode
    ):
        await _entity(db_session, "Berlin Hauptbahnhof", mention_count=2)
        await _entity(db_session, "Berliner Ensemble", mention_count=9)
        await _entity(db_session, "München", mention_count=50)

        svc = KGGraphService(db_session)
        hits = await svc.search("berl", asker_id=None)

        names = [h["display_name"] for h in hits]
        assert names == ["Berliner Ensemble", "Berlin Hauptbahnhof"]
        # entity_id is serialized as a string for the frontend.
        assert all(isinstance(h["entity_id"], str) for h in hits)

    @pytest.mark.database
    async def test_blank_query_returns_empty(self, db_session, single_user_mode):
        await _entity(db_session, "Anything")
        svc = KGGraphService(db_session)
        assert await svc.search("   ", asker_id=None) == []

    @pytest.mark.database
    async def test_limit_is_clamped(self, db_session, single_user_mode):
        for i in range(5):
            await _entity(db_session, f"Node {i}", mention_count=i)
        svc = KGGraphService(db_session)
        hits = await svc.search("node", asker_id=None, limit=2)
        assert len(hits) == 2


# ==========================================================================
# focus
# ==========================================================================

class TestFocus:
    @pytest.mark.database
    async def test_missing_entity_returns_none(self, db_session, single_user_mode):
        svc = KGGraphService(db_session)
        assert await svc.focus(999, asker_id=None) is None

    @pytest.mark.database
    async def test_hop1_and_hop2_split(self, db_session, single_user_mode):
        center = await _entity(db_session, "Center", mention_count=10)
        near = await _entity(db_session, "Near", mention_count=5)
        far = await _entity(db_session, "Far", mention_count=1)
        # center—near (hop1), near—far (hop2 of center)
        await _relation(db_session, center.id, "knows", near.id)
        await _relation(db_session, near.id, "knows", far.id)

        svc = KGGraphService(db_session)
        result = await svc.focus(center.id, asker_id=None, hops=2)

        assert result["focus"]["entity_id"] == str(center.id)
        assert [e["entity_id"] for e in result["hop1"]] == [str(near.id)]
        assert [e["entity_id"] for e in result["hop2"]] == [str(far.id)]
        # Edges only among included nodes, endpoints as strings.
        relations = {(e["from_entity"], e["to_entity"]) for e in result["edges"]}
        assert (str(center.id), str(near.id)) in relations
        assert (str(near.id), str(far.id)) in relations

    @pytest.mark.database
    async def test_hops_1_excludes_hop2(self, db_session, single_user_mode):
        center = await _entity(db_session, "C", mention_count=3)
        near = await _entity(db_session, "N", mention_count=2)
        far = await _entity(db_session, "F", mention_count=1)
        await _relation(db_session, center.id, "r", near.id)
        await _relation(db_session, near.id, "r", far.id)

        svc = KGGraphService(db_session)
        result = await svc.focus(center.id, asker_id=None, hops=1)
        assert result["hop2"] == []
        assert len(result["hop1"]) == 1

    @pytest.mark.database
    async def test_overflow_caps_hop1(self, db_session, single_user_mode):
        center = await _entity(db_session, "Hub", mention_count=100)
        for i in range(5):
            n = await _entity(db_session, f"N{i}", mention_count=i)
            await _relation(db_session, center.id, "r", n.id)

        svc = KGGraphService(db_session)
        result = await svc.focus(center.id, asker_id=None, max_per_hop=3)
        assert len(result["hop1"]) == 3
        assert result["overflow_hop1"] == 2
        # Most-mentioned neighbors survive the cap.
        assert result["hop1"][0]["display_name"] == "N4"


# ==========================================================================
# corpus / graph
# ==========================================================================

class TestCorpus:
    @pytest.mark.database
    async def test_named_cluster_uses_top_mention_namesake(
        self, db_session, single_user_mode
    ):
        a = await _entity(db_session, "Alpha", mention_count=20)
        b = await _entity(db_session, "Beta", mention_count=5)
        await _relation(db_session, a.id, "links", b.id)

        svc = KGGraphService(db_session)
        result = await svc.corpus(asker_id=None)

        named = [c for c in result["clusters"] if c["namesake_entity_id"]]
        assert len(named) == 1
        cluster = named[0]
        assert cluster["label"] == "Alpha"
        assert cluster["namesake_entity_id"] == str(a.id)
        assert cluster["entity_count"] == 2
        assert result["total_entities"] == 2
        assert result["total_relations"] == 1
        assert result["truncated"] is False

    @pytest.mark.database
    async def test_singletons_fold_into_loose_ends(
        self, db_session, single_user_mode
    ):
        await _entity(db_session, "Lonely1", mention_count=3)
        await _entity(db_session, "Lonely2", mention_count=1)

        svc = KGGraphService(db_session)
        result = await svc.corpus(asker_id=None)

        assert len(result["clusters"]) == 1
        loose = result["clusters"][0]
        assert loose["namesake_entity_id"] is None
        assert loose["entity_count"] == 2

    @pytest.mark.database
    async def test_hubs_capped_per_cluster(self, db_session, single_user_mode):
        hub = await _entity(db_session, "BigHub", mention_count=100)
        for i in range(MAX_HUBS_PER_CLUSTER + 3):
            n = await _entity(db_session, f"Member{i}", mention_count=i)
            await _relation(db_session, hub.id, "r", n.id)

        svc = KGGraphService(db_session)
        result = await svc.corpus(asker_id=None)
        cluster = next(c for c in result["clusters"] if c["namesake_entity_id"])
        assert len(cluster["hubs"]) == MAX_HUBS_PER_CLUSTER
        assert all(isinstance(h["entity_id"], str) for h in cluster["hubs"])

    @pytest.mark.database
    async def test_empty_graph(self, db_session, single_user_mode):
        svc = KGGraphService(db_session)
        result = await svc.corpus(asker_id=None)
        assert result["clusters"] == []
        assert result["total_entities"] == 0
        assert result["truncated"] is False


# ==========================================================================
# Circle filtering — real Postgres
# ==========================================================================

pytestmark_pg = pytest.mark.postgres


@pytest.fixture
async def circle_world(pg_db_session: AsyncSession):
    """Owner with entities at tiers 0/2/4 + a household member and stranger."""
    from models.database import (
        TIER_PUBLIC,
        Atom,
        AtomExplicitGrant,
        CircleMembership,
        Role,
        User,
    )

    role = Role(name="kggraph-pg-role", description="t", permissions=[])
    pg_db_session.add(role)
    await pg_db_session.flush()

    owner = User(username="kggraph-owner", password_hash="x", is_active=True, role_id=role.id)
    household = User(username="kggraph-household", password_hash="x", is_active=True, role_id=role.id)
    stranger = User(username="kggraph-stranger", password_hash="x", is_active=True, role_id=role.id)
    pg_db_session.add_all([owner, household, stranger])
    await pg_db_session.flush()

    pg_db_session.add(CircleMembership(
        circle_owner_id=owner.id, member_user_id=household.id,
        dimension="tier", value=2, granted_by=owner.id,
    ))
    await pg_db_session.flush()

    e_self = await _pg_entity(pg_db_session, owner.id, "kg-self", 0, mentions=10)
    e_household = await _pg_entity(pg_db_session, owner.id, "kg-household", 2, mentions=8)
    e_public = await _pg_entity(pg_db_session, owner.id, "kg-public", TIER_PUBLIC, mentions=6)

    # Explicit grant: stranger may read the tier-0 self entity.
    atom = Atom(
        atom_id="00000000-0000-0000-0000-0000kggraph0",
        atom_type="kg_node", source_table="kg_entities",
        source_id=str(e_self.id), owner_user_id=owner.id, policy={"tier": 0},
    )
    pg_db_session.add(atom)
    await pg_db_session.flush()
    pg_db_session.add(AtomExplicitGrant(
        atom_id=atom.atom_id, granted_to_user_id=stranger.id,
        permission_level="read", granted_by=owner.id,
    ))
    await pg_db_session.flush()

    return {
        "owner_id": owner.id,
        "household_id": household.id,
        "stranger_id": stranger.id,
        "self_id": e_self.id,
        "household_id_ent": e_household.id,
        "public_id": e_public.id,
    }


async def _pg_entity(db, owner_id, name, tier, mentions):
    e = KGEntity(
        user_id=owner_id, name=name, entity_type="thing",
        is_active=True, circle_tier=tier, mention_count=mentions,
    )
    db.add(e)
    await db.flush()
    return e


@pytest.mark.postgres
async def test_corpus_circle_filtered_by_asker(pg_db_session, circle_world, monkeypatch):
    monkeypatch.setattr(settings, "auth_enabled", True)
    svc = KGGraphService(pg_db_session)

    owner_view = await svc.corpus(asker_id=circle_world["owner_id"])
    assert owner_view["total_entities"] == 3  # owns all

    household_view = await svc.corpus(asker_id=circle_world["household_id"])
    # household reach=2 → sees tier 2 + tier 4 (not tier 0).
    assert household_view["total_entities"] == 2

    stranger_view = await svc.corpus(asker_id=circle_world["stranger_id"])
    # public (tier 4) + explicit grant on the tier-0 self entity.
    assert stranger_view["total_entities"] == 2


@pytest.mark.postgres
async def test_focus_404_for_inaccessible_entity(pg_db_session, circle_world, monkeypatch):
    monkeypatch.setattr(settings, "auth_enabled", True)
    svc = KGGraphService(pg_db_session)

    # household cannot see the owner's tier-0 self entity → None (→ 404).
    assert await svc.focus(circle_world["self_id"], asker_id=circle_world["household_id"]) is None
    # owner can.
    owner_focus = await svc.focus(circle_world["self_id"], asker_id=circle_world["owner_id"])
    assert owner_focus is not None
    assert owner_focus["focus"]["entity_id"] == str(circle_world["self_id"])


@pytest.mark.postgres
async def test_search_circle_filtered(pg_db_session, circle_world, monkeypatch):
    monkeypatch.setattr(settings, "auth_enabled", True)
    svc = KGGraphService(pg_db_session)

    stranger_hits = await svc.search("kg-", asker_id=circle_world["stranger_id"])
    names = {h["display_name"] for h in stranger_hits}
    assert names == {"kg-public", "kg-self"}  # public + explicit grant only
