"""
Symmetric encryption for sensitive values stored at rest (e.g. BLE IRKs).

Keys derived deterministically from `settings.secret_key` (the same secret used
for JWT signing). Uses Fernet (AES-128-CBC + HMAC-SHA256, authenticated).

IRKs are device-tracking secrets — never store or log them in plaintext.

WARNING: this couples the data key to SECRET_KEY. Rotating SECRET_KEY is a
DESTRUCTIVE operation for these secrets — every stored value becomes
permanently undecryptable and must be re-entered. It is not a clean re-key.
"""
import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from utils.config import settings

__all__ = ["encrypt_secret", "decrypt_secret", "InvalidToken"]

logger = logging.getLogger(__name__)

_DEFAULT_SECRET = "changeme-in-production-use-strong-random-key"


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    raw = settings.secret_key
    # SecretStr in pydantic; tolerate a plain str too.
    secret = raw.get_secret_value() if hasattr(raw, "get_secret_value") else str(raw)
    if secret == _DEFAULT_SECRET:
        # Encrypting a tracking secret under the publicly-known default key is
        # effectively plaintext — flag loudly (logged once via the cache).
        logger.warning(
            "secret_encryption: SECRET_KEY is the insecure default — "
            "encrypted-at-rest secrets (e.g. BLE IRKs) are NOT protected. "
            "Set a strong SECRET_KEY."
        )
    # Derive a stable 32-byte urlsafe-base64 Fernet key from the app secret.
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a string for storage at rest. Returns a Fernet token (str)."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a Fernet token produced by encrypt_secret(). Raises InvalidToken
    if the data is corrupt or the key changed."""
    return _fernet().decrypt(token.encode()).decode()
