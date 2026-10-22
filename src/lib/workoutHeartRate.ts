/**
 * Average heart rate per workout, derived from the `heart_rate` metrics.
 *
 * `workouts.heart_rate_avg` is NULL on every row this instance has ever stored --
 * Apple's export carries no whole-workout average and Hevy has no such field -- so the
 * cardio-efficiency card (src/lib/cardioTrends.ts) had nothing to score and rendered
 * empty. The `heart_rate` metrics themselves are dense (hundreds of thousands of rows
 * from apple_health and healthsync), so a session's own average is recoverable from
 * the readings that fall inside it.
 *
 * Scope is deliberately narrow: only workouts inside the card's window that have a
 * distance (metres per heartbeat needs one) and no stored average. Measured against
 * the live data that lateral join is ~5ms. Dropping the distance filter and running
 * it over every workout is ~540ms of nested loop on every /api/data/summary call --
 * so widen this only with an EXPLAIN ANALYZE in hand.
 *
 * This fills a response field; it does not write to `workouts`. The derivation depends
 * on which metrics have synced, so persisting it would freeze a half-synced average.
 */

/** Minimum `heart_rate` samples inside the session before the average is trusted. */
export const MIN_HR_SAMPLES = 3;

/** A derived average outside this band is a data fault, not a heart rate. */
export const PLAUSIBLE_HR: [number, number] = [30, 240];

export interface DerivedHrRow {
  id: unknown;
  avg_hr: unknown;
}

/**
 * SQL for `(id, avg_hr)` over the workouts that need a derived average. Bind
 * `userId` then `windowStart` (an instant at or before the start of the card's
 * window). `workoutInstant` and `metricInstant` are the caller's `readingInstant`
 * expressions for `w.timestamp` and `m.timestamp` -- the two tables do NOT share a
 * timestamp convention (healthsync stamps `metrics` as London wall-clock but
 * `workouts` as UTC), so comparing the raw columns is wrong by up to an hour.
 */
export function derivedWorkoutHrSql(
  dbType: string,
  workoutInstant: string,
  metricInstant: string,
): string {
  if (dbType === 'sqlite') {
    // No LATERAL in sqlite, and no reliable text ordering between an ISO timestamp
    // with a 'T' and whatever `datetime()` returns -- `julianday()` sidesteps both.
    const window = `
        FROM metrics m
        WHERE m.user_id = w.user_id AND m.type = 'heart_rate'
          AND julianday(${metricInstant}) >= julianday(${workoutInstant})
          AND julianday(${metricInstant}) <  julianday(${workoutInstant}) + (w.duration / 1440.0)`;
    return `
      SELECT id, avg_hr FROM (
        SELECT w.id AS id,
               (SELECT ROUND(AVG(m.value)) ${window}) AS avg_hr,
               (SELECT COUNT(*) ${window}) AS n
        FROM workouts w
        WHERE w.user_id = ? AND w.heart_rate_avg IS NULL AND w.duration > 0
          AND w.distance IS NOT NULL AND w.timestamp >= ?
      ) s WHERE n >= ${MIN_HR_SAMPLES}`;
  }
  return `
    SELECT w.id AS id, hr.avg_hr AS avg_hr
    FROM workouts w
    CROSS JOIN LATERAL (
      SELECT ROUND(AVG(m.value)) AS avg_hr, COUNT(*) AS n
      FROM metrics m
      WHERE m.user_id = w.user_id AND m.type = 'heart_rate'
        AND ${metricInstant} >= ${workoutInstant}
        AND ${metricInstant} <  ${workoutInstant} + w.duration * interval '1 minute'
    ) hr
    WHERE w.user_id = ? AND w.heart_rate_avg IS NULL AND w.duration > 0
      AND w.distance IS NOT NULL AND w.timestamp >= ?
      AND hr.n >= ${MIN_HR_SAMPLES}`;
}

/**
 * Fill `heart_rate_avg` on the workouts that have none, in place. A filled row is
 * marked `heart_rate_avg_derived` so a consumer can tell it from a measured average.
 * Never overwrites a stored value. Returns how many rows were filled.
 */
export function mergeDerivedHeartRate(
  workouts: Array<Record<string, any>>,
  derived: DerivedHrRow[],
): number {
  if (!derived.length) return 0;
  const [lo, hi] = PLAUSIBLE_HR;
  const byId = new Map<string, number>();
  for (const row of derived) {
    const hr = Number(row.avg_hr);
    if (!Number.isFinite(hr) || hr < lo || hr > hi) continue;
    byId.set(String(row.id), hr);
  }
  let filled = 0;
  for (const w of workouts) {
    if (w.heart_rate_avg != null) continue;
    const hr = byId.get(String(w.id));
    if (hr == null) continue;
    w.heart_rate_avg = hr;
    w.heart_rate_avg_derived = true;
    filled++;
  }
  return filled;
}
