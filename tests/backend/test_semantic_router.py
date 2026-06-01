"""Tests for SemanticRouter helpers.

Covers ``find_shadowed_sub_intent_utterances`` — the init-time lint that catches
sub_intent utterances which are byte-identical to a role-level utterance (they
tie at sim=1.000 and ``classify`` breaks ties toward the role, so the sub_intent
silently never fires for that phrasing).
"""

import pytest

from services.agent_router import AgentRole
from services.semantic_router import find_shadowed_sub_intent_utterances


def _role(name, utterances=None, sub_intents=None):
    return AgentRole(
        name=name,
        description={"en": name, "de": name},
        utterances=utterances,
        sub_intent_definitions=sub_intents,
    )


@pytest.mark.unit
class TestFindShadowedSubIntentUtterances:
    def test_detects_exact_duplicate(self):
        roles = {
            "release": _role(
                "release",
                utterances=["Show me active deliveries", "Show release details"],
                sub_intents={
                    "deliveries": {
                        "utterances": ["Show me active deliveries", "Show tracked items"]
                    }
                },
            )
        }
        result = find_shadowed_sub_intent_utterances(roles)
        assert result == {("release", "deliveries"): ["Show me active deliveries"]}

    def test_clean_config_returns_empty(self):
        roles = {
            "release": _role(
                "release",
                utterances=["Show release details"],
                sub_intents={"deliveries": {"utterances": ["Show tracked items"]}},
            )
        }
        assert find_shadowed_sub_intent_utterances(roles) == {}

    def test_role_without_utterances_skipped(self):
        roles = {
            "release": _role(
                "release",
                utterances=None,
                sub_intents={"deliveries": {"utterances": ["Show tracked items"]}},
            )
        }
        assert find_shadowed_sub_intent_utterances(roles) == {}

    def test_multiple_overlaps_sorted(self):
        roles = {
            "release": _role(
                "release",
                utterances=["Who is in the release team?", "Resolve team members", "Show folders"],
                sub_intents={
                    "teams": {
                        "utterances": [
                            "Resolve team members",
                            "Who is in the release team?",
                            "Who is the QA?",
                        ]
                    }
                },
            )
        }
        result = find_shadowed_sub_intent_utterances(roles)
        assert result == {
            ("release", "teams"): ["Resolve team members", "Who is in the release team?"]
        }

    def test_non_dict_sub_intent_def_is_ignored(self):
        # sub_intent_definitions occasionally carries non-dict values (raw desc);
        # the lint must not crash on them.
        roles = {"release": _role("release", utterances=["x"], sub_intents={"bogus": "not-a-dict"})}
        assert find_shadowed_sub_intent_utterances(roles) == {}

    def test_only_offending_sub_intent_reported(self):
        roles = {
            "release": _role(
                "release",
                utterances=["dup phrase", "role only"],
                sub_intents={
                    "good": {"utterances": ["unique phrase"]},
                    "bad": {"utterances": ["dup phrase"]},
                },
            )
        }
        result = find_shadowed_sub_intent_utterances(roles)
        assert result == {("release", "bad"): ["dup phrase"]}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
