// Item 48: `/api/metrics/aggregated` used to `SELECT ... LIMIT 1000000` every raw
// reading of the requested types, run `filterMetricsByPriority` over them in JS and
// then group by day/week/month. That is the item-8 shape: once one type passes a
// million rows in the window, everything past the first million falls off the end
// (the query was ORDER BY timestamp ASC, so here it is the NEWEST readings that
// would go) and the chart quietly goes short with no signal to the caller.
//
// Now the database does the reduction. It cannot do all of it portably: the day a
// reading belongs to depends on the user's zone, and sqlite has no zone support at
// all (mysql only with its tz tables loaded). So SQL groups into fixed 15-minute UTC
// buckets -- every IANA zone in use today has an offset and its transitions on a
// multiple of 15 minutes, so a bucket never straddles a local midnight -- and this
// module maps each bucket to its local day with the same Intl formatter the old JS
// used. The -12 h sleep shift is applied here too: 12 h is a whole number of buckets,
// so shifting the bucket start is the same as shifting every reading in it.
//
// Everything after that is the old route's logic over (bucket -> sum/count/max/min)
// instead of over rows, with the source policy unchanged: per (local day, raw type)
// the winner is the user's `metric_priorities` order, then SOURCE_RANK, then row
// count, then name -- the same ordering as the summary route's roll-up
// (aggregateDailyMetrics) and `filterMetricsByPriority`.

export const BUCKET_SECONDS = 900;
const BUCKET_MS = BUCKET_SECONDS * 1000;
const SLEEP_SHIFT_MS = 12 * 60 * 60 * 1000;

export type AggregatedDbType = 'sqlite' | 'postgres' | 'mariadb' | 'mysql';

/**
 * SQL expression for the 15-minute bucket index (floor(epoch seconds / 900)) of a
 * metrics row, as an integer. `instantExpr` is the column as a true instant on
 * postgres (`readingInstant('metrics')`); sqlite and mysql read the naive column as
 * UTC, which is what the JS `new Date(...)` parse of their rows did before.
 */
export function bucketIndexSql(dbType: AggregatedDbType, instantExpr: string): string {
  if (dbType === 'postgres') {
    return `CAST(FLOOR(EXTRACT(EPOCH FROM ${instantExpr}) / ${BUCKET_SECONDS}) AS INTEGER)`;
  }
  if (dbType === 'sqlite') {
    // Rows are ISO text, usually `...Z` from toISOString(); older ones look like
    // `2026-01-27 19:39:00 +0000`. strftime understands the first and the
    // `YYYY-MM-DD HH:MM:SS` prefix of the second; the trailing offset is folded in
    // as `+HH:MM`, which strftime does accept. Unparseable text gives NULL, and the
    // old path dropped unparseable timestamps too (`filterMetricsByPriority` skips NaN).
    const norm = `(CASE WHEN ${instantExpr} LIKE '____-__-__ __:__:__ +____' OR ${instantExpr} LIKE '____-__-__ __:__:__ -____'
      THEN substr(${instantExpr}, 1, 19) || substr(${instantExpr}, 21, 3) || ':' || substr(${instantExpr}, 24, 2)
      ELSE ${instantExpr} END)`;
    return `(CAST(strftime('%s', ${norm}) AS INTEGER) / ${BUCKET_SECONDS})`;
  }
  return `FLOOR(TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', ${instantExpr}) / ${BUCKET_SECONDS})`;
}

/** One row of the bucket query. Numeric columns may arrive as strings (node-pg bigint). */
export interface MetricBucketRow {
  bucket: number | string | null;
  type: string;
  source: string;
  total: number | string;
  cnt: number | string;
  max_value: number | string;
  min_value: number | string;
}

export interface AggregateOptions {
  granularity: 'day' | 'week' | 'month';
  aggregation: 'avg' | 'sum' | 'max' | 'min';
  timezone?: string;
  /** users.metric_priorities, raw JSON. */
  prioritiesJson?: string | null;
  /** raw type -> canonical type */
  mappings: Record<string, string>;
  sourceRank: Record<string, number>;
  unknownSourceRank: number;
}

interface Stats { sum: number; count: number; max: number; min: number }

const emptyStats = (): Stats => ({ sum: 0, count: 0, max: -Infinity, min: Infinity });

function addStats(into: Stats, sum: number, count: number, max: number, min: number) {
  into.sum += sum;
  into.count += count;
  if (max > into.max) into.max = max;
  if (min < into.min) into.min = min;
}

