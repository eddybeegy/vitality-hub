import { describe, expect, it } from 'vitest';
import { projectGoal, weightTrend } from './weightTrend';
import { addDays } from './dayTags';

const LONDON = 'Europe/London';
const TODAY = '2026-10-22';
const w = (daysAgo: number, value: number) => ({ type: 'weight', value, timestamp: addDays(TODAY, -daysAgo) });

describe('weightTrend', () => {
  it('is null with no weigh-ins', () => {
    expect(weightTrend([], TODAY, LONDON)).toBeNull();
  });

  it('moves 10% towards each weigh-in and carries the trend over gaps', () => {
    const t = weightTrend([w(2, 80), w(0, 90)], TODAY, LONDON)!;
    expect(t.points.map(p => [p.day, p.weight, p.trend])).toEqual([
      ['2026-10-20', 80, 80],
      ['2026-10-21', null, 80],
      ['2026-10-22', 90, 81],
    ]);
  });

  it('a one-day spike barely moves the trend', () => {
    const rows = Array.from({ length: 30 }, (_, i) => w(29 - i, 80));
    rows[29] = w(0, 82);
    const t = weightTrend(rows, TODAY, LONDON)!;
    expect(t.trend).toBeCloseTo(80.2, 6);
  });

  it('finds the weekly rate on a steady loss', () => {
    // -0.5 kg a week, every day for 120 days: the EMA lags but its slope settles.
    const rows = Array.from({ length: 120 }, (_, i) => w(119 - i, 90 - (i * 0.5) / 7));
    const t = weightTrend(rows, TODAY, LONDON)!;
    expect(t.ratePerWeek).toBeCloseTo(-0.5, 2);
  });
});

describe('projectGoal', () => {
  const losing = () => weightTrend(Array.from({ length: 120 }, (_, i) => w(119 - i, 90 - (i * 0.5) / 7)), TODAY, LONDON)!;

  it('dates the goal from the trend and the rate', () => {
    const t = losing();
    const p = projectGoal(t, t.trend - 2, TODAY);
    expect(p.weeks).toBeCloseTo(4, 0);
    expect(p.goalDate).toBe(addDays(TODAY, Math.ceil(2 / (Math.abs(t.ratePerWeek) / 7))));
    expect(p.reached).toBe(false);
  });

  it('gives no date when the trend is going the wrong way or the goal is over a year off', () => {
    const t = losing();
    expect(projectGoal(t, t.trend + 2, TODAY).goalDate).toBeNull();
    expect(projectGoal(t, t.trend - 40, TODAY).goalDate).toBeNull();
  });

  it('progress runs from the first trend value to the goal', () => {
    const t = weightTrend([w(10, 90), w(0, 80)], TODAY, LONDON)!;
    const p = projectGoal(t, 80, TODAY);
    expect(p.progress).toBeCloseTo(((90 - t.trend) / 10) * 100, 6);
  });
});
