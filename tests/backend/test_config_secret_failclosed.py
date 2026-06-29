"""Security review M1 — fail closed on the default JWT signing key.

With AUTH_ENABLED=true and the public placeholder SECRET_KEY, anyone can forge
an admin JWT. The Settings validator must refuse to start in that config, while
leaving AUTH_ENABLED=false (single-user/household) and dev/test unaffected.
"""
import pytest
from pydantic import SecretStr

from utils.config import Settings

_PLACEHOLDER = Settings.model_fields["secret_key"].default
if isinstance(_PLACEHOLDER, SecretStr):
    _PLACEHOLDER = _PLACEHOLDER.get_secret_value()
_STRONG = "x" * 48


@pytest.mark.backend
@pytest.mark.unit
class TestSecretKeyFailClosed:
    def test_auth_on_with_placeholder_key_raises(self):
        with pytest.raises(ValueError):
            Settings(auth_enabled=True, secret_key=SecretStr(_PLACEHOLDER))

    def test_auth_on_with_strong_key_ok(self):
        s = Settings(auth_enabled=True, secret_key=SecretStr(_STRONG))
        assert s.secret_key.get_secret_value() == _STRONG

    def test_auth_off_with_placeholder_key_ok(self):
        # household/single-user mode tolerates the default (no JWT trust)
        s = Settings(auth_enabled=False, secret_key=SecretStr(_PLACEHOLDER))
        assert s.auth_enabled is False
