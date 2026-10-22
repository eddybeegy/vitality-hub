import { describe, expect, it } from 'vitest';
import { computeTrainingLoad, dailyMinutes, loadZone } from './trainingLoad';
import { addDays } from './dayTags';

const LONDON = 'Europe/London';
const TODAY = '2026-10-22';
const at = (daysAgo: number, minutes: number, time = '07:00:00Z') => ({ timestamp: `${addDays(TODAY, -daysAgo)}T${time}`, duration: minutes });

describe('dailyMinutes', () => {
  it('sums a day across sources, fills rest days with 0, and uses the London day', () => {
    const d = dailyMinutes([
      at(0, 60), at(0, 30),
      { timestamp: '2026-10-20T23:30:00Z', duration: 45 }, // 00:30 BST on 21 Oct
      at(200, 90), // outside the window
    ], TODAY, LONDON, 3);
    expect(d).toEqual([
      { day: '2026-10-20', minutes: 0 },
      { day: '2026-10-21', minutes: 45 },
      { day: '2026-10-22', minutes: 90 },
    ]);
  });
});

describe('computeTrainingLoad', () => {
  it('is null with no workouts', () => {
    expect(computeTrainingLoad([], TODAY, LONDON)).toBeNull();
    expect(computeTrainingLoad([at(300, 60)], TODAY, LONDON)).toBeNull();
  });

  it('settles near the daily average on a steady routine, with form near 0 and an optimal ratio', () => {
    const steady = Array.from({ length: 120 }, (_, i) => at(i, 60));
    const l = computeTrainingLoad(steady, TODAY, LONDON)!;
    expect(l.fatigue).toBeCloseTo(60, 0);
    expect(l.fitness).toBeGreaterThan(55);
    expect(Math.abs(l.form)).toBeLessThan(5);
    expect(l.ratio).toBeCloseTo(1, 5);
    expect(l.zone).toBe('optimal');
  });

  it('a hard week after a quiet month: fatigue above fitness, negative form, high ratio', () => {
    const quiet = Array.from({ length: 21 }, (_, i) => at(7 + i, 20));
    const hard = Array.from({ length: 7 }, (_, i) => at(i, 90));
    const l = computeTrainingLoad([...quiet, ...hard], TODAY, LONDON)!;
    expect(l.fatigue).toBeGreaterThan(l.fitness);
    expect(l.form).toBeLessThan(0);
    expect(l.ratio).toBeCloseTo(90 / ((90 * 7 + 20 * 21) / 28), 5);
    expect(l.zone).toBe('high');
  });

  it("form is yesterday's: today's session does not change it", () => {
    const base = Array.from({ length: 30 }, (_, i) => at(i + 1, 40));
    const without = computeTrainingLoad(base, TODAY, LONDON)!;
    const withToday = computeTrainingLoad([...base, at(0, 120)], TODAY, LONDON)!;
    expect(withToday.form).toBeCloseTo(without.form, 10);
    expect(withToday.fatigue).toBeGreaterThan(without.fatigue);
  });
});

describe('loadZone', () => {
  it('keeps the old widget thresholds', () => {
    expect(loadZone(0.79)).toBe('detraining');
    expect(loadZone(0.8)).toBe('optimal');
    expect(loadZone(1.3)).toBe('building');
    expect(loadZone(1.5)).toBe('high');
  });
});
