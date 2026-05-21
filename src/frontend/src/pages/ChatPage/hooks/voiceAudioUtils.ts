/**
 * Pure audio helpers shared by useVoiceStream's two analyser loops: the
 * end-of-utterance VAD (`checkSilence`) and Fork A's barge-in listener.
 *
 * Dependency-free and side-effect-free — they unit-test with nothing
 * more than a stub `AnalyserNode`. Keeping one RMS implementation here
 * means the two loops can never drift on how "loud" is measured.
 */

/**
 * RMS of the analyser's current frequency-domain frame, on the 0..255
 * byte scale.
 *
 * `scratch` is a caller-owned `Uint8Array` sized to
 * `analyser.frequencyBinCount`, reused across frames so the rAF loop
 * does not allocate.
 */
export function computeRms(analyser: AnalyserNode, scratch: Uint8Array<ArrayBuffer>): number {
  analyser.getByteFrequencyData(scratch);
  let sumSquares = 0;
  for (let i = 0; i < scratch.length; i += 1) {
    sumSquares += scratch[i] * scratch[i];
  }
  return scratch.length > 0 ? Math.sqrt(sumSquares / scratch.length) : 0;
}

/**
 * Barge-in decision — pure and O(1).
 *
 * The caller threads `voicedSince`: the timestamp when RMS first rose
 * to/above `threshold` in the current unbroken run of voiced frames, or
 * `null` while below. Barge-in fires once voiced energy has been
 * sustained for `sustainMs` — a brief dip below `threshold` resets the
 * run, so transient noise spikes do not trigger.
 *
 * Returns the next `voicedSince` (thread it straight back in) and
 * whether the sustain window is now met.
 *
 * Note: this is a deliberate, workable refinement of the plan §6.1
 * sketch `detectBargeIn(belowSince, now, threshold, sustainMs)` — that
 * 4-arg form had no RMS input, so `threshold` could not actually be
 * applied. This form takes `rms` and owns the threshold comparison.
 */
export function detectBargeIn(
  rms: number,
  voicedSince: number | null,
  now: number,
  threshold: number,
  sustainMs: number,
): { voicedSince: number | null; bargeIn: boolean } {
  if (rms < threshold) {
    return { voicedSince: null, bargeIn: false };
  }
  const since = voicedSince ?? now;
  return { voicedSince: since, bargeIn: now - since >= sustainMs };
}
