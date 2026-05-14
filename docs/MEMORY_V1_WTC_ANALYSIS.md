# Within-Turn-Contradiction Hit/Miss Analysis (2026-05-14)

Investigates the 4 within_turn_contradiction turns v1 correctly NOOPed
vs the 19 it missed. Pattern is counter-intuitive: **v1's LLM
(qwen3.6:latest on cuda.local) handles AMBIGUOUS turns reasonably but
extracts confidently on the CLEAREST retractions** — exactly inverted
from what's useful.

Source: `baseline-runs/memory_v1_baseline_20260514-113952.json`.

## Latency tells the whole story

| Outcome | Count | Latency p50 | Latency range |
|---|---:|---:|---:|
| NOOP (correct) | 4 | 1.58s | 1.51–1.68s |
| ADD (wrong) | 19 | 5.78s | 4.38–14.46s |

The 4 NOOPs all clustered at ~1.5s — the LLM saw the message, found
nothing extractable, returned `[]` quickly. The 19 ADDs all took
4-14s — the LLM processed the input and confidently extracted a fact.

That tight latency clustering is a real diagnostic signal. v1's qwen3.6
has a fast "I see no clean fact here" reflex when the turn is fuzzy.
The slow ADDs are confident-but-wrong responses.

## The 4 HITS — hedged refinements

```
reva-wtc-07: "Hotfixes laufen immer über UAT. Naja, nicht immer,
              das hängt vom Risiko ab."
reva-wtc-09: "Backend-Team macht den Cut. Naja, Web-Team eigentlich auch."
reva-wtc-11: "Ich pinge die Ops bei Issues. Nicht direkt, eher per Ticket."
reva-wtc-12: "Wir mergen direkt nach Code-Review. Naja, wir warten auf CI."
```

Shape: `X. Naja, nicht-X` / `X. Auch Y` / `X. Eher Y`. The second
clause **softens / nuances / adds** — it doesn't negate. The whole
turn is closer to "process is X but with caveats" than to "I was
wrong, retract X."

These ARE arguably extractable — with nuance. "Hotfixes mostly via UAT,
risk-based exceptions" is a reasonable conversational memory. The
corpus marks them as NOOP-expected; the LLM does NOOP them. Both
agree, but the corpus and the LLM might both be slightly wrong about
what's right.

## The 19 MISSES — blunt flips and replacements

| Turn | Type | Message |
|---|---|---|
| reva-wtc-01 | FLIP | "Ich liebe X. Eigentlich finde ich es nervig." |
| reva-wtc-02 | FLIP | "Ich brauche täglich. Eigentlich reichen wöchentliche." |
| reva-wtc-03 | REPLACE | "Mobile höchste Priorität. Naja, Web wichtiger." |
| reva-wtc-04 | FLIP | "I prefer dark mode. Actually hard to read." |
| reva-wtc-05 | REPLACE | "Maria ist RM. Ach nein, Stefan übernommen." |
| reva-wtc-06 | REPLACE | "Launchen Freitag. Eigentlich verschoben Montag." |
| reva-wtc-08 | REPLACE | "Nightly. Actually daily during freeze." |
| reva-wtc-10 | FLIP | "Auf Track. Eigentlich Verzögerung." |
| reva-wtc-13 | REPLACE | "Confluence ist Source of Truth. Eigentlich Jira." |
| reva-wtc-14 | REPLACE | "I rely on dashboard. Actually email." |
| reva-wtc-15 | FLIP | "Quartals-Retros sind Pflicht. Manchmal lassen wir aus." |
| renfield-wtc-01 | FLIP | "Liebe Mangos. Eigentlich mag ich keine." |
| renfield-wtc-02 | REPLACE | "Liebe Hip-Hop. Eigentlich Pop ist besser." |
| renfield-wtc-03 | REPLACE | "Frühstück um 8. Lieber 9." |
| renfield-wtc-04 | REPLACE | "22°C. Actually 20°C." |
| renfield-wtc-05 | REPLACE | "Schau Netflix. Eigentlich Disney+ heute." |
| renfield-wtc-06 | REFINE→FLIP | "Rote Weine. Weisse besser im Sommer." |
| renfield-wtc-07 | REPLACE | "Shower morning. Actually evenings." |
| renfield-wtc-08 | REPLACE | "Bäckerei Hauptstraße. Lieber die andere." |

