import { describe, it, expect } from 'vitest';
import { takeRecent } from './recentWindow';

const row = (date: string, calories: number) => ({ date, calories });

describe('takeRecent', () => {
  it('takes the newest n from an oldest-first array (the NutritionTab bug)', () => {
    // standardizeMetrics hands components oldest-first; `.slice(0, 7)` used to average
    // 2026-01-20..30 and label it "7d avg".
    const rows = [
      row('2026-01-20', 1495), row('2026-01-21', 1495), row('2026-01-22', 1495),
      row('2026-10-19', 2632), row('2026-10-20', 2632), row('2026-10-21', 2632),
    ];
    expect(takeRecent(rows, 3).map(r => r.date)).toEqual(['2026-10-21', '2026-10-20', '2026-10-19']);
  });

  it('takes the newest n from a newest-first array too', () => {
    const rows = [row('2026-10-21', 1), row('2026-10-20', 2), row('2026-01-20', 3)];
    expect(takeRecent(rows, 2).map(r => r.date)).toEqual(['2026-10-21', '2026-10-20']);
  });

  it('does not mutate its input', () => {
    const rows = [row('2026-01-01', 1), row('2026-02-01', 2)];
    takeRecent(rows, 1);
    expect(rows.map(r => r.date)).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('returns everything when there are fewer rows than n, and [] for n <= 0', () => {
    const rows = [row('2026-01-01', 1), row('2026-02-01', 2)];
    expect(takeRecent(rows, 7)).toHaveLength(2);
    expect(takeRecent(rows, 0)).toEqual([]);
  });
});