/**
 * Turns bucket rows into the `/api/metrics/aggregated` response: one entry per
 * day/week/month key with a value per canonical type, sorted by date.
 */
export function aggregateMetricBuckets(rows: MetricBucketRow[], opts: AggregateOptions): any[] {
  let priorities: Record<string, string[]> = {};
  if (opts.prioritiesJson) {
    try {
      priorities = JSON.parse(opts.prioritiesJson) || {};
    } catch (e) {
      priorities = {};
    }
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: opts.timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  // 1. (local day, raw type, source) -> stats. Many buckets share a day, so cache it.
  const dayCache = new Map<number, string>();
  const byDayType: Record<string, Record<string, Record<string, Stats>>> = {};
  for (const r of rows) {
    if (r.bucket === null || r.bucket === undefined || r.bucket === '') continue;
    const idx = Number(r.bucket);
    if (!Number.isFinite(idx)) continue;
    let ms = idx * BUCKET_MS;
    if (r.type.startsWith('sleep')) ms -= SLEEP_SHIFT_MS;
    let day = dayCache.get(ms);
    if (day === undefined) {
      day = formatter.format(new Date(ms));
      dayCache.set(ms, day);
    }
    const types = (byDayType[day] ??= {});
    const sources = (types[r.type] ??= {});
    const s = (sources[r.source] ??= emptyStats());
    addStats(s, Number(r.total), Number(r.cnt), Number(r.max_value), Number(r.min_value));
  }

  // 2. Winner per (day, raw type), then fold into the granularity key under the
  //    canonical type.
  const groupedByDate: Record<string, Record<string, Stats>> = {};
  for (const day in byDayType) {
    let key: string;
    if (opts.granularity === 'day') {
      key = day;
    } else if (opts.granularity === 'week') {
      const localDay = new Date(day + 'T00:00:00Z');
      localDay.setUTCDate(localDay.getUTCDate() - localDay.getUTCDay());
      key = localDay.toISOString().split('T')[0];
    } else {
      key = `${day.substring(0, 7)}-01`;
    }

    for (const type in byDayType[day]) {
      const sources = byDayType[day][type];
      const metricPriorities = priorities[type];
      const userRank = (src: string) => {
        if (!metricPriorities || metricPriorities.length === 0) return Infinity;
        const i = metricPriorities.indexOf(src);
        return i === -1 ? Infinity : i;
      };
      const bestSource = Object.keys(sources).sort((a, b) => {
        const ua = userRank(a), ub = userRank(b);
        if (ua !== ub) return ua - ub;
        const ra = opts.sourceRank[a] ?? opts.unknownSourceRank;
        const rb = opts.sourceRank[b] ?? opts.unknownSourceRank;
        if (ra !== rb) return ra - rb;
        if (sources[b].count !== sources[a].count) return sources[b].count - sources[a].count;
        return a.localeCompare(b);
      })[0];
      if (!bestSource) continue;

      const canonicalType = Object.prototype.hasOwnProperty.call(opts.mappings, type) ? opts.mappings[type] : type;
      const w = sources[bestSource];
      const target = ((groupedByDate[key] ??= {})[canonicalType] ??= emptyStats());
      addStats(target, w.sum, w.count, w.max, w.min);
    }
  }

  // 3. Same output shape and derived fields as before.
  return Object.entries(groupedByDate).map(([date, typeGroups]) => {
    const entry: any = { date };
    Object.entries(typeGroups).forEach(([t, data]) => {
      let val: number;
      if (opts.aggregation === 'sum') val = data.sum;
      else if (opts.aggregation === 'max') val = data.max !== -Infinity ? data.max : 0;
      else if (opts.aggregation === 'min') val = data.min !== Infinity ? data.min : 0;
      else val = data.sum / data.count;

      entry[t] = Number(val.toFixed(2));
    });

    // Calculate Fat Mass (kg) if weight and body_fat (%) are available
    if (entry.weight && entry.body_fat && !entry.fat_mass) {
      entry.fat_mass = Number((entry.weight * (entry.body_fat / 100)).toFixed(2));
    }

    // Calculate Lean Body Mass (kg) if weight and body_fat (%) are available
    if (entry.weight && entry.body_fat && !entry.lean_body_mass) {
      entry.lean_body_mass = Number((entry.weight * (1 - entry.body_fat / 100)).toFixed(2));
    }

    return entry;
  }).sort((a, b) => a.date.localeCompare(b.date));
}
