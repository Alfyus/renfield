/**
 * Deadline (Frist) date math for the obligations agenda — pure, i18n-free, and
 * timezone-safe so it's unit-testable with an injected `now`.
 *
 * `obligation_date` arrives as a date-only ISO string ("2026-06-20"). Parsing
 * that with `new Date(iso)` would treat it as UTC midnight and shift a day in
 * western-hemisphere locales, so we compare calendar dates in LOCAL time by
 * pinning both sides to local midnight.
 *
 * Urgency grouping (boundaries pinned for D8 tests):
 *   overdue  : daysUntil <  0   (past due — e.g. "seit 3 Tagen")
 *   thisWeek : 0 ≤ daysUntil ≤ 7 (due today counts here; due +7d counts here)
 *   later    : daysUntil >  7
 */
export type UrgencyGroup = 'overdue' | 'thisWeek' | 'later';

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `now` to the ISO date. today=0, yesterday=-1. */
export function daysUntil(iso: string, now: Date): number {
  // Take only the date part; pin to local midnight to avoid UTC day-shift.
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const due = new Date(y, m - 1, d).getTime();
  return Math.round((due - localMidnight(now)) / 86_400_000);
}

export function urgencyGroup(iso: string, now: Date): UrgencyGroup {
  const days = daysUntil(iso, now);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'thisWeek';
  return 'later';
}

export const URGENCY_ORDER: UrgencyGroup[] = ['overdue', 'thisWeek', 'later'];
