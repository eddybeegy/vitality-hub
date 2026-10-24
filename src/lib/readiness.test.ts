import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateReadinessScore } from './readiness';

const LONDON = 'Europe/London';

function series(type: string, endDay: string, values: number[]) {
  const [y, m, d] = endDay.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  return values.map((value, i) => ({
    type,
    value,
    timestamp: new Date(end - (values.length - 1 - i) * 86400000).toISOString().slice(0, 10),
  }));
}

const alternating = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => (i % 2 ? a : b));

describe('calculateReadinessScore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T07:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const base = [
    ...series('hrv', '2026-10-21', [...alternating(14, 48, 52), 50]),
    ...series('sleep', '2026-10-21', [8 * 3600]),
    ...series('active_energy', '2026-10-20', [500, 500]),
  ];

  it('without resting HR keeps the original three components and weights', () => {
    const r = calculateReadinessScore(base, [], LONDON)!;
    expect(r.components.map(c => [c.name, c.weight])).toEqual([
      ['HRV', 0.4],
      ['Sleep', 0.4],
      ['Activity Burn', 0.2],
    ]);
    expect(r.components[0].baseline).not.toBeNull();
  });

  it('with resting HR adds a fourth component and the weights still sum to 1', () => {
    const r = calculateReadinessScore(
      [...base, ...series('resting_heart_rate', '2026-10-21', [...alternating(14, 54, 56), 55])],
      [],
      LONDON
    )!;
    expect(r.components.map(c => c.name)).toEqual(['HRV', 'Resting HR', 'Sleep', 'Activity Burn']);
    expect(r.components.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 10);
    const rhr = r.components[1];
    expect(rhr.score).toBeGreaterThan(80);
    expect(rhr.label).toMatch(/^55bpm · normal 5\d–5\d$/);
  });

  it('an elevated resting HR pulls the total down', () => {
    const normal = calculateReadinessScore(
      [...base, ...series('resting_heart_rate', '2026-10-21', [...alternating(14, 54, 56), 55])], [], LONDON)!;
    const elevated = calculateReadinessScore(
      [...base, ...series('resting_heart_rate', '2026-10-21', [...alternating(14, 54, 56), 64])], [], LONDON)!;
    expect(elevated.score).toBeLessThan(normal.score);
  });

  it('HRV well below the personal range scores the component low', () => {
    const r = calculateReadinessScore(
      [...series('hrv', '2026-10-21', [...alternating(14, 48, 52), 38]), ...base.slice(15)],
      [],
      LONDON
    )!;
    expect(r.components[0].score).toBeLessThan(40);
  });

  describe('sleep duration source', () => {
    // 2026-10-23, verbatim: 6 h 39 m recorded asleep, 5 h 14 m of classified stages.
    const night = (extra: any[]) => [
      ...series('hrv', '2026-10-21', [...alternating(14, 48, 52), 50]),
      ...series('active_energy', '2026-10-20', [500, 500]),
      ...extra,
    ];
    const stages = [
      ...series('sleep_core', '2026-10-21', [10778.1845703125]),
      ...series('sleep_rem', '2026-10-21', [5209.4931640625]),
      ...series('sleep_deep', '2026-10-21', [2844.308349609375]),
    ];
    const label = (metrics: any[]) =>
      calculateReadinessScore(metrics, [], LONDON)!.components.find(c => c.name === "Sleep")!.label;

    it('prefers the recorded total over an undercounting stage breakdown', () => {
      expect(label(night([...stages, ...series('sleep_total', '2026-10-21', [23951.71875])]))).toBe('6.7h / 8h');
    });

    it('still uses the stage sum when there is no recorded total', () => {
      expect(label(night(stages))).toBe('5.2h / 8h');
    });

    it('discards an implausible recorded total in favour of the stages', () => {
      expect(label(night([...stages, ...series('sleep_total', '2026-10-21', [13 * 3600])]))).toBe('5.2h / 8h');
    });

    it('falls back to 8h when the only figure is an implausible total', () => {
      expect(label(night(series('sleep_total', '2026-10-21', [13 * 3600])))).toBe('8.0h / 8h');
    });
  });
});
