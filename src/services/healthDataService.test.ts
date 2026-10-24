import { describe, it, expect } from 'vitest';
import {
  mapMetricName,
  standardizeMetric,
  deduplicateMetrics,
  standardizeWorkout,
  deduplicateWorkouts,
  standardizeMetrics,
  getSleepDurationData,
} from './healthDataService';

describe('mapMetricName', () => {
  it('maps known metric aliases to canonical names', () => {
    expect(mapMetricName('heartRate')).toBe('heart_rate');
    expect(mapMetricName('steps')).toBe('steps');
  });
});

describe('standardizeMetric', () => {
  it('produces a StandardizedMetric object from raw input', () => {
    const raw = { type: 'weight', value: '80', unit: 'kg', timestamp: '2024-01-01T12:00:00Z', source: 'manual' };
    const s = standardizeMetric(raw as any);
    expect(s.type).toBe('weight');
    expect(s.value).toBe(80);
    expect(s.unit).toBe('kg');
    expect(s.source).toBe('manual');
  });
});

describe('deduplicateMetrics', () => {
  it('deduplicates near-duplicate metrics preferring higher-priority source', () => {
    const a = { type: 'weight', value: 80, timestamp: '2024-01-01T12:00:00Z', source: 'manual' } as any;
    const b = { type: 'weight', value: 80.5, timestamp: '2024-01-01T12:00:30Z', source: 'apple_health' } as any;
    const out = deduplicateMetrics([a, b]);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});

describe('workout standardization', () => {
  it('standardizes and deduplicates workouts', () => {
    const w1 = { id: 1, name: 'Run', duration: 30, timestamp: '2024-01-01T08:00:00Z', source: 'strava' } as any;
    const w2 = { id: 2, name: 'Run', duration: 30, timestamp: '2024-01-01T08:02:00Z', source: 'apple_health' } as any;
    const standardized = [w1, w2].map(w => standardizeWorkout(w));
    const deduped = deduplicateWorkouts(standardized);
    expect(deduped.length).toBeGreaterThan(0);
  });
});

describe('getSleepDurationData', () => {
  // The 2026-10-23 night, verbatim from /api/data/summary: the server sends both an
  // aggregated `sleep_total` (what Apple reports as asleep) and a synthetic `sleep`
  // row carrying the stage sum, and METRIC_MAP folds `sleep` into `sleep_total`, so
  // both reach the grouping under one type. They used to be added: 11.9 h on the card
  // for a 6 h 39 m night. Every prior night had the two figures equal, so
  // deduplicateMetrics' 1% guard dropped one and hid it.
  const night = [
    { type: 'sleep_total', value: 23951.71875, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
    { type: 'sleep', value: 18831.986083984375, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
    { type: 'sleep_core', value: 10778.1845703125, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
    { type: 'sleep_rem', value: 5209.4931640625, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
    { type: 'sleep_deep', value: 2844.308349609375, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
    { type: 'sleep_awake', value: 89.821044921875, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
    { type: 'sleep_in_bed', value: 0, unit: 's', timestamp: '2026-10-23', source: 'apple_health' },
  ] as any[];

  it('reports the recorded total, not the total plus the stage sum', () => {
    const out = getSleepDurationData(standardizeMetrics(night), 'Europe/London');
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-10-23');
    expect(out[0].hours).toBeCloseTo(6.653, 2);
  });

  it('still prefers the stage sum when it exceeds the recorded total', () => {
    const gappy = night.map(m => m.type === 'sleep_total' ? { ...m, value: 3600 } : m);
    const out = getSleepDurationData(standardizeMetrics(gappy), 'Europe/London');
    expect(out[0].hours).toBeCloseTo(5.231, 2);
  });
});
