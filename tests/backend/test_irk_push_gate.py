"""Security review H1 — IRK push must be allowlist-gateable.

IRKs permanently de-anonymize a resident's rotating BLE address (a
location-tracking key). The push to satellites is now gated by
SATELLITE_IRK_ALLOWLIST: non-empty → only listed satellites receive IRKs.
"""
from __future__ import annotations

import pytest

import ha_glue.services.presence_service as ps
from ha_glue.services.presence_service import PresenceService, irk_push_allowed
from utils.config import settings


@pytest.fixture(autouse=True)
def _reset_warned():
    ps._irk_ungated_warned.clear()
    yield
    ps._irk_ungated_warned.clear()


@pytest.mark.backend
class TestIrkPushGate:
    def test_empty_allowlist_is_ungated(self, monkeypatch):
        monkeypatch.setattr(settings, "satellite_irk_allowlist", "")
        assert irk_push_allowed("sat-wohnzimmer") is True

    def test_allowlist_permits_only_listed(self, monkeypatch):
        monkeypatch.setattr(
            settings, "satellite_irk_allowlist", "sat-wohnzimmer, sat-esszimmer"
        )
        assert irk_push_allowed("sat-wohnzimmer") is True
        assert irk_push_allowed("sat-esszimmer") is True
        assert irk_push_allowed("sat-rogue") is False

    def test_irks_for_satellite_blocks_unlisted(self, monkeypatch):
        monkeypatch.setattr(settings, "satellite_irk_allowlist", "sat-known")
        svc = PresenceService.__new__(PresenceService)
        svc._irks_hex = {"evdb": "00112233445566778899aabbccddeeff"}

        assert svc.irks_for_satellite("sat-known") == [
            {"name": "evdb", "irk": "00112233445566778899aabbccddeeff"}
        ]
        # A rogue/unknown satellite gets nothing.
        assert svc.irks_for_satellite("sat-rogue") == []

    def test_ungated_warns_once_per_satellite(self, monkeypatch):
        monkeypatch.setattr(settings, "satellite_irk_allowlist", "")
        warnings: list[str] = []
        monkeypatch.setattr(ps.logger, "warning", lambda msg, *a, **k: warnings.append(msg))

        irk_push_allowed("sat-x")
        irk_push_allowed("sat-x")  # second call must not re-warn
        irk_push_allowed("sat-y")

        assert len(warnings) == 2  # one per distinct satellite id
