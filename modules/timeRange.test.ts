import { describe, it, expect } from 'vitest';
import { utcDayRange } from './timeRange';

describe('utcDayRange', () => {
  it('returns the UTC day as half-open ISO bounds', () => {
    expect(utcDayRange('2026-10-21')).toEqual(['2026-10-21T00:00:00.000Z', '2026-10-22T00:00:00.000Z']);
  });

  it('is 24h across both BST boundaries (no local-time arithmetic)', () => {
    // 2026-10-25 is 25h long in London and 2027-03-28 is 23h; the UTC day is not.
    expect(utcDayRange('2026-10-25')).toEqual(['2026-10-25T00:00:00.000Z', '2026-10-26T00:00:00.000Z']);
    expect(utcDayRange('2027-03-28')).toEqual(['2027-03-28T00:00:00.000Z', '2027-03-29T00:00:00.000Z']);
  });

  it('rolls over month and year ends', () => {
    expect(utcDayRange('2026-12-31')![1]).toBe('2027-01-01T00:00:00.000Z');
    expect(utcDayRange('2028-02-28')![1]).toBe('2028-02-29T00:00:00.000Z');
  });

  it('selects exactly the rows the old UTC-text prefix did', () => {
    const [start, end] = utcDayRange('2026-10-24')!;
    const inDay = (iso: string) => iso >= start && iso < end;
    expect(inDay('2026-10-24T00:00:00.000Z')).toBe(true);
    expect(inDay('2026-10-24T23:30:00.000Z')).toBe(true);   // 00:30 BST on the 25th: still the 24th UTC
    expect(inDay('2026-10-25T00:00:00.000Z')).toBe(false);
    expect(inDay('2026-10-24T23:59:59')).toBe(true);        // Hevy's old naive format on SQLite
  });

  it('rejects anything that is not a plain day', () => {
    expect(utcDayRange('2026-10-21T00:00:00Z')).toBeNull();
    expect(utcDayRange('21/10/2026')).toBeNull();
    expect(utcDayRange('')).toBeNull();
  });
});
