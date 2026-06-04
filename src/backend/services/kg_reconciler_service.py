"""KG entity reconciler (Structured Memory Phase 1, T5).

Periodic, per-user pass that catches near-duplicate entities born *after* both
spellings existed (the same-tier guard in resolve_entity deliberately creates a
fresh entity rather than fold across tiers, so duplicates accumulate and are
reconciled here). Mirrors SkillCuratorService: a halfvec embedding self-join
finds candidate pairs; the winner is the more-established row.

Policy (the safety core):
  - SAME tier AND similarity >= auto-merge threshold -> auto-merge via
    KnowledgeGraphService.merge_entities (which enforces tier=MIN etc.).
  - CROSS tier (could change visibility, D3) OR gray-zone (similar but below
    the auto bar, D10) -> a KgMergeProposal for owner review on /brain/review.
    Never silently merged.

Idempotent: candidate pairs that already have a PENDING proposal are excluded
by the find query (and the proposals table carries a partial-unique guard).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from loguru import logger
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    EMBEDDING_DIMENSION,
    KG_MERGE_PROPOSAL_PENDING,
    KG_MERGE_REASON_CROSS_TIER,
    KG_MERGE_REASON_GRAY_ZONE,
    KGEntity,
    KgMergeProposal,
)
from services.knowledge_graph_service import KnowledgeGraphService
from utils.config import settings


@dataclass
class MergeCandidate:
    loser_id: int
    winner_id: int
    similarity: float
    loser_tier: int
    winner_tier: int


@dataclass
class ReconcileReport:
    user_id: int
    candidates: int = 0
    auto_merged: int = 0
    proposed: int = 0
    notes: list[str] = field(default_factory=list)


class KgReconcilerService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_active_user_ids(self) -> list[int]:
        rows = (await self.db.execute(text(
            "SELECT DISTINCT user_id FROM kg_entities "
            "WHERE is_active = true AND canonical_id IS NULL AND user_id IS NOT NULL"
        ))).fetchall()
        return [int(r[0]) for r in rows]

    async def find_duplicate_pairs(self, user_id: int) -> list[MergeCandidate]:
        """Embedding self-join over the user's live canonical entities.

        sqlite has no halfvec — short-circuits to [] there so the rest of the
        pipeline can still be exercised on the shim.
        """
        dialect = self.db.bind.dialect.name if self.db.bind is not None else ""
        if dialect != "postgresql":
            return []

        dim = EMBEDDING_DIMENSION
        cap = max(settings.kg_reconciler_max_per_run * 2, 2)
        sql = text(f"""
            SELECT a.id AS id_a, b.id AS id_b,
                   a.circle_tier AS tier_a, b.circle_tier AS tier_b,
                   a.mention_count AS mc_a, b.mention_count AS mc_b,
                   a.first_seen_at AS fs_a, b.first_seen_at AS fs_b,
                   1 - (a.embedding::halfvec({dim}) <=> b.embedding::halfvec({dim})) AS similarity
            FROM kg_entities a
            JOIN kg_entities b
              ON a.id < b.id
             AND a.user_id = b.user_id
             AND a.embedding IS NOT NULL
             AND b.embedding IS NOT NULL
            WHERE a.user_id = :uid
              AND a.is_active = true AND b.is_active = true
              AND a.canonical_id IS NULL AND b.canonical_id IS NULL
              AND (1 - (a.embedding::halfvec({dim}) <=> b.embedding::halfvec({dim}))) >= :cand
              AND NOT EXISTS (
                  SELECT 1 FROM kg_merge_proposals p
                  WHERE p.status = :pending
                    AND ((p.loser_entity_id = a.id AND p.winner_entity_id = b.id)
                      OR (p.loser_entity_id = b.id AND p.winner_entity_id = a.id)))
            ORDER BY similarity DESC
            LIMIT :cap
        """)
        rows = (await self.db.execute(sql, {
            "uid": user_id,
            "cand": settings.kg_reconciler_candidate_threshold,
            "pending": KG_MERGE_PROPOSAL_PENDING,
            "cap": cap,
        })).fetchall()

        out: list[MergeCandidate] = []
        for r in rows:
            # Winner = the more-established row: higher mention_count, tie-break
            # on the OLDER first_seen_at (smaller timestamp).
            a_key = (int(r.mc_a or 1), -(r.fs_a.timestamp() if r.fs_a else 0.0))
            b_key = (int(r.mc_b or 1), -(r.fs_b.timestamp() if r.fs_b else 0.0))
            if a_key >= b_key:
                winner_id, winner_tier = int(r.id_a), int(r.tier_a or 0)
                loser_id, loser_tier = int(r.id_b), int(r.tier_b or 0)
            else:
                winner_id, winner_tier = int(r.id_b), int(r.tier_b or 0)
                loser_id, loser_tier = int(r.id_a), int(r.tier_a or 0)
            out.append(MergeCandidate(
                loser_id=loser_id, winner_id=winner_id,
                similarity=float(r.similarity),
                loser_tier=loser_tier, winner_tier=winner_tier,
            ))
        return out

    async def _propose(self, user_id: int, c: MergeCandidate) -> bool:
        """Create a PENDING proposal unless one already exists for the pair."""
        existing = (await self.db.execute(
            select(KgMergeProposal.id).where(
                KgMergeProposal.status == KG_MERGE_PROPOSAL_PENDING,
                KgMergeProposal.loser_entity_id.in_([c.loser_id, c.winner_id]),
                KgMergeProposal.winner_entity_id.in_([c.loser_id, c.winner_id]),
            )
        )).first()
        if existing:
            return False
        reason = (
            KG_MERGE_REASON_CROSS_TIER if c.loser_tier != c.winner_tier
            else KG_MERGE_REASON_GRAY_ZONE
        )
        self.db.add(KgMergeProposal(
            user_id=user_id,
            loser_entity_id=c.loser_id,
            winner_entity_id=c.winner_id,
            similarity=c.similarity,
            loser_tier=c.loser_tier,
            winner_tier=c.winner_tier,
            reason=reason,
        ))
        await self.db.flush()
        return True

    async def run_for_user(self, user_id: int) -> ReconcileReport:
        """One reconciler pass for a user. Idempotent."""
        report = ReconcileReport(user_id=user_id)
        pairs = await self.find_duplicate_pairs(user_id)
        report.candidates = len(pairs)

        auto_t = settings.kg_reconciler_auto_merge_threshold
        cap = settings.kg_reconciler_max_per_run
        touched: set[int] = set()
        for c in pairs[:cap]:
            if c.loser_id in touched or c.winner_id in touched:
                continue  # transitive-cluster guard
            try:
                if c.loser_tier == c.winner_tier and c.similarity >= auto_t:
                    kg = KnowledgeGraphService(self.db)
                    res = await kg.merge_entities(c.loser_id, c.winner_id)
                    if res is not None:
                        touched.add(c.loser_id)
                        report.auto_merged += 1
                elif await self._propose(user_id, c):
                    touched.add(c.loser_id)
                    touched.add(c.winner_id)
                    report.proposed += 1
            except Exception as e:  # noqa: BLE001
                report.notes.append(
                    f"reconcile failed loser={c.loser_id} winner={c.winner_id}: {e}"
                )

        await self.db.commit()
        if report.auto_merged or report.proposed:
            logger.info(
                f"🔗 KG reconciler user={user_id}: auto_merged={report.auto_merged}, "
                f"proposed={report.proposed}, candidates={report.candidates}"
            )
        return report

    async def approve_proposal(self, proposal_id: int, resolved_by: int | None = None) -> KGEntity | None:
        """Apply a pending proposal: merge loser -> winner, mark approved.

        Returns the surviving entity, or None if the proposal is missing/already
        resolved or the merge was a no-op.
        """
        p = (await self.db.execute(
            select(KgMergeProposal).where(KgMergeProposal.id == proposal_id)
        )).scalar_one_or_none()
        if p is None or p.status != KG_MERGE_PROPOSAL_PENDING:
            return None
        survivor = await KnowledgeGraphService(self.db).merge_entities(
            p.loser_entity_id, p.winner_entity_id
        )
        # merge_entities commits; re-load the proposal in the fresh txn to mark it.
        p = (await self.db.execute(
            select(KgMergeProposal).where(KgMergeProposal.id == proposal_id)
        )).scalar_one_or_none()
        if p is not None:
            from models.database import KG_MERGE_PROPOSAL_APPROVED
            p.status = KG_MERGE_PROPOSAL_APPROVED
            p.resolved_at = datetime.now(UTC).replace(tzinfo=None)
            p.resolved_by_user_id = resolved_by
            await self.db.commit()
        return survivor

    async def reject_proposal(self, proposal_id: int, resolved_by: int | None = None) -> bool:
        p = (await self.db.execute(
            select(KgMergeProposal).where(KgMergeProposal.id == proposal_id)
        )).scalar_one_or_none()
        if p is None or p.status != KG_MERGE_PROPOSAL_PENDING:
            return False
        from models.database import KG_MERGE_PROPOSAL_REJECTED
        p.status = KG_MERGE_PROPOSAL_REJECTED
        p.resolved_at = datetime.now(UTC).replace(tzinfo=None)
        p.resolved_by_user_id = resolved_by
        await self.db.commit()
        return True
