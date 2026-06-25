"""
Tests for VAD-gated wake-word inference (idle path).

Background (2026-06-23): the Arbeitszimmer satellite triggered unreliably at
normal speaking volume. Root cause was real-time CPU saturation: openwakeword
ran on EVERY 80ms chunk (~53ms each = 66% of the real-time budget, single
threaded, continuously), leaving no headroom — so any extra load (BLE/Classic
scan, TTS, display) pushed inference past the 80ms budget and audio frames were
silently dropped, corrupting the wake-word stream and collapsing scores.

Fix: in IDLE, gate the (expensive) wake-word inference behind the (cheap, ~13.5ms)
Silero VAD, so openwakeword only runs while speech is present, plus a short
pre-roll (to keep openwakeword's streaming context warm so the leading edge of
the wake word isn't clipped) and a tail (so a brief VAD flicker mid-word doesn't
stop detection). With gating off, behaviour is identical to running every chunk.
"""

from collections import deque
from types import SimpleNamespace
from unittest.mock import MagicMock

from renfield_satellite.satellite import Satellite


def _gating_sat(vad_gated=True, preroll=4, tail=15):
    """A bare Satellite with only the attributes the idle wake-word seam needs."""
    sat = Satellite.__new__(Satellite)
    sat._wakeword_pending = False
    sat._ww_gate_remaining = 0
    sat._ww_preroll = deque(maxlen=max(1, preroll))
    sat.config = SimpleNamespace(
        wakeword=SimpleNamespace(
            vad_gated=vad_gated,
            vad_gate_preroll_chunks=preroll,
            vad_gate_tail_chunks=tail,
        )
    )
    sat.wakeword = MagicMock()
    sat.wakeword.process_audio = MagicMock(return_value=None)
    sat.vad = MagicMock()
    sat._schedule_async = MagicMock()
    # Mock the async handler so dispatch doesn't create an un-awaited coroutine.
    sat._on_wakeword_detected = MagicMock()
    return sat


def test_gating_off_dispatches_every_chunk():
    """vad_gated=False must behave exactly like the old always-on path."""
    sat = _gating_sat(vad_gated=False)
    for _ in range(5):
        sat._process_wakeword_idle(b"\x00\x00")
    assert sat.wakeword.process_audio.call_count == 5
    # VAD must not even be consulted when gating is disabled.
    sat.vad.is_speech.assert_not_called()


def test_no_speech_never_runs_wakeword():
    """The whole point: silence/steady-noise must not spend wake-word inference."""
    sat = _gating_sat(vad_gated=True)
    sat.vad.is_speech = MagicMock(return_value=False)
    for _ in range(20):
        sat._process_wakeword_idle(b"ab")
    sat.wakeword.process_audio.assert_not_called()


def test_speech_onset_warms_preroll_then_dispatches():
    """At speech onset the buffered pre-roll (minus the current chunk) is fed to
    warm openwakeword's context, then the current chunk is dispatched."""
    sat = _gating_sat(vad_gated=True, preroll=4, tail=15)

    # Three silent chunks fill the pre-roll but run no inference.
    sat.vad.is_speech = MagicMock(return_value=False)
    for i in range(3):
        sat._process_wakeword_idle(bytes([i, i]))
    assert sat.wakeword.process_audio.call_count == 0

    # Speech onset: pre-roll = [c0, c1, c2, onset]; warm feeds [c0, c1, c2] (3)
    # then the current chunk is dispatched (1) = 4 calls total.
    sat.vad.is_speech = MagicMock(return_value=True)
    sat._process_wakeword_idle(bytes([9, 9]))
    assert sat.wakeword.process_audio.call_count == 4
    assert sat._ww_gate_remaining == 15 - 1  # tail set, then one chunk consumed


def test_tail_keeps_running_after_speech_stops():
    """After speech stops the detector keeps running for tail_chunks, then stops."""
    sat = _gating_sat(vad_gated=True, preroll=1, tail=3)

    sat.vad.is_speech = MagicMock(return_value=True)
    sat._process_wakeword_idle(b"s1")  # onset (preroll=1 -> no warm), dispatch
    assert sat._ww_gate_remaining == 2

    sat.vad.is_speech = MagicMock(return_value=False)
    sat._process_wakeword_idle(b"x1")  # tail 2->1, dispatch
    sat._process_wakeword_idle(b"x2")  # tail 1->0, dispatch
    sat._process_wakeword_idle(b"x3")  # tail exhausted -> no dispatch

    assert sat.wakeword.process_audio.call_count == 3
    assert sat._ww_gate_remaining == 0


def test_detection_sets_pending_and_schedules():
    """A real (non-stop-word) detection latches _wakeword_pending and schedules."""
    sat = _gating_sat(vad_gated=False)
    det = SimpleNamespace(is_stop_word=False, keyword="hey_renfield", confidence=0.8)
    sat.wakeword.process_audio = MagicMock(return_value=det)
    sat._process_wakeword_idle(b"ab")
    assert sat._wakeword_pending is True
    sat._schedule_async.assert_called_once()


def test_stop_word_not_treated_as_wakeword_in_idle():
    """A stop-word detection in idle must not latch a wake-word session."""
    sat = _gating_sat(vad_gated=False)
    det = SimpleNamespace(is_stop_word=True, keyword="stop", confidence=0.9)
    sat.wakeword.process_audio = MagicMock(return_value=det)
    sat._process_wakeword_idle(b"ab")
    assert sat._wakeword_pending is False
    sat._schedule_async.assert_not_called()
