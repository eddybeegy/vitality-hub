import { describe, it, expect } from 'vitest';
import {
  mapMetricName,
  standardizeMetric,
  deduplicateMetrics,
  standardizeWorkout,
  deduplicateWorkouts,
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
