"""
Knowledge-Graph view service — backs the 3D Wissensgraph (GraphView.tsx).

The frontend GraphView component speaks three shapes that originated in the
Reva ``/api/wissensbasis/*`` surface:

  - corpus  → connected-component clusters with hub entities
  - focus   → an entity's 1-hop + 2-hop neighborhood
  - search  → name-prefix entity suggestions

Reva ships a richer implementation (reasoning trace, role-mix, observed
fields). This module is Renfield's *native* implementation of just the three
shapes the Wissensgraph tab needs, computed over the local ``kg_entities`` /
``kg_relations`` tables. It deliberately omits Reva-only extras (``/trace``,
``/me/mix``) — those stay 404 in standalone Renfield, which is what
``useWissensbasisAvailable`` keys off to hide the Reva-only side panels.

Circle access is enforced identically to ``KnowledgeGraphService.list_entities``:
``AUTH_ENABLED=false`` sees everything; an authenticated asker sees own + public
+ explicit-grant + tier-reach; ``asker_id=None`` in auth-enabled mode reduces to
public-tier only. Edges are kept only when *both* endpoints are accessible, so
relation visibility never leaks an entity the asker cannot already see.

Scale note: production holds ~200 entities / ~50 relations, so we load the
accessible slice into memory and compute components/BFS in Python rather than
leaning on recursive SQL. The corpus load is capped (``CORPUS_ENTITY_CAP``) and
reports ``truncated`` when the cap or the cluster cap bites.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import TIER_PUBLIC, KGEntity, KGRelation
from services.circle_sql import kg_entities_circles_filter
from utils.config import settings

# Render budgets. Tuned for the current ~200-entity prod graph; generous
# enough that the 3D scene stays legible without a config knob per the
# "measure first, don't hardcode caps blindly" rule — these are presentation
# limits, not data limits, and the response flags when they bite.
CORPUS_ENTITY_CAP = 300          # most-mentioned N entities loaded for corpus mode
MAX_NAMED_CLUSTERS = 16          # connected components rendered as named clusters
MAX_HUBS_PER_CLUSTER = 6         # orbiting hub spheres per cluster
DEFAULT_MAX_PER_HOP = 30         # hop1 / hop2 node cap in focus mode
FOCUS_ENTITY_CAP = 5000          # safety bound on accessible-set load for focus
SEARCH_LIMIT_DEFAULT = 12
SEARCH_LIMIT_MAX = 25


@dataclass
class _Entity:
    """Lightweight projection of a KGEntity row for in-memory graph work."""

    id: int
    name: str
    entity_type: str
    mention_count: int


@dataclass
class _Component:
    member_ids: list[int] = field(default_factory=list)


def _union_find(entity_ids: list[int], edges: list[tuple[int, int]]) -> list[list[int]]:
    """Group entity ids into connected components via union-find.

    Returns a list of components, each a list of member ids. Membership order
    within a component follows ``entity_ids`` input order (callers pass it
    pre-sorted by importance, so the first member is the most-mentioned).
    """
    parent = {eid: eid for eid in entity_ids}

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        # Path compression.
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    present = set(entity_ids)
    for a, b in edges:
        if a in present and b in present:
            union(a, b)

    groups: dict[int, list[int]] = defaultdict(list)
    for eid in entity_ids:  # preserves importance order within each component
        groups[find(eid)].append(eid)
    return list(groups.values())


class KGGraphService:
    """Read-only graph projections for the Wissensgraph 3D view."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Accessible-slice loaders (circle-filtered)
    # ------------------------------------------------------------------
    async def _load_entities(
        self, asker_id: int | None, limit: int
    ) -> tuple[list[_Entity], int]:
        """Load up to ``limit`` accessible active entities, most-mentioned first.

        Returns ``(entities, total_accessible)`` where ``total_accessible`` is
        the unbounded count (so corpus mode can flag truncation).
        """
        base = select(KGEntity).where(KGEntity.is_active == True)  # noqa: E712
        count_q = select(func.count(KGEntity.id)).where(KGEntity.is_active == True)  # noqa: E712

        if not settings.auth_enabled:
            pass  # single-user bypass — no circle filter
        elif asker_id is None:
            base = base.where(KGEntity.circle_tier == TIER_PUBLIC)
            count_q = count_q.where(KGEntity.circle_tier == TIER_PUBLIC)
        else:
            clause, params = kg_entities_circles_filter(asker_id, alias="kg_entities")
            base = base.where(sa_text(clause).bindparams(**params))
            count_q = count_q.where(sa_text(clause).bindparams(**params))

        total = (await self.db.execute(count_q)).scalar() or 0

        base = base.order_by(
            KGEntity.mention_count.desc().nullslast(), KGEntity.id
        ).limit(limit)
        rows = (await self.db.execute(base)).scalars().all()
        entities = [
            _Entity(
                id=e.id,
                name=e.name,
                entity_type=e.entity_type,
                mention_count=int(e.mention_count or 1),
            )
            for e in rows
        ]
        return entities, total

    async def _load_relations(
        self, entity_ids: list[int]
    ) -> list[tuple[int, int, str]]:
        """Active relations with *both* endpoints inside ``entity_ids``.

        Endpoint-membership is the circle gate: since ``entity_ids`` is already
        the accessible set, an edge survives only when both ends are visible to
        the asker.
        """
        if not entity_ids:
            return []
        q = select(
            KGRelation.subject_id, KGRelation.object_id, KGRelation.predicate
        ).where(
            KGRelation.is_active == True,  # noqa: E712
            KGRelation.subject_id.in_(entity_ids),
            KGRelation.object_id.in_(entity_ids),
        )
        rows = (await self.db.execute(q)).all()
        return [(int(s), int(o), p) for s, o, p in rows]

    # ------------------------------------------------------------------
    # search
    # ------------------------------------------------------------------
    async def search(
        self, query: str, asker_id: int | None, limit: int = SEARCH_LIMIT_DEFAULT
    ) -> list[dict]:
        """Name-substring entity suggestions, most-mentioned first.

        Empty/blank query → no results (the direct-entry premise is "I know
        what I'm looking for", not "show me everything").
        """
        q = query.strip()
        if not q:
            return []
        limit = max(1, min(limit, SEARCH_LIMIT_MAX))

        stmt = select(KGEntity).where(
            KGEntity.is_active == True,  # noqa: E712
            KGEntity.name.ilike(f"%{q}%"),
        )
        if not settings.auth_enabled:
            pass
        elif asker_id is None:
            stmt = stmt.where(KGEntity.circle_tier == TIER_PUBLIC)
        else:
            clause, params = kg_entities_circles_filter(asker_id, alias="kg_entities")
            stmt = stmt.where(sa_text(clause).bindparams(**params))

        stmt = stmt.order_by(
            KGEntity.mention_count.desc().nullslast(), KGEntity.id
        ).limit(limit)
        rows = (await self.db.execute(stmt)).scalars().all()
        return [
            {
                "entity_id": str(e.id),
                "display_name": e.name,
                "entity_type": e.entity_type,
                "mention_count": int(e.mention_count or 1),
            }
            for e in rows
        ]

    # ------------------------------------------------------------------
    # focus
    # ------------------------------------------------------------------
    async def focus(
        self,
        entity_id: int,
        asker_id: int | None,
        hops: int = 2,
        max_per_hop: int = DEFAULT_MAX_PER_HOP,
    ) -> dict | None:
        """1-hop (+2-hop) neighborhood for an entity.

        Returns ``None`` when the entity does not exist or is not accessible to
        the asker (the route maps that to 404, identical responses so existence
        of an inaccessible entity does not leak).
        """
        max_per_hop = max(1, max_per_hop)
        entities, _ = await self._load_entities(asker_id, FOCUS_ENTITY_CAP)
        by_id = {e.id: e for e in entities}
        focus_entity = by_id.get(entity_id)
        if focus_entity is None:
            return None

        relations = await self._load_relations(list(by_id.keys()))

        # Undirected adjacency for neighborhood walk.
        adj: dict[int, set[int]] = defaultdict(set)
        for s, o, _pred in relations:
            adj[s].add(o)
            adj[o].add(s)

        def sort_by_mentions(ids: set[int]) -> list[int]:
            return sorted(
                ids,
                key=lambda i: (by_id[i].mention_count, i),
                reverse=True,
            )

        hop1_all = sort_by_mentions(adj.get(entity_id, set()))
        hop1_set = set(hop1_all)

        hop2_all: set[int] = set()
        if hops >= 2:
            for h1 in hop1_set:
                hop2_all |= adj.get(h1, set())
            hop2_all -= hop1_set
            hop2_all.discard(entity_id)
        hop2_sorted = sort_by_mentions(hop2_all)

        overflow_hop1 = max(0, len(hop1_all) - max_per_hop)
        overflow_hop2 = max(0, len(hop2_sorted) - max_per_hop)
        hop1 = hop1_all[:max_per_hop]
        hop2 = hop2_sorted[:max_per_hop]

        included = {entity_id, *hop1, *hop2}
        edges = [
            {"from_entity": str(s), "to_entity": str(o), "relation": pred}
            for s, o, pred in relations
            if s in included and o in included
        ]

        def to_focus_entity(e: _Entity) -> dict:
            return {
                "entity_id": str(e.id),
                "display_name": e.name,
                "entity_type": e.entity_type,
                "importance": float(e.mention_count),
            }

        return {
            "focus": to_focus_entity(focus_entity),
            "hop1": [to_focus_entity(by_id[i]) for i in hop1],
            "hop2": [to_focus_entity(by_id[i]) for i in hop2],
            "edges": edges,
            "overflow_hop1": overflow_hop1,
            "overflow_hop2": overflow_hop2,
        }

    # ------------------------------------------------------------------
    # corpus / graph
    # ------------------------------------------------------------------
    async def corpus(self, asker_id: int | None, lang: str = "de") -> dict:
        """Connected-component clusters over the most-mentioned entities."""
        loose_label = "Lose Enden" if lang != "en" else "Loose ends"
        entity_word = "Entitäten" if lang != "en" else "entities"

        entities, total_entities = await self._load_entities(
            asker_id, CORPUS_ENTITY_CAP
        )
        by_id = {e.id: e for e in entities}
        ordered_ids = [e.id for e in entities]  # already most-mentioned first
        relations = await self._load_relations(ordered_ids)

        components = _union_find(ordered_ids, [(s, o) for s, o, _ in relations])

        # Connected components (size >= 2) become named clusters; everything
        # left over (singletons + clusters beyond the cap) folds into one
        # "loose ends" bucket so the scene stays legible.
        named = [c for c in components if len(c) >= 2]
        named.sort(key=len, reverse=True)
        rendered = named[:MAX_NAMED_CLUSTERS]
        overflow_named = named[MAX_NAMED_CLUSTERS:]

        loose_ids: list[int] = [c[0] for c in components if len(c) == 1]
        for c in overflow_named:
            loose_ids.extend(c)
        # Keep loose-ends importance-ordered for stable hub selection.
        loose_ids.sort(key=lambda i: (by_id[i].mention_count, i), reverse=True)

        clusters: list[dict] = []

        def hubs_for(member_ids: list[int]) -> list[dict]:
            top = sorted(
                member_ids,
                key=lambda i: (by_id[i].mention_count, i),
                reverse=True,
            )[:MAX_HUBS_PER_CLUSTER]
            return [
                {
                    "entity_id": str(by_id[i].id),
                    "name": by_id[i].name,
                    "entity_type": by_id[i].entity_type,
                    "mention_count": by_id[i].mention_count,
                }
                for i in top
            ]

        for seed, member_ids in enumerate(rendered):
            # member_ids preserves importance order (union-find kept input
            # order), so the first member is the namesake.
            namesake = by_id[member_ids[0]]
            clusters.append(
                {
                    "id": f"c{namesake.id}",
                    "label": namesake.name,
                    "sub_label": f"{len(member_ids)} {entity_word}",
                    "entity_count": len(member_ids),
                    "hubs": hubs_for(member_ids),
                    "color_seed": seed,
                    "namesake_entity_id": str(namesake.id),
                }
            )

        if loose_ids:
            clusters.append(
                {
                    "id": "loose",
                    "label": loose_label,
                    "sub_label": f"{len(loose_ids)} {entity_word}",
                    "entity_count": len(loose_ids),
                    "hubs": hubs_for(loose_ids),
                    "color_seed": len(rendered),
                    "namesake_entity_id": None,
                }
            )

        truncated = total_entities > len(entities) or len(overflow_named) > 0
        return {
            "clusters": clusters,
            "total_entities": total_entities,
            "total_relations": len(relations),
            "truncated": truncated,
        }
