/**
 * shouldRearmWakeWord — wake-word recovery decision.
 *
 * The local wake-word engine gets stranded (isEnabled:true, isListening:false,
 * nothing detecting) by a mid-turn WS drop (backend Recreate rollout), an
 * engine error, or a tab/network suspend. ChatContext re-arms it on three
 * recovery triggers (WS reconnect, tab-visible, network-online); this predicate
 * gates that resume. The tests lock the five guards so a future edit can't
 * resume during the happy path (engine still listening), interrupt an active
 * capture, or double-arm in the middle of a wake-word turn.
 */
import { describe, it, expect } from 'vitest';
import { shouldRearmWakeWord } from '../../../../src/frontend/src/pages/ChatPage/context/wakeWordRecovery';

const base = {
  isRecoveryTrigger: true,
  wakeWordEnabled: true,
  isListening: false,
  recording: false,
  wakeWordActivated: false,
};

describe('shouldRearmWakeWord', () => {
  it('re-arms a stranded engine on a recovery trigger (enabled, idle, not in a turn)', () => {
    expect(shouldRearmWakeWord(base)).toBe(true);
  });

  it('does NOT fire when it is not a recovery moment (e.g. the initial WS connect)', () => {
    expect(shouldRearmWakeWord({ ...base, isRecoveryTrigger: false })).toBe(false);
  });

  it('does nothing when wake word is switched off', () => {
    expect(shouldRearmWakeWord({ ...base, wakeWordEnabled: false })).toBe(false);
  });

  it('skips the happy path: engine already listening (WS blipped outside a turn)', () => {
    // The local engine keeps running through a WS blip that is not mid-turn,
    // so isListening stays true — resuming would be a redundant restart.
    expect(shouldRearmWakeWord({ ...base, isListening: true })).toBe(false);
  });

  it('does not interrupt an active capture (a later edge recovers it)', () => {
    expect(shouldRearmWakeWord({ ...base, recording: true })).toBe(false);
  });

  it('does not double-arm during a wake-word-triggered turn (latch still set)', () => {
    // tab-visible / online fire without clearing the latch, so this guard
    // stops a resume during the processing/TTS phase of a live turn. The
    // WS-reconnect path clears the latch first (dead turn), so it still passes.
    expect(shouldRearmWakeWord({ ...base, wakeWordActivated: true })).toBe(false);
  });
});
