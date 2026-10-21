/**
 * Personal baselines for the readiness score.
 *
 * HRV and resting heart rate mean nothing in absolute terms -- 45 ms is a good
 * morning for one person and a bad one for another. So each day is scored
 * against the user's own normal range: the mean +/- 1 SD of the daily values
 * over the WINDOW_DAYS calendar days before the scored day (the scored day is
 * never part of its own baseline).
 *
 * HRV is right-skewed, so its statistics are taken on ln(value) and the range
 * is reported back in ms; resting HR is close enough to normal to use raw bpm.
 *
 * Days are calendar days in the user's timezone. The aggregated rows the
 * dashboard and loadReadinessInputs() feed in already carry a bare 'YYYY-MM-DD'
 * (bucketed per source by aggregateDailyMetrics, which is where the
 * per-source timestamp conventions are handled); a full timestamp is
 * formatted into the user's zone. All day arithmetic is Date.UTC on a pure
 * Y-M-D, so neither the process timezone nor a DST change can move a day.
 */

export const WINDOW_DAYS = 28;
export const MIN_BASELINE_DAYS = 7;

export type Direction = 'higher' | 'lower';

export interface DailyValue {
  day: string;
  value: number;
}

export interface Baseline {
  /** Centre of the normal range, in display units (geometric mean for log metrics). */
  mean: number;
  low: number;
  high: number;
  /** Days in the window that had a reading. */
  days: number;
}

export interface BaselineScore {
  score: number;
  label: string;
  value: number;
  day: string;
  /** null while there are fewer than MIN_BASELINE_DAYS days of history. */
  baseline: Baseline | null;
}

interface MetricLike {
  type: string;
  value: number;
  timestamp: string;
}

const DAY_MS = 86400000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** The calendar day of a metric row: a bare YYYY-MM-DD as is, a timestamp formatted into the zone. */
export function metricDay(timestamp: string, formatter: Intl.DateTimeFormat): string | null {
  if (!timestamp) return null;
  if (DAY_RE.test(timestamp)) return timestamp;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(timestamp);
  const d = new Date(hasZone ? timestamp : timestamp.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return null;
  return formatter.format(d);
}

/**
 * One value per day for `type`, oldest first. Several rows on one day are
 * averaged; non-finite and non-positive values (a 0 bpm or 0 ms reading is a
 * sensor gap, not a measurement) are dropped.
 */
export function dailySeries(metrics: MetricLike[], type: string, timezone = 'UTC'): DailyValue[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const byDay: Record<string, { total: number; count: number }> = {};
  for (const m of metrics) {
    if (m.type !== type) continue;
    const value = Number(m.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    const day = metricDay(String(m.timestamp ?? ''), formatter);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { total: 0, count: 0 };
    byDay[day].total += value;
    byDay[day].count += 1;
  }
  return Object.keys(byDay)
    .sort()
    .map(day => ({ day, value: byDay[day].total / byDay[day].count }));
}

/** The days of `series` in [scoredDay - windowDays, scoredDay). */
export function windowBefore(series: DailyValue[], scoredDay: string, windowDays = WINDOW_DAYS): DailyValue[] {
  const end = dayNumber(scoredDay);
  return series.filter(p => {
    const n = dayNumber(p.day);
    return n < end && n >= end - windowDays;
  });
}

/**
 * Normal range from the window before `scoredDay`, or null with fewer than
 * `minDays` days of data. The SD has a floor (5% of the mean) so a run of
 * near-identical days cannot make an ordinary wobble look like an outlier.
 */
export function personalBaseline(
  series: DailyValue[],
  scoredDay: string,
  opts: { log?: boolean; windowDays?: number; minDays?: number } = {}
): (Baseline & { mu: number; sd: number }) | null {
  const { log = false, windowDays = WINDOW_DAYS, minDays = MIN_BASELINE_DAYS } = opts;
  const window = windowBefore(series, scoredDay, windowDays);
  if (window.length < minDays) return null;

  const xs = window.map(p => (log ? Math.log(p.value) : p.value));
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  const floor = log ? 0.05 : 0.05 * Math.abs(mu);
  const sd = Math.max(Math.sqrt(variance), floor);

  const back = (x: number) => (log ? Math.exp(x) : x);
  return { mu, sd, mean: back(mu), low: back(mu - sd), high: back(mu + sd), days: window.length };
}

/**
 * 0-100 from a z-score. At the user's own mean the score is 85, the same
 * point the old "ratio 1.0 = 85" mapping used, so a normal day reads the same
 * as before. A better-than-normal day climbs to 100 at +1 SD; a worse one
 * falls faster (60 at -1 SD, 35 at -2 SD, 0 at -3.4 SD) because a drop below
 * the range is the signal readiness exists to surface.
 */
export function zToScore(z: number, direction: Direction): number {
  const zd = direction === 'higher' ? z : -z;
  const score = zd >= 0 ? 85 + 15 * Math.min(zd, 1) : 85 + 25 * zd;
  return Math.min(100, Math.max(0, score));
}

/**
 * Score the latest day of `type` against the user's personal baseline.
 * Returns null when there is no reading at all.
 *
 * With some history but under MIN_BASELINE_DAYS days, falls back to the old
 * ratio against the mean of whatever days exist, and says so in the label;
 * with no history at all, a neutral 80.
 */
export function scoreAgainstBaseline(
  metrics: MetricLike[],
  type: string,
  opts: { direction: Direction; unit: string; log?: boolean; timezone?: string }
): BaselineScore | null {
  const series = dailySeries(metrics, type, opts.timezone);
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const value = latest.value;
  const shown = `${value.toFixed(0)}${opts.unit}`;
  const baseline = personalBaseline(series, latest.day, { log: opts.log });

  if (baseline) {
    const x = opts.log ? Math.log(value) : value;
    const z = (x - baseline.mu) / baseline.sd;
    const { mu: _mu, sd: _sd, ...range } = baseline;
    return {
      score: zToScore(z, opts.direction),
      label: `${shown} · normal ${range.low.toFixed(0)}–${range.high.toFixed(0)}`,
      value,
      day: latest.day,
      baseline: range,
    };
  }

  const history = windowBefore(series, latest.day);
  if (history.length === 0) {
    return { score: 80, label: `${shown} (No baseline)`, value, day: latest.day, baseline: null };
  }
  const avg = history.reduce((a, p) => a + p.value, 0) / history.length;
  const ratio = value / avg;
  const score = Math.min(100, Math.max(0, 85 * (opts.direction === 'higher' ? ratio : 1 / ratio)));
  const pct = (ratio - 1) * 100;
  return {
    score,
    label: `${shown} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%, ${history.length}/${MIN_BASELINE_DAYS}d baseline)`,
    value,
    day: latest.day,
    baseline: null,
  };
}
