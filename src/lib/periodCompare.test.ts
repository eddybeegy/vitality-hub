import { describe, expect, it } from 'vitest';
import { formatChange, mergePrevious, percentChange, periodDays, previousWindow, shiftPrevious } from './periodCompare';

describe('periodDays', () => {
  it('knows the comparable periods and refuses the rest', () => {
    expect(periodDays('7d')).toBe(7);
    expect(periodDays('30d')).toBe(30);
    expect(periodDays('90d')).toBe(90);
    expect(periodDays('1y')).toBe(365);
    expect(periodDays('1d')).toBeNull();
    expect(periodDays('all')).toBeNull();
  });
});

describe('previousWindow / shiftPrevious', () => {
  it('is the N days immediately before, end-exclusive', () => {
    expect(previousWindow('2026-10-15', 7)).toEqual({ from: '2026-10-08', to: '2026-10-15' });
  });

  it('keeps only previous-window rows and moves them forward by N days', () => {
    const rows = [
      { date: '2026-10-07', v: 1 }, // before the previous window
      { date: '2026-10-08', v: 2 }, // first previous day
      { date: '2026-10-14', v: 3 }, // last previous day
      { date: '2026-10-15', v: 4 }, // current window
    ];
    const out = shiftPrevious(rows, r => r.date, '2026-10-15', 7);
    expect(out).toEqual([{ date: '2026-10-15', v: 2 }, { date: '2026-10-21', v: 3 }]);
  });

  it('shifts across the October clock change without losing or doubling a day', () => {
    // BST ends 2026-10-25. A bare-day shift is unaffected.
    const rows = [{ date: '2026-10-20', v: 1 }, { date: '2026-10-26', v: 2 }];
    const out = shiftPrevious(rows, r => r.date, '2026-10-27', 7);
    expect(out.map(r => r.date)).toEqual(['2026-10-27', '2026-11-02']);
  });

  it('uses dayOf for timestamped rows and skips rows it cannot place', () => {
    const rows = [{ date: '2026-10-09T23:30:00Z' }, { date: 'garbage' }];
    const dayOf = (r: { date: string }) => (r.date.startsWith('2026-10-09T23') ? '2026-10-10' : '');
    expect(shiftPrevious(rows, dayOf, '2026-10-15', 7)).toEqual([{ date: '2026-10-17' }]);
  });
});

describe('mergePrevious', () => {
  it('adds the previous value to matching buckets and keeps previous-only buckets', () => {
    const current = [{ date: '2026-10-15', hr: 50 }, { date: '2026-10-17', hr: 52 }];
    const previous = [{ date: '2026-10-15', hr: 55 }, { date: '2026-10-16', hr: 54 }];
    expect(mergePrevious(current, previous, 'hr', 'prev_hr')).toEqual([
      { date: '2026-10-15', hr: 50, prev_hr: 55 },
      { date: '2026-10-16', prev_hr: 54 },
      { date: '2026-10-17', hr: 52 },
    ]);
  });

  it('does not mutate the current rows, and ignores range values', () => {
    const current = [{ date: '2026-10-15', bp: [80, 120] }];
    const merged = mergePrevious(current, [{ date: '2026-10-15', bp: [82, 125] }], 'bp', 'prev_bp');
    expect(merged).toEqual([{ date: '2026-10-15', bp: [80, 120] }]);
    expect(current[0]).not.toHaveProperty('prev_bp');
  });
});

describe('percentChange / formatChange', () => {
  it('computes against the previous value', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10, 6);
    expect(percentChange(-5, -10)).toBeCloseTo(50, 6);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 4)).toBeNull();
  });

  it('formats with a sign and one decimal', () => {
    expect(formatChange(4.24)).toBe('+4.2%');
    expect(formatChange(-0.84)).toBe('-0.8%');
    expect(formatChange(0.01)).toBe('0%');
  });
});
