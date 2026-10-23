// Cross-source workout de-duplication for the read path.
//
// One session can reach the database from more than one ingest path. A Hevy
// workout carries its routine name, exercises and sets; the same session seen
// through Apple Health or HealthSync arrives as a generic activity type
// ("Traditional Strength Training") with a duration and nothing else. Both rows
// are real writes, so both were displayed -- the same training session listed
// twice, once with detail and once without.
//
// Two de-dupe mechanisms already existed and neither covers this:
//   * modules/apple_workouts.ts skips an apple_health workout within 30 minutes
//     of a hevy one, but only at ingest, and only for apple_health. HealthSync
//     writes into Postgres directly (kb-health, outside this app), so no
//     ingest-time guard here can ever see it.
//   * POST /api/debug/deduplicate deletes apple_health rows near hevy ones. It
//     is manual, destructive, and also hardcoded to apple_health.
//
// Hence a read-path filter: it is source-agnostic, needs no cooperation from the
// writer, works no matter which path landed first, and deletes nothing -- the
// row stays in the table for exports and backfills.
//
// Deliberately CROSS-SOURCE ONLY. Two workouts from the SAME source close
// together are two workouts (the live DB has 8 such apple_health pairs); only a
// second *source* describing the same session is a duplicate.

/** Last-resort tiebreak when two sources carry equally much detail. */
export const SOURCE_DETAIL_RANK: Record<string, number> = {
  hevy: 0,
  apple_health: 1,
  healthsync: 2,
};
export const UNKNOWN_SOURCE_RANK = 50;

/** Default clustering window, matching the ingest-time guard it generalises. */
export const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export interface DedupeWorkout {
  id: number | string;
  source?: string | null;
  timestamp?: string | number | Date | null;
  volume?: number | null;
  distance?: number | null;
  energy_burned?: number | null;
  heart_rate_avg?: number | null;
}

/**
 * How much this row actually says about the session. Exercise count dominates:
 * "more detail" in the sense that matters is a session you can see the lifts in.
 * The remaining fields break ties between two detail-free rows.
 */
export function detailScore(w: DedupeWorkout, exerciseCount: number): number {
  let score = exerciseCount > 0 ? 1000 + Math.min(exerciseCount, 99) : 0;
  if (w.volume != null && w.volume > 0) score += 8;
  if (w.distance != null && w.distance > 0) score += 4;
  if (w.energy_burned != null && w.energy_burned > 0) score += 2;
  if (w.heart_rate_avg != null && w.heart_rate_avg > 0) score += 1;
  return score;
}

function instant(ts: DedupeWorkout['timestamp']): number {
  if (ts == null) return NaN;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
}

function rank(source: string | null | undefined): number {
  return SOURCE_DETAIL_RANK[source ?? ''] ?? UNKNOWN_SOURCE_RANK;
}

export interface DedupeResult<T extends DedupeWorkout> {
  kept: T[];
  /** Rows hidden, each with the id of the richer row that displaced it. */
  suppressed: { workout: T; supersededBy: T['id'] }[];
}

/**
 * Hide a workout when a different source describes the same session with more
 * detail. `exerciseCountFor` returns the number of exercises recorded against a
 * workout id (0 when none). Input order is preserved in `kept`.
 *
 * A row whose timestamp will not parse is always kept: an undateable row cannot
 * be shown to be a duplicate, and silently dropping it would be the worse bug.
 */
export function dedupeOverlappingWorkouts<T extends DedupeWorkout>(
  workouts: readonly T[],
  exerciseCountFor: (id: T['id']) => number,
  windowMs: number = DEDUPE_WINDOW_MS
): DedupeResult<T> {
  const candidates = workouts
    .map(w => ({ w, t: instant(w.timestamp), score: detailScore(w, exerciseCountFor(w.id)) }))
    .filter(x => Number.isFinite(x.t));

  // Richest first, so suppression only ever flows from a surviving row outwards.
  // Walking in this order makes a displaced row unable to displace a third one:
  // otherwise a chain (A hides B, B hides C) could hide a session C that never
  // overlapped the survivor A at all.
  const order = [...candidates].sort(
    (a, b) =>
      b.score - a.score || rank(a.w.source) - rank(b.w.source) || a.t - b.t
  );

  const suppressedBy = new Map<T['id'], T['id']>();
  for (const winner of order) {
    if (suppressedBy.has(winner.w.id)) continue;
    for (const other of candidates) {
      if (other.w.id === winner.w.id || suppressedBy.has(other.w.id)) continue;
      if (Math.abs(other.t - winner.t) > windowMs) continue;
      // Same source twice in half an hour is two workouts, not a duplicate --
      // only a second *source* describing the session is.
      if ((other.w.source ?? '') === (winner.w.source ?? '')) continue;
      // Equal detail from two sources: nothing to choose between them on
      // content, so fall back to source rank and keep both if even that ties.
      if (other.score === winner.score && rank(other.w.source) === rank(winner.w.source)) continue;
      suppressedBy.set(other.w.id, winner.w.id);
    }
  }

  const kept: T[] = [];
  const suppressed: DedupeResult<T>['suppressed'] = [];
  for (const w of workouts) {
    const by = suppressedBy.get(w.id);
    if (by === undefined) kept.push(w);
    else suppressed.push({ workout: w, supersededBy: by });
  }
  return { kept, suppressed };
}
