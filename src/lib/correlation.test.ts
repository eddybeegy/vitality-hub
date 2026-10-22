import { describe, expect, it } from 'vitest';
import { correlate, describeCorrelation, pairSeries, strengthOf } from './correlation';
import { addDays } from './dayTags';

const START = '2026-10-01';
const series = (f: (i: number) => number, n = 20) => Array.from({ length: n }, (_, i) => ({ day: addDays(START, i), value: f(i) }));

describe('pairSeries', () => {
  it('pairs same-day values, drops days missing on either side', () => {
    const p = pairSeries([{ day: '2026-10-01', value: 1 }, { day: '2026-10-02', value: 2 }], [{ day: '2026-10-02', value: 5 }]);
    expect(p).toEqual([{ day: '2026-10-02', x: 2, y: 5 }]);
  });

  it('with a lag, pairs x today with y the next day, across the BST change', () => {
    const p = pairSeries([{ day: '2026-10-25', value: 1 }], [{ day: '2026-10-26', value: 9 }], 1);
    expect(p).toEqual([{ day: '2026-10-25', x: 1, y: 9 }]);
  });
});

describe('correlate', () => {
  it('finds a perfect positive and a perfect negative line', () => {
    const x = series(i => i);
    expect(correlate(pairSeries(x, series(i => 2 * i + 3)))!.r).toBeCloseTo(1, 10);
    const neg = correlate(pairSeries(x, series(i => 50 - i)))!;
    expect(neg.r).toBeCloseTo(-1, 10);
    expect(neg.slope).toBeCloseTo(-1, 10);
    expect(describeCorrelation(neg)).toBe('Strong negative link (r = −1.00, 20 days)');
  });

  it('is null under 10 pairs or with a flat series', () => {
    expect(correlate(pairSeries(series(i => i, 9), series(i => i, 9)))).toBeNull();
    expect(correlate(pairSeries(series(() => 5), series(i => i)))).toBeNull();
  });

  it('a lag picks up a next-day effect that same-day pairing misses', () => {
    // y tomorrow = 100 - 3 * x today; same-day y is unrelated noise from the pattern
    const x = series(i => (i * 7) % 11, 40);
    const y = x.map(p => ({ day: addDays(p.day, 1), value: 100 - 3 * p.value }));
    expect(correlate(pairSeries(x, y, 1))!.r).toBeCloseTo(-1, 10);
    expect(Math.abs(correlate(pairSeries(x, y, 0))!.r)).toBeLessThan(0.5);
  });
});

describe('strengthOf', () => {
  it('bands at 0.1, 0.3, 0.5', () => {
    expect([0.05, 0.2, -0.4, 0.7].map(strengthOf)).toEqual(['none', 'weak', 'moderate', 'strong']);
  });
});
