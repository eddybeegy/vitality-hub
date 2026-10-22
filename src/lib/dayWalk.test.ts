import { describe, it, expect } from 'vitest';
import { toDateStr, addDays } from './dayWalk';

// These assertions must hold whatever TZ the test process runs in; the point of the
// module is that the local zone stops mattering.
describe('dayWalk', () => {
  it('steps back across the autumn DST end without skipping the day', () => {
    // Europe/London leaves BST at 02:00 on Sunday 2026-10-25. The old local-time
    // `setDate` returned '2026-10-24' here and the 25th never appeared in a streak.
    expect(toDateStr(addDays(new Date('2026-10-26'), -1))).toBe('2026-10-25');
    expect(toDateStr(addDays(new Date('2026-10-25'), -1))).toBe('2026-10-24');
  });

  it('steps forward across the spring DST start without repeating the day', () => {
    // Europe/London enters BST at 01:00 on Sunday 2027-03-28; the old helper returned
    // '2027-03-28' for +1 and broke longest-streak contiguity.
    expect(toDateStr(addDays(new Date('2027-03-28'), 1))).toBe('2027-03-29');
    expect(toDateStr(addDays(new Date('2027-03-27'), 1))).toBe('2027-03-28');
  });

  it('walks a run of days back from a start without gaps or repeats', () => {
    let cursor = new Date('2026-10-28');
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(toDateStr(cursor));
      cursor = addDays(cursor, -1);
    }
    expect(seen).toEqual([
      '2026-10-28', '2026-10-27', '2026-10-26',
      '2026-10-25', '2026-10-24', '2026-10-23',
    ]);
  });

  it('handles month, year and leap boundaries', () => {
    expect(toDateStr(addDays(new Date('2026-03-01'), -1))).toBe('2026-02-28');
    expect(toDateStr(addDays(new Date('2028-03-01'), -1))).toBe('2028-02-29');
    expect(toDateStr(addDays(new Date('2027-01-01'), -1))).toBe('2026-12-31');
    expect(toDateStr(addDays(new Date('2026-12-31'), 1))).toBe('2027-01-01');
  });

  it('does not mutate its argument', () => {
    const d = new Date('2026-10-26');
    addDays(d, -1);
    expect(toDateStr(d)).toBe('2026-10-26');
  });
});
