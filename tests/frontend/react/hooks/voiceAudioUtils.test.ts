/**
 * voiceAudioUtils — pure audio helpers (plan §6.1, task T4).
 *
 * `computeRms` and `detectBargeIn` carry the barge-in decision logic;
 * being pure they test exhaustively with no WebAudio mock beyond a
 * one-method stub AnalyserNode.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRms,
  detectBargeIn,
} from '../../../../src/frontend/src/pages/ChatPage/hooks/voiceAudioUtils';

// Stub AnalyserNode — computeRms only calls getByteFrequencyData, which
// fills the caller's array. `as unknown as AnalyserNode` matches the
// partial-stub pattern already used in ChatPage.test.tsx.
function stubAnalyser(frame: number[]): AnalyserNode {
  return {
    getByteFrequencyData: (arr: Uint8Array): void => {
      for (let i = 0; i < arr.length; i += 1) arr[i] = frame[i] ?? 0;
    },
  } as unknown as AnalyserNode;
}

describe('computeRms', () => {
  it('returns 0 for a silent (all-zero) frame', () => {
    const scratch = new Uint8Array(8);
    expect(computeRms(stubAnalyser([0, 0, 0, 0, 0, 0, 0, 0]), scratch)).toBe(0);
  });

  it('returns the max (255) for a fully-saturated frame', () => {
    const scratch = new Uint8Array(4);
    expect(computeRms(stubAnalyser([255, 255, 255, 255]), scratch)).toBe(255);
  });

  it('computes the root-mean-square of a mixed frame', () => {
    // RMS of [30,40,0,0] = sqrt((900+1600)/4) = sqrt(625) = 25.
    const scratch = new Uint8Array(4);
    expect(computeRms(stubAnalyser([30, 40, 0, 0]), scratch)).toBe(25);
  });

  it('returns 0 for an empty scratch buffer instead of NaN', () => {
    expect(computeRms(stubAnalyser([]), new Uint8Array(0))).toBe(0);
  });
});

describe('detectBargeIn', () => {
  const THRESHOLD = 20;
  const SUSTAIN = 150;

  it('reports no barge-in and clears the run while RMS is below threshold', () => {
    const r = detectBargeIn(5, 1000, 2000, THRESHOLD, SUSTAIN);
    expect(r).toEqual({ voicedSince: null, bargeIn: false });
  });

  it('starts the run on the first voiced frame but does not fire yet', () => {
    const r = detectBargeIn(50, null, 1000, THRESHOLD, SUSTAIN);
    expect(r.voicedSince).toBe(1000); // run anchored at `now`
    expect(r.bargeIn).toBe(false); // sustain window not met
  });

  it('does not fire before the sustain window elapses', () => {
    // voiced since t=1000, now t=1100 → only 100ms < 150ms.
    const r = detectBargeIn(50, 1000, 1100, THRESHOLD, SUSTAIN);
    expect(r).toEqual({ voicedSince: 1000, bargeIn: false });
  });

  it('fires once voiced energy is sustained past the window', () => {
    // voiced since t=1000, now t=1200 → 200ms >= 150ms.
    const r = detectBargeIn(50, 1000, 1200, THRESHOLD, SUSTAIN);
    expect(r).toEqual({ voicedSince: 1000, bargeIn: true });
  });

  it('fires exactly at the sustain boundary (>= is inclusive)', () => {
    const r = detectBargeIn(50, 1000, 1150, THRESHOLD, SUSTAIN);
    expect(r.bargeIn).toBe(true);
  });

  it('treats RMS exactly at the threshold as voiced', () => {
    const r = detectBargeIn(THRESHOLD, null, 1000, THRESHOLD, SUSTAIN);
    expect(r.voicedSince).toBe(1000);
  });

  it('resets the run when RMS dips below threshold mid-window', () => {
    // A run was building (voicedSince=1000) but this frame dipped —
    // the run is cancelled, so transient noise cannot accumulate.
    const r = detectBargeIn(8, 1000, 1120, THRESHOLD, SUSTAIN);
    expect(r).toEqual({ voicedSince: null, bargeIn: false });

    // ...and the next voiced frame restarts the clock from scratch.
    const restart = detectBargeIn(50, r.voicedSince, 1130, THRESHOLD, SUSTAIN);
    expect(restart.voicedSince).toBe(1130);
    expect(restart.bargeIn).toBe(false);
  });
});
