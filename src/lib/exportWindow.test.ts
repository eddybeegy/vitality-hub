import { describe, expect, it } from 'vitest';
import { parseExportWindow, rawColumnBounds, windowConditions } from './exportWindow';

const LONDON = 'Europe/London';

describe('parseExportWindow', () => {
  it('neither date given is the full export (no window)', () => {
    expect(parseExportWindow({}, LONDON)).toEqual({ window: null });
  });

  it('both dates are inclusive whole days in the user zone (BST)', () => {
    const w = parseExportWindow({ startDate: '2026-10-01', endDate: '2026-10-21' }, LONDON).window!;
    expect(w.start!.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(w.end!.toISOString()).toBe('2026-10-21T23:00:00.000Z');
  });

  it('an end day across the clock change covers its full 25 hours', () => {
    const w = parseExportWindow({ startDate: '2026-10-25', endDate: '2026-10-25' }, LONDON).window!;
    expect(w.start!.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(w.end!.toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('one side alone leaves the other open', () => {
    expect(parseExportWindow({ startDate: '2026-12-01' }, LONDON).window).toEqual({
      start: new Date('2026-12-01T00:00:00Z'),
      end: null,
    });
    expect(parseExportWindow({ endDate: '2026-12-01' }, LONDON).window).toEqual({
      start: null,
      end: new Date('2026-12-02T00:00:00Z'),
    });
  });

  it.each([
    [{ startDate: '2026-02-30' }, /startDate/],
    [{ endDate: 'yesterday' }, /endDate/],
    [{ startDate: '2026-10-21T00:00:00Z' }, /startDate/],
    [{ startDate: ['2026-10-01', '2026-10-02'] }, /startDate/],
    [{ startDate: '2026-10-21', endDate: '2026-10-01' }, /after endDate/],
  ])('rejects %j', (q, re) => {
    expect(parseExportWindow(q as Record<string, unknown>, LONDON).error).toMatch(re);
  });

  it('the same day as start and end is one day, not empty', () => {
    const w = parseExportWindow({ startDate: '2026-12-01', endDate: '2026-12-01' }, LONDON).window!;
    expect(w.end!.getTime() - w.start!.getTime()).toBe(24 * 3600 * 1000);
  });
});

describe('raw-column bounds', () => {
  it('widen the window by a day each side, zone-less', () => {
    const w = { start: new Date('2026-09-30T23:00:00Z'), end: new Date('2026-10-21T23:00:00Z') };
    expect(rawColumnBounds(w)).toEqual({ from: '2026-09-29 23:00:00', to: '2026-10-22 23:00:00' });
  });

  it('never exclude a London wall-clock row the exact filter keeps', () => {
    // healthsync metrics are London wall-clock: 00:30 BST on Oct 1 is stored as naive
    // '2026-10-01 00:30:00' but is the instant 2026-09-30T23:30Z, inside the window.
    const w = { start: new Date('2026-09-30T23:00:00Z'), end: new Date('2026-10-01T23:00:00Z') };
    const { from, to } = rawColumnBounds(w);
    expect('2026-10-01 00:30:00' >= from! && '2026-10-01 00:30:00' < to!).toBe(true);
  });
});

describe('windowConditions', () => {
  const w = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-02T00:00:00Z') };

  it('Postgres: raw index bound plus exact instant bound on each side', () => {
    expect(windowConditions(w, 'INSTANT', 'm.timestamp')).toEqual({
      sql: ' AND m.timestamp >= ? AND INSTANT >= ? AND m.timestamp < ? AND INSTANT < ?',
      params: ['2026-09-30 00:00:00', '2026-10-01T00:00:00.000Z', '2026-10-03 00:00:00', '2026-10-02T00:00:00.000Z'],
    });
  });

  it('SQLite: the exact bound only', () => {
    expect(windowConditions(w, 'm.timestamp', null)).toEqual({
      sql: ' AND m.timestamp >= ? AND m.timestamp < ?',
      params: ['2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'],
    });
  });

  it('an open side adds nothing', () => {
    expect(windowConditions({ start: null, end: w.end }, 'I', null)).toEqual({
      sql: ' AND I < ?',
      params: ['2026-10-02T00:00:00.000Z'],
    });
  });
});
