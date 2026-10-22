/**
 * Read-only data tools behind the MCP server (src/mcp/server.ts).
 *
 * Every tool here is a SELECT. Nothing in this file writes, and nothing takes a
 * user id from its arguments: the id is fixed by the service token at mount time
 * and passed in as `McpContext.userId`, so a tool call cannot reach another
 * account's rows by asking nicely.
 *
 * The timestamp handling is not optional decoration. `metrics` and `workouts`
 * hold naive timestamps whose zone depends on the WRITER (healthsync stamps
 * metrics in London wall-clock, everything else in UTC), so a date comparison
 * has to go through server.ts's `readingInstant` rather than a blanket
 * `AT TIME ZONE`. That is injected rather than imported to keep one copy of the
 * convention.
 */

import { pairNights, summariseTiming, TIMING_TYPES, formatClock, type TimingSummary } from '../lib/sleepTiming.js';
import { aggregateDailyValues, NUTRITION_METRICS, type DailyRow, type MetricRow } from '../lib/metricAggregation.js';

type NaiveTsTable = 'metrics' | 'workouts' | 'meal_items';

export interface McpDb {
  type: string;
  prepare(sql: string): { all(...params: any[]): any; get(...params: any[]): any };
}

export interface McpDeps {
  db: McpDb;
  /** server.ts's readingInstant -- SQL for the instant a row was recorded. */
  readingInstant: (table: NaiveTsTable, col?: string, srcCol?: string) => string;
  /** server.ts's source-priority resolver: one source per day per type. */
  filterMetricsByPriority: (metrics: any[], prioritiesJson: string | null, timezone?: string) => any[];
}

export interface McpContext extends McpDeps {
  userId: number;
}

export const MAX_DAYS = 366;
export const DEFAULT_DAYS = 30;

/** Clamp a caller-supplied window to something a single response can hold. */
export const clampDays = (days: number | undefined, fallback = DEFAULT_DAYS): number => {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_DAYS);
};

const cutoffIso = (days: number, extra = 0): string =>
  new Date(Date.now() - (days + extra) * 86_400_000).toISOString();

/** The timestamp column to compare and return, per the table's zone convention. */
const tsExpr = (ctx: McpContext, table: NaiveTsTable): string =>
  ctx.db.type === 'sqlite' ? 'timestamp' : ctx.readingInstant(table);

const user = async (ctx: McpContext): Promise<{ timezone?: string; metric_priorities: string | null }> =>
  (await ctx.db.prepare('SELECT timezone, metric_priorities FROM users WHERE id = ?').get(ctx.userId)) || { metric_priorities: null };

const resolvedZone = (tz?: string): string => tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;

/** Metric rows for a window, one source per day per type, timing rows excluded. */
async function dailyMetrics(ctx: McpContext, days: number, types?: string[]): Promise<{ timezone: string; rows: DailyRow[] }> {
  const u = await user(ctx);
  const params: any[] = [ctx.userId];
  let typeClause = '';
  if (types && types.length) {
    typeClause = ` AND type IN (${types.map(() => '?').join(', ')})`;
    params.push(...types);
  }
  params.push(cutoffIso(days));
  const raw = (await ctx.db.prepare(
    `SELECT type, value, unit, source, ${tsExpr(ctx, 'metrics')} AS timestamp
       FROM metrics WHERE user_id = ?${typeClause} AND timestamp >= ?`
  ).all(...params)) as MetricRow[];

  // bedtime/wake_time values are offsets from their own row's timestamp, not
  // quantities -- summing or averaging them produces a plausible-looking number
  // that means nothing. get_sleep reads them properly; nothing else sees them.
  const usable = raw.filter((m) => !(TIMING_TYPES as readonly string[]).includes(m.type));
  const resolved = ctx.filterMetricsByPriority(usable, u.metric_priorities, u.timezone);
  return { timezone: resolvedZone(u.timezone), rows: aggregateDailyValues(resolved, u.timezone) };
}

