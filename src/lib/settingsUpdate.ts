// Body validation for POST /api/settings (sweep item 50).
//
// The handler used to destructure ~32 names off `req.body` and write 28 columns of the
// users row unconditionally, substituting a hardcoded default for anything the caller
// left out (`email || 'user@example.com'`, `ai_generation_times || '["off","off","off"]'`,
// `dashboard_widgets ? ... : null`, ...). A client that sent one field reset every other
// one, and an array body passed every guard and wiped 18 columns of the live row.
//
// This turns a body into the list of columns to write: only keys actually present, each
// value validated rather than coerced, anything malformed a 400. Absent keys are left
// alone. Pure, no Express or DB types, so it is unit-tested directly.

import { parseDayParam } from './queryParams';

export type SettingsUpdateResult =
  | { columns: [string, unknown][]; error?: undefined }
  | { columns?: undefined; error: string };

type Check = (name: string, v: unknown) => { value: unknown; error?: undefined } | { value?: undefined; error: string };

const ok = (value: unknown) => ({ value });
const fail = (error: string) => ({ error });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// The Settings form round-trips whatever GET returned, so a nullable column comes back
// as null, and a cleared text input as ''. Both mean "no value" -- what the old
// `x || null` stored -- and that is the one normalisation these checks make.
const nullable = (check: Check): Check => (name, v) =>
  v === null || v === '' ? ok(null) : check(name, v);

const text = (max: number): Check => (name, v) =>
  typeof v === 'string' && v.length <= max ? ok(v) : fail(`Invalid ${name}: expected a string of at most ${max} characters`);

const nonEmptyText = (max: number): Check => (name, v) =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max
    ? ok(v)
    : fail(`Invalid ${name}: expected a non-empty string of at most ${max} characters`);

const oneOf = (allowed: readonly string[]): Check => (name, v) =>
  typeof v === 'string' && allowed.includes(v) ? ok(v) : fail(`Invalid ${name}: expected one of ${allowed.join(', ')}`);

const int = (min: number, max: number): Check => (name, v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
    ? ok(v)
    : fail(`Invalid ${name}: expected a whole number ${min}-${max}`);

// Stored as INTEGER 0/1. The client sends booleans; 0/1 is what a raw GET returns.
const flag: Check = (name, v) =>
  v === true || v === 1 ? ok(1) : v === false || v === 0 ? ok(0) : fail(`Invalid ${name}: expected true or false`);

// Height is metres (ProfileTab converts imperial back). The form sends 0 for a blank
// input, which the old handler stored as NULL; keep that.
const height: Check = (name, v) => {
  if (v === 0) return ok(null);
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 3
    ? ok(v)
    : fail(`Invalid ${name}: expected a height in metres, 0-3`);
};

const day: Check = (name, v) => {
  const r = parseDayParam(name, v);
  return r.error !== undefined ? fail(r.error) : ok(r.value);
};

const timezone: Check = (name, v) => {
  if (typeof v !== 'string' || v.length > 64) return fail(`Invalid ${name}: expected an IANA time zone name`);
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: v });
    return ok(v);
  } catch {
    return fail(`Invalid ${name} '${v}': not a known time zone`);
  }
};

const MAX_MEDICATIONS = 100;
const medications: Check = (name, v) => {
  if (!Array.isArray(v) || v.length > MAX_MEDICATIONS) {
    return fail(`Invalid ${name}: expected a list of at most ${MAX_MEDICATIONS} medications`);
  }
  for (const m of v) {
    if (!isPlainObject(m)) return fail(`Invalid ${name}: each medication must be an object`);
    for (const k of ['name', 'dose', 'frequency']) {
      if (m[k] !== undefined && m[k] !== null && (typeof m[k] !== 'string' || (m[k] as string).length > 200)) {
        return fail(`Invalid ${name}: ${k} must be a string of at most 200 characters`);
      }
    }
  }
  return ok(JSON.stringify(v));
};

const MAX_WIDGETS = 50;
const widgets: Check = (name, v) =>
  Array.isArray(v) && v.length <= MAX_WIDGETS && v.every(w => typeof w === 'string' && w.length > 0 && w.length <= 64)
    ? ok(JSON.stringify(v))
    : fail(`Invalid ${name}: expected a list of widget ids`);

// Stored as JSON text; the client sends it already stringified.
const GEN_TIME_RE = /^(?:off|([01]\d|2[0-3]):[0-5]\d)$/;
const generationTimes: Check = (name, v) => {
  let parsed: unknown;
  try {
    parsed = typeof v === 'string' ? JSON.parse(v) : undefined;
  } catch {
    parsed = undefined;
  }
  return Array.isArray(parsed) && parsed.length === 3 && parsed.every(t => typeof t === 'string' && GEN_TIME_RE.test(t))
    ? ok(v)
    : fail(`Invalid ${name}: expected a JSON array of three times, each "off" or HH:MM`);
};

