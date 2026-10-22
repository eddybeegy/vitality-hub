import { describe, it, expect } from 'vitest';
import { metricsCsvHref, isWindowed, rangeOrderError } from './exportHref';

describe('metricsCsvHref', () => {
  it('is the bare route when neither bound is set', () => {
    expect(metricsCsvHref()).toBe('/api/export/metrics.csv');
    expect(metricsCsvHref('', '')).toBe('/api/export/metrics.csv');
    expect(metricsCsvHref(null, undefined)).toBe('/api/export/metrics.csv');
  });

  it('carries whichever bounds are set, leaving the other side open', () => {
    expect(metricsCsvHref('2026-01-01')).toBe('/api/export/metrics.csv?startDate=2026-01-01');
    expect(metricsCsvHref(null, '2026-03-31')).toBe('/api/export/metrics.csv?endDate=2026-03-31');
    expect(metricsCsvHref('2026-01-01', '2026-03-31'))
      .toBe('/api/export/metrics.csv?startDate=2026-01-01&endDate=2026-03-31');
  });

  it('drops a malformed day rather than sending it', () => {
    expect(metricsCsvHref('01/01/2026', '2026-03-31')).toBe('/api/export/metrics.csv?endDate=2026-03-31');
    expect(metricsCsvHref('2026-1-1')).toBe('/api/export/metrics.csv');
  });

  it('passes an out-of-order range through for the server to reject', () => {
    expect(metricsCsvHref('2026-03-31', '2026-01-01'))
      .toBe('/api/export/metrics.csv?startDate=2026-03-31&endDate=2026-01-01');
  });
});

describe('isWindowed', () => {
  it('is false only when the export is still everything', () => {
    expect(isWindowed()).toBe(false);
    expect(isWindowed('', '')).toBe(false);
    expect(isWindowed('nonsense')).toBe(false);
    expect(isWindowed('2026-01-01')).toBe(true);
    expect(isWindowed(null, '2026-01-01')).toBe(true);
  });
});

describe('rangeOrderError', () => {
  it('flags only a genuinely reversed pair', () => {
    expect(rangeOrderError('2026-01-01', '2026-03-31')).toBeNull();
    expect(rangeOrderError('2026-01-01', '2026-01-01')).toBeNull();
    expect(rangeOrderError('2026-01-01')).toBeNull();
    expect(rangeOrderError(null, '2026-01-01')).toBeNull();
    expect(rangeOrderError('2026-03-31', '2026-01-01')).toBe('Start date 2026-03-31 is after end date 2026-01-01.');
  });
});
