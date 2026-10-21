import { describe, it, expect } from 'vitest';
import {
  parseEnumParam,
  parseDateParam,
  parseDayParam,
  parseIntParam,
  checkDateOrder,
} from './queryParams';

const GRANULARITIES = ['day', 'week', 'month'] as const;
const AGGREGATIONS = ['avg', 'sum', 'max', 'min'] as const;

describe('parseEnumParam', () => {
  it('accepts every allowed value', () => {
    for (const g of GRANULARITIES) expect(parseEnumParam('granularity', g, GRANULARITIES)).toEqual({ value: g });
  });

  it('rejects an unknown granularity instead of falling into the month branch', () => {
    const r = parseEnumParam('granularity', 'fortnight', GRANULARITIES);
    expect(r.error).toContain("'fortnight'");
  });

  it('rejects an unknown aggregation instead of silently averaging', () => {
    expect(parseEnumParam('aggregation', 'median', AGGREGATIONS, 'avg').error).toBeTruthy();
    expect(parseEnumParam('aggregation', 'SUM', AGGREGATIONS, 'avg').error).toBeTruthy(); // case matters
  });

  it('uses the fallback only when the param is absent', () => {
    expect(parseEnumParam('aggregation', undefined, AGGREGATIONS, 'avg')).toEqual({ value: 'avg' });
    expect(parseEnumParam('aggregation', '', AGGREGATIONS, 'avg').error).toBeTruthy();
  });

  it('treats a missing required param as an error', () => {
    const r = parseEnumParam('granularity', undefined, GRANULARITIES);
    expect(r).toEqual({ error: 'Missing granularity' });
  });

  it('rejects repeated and nested params rather than stringifying them', () => {
    expect(parseEnumParam('granularity', ['day', 'week'], GRANULARITIES).error).toBeTruthy();
    expect(parseEnumParam('granularity', { a: 'day' }, GRANULARITIES).error).toBeTruthy();
  });
});

describe('parseDateParam', () => {
  it('returns null when absent so the route keeps its default window', () => {
    expect(parseDateParam('startDate', undefined)).toEqual({ value: null });
  });

  it('accepts what the client sends and resolves it exactly as new Date() did', () => {
    // HealthChart sends Date#toISOString().
    const iso = '2026-09-21T10:49:48.123Z';
    const r = parseDateParam('startDate', iso);
    expect(r.value!.toISOString()).toBe(iso);
    const day = parseDateParam('startDate', '2026-10-21');
    expect(day.value!.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    const off = parseDateParam('endDate', '2026-10-21T01:00:00+01:00');
    expect(off.value!.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('rejects garbage that used to become "365 days ago" / "now"', () => {
    for (const bad of ['nonsense', '', 'yesterday', '99999-99-99', '2026', '10/21/2026', '2026-10-21 10:00']) {
      expect(parseDateParam('startDate', bad).error, bad).toBeTruthy();
    }
  });

  it('rejects dates new Date() would roll over', () => {
    // new Date('2026-02-30') is Invalid in V8 but '2026-02-30T00:00:00Z' is too; either way, 400.
    expect(parseDateParam('startDate', '2026-02-30').error).toBeTruthy();
    expect(parseDateParam('startDate', '2026-13-01').error).toBeTruthy();
    expect(parseDateParam('startDate', '2026-04-31T00:00:00Z').error).toBeTruthy();
    expect(parseDateParam('startDate', '2028-02-29').error).toBeUndefined(); // leap day
    expect(parseDateParam('startDate', '2027-02-29').error).toBeTruthy();
  });

  it('rejects out-of-range times', () => {
    expect(parseDateParam('endDate', '2026-10-21T24:00:00Z').error).toBeTruthy();
    expect(parseDateParam('endDate', '2026-10-21T10:60Z').error).toBeTruthy();
  });

  it('rejects repeated params', () => {
    expect(parseDateParam('startDate', ['2026-10-01', '2026-10-02']).error).toBeTruthy();
  });
});

describe('parseDayParam', () => {
  it('accepts a plain calendar day', () => {
    expect(parseDayParam('date', '2026-10-21')).toEqual({ value: '2026-10-21' });
    expect(parseDayParam('date', undefined)).toEqual({ value: null });
  });

  it('rejects 99999-99-99 instead of answering for today', () => {
    expect(parseDayParam('date', '99999-99-99').error).toBeTruthy();
    expect(parseDayParam('date', '2026-02-30').error).toBeTruthy();
    expect(parseDayParam('date', '2026-10-21T00:00:00Z').error).toBeTruthy();
  });
});

describe('parseIntParam', () => {
  const opts = { min: 1, max: 3650, fallback: 30 };

  it('falls back when absent and accepts in-range integers', () => {
    expect(parseIntParam('days', undefined, opts)).toEqual({ value: 30 });
    expect(parseIntParam('days', '7', opts)).toEqual({ value: 7 });
  });

  it('rejects what parseInt would half-read or NaN', () => {
    for (const bad of ['abc', '30abc', '1e3', '-5', '7.5', '', ' 7']) {
      expect(parseIntParam('days', bad, opts).error, bad).toBeTruthy();
    }
  });

  it('rejects out-of-range values', () => {
    expect(parseIntParam('days', '0', opts).error).toBeTruthy();
    expect(parseIntParam('days', '3651', opts).error).toBeTruthy();
  });
});

describe('checkDateOrder', () => {
  const a = new Date('2026-10-01T00:00:00Z');
  const b = new Date('2026-10-21T00:00:00Z');

  it('allows a forward or open-ended window', () => {
    expect(checkDateOrder(a, b)).toBeNull();
    expect(checkDateOrder(a, a)).toBeNull();
    expect(checkDateOrder(null, a)).toBeNull();
    expect(checkDateOrder(b, null)).toBeNull();
  });

  it('rejects a backwards window', () => {
    expect(checkDateOrder(b, a)).toMatch(/after endDate/);
  });
});
