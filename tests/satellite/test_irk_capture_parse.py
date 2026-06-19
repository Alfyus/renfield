"""
Unit test for the BlueZ info-file IRK parser used by the UI pairing-capture flow
(Satellite._read_bonded_irks). Verifies it extracts the IdentityResolvingKey and
ignores devices/sections without one.
"""
import os

import pytest

from renfield_satellite.satellite import Satellite

_WITH_IRK = """[General]
Name=Karnak

[IdentityResolvingKey]
Key=3A66FE43118690229991659536EF9A4B

[LinkKey]
Key=0123456789ABCDEF0123456789ABCDEF
"""

_NO_IRK = """[General]
Name=Speaker

[LinkKey]
Key=FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
"""


@pytest.mark.satellite
@pytest.mark.unit
def test_read_bonded_irks_extracts_only_irk(tmp_path):
    adapter = tmp_path / "10:11:12:13:14:15"
    # device with an IRK
    d1 = adapter / "4C:E6:C0:27:52:93"
    d1.mkdir(parents=True)
    (d1 / "info").write_text(_WITH_IRK)
    # device without an IRK (e.g. a Classic speaker) — must be ignored
    d2 = adapter / "AA:BB:CC:DD:EE:FF"
    d2.mkdir(parents=True)
    (d2 / "info").write_text(_NO_IRK)

    result = Satellite._read_bonded_irks(str(tmp_path))

    assert result == {"4C:E6:C0:27:52:93": "3A66FE43118690229991659536EF9A4B"}


@pytest.mark.satellite
@pytest.mark.unit
def test_read_bonded_irks_missing_root(tmp_path):
    assert Satellite._read_bonded_irks(str(tmp_path / "nope")) == {}
