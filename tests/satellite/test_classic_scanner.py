"""
Unit tests for the Classic Bluetooth scanner (real-RSSI path).

Covers presence detection via `hcitool name` and the best-effort RSSI
read via `hcitool cc/rssi/dc`, including the fallback to SYNTHETIC_RSSI
when the connection or RSSI read fails (so presence is never lost).
"""

import asyncio
from unittest.mock import patch

import pytest

from renfield_satellite.ble.classic_scanner import ClassicBTScanner

MAC = "4C:E6:C0:27:52:93"


def _subcmd(args) -> str:
    """The hcitool subcommand (name/cc/rssi/dc), ignoring any `sudo -n` prefix."""
    a = list(args)
    if "hcitool" in a:
        i = a.index("hcitool")
        return a[i + 1] if i + 1 < len(a) else ""
    return ""


def _proc(stdout: bytes = b"", returncode: int = 0, stderr: bytes = b""):
    """Build a fake asyncio subprocess whose communicate() returns stdout/stderr."""
    class _FakeProc:
        def __init__(self):
            self.returncode = returncode

        async def communicate(self):
            return stdout, stderr

        async def wait(self):
            return returncode

        def kill(self):
            pass

    return _FakeProc()


def _fake_hcitool(responses: dict, timeouts: set | None = None):
    """
    Return a create_subprocess_exec replacement that dispatches on the
    hcitool subcommand (argv[1]: name/cc/rssi/dc).

    responses: {subcommand: _proc(...)}
    timeouts:  set of subcommands that should raise asyncio.TimeoutError
               from communicate().
    """
    timeouts = timeouts or set()

    async def _create(*args, **kwargs):
        sub = _subcmd(args)

        class _FakeProc:
            returncode = responses.get(sub, _proc()).returncode

            async def communicate(self):
                if sub in timeouts:
                    raise asyncio.TimeoutError()
                p = responses.get(sub, _proc())
                return await p.communicate()

            async def wait(self):
                return self.returncode

            def kill(self):
                pass

        return _FakeProc()

    return _create


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_real_rssi_centered_on_baseline():
    """A readable golden-range offset is centered on the -50 baseline (offset -7 -> -57)."""
    fake = _fake_hcitool({
        "name": _proc(b"Karnak"),
        "cc": _proc(b""),
        "rssi": _proc(b"RSSI return value: -7\n"),
        "dc": _proc(b""),
    })
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake):
        result = await scanner.scan({MAC})

    assert result == [{"mac": MAC, "rssi": -57}]  # -50 + (-7)


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_positive_offset_reads_stronger():
    """A positive golden offset (closer device) maps above the baseline (+6 -> -44)."""
    fake = _fake_hcitool({
        "name": _proc(b"Karnak"),
        "cc": _proc(b""),
        "rssi": _proc(b"RSSI return value: 6\n"),
        "dc": _proc(b""),
    })
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake):
        result = await scanner.scan({MAC})

    assert result == [{"mac": MAC, "rssi": -44}]  # -50 + 6


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_weak_offset_floored_above_backend_threshold():
    """A very weak offset is floored so a present device is never filtered as absent."""
    fake = _fake_hcitool({
        "name": _proc(b"Karnak"),
        "cc": _proc(b""),
        "rssi": _proc(b"RSSI return value: -40\n"),  # -50 + -40 = -90, below backend -80 filter
        "dc": _proc(b""),
    })
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake):
        result = await scanner.scan({MAC})

    assert result == [{"mac": MAC, "rssi": ClassicBTScanner.PRESENT_FLOOR}]  # -79, not -90


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_falls_back_to_synthetic_when_rssi_unreadable():
    """If the RSSI read fails (device refuses cc), presence still reports -50."""
    fake = _fake_hcitool({
        "name": _proc(b"Karnak"),
        "cc": _proc(b"", returncode=1, stderr=b"Can't create connection"),
        "rssi": _proc(b"", returncode=1, stderr=b"Not connected"),
        "dc": _proc(b"", returncode=1),
    })
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake):
        result = await scanner.scan({MAC})

    assert result == [{"mac": MAC, "rssi": ClassicBTScanner.SYNTHETIC_RSSI}]


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_absent_device_not_reported():
    """No name response => device is absent and never appears in results."""
    fake = _fake_hcitool({"name": _proc(b"")})  # empty name = no response
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake):
        result = await scanner.scan({MAC})

    assert result == []


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_read_rssi_disabled_keeps_synthetic():
    """With read_rssi=False, no connection is attempted; synthetic value used."""
    calls = []
    fake_inner = _fake_hcitool({"name": _proc(b"Karnak")})

    async def _tracking(*args, **kwargs):
        calls.append(_subcmd(args))
        return await fake_inner(*args, **kwargs)

    scanner = ClassicBTScanner(timeout=1.0, read_rssi=False)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=_tracking):
        result = await scanner.scan({MAC})

    assert result == [{"mac": MAC, "rssi": ClassicBTScanner.SYNTHETIC_RSSI}]
    assert calls == ["name"]  # cc/rssi/dc never invoked


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_rssi_timeout_falls_back_and_still_present():
    """An RSSI read that times out must not drop the device — fall back to -50."""
    fake = _fake_hcitool(
        {"name": _proc(b"Karnak"), "cc": _proc(b""), "rssi": _proc(b""), "dc": _proc(b"")},
        timeouts={"rssi"},
    )
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value="/usr/bin/hcitool"), \
         patch("asyncio.create_subprocess_exec", side_effect=fake):
        result = await scanner.scan({MAC})

    assert result == [{"mac": MAC, "rssi": ClassicBTScanner.SYNTHETIC_RSSI}]


@pytest.mark.satellite
@pytest.mark.asyncio
async def test_unavailable_hcitool_returns_empty():
    """No hcitool binary => scanner reports nothing."""
    scanner = ClassicBTScanner(timeout=1.0, read_rssi=True)
    with patch("renfield_satellite.ble.classic_scanner.shutil.which", return_value=None):
        result = await scanner.scan({MAC})

    assert result == []
