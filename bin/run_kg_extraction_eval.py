#!/usr/bin/env python3
"""KG extraction CI eval — Structured Memory Phase 2 (D6).

Gates the conversation KG-extraction prompt against hard per-case expectations:
subject-binding (facts about different people never conflate), multi-type
entities, and tastes-as-relations (no generic "Musik" node).

Two layers, mirroring the memory eval (run_memory_extraction_eval.py):
  - ``check_expectations(entities, relations, expect)`` — a PURE function
    (no LLM, no DB) asserting a case's expect-block against extracted
    entity/relation dicts. Unit-tested in tests/eval/test_kg_extraction_eval_runner.py.
  - ``run_case`` — builds the real prompt + calls the extraction LLM + parses,
    then check_expectations. Needs Ollama, so it runs on-demand (not in the
    unit suite).

Expect-block keys (see tests/eval/kg_extraction_eval.yaml):
  entities_must_include:      list of {name, type?, types_include?}
  entities_must_not_include:  list of names that must NOT be extracted
  relations_must_include:     list of {subject?, predicate?(substring), object?}
  relations_must_not_include: list of the same matcher; case fails if any match
  entity_count_at_most:       int
  relations_count_at_least:   int
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _norm(s) -> str:
    return str(s or "").strip().lower()


def _entity_matches(ent: dict, spec: dict) -> bool:
    if _norm(ent.get("name")) != _norm(spec.get("name")):
        return False
    if "type" in spec and _norm(ent.get("type")) != _norm(spec["type"]):
        return False
    if "types_include" in spec:
        have = {_norm(t) for t in (ent.get("types") or [ent.get("type")]) if t}
        if not {_norm(t) for t in spec["types_include"]}.issubset(have):
            return False
    return True


def _relation_matches(rel: dict, spec: dict) -> bool:
    if "subject" in spec and _norm(rel.get("subject")) != _norm(spec["subject"]):
        return False
    if "object" in spec and _norm(rel.get("object")) != _norm(spec["object"]):
        return False
    if "predicate" in spec and _norm(spec["predicate"]) not in _norm(rel.get("predicate")):
        return False
    return True


def check_expectations(
    entities: list[dict],
    relations: list[dict],
    expect: dict,
) -> tuple[bool, list[str]]:
    """Apply a case's expect-block to extracted entities/relations. Pure."""
    failures: list[str] = []

    for spec in expect.get("entities_must_include", []):
        if not any(_entity_matches(e, spec) for e in entities):
            failures.append(f"missing entity: {spec}")

    for name in expect.get("entities_must_not_include", []):
        if any(_norm(e.get("name")) == _norm(name) for e in entities):
            failures.append(f"forbidden entity present: {name!r}")

    for spec in expect.get("relations_must_include", []):
        if not any(_relation_matches(r, spec) for r in relations):
            failures.append(f"missing relation: {spec}")

    for spec in expect.get("relations_must_not_include", []):
        if any(_relation_matches(r, spec) for r in relations):
            failures.append(f"forbidden relation present (conflation?): {spec}")

    if "entity_count_at_most" in expect:
        cap = int(expect["entity_count_at_most"])
        if len(entities) > cap:
            failures.append(f"too many entities: {len(entities)} > {cap}")

    if "relations_count_at_least" in expect:
        need = int(expect["relations_count_at_least"])
        if len(relations) < need:
            failures.append(f"too few relations: {len(relations)} < {need}")

    return (not failures), failures


def load_cases(fixture: Path) -> list[dict]:
    import yaml
    data = yaml.safe_load(fixture.read_text(encoding="utf-8"))
    return data.get("cases", [])


async def _extract(case: dict) -> tuple[list[dict], list[dict]]:
    """Run the real extraction prompt+LLM+parse for one case (needs Ollama)."""
    from services.knowledge_graph_service import KnowledgeGraphService
    from services.prompt_manager import prompt_manager
    from utils.config import settings
    from utils.llm_client import extract_response_content, get_classification_chat_kwargs, get_default_client

    svc = KnowledgeGraphService(None)  # parse helper only; no DB use
    lang = case.get("lang", "de")
    speaker = case.get("speaker")
    prompt = prompt_manager.get(
        "knowledge_graph", "extraction_prompt", lang=lang,
        user_message=case["user_message"],
        assistant_response=case.get("assistant_response", ""),
        speaker_clause=svc._build_speaker_clause(speaker, lang),
    )
    system_msg = prompt_manager.get("knowledge_graph", "extraction_system", lang=lang)
    model = settings.kg_extraction_model or settings.ollama_model
    client = get_default_client()
    resp = await client.chat(
        model=model,
        messages=[{"role": "system", "content": system_msg}, {"role": "user", "content": prompt}],
        options=prompt_manager.get_config("knowledge_graph", "llm_options") or {},
        **get_classification_chat_kwargs(model),
    )
    parsed = svc._parse_extraction_response(extract_response_content(resp)) or {}
    return parsed.get("entities", []), parsed.get("relations", [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fixture", default=str(Path(__file__).resolve().parents[1] / "tests/eval/kg_extraction_eval.yaml"))
    parser.add_argument("--case", default=None, help="run only the case with this id")
    args = parser.parse_args()

    import asyncio

    fixture = Path(args.fixture)
    if not fixture.exists():
        sys.exit(f"fixture not found: {fixture}")
    cases = load_cases(fixture)
    if args.case:
        cases = [c for c in cases if c.get("id") == args.case] or sys.exit(f"no case {args.case!r}")

    failed = 0
    for case in cases:
        entities, relations = asyncio.run(_extract(case))
        passed, failures = check_expectations(entities, relations, case["expect"])
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {case['id']}")
        for f in failures:
            print(f"        - {f}")
        failed += 0 if passed else 1

    print(f"\n{len(cases) - failed}/{len(cases)} cases passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
