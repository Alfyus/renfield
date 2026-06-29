# Handover — Graph-Expansion Retrieval Stage ("MemGraphRAG" fusion)

**Repo:** `ebongard/renfield`
**Feature working name:** `graph_expansion` (a.k.a. wiring true GraphRAG traversal into the existing cross-source RRF)
**Audience:** a local Claude Code agent with write access to the repo
**Status:** design brief — not yet implemented

---

## 0. How to read this document (READ FIRST)

This handover was written from the repository's **public documentation** (`README.md`,
`CLAUDE.md`, `DESIGN.md`, `docs/SECOND_BRAIN.md`), **not** from the actual source. Treat every
file path, function name, and signature below as a **strong hypothesis to verify against the real
tree**, not as ground truth. Before writing any code:

1. `grep`/open the real modules named in §3 and confirm they exist and behave as described.
2. If a name or signature differs, **follow the real source** and note the discrepancy in your PR
   description. Do not invent shims to match this document.
3. If a whole assumption is wrong (e.g. the RRF store does not exist as described), **stop and
   report back** rather than building on a false premise.

You are expected to honor the repo's own rules in `CLAUDE.md`. The most load-bearing ones are
repeated in §5 so you cannot miss them.

---

## 1. Background & motivation

Renfield maintains a per-user "second brain" from four information types — document chunks (RAG),
conversation memories, KG entities, and KG relations — unified under an `atoms` registry and
queried through a single cross-source retrieval path that uses **Reciprocal Rank Fusion (RRF)** over
**dense (pgvector)** + **lexical (Postgres FTS)** results, with per-row **circle-tier** access
filtering pushed into SQL.

**The gap:** KG entities/relations are fused in *as just another vector/FTS source*. Each KG atom is
retrieved by its own similarity to the query and ranked. The directed edges in `kg_relations` are
**not traversed at retrieval time** — they are used only for the 3D graph visualization, entity
dedup, and tier cascade. Traversal/relevance-expansion is exactly what separates real GraphRAG from
"vector search that happens to include graph nodes."

**This feature** inserts one **graph-expansion stage** into the existing RRF pipeline: after RRF
selects pivot atoms, traverse `kg_relations` 1–2 hops (circle-filtered at every hop), then
re-score and merge the connected neighbours back into the fused result. This is the cheapest
high-value step toward "MemGraphRAG"-style fusion because the expensive parts (entity extraction,
embeddings, edge construction) are already paid at ingest, and a small household-scale graph needs
no new database (Postgres traversal is sufficient — **do not introduce Memgraph/Neo4j**).

---

## 2. Goal & non-goals

### Goal
Add an opt-in, circle-safe graph-expansion stage to the cross-source retrieval path so that a query
which surfaces an entity also surfaces that entity's connected facts within 1–2 hops, improving
multi-hop answers without changing caller signatures.

### Non-goals (explicitly out of scope for this work)
- **No new graph database.** Stay on Postgres.
- **No bi-temporal / longitudinal rework** of edges or memories. That is a separate, later effort
  (see §7, Phase 4, and the existing `PR_DRAFT_wissensbasis_longitudinal.md`). Coordinate; do not
  collide.
- **No community-detection / global-summarization** (Microsoft-GraphRAG "global query") in this PR.
- **No change to the ReAct agent loop's contract.** `get_relevant_context` keeps its signature.
- **No frontend redesign.** This is a backend retrieval change. (One optional config-flag exposure,
  see §6.)

---

## 3. Current architecture (verify these before coding)

Names taken from docs — confirm in source.

| Concern | Module (hypothesized) | What it does |
|---|---|---|
| Cross-source RRF fusion | `services/polymorphic_atom_store.py` | Dense + lexical over all source tables, circle-filtered, RRF-combined. **Insertion point for the new stage.** |
| Lexical path | `services/lexical_retrieval.py` | Postgres FTS (`ts_rank`) over `search_vector` columns. |
| KG neighbourhood (REUSE) | `services/kg_graph_service.py` | Already computes a **circle-filtered hop1+hop2 entity neighborhood** for `/api/wissensbasis/focus`. **Promote this to a retrieval-time helper.** |
| Tier filter clause | `services/circle_sql.py` (`build_filter`) | Builds the 4-branch access SQL clause. Used by every retrieval path. |
| Atom write path | `services/atom_service.py` (`upsert_atom`) | **Only** legal way to write source rows. Direct `INSERT`s are CI-lint-forbidden. |
| Specialized paths | `services/rag_retrieval.py`, `services/kg_retrieval.py`, `services/memory_retrieval.py` | Kept alongside the fused path. |
| Agent KG string context | `get_relevant_context` (likely in `services/kg_retrieval.py` or agent service) | Returns string context for the agent. **Keep signature; let body call enriched path.** |
| Config | `utils/config.py` (Pydantic Settings), `.env`, `docs/ENVIRONMENT_VARIABLES.md` | Feature flags follow `*_ENABLED=false` opt-in convention. |

