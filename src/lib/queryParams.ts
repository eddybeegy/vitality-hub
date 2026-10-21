// Value validation for read-API query parameters (sweep item 42).
//
// The read routes used to check only that a parameter was *present* and then quietly
// substitute a default for anything they did not recognise: an unknown `granularity`
// fell into the month branch, an unknown `aggregation` became avg, an unparseable
// `startDate` became "365 days ago" and `endDate` became "now". The caller got a 200
// with plausible-looking numbers for a question it never asked. These helpers turn a
// bad value into an error message the route returns as a 400 instead.
//
// Pure functions, no Express types, so they are unit-tested directly.

export type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): ParamResult<T> => ({ ok: true, value });
const fail = <T = never>(error: string): ParamResult<T> => ({ ok: false, error });

// Express/qs hands back an array for `?x=a&x=b` and an object for `?x[k]=v`. Neither
// is a valid value for any parameter these routes take, so both are rejected rather
// than coerced with String() (which would turn ['a','b'] into "a,b").
function single(name: string, raw: unknown): ParamResult<string | undefined> {
  if (raw === undefined) return ok(undefined);
  if (typeof raw !== 'string') return fail(`Invalid ${name}: expected a single value`);
  return ok(raw);
}

/**
 * One of a fixed set of values. `undefined` (absent) returns `fallback`; when there
 * is no fallback the parameter is required. An empty string is a value, not absence,
 * and is rejected like any other unknown value.
 */
export function parseEnumParam<T extends string>(
  name: string,
  raw: unknown,
  allowed: readonly T[],
  fallback?: T,
): ParamResult<T> {
  const s = single(name, raw);
  if (!s.ok) return s;
  if (s.value === undefined) {
    return fallback !== undefined ? ok(fallback) : fail(`Missing ${name}`);
  }
  if ((allowed as readonly string[]).includes(s.value)) return ok(s.value as T);
  return fail(`Invalid ${name} '${s.value}': expected one of ${allowed.join(', ')}`);
}

// YYYY-MM-DD, optionally followed by a time and an optional zone. This is what the
// client actually sends (`Date#toISOString()` from HealthChart, plain days elsewhere).
// Anything looser -- "yesterday", "10/21/2026", a bare year -- is something
// `new Date()` will happily guess at, which is exactly the silent behaviour item 42
// is about.
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** True when y-m-d names a real calendar day (rejects 2026-02-30, 2026-13-01). */
function isCalendarDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * An ISO-8601 date or date-time. Absent returns `null` (the route keeps its default
 * window); present-but-bad is an error. The returned Date is the instant `new Date()`
 * gives for the same string, so a valid request resolves exactly as it did before.
 */
export function parseDateParam(name: string, raw: unknown): ParamResult<Date | null> {
  const s = single(name, raw);
  if (!s.ok) return s;
  if (s.value === undefined) return ok(null);
  const m = ISO_DATE_RE.exec(s.value);
  if (!m) return fail(`Invalid ${name} '${s.value}': expected YYYY-MM-DD or an ISO 8601 date-time`);
  const [, y, mo, d, hh, mi, ss] = m;
  if (!isCalendarDay(Number(y), Number(mo), Number(d))) {
    return fail(`Invalid ${name} '${s.value}': not a calendar date`);
  }
  if (hh !== undefined && (Number(hh) > 23 || Number(mi) > 59 || (ss !== undefined && Number(ss) > 59))) {
    return fail(`Invalid ${name} '${s.value}': not a valid time of day`);
  }
  const date = new Date(s.value);
  if (isNaN(date.getTime())) return fail(`Invalid ${name} '${s.value}': not a valid date`);
  return ok(date);
}

/**
 * A plain YYYY-MM-DD day (no time part). Absent returns `null`.
 */
export function parseDayParam(name: string, raw: unknown): ParamResult<string | null> {
  const s = single(name, raw);
  if (!s.ok) return s;
  if (s.value === undefined) return ok(null);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.value);
  if (!m || !isCalendarDay(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return fail(`Invalid ${name} '${s.value}': expected a calendar date as YYYY-MM-DD`);
  }
  return ok(s.value);
}

/**
 * A whole number in [min, max]. Absent returns `fallback`. Digits only: parseInt's
 * "30abc" -> 30 and "1e3" -> 1 are rejected rather than half-read.
 */
export function parseIntParam(
  name: string,
  raw: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): ParamResult<number> {
  const s = single(name, raw);
  if (!s.ok) return s;
  if (s.value === undefined) return ok(fallback);
  if (!/^\d+$/.test(s.value)) return fail(`Invalid ${name} '${s.value}': expected a whole number`);
  const n = Number(s.value);
  if (n < min || n > max) return fail(`Invalid ${name} '${s.value}': expected ${min}-${max}`);
  return ok(n);
}

/** Both bounds present and the window runs backwards. */
export function checkDateOrder(start: Date | null, end: Date | null): string | null {
  if (start && end && start.getTime() > end.getTime()) {
    return `Invalid date range: startDate ${start.toISOString()} is after endDate ${end.toISOString()}`;
  }
  return null;
}
