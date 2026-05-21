"""Tests for client-initiated TTS cancellation acknowledgement.

Covers the barge-in cancel contract on `/ws/voice`:

  - a client `cancel` while synthesis is in flight  -> `cancelled` frame
  - an internal / session-teardown cancellation     -> legacy `error` frame
  - a `cancel` for an already-finished request      -> no-op, no marker leak
  - a normal completion                             -> `tts_done`, no marker
  - a synthesis failure                             -> `error` with the cause

Environment: importing `voice_server.api.ws_voice` pulls in the STT /
speaker / decoder service modules, so this runs where the voice-server
runtime deps are installed (the .159 build box or the voice-server
image), not on a bare dev machine. Synthesis itself is faked, so no
Piper / Whisper / GPU is exercised.

    cd voice-server && pip install -r requirements.txt -r requirements-dev.txt
    pytest tests/test_cancel_ack.py
"""

from __future__ import annotations

import asyncio
import json
import uuid

from voice_server.api.ws_voice import (
    SessionState,
    _cancel_tts,
    _spawn_tts,
)


class FakeWebSocket:
    """Records every frame sent, so tests can assert on the wire output."""

    def __init__(self) -> None:
        self.text_frames: list[dict] = []
        self.bytes_frames: list[bytes] = []

    async def send_text(self, text: str) -> None:
        self.text_frames.append(json.loads(text))

    async def send_bytes(self, data: bytes) -> None:
        self.bytes_frames.append(data)

    def frames_of_type(self, frame_type: str) -> list[dict]:
        return [f for f in self.text_frames if f.get("type") == frame_type]


class ControllableTTS:
    """Fake TTSService whose `stream_sentences` is test-driven.

    Yields one frame, then parks on `released` until the test lets it
    finish — giving every test a deterministic in-flight window to fire
    a cancel into. Set `fail` to raise instead of parking.
    """

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.released = asyncio.Event()
        self.fail: Exception | None = None

    async def stream_sentences(self, text, request_id, language=None):
        self.started.set()
        yield b"frame-0"
        if self.fail is not None:
            raise self.fail
        await self.released.wait()
        yield b"frame-1"


def _new_rid() -> str:
    return str(uuid.uuid4())


async def test_client_cancel_emits_cancelled_frame() -> None:
    """A client `cancel` mid-synthesis -> `cancelled` frame, no `error`."""
    ws = FakeWebSocket()
    state = SessionState(user_id="u1")
    tts = ControllableTTS()
    rid = _new_rid()

    await _spawn_tts(ws, state, {"request_id": rid, "text": "hallo welt"}, tts)
    task = state.tts_tasks[rid]
    # Once `started` is set the task has run uninterrupted to its park
    # point — frame-0 is already sent and the generator is suspended.
    await tts.started.wait()
    assert ws.bytes_frames == [b"frame-0"]

    await _cancel_tts(state, rid)
    assert rid in state.client_cancelled  # marker set while the task is live

    try:
        await task
    except asyncio.CancelledError:
        pass  # _run_tts re-raises after sending the ack — expected

    assert ws.frames_of_type("cancelled") == [{"type": "cancelled", "request_id": rid}]
    assert ws.frames_of_type("error") == []
    assert ws.frames_of_type("tts_done") == []
    assert rid not in state.client_cancelled  # marker discarded by _wrapped finally
    assert rid not in state.tts_tasks


async def test_internal_cancel_emits_error_frame() -> None:
    """A teardown-style cancel (direct task.cancel, no `cancel` message)
    keeps the legacy `error` frame — it is not a client barge-in."""
    ws = FakeWebSocket()
    state = SessionState(user_id="u1")
    tts = ControllableTTS()
    rid = _new_rid()

    await _spawn_tts(ws, state, {"request_id": rid, "text": "irgendwas"}, tts)
    task = state.tts_tasks[rid]
    await tts.started.wait()

    # Bypass _cancel_tts — this is how ws_voice's finally tears tasks down.
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    errors = ws.frames_of_type("error")
    assert len(errors) == 1
    assert errors[0]["code"] == "tts_failed"
    assert errors[0]["request_id"] == rid
    assert ws.frames_of_type("cancelled") == []
    assert state.client_cancelled == set()


async def test_cancel_after_done_is_noop() -> None:
    """A `cancel` for a request that already finished is a no-op and
    must not leave a marker behind (the leak _cancel_tts guards against)."""
    ws = FakeWebSocket()
    state = SessionState(user_id="u1")
    tts = ControllableTTS()
    tts.released.set()  # let synthesis run straight through
    rid = _new_rid()

    await _spawn_tts(ws, state, {"request_id": rid, "text": "fertig"}, tts)
    await state.tts_tasks[rid]
    assert ws.frames_of_type("tts_done") == [{"type": "tts_done", "request_id": rid}]

    await _cancel_tts(state, rid)  # task already done / popped -> early return

    assert state.client_cancelled == set()  # no marker added -> no leak
    assert ws.frames_of_type("cancelled") == []


async def test_normal_completion_leaves_no_marker() -> None:
    """An uninterrupted request ends with `tts_done` and a clean set."""
    ws = FakeWebSocket()
    state = SessionState(user_id="u1")
    tts = ControllableTTS()
    tts.released.set()
    rid = _new_rid()

    await _spawn_tts(ws, state, {"request_id": rid, "text": "alles gut"}, tts)
    await state.tts_tasks[rid]

    assert ws.frames_of_type("tts_done") == [{"type": "tts_done", "request_id": rid}]
    assert ws.frames_of_type("cancelled") == []
    assert ws.frames_of_type("error") == []
    assert state.client_cancelled == set()


async def test_synthesis_failure_emits_error_not_cancelled() -> None:
    """A genuine synthesis error surfaces as `error` with the real cause,
    and never touches the cancel marker set."""
    ws = FakeWebSocket()
    state = SessionState(user_id="u1")
    tts = ControllableTTS()
    tts.fail = FileNotFoundError("piper voice missing")
    rid = _new_rid()

    await _spawn_tts(ws, state, {"request_id": rid, "text": "kaputt"}, tts)
    await state.tts_tasks[rid]

    errors = ws.frames_of_type("error")
    assert len(errors) == 1
    assert errors[0]["code"] == "model_unavailable"
    assert "piper voice missing" in errors[0]["message"]
    assert ws.frames_of_type("cancelled") == []
    assert state.client_cancelled == set()