Relevant tables (denormalized `atom_id` + `circle_tier` on each): `document_chunks`,
`conversation_memories`, `kg_entities`, `kg_relations`, plus `document_facts`. Registry: `atoms`.

---

## 4. Design — the expansion stage

Insert **between** "RRF fusion → pivots" and "return top-n":

1. **Pivot selection.** Take the top-`p` atoms from the RRF list (start `p = 8`) that are
   graph-addressable. **MVP: expand only from `kg_node` pivots** (per-entity atoms the store already
   emits). This needs no new data. (Chunk/memory → entity pivots are deferred to Phase 3.)
2. **Traversal.** For each pivot entity, call the promoted `kg_graph_service` neighborhood helper to
   walk `kg_relations` outward 1–2 hops, collecting neighbour `kg_entities` and connecting edges.
   **The circle filter MUST run at every hop**, not only on the seed.
3. **Re-score & merge.** Each neighbour enters the candidate pool with a decayed score:
   `score = pivot_rrf_score / (1 + hop_distance)`. Cap total expanded atoms at `max_expanded`
   (start `15`) so a hub entity (e.g. a household member) cannot flood context. Merge, re-sort,
   return top-`n` as before.

**Caller impact:** none. `/api/atoms` and the fused path return strictly more connected context with
unchanged signatures.

Proposed new module: `services/graph_expansion.py`
Suggested interface (adapt to real conventions):

```python
async def expand(
    fused: list[FusedAtom],      # output of the RRF step, ordered
    *,
    user_id: str,                # asker — for circle filtering at each hop
    max_pivots: int = 8,
    max_hops: int = 2,
    max_expanded: int = 15,
    db: AsyncSession,
) -> list[FusedAtom]:
    """Take RRF-fused atoms, expand kg_node pivots 1–2 hops over kg_relations
    (circle-filtered per hop via circle_sql.build_filter), decay-score the
    neighbours, merge, and return the re-sorted list."""
```

---

## 5. Repo conventions you MUST follow (non-negotiable)

From `CLAUDE.md`:

- **NEVER `git push` without explicit user permission.** After each commit, ask "Soll ich pushen?".
- **TDD is mandatory.** Every code change ships with tests in the same change:
  - new service logic → `tests/backend/test_services.py` (or a dedicated file), `@pytest.mark.unit`
  - DB/migration changes → `tests/backend/test_models.py`, `@pytest.mark.database`
  - new/changed API behavior → `tests/backend/test_<route>.py`
- **Doc-update gate.** After `/review`, BEFORE merge, update ALL affected docs as its own commit in
  the same PR, then wait for explicit merge approval. Sweep:
  `grep -rliE "graph.?expansion|rrf|kg_relations|retrieval" docs/ README.md CLAUDE.md` and update at
  least `CLAUDE.md`, `docs/SECOND_BRAIN.md`, `docs/FEATURES.md`, `docs/ENVIRONMENT_VARIABLES.md`.
  Order: `/review` → docs → wait → merge.
- **Atoms write path:** never `INSERT` into source tables directly; go through
  `atom_service.upsert_atom`. (You should not need to write atoms for this feature — read-only — but
  if you add a mention index in Phase 3, respect this.)
- **i18n:** any user-facing string goes in BOTH `src/frontend/src/i18n/locales/de.json` and
  `en.json`. German is the primary dev language (gehobeneres Deutsch, Fachtermini beibehalten) —
  match the surrounding style in comments/commit messages.
- **Config flags** are frontend-visible only via the `/api/config/features` allowlist. A pure backend
  retrieval flag does **not** need to be exposed there unless the UI must react to it.
- **Alembic** (only if Phase 3 adds a table): migrations run `transaction_per_migration=True`. For any
  `CREATE INDEX CONCURRENTLY`, use `op.get_context().autocommit_block()` and precede it with
  `DROP INDEX IF EXISTS` so the migration is rerunnable (see migration `pc20260528` as a pattern).
- **Tests run on the `.159` build box, not CI.** GitHub CI is intentionally non-functional. See
  `memory/reference_test_runner_159.md` for the ssh/docker-exec workflow.

---

## 6. Task plan (phased — open as a checklist)

### Phase 1 — Neighborhood helper + expansion module (no wiring yet)
- [ ] Confirm `kg_graph_service.py` exposes (or can expose) a reusable, circle-filtered
      hop1+hop2 neighborhood function. Extract a clean, retrieval-callable helper if it is currently
      tangled with the `/api/wissensbasis/focus` route handler.
