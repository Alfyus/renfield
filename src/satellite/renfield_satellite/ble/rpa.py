"""
Resolvable Private Address (RPA) resolution for BLE presence.

Modern phones (esp. iPhones) advertise with a *Resolvable Private Address* that
rotates every ~15 minutes, so a static MAC whitelist can't track them. Given a
device's Identity Resolving Key (IRK) — obtained out-of-band once (an iPhone's
IRK lives in the owner's Mac/iCloud keychain; an Android's in its bonded-device
info) — we can resolve each rotating address back to a stable identity, WITHOUT
bonding the phone to the satellite. This is the same mechanism Home Assistant's
"Private BLE Device" / Bermuda use, and it needs only advertisement scanning
(no raw HCI, no Classic-BT, no pairing) — so it works on this AIC8800 board.

Implements the Bluetooth Core Spec `ah` random-address hash (Vol 3, Part H,
§2.2.2). Validated against the spec sample (Appendix D.7):
IRK ec0234a357c8ad05341010a60a397d9b, addr 70:81:94:0D:FB:AA → resolves.

IRK byte order: this module expects the IRK most-significant-octet first
(IRK[0] = the MSO), matching the spec sample. Exports from BlueZ / a Mac may be
little-endian; reverse them at the config boundary, not here.
"""
from typing import Dict, Optional

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    _CRYPTO_AVAILABLE = True
except ImportError:  # pragma: no cover - resolution is a no-op without crypto
    _CRYPTO_AVAILABLE = False


def is_resolvable_private_address(address: str) -> bool:
    """True if `address` is a resolvable private address (two most-significant
    bits of the most-significant octet == 0b01)."""
    try:
        msb = int(address.split(":")[0], 16)
    except (ValueError, IndexError, AttributeError):
        return False
    return (msb & 0xC0) == 0x40


def _ah(irk: bytes, prand: bytes) -> bytes:
    """Bluetooth `ah(k, r)` = e(k, padding||r) mod 2^24 — the low 3 octets of
    AES-128(irk, 13 zero octets || prand).

    NOTE: AES-ECB here is the BLE-spec-mandated single-block primitive `e`
    (Vol 3, Part H, §2.2.1-2.2.2), used as a one-block PRF/hash — NOT bulk
    encryption. ECB's "identical plaintext blocks leak" weakness is irrelevant
    for a single 16-byte block. BlueZ / Home Assistant / bluetooth-data-tools
    all implement RPA resolution this exact way; do not "upgrade" to GCM/CBC.
    """
    data = b"\x00" * 13 + prand
    enc = Cipher(algorithms.AES(irk), modes.ECB()).encryptor()
    return (enc.update(data) + enc.finalize())[-3:]


def resolve_rpa(irk: bytes, address: str) -> bool:
    """True if `address` (an RPA, "AA:BB:CC:DD:EE:FF") resolves against `irk`
    (16 bytes, MSO-first). False for non-RPAs, bad input, or no crypto."""
    if not _CRYPTO_AVAILABLE or not isinstance(irk, (bytes, bytearray)) or len(irk) != 16:
        return False
    if not is_resolvable_private_address(address):
        return False
    try:
        b = bytes(int(x, 16) for x in address.split(":"))
    except (ValueError, AttributeError):
        return False
    if len(b) != 6:
        return False
    prand, addr_hash = b[:3], b[3:]
    return _ah(bytes(irk), prand) == addr_hash


def resolve_identity(address: str, irks: Dict[str, bytes]) -> Optional[str]:
    """Return the identity name whose IRK resolves `address`, or None.
    Only RPAs are attempted (cheap early-out for public/random-static addresses)."""
    if not irks or not is_resolvable_private_address(address):
        return None
    for name, irk in irks.items():
        if resolve_rpa(irk, address):
            return name
    return None
