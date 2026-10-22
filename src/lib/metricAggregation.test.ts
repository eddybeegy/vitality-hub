import { describe, it, expect } from 'vitest';
import { aggregateDailyValues, isSummedMetric } from './metricAggregation';

const row = (type: string, value: number, timestamp: string) => ({ type, value, timestamp });

describe('isSummedMetric', () => {
  it('treats daily totals and nutrients as summed', () => {
    expect(isSummedMetric('steps')).toBe(true);
    expect(isSummedMetric('protein')).toBe(true);
    expect(isSummedMetric('sleep_deep')).toBe(true);
    expect(isSummedMetric('sleep_total')).toBe(true);
  });

  it('treats readings as not summed', () => {
    expect(isSummedMetric('weight')).toBe(false);
    expect(isSummedMetric('resting_heart_rate')).toBe(false);
    // bedtime is an offset, never a quantity -- it must not look summable.
    expect(isSummedMetric('bedtime')).toBe(false);
  });
});

describe('aggregateDailyValues', () => {
  it('sums totals and averages readings on the same day', () => {
    const [day] = aggregateDailyValues([
      row('steps', 4000, '2026-10-20T08:00:00Z'),
      row('steps', 3000, '2026-10-20T18:00:00Z'),
      row('weight', 80, '2026-10-20T07:00:00Z'),
      row('weight', 82, '2026-10-20T20:00:00Z'),
    ], 'UTC');
    expect(day.steps).toBe(7000);
    expect(day.weight).toBe(81);
  });

  it('shifts sleep rows back 12h so an after-midnight reading lands on its night', () => {
    const rows = aggregateDailyValues([row('sleep', 420, '2026-10-21T02:40:00Z')], 'UTC');
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-10-20');
    expect(rows[0].sleep).toBe(420);
  });

  it('does not shift non-sleep rows', () => {
    expect(aggregateDailyValues([row('steps', 10, '2026-10-21T02:40:00Z')], 'UTC')[0].date).toBe('2026-10-21');
  });

  it('takes the day in the requested zone', () => {
    // 23:30 UTC is already the 21st in London.
    expect(aggregateDailyValues([row('steps', 10, '2026-10-20T23:30:00Z')], 'Europe/London')[0].date).toBe('2026-10-21');
  });

  it('reads a naive sqlite timestamp as UTC', () => {
    expect(aggregateDailyValues([row('steps', 10, '2026-10-20 12:00:00')], 'UTC')[0].date).toBe('2026-10-20');
  });

  it('skips unparseable rows instead of keying them on Invalid Date', () => {
    const rows = aggregateDailyValues([
      row('steps', 10, 'not-a-date'),
      { type: 'steps', value: 'NaN' as any, timestamp: '2026-10-20T10:00:00Z' },
      row('steps', 5, '2026-10-20T11:00:00Z'),
    ], 'UTC');
    expect(rows).toHaveLength(1);
    expect(rows[0].steps).toBe(5);
  });

  it('returns newest day first', () => {
    const rows = aggregateDailyValues([
      row('steps', 1, '2026-10-18T10:00:00Z'),
      row('steps', 1, '2026-10-20T10:00:00Z'),
      row('steps', 1, '2026-10-19T10:00:00Z'),
    ], 'UTC');
    expect(rows.map((r) => r.date)).toEqual(['2026-10-20', '2026-10-19', '2026-10-18']);
  });

  it('returns nothing for no rows', () => {
    expect(aggregateDailyValues([], 'UTC')).toEqual([]);
  });
});
