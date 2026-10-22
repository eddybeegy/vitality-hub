import { describe, it, expect, vi } from 'vitest';
import { tools, clampDays, MAX_DAYS, type McpContext } from './tools';

/**
 * A db stub that answers by matching the SQL, and records every statement with
 * the params it was given -- the params are what prove a tool scoped its query
 * to the context's user id rather than anything a caller passed in.
 */
function fakeDb(answers: Array<[RegExp, any[] | any]>) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const db = {
    type: 'sqlite',
    prepare(sql: string) {
      const run = (...params: any[]) => {
        calls.push({ sql, params });
        const hit = answers.find(([re]) => re.test(sql));
        return hit ? hit[1] : [];
      };
      return { all: run, get: run };
    },
  };
  return { db, calls };
}

const ctx = (db: any, filter?: any): McpContext => ({
  db,
  readingInstant: () => 'timestamp',
  filterMetricsByPriority: filter || ((metrics: any[]) => metrics),
  userId: 7,
});

const USER = { timezone: 'Europe/London', metric_priorities: null };

describe('clampDays', () => {
  it('falls back for missing or nonsense input', () => {
    expect(clampDays(undefined, 30)).toBe(30);
    expect(clampDays(NaN as any, 14)).toBe(14);
    expect(clampDays(0, 14)).toBe(14);
    expect(clampDays(-5, 14)).toBe(14);
  });

  it('caps a huge window instead of running it', () => {
    expect(clampDays(100000)).toBe(MAX_DAYS);
  });

  it('keeps a sane value', () => {
    expect(clampDays(7)).toBe(7);
  });
});

describe('getMetrics', () => {
  it('queries only the context user and never a caller-supplied id', async () => {
    const { db, calls } = fakeDb([[/FROM users/, USER], [/FROM metrics/, []]]);
    await tools.getMetrics(ctx(db), { days: 5, userId: 99 } as any);
    for (const c of calls) expect(c.params).toContain(7);
    expect(JSON.stringify(calls)).not.toContain('99');
  });

  it('excludes bedtime/wake_time rows, whose values are offsets not quantities', async () => {
    const seen: any[] = [];
    const { db } = fakeDb([
      [/FROM users/, USER],
      [/FROM metrics/, [
        { type: 'steps', value: 100, timestamp: '2026-10-20T10:00:00Z' },
        { type: 'bedtime', value: -3600, timestamp: '2026-10-20T23:00:00Z' },
        { type: 'wake_time', value: 25200, timestamp: '2026-10-20T23:00:00Z' },
      ]],
    ]);
    const out = await tools.getMetrics(ctx(db, (m: any[]) => { seen.push(...m); return m; }), {});
    expect(seen.map((m) => m.type)).toEqual(['steps']);
    expect(Object.keys(out.rows[0])).toEqual(['date', 'steps']);
  });

  it('filters by type in SQL when types are named', async () => {
    const { db, calls } = fakeDb([[/FROM users/, USER], [/FROM metrics/, []]]);
    await tools.getMetrics(ctx(db), { types: ['weight', 'hrv'] });
    const q = calls.find((c) => /FROM metrics/.test(c.sql))!;
    expect(q.sql).toContain('type IN (?, ?)');
    expect(q.params).toEqual([7, 'weight', 'hrv', expect.any(String)]);
  });

  it('passes the account source-priority list through, not a default', async () => {
    const filter = vi.fn((m: any[]) => m);
    const { db } = fakeDb([
      [/FROM users/, { timezone: 'Europe/London', metric_priorities: '{"weight":["withings"]}' }],
      [/FROM metrics/, []],
    ]);
    await tools.getMetrics(ctx(db, filter), {});
    expect(filter).toHaveBeenCalledWith([], '{"weight":["withings"]}', 'Europe/London');
  });

  it('survives a user row that is missing', async () => {
    const { db } = fakeDb([[/FROM users/, undefined], [/FROM metrics/, []]]);
    await expect(tools.getMetrics(ctx(db), {})).resolves.toMatchObject({ rows: [] });
  });
});

