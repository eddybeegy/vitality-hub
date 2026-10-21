import { parseUTCDate } from './utils';

// Item 34 (Kieron, 2026-10-21): how old a module's newest READING may be before the
// Data Freshness widget calls it stale. Continuous sources (phone, watch, scale)
// produce something most days; manually logged ones (food diaries, lifting) can
// legitimately go quiet over a weekend, so they get three days.
//
// The Nutracheck module's id is `nutrachek` (one 'c', see handoff fact 2); both
// spellings are listed so the threshold holds whichever one reaches the widget.
export const STALENESS_THRESHOLD_HOURS: Record<string, number> = {
  apple_health: 24,
  apple_workouts: 24,
  healthsync: 24,
  withings: 24,
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
