# Open Follow-Ups — refreshed 2026-05-21

Shipped / superseded items from the old voice-pipeline plan:

| Item | Reality |
|---|---|
| Phase A — streaming-first pipeline | Shipped: PR #509 (`faster-whisper` streaming + in-process Piper + singleton dedup), PR #534 (partial text + activation) |
| Phase C — voice tier on GPU | Shipped: PR #531 (`voice-server` pod live on `k8s-gpu-3`); PR #532 wired `whisper_service` + `piper_service` thin-client delegation via `voice_server_url` |
| Phase B.5 — XTTS-v2 evaluation | Shipped: PR #539 (decision: stay on Piper) |
| End-of-utterance robustness | Shipped: PRs #535, #536 ("5 compounded design flaws") |
| Voice-originated tool-call guard | Shipped: PR #542 (`verify_tool_call` hook + `voice_originated` ContextVar) |
| **Voice barge-in (Fork A acoustic)** | **In review: PR #601** — interrupt the assistant by speaking. T1–T5 done; AEC spike passed 6.77×; two independent reviews. Plan: `tasks/voice-barge-in-plan.md`. Post-merge: run the PR's manual-test checklist on staging. |
| Cosmetic `AGENT_MODEL=qwen3.6` | Done in `k8s/configmap.yaml` |
| `:llama-rc5` re-tag to versioned | Moot — backend is on `:latest` with `imagePullPolicy: Always` |
| Reva submodule bump (Stage 1) | Moot — submodule pointer is current (`v2.6.1-21-g856ae13`) |

Voice runs through `/ws/voice` on the `voice-server` pod with the frontend `useVoiceStream` hook, gated by `VITE_FEATURE_VOICE_STREAM=true`. Frames use the `RFWA` binary header (4-byte magic + 16-byte UUID + 4-byte sequence).

---

## 1. Voice — edge STT (Phase B-original) — re-evaluate

Original idea: `window.SpeechRecognition` in-browser, send only final text. Since the voice-server is now GPU-fast (<2 s STT for 10 s audio per the original Phase C estimate), this may no longer be worth the multi-engine complexity. Action: park unless someone measures a concrete win.

## 2. Voice — Speech-to-Speech (Phase D) — tracking only

Not actionable. Watch upstream releases of Moshi (Kyutai), Llama-Voice, Qwen-Voice. Migrate when a stable open-weights model fits in 16-32 GB VRAM at acceptable quality with built-in barge-in.

---

## 3. Vision tier (`Qwen3-VL`) reactivation

Still off in production: `k8s/configmap.yaml` → `OLLAMA_VISION_MODEL: ""`. Plan unchanged from old file:

a) **Third llama-server pod on `k8s-gpu-2`** (CPU-only) with `Qwen3-VL-4B-Q4_K_M`. 30-60 s/Bild on CPU is acceptable for sporadic use (satellite-camera, Paperless OCR fallback). **Recommended.**

b) Reva's existing cuda.local Qwen3-VL via new `LLM_OPENAI_VISION_BASE_URL` env. Cross-project coupling — would need Reva-owner sign-off.

c) Drop vision entirely if the use-cases don't justify the effort.

---

## 4. Reva cross-migration — Stages 2 + 3 still open

Stage 1 (submodule bump) is moot; current pointer tracks main. Open:

- **Stage 2 (1-2 h)** — make `reva.llm.openai_client.OpenAIClient` extend `renfield.utils.llm_client.OpenAICompatibleClient` so Reva inherits the `_OllamaShapedMessage`/`_OllamaShapedResponse` wrappers, `_options_to_openai`, `_think_extra_body`, `_convert_messages` (incl. Qwen3 thinking-mode workaround). Reva keeps `_log_llm_exchange` trace logging and multi-backend dispatch (Anthropic, vLLM) as overrides.
- **Stage 3 (1 h + prod-validation)** — drop per-role `ollama_url: "http://cuda.local:8081/v1"` in `reva/config/agent_roles.yaml`; switch to platform-level `LLM_OPENAI_BASE_URL` + per-tier `LLM_OPENAI_FOR_*` flags for opt-outs.

Neither urgent; Reva works as-is.

---

## 5. Local repo cleanup

- `git fetch -p && git branch -vv | awk '/: gone]/ {print $1}' | xargs -r git branch -D`
- `git stash list` — check for stale WIP stashes and drop if obsolete

---

*Last refreshed 2026-05-21 after voice barge-in (T1–T5) shipped to PR #601.*
