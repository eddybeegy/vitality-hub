/**
 * Item 95 (Kieron, Telegram, 2026-10-23): phone alerts.
 *
 * Three triggers, all evaluated here as pure functions so they can be unit-tested
 * without a database, a clock, or a webhook:
 *
 *   1. A feed that has gone past its own staleness threshold (`freshness.ts`,
 *      the per-module hours Kieron set in item 34 -- no new rule invented here).
 *   2. A blood-pressure reading above his thresholds.
 *   3. A morning whose readiness score is below his floor.
 *
 * The defaults for 2 and 3 are deliberately NOT the textbook numbers. Measured
 * against his actual history on 2026-10-23, a 140/90 BP trigger would never have
 * fired once in 14 readings (average 112/71, highest ever 133/75) and a
 * below-40 readiness trigger would never have fired in 31 snapshots (average
 * 73.4, lowest 53). An alert that cannot fire is worse than no alert, because it
 * reads as cover. See DEFAULT_ALERT_SETTINGS for the numbers actually chosen and
 * how often each one would have fired.
 *
 * Every alert carries a `key` that is stable for as long as the alert is "the
 * same alert". The sweep records sent keys in `alerts_sent`, so a feed that has
 * been dead four days pages once a day rather than once an hour.
 */

import { stalenessThresholdHours } from './freshness';

export interface AlertSettings {
  /** Master switch. Off means the sweep does not even query. */
  enabled: boolean;
  staleEnabled: boolean;
  bpEnabled: boolean;
  readinessEnabled: boolean;
  /** Alert at or above this systolic reading. */
  bpSystolic: number;
  /** Alert at or above this diastolic reading. */
  bpDiastolic: number;
  /** Alert below this readiness score. */
  readinessFloor: number;
  /** Local hour quiet time begins, and the hour it ends. Wraps midnight. */
  quietStartHour: number;
  quietEndHour: number;
}

/**
 * Chosen from his own distribution on 2026-10-23, not from a guideline:
 *   - 130/82: his p95 is 128/75 and his all-time high 133/75, so this is one
 *     reading in fourteen historically. Note the BP feed is near-dormant (three
 *     readings in the last 90 days) -- the withings staleness alert will fire
 *     long before this one does.
 *   - readiness 60: 3 mornings of 31, about one in ten. Only 31 snapshots exist
 *     (2026-09-22 onward), so this is a thin baseline and worth revisiting.
 *   - quiet 22:00-07:00, staleness only. A high BP reading still goes out.
 */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: false,
  staleEnabled: true,
  bpEnabled: true,
  readinessEnabled: true,
  bpSystolic: 130,
  bpDiastolic: 82,
  readinessFloor: 60,
  quietStartHour: 22,
  quietEndHour: 7,
};

export interface Alert {
  /** Dedupe identity. Same key = same alert, send it once. */
  key: string;
  text: string;
  /** Which trigger produced it, for logging and the run log. */
  kind: 'stale' | 'bp' | 'readiness';
}

/** Newest reading per module id, ISO. A module absent here has never produced one. */
export type FreshnessMap = Record<string, string | null | undefined>;

export interface BpReading {
  systolic: number | null;
  diastolic: number | null;
  /** ISO instant of the reading; part of the dedupe key, so one alert per reading. */
  timestamp: string;
}

export interface ReadinessSnapshot {
  /** Local YYYY-MM-DD. */
  date: string;
  score: number;
  /** Mean over the trailing window, for context in the message. Optional. */
  average?: number | null;
}

export interface AlertInput {
  now: Date;
  /** Local hour 0-23 and local YYYY-MM-DD, resolved by the caller in the user's zone. */
  hourNow: number;
  today: string;
  freshness: FreshnessMap;
  /** Most recent BP reading, or null if none. */
  bp: BpReading | null;
  /** Today's readiness snapshot, or null if it has not been computed yet. */
  readiness: ReadinessSnapshot | null;
  settings: AlertSettings;
}

/**
 * Quiet hours wrap midnight, so 22->7 means "22, 23, 0..6". A window whose start
 * equals its end is no window at all rather than a 24-hour gag -- the latter
 * would silence every alert from a single mistyped setting.
 */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function ageHours(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

/** "31h" / "4.2 days" -- hours stay hours until they stop being readable. */
function humanAge(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${(hours / 24).toFixed(1)} days`;
}

/**
 * Every alert that is currently true. Dedupe against what has already been sent
 * is the caller's job: this is a pure function of the inputs and says nothing
 * about history.
 */
export function evaluateAlerts(input: AlertInput): Alert[] {
  const { settings: s } = input;
  if (!s.enabled) return [];
  const out: Alert[] = [];
  const quiet = inQuietHours(input.hourNow, s.quietStartHour, s.quietEndHour);

  // --- 1. Stale feeds. Suppressed during quiet hours: a feed that went quiet at
  // 23:00 is just as stale at 07:00, and the alert is not worth a woken phone.
  if (s.staleEnabled && !quiet) {
    for (const moduleId of Object.keys(input.freshness).sort()) {
      const last = input.freshness[moduleId];
      // No reading ever recorded is not staleness -- it is a feed he has never
      // used, and it would page every single day forever.
      if (!last) continue;
      const age = ageHours(last, input.now);
      if (age === null) continue;
      const threshold = stalenessThresholdHours(moduleId);
      if (age < threshold) continue;
      out.push({
        kind: 'stale',
        // Per local day: a dead feed pages once a day, not once an hour.
        key: `stale:${moduleId}:${input.today}`,
        text:
          `⚠️ ${moduleId} is stale: no new reading for ${humanAge(age)} ` +
          `(threshold ${threshold}h). Newest reading ${last}.`,
      });
    }
  }

  // --- 2. High BP. Not suppressed by quiet hours, by design.
  if (s.bpEnabled && input.bp) {
    const { systolic, diastolic, timestamp } = input.bp;
    const highSys = typeof systolic === 'number' && systolic >= s.bpSystolic;
    const highDia = typeof diastolic === 'number' && diastolic >= s.bpDiastolic;
    if (highSys || highDia) {
      const which = highSys && highDia ? 'both are' : highSys ? 'systolic is' : 'diastolic is';
      out.push({
        kind: 'bp',
        // Per reading, so a re-check an hour later that is still high does alert.
        key: `bp:${timestamp}`,
        text:
          `🩸 Blood pressure ${systolic ?? '?'}/${diastolic ?? '?'} at ${timestamp} — ` +
          `${which} at or above your alert level (${s.bpSystolic}/${s.bpDiastolic}).`,
      });
    }
  }

  // --- 3. Low readiness morning. "Morning" means after quiet hours end and
  // before noon: a score that lands at 16:00 is no longer actionable advice
  // about how to train today.
  if (s.readinessEnabled && input.readiness && !quiet && input.hourNow < 12) {
    const { date, score, average } = input.readiness;
    if (score < s.readinessFloor) {
      const context =
        typeof average === 'number' && Number.isFinite(average)
          ? ` Your recent average is ${average.toFixed(0)}.`
          : '';
      out.push({
        kind: 'readiness',
        key: `readiness:${date}`,
        text:
          `😴 Readiness ${score} this morning, below your floor of ${s.readinessFloor}.` +
          `${context} Consider a lighter session.`,
      });
    }
  }

  return out;
}
