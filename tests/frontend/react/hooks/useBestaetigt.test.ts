/**
 * useBestaetigt — acknowledgement state (eng-review D4 regression + D-FLOW-1).
 *
 * The load-bearing test is "confirm one ≠ confirm all": D4 keys state on the
 * always-present fact `id`, not the nullable atom_id, so confirming obligation
 * 1 must NOT mark obligation 2 confirmed.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBestaetigt, UNDO_WINDOW_MS } from '../../../../src/frontend/src/hooks/useBestaetigt';

describe('useBestaetigt', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('REGRESSION (D4): confirming one obligation does not confirm another', () => {
    const { result } = renderHook(() => useBestaetigt());
    act(() => result.current.confirm(1));
    expect(result.current.isConfirmed(1)).toBe(true);
    expect(result.current.isConfirmed(2)).toBe(false);
  });

  it('opens a 5s undo window then the confirmation sticks', () => {
    const { result } = renderHook(() => useBestaetigt());
    act(() => result.current.confirm(1));
    expect(result.current.pending).toBe(1);
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(result.current.pending).toBeNull();
    expect(result.current.isConfirmed(1)).toBe(true); // still confirmed
  });

  it('undo within the window reverts the confirmation', () => {
    const { result } = renderHook(() => useBestaetigt());
    act(() => result.current.confirm(1));
    act(() => result.current.undo(1));
    expect(result.current.isConfirmed(1)).toBe(false);
    expect(result.current.pending).toBeNull();
  });

  it('Esc within the window reverts (D-FLOW-1 / A11Y)', () => {
    const { result } = renderHook(() => useBestaetigt());
    act(() => result.current.confirm(1));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.isConfirmed(1)).toBe(false);
  });

  it('persists to localStorage keyed by id and rehydrates', () => {
    const { result, unmount } = renderHook(() => useBestaetigt());
    act(() => result.current.confirm(42));
    expect(JSON.parse(localStorage.getItem('renfield.obligations.bestaetigt')!)).toContain(42);
    unmount();
    const { result: result2 } = renderHook(() => useBestaetigt());
    expect(result2.current.isConfirmed(42)).toBe(true);
  });

  it('reopen un-acknowledges without opening a toast', () => {
    const { result } = renderHook(() => useBestaetigt());
    act(() => result.current.confirm(1));
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    act(() => result.current.reopen(1));
    expect(result.current.isConfirmed(1)).toBe(false);
    expect(result.current.pending).toBeNull();
  });
});
