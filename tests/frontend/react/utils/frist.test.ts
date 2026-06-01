/**
 * Frist date math + urgency-group boundaries (eng-review D8).
 * Boundaries pinned: today → thisWeek, +7d → thisWeek, +8d → later, -1 → overdue.
 */
import { describe, it, expect } from 'vitest';
import { daysUntil, urgencyGroup } from '../../../../src/frontend/src/utils/frist';

// Fixed "now" so the suite is deterministic (no Date.now reliance).
const NOW = new Date(2026, 5, 1); // 2026-06-01 local

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    expect(daysUntil('2026-06-01', NOW)).toBe(0);
  });
  it('returns positive for the future, negative for the past', () => {
    expect(daysUntil('2026-06-08', NOW)).toBe(7);
    expect(daysUntil('2026-05-29', NOW)).toBe(-3);
  });
  it('ignores any time component and avoids UTC day-shift', () => {
    expect(daysUntil('2026-06-02T23:59:59', NOW)).toBe(1);
  });
  it('returns NaN for a malformed date', () => {
    expect(Number.isNaN(daysUntil('not-a-date', NOW))).toBe(true);
  });
});

describe('urgencyGroup boundaries', () => {
  it('past due → overdue', () => {
    expect(urgencyGroup('2026-05-31', NOW)).toBe('overdue');
  });
  it('due today → thisWeek (not overdue)', () => {
    expect(urgencyGroup('2026-06-01', NOW)).toBe('thisWeek');
  });
  it('due in exactly 7 days → thisWeek (inclusive)', () => {
    expect(urgencyGroup('2026-06-08', NOW)).toBe('thisWeek');
  });
  it('due in 8 days → later', () => {
    expect(urgencyGroup('2026-06-09', NOW)).toBe('later');
  });
});
