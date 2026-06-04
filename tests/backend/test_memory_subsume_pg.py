"""Postgres-only tests for Phase 3-subsume (MEMORY_SUBSUME_TO_KG).

When on, decomposable facts (category=fact + subject) are NOT stored as flat
memories (they live in the KG); preferences / subject-less facts stay flat.
Off = every extracted item is saved (unchanged). Real PG via ``pg_db_session``;
the LLM call + parse are mocked so the loop runs deterministically.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import EMBEDDING_DIMENSION, Role, User
from services.conversation_memory_service import ConversationMemoryService
from utils.config import settings

pytestmark = [pytest.mark.postgres, pytest.mark.asyncio]

_ITEMS = [
    {"content": "Anna wohnt in Bonn", "category": "fact", "subject": "Anna", "importance": 0.6},
    {"content": "mag Jazz", "category": "preference", "subject": "Ich", "importance": 0.6},
    {"content": "es regnet draussen", "category": "fact", "subject": None, "importance": 0.4},
]


async def _make_user(db: AsyncSession, name: str) -> User:
    role = Role(name=f"{name}_role")
    db.add(role)
    await db.flush()
    u = User(username=name, email=f"{name}@ex.test", password_hash="x", role_id=role.id, is_active=True)
    db.add(u)
    await db.flush()
    return u


def _svc(db, monkeypatch, *, subsume: bool) -> ConversationMemoryService:
    monkeypatch.setattr(db, "commit", db.flush)
    monkeypatch.setattr(db, "rollback", db.flush)
    svc = ConversationMemoryService(db)
    # distinct one-hot per call so the save() dedup (cosine >= threshold) doesn't
    # collapse the test memories into one.
    _n = {"i": 0}

    def _emb(_content: str) -> list[float]:
        v = [0.0] * EMBEDDING_DIMENSION
        v[_n["i"] % EMBEDDING_DIMENSION] = 1.0
        _n["i"] += 1
        return v

    monkeypatch.setattr(svc, "_get_embedding", AsyncMock(side_effect=_emb))
    monkeypatch.setattr(svc, "should_extract_memories", lambda *a, **k: True)
    chat = AsyncMock()
    chat.chat = AsyncMock(return_value=object())  # content ignored — see below
    monkeypatch.setattr(svc, "_get_chat_client", AsyncMock(return_value=chat))
    # the module does a local `from utils.llm_client import extract_response_content`,
    # which resolves the attribute at call time — patch it there.
    import utils.llm_client as _llm
    monkeypatch.setattr(_llm, "extract_response_content", lambda r: "[]")
    monkeypatch.setattr(svc, "_parse_extraction_response", lambda raw: [dict(i) for i in _ITEMS])
    monkeypatch.setattr(settings, "memory_subsume_to_kg", subsume)
    monkeypatch.setattr(settings, "memory_kg_bridge_enabled", False)
    monkeypatch.setattr(settings, "memory_contradiction_resolution", False)
    return svc


class TestSubsume:
    async def test_off_saves_everything(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "sub_off")
        svc = _svc(pg_db_session, monkeypatch, subsume=False)
        saved = await svc._extract_and_save_v1_impl("u", "a", user_id=owner.id)
        contents = {m.content for m in saved}
        assert contents == {"Anna wohnt in Bonn", "mag Jazz", "es regnet draussen"}

    async def test_on_subsumes_fact_with_subject_only(self, pg_db_session, monkeypatch):
        owner = await _make_user(pg_db_session, "sub_on")
        svc = _svc(pg_db_session, monkeypatch, subsume=True)
        saved = await svc._extract_and_save_v1_impl("u", "a", user_id=owner.id)
        contents = {m.content for m in saved}
        assert "Anna wohnt in Bonn" not in contents   # fact + subject -> KG only
        assert "mag Jazz" in contents                  # preference stays flat
        assert "es regnet draussen" in contents        # fact without subject stays flat