export const tools = {
  /** What is actually in this account, so a caller can pick types that exist. */
  async listMetricTypes(ctx: McpContext) {
    const rows = (await ctx.db.prepare(
      `SELECT type, source, COUNT(*) AS rows,
              MIN(${tsExpr(ctx, 'metrics')}) AS first_seen,
              MAX(${tsExpr(ctx, 'metrics')}) AS last_seen
         FROM metrics WHERE user_id = ? GROUP BY type, source ORDER BY type, source`
    ).all(ctx.userId)) as any[];

    const byType = new Map<string, { type: string; rows: number; first_seen: string; last_seen: string; sources: any[] }>();
    for (const r of rows) {
      const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));
      const entry = byType.get(r.type) || { type: r.type, rows: 0, first_seen: iso(r.first_seen), last_seen: iso(r.last_seen), sources: [] };
      entry.rows += Number(r.rows);
      if (iso(r.first_seen) < entry.first_seen) entry.first_seen = iso(r.first_seen);
      if (iso(r.last_seen) > entry.last_seen) entry.last_seen = iso(r.last_seen);
      entry.sources.push({ source: r.source, rows: Number(r.rows), first_seen: iso(r.first_seen), last_seen: iso(r.last_seen) });
      byType.set(r.type, entry);
    }
    return { types: [...byType.values()] };
  },

  /** Daily values for the named metric types (all types when none are named). */
  async getMetrics(ctx: McpContext, args: { types?: string[]; days?: number }) {
    const days = clampDays(args.days);
    const { timezone, rows } = await dailyMetrics(ctx, days, args.types);
    return { days, timezone, note: 'One row per local day, newest first. Daily totals are summed; readings are averaged.', rows };
  },

  /** Daily nutrition totals. Only days with logged food appear. */
  async getNutrition(ctx: McpContext, args: { days?: number }) {
    const days = clampDays(args.days, 14);
    const { timezone, rows } = await dailyMetrics(ctx, days, [...NUTRITION_METRICS]);
    return { days, timezone, rows: rows.filter((r) => Object.keys(r).length > 1) };
  },

  /** Strength/cardio sessions with their exercises, newest first. */
  async getWorkouts(ctx: McpContext, args: { days?: number; include_sets?: boolean }) {
    const days = clampDays(args.days);
    const workouts = (await ctx.db.prepare(
      `SELECT id, name, duration, volume, source, ${tsExpr(ctx, 'workouts')} AS timestamp
         FROM workouts WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp DESC`
    ).all(ctx.userId, cutoffIso(days))) as any[];
    if (!workouts.length) return { days, workouts: [] };

    const ids = workouts.map((w) => w.id);
    const exercises = (await ctx.db.prepare(
      `SELECT id, workout_id, exercise_title, sets_count, best_weight, best_reps, best_distance,
              best_time, exercise_type, primary_muscle_group
         FROM workout_exercises WHERE workout_id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids)) as any[];

    let setsByExercise = new Map<number, any[]>();
    if (args.include_sets && exercises.length) {
      const exIds = exercises.map((e) => e.id);
      const sets = (await ctx.db.prepare(
        `SELECT exercise_id, set_index, weight, reps, distance, time, calories, avg_hr, max_hr, type
           FROM workout_sets WHERE exercise_id IN (${exIds.map(() => '?').join(',')}) ORDER BY exercise_id, set_index`
      ).all(...exIds)) as any[];
      for (const s of sets) {
        const list = setsByExercise.get(s.exercise_id) || [];
        list.push(s);
        setsByExercise.set(s.exercise_id, list);
      }
    }

    const byWorkout = new Map<number, any[]>();
    for (const e of exercises) {
      const list = byWorkout.get(e.workout_id) || [];
      const { id, workout_id, ...rest } = e;
      list.push(args.include_sets ? { ...rest, sets: setsByExercise.get(id) || [] } : rest);
      byWorkout.set(workout_id, list);
    }

    return {
      days,
      workouts: workouts.map((w) => ({
        name: w.name,
        timestamp: w.timestamp instanceof Date ? w.timestamp.toISOString() : w.timestamp,
        duration_minutes: w.duration == null ? null : round(Number(w.duration) / 60, 1),
        volume: w.volume == null ? null : round(Number(w.volume)),
        source: w.source,
        exercises: byWorkout.get(w.id) || [],
      })),
    };
  },

  /** Nightly sleep duration and stages, plus the bedtime-consistency summary. */
  async getSleep(ctx: McpContext, args: { days?: number }) {
    const days = clampDays(args.days, 28);
    const u = await user(ctx);
    const zone = resolvedZone(u.timezone);
    const { rows } = await dailyMetrics(ctx, days, ['sleep', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake']);

    // One extra day so a night anchored just before the window still pairs.
    const timingRows = (await ctx.db.prepare(
      `SELECT type, value, ${tsExpr(ctx, 'metrics')} AS timestamp
         FROM metrics WHERE user_id = ? AND type IN (${TIMING_TYPES.map(() => '?').join(', ')}) AND timestamp >= ?`
    ).all(ctx.userId, ...TIMING_TYPES, cutoffIso(days, 1))) as any[];

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const summary: TimingSummary | null = summariseTiming(pairNights(timingRows), today, zone, days);

    return {
      days,
      timezone: zone,
      // Hours, not the stored minutes: every consumer so far converted it anyway.
      nights: rows
        .filter((r) => Object.keys(r).length > 1)
        .map((r) => {
          const out: Record<string, any> = { date: r.date };
          for (const [k, v] of Object.entries(r)) {
            if (k === 'date') continue;
            out[k === 'sleep' ? 'asleep_hours' : k.replace('sleep_', '') + '_hours'] = round(Number(v) / 60, 2);
          }
          return out;
        }),
      timing: summary
        ? { ...summary, bedSd: round(summary.bedSd, 1), wakeSd: round(summary.wakeSd, 1),
            socialJetLag: summary.socialJetLag == null ? null : round(summary.socialJetLag, 1),
            avg_bedtime: formatClock(summary.avgBed), avg_wake_time: formatClock(summary.avgWake) }
        : null,
      timing_note: summary ? undefined : 'Fewer than 5 paired nights of sleepStart/sleepEnd in this window.',
    };
  },

  /** Stored daily readiness scores and their components. */
  async getReadiness(ctx: McpContext, args: { days?: number }) {
    const days = clampDays(args.days, 14);
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = (await ctx.db.prepare(
      `SELECT snapshot_date, score, components, algo_version FROM readiness_snapshots
         WHERE user_id = ? AND snapshot_date >= ? ORDER BY snapshot_date DESC`
    ).all(ctx.userId, from)) as any[];
    return {
      days,
      note: 'Only finished days are stored; today appears once it closes.',
      scores: rows.map((r) => {
        let components: any = null;
        try { components = r.components ? JSON.parse(r.components) : null; } catch { components = null; }
        return { date: String(r.snapshot_date).slice(0, 10), score: r.score, algo_version: r.algo_version, components };
      }),
    };
  },

  /** The user's configured targets. */
  async getTargets(ctx: McpContext) {
    const rows = (await ctx.db.prepare('SELECT type, value, unit FROM targets WHERE user_id = ? ORDER BY type').all(ctx.userId)) as any[];
    return { targets: rows };
  },
};