describe('getNutrition', () => {
  it('drops days with no logged food rather than reporting them as zero', async () => {
    const { db } = fakeDb([
      [/FROM users/, USER],
      [/FROM metrics/, [{ type: 'protein', value: 120, timestamp: '2026-10-20T12:00:00Z' }]],
    ]);
    const out = await tools.getNutrition(ctx(db), { days: 3 });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ protein: 120 });
  });

  it('asks only for nutrition types', async () => {
    const { db, calls } = fakeDb([[/FROM users/, USER], [/FROM metrics/, []]]);
    await tools.getNutrition(ctx(db), {});
    const q = calls.find((c) => /FROM metrics/.test(c.sql))!;
    expect(q.params).toContain('calories_in');
    expect(q.params).not.toContain('steps');
  });
});

describe('getWorkouts', () => {
  const workout = { id: 1, name: 'Pull', duration: 3600, volume: 4210.5, source: 'hevy', timestamp: '2026-10-20T17:00:00Z' };

  it('converts duration to minutes and nests exercises', async () => {
    const { db } = fakeDb([
      [/FROM workouts/, [workout]],
      [/FROM workout_exercises/, [{ id: 10, workout_id: 1, exercise_title: 'Row', sets_count: 3 }]],
    ]);
    const out = await tools.getWorkouts(ctx(db), { days: 7 });
    expect(out.workouts[0]).toMatchObject({ name: 'Pull', duration_minutes: 60, volume: 4210.5 });
    expect(out.workouts[0].exercises).toEqual([{ exercise_title: 'Row', sets_count: 3 }]);
  });

  it('skips the exercise query entirely when there are no workouts', async () => {
    const { db, calls } = fakeDb([[/FROM workouts/, []]]);
    const out = await tools.getWorkouts(ctx(db), {});
    expect(out.workouts).toEqual([]);
    expect(calls.some((c) => /workout_exercises/.test(c.sql))).toBe(false);
  });

  it('omits sets unless asked', async () => {
    const { db, calls } = fakeDb([
      [/FROM workouts/, [workout]],
      [/FROM workout_exercises/, [{ id: 10, workout_id: 1, exercise_title: 'Row', sets_count: 1 }]],
      [/FROM workout_sets/, [{ exercise_id: 10, set_index: 0, weight: 60, reps: 10 }]],
    ]);
    const without = await tools.getWorkouts(ctx(db), {});
    expect(calls.some((c) => /workout_sets/.test(c.sql))).toBe(false);
    expect(without.workouts[0].exercises[0].sets).toBeUndefined();

    const with_ = await tools.getWorkouts(ctx(db), { include_sets: true });
    expect(with_.workouts[0].exercises[0].sets).toEqual([{ exercise_id: 10, set_index: 0, weight: 60, reps: 10 }]);
  });

  it('tolerates a null duration and volume', async () => {
    const { db } = fakeDb([
      [/FROM workouts/, [{ ...workout, duration: null, volume: null }]],
      [/FROM workout_exercises/, []],
    ]);
    const out = await tools.getWorkouts(ctx(db), {});
    expect(out.workouts[0]).toMatchObject({ duration_minutes: null, volume: null });
  });
});