Shape: `X. Eigentlich nicht-X` / `X. Actually Y` / `X. Ach nein, Y`.
The second clause **negates or replaces** the first. The user is
explicitly retracting; the right behavior is NOOP (or UPDATE on a
prior memory if it exists).

v1 extracts the first half anyway. 19 of 19 blunt-retraction turns
got it wrong.

## The signal — German "eigentlich" / English "actually"

Both "eigentlich" and "actually" are textbook retraction markers in
their respective languages — and exactly the markers v1's LLM fails
to honor.

Counts in the 19 misses:
- "Eigentlich" / "actually": **15 of 19** turns
- "Ach nein" / "Wait no": 1
- "Lieber" (preference flip): 3 (renfield-wtc-03, -08; one missed because no eigentlich)
- "Manchmal" (frequency flip): 1
- "Naja" + flip: 1 (reva-wtc-03 had "Naja" but was REPLACE not refinement)

So a regex on `\b(eigentlich|actually|ach nein|stattdessen|lieber|instead|scratch that)\b`
would catch ~16 of 19 misses pre-LLM. But that's hacky — better to fix the prompt.

## v2 prompt-design implications

1. **Explicit retraction-marker instruction.** The v2 extraction prompt
   must instruct the model:
   > Before extracting any fact, scan the user_message for retraction
   > markers within the same turn: "eigentlich nicht", "ach nein",
   > "doch nicht", "lieber", "stattdessen", "actually not", "wait no",
   > "instead", "rather", "scratch that". If a retraction marker
   > FOLLOWS an initial assertion, the user is rescinding the assertion.
   > Either emit NOOP (no clean fact) or emit only the retracted-to
   > variant — never the original assertion.

2. **Few-shot examples.** Both flavors (reva + renfield) need explicit
   "Eigentlich/Actually → NOOP" examples in the prompt's few-shot
   section. Currently `prompts/memory.yaml` has only positive ADD
   examples; no retraction-marker examples.

3. **Hedged refinements stay as model judgment.** The 4 HITS suggest
   qwen3.6 has decent instinct on "naja/das hängt/eher" style hedging.
   Don't over-engineer this case; let the model NOOP fuzzy turns.

4. **Eval YAML cases (Lane B/2 fixture).** Split within_turn_contradiction
   into two sub-categories in `fixtures/memory_extraction_eval.yaml`:
   - `blunt_retraction`: must NOOP (or UPDATE on prior memory)
   - `hedged_refinement`: NOOP acceptable; nuanced ADD also acceptable

5. **Corpus label question.** The renfield-wtc-06 case ("rote Weine.
   Weisse besser im Sommer") is genuinely ambiguous — that's a
   conditional preference, not a contradiction. Worth re-labeling
   in the corpus from `within_turn_contradiction` to something like
   `conditional_preference` or just `pure_add` (with a more nuanced
   expected fact: "prefers red wine year-round but white wine in
   summer"). Same applies to reva-wtc-07 ("hotfixes immer via UAT.
   Naja, nicht immer...") which is more "process with exceptions"
   than "I take it back."

## Logged as learnings

```
within-turn-contradiction-retraction-markers (architecture, confidence 9)
qwen3.6-extraction-latency-tells-confidence (operational, confidence 8)
```

## Run details

| | |
|---|---|
| Branch | feat/memory-arch-phase-0-baseline |
| Commit | b26aa56 (the run that produced the JSON) |
| LLM | qwen3.6:latest on cuda.local:11434 (Q4_K_M MoE, RTX 5090) |
| Corpus turns | 23 within_turn_contradiction (15 reva + 8 renfield) |
| Date | 2026-05-14 |
