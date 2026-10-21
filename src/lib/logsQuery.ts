// Query parameters for GET /api/logs (sweep item 53).
//
// The route took no parameters at all: it fs.readFileSync'd the whole current-day log
// file on every request, reversed and regex-parsed it, and stopped at 500 lines, so the
// Logs tab's level/source filters were client-side over whichever 500 lines were newest
// -- a "Debug Only" or per-source view could look empty while matching rows existed
// earlier the same day. The route now queries the indexed `logs` table, and these
// helpers turn the query string into validated filters (400 on a bad value, in item 42's
// style) plus the day window for `date`.
//
// Pure functions, no Express or DB types, so they are unit-tested directly.

import { parseDayParam, parseEnumParam, parseIntParam } from './queryParams';
import { LOG_LEVELS, type LogLevel } from './logLevel';

export const LOGS_DEFAULT_LIMIT = 500;
export const LOGS_MAX_LIMIT = 2000;

// Same shape POST /api/logs accepts as a source (item 59); server-side sources match it.
const SOURCE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export type LogsQuery = {
  limit: number;
  level: LogLevel | null;
  source: string | null;
  date: string | null;
};

export type LogsQueryResult = { value: LogsQuery; error?: undefined } | { value?: undefined; error: string };

export function parseLogsQuery(query: Record<string, unknown>): LogsQueryResult {
  const limit = parseIntParam('limit', query.limit, { min: 1, max: LOGS_MAX_LIMIT, fallback: LOGS_DEFAULT_LIMIT });
  if (limit.error !== undefined) return { error: limit.error };

  let level: LogLevel | null = null;
  if (query.level !== undefined) {
    const l = parseEnumParam('level', query.level, LOG_LEVELS);
    if (l.error !== undefined) return { error: l.error };
    level = l.value;
  }

  let source: string | null = null;
  if (query.source !== undefined) {
    if (typeof query.source !== 'string' || !SOURCE_RE.test(query.source)) {
      return { error: 'Invalid source: expected 1-64 characters of letters, digits, _ . -' };
    }
    source = query.source;
  }

  const date = parseDayParam('date', query.date);
  if (date.error !== undefined) return { error: date.error };

  return { value: { limit: limit.value, level, source, date: date.value } };
}

// Offset of `timeZone` from UTC at `instant`, in ms (positive east of Greenwich).
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(instant / 1000) * 1000;
}

// The instant local midnight of y-m-d falls on in `timeZone`. Two passes settle the
// offset across a DST change; Europe/London never changes at midnight, so local
// midnight always exists and is unambiguous.
function zonedMidnight(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffsetMs(guess, timeZone);
  t = guess - zoneOffsetMs(t, timeZone);
  return t;
}

/**
 * [start, end) of calendar day `ymd` in `timeZone`, as Dates. Built with Date.UTC
 * arithmetic on Y-M-D, never by reparsing a locale string (item 6). A DST day is 23 or
 * 25 hours long.
 */
export function zonedDayBounds(ymd: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: new Date(zonedMidnight(y, m, d, timeZone)),
    end: new Date(zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)),
  };
}

/** A valid IANA zone, else the instance's (single Europe/London user, per handoff). */
export function resolveTimeZone(tz: unknown, fallback = 'Europe/London'): string {
  if (typeof tz !== 'string' || tz === '') return fallback;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

/**
 * A `logs.timestamp` value as an ISO-8601 instant. Postgres hands back a Date (the
 * route selects the true instant via logInstant); SQLite's CURRENT_TIMESTAMP is
 * 'YYYY-MM-DD HH:MM:SS' in UTC with no zone, which `new Date()` in a browser would
 * read as local time.
 */
export function logTimestampToIso(ts: unknown): string | null {
  if (ts == null) return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts.toISOString();
  const s = String(ts);
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  const d = new Date(naive ? `${naive[1]}T${naive[2]}Z` : s);
  return isNaN(d.getTime()) ? s : d.toISOString();
}

/** SQLite's CURRENT_TIMESTAMP text form of an instant, for comparing against that column. */
export function toSqliteTimestamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