describe('getSleep', () => {
  const stages = [
    { type: 'sleep', value: 420, timestamp: '2026-10-21T02:00:00Z' },
    { type: 'sleep_deep', value: 90, timestamp: '2026-10-21T02:00:00Z' },
  ];

  it('reports stages in hours on the night they belong to', async () => {
    const { db } = fakeDb([[/FROM users/, USER], [/type IN \(\?, \?\)/, []], [/FROM metrics/, stages]]);
    const out = await tools.getSleep(ctx(db), { days: 7 });
    expect(out.nights[0]).toEqual({ date: '2026-10-20', asleep_hours: 7, deep_hours: 1.5 });
  });

  it('returns no timing summary, and says why, below five paired nights', async () => {
    const { db } = fakeDb([
      [/FROM users/, USER],
      [/type IN \(\?, \?\)/, [
        { type: 'bedtime', value: -3600, timestamp: '2026-10-20T23:00:00Z' },
        { type: 'wake_time', value: 25200, timestamp: '2026-10-20T23:00:00Z' },
      ]],
      [/FROM metrics/, stages],
    ]);
    const out = await tools.getSleep(ctx(db), { days: 28 });
    expect(out.timing).toBeNull();
    expect(out.timing_note).toMatch(/Fewer than 5 paired nights/);
  });

  it('widens the timing window by a day so a night anchored just outside still pairs', async () => {
    const { db, calls } = fakeDb([[/FROM users/, USER], [/type IN \(\?, \?\)/, []], [/FROM metrics/, []]]);
    await tools.getSleep(ctx(db), { days: 10 });
    const timingQ = calls.find((c) => /type IN \(\?, \?\)/.test(c.sql))!;
    // The stage query carries its types as params, not in the SQL text.
    const stageQ = calls.find((c) => c.params.includes('sleep_in_bed'))!;
    expect(Date.parse(timingQ.params.at(-1))).toBeLessThan(Date.parse(stageQ.params.at(-1)));
  });
});

describe('getReadiness', () => {
  it('parses stored components and keeps a bad JSON blob from throwing', async () => {
    const { db } = fakeDb([[/readiness_snapshots/, [
      { snapshot_date: '2026-10-20', score: 81, components: '{"sleep":20}', algo_version: 3 },
      { snapshot_date: '2026-10-19', score: 74, components: '{broken', algo_version: 3 },
    ]]]);
    const out = await tools.getReadiness(ctx(db), { days: 5 });
    expect(out.scores[0].components).toEqual({ sleep: 20 });
    expect(out.scores[1].components).toBeNull();
  });

  it('scopes to the context user', async () => {
    const { db, calls } = fakeDb([[/readiness_snapshots/, []]]);
    await tools.getReadiness(ctx(db), {});
    expect(calls[0].params[0]).toBe(7);
  });
});

describe('getTargets', () => {
  it('returns the stored targets for the context user', async () => {
    const { db, calls } = fakeDb([[/FROM targets/, [{ type: 'protein', value: 170, unit: 'g' }]]]);
    const out = await tools.getTargets(ctx(db));
    expect(out.targets).toEqual([{ type: 'protein', value: 170, unit: 'g' }]);
    expect(calls[0].params).toEqual([7]);
  });
});

describe('listMetricTypes', () => {
  it('folds the per-source rows into one entry per type with the outer date range', async () => {
    const { db } = fakeDb([[/GROUP BY type, source/, [
      { type: 'weight', source: 'withings', rows: 40, first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-10-20T00:00:00Z' },
      { type: 'weight', source: 'apple_health', rows: 5, first_seen: '2025-06-01T00:00:00Z', last_seen: '2026-03-01T00:00:00Z' },
      { type: 'steps', source: 'apple_health', rows: 900, first_seen: '2025-01-01T00:00:00Z', last_seen: '2026-10-22T00:00:00Z' },
    ]]]);
    const out = await tools.listMetricTypes(ctx(db));
    expect(out.types).toHaveLength(2);
    const weight = out.types.find((t: any) => t.type === 'weight')!;
    expect(weight.rows).toBe(45);
    expect(weight.first_seen).toBe('2025-06-01T00:00:00Z');
    expect(weight.last_seen).toBe('2026-10-20T00:00:00Z');
    expect(weight.sources.map((s: any) => s.source)).toEqual(['withings', 'apple_health']);
  });

  it('renders a Date column from postgres as an ISO string', async () => {
    const { db } = fakeDb([[/GROUP BY type, source/, [
      { type: 'hrv', source: 'apple_health', rows: 2, first_seen: new Date('2026-10-01T00:00:00Z'), last_seen: new Date('2026-10-20T00:00:00Z') },
    ]]]);
    const out = await tools.listMetricTypes(ctx(db));
    expect(out.types[0].first_seen).toBe('2026-10-01T00:00:00.000Z');
  });
});
