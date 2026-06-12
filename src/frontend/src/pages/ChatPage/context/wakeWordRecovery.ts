/**
 * Wake-word reconnect / wake-from-suspend recovery — decision logic.
 *
 * The browser wake-word engine is local (mic + onnxruntime) and survives a
 * chat-WS blip on its own. It gets stranded (isEnabled:true, isListening:false,
 * nothing detecting, until a manual page reload) in a few ways:
 *
 *  - A WS drop that lands *mid-turn*: on detection the engine is paused
 *    (handleRecordingStart) and only resumed when the backend's `done` frame
 *    arrives (handleStreamDone). A backend `Recreate` rollout (deploy /
 *    ConfigMap reload) drops the WS; if it dropped between that pause and the
 *    `done`, the frame never comes — "doesn't listen any longer after a deploy".
 *  - The engine emitting an `error` (audio pipeline disruption): useWakeWord
 *    flips isListening:false so the state is honest, but does not self-restart.
 *  - Tab suspend / laptop sleep / network loss interrupting the engine.
 *
 * ChatContext re-arms the engine on three recovery triggers — chat-WS reconnect,
 * tab becoming visible, and network coming back online. This pure predicate
 * isolates the "should we resume?" decision so it can be unit-tested without
 * rendering the whole provider.
 */
export interface WakeWordRecoveryState {
  /**
   * This is a genuine recovery moment (a chat-WS RECONNECT — not the initial
   * connect — or a tab-visible / network-online event), not a spurious call.
   */
  isRecoveryTrigger: boolean;
  /** The user has wake word switched on (engine should be listening). */
  wakeWordEnabled: boolean;
  /** The engine is already actively listening — nothing to recover. */
  isListening: boolean;
  /** A capture is in progress — don't interrupt it (a later edge recovers). */
  recording: boolean;
  /**
   * A wake-word-triggered turn is mid-flight (detected → recording/processing/
   * TTS, awaiting its resume). Resuming now would double-arm the engine and
   * fight the turn's own resume — skip. The WS-reconnect path clears this latch
   * first (that turn is dead once the socket dropped), so only it can proceed.
   */
  wakeWordActivated: boolean;
}

/**
 * Whether a recovery trigger should resume the (stranded, paused) wake-word
 * engine.
 *
 * True only when: it's a genuine recovery moment, the user wants wake word on,
 * the engine is NOT already listening (so the happy "WS blipped outside a turn"
 * case is skipped — the local engine kept running there), no capture is active,
 * and no wake-word turn is mid-flight.
 */
export function shouldRearmWakeWord(state: WakeWordRecoveryState): boolean {
  return (
    state.isRecoveryTrigger &&
    state.wakeWordEnabled &&
    !state.isListening &&
    !state.recording &&
    !state.wakeWordActivated
  );
}
