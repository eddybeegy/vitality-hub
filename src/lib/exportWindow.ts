// Optional date range for /api/export/metrics.csv (sweep item 54).
//
// The export had no range and no cap: it streamed every metrics row the user has
// (1.69M rows, 109.7 MB on this install) on every click, and grows. `startDate` and
// `endDate` narrow it to whole calendar days in the user's timezone, both inclusive.
// Neither given is still the full export -- it is the backup button, and a default
// window would silently drop history from a backup.
//
// Pure, no Express or DB types, so it is unit-tested directly.

import { checkDateOrder, parseDayParam } from './queryParams';
import { zonedDayBounds } from './logsQuery';

// Either side may be open (null).
export type ExportWindow = { start: Date | null; end: Date | null };
export type ExportWindowResult =
  | { window: ExportWindow | null; error?: undefined }
  | { window?: undefined; error: string };

/**
 * `startDate` / `endDate` (YYYY-MM-DD, each optional, both inclusive) as a half-open
 * [start, end) instant window in `timeZone`. Only one given leaves the other side open.
 */
export function parseExportWindow(query: Record<string, unknown>, timeZone: string): ExportWindowResult {
  const s = parseDayParam('startDate', query.startDate);
  if (s.error !== undefined) return { error: s.error };
  const e = parseDayParam('endDate', query.endDate);
  if (e.error !== undefined) return { error: e.error };
  if (s.value === null && e.value === null) return { window: null };

  const start = s.value === null ? null : zonedDayBounds(s.value, timeZone).start;
  // Inclusive end day: the window runs to the start of the following day.
  const end = e.value === null ? null : zonedDayBounds(e.value, timeZone).end;
  if (s.value !== null && e.value !== null) {
    const order = checkDateOrder(new Date(`${s.value}T00:00:00Z`), new Date(`${e.value}T00:00:00Z`));
    if (order) return { error: `Invalid date range: startDate ${s.value} is after endDate ${e.value}` };
  }
  return { window: { start, end } };
}

// The raw `timestamp` columns are naive and hold a different zone per source
// (item 44): UTC for most, Europe/London wall-clock for healthsync metrics, at most an
// hour apart. A raw-column bound widened by a day on each side can therefore never
// exclude a row the exact instant filter keeps, and still lets the (user_id, timestamp)
// index narrow the scan instead of walking the user's whole history.
const RAW_SLACK_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD HH:MM:SS', zone-less, for comparing against a naive timestamp column. */
const naive = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

export function rawColumnBounds(w: ExportWindow): { from: string | null; to: string | null } {
  return {
    from: w.start ? naive(w.start.getTime() - RAW_SLACK_MS) : null,
    to: w.end ? naive(w.end.getTime() + RAW_SLACK_MS) : null,
  };
}

/**
 * The SQL conditions and parameters for a window, given the raw column and the
 * true-instant expression for it. `rawCol` is null where the raw column already is
 * the instant (SQLite here), so only the exact bound is applied. Each open side adds
 * nothing.
 */
export function windowConditions(
  w: ExportWindow,
  instantExpr: string,
  rawCol: string | null,
): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  const raw = rawColumnBounds(w);
  if (w.start) {
    if (rawCol && raw.from) { parts.push(`${rawCol} >= ?`); params.push(raw.from); }
    parts.push(`${instantExpr} >= ?`);
    params.push(w.start.toISOString());
  }
  if (w.end) {
    if (rawCol && raw.to) { parts.push(`${rawCol} < ?`); params.push(raw.to); }
    parts.push(`${instantExpr} < ?`);
    params.push(w.end.toISOString());
  }
  return { sql: parts.map(p => ` AND ${p}`).join(''), params };
}
