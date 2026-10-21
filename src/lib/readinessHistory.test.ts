import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateReadinessScore } from './readiness';
import {
  computeReadinessHistory,
  dayRange,
  explainChange,
  historyForAIContext,
  parseStoredComponents,
  previousSnapshot,
  toSnapshot,
  type ReadinessSnapshot,
} from './readinessHistory';

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

// 21 days of HRV, resting HR, sleep and burn ending today (2026-10-21), with a
// bad last night: low HRV, short sleep. Sleep rows are dated by the night they
// started, as aggregateDailyMetrics dates them, so last night is 2026-10-20.
const metrics = [
  ...series('hrv', '2026-10-21', [...alternating(20, 48, 52), 38]),
  ...series('resting_heart_rate', '2026-10-21', [...alternating(20, 54, 56), 55]),
  ...series('sleep', '2026-10-20', [...Array(20).fill(8 * 3600), 5 * 3600]),
  ...series('active_energy', '2026-10-20', Array(20).fill(500)),
];

describe('calculateReadinessScore asOf', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T07:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it("asOf today gives exactly today's live score", () => {
    expect(calculateReadinessScore(metrics, [], LONDON, '2026-10-21')).toEqual(calculateReadinessScore(metrics, [], LONDON));
  });

  it('asOf a past day ignores everything after it', () => {
    const past = calculateReadinessScore(metrics, [], LONDON, '2026-10-20')!;
    const truncated = metrics.filter(m => m.timestamp <= (m.type === 'sleep' ? '2026-10-19' : '2026-10-20'));
    vi.setSystemTime(new Date('2026-10-20T07:00:00Z'));
    expect(past).toEqual(calculateReadinessScore(truncated, [], LONDON));
  });

  it('asOf before any data is null', () => {
    expect(calculateReadinessScore(metrics, [], LONDON, '2025-01-01')).toBeNull();
  });

  it("asOf a day uses the night that ended that morning, not the following night", () => {
    const r = calculateReadinessScore(metrics, [], LONDON, '2026-10-20')!;
    expect(r.components.find(c => c.name === 'Sleep')!.label).toBe('8.0h / 8h');
    const today = calculateReadinessScore(metrics, [], LONDON, '2026-10-21')!;
    expect(today.components.find(c => c.name === 'Sleep')!.label).toBe('5.0h / 8h');
  });

  it('asOf works on full timestamps too, by the day in the zone', () => {
    // 23:30Z on the 20th is 00:30 on the 21st in London (BST).
    const late = [{ type: 'hrv', value: 50, timestamp: '2026-10-20T23:30:00Z' }];
    expect(calculateReadinessScore(late, [], LONDON, '2026-10-20')).toBeNull();
    expect(calculateReadinessScore(late, [], LONDON, '2026-10-21')).not.toBeNull();
  });
});

describe('computeReadinessHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T07:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('scores each day as of itself and drops days with no fresh input', () => {
    const days = dayRange('2026-09-28', '2026-10-21');
    const h = computeReadinessHistory(metrics, [], LONDON, days);
    // HRV starts 2026-10-01; sleep starts the night of 2026-09-30, which counts
    // for the morning of 10-01. Earlier days have no reading of their own.
    expect(h[0].date).toBe('2026-10-01');
    expect(h.at(-1)!.date).toBe('2026-10-21');
    expect(h).toHaveLength(21);
    for (const s of h) {
      expect(s.score).toBe(calculateReadinessScore(metrics, [], LONDON, s.date)!.score);
    }
  });

  it('a day with only burn data is a gap, not a repeat of the day before', () => {
    const gappy = [
      ...series('hrv', '2026-10-19', alternating(10, 48, 52)),
      ...series('active_energy', '2026-10-21', Array(12).fill(500)),
    ];
    const h = computeReadinessHistory(gappy, [], LONDON, dayRange('2026-10-18', '2026-10-21'));
    expect(h.map(s => s.date)).toEqual(['2026-10-18', '2026-10-19']);
  });

  it('a night of sleep makes the next morning fresh, not the evening it started', () => {
    const sleepOnly = series('sleep', '2026-10-19', [8 * 3600]);
    expect(computeReadinessHistory(sleepOnly, [], LONDON, ['2026-10-19', '2026-10-20']).map(s => s.date)).toEqual(['2026-10-20']);
  });

  it('a bad night shows as a drop on the day', () => {
    const h = computeReadinessHistory(metrics, [], LONDON, ['2026-10-20', '2026-10-21']);
    expect(h[1].score).toBeLessThan(h[0].score - 10);
  });
});

