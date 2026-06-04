"""Postgres-only tests for KgReconcilerService (Structured Memory Phase 1, T5).

Real PG via ``pg_db_session`` (halfvec self-join + the proposals table). The
reconciler and merge_entities commit internally; under the rollback-isolated
fixture we patch commit/rollback -> flush. KnowledgeGraphService._get_embedding
is class-patched (auto-merge recomputes the survivor embedding).
"""
from __future__ import annotations

import math
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    EMBEDDING_DIMENSION,
    KG_MERGE_PROPOSAL_APPROVED,
    KG_MERGE_PROPOSAL_PENDING,
    KG_MERGE_PROPOSAL_REJECTED,
    KG_MERGE_PROPOSAL_SUPERSEDED,
    KG_MERGE_REASON_CROSS_TIER,
    KGEntity,
    KgMergeProposal,
    Role,
    User,
)
from services.knowledge_graph_service import KnowledgeGraphService
from services.kg_reconciler_service import _RECONCILER_LOCK_NS, KgReconcilerService

pytestmark = [pytest.mark.postgres, pytest.mark.asyncio]


def _unit(i: int) -> list[float]:
    v = [0.0] * EMBEDDING_DIMENSION
    v[i % EMBEDDING_DIMENSION] = 1.0
    return v


def _gray() -> list[float]:
    # cosine ~0.9 vs _unit(0): in (candidate 0.85, auto 0.95) -> gray zone
    v = [0.0] * EMBEDDING_DIMENSION
    v[0] = 0.9
    v[1] = math.sqrt(1 - 0.81)
    return v


async def _make_user(db: AsyncSession, name: str) -> User:
    role = Role(name=f"{name}_role")
    db.add(role)
    await db.flush()
    u = User(username=name, email=f"{name}@ex.test", password_hash="x",
             role_id=role.id, is_active=True)
    db.add(u)
    await db.flush()
    return u


async def _entity(db, owner, name, *, tier=0, mention=1, emb=None, etype="person") -> KGEntity:
    e = KGEntity(user_id=owner.id, name=name, entity_type=etype, circle_tier=tier,
                 mention_count=mention, embedding=emb)
    db.add(e)
    await db.flush()
    return e


def _recon(db, monkeypatch) -> KgReconcilerService:
    monkeypatch.setattr(db, "commit", db.flush)
    monkeypatch.setattr(db, "rollback", db.flush)
    monkeypatch.setattr(KnowledgeGraphService, "_get_embedding",
                        AsyncMock(return_value=_unit(3)))
    return KgReconcilerService(db)


async def _count_pending(db, uid) -> int:
    return (await db.execute(text(
        "SELECT count(*) FROM kg_merge_proposals WHERE user_id = :u AND status = 'pending'"
    ), {"u": uid})).scalar_one()


