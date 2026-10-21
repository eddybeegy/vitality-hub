import { describe, expect, it } from 'vitest';
import {
  dailySeries,
  personalBaseline,
  scoreAgainstBaseline,
  windowBefore,
  zToScore,
  type DailyValue,
} from './baselines';

const LONDON = 'Europe/London';

/** `n` consecutive days ending the day before `scoredDay`, values from `f(i)`. */
function daysBefore(scoredDay: string, n: number, f: (i: number) => number): DailyValue[] {
  const [y, m, d] = scoredDay.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(end - (n - i) * 86400000).toISOString().slice(0, 10),
    value: f(i),
  }));
}

const rows = (type: string, series: DailyValue[]) =>
  series.map(p => ({ type, value: p.value, timestamp: p.day }));

describe('dailySeries', () => {
  it('keeps bare days, averages a repeated day, drops other types and gaps', () => {
    const s = dailySeries(
      [
        { type: 'hrv', value: 40, timestamp: '2026-10-20' },
        { type: 'hrv', value: 60, timestamp: '2026-10-20' },
        { type: 'hrv', value: 0, timestamp: '2026-10-19' },
        { type: 'hrv', value: NaN, timestamp: '2026-10-18' },
        { type: 'heart_rate', value: 70, timestamp: '2026-10-20' },
        { type: 'hrv', value: 55, timestamp: '2026-10-17' },
      ],
      'hrv',
      LONDON
    );
    expect(s).toEqual([
      { day: '2026-10-17', value: 55 },
      { day: '2026-10-20', value: 50 },
    ]);
  });

  it('formats a full UTC timestamp into the user day (BST: 23:30Z is the next London day)', () => {
    const s = dailySeries([{ type: 'hrv', value: 50, timestamp: '2026-10-20T23:30:00Z' }], 'hrv', LONDON);
    expect(s).toEqual([{ day: '2026-10-21', value: 50 }]);
  });

  it('after the clock change 23:30Z stays on the same London day', () => {
    const s = dailySeries([{ type: 'hrv', value: 50, timestamp: '2026-10-26T23:30:00Z' }], 'hrv', LONDON);
    expect(s).toEqual([{ day: '2026-10-26', value: 50 }]);
  });
});

