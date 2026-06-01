import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Acknowledgement ("Bestätigt") state for obligations — localStorage-backed,
 * keyed on the always-present fact `id` (D4; NOT the nullable atom_id).
 *
 * STOPGAP (D1/D13): this is intentionally client-only. When the obligation
 * notifier ships its server-side (obligation_id, milestone) notified-ledger,
 * this state migrates onto it and the localStorage store is reconciled away
 * (see the notifier sub-note in TODOS.md). Until then, acknowledgements live
 * per-device.
 *
 * confirm(id) marks it done immediately (persisted) AND opens a 5s undo window
 * surfaced via `pending`. Esc or undo() within the window reverts it; after 5s
 * the confirmation sticks and the toast closes. reopen(id) un-acknowledges with
 * no toast (not destructive).
 */
const STORAGE_KEY = 'renfield.obligations.bestaetigt';
export const UNDO_WINDOW_MS = 5000;

function loadIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : []);
  } catch {
    return new Set();
  }
}

function saveIds(ids: Set<number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private mode / quota) — acknowledgement is
    // best-effort this session; do not crash the agenda.
  }
}

export interface UseBestaetigt {
  isConfirmed: (id: number) => boolean;
  confirm: (id: number) => void;
  undo: (id: number) => void;
  reopen: (id: number) => void;
  /** The obligation whose undo toast is currently open, or null. */
  pending: number | null;
}

export function useBestaetigt(): UseBestaetigt {
  const [confirmed, setConfirmed] = useState<Set<number>>(() => loadIds());
  const [pending, setPending] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const persist = useCallback((next: Set<number>) => {
    saveIds(next);
    setConfirmed(next);
  }, []);

  const confirm = useCallback(
    (id: number) => {
      persist(new Set(confirmed).add(id));
      clearTimer();
      setPending(id);
      timerRef.current = setTimeout(() => setPending(null), UNDO_WINDOW_MS);
    },
    [confirmed, persist, clearTimer],
  );

  const undo = useCallback(
    (id: number) => {
      const next = new Set(confirmed);
      next.delete(id);
      persist(next);
      clearTimer();
      setPending(null);
    },
    [confirmed, persist, clearTimer],
  );

  // reopen = un-acknowledge without a toast (re-opening a stuck confirmation).
  const reopen = useCallback(
    (id: number) => {
      const next = new Set(confirmed);
      next.delete(id);
      persist(next);
    },
    [confirmed, persist],
  );

  // Esc reverts the open undo window (D-FLOW-1 / A11Y).
  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') undo(pending);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, undo]);

  useEffect(() => clearTimer, [clearTimer]);

  const isConfirmed = useCallback((id: number) => confirmed.has(id), [confirmed]);

  return { isConfirmed, confirm, undo, reopen, pending };
}
