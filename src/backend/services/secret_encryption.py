"""
Symmetric encryption for sensitive values stored at rest (e.g. BLE IRKs).

Keys derived deterministically from `settings.secret_key` (the same secret used
for JWT signing), so no extra key management is needed and rotating SECRET_KEY
rotates the encryption key. Uses Fernet (AES-128-CBC + HMAC-SHA256, authenticated).

IRKs are device-tracking secrets — never store or log them in plaintext.
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from utils.config import settings

__all__ = ["encrypt_secret", "decrypt_secret", "InvalidToken"]


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    raw = settings.secret_key
    # SecretStr in pydantic; tolerate a plain str too.
    secret = raw.get_secret_value() if hasattr(raw, "get_secret_value") else str(raw)
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