describe('windowBefore', () => {
  it('is the 28 calendar days before the scored day, never the day itself', () => {
    const series = daysBefore('2026-11-10', 40, () => 1).concat({ day: '2026-11-10', value: 1 });
    const w = windowBefore(series, '2026-11-10');
    expect(w).toHaveLength(28);
    expect(w[0].day).toBe('2026-10-13');
    expect(w[w.length - 1].day).toBe('2026-11-09');
  });

  it('counts the 25-hour day of the clock change as one day', () => {
    const series = daysBefore('2026-10-26', 3, () => 1);
    expect(series.map(p => p.day)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
    expect(windowBefore(series, '2026-10-26', 2).map(p => p.day)).toEqual(['2026-10-24', '2026-10-25']);
  });
});

describe('personalBaseline', () => {
  it('needs 7 days of history', () => {
    expect(personalBaseline(daysBefore('2026-10-21', 6, () => 50), '2026-10-21')).toBeNull();
    expect(personalBaseline(daysBefore('2026-10-21', 7, () => 50), '2026-10-21')).not.toBeNull();
  });

  it('is mean +/- 1 sample SD on raw values', () => {
    // 50, 60 alternating: mean 55, sample SD of 8 values = 5.345
    const b = personalBaseline(daysBefore('2026-10-21', 8, i => (i % 2 ? 60 : 50)), '2026-10-21')!;
    expect(b.mean).toBeCloseTo(55, 6);
    expect(b.sd).toBeCloseTo(5.345, 3);
    expect(b.low).toBeCloseTo(49.655, 3);
    expect(b.high).toBeCloseTo(60.345, 3);
    expect(b.days).toBe(8);
  });

  it('on log values the centre is the geometric mean and the range is asymmetric', () => {
    const b = personalBaseline(daysBefore('2026-10-21', 8, i => (i % 2 ? 80 : 20)), '2026-10-21', { log: true })!;
    expect(b.mean).toBeCloseTo(40, 6);
    expect(b.high - b.mean).toBeGreaterThan(b.mean - b.low);
  });

  it('floors the SD at 5% so a flat run does not make every wobble an outlier', () => {
    const b = personalBaseline(daysBefore('2026-10-21', 10, () => 60), '2026-10-21')!;
    expect(b.sd).toBeCloseTo(3, 6);
  });
});

describe('zToScore', () => {
  it.each([
    [0, 'higher', 85],
    [1, 'higher', 100],
    [3, 'higher', 100],
    [-1, 'higher', 60],
    [-2, 'higher', 35],
    [-5, 'higher', 0],
    [-1, 'lower', 100],
    [1, 'lower', 60],
  ] as const)('z=%d (%s is better) -> %d', (z, dir, score) => {
    expect(zToScore(z, dir)).toBeCloseTo(score, 6);
  });
});

describe('scoreAgainstBaseline', () => {
  const day = '2026-10-21';

  it('null with no reading', () => {
    expect(scoreAgainstBaseline([], 'hrv', { direction: 'higher', unit: 'ms' })).toBeNull();
  });

  it('the same 10% HRV drop scores lower for a steady person than for a variable one', () => {
    // The old ratio scoring gave both 76.5; against a personal range they differ.
    const steady = rows('hrv', daysBefore(day, 28, i => (i % 2 ? 49 : 51)).concat({ day, value: 45 }));
    const variable = rows('hrv', daysBefore(day, 28, i => (i % 2 ? 35 : 65)).concat({ day, value: 45 }));
    const a = scoreAgainstBaseline(steady, 'hrv', { direction: 'higher', unit: 'ms', log: true })!;
    const b = scoreAgainstBaseline(variable, 'hrv', { direction: 'higher', unit: 'ms', log: true })!;
    expect(a.score).toBeLessThan(b.score);
    expect(a.score).toBeLessThan(60);
    expect(b.score).toBeGreaterThan(60);
    expect(a.label).toMatch(/^45ms · normal \d+–\d+$/);
    expect(a.day).toBe(day);
  });

  it('resting HR above the range scores down, below it scores up', () => {
    const hist = daysBefore(day, 14, i => (i % 2 ? 54 : 56));
    const high = scoreAgainstBaseline(rows('resting_heart_rate', hist.concat({ day, value: 62 })), 'resting_heart_rate', { direction: 'lower', unit: 'bpm' })!;
    const low = scoreAgainstBaseline(rows('resting_heart_rate', hist.concat({ day, value: 52 })), 'resting_heart_rate', { direction: 'lower', unit: 'bpm' })!;
    expect(high.score).toBeLessThan(85);
    expect(low.score).toBeGreaterThan(85);
    expect(high.baseline!.mean).toBeCloseTo(55, 6);
    expect(high.label).toBe('62bpm · normal 52–58');
  });

  it('under 7 days of history falls back to the ratio and says so', () => {
    const r = scoreAgainstBaseline(rows('hrv', daysBefore(day, 3, () => 50).concat({ day, value: 55 })), 'hrv', { direction: 'higher', unit: 'ms', log: true })!;
    expect(r.baseline).toBeNull();
    expect(r.score).toBeCloseTo(93.5, 6);
    expect(r.label).toBe('55ms (+10%, 3/7d baseline)');
  });

  it('no history in the window is a neutral 80', () => {
    const r = scoreAgainstBaseline(
      rows('hrv', [{ day: '2026-08-01', value: 40 }, { day, value: 50 }]),
      'hrv',
      { direction: 'higher', unit: 'ms' }
    )!;
    expect(r.score).toBe(80);
    expect(r.label).toBe('50ms (No baseline)');
  });
});
