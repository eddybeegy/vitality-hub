import { describe, expect, it } from 'vitest';
import {
  LOGS_DEFAULT_LIMIT,
  LOGS_MAX_LIMIT,
  logTimestampToIso,
  parseLogsQuery,
  resolveTimeZone,
  toSqliteTimestamp,
  zonedDayBounds,
} from './logsQuery';

describe('parseLogsQuery', () => {
  it('defaults to the newest 500, unfiltered (what the route returned before)', () => {
    expect(parseLogsQuery({}).value).toEqual({ limit: LOGS_DEFAULT_LIMIT, level: null, source: null, date: null });
  });

  it('accepts every parameter', () => {
    expect(parseLogsQuery({ limit: '50', level: 'debug', source: 'apple_health', date: '2026-10-21' }).value).toEqual({
      limit: 50,
      level: 'debug',
      source: 'apple_health',
      date: '2026-10-21',
    });
  });

  it.each([
    [{ limit: '0' }, /limit/],
    [{ limit: String(LOGS_MAX_LIMIT + 1) }, /limit/],
    [{ limit: '10abc' }, /limit/],
    [{ level: 'verbose' }, /level/],
    [{ level: '' }, /level/],
    [{ level: ['info', 'warn'] }, /level/],
    [{ source: 'a b' }, /source/],
    [{ source: 'security] [User 1' }, /source/],
    [{ source: ['x'] }, /source/],
    [{ date: '2026-02-30' }, /date/],
    [{ date: 'today' }, /date/],
  ])('rejects %j', (q, re) => {
    expect(parseLogsQuery(q as Record<string, unknown>).error).toMatch(re);
  });
});

describe('zonedDayBounds', () => {
  // Explicit-offset cases, never the current clock: BST ends 2026-10-25.
  it('a BST day in London starts at 23:00Z the day before', () => {
    const { start, end } = zonedDayBounds('2026-10-21', 'Europe/London');
    expect(start.toISOString()).toBe('2026-10-20T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-21T23:00:00.000Z');
  });

  it('the autumn change day is 25 hours long', () => {
    const { start, end } = zonedDayBounds('2026-10-25', 'Europe/London');
    expect(start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('a GMT day is the UTC day', () => {
    const { start, end } = zonedDayBounds('2026-12-01', 'Europe/London');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-02T00:00:00.000Z');
  });

  it('the spring change day is 23 hours long', () => {
    const { start, end } = zonedDayBounds('2027-03-28', 'Europe/London');
    expect(start.toISOString()).toBe('2027-03-28T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-03-28T23:00:00.000Z');
  });

  it('works for a zone west of UTC and across a month end', () => {
    const { start, end } = zonedDayBounds('2026-10-31', 'America/New_York');
    expect(start.toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

describe('resolveTimeZone', () => {
  it('keeps a real zone and falls back otherwise', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('Mars/Olympus_Mons')).toBe('Europe/London');
    expect(resolveTimeZone(null)).toBe('Europe/London');
    expect(resolveTimeZone('')).toBe('Europe/London');
  });
});

describe('timestamp formats', () => {
  it('turns a Postgres Date into ISO', () => {
    expect(logTimestampToIso(new Date('2026-10-21T15:21:00Z'))).toBe('2026-10-21T15:21:00.000Z');
  });

  it("reads SQLite's zone-less CURRENT_TIMESTAMP as UTC", () => {
    expect(logTimestampToIso('2026-10-21 15:21:00')).toBe('2026-10-21T15:21:00.000Z');
  });

  it('passes an ISO string with a zone through as the same instant', () => {
    expect(logTimestampToIso('2026-10-21T16:21:00+01:00')).toBe('2026-10-21T15:21:00.000Z');
  });

  it('null stays null', () => {
    expect(logTimestampToIso(null)).toBeNull();
  });

  it('formats a bound the way SQLite stores the column', () => {
    expect(toSqliteTimestamp(new Date('2026-10-20T23:00:00.000Z'))).toBe('2026-10-20 23:00:00');
  });
});
