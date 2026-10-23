import { parseUTCDate } from './utils';

// Item 34 (Kieron, 2026-10-21): how old a module's newest READING may be before the
// Data Freshness widget calls it stale. Continuous sources (phone, watch, scale)
// produce something most days; manually logged ones (food diaries, lifting) can
// legitimately go quiet over a weekend, so they get three days.
//
// Widened on Kieron's instruction (Telegram, 2026-10-23):
//   - `apple_workouts` -> 48h. Health Auto Export is run by hand and its workout
//     payload is sparse by design, so a day's gap is normal, not a fault. Note
//     `apple_health` (the METRICS half of the same source) stays at 24h -- it
//     syncs thousands of points whenever HAE runs, so a quiet day there is real.
//   - `withings` -> 7 days. The scale only produces a reading when he stands on
//     it, which is not a daily event.
//
// The Nutracheck module's id is `nutrachek` (one 'c', see handoff fact 2); both
// spellings are listed so the threshold holds whichever one reaches the widget.
export const STALENESS_THRESHOLD_HOURS: Record<string, number> = {
  apple_health: 24,
  apple_workouts: 48,
  healthsync: 24,
  withings: 168,
  cronometer: 72,
  hevy: 72,
  nutracheck: 72,
  nutrachek: 72,
};

export const DEFAULT_STALENESS_THRESHOLD_HOURS = 24;

export type FreshnessStatus = 'good' | 'error' | 'unknown';

export function stalenessThresholdHours(moduleId: string): number {
  return Object.prototype.hasOwnProperty.call(STALENESS_THRESHOLD_HOURS, moduleId)
    ? STALENESS_THRESHOLD_HOURS[moduleId]
    : DEFAULT_STALENESS_THRESHOLD_HOURS;
}

// `lastReading` is the server's dataFreshness.byModule[id].lastReading. A reading
// exactly at the threshold counts as stale.
export function freshnessStatus(
  moduleId: string,
  lastReading: string | null | undefined,
  now: number = Date.now(),
): FreshnessStatus {
  if (!lastReading) return 'unknown';
  const t = parseUTCDate(lastReading).getTime();
  if (Number.isNaN(t)) return 'unknown';
  const diffHours = (now - t) / (1000 * 60 * 60);
  return diffHours < stalenessThresholdHours(moduleId) ? 'good' : 'error';
}

// ---------------------------------------------------------------------------
// Module -> source/table resolution. Extracted from the dashboard endpoint for
// item 95 so the phone-alert sweep judges staleness by exactly the same rule
// the Data Freshness panel shows. Two copies of this mapping would guarantee a
// day where the panel says "stale" and the alert disagrees, or worse the other
// way round.
// ---------------------------------------------------------------------------

/**
 * A module id is not always its metrics `source`:
 *  - `apple_workouts` writes rows tagged `apple_health`, so on its own id it
 *    would always read "Never".
 *  - `healthsync` (HealthSync's HASS-routed copy of the same Apple Health data)
 *    has no module at all, so the freshest source in the DB was never
 *    represented in the UI. It counts towards apple_health's freshness,
 *    matching the source-precedence policy in aggregateDailyMetrics.
 *  - the Nutracheck module's id is `nutrachek` (one 'c') while some rank tables
 *    spell it `nutracheck`; accept both rather than silently reading "Never".
 * Unknown modules fall back to their own id.
 */
export const MODULE_SOURCES: Record<string, string[]> = {
  apple_health: ['apple_health', 'healthsync'],
  apple_workouts: ['apple_health', 'healthsync'],
  cronometer: ['cronometer'],
  hevy: ['hevy'],
  myfitnesspal: ['myfitnesspal'],
  nutrachek: ['nutrachek', 'nutracheck'],
  strava: ['strava'],
  withings: ['withings'],
};

/**
 * Which table a module actually writes. Workout feeds must not be able to read
 * their freshness off a metrics row that another feed sharing the same `source`
 * tag wrote, or vice versa (item 39). A module not listed here is read against
 * both tables.
 */
export const MODULE_TABLES: Record<string, string[]> = {
  apple_health: ['metrics'],
  apple_workouts: ['workouts'],
  cronometer: ['metrics'],
  hevy: ['workouts'],
  myfitnesspal: ['metrics'],
  nutrachek: ['metrics'],
  strava: ['workouts'],
  withings: ['metrics'],
};

/** `{ metrics: { source: isoTimestamp }, workouts: { ... } }`. */
export type ReadingFreshnessByTable = Record<string, Record<string, string | undefined>>;

export interface ModuleFreshness {
  lastReading: string | null;
  /** Which `source` values actually contributed — empty means "never". */
  sources: string[];
  tables: string[];
}

/** Newest reading per module, resolved through the two maps above. */
export function moduleFreshness(
  byTable: ReadingFreshnessByTable,
  moduleIds: string[],
): Record<string, ModuleFreshness> {
  const out: Record<string, ModuleFreshness> = {};
  for (const id of moduleIds) {
    const srcs = MODULE_SOURCES[id] || [id];
    const tables = MODULE_TABLES[id] || ['metrics', 'workouts'];
    let best: string | null = null;
    const contributing: string[] = [];
    for (const s of srcs) {
      let t: string | null = null;
      for (const table of tables) {
        const c = byTable[table]?.[s];
        if (c && (!t || new Date(c).getTime() > new Date(t).getTime())) t = c;
      }
      if (!t) continue;
      contributing.push(s);
      if (!best || new Date(t).getTime() > new Date(best).getTime()) best = t;
    }
    out[id] = { lastReading: best, sources: contributing, tables };
  }
  return out;
}
