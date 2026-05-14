"""
Memory Ops — Pydantic v2 schema for Mem0-style batched extraction.

Single source of truth for the shape of the LLM tool call that v2
extraction emits. The prompt references field names; the Pydantic
classes enforce them. Reva's prompt override at
`reva/prompts/memory.yaml` MUST NOT redeclare op names or field names
— only negative constraints (GDPR / release-management). The CI test
`tests/backend/test_memory_prompt_consistency.py` (Lane D) enforces
that rule; the runtime startup check WARNs on drift.

See `docs/architecture/memory-architecture-plan.md` (Reva repo,
"Eng-review modifications" section) for the locked decisions:

- Op vocabulary: ADD | UPDATE | DELETE | NOOP
- target_id refers to `conversation_memories.id` (Integer, NOT UUID
  despite the plan text — confirmed against models/database.py:895)
- target_id is required for UPDATE and DELETE, and MUST be a member
  of the retrieve_top_K candidate set that the LLM saw. The service
  layer enforces this via `validate_against_candidates`; if drift
  occurred between retrieve and apply (optimistic concurrency), the
  whole batch is rejected and falls back to v1.
- DELETE maps to `is_active=false` (soft-delete). NO automated
  process flips this — DELETE is fired ONLY when the user explicitly
  retracts ("forget that I said X"). See plan §retention-posture.
- NOOP is a valid op (single NOOP in a list represents "extracted
  nothing meaningful this turn"). An empty list is ALSO valid and
  has the same semantics.
- importance uses Renfield's existing float 0.1–1.0 range, not the
  Mem0 paper's 1–5 integer (DB column is Float, default 0.5).

This module has no DB session, HTTP client, or LLM client imports —
the only `models.database` reference is the `MEMORY_CATEGORIES`
constant list (imported at module top). Tests for this module live
in `tests/backend/test_memory_ops.py` and consequently DO require
the backend sys.path to be set up so SQLAlchemy can be imported
transitively (the test rig uses the standard `tests/backend/conftest.py`).
Inlining `MEMORY_CATEGORIES` here is rejected — two sources of truth
for the valid-category set would silently drift.
"""

from __future__ import annotations

import enum
from typing import Iterator, Optional

from pydantic import BaseModel, Field, RootModel, field_validator, model_validator

# Imported from models.database; matches the canonical set used by v1.
from models.database import MEMORY_CATEGORIES


# Hard cap on batch size. Matches v1's `max_extracts = 10` cap (see
# conversation_memory_service.py:347). Set as a module-level constant
# rather than a magic number in the validator so tests + docs can
# reference the same name.
MAX_OPS_PER_BATCH = 10


# Hard cap on the `reason` field — keeps prompt output bounded and
# prevents the LLM from filling the field with paraphrased content.
MAX_REASON_CHARS = 500


# Hard cap on the `content` field — matches the existing
# memory_schemas.py MemoryCreateRequest cap so v2 ops can be saved
# through the same write path.
MAX_CONTENT_CHARS = 2000


class OpType(str, enum.Enum):
    """The four legal operations on a memory row.

    Inherits from `str` so JSON serialization round-trips through
    the LLM tool call as plain strings.
    """

    ADD = "ADD"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    NOOP = "NOOP"


class MemoryOp(BaseModel):
    """A single operation on the user's memory set.

    Field requirements vary by `op`:

    ADD     content + category required; target_id MUST NOT be set
    UPDATE  target_id + content required; category optional
    DELETE  target_id required; content/category MUST NOT be set
    NOOP    all other fields ignored (still validated for shape)

    The cross-field rules are enforced by the `validate_op_constraints`
    model validator below.
    """

    op: OpType

    # Integer FK to conversation_memories.id. Required for UPDATE / DELETE.
    # Must belong to the retrieve_top_K candidate set the LLM saw,
    # enforced by `validate_against_candidates` at apply time.
    target_id: Optional[int] = Field(default=None, ge=1)

    content: Optional[str] = Field(default=None, min_length=1, max_length=MAX_CONTENT_CHARS)

    # Must be one of MEMORY_CATEGORIES when set. Validator below.
    category: Optional[str] = None

    # Float 0.1–1.0 to match the existing DB column. The Mem0 paper
    # uses int 1–5; we keep Renfield's float range so v2 rows can
    # save through the same path as v1.
    importance: Optional[float] = Field(default=None, ge=0.1, le=1.0)

    # Free-text rationale the LLM emits for the human reviewer.
    # Capped to keep prompts bounded.
    reason: Optional[str] = Field(default=None, max_length=MAX_REASON_CHARS)

    @field_validator("category")
    @classmethod
    def _validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in MEMORY_CATEGORIES:
            raise ValueError(
                f"category must be one of {MEMORY_CATEGORIES}, got {v!r}"
            )
        return v

    @model_validator(mode="after")
    def _validate_op_constraints(self) -> "MemoryOp":
        """Cross-field rules per op type.

        Raises ValueError on violation. The service layer treats a
        ValueError here as `schema_reject` and bumps the fallback
        counter accordingly.
        """
        if self.op == OpType.ADD:
            if self.target_id is not None:
                raise ValueError("ADD ops must not carry target_id")
            if not self.content:
                raise ValueError("ADD requires content")
            if not self.category:
                raise ValueError("ADD requires category")
        elif self.op == OpType.UPDATE:
            if self.target_id is None:
                raise ValueError("UPDATE requires target_id")
            if not self.content:
                raise ValueError("UPDATE requires content")
            # category is OPTIONAL on UPDATE — preserves existing category if omitted
        elif self.op == OpType.DELETE:
            if self.target_id is None:
                raise ValueError("DELETE requires target_id")
            if self.content is not None:
                raise ValueError("DELETE must not carry content")
            if self.category is not None:
                raise ValueError("DELETE must not carry category")
        elif self.op == OpType.NOOP:
            # NOOP ignores all other fields; we still validate field
            # shapes above (e.g. importance range), but emit no
            # constraint on field PRESENCE. This matters because the
            # LLM may emit a NOOP with a reason ("nothing user-specific
            # in this turn") and that should not be rejected.
            pass
        return self


