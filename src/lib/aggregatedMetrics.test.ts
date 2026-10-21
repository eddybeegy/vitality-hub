import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { aggregateMetricBuckets, bucketIndexSql, BUCKET_SECONDS, MetricBucketRow, AggregateOptions } from './aggregatedMetrics';

const SOURCE_RANK: Record<string, number> = {
  cronometer: 1, nutracheck: 2, nutrachek: 2, hevy: 2, apple_health: 3, withings: 4, healthsync: 4,
};
const MAPPINGS: Record<string, string> = {
  step_count: 'steps', stepCount: 'steps', heart_rate_variability_sdnn: 'hrv', body_mass: 'weight',
};

interface Row { type: string; source: string; timestamp: string; value: number }

// The pre-item-48 pipeline, copied verbatim in behaviour from server.ts at a619eb9:
// `filterMetricsByPriority` over the raw rows, then the route's own grouping. This is
// the oracle the SQL-bucket path has to reproduce exactly.
function oldPipeline(metrics: Row[], prioritiesJson: string | null, tz: string, granularity: string, aggregation: string) {
  let priorities: Record<string, string[]> = {};
  if (prioritiesJson) { try { priorities = JSON.parse(prioritiesJson) || {}; } catch { priorities = {}; } }
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const grouped: Record<string, Record<string, Row[]>> = {};
  for (const m of metrics) {
    const d = new Date(m.timestamp);
    if (isNaN(d.getTime())) continue;
    if (m.type.startsWith('sleep')) d.setTime(d.getTime() - 12 * 3600 * 1000);
    const day = fmt.format(d);
    ((grouped[day] ??= {})[m.type] ??= []).push(m);
  }
  const filtered: Row[] = [];
  for (const day in grouped) for (const type in grouped[day]) {
    const cands = grouped[day][type];
    const mp = priorities[type];
    const counts: Record<string, number> = {};
    for (const c of cands) counts[c.source] = (counts[c.source] ?? 0) + 1;
    const ur = (s: string) => (!mp || mp.length === 0) ? Infinity : (mp.indexOf(s) === -1 ? Infinity : mp.indexOf(s));
    const best = Object.keys(counts).sort((a, b) => {
      if (ur(a) !== ur(b)) return ur(a) - ur(b);
      const ra = SOURCE_RANK[a] ?? 4, rb = SOURCE_RANK[b] ?? 4;
      if (ra !== rb) return ra - rb;
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a.localeCompare(b);
    })[0];
    const seen = new Set<string>();
    for (const c of cands) if (c.source === best && !seen.has(`${c.timestamp}_${c.value}`)) { filtered.push(c); seen.add(`${c.timestamp}_${c.value}`); }
  }
  const byDate: Record<string, Record<string, { sum: number; count: number; max: number; min: number }>> = {};
  for (const m of filtered) {
    const ct = MAPPINGS[m.type] ?? m.type;
    const d = new Date(m.timestamp);
    if (m.type.startsWith('sleep')) d.setTime(d.getTime() - 12 * 3600 * 1000);
    const dayStr = fmt.format(d);
    let key: string;
    if (granularity === 'day') key = dayStr;
    else if (granularity === 'week') { const ld = new Date(dayStr + 'T00:00:00Z'); ld.setUTCDate(ld.getUTCDate() - ld.getUTCDay()); key = ld.toISOString().split('T')[0]; }
    else key = `${dayStr.substring(0, 7)}-01`;
    const g = ((byDate[key] ??= {})[ct] ??= { sum: 0, count: 0, max: -Infinity, min: Infinity });
    g.sum += m.value; g.count += 1; if (m.value > g.max) g.max = m.value; if (m.value < g.min) g.min = m.value;
  }
  return Object.entries(byDate).map(([date, tg]) => {
    const e: any = { date };
    for (const [t, d] of Object.entries(tg)) {
      const v = aggregation === 'sum' ? d.sum : aggregation === 'max' ? d.max : aggregation === 'min' ? d.min : d.sum / d.count;
      e[t] = Number(v.toFixed(2));
    }
    if (e.weight && e.body_fat && !e.fat_mass) e.fat_mass = Number((e.weight * (e.body_fat / 100)).toFixed(2));
    if (e.weight && e.body_fat && !e.lean_body_mass) e.lean_body_mass = Number((e.weight * (1 - e.body_fat / 100)).toFixed(2));
    return e;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

// What the SQL does, in JS: DISTINCT (type, source, timestamp, value), bucket, group.
function simulateSql(rows: Row[]): MetricBucketRow[] {
  const distinct = new Map<string, Row>();
  for (const r of rows) distinct.set(`${r.type}|${r.source}|${r.timestamp}|${r.value}`, r);
  const g = new Map<string, MetricBucketRow>();
  for (const r of distinct.values()) {
    const ms = new Date(r.timestamp).getTime();
    if (isNaN(ms)) continue;
    const bucket = Math.floor(ms / 1000 / BUCKET_SECONDS);
    const k = `${bucket}|${r.type}|${r.source}`;
    const cur = g.get(k) ?? { bucket, type: r.type, source: r.source, total: 0, cnt: 0, max_value: -Infinity, min_value: Infinity };
    cur.total = Number(cur.total) + r.value;
    cur.cnt = Number(cur.cnt) + 1;
    cur.max_value = Math.max(Number(cur.max_value), r.value);
    cur.min_value = Math.min(Number(cur.min_value), r.value);
    g.set(k, cur);
  }
  return [...g.values()];
}

// Deterministic PRNG so a failure is reproducible.
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function synthRows(seed: number): Row[] {
  const r = rng(seed);
  const types = ['steps', 'step_count', 'heart_rate', 'hrv', 'heart_rate_variability_sdnn', 'sleep_core', 'sleep_deep', 'weight', 'body_fat', 'body_mass'];
  const sources = ['apple_health', 'healthsync', 'withings', 'cronometer', 'mystery'];
  // 2026-10-20 .. 2026-11-03 covers the BST -> GMT change on 2026-10-25.
  const start = Date.UTC(2026, 9, 20);
  const span = 14 * 24 * 3600 * 1000;
  const out: Row[] = [];
  for (let i = 0; i < 4000; i++) {
    // Integer-ish values keep float sums exact, so ordering differences cannot
    // hide behind toFixed(2) -- the comparison is about grouping and policy.
    const ts = new Date(start + Math.floor(r() * span / 1000) * 1000).toISOString();
    const row = { type: types[Math.floor(r() * types.length)], source: sources[Math.floor(r() * sources.length)], timestamp: ts, value: Math.round(r() * 2000) / 4 };
    out.push(row);
    if (r() < 0.02) out.push({ ...row }); // exact duplicate, must be deduped
  }
  // Readings either side of local midnight across the clock change.
  out.push({ type: 'steps', source: 'apple_health', timestamp: '2026-10-24T22:59:59.000Z', value: 10 }); // 23:59 BST, 24th
  out.push({ type: 'steps', source: 'apple_health', timestamp: '2026-10-24T23:00:00.000Z', value: 20 }); // 00:00 BST, 25th
  out.push({ type: 'steps', source: 'apple_health', timestamp: '2026-10-25T23:59:59.000Z', value: 30 }); // 23:59 GMT, 25th
  out.push({ type: 'steps', source: 'apple_health', timestamp: '2026-10-26T00:00:00.000Z', value: 40 }); // 00:00 GMT, 26th
  return out;
}

const PRIORITIES = JSON.stringify({ weight: ['withings', 'apple_health'], steps: ['healthsync'] });

describe('aggregateMetricBuckets reproduces the pre-item-48 route exactly', () => {
  const zones = ['Europe/London', 'UTC', 'America/New_York', 'Asia/Kolkata', 'Asia/Kathmandu'];
  for (const tz of zones) {
    for (const granularity of ['day', 'week', 'month'] as const) {
      for (const aggregation of ['avg', 'sum', 'max', 'min'] as const) {
        it(`${tz} ${granularity} ${aggregation}`, () => {
          for (const [seed, prio] of [[1, null], [2, PRIORITIES], [3, '{not json']] as const) {
            const rows = synthRows(seed);
            const expected = oldPipeline(rows, prio, tz, granularity, aggregation);
            const opts: AggregateOptions = { granularity, aggregation, timezone: tz, prioritiesJson: prio, mappings: MAPPINGS, sourceRank: SOURCE_RANK, unknownSourceRank: 4 };
            expect(aggregateMetricBuckets(simulateSql(rows), opts)).toEqual(expected);
          }
        });
      }
    }
  }

  it('splits the day at local midnight on both sides of the 2026-10-25 clock change', () => {
    const rows: Row[] = [
      { type: 'steps', source: 'apple_health', timestamp: '2026-10-24T22:59:59.000Z', value: 10 },
      { type: 'steps', source: 'apple_health', timestamp: '2026-10-24T23:00:00.000Z', value: 20 },
      { type: 'steps', source: 'apple_health', timestamp: '2026-10-25T23:59:59.000Z', value: 30 },
      { type: 'steps', source: 'apple_health', timestamp: '2026-10-26T00:00:00.000Z', value: 40 },
    ];
    const out = aggregateMetricBuckets(simulateSql(rows), { granularity: 'day', aggregation: 'sum', timezone: 'Europe/London', mappings: MAPPINGS, sourceRank: SOURCE_RANK, unknownSourceRank: 4 });
    expect(out).toEqual([
      { date: '2026-10-24', steps: 10 },
      { date: '2026-10-25', steps: 50 },
      { date: '2026-10-26', steps: 40 },
    ]);
  });

  it('accepts node-pg style string numerics and skips null buckets', () => {
    const rows: MetricBucketRow[] = [
      { bucket: String(Math.floor(Date.UTC(2026, 9, 21, 12) / 1000 / BUCKET_SECONDS)), type: 'steps', source: 'apple_health', total: '100.5', cnt: '3', max_value: '60', min_value: '10' },
      { bucket: null, type: 'steps', source: 'apple_health', total: 999, cnt: 1, max_value: 999, min_value: 999 },
    ];
    const out = aggregateMetricBuckets(rows, { granularity: 'day', aggregation: 'avg', timezone: 'Europe/London', mappings: MAPPINGS, sourceRank: SOURCE_RANK, unknownSourceRank: 4 });
    expect(out).toEqual([{ date: '2026-10-21', steps: 33.5 }]);
  });

  it('prefers the user priority, then SOURCE_RANK, then row count, then name', () => {
    const b = Math.floor(Date.UTC(2026, 9, 21, 12) / 1000 / BUCKET_SECONDS);
    const row = (source: string, cnt: number, total: number): MetricBucketRow => ({ bucket: b, type: 'heart_rate', source, total, cnt, max_value: total, min_value: total });
    const base = { granularity: 'day' as const, aggregation: 'sum' as const, timezone: 'UTC', mappings: MAPPINGS, sourceRank: SOURCE_RANK, unknownSourceRank: 4 };
    // SOURCE_RANK: apple_health (3) beats healthsync (4) despite fewer rows.
    expect(aggregateMetricBuckets([row('healthsync', 9, 9), row('apple_health', 1, 1)], base)[0].heart_rate).toBe(1);
    // user priority beats SOURCE_RANK.
    expect(aggregateMetricBuckets([row('healthsync', 9, 9), row('apple_health', 1, 1)], { ...base, prioritiesJson: '{"heart_rate":["healthsync"]}' })[0].heart_rate).toBe(9);
    // same rank (withings 4, healthsync 4): more rows wins.
    expect(aggregateMetricBuckets([row('withings', 2, 2), row('healthsync', 5, 5)], base)[0].heart_rate).toBe(5);
    // same rank, same count: name.
    expect(aggregateMetricBuckets([row('withings', 2, 7), row('healthsync', 2, 3)], base)[0].heart_rate).toBe(3);
  });
});

describe('bucketIndexSql on sqlite', () => {
  it('buckets the timestamp formats the sqlite path stores, and NULLs garbage', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE metrics (timestamp TEXT)');
    const stamps = [
      '2026-10-21T09:48:00.000Z',
      '2026-10-21T09:48:00Z',
      '2026-10-21 09:48:00',
      '2026-01-27 19:39:00 +0000',
      '2026-01-27 20:39:00 +0100',
      'not a date',
    ];
    const ins = db.prepare('INSERT INTO metrics (timestamp) VALUES (?)');
    for (const s of stamps) ins.run(s);
    const got = db.prepare(`SELECT timestamp, ${bucketIndexSql('sqlite', 'timestamp')} AS bucket FROM metrics`).all() as any[];
    const want = (iso: string) => Math.floor(Date.parse(iso) / 1000 / BUCKET_SECONDS);
    expect(got.map(g => g.bucket)).toEqual([
      want('2026-10-21T09:48:00Z'),
      want('2026-10-21T09:48:00Z'),
      want('2026-10-21T09:48:00Z'),
      want('2026-01-27T19:39:00Z'),
      want('2026-01-27T19:39:00Z'),
      null,
    ]);
  });
});