// JSON text of { metricType: [sourceId, ...] }. This decides which source wins in
// filterMetricsByPriority, so it changes displayed numbers -- check the shape.
const metricPriorities: Check = (name, v) => {
  let parsed: unknown;
  try {
    parsed = typeof v === 'string' && v.length <= 20000 ? JSON.parse(v) : undefined;
  } catch {
    parsed = undefined;
  }
  const valid =
    isPlainObject(parsed) &&
    Object.values(parsed).every(
      list => Array.isArray(list) && list.every(s => typeof s === 'string' && s.length > 0 && s.length <= 64),
    );
  return valid ? ok(v) : fail(`Invalid ${name}: expected a JSON object of metric -> list of source ids`);
};

const email: Check = (name, v) =>
  typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v)
    ? ok(v)
    : fail(`Invalid ${name}: expected an email address`);

// Body key -> users column, with its check. The key IS the column name; nothing outside
// this table is ever written, whatever else the body carries (the Settings form posts
// back the whole GET payload: id, role, ai_configs, withings_connected, ...).
const FIELDS: Record<string, Check> = {
  email,
  name: nullable(text(200)),
  sync_history_days: int(1, 3650),
  age: nullable(int(0, 150)),
  dob: nullable(day),
  gender: nullable(text(32)),
  height: nullable(height),
  display_mode: oneOf(['auto', 'day', 'night']),
  ai_provider: nonEmptyText(64),
  ai_base_url: nullable(text(2048)),
  ai_hints: nullable(text(4000)),
  ai_persona: nonEmptyText(200),
  ai_focus: nonEmptyText(200),
  meal_suggestion_breakfast: flag,
  meal_suggestion_lunch: flag,
  meal_suggestion_dinner: flag,
  show_debug_logs: flag,
  // Sweep item 86: the column, the store default and the ActivityTab gate all existed,
  // but the column was never in FIELDS, so POST /api/settings dropped it silently and
  // there was no way to switch the Correlation Explorer back on once it was off.
  enable_correlations: flag,
  ai_model: nullable(text(200)),
  medications: nullable(medications),
  preferred_units: oneOf(['metric', 'imperial', 'stone']),
  default_graph_range: oneOf(['1d', '7d', '30d', '90d', '1y', 'all']),
  default_graph_grouping: oneOf(['day', 'week', 'month']),
  timezone: nullable(timezone),
  ai_generation_times: generationTimes,
  metric_priorities: nullable(metricPriorities),
  font_size: oneOf(['small', 'medium', 'large']),
  dashboard_widgets: nullable(widgets),
  readiness_recovery_days: int(1, 30),
  // Scheduled backups. `backup_last_day` is NOT here on purpose: it is the
  // scheduler's own record of what it has already done, and a client that could
  // write it could suppress every future backup.
  backup_enabled: flag,
  backup_hour: int(0, 23),
  backup_keep: int(1, 60),
  // Phone alerts (item 95). The thresholds are deliberately his-numbers rather than
  // textbook ones -- see src/lib/alerts.ts -- so they have to be editable here, or the
  // defaults become folklore. Ranges are wide enough to hold a textbook value too.
  alerts_enabled: flag,
  alert_stale_enabled: flag,
  alert_bp_enabled: flag,
  alert_readiness_enabled: flag,
  alert_bp_systolic: int(80, 220),
  alert_bp_diastolic: int(40, 140),
  alert_readiness_floor: int(0, 100),
  alert_quiet_start_hour: int(0, 23),
  alert_quiet_end_hour: int(0, 23),
  // Targets that adjust themselves (item 97). auto_targets_last_day is NOT here, for
  // the backup_last_day reason: it is the sweep own record of what it has done.
  auto_targets_enabled: flag,
  auto_targets_max_change_kcal: int(50, 1000),
  auto_targets_max_change_g: int(5, 100),
};

// Credentials: GET /api/settings never returns hevy_api_key or withings_client_secret,
// so the form posts them back blank. Blank means "left untouched", never "clear it" --
// the rule the old handler already had for these four.
const SECRETS: Record<string, number> = {
  hevy_api_key: 512,
  ai_api_key: 512,
  withings_client_id: 512,
  withings_client_secret: 512,
};

export const SETTINGS_COLUMNS = [...Object.keys(FIELDS), ...Object.keys(SECRETS)];

/**
 * Validate a POST /api/settings body against the stored row. Returns the
 * [column, value] pairs to write: present keys only, in a fixed order. A value equal
 * to what is already stored is skipped without validation, so a legacy value the
 * current rules would refuse (an old display_mode, say) never blocks saving an
 * unrelated field. Any other bad value rejects the whole body.
 */
export function buildSettingsUpdate(body: unknown, current: Record<string, unknown> = {}): SettingsUpdateResult {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object of settings' };

  const columns: [string, unknown][] = [];
  for (const [col, check] of Object.entries(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, col) || body[col] === undefined) continue;
    const v = body[col];
    if (v === current[col]) continue;
    const r = check(col, v);
    if (r.error !== undefined) return { error: r.error };
    columns.push([col, r.value]);
  }
  for (const [col, max] of Object.entries(SECRETS)) {
    const v = body[col];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || v.length > max) return { error: `Invalid ${col}: expected a string of at most ${max} characters` };
    columns.push([col, v]);
  }
  return { columns };
}

/** True when the body names at least one column this endpoint writes. */
export function hasSettingsField(body: Record<string, unknown>): boolean {
  return SETTINGS_COLUMNS.some(c => Object.prototype.hasOwnProperty.call(body, c));
}
