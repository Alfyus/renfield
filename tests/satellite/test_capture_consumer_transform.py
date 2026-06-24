"""
Tests for moving stereo->mono beamforming off the capture read loop.

Background (2026-06-23): the PyAudio capture read loop did beamforming inline,
violating its own contract ("must never block on anything except stream.read()"
— an I2S buffer overflow can crash the kernel on Pi Zero 2 W). The beamforming /
mono-downmix now runs in the CONSUMER thread via ``_consumer_transform`` so the
read loop only reads + queues raw audio.
"""

import queue

import numpy as np

from renfield_satellite.audio.capture import AudioCapture


def _bare_capture(channels, beamformer=None):
    cap = AudioCapture.__new__(AudioCapture)
    cap.channels = channels
    cap._beamformer = beamformer
    return cap


def test_stereo_to_mono_passthrough_for_mono():
    cap = _bare_capture(channels=1)
    data = np.array([1, 2, 3, 4], dtype=np.int16).tobytes()
    assert cap._stereo_to_mono(data) == data


def test_stereo_to_mono_extracts_channel0_without_beamformer():
    cap = _bare_capture(channels=2, beamformer=None)
    # Interleaved L/R: L0,R0,L1,R1 -> mono should be [L0, L1]
    stereo = np.array([10, 20, 30, 40], dtype=np.int16).tobytes()
    mono = np.frombuffer(cap._stereo_to_mono(stereo), dtype=np.int16)
    assert list(mono) == [10, 30]


def test_stereo_to_mono_uses_beamformer_when_present():
    sentinel = b"beamformed"
    beamformer = type("BF", (), {"process_bytes": staticmethod(lambda b: sentinel)})()
    cap = _bare_capture(channels=2, beamformer=beamformer)
    assert cap._stereo_to_mono(b"\x00\x00\x00\x00") == sentinel


def test_consumer_loop_applies_transform_before_callback():
    """The consumer thread must apply _consumer_transform, not pass raw stereo."""
    cap = AudioCapture.__new__(AudioCapture)
    cap._running = True
    cap._audio_queue = queue.Queue()
    cap.channels = 2
    cap._beamformer = None
    cap._consumer_transform = cap._stereo_to_mono

    received = []

    def cb(chunk):
        received.append(chunk)
        cap._running = False  # stop the loop after one chunk (deterministic)

    cap._callback = cb

    stereo = np.array([10, 20, 30, 40], dtype=np.int16).tobytes()
    cap._audio_queue.put(stereo)
    cap._audio_consumer_loop()

    assert len(received) == 1
    assert list(np.frombuffer(received[0], dtype=np.int16)) == [10, 30]


def test_consumer_loop_without_transform_passes_through():
    """Backends that produce mono directly (arecord) set no transform."""
    cap = AudioCapture.__new__(AudioCapture)
    cap._running = True
    cap._audio_queue = queue.Queue()
    cap._consumer_transform = None

    received = []

    def cb(chunk):
        received.append(chunk)
        cap._running = False

    cap._callback = cb

    mono = np.array([7, 8, 9], dtype=np.int16).tobytes()
    cap._audio_queue.put(mono)
    cap._audio_consumer_loop()

    assert received == [mono]