- [ ] Create `services/graph_expansion.py` with the `expand(...)` interface from §4.
- [ ] Implement decay scoring and `max_expanded` cap.
- [ ] **Tests (`@pytest.mark.unit` + `@pytest.mark.database`):**
  - [ ] Expansion from a single `kg_node` pivot pulls hop-1 and hop-2 neighbours.
  - [ ] Decay ordering: hop-1 neighbour outranks hop-2 neighbour of the same pivot.
  - [ ] `max_expanded` cap is enforced (hub entity does not flood).
  - [ ] **Tier-leak guard (critical):** seed a public entity linked to an owner-only entity;
        assert the owner-only neighbour never appears for a non-owner asker, at every hop.

### Phase 2 — Wire into the fused path behind a flag
- [ ] Add `GRAPH_EXPANSION_ENABLED=false` to `utils/config.py` + `.env.example` +
      `docs/ENVIRONMENT_VARIABLES.md`.
- [ ] In `polymorphic_atom_store.py`, after RRF and before return, call `graph_expansion.expand(...)`
      **only when the flag is on**. Off = byte-identical current behavior.
- [ ] Let `get_relevant_context` (agent KG string context) call the enriched fused path **without
      changing its signature**, so `internal.knowledge_search` benefits with zero agent-loop change.
- [ ] **Tests:**
  - [ ] Flag off → output identical to pre-change (regression/snapshot).
  - [ ] Flag on → a known 2-hop fact that does not rank on its own similarity now appears.
  - [ ] `/api/atoms` contract unchanged (schema/shape).

### Phase 3 — (Optional) chunk/memory → entity pivots
- [ ] Decide whether to add a `*_entity_mentions` reverse index (entities already carry provenance to
      their `source_id`; the reverse lookup is derivable). This is a migration + write-path change via
      `atom_service.upsert_atom` — respect the alembic rules in §5.
- [ ] Allow non-`kg_node` pivots (a highly-ranked chunk/memory) to seed expansion.
- [ ] Tests for the new pivot kind + tier-leak guard repeated for chunk/memory seeds.

### Phase 4 — (Out of scope here; coordinate only)
- [ ] Bi-temporal edges (`valid_at`/`invalid_at`, expire-not-delete on contradiction). Belongs with
      the longitudinal PR. **Do not start without explicit go-ahead.**

---

## 7. Acceptance criteria

- [ ] With `GRAPH_EXPANSION_ENABLED=false`, all existing tests pass and fused output is unchanged.
- [ ] With the flag on, a documented multi-hop query returns a connected fact that the pre-change
      pipeline missed (include this as an integration test fixture).
- [ ] The tier-leak guard test passes for every pivot kind implemented.
- [ ] `max_expanded` cap is provably enforced.
- [ ] `make lint` and `make test-backend` are green (run on `.159` per §5).
- [ ] Affected docs updated in the same PR (doc-update gate).
- [ ] No `git push` performed without explicit permission.

## 8. Verification commands

```bash
make lint                       # ruff + eslint
make test-backend               # backend suite (3,400+ tests)
# targeted while iterating:
#   pytest tests/backend/test_services.py -k graph_expansion -m unit
#   pytest tests/backend -k circle -m database
make test-coverage              # coverage (fail-under=50%)
```

(Actual execution path is the `.159` build box — see `memory/reference_test_runner_159.md`.)

## 9. Risks & things to confirm against real source

1. **Does `polymorphic_atom_store` actually return a structured fused list** you can post-process, or
   does it stream/assemble inline? If the latter, find the right seam.
2. **`kg_graph_service` coupling** — the neighborhood logic may be entangled with the route/3D-view
   response shaping. Budget time to extract a clean helper.
3. **Pivot identity** — confirm how a `kg_node` atom maps back to a `kg_entities` row id usable for
   traversal (UUID atom id vs KG integer id; the docs mention a "two-id-space" tier edit, so expect
   two id spaces).
4. **Performance** — add an index check on `kg_relations` (source/target entity columns) before
   assuming sub-ms traversal; verify the household graph size in a real deployment.
5. **Circle filter at depth** — the single biggest correctness risk. Prove the filter is applied on
   the hop-2 query, not just hop-1.
6. **Federation** — confirm responder-side filtering still holds once expansion runs (it should,
   since expansion reads the same circle-filtered atoms, but add/extend a federation test).

## 10. References (in-repo)

- `CLAUDE.md` — architecture, conventions, internal tools, circles summary
- `docs/SECOND_BRAIN.md` — the four information types, atoms layer, RRF retrieval, ingestion
- `docs/CIRCLES.md` — tier model, tables, retrieval filter detail
- `docs/FEDERATION_MULTI_PEER.md` — cross-instance queries
- `PR_DRAFT_wissensbasis_longitudinal.md` — the temporal/longitudinal effort (Phase 4 territory)
- `docs/ENVIRONMENT_VARIABLES.md` — where the new flag is documented

---

*End of handover. If reality contradicts §3, trust reality and report the delta before building.*
