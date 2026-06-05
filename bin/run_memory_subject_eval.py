#!/usr/bin/env python3
"""
Memory subject-extraction eval (Phase 3 bridge feeder).

Runs the v1 extraction path (prompt + live model + parse) per gold case and
asserts the `subject` field: named-subject recall + no pronoun/role leak. The
bridge/subsume are useless if `subject` is wrong, so this guards the upstream.

NOT a CI test — needs the prod extraction model. Run in a backend pod:
    kubectl -n renfield exec deploy/backend -c backend -- \\
      python bin/run_memory_subject_eval.py /tests/eval/memory_subject_extraction_eval.yaml

Exit 0 = all cases pass; exit 1 = any failure (use as a gate before enabling
the bridge in a new deployment).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import yaml

_BACKEND = Path(__file__).resolve().parent.parent / "src" / "backend"
sys.path.insert(0, str(_BACKEND))

from services.conversation_memory_service import ConversationMemoryService  # noqa: E402
from services.database import AsyncSessionLocal  # noqa: E402
from services.prompt_manager import prompt_manager  # noqa: E402
from utils.config import settings  # noqa: E402
from utils.llm_client import extract_response_content, get_classification_chat_kwargs  # noqa: E402


async def _subjects_for(svc, client, model, lang, user, assistant) -> list:
    prompt = prompt_manager.get("memory", "extraction_prompt", lang=lang,
                                user_message=user, assistant_response=assistant)
    system = prompt_manager.get("memory", "extraction_system", lang=lang)
    resp = await client.chat(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        options={}, **get_classification_chat_kwargs(model),
    )
    items = svc._parse_extraction_response(extract_response_content(resp))
    return [i.get("subject") for i in items]


def _check(case: dict, subjects: list, forbidden: set) -> list[str]:
    fails = []
    norm = [(s or "").strip() for s in subjects]
    # leak guard (always on unless explicitly disabled)
    if case.get("expect", {}).get("forbid_role_pronoun", True):
        for s in norm:
            if s and s.lower() in forbidden:
                fails.append(f"role/pronoun leak: subject={s!r}")
    exp = case.get("expect", {})
    if exp.get("all_null"):
        if any(s for s in norm):
            fails.append(f"expected all-null subjects, got {subjects}")
    for name in exp.get("subjects_any", []):
        if not any(s.lower() == name.lower() for s in norm if s):
            fails.append(f"missing expected subject {name!r} (got {subjects})")
    return fails


async def main(path: str) -> int:
    spec = yaml.safe_load(Path(path).read_text())
    forbidden = {x.lower() for x in spec.get("forbidden_subjects", [])}
    cases = spec.get("cases", [])
    async with AsyncSessionLocal() as db:
        svc = ConversationMemoryService(db)
        client = await svc._get_chat_client()
        model = settings.memory_extraction_model or settings.ollama_model
        passed = 0
        for c in cases:
            subs = await _subjects_for(svc, client, model, c.get("lang", "de"),
                                       c["user"], c.get("assistant", "Ok."))
            fails = _check(c, subs, forbidden)
            status = "PASS" if not fails else "FAIL"
            if not fails:
                passed += 1
            print(f"[{status}] {c['id']:24s} subjects={subs}")
            for f in fails:
                print(f"         - {f}")
        print(f"--- {passed}/{len(cases)} cases passed (model={model}) ---")
        return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    p = sys.argv[1] if len(sys.argv) > 1 else "tests/eval/memory_subject_extraction_eval.yaml"
    raise SystemExit(asyncio.run(main(p)))