class MemoryOpsList(RootModel[list[MemoryOp]]):
    """A batch of MemoryOps emitted by the LLM in a single tool call.

    Constraints:
    - At most `MAX_OPS_PER_BATCH` ops per batch.
    - At most one op per target_id (no double-UPDATE / double-DELETE
      on the same row in one batch — would race against the per-batch
      transaction).
    - Empty list is valid (means "extracted nothing"). Semantically
      identical to `[NOOP]`.
    """

    @model_validator(mode="after")
    def _validate_batch(self) -> "MemoryOpsList":
        ops = self.root

        if len(ops) > MAX_OPS_PER_BATCH:
            raise ValueError(
                f"Batch contains {len(ops)} ops; max is {MAX_OPS_PER_BATCH}"
            )

        # No double-touching the same row in one batch.
        seen_ids: set[int] = set()
        for op in ops:
            if op.target_id is None:
                continue
            if op.target_id in seen_ids:
                raise ValueError(
                    f"target_id {op.target_id} appears in more than one op "
                    "(would race against the per-batch transaction)"
                )
            seen_ids.add(op.target_id)

        return self

    # Convenience iterator + len so the service layer can write
    # `for op in ops: ...` and `len(ops)` without poking at .root.
    def __iter__(self) -> Iterator[MemoryOp]:  # type: ignore[override]
        return iter(self.root)

    def __len__(self) -> int:
        return len(self.root)


def validate_against_candidates(
    ops: MemoryOpsList,
    candidate_ids: set[int],
) -> Optional[str]:
    """Reject the batch if any op references a target_id outside the
    candidate set the LLM saw (optimistic concurrency check).

    SECURITY CONTRACT — read before changing anything below:
        `candidate_ids` MUST be the result of a retrieve_top_K query
        already filtered by `user_id == asker_id` AND by Circles v1
        reachability (`conversation_memories_circles_filter`). This
        function ONLY checks set membership; it cannot tell whether
        an id belongs to the asker or to another user. If the caller
        passes a candidate set spanning two users (e.g. a buggy
        circle-traversal that over-fetches, or a future test fixture
        that forgets the filter), an LLM-supplied `target_id` could
        UPDATE / DELETE another user's memory row through the v2
        path with no schema-level barrier. Defense in depth: the
        service-layer apply step should re-check ownership on every
        target_id before commit. Lane B/2 will land that guard +
        an integration test that fails when the candidate set spans
        users.

    Returns:
        None if every op's target_id is either None (ADD / NOOP) or
        a member of `candidate_ids`. Otherwise returns a short
        reason string suitable for the
        `reva_memory_v2_fallback_total{reason}` counter label.

    Why this exists:
        v2 holds the advisory lock only around retrieve + apply
        (NOT around the LLM call) per OV-3 of the eng-review
        modifications. Between retrieve and apply, another task may
        have UPDATE/DELETEd one of the candidate rows, OR the LLM
        may have hallucinated a target_id it never saw. Either
        case is an `id_reject` and triggers fallback to v1.

    Callers should:
        rejection = validate_against_candidates(ops, candidate_ids)
        if rejection is not None:
            metrics.reva_memory_v2_fallback_total.labels(reason=rejection).inc()
            return await self._legacy_extract_and_save_fallback(...)
    """
    for op in ops:
        if op.target_id is None:
            continue
        if op.target_id not in candidate_ids:
            return "id_reject"
    return None
