"""Shared merge concurrency guard (D5 from the Structured-Memory eng review).

Two merge paths in the codebase collapse near-duplicate rows by pointing the
loser at a surviving "canonical" row and marking the loser inactive:

  - ``SkillCuratorService.merge_pair`` — procedural_skills.merged_into_id +
    status == ARCHIVED.
  - ``KnowledgeGraphService.merge_entities`` — kg_entities.canonical_id +
    is_active == False.

The bodies differ (skills carry triggers/counts; entities additionally reparent
kg_relations FKs), but the *correctness-critical* check is identical and must
stay byte-identical across both: after acquiring ``SELECT ... FOR UPDATE`` on a
row, has a concurrent pass ALREADY merged it? If so the current pass must bail,
or it double-applies the absorb (double-counted outcomes, double-reparented
FKs). D5 extracted exactly this one predicate so the two callers can never drift.
"""
from __future__ import annotations


def is_already_merged(*, canonical_pointer: object, is_live: bool) -> bool:
    """True if a row has already been merged away by another pass.

    A row is "already merged" (so this pass must skip it) when EITHER it carries
    a non-NULL pointer to its survivor (``merged_into_id`` / ``canonical_id``) OR
    it is no longer live (``is_active=False`` / ``status != APPROVED``).

    Both arms matter: a crashed prior pass could leave a row inactive without a
    pointer, or (defensively) a pointer without the inactive flag — either state
    means "don't merge this again".

    Args:
        canonical_pointer: the survivor-pointer column value (None == not merged).
        is_live: whether the row is still in its active/approved live state.
    """
    return canonical_pointer is not None or not is_live
