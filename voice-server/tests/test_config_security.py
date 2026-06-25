"""Security review M4 — voice-server must fail closed on the default signing key.

With local JWT auth enforced and the public placeholder key, an attacker could
forge a valid voice token and harvest the returned speaker_embedding voiceprint.
The Settings validator refuses to start in that configuration.
"""
import pytest
from pydantic import SecretStr

from voice_server.config import Settings

_PLACEHOLDER = "changeme-in-production"
_STRONG = "a-long-random-secret-key-not-the-default-0123456789"


def test_default_key_with_local_auth_refuses_to_start():
    with pytest.raises(ValueError):
        Settings(auth_required=True, auth_mode="local",
                 secret_key=SecretStr(_PLACEHOLDER))


def test_strong_key_with_local_auth_is_ok():
    s = Settings(auth_required=True, auth_mode="local",
                 secret_key=SecretStr(_STRONG))
    assert s.secret_key.get_secret_value() == _STRONG


def test_default_key_allowed_when_auth_not_required():
    # cluster-internal deployment (auth_required=False) — placeholder tolerated
    s = Settings(auth_required=False, auth_mode="local",
                 secret_key=SecretStr(_PLACEHOLDER))
    assert s.auth_required is False


def test_default_key_allowed_in_callback_mode():
    s = Settings(auth_required=True, auth_mode="callback",
                 secret_key=SecretStr(_PLACEHOLDER))
    assert s.auth_mode == "callback"


def test_max_concurrent_sessions_default():
    s = Settings(auth_required=False, secret_key=SecretStr(_STRONG))
    assert s.max_concurrent_sessions >= 1