describe('explainChange', () => {
  const snap = (date: string, parts: Record<string, [number, number]>): ReadinessSnapshot => {
    const components = Object.entries(parts).map(([name, [score, weight]]) => ({ name, score, weight, label: '' }));
    return { date, score: Math.round(components.reduce((a, c) => a + c.score * c.weight, 0)), components };
  };

  it('names the component that moved the total most, with signed points', () => {
    const prev = snap('2026-10-20', { HRV: [85, 0.3], 'Resting HR': [85, 0.15], Sleep: [100, 0.35], 'Activity Burn': [70, 0.2] });
    const now = snap('2026-10-21', { HRV: [60, 0.3], 'Resting HR': [85, 0.15], Sleep: [62.5, 0.35], 'Activity Burn': [70, 0.2] });
    const c = explainChange(now, prev);
    expect(c.delta).toBe(now.score - prev.score);
    expect(c.driver).toEqual({ name: 'Sleep', delta: -13 });
    expect(c.components.map(x => x.name)).toEqual(['Sleep', 'HRV', 'Resting HR', 'Activity Burn']);
    expect(c.summary).toBe(`Down ${prev.score - now.score} since yesterday, mostly Sleep (−13)`);
  });

  it('component deltas add up to the total change, within rounding', () => {
    const prev = snap('2026-10-20', { HRV: [70, 0.4], Sleep: [80, 0.4], 'Activity Burn': [90, 0.2] });
    const now = snap('2026-10-21', { HRV: [95, 0.4], Sleep: [85, 0.4], 'Activity Burn': [60, 0.2] });
    const c = explainChange(now, prev);
    const sum = c.components.reduce((a, x) => a + x.delta, 0);
    expect(Math.abs(sum - c.delta)).toBeLessThanOrEqual(2);
    expect(c.summary).toMatch(/^Up \d+ since yesterday, mostly HRV \(\+10\)$/);
  });

  it('a small move is steady and names no driver', () => {
    const prev = snap('2026-10-20', { HRV: [80, 0.4], Sleep: [80, 0.4], 'Activity Burn': [80, 0.2] });
    const now = snap('2026-10-21', { HRV: [82, 0.4], Sleep: [80, 0.4], 'Activity Burn': [80, 0.2] });
    const c = explainChange(now, prev);
    expect(c.driver).toBeNull();
    expect(c.summary).toBe('Steady since yesterday');
  });

  it('resting HR appearing counts from zero on the day without it', () => {
    const prev = snap('2026-10-20', { HRV: [80, 0.4], Sleep: [80, 0.4], 'Activity Burn': [80, 0.2] });
    const now = snap('2026-10-21', { HRV: [80, 0.3], 'Resting HR': [80, 0.15], Sleep: [80, 0.35], 'Activity Burn': [80, 0.2] });
    const c = explainChange(now, prev);
    expect(c.components.find(x => x.name === 'Resting HR')!.delta).toBe(12);
  });

  it('compares against an older day by date when yesterday is missing', () => {
    const prev = snap('2026-10-17', { HRV: [90, 0.4], Sleep: [90, 0.4], 'Activity Burn': [90, 0.2] });
    const now = snap('2026-10-21', { HRV: [60, 0.4], Sleep: [90, 0.4], 'Activity Burn': [90, 0.2] });
    expect(explainChange(now, prev).summary).toBe('Down 12 since Sat 17 Oct, mostly HRV (−12)');
  });
});

describe('helpers', () => {
  it('previousSnapshot picks the latest day before today', () => {
    const h = ['2026-10-18', '2026-10-21', '2026-10-19'].map(date => ({ date, score: 1, components: [] }));
    expect(previousSnapshot(h, '2026-10-21')!.date).toBe('2026-10-19');
    expect(previousSnapshot(h, '2026-10-18')).toBeNull();
  });

  it('dayRange crosses the October clock change and month ends', () => {
    expect(dayRange('2026-10-24', '2026-11-02')).toHaveLength(10);
  });

  it('toSnapshot drops baselines and keeps one decimal', () => {
    const s = toSnapshot('2026-10-21', {
      score: 70,
      recommendation: '',
      components: [{ name: 'HRV', score: 61.234, weight: 0.4, label: 'x', baseline: { mean: 50, low: 45, high: 55, days: 28 } }],
    });
    expect(s.components).toEqual([{ name: 'HRV', score: 61.2, weight: 0.4, label: 'x' }]);
  });

  it('historyForAIContext flattens component names', () => {
    const rows = historyForAIContext([{ date: '2026-10-21', score: 70, components: [
      { name: 'Resting HR', score: 80.4, weight: 0.15, label: '' },
      { name: 'Activity Burn', score: 59.6, weight: 0.2, label: '' },
    ] }]);
    expect(rows).toEqual([{ date: '2026-10-21', score: 70, resting_hr: 80, activity_burn: 60 }]);
  });

  it('parseStoredComponents survives junk', () => {
    expect(parseStoredComponents('not json')).toEqual([]);
    expect(parseStoredComponents(null)).toEqual([]);
    expect(parseStoredComponents('[{"name":"HRV"}]')).toEqual([{ name: 'HRV' }]);
  });
});
