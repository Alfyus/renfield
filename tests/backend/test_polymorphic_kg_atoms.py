"""
Unit tests for `_wrap_kg_atoms` — the per-entity/-relation KG atom wrapper that
replaced the single `kg_aggregated` blob (PR3 / Wissen detail-drawer foundation).

The load-bearing guarantees: every kg_node carries its `entity_id` and every
kg_edge its `relation_id` in the payload (the detail drawer + KG tier-edit need
the source id), and the per-row circle_tier is preserved into the atom policy.
"""
import pytest

from services.polymorphic_atom_store import _wrap_kg_atoms

pytestmark = pytest.mark.unit


def test_wraps_entities_as_kg_node_atoms_with_source_id():
    out = _wrap_kg_atoms(
        {
            "entities": [
                {"id": 42, "name": "Müller GmbH", "entity_type": "organization", "circle_tier": 2, "similarity": 0.9},
            ],
            "relations": [],
        }
    )
    assert len(out) == 1
    atom = out[0].atom
    assert atom.atom_type == "kg_node"
    assert atom.atom_id == "kg_node:42"
    assert atom.payload["entity_id"] == 42
    assert atom.payload["name"] == "Müller GmbH"
    assert atom.policy["tier"] == 2  # circle_tier preserved into policy
    assert out[0].snippet == "Müller GmbH"


def test_wraps_relations_as_kg_edge_atoms_with_source_id():
    out = _wrap_kg_atoms(
        {
            "entities": [],
            "relations": [
                {
                    "id": 7,
                    "subject_id": 1,
                    "subject_name": "Anna",
                    "predicate": "arbeitet_bei",
                    "object_id": 2,
                    "object_name": "Müller GmbH",
                    "circle_tier": 1,
                },
            ],
        }
    )
    assert len(out) == 1
    atom = out[0].atom
    assert atom.atom_type == "kg_edge"
    assert atom.atom_id == "kg_edge:7"
    assert atom.payload["relation_id"] == 7
    assert atom.payload["subject_name"] == "Anna"
    assert atom.payload["object_name"] == "Müller GmbH"
    assert atom.policy["tier"] == 1
    assert "Anna" in out[0].snippet and "Müller GmbH" in out[0].snippet


def test_entities_ranked_before_relations():
    out = _wrap_kg_atoms(
        {
            "entities": [{"id": 1, "name": "A", "entity_type": "person", "circle_tier": 0, "similarity": 0.8}],
            "relations": [{"id": 9, "subject_id": 1, "subject_name": "A", "predicate": "kennt", "object_id": 2, "object_name": "B", "circle_tier": 0}],
        }
    )
    assert [m.atom.atom_type for m in out] == ["kg_node", "kg_edge"]
    assert out[0].rank < out[1].rank


@pytest.mark.parametrize("bad", [None, {}, {"entities": [], "relations": []}, ValueError("x")])
def test_empty_or_exception_yields_no_atoms(bad):
    assert _wrap_kg_atoms(bad) == []