class TestFindPairs:
    async def test_finds_similar_pair_and_picks_winner(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_find")
        # identical embeddings -> cosine ~1.0; b has more mentions -> winner
        await _entity(pg_db_session, owner, "Alice", mention=2, emb=_unit(5))
        big = await _entity(pg_db_session, owner, "Alice B.", mention=9, emb=_unit(5))
        rec = _recon(pg_db_session, monkeypatch)

        pairs = await rec.find_duplicate_pairs(owner.id)
        assert len(pairs) == 1
        assert pairs[0].winner_id == big.id  # more mentions wins


class TestRunForUser:
    async def test_same_tier_high_sim_auto_merges(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_auto")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        b = await _entity(pg_db_session, owner, "Alice B.", tier=0, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)

        report = await rec.run_for_user(owner.id)
        assert report.auto_merged == 1
        assert report.proposed == 0
        # loser tombstoned
        loser = a if b.mention_count >= a.mention_count else b
        tomb = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == loser.id)
        )).scalar_one()
        assert tomb.is_active is False and tomb.canonical_id is not None

    async def test_cross_tier_proposes_not_merges(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_cross")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        b = await _entity(pg_db_session, owner, "Alice B.", tier=2, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)

        report = await rec.run_for_user(owner.id)
        assert report.auto_merged == 0
        assert report.proposed == 1
        assert await _count_pending(pg_db_session, owner.id) == 1
        # nothing merged — both still active
        for e in (a, b):
            row = (await pg_db_session.execute(
                select(KGEntity).where(KGEntity.id == e.id)
            )).scalar_one()
            assert row.is_active is True

    async def test_gray_zone_same_tier_proposes(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_gray")
        await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(0))
        await _entity(pg_db_session, owner, "Alice B.", tier=0, mention=9, emb=_gray())
        rec = _recon(pg_db_session, monkeypatch)

        report = await rec.run_for_user(owner.id)
        # ~0.9 similarity: candidate but below auto (0.95) -> proposal, no merge
        assert report.auto_merged == 0
        assert report.proposed == 1

    async def test_backfill_embeds_null_entities_then_reconciles(self, pg_db_session, monkeypatch):
        # #6: entities born without an embedding are invisible to the self-join;
        # the pass backfills them first, so they become reconcilable same run.
        owner = await _make_user(pg_db_session, "rec_backfill")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=None)
        b = await _entity(pg_db_session, owner, "Alice B.", tier=0, mention=9, emb=None)
        rec = _recon(pg_db_session, monkeypatch)  # _get_embedding -> _unit(3) for both

        # before backfill: NULL embeddings -> no candidate pairs at all
        assert await rec.find_duplicate_pairs(owner.id) == []

        report = await rec.run_for_user(owner.id)
        assert report.embedded_backfilled == 2
        # identical backfilled embedding -> same-tier high-sim pair -> auto-merge
        assert report.auto_merged == 1
        for e in (a, b):
            row = (await pg_db_session.execute(
                select(KGEntity).where(KGEntity.id == e.id)
            )).scalar_one()
            assert row.embedding is not None

    async def test_concurrent_run_skips_when_locked(self, pg_db_session, pg_async_engine, monkeypatch):
        # #4: a second overlapping run for the same user finds the per-user
        # advisory lock held and returns a no-op report instead of redoing work.
        owner = await _make_user(pg_db_session, "rec_lock")
        await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        await _entity(pg_db_session, owner, "Alice B.", tier=0, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)

        async with pg_async_engine.connect() as holder:
            got = (await holder.execute(
                text("SELECT pg_try_advisory_lock(:ns, :uid)"),
                {"ns": _RECONCILER_LOCK_NS, "uid": owner.id},
            )).scalar()
            assert got is True
            try:
                report = await rec.run_for_user(owner.id)
                # lock held -> skipped despite an obvious same-tier dup pair
                assert report.candidates == 0
                assert report.auto_merged == 0
                assert any("skipped" in n for n in report.notes)
            finally:
                await holder.execute(
                    text("SELECT pg_advisory_unlock(:ns, :uid)"),
                    {"ns": _RECONCILER_LOCK_NS, "uid": owner.id},
                )

    async def test_idempotent_second_run_no_new_proposals(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_idem")
        await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        await _entity(pg_db_session, owner, "Alice B.", tier=2, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)

        r1 = await rec.run_for_user(owner.id)
        r2 = await rec.run_for_user(owner.id)
        assert r1.proposed == 1
        assert r2.proposed == 0  # pending proposal excludes the pair
        assert await _count_pending(pg_db_session, owner.id) == 1


class TestApproveReject:
    async def test_approve_merges_and_marks(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_appr")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        b = await _entity(pg_db_session, owner, "Alice B.", tier=2, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)
        await rec.run_for_user(owner.id)
        pid = (await pg_db_session.execute(
            select(KgMergeProposal.id).where(KgMergeProposal.user_id == owner.id)
        )).scalar_one()

        survivor = await rec.approve_proposal(pid, resolved_by=owner.id)
        assert survivor is not None and survivor.id == b.id
        prop = (await pg_db_session.execute(
            select(KgMergeProposal).where(KgMergeProposal.id == pid)
        )).scalar_one()
        assert prop.status == KG_MERGE_PROPOSAL_APPROVED
        loser = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == a.id)
        )).scalar_one()
        assert loser.is_active is False

    async def test_reject_marks_no_merge(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "rec_rej")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        await _entity(pg_db_session, owner, "Alice B.", tier=2, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)
        await rec.run_for_user(owner.id)
        pid = (await pg_db_session.execute(
            select(KgMergeProposal.id).where(KgMergeProposal.user_id == owner.id)
        )).scalar_one()

        assert await rec.reject_proposal(pid, resolved_by=owner.id) is True
        prop = (await pg_db_session.execute(
            select(KgMergeProposal).where(KgMergeProposal.id == pid)
        )).scalar_one()
        assert prop.status == KG_MERGE_PROPOSAL_REJECTED
        loser = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == a.id)
        )).scalar_one()
        assert loser.is_active is True  # rejection does not merge

    async def test_overlapping_approve_marks_superseded(self, pg_db_session, monkeypatch):
        # #3: two pending proposals share entity b (b->a and c->b). Approving
        # the first tombstones b; approving the second is a no-op merge, so it
        # closes as SUPERSEDED rather than a misleading APPROVED.
        owner = await _make_user(pg_db_session, "rec_super")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=9, emb=_unit(6))
        b = await _entity(pg_db_session, owner, "Alice B.", tier=2, mention=2, emb=_unit(6))
        c = await _entity(pg_db_session, owner, "Alice C.", tier=2, mention=5, emb=_unit(6))
        p1 = KgMergeProposal(
            user_id=owner.id, loser_entity_id=b.id, winner_entity_id=a.id,
            similarity=0.9, loser_tier=2, winner_tier=0, reason=KG_MERGE_REASON_CROSS_TIER,
        )
        p2 = KgMergeProposal(
            user_id=owner.id, loser_entity_id=c.id, winner_entity_id=b.id,
            similarity=0.9, loser_tier=2, winner_tier=2, reason=KG_MERGE_REASON_CROSS_TIER,
        )
        pg_db_session.add_all([p1, p2])
        await pg_db_session.flush()
        rec = _recon(pg_db_session, monkeypatch)

        s1 = await rec.approve_proposal(p1.id, resolved_by=owner.id)
        assert s1 is not None and s1.id == a.id  # b merged into a

        s2 = await rec.approve_proposal(p2.id, resolved_by=owner.id)
        assert s2 is None  # winner b already tombstoned -> no-op

        prop2 = (await pg_db_session.execute(
            select(KgMergeProposal).where(KgMergeProposal.id == p2.id)
        )).scalar_one()
        assert prop2.status == KG_MERGE_PROPOSAL_SUPERSEDED
        # c was never touched by the no-op merge
        c_row = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == c.id)
        )).scalar_one()
        assert c_row.is_active is True and c_row.canonical_id is None

    async def test_approve_override_winner(self, pg_db_session, monkeypatch):
        # D2 survivor toggle: owner keeps the LESS-mentioned entity instead of
        # the reconciler's default (more-mentioned) winner.
        owner = await _make_user(pg_db_session, "rec_swap")
        a = await _entity(pg_db_session, owner, "Alice", tier=0, mention=2, emb=_unit(6))
        b = await _entity(pg_db_session, owner, "Alice B.", tier=2, mention=9, emb=_unit(6))
        rec = _recon(pg_db_session, monkeypatch)
        await rec.run_for_user(owner.id)
        pid = (await pg_db_session.execute(
            select(KgMergeProposal.id).where(KgMergeProposal.user_id == owner.id)
        )).scalar_one()

        # default winner is b (more mentions); override to keep a
        survivor = await rec.approve_proposal(pid, resolved_by=owner.id, winner_id=a.id)
        assert survivor is not None and survivor.id == a.id
        b_row = (await pg_db_session.execute(
            select(KGEntity).where(KGEntity.id == b.id)
        )).scalar_one()
        assert b_row.is_active is False  # b became the loser
