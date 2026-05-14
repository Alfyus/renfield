-- One-shot cleanup for orphan kg_node atoms blocking KG extraction.
--
-- Symptom (observed in prod 2026-05-14):
--   Every chat turn fires kg_post_message_hook and fails with
--   UniqueViolationError on uq_atoms_source. atoms table has 192 rows
--   pointing at kg_entities IDs 1..220 (with gaps), but kg_entities
--   has 0 rows — the sequence was reset and the underlying entity
--   rows were deleted without cleaning up their backing atoms.
--
-- Root cause:  resolve_entity (knowledge_graph_service.py) inserted
-- the atom BEFORE the kg_entity, then UPDATEd the atom's source_id
-- after the entity flushed. If anything between failed AND the atom
-- write had already been committed by upsert_atom-style code paths
-- elsewhere, an orphan atom committed without its entity. The schema
-- has no FK on atoms.source_id (it's a string, not a real FK), so
-- nothing prevents the drift.
--
-- Fix is in resolve_entity (insert entity first in a savepoint, then
-- atom with real source_id). This script removes the pre-existing
-- damage so the next attempt succeeds.
--
-- Usage:
--   kubectl -n reva exec postgres-0 -- psql -U postgres -d reva \
--     < bin/cleanup_orphan_kg_atoms.sql
--
-- Idempotent: re-running is a no-op once the orphans are cleared.

BEGIN;

-- 1. Show what we're about to delete (for the human running it).
\echo 'Orphan kg_node atoms (atom_id -> source_id) — to be removed:'
SELECT atom_id, source_table, source_id
FROM atoms
WHERE atom_type = 'kg_node'
  AND source_table = 'kg_entities'
  AND NOT EXISTS (
      SELECT 1 FROM kg_entities e
      WHERE e.id::text = atoms.source_id
  )
ORDER BY source_id::int
LIMIT 10;

\echo 'Orphan kg_edge atoms (atom_id -> source_id) — to be removed:'
SELECT atom_id, source_table, source_id
FROM atoms
WHERE atom_type = 'kg_edge'
  AND source_table = 'kg_relations'
  AND NOT EXISTS (
      SELECT 1 FROM kg_relations r
      WHERE r.id::text = atoms.source_id
  )
ORDER BY source_id::int
LIMIT 10;

-- 2. Delete them.
DELETE FROM atoms
WHERE atom_type = 'kg_node'
  AND source_table = 'kg_entities'
  AND NOT EXISTS (
      SELECT 1 FROM kg_entities e
      WHERE e.id::text = atoms.source_id
  );

\echo 'kg_node orphans deleted.'

DELETE FROM atoms
WHERE atom_type = 'kg_edge'
  AND source_table = 'kg_relations'
  AND NOT EXISTS (
      SELECT 1 FROM kg_relations r
      WHERE r.id::text = atoms.source_id
  );

\echo 'kg_edge orphans deleted.'

-- 3. Reset the kg_entities + kg_relations sequences to MAX(id)+1 so the
--    next inserts don't collide with whatever the application thinks is
--    "free". If the tables are empty, this resets to 1.
SELECT setval(
    pg_get_serial_sequence('kg_entities', 'id'),
    COALESCE((SELECT MAX(id) FROM kg_entities), 0) + 1,
    false
);
SELECT setval(
    pg_get_serial_sequence('kg_relations', 'id'),
    COALESCE((SELECT MAX(id) FROM kg_relations), 0) + 1,
    false
);

\echo 'Sequences reset.'

COMMIT;
