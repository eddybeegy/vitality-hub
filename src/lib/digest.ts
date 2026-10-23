/**
 * Weekly / monthly digest (roadmap: "A Sunday summary of training, sleep, intake
 * and weight against the previous week, delivered by the same channel as alerts").
 *
 * Phone alerts are the last roadmap item, so there is no push channel yet: this
 * computes the digest and `GET /api/digest` plus the `get_digest` MCP tool serve
 * it. Every line carries both numbers and a ready-made sentence, so whatever
 * delivers it later -- push, email, an agent -- does not have to re-derive the
 * wording and risk two versions of "down 8%" that disagree.
 *
 * Pure: the caller supplies `today` as a bare local day and the rows. No Date.now
 * in here, which is what makes a digest for an arbitrary week testable.
 *
 * Windows are TRAILING and inclusive of `today`: week = the 7 days ending today,
 * previous = the 7 before that. Not ISO Mon-Sun, because the dashboard's existing
 * "This Week vs Last Week" widget is trailing too and two different definitions of
 * "this week" on one screen is worse than either definition alone.
 *
 * Day arithmetic goes through addDays (Date.UTC on a bare day), so a DST change
 * inside a window cannot shift a boundary by an hour and drop a day.
 */
import { addDays } from './dayTags.js';
import { REST_VARIANTS, isTrainingWorkout } from './dayTargets.js';
import { normaliseTargetValue } from './targets.js';
import type { DailyRow } from './metricAggregation.js';

export type DigestPeriod = 'week' | 'month';

export const PERIOD_DAYS: Record<DigestPeriod, number> = { week: 7, month: 30 };

export const isDigestPeriod = (v: unknown): v is DigestPeriod =>
  v === 'week' || v === 'month';

export interface DigestWorkout {
  timestamp: string | Date;
  duration?: number | null;
  volume?: number | null;
  name?: string | null;
  source?: string | null;
}

export interface DigestTarget {
  type: string;
  value: number | string | null;
  unit?: string | null;
}

export interface DigestInput {
  period: DigestPeriod;
  /** Bare YYYY-MM-DD in the user's zone -- the last day of the current window. */
  today: string;
  timezone?: string;
  /** Output of aggregateDailyValues: one row per local day, any order. */
  daily: DailyRow[];
  workouts: DigestWorkout[];
  targets?: DigestTarget[];
}

export interface DigestLine {
  key: string;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  /** Percent change vs the previous window, null when either side is missing or 0. */
  changePct: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  /** Days in the current window that contributed a value. */
  daysWithData: number;
  target: number | null;
  text: string;
}

export interface DigestSection {
  key: 'training' | 'sleep' | 'intake' | 'body' | 'activity';
  label: string;
  lines: DigestLine[];
}

export interface Digest {
  period: DigestPeriod;
  days: number;
  timezone: string | null;
  generatedFor: string;
  current: { from: string; to: string };
  previous: { from: string; to: string };
  sections: DigestSection[];
  headlines: string[];
}

type Agg = 'avg' | 'sum' | 'latest';

interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  type: string;
  agg: Agg;
  dp: number;
  /** Divide the stored value, e.g. sleep seconds -> hours. */
  scale?: number;
  section: DigestSection['key'];
  /** targets.type that sets this line's target, when there is one. */
  targetType?: string;
}

/**
 * Sleep is stored in SECONDS whatever `metrics.unit` claims (see src/mcp/tools.ts),
 * hence the fixed /3600 rather than trusting the label.
 */
const METRIC_SPECS: MetricSpec[] = [
  { key: 'sleep_hours', label: 'Sleep', unit: 'h', type: 'sleep_total', agg: 'avg', dp: 2, scale: 3600, section: 'sleep' },
  { key: 'sleep_deep_hours', label: 'Deep sleep', unit: 'h', type: 'sleep_deep', agg: 'avg', dp: 2, scale: 3600, section: 'sleep' },
  // The target is stored as `calories`, not `calories_in` (`calories_in` is the
  // METRIC). This asked for a target type that has never existed in `targets`, so
  // the digest's intake line silently carried no target at all.
  { key: 'calories_in', label: 'Calories in', unit: 'kcal', type: 'calories_in', agg: 'avg', dp: 0, section: 'intake', targetType: 'calories' },
  { key: 'protein', label: 'Protein', unit: 'g', type: 'protein', agg: 'avg', dp: 0, section: 'intake', targetType: 'protein' },
  { key: 'weight', label: 'Weight', unit: 'kg', type: 'weight', agg: 'avg', dp: 2, section: 'body', targetType: 'weight' },
  { key: 'weight_latest', label: 'Latest weight', unit: 'kg', type: 'weight', agg: 'latest', dp: 2, section: 'body' },
  { key: 'body_fat', label: 'Body fat', unit: '%', type: 'body_fat', agg: 'avg', dp: 1, section: 'body' },
  { key: 'steps', label: 'Steps', unit: '/day', type: 'steps', agg: 'avg', dp: 0, section: 'activity', targetType: 'steps' },
  { key: 'active_energy', label: 'Active energy', unit: 'kcal/day', type: 'active_energy', agg: 'avg', dp: 0, section: 'activity' },
  { key: 'resting_heart_rate', label: 'Resting HR', unit: 'bpm', type: 'resting_heart_rate', agg: 'avg', dp: 0, section: 'activity' },
];

const SECTION_LABELS: Record<DigestSection['key'], string> = {
  training: 'Training',
  sleep: 'Sleep',
  intake: 'Intake',
  body: 'Body',
  activity: 'Activity',
};

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

const dayOf = (ts: string | Date): string =>
  (ts instanceof Date ? ts.toISOString() : String(ts)).slice(0, 10);

/** Percent change, null when there is nothing to compare against. */
export function changeOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

const directionOf = (pct: number | null): DigestLine['direction'] => {
  if (pct === null) return null;
  if (Math.abs(pct) < 1) return 'flat';
  return pct > 0 ? 'up' : 'down';
};

const fmt = (n: number, dp: number): string =>
  dp === 0 ? Math.round(n).toLocaleString('en-GB') : n.toFixed(dp);

/** "4 sessions (prev 3, +33%)" -- one sentence a delivery channel can use as-is. */
function sentence(label: string, unit: string, current: number | null, previous: number | null, pct: number | null, dp: number): string {
  if (current === null) return `${label}: no data`;
  const head = `${label}: ${fmt(current, dp)}${unit ? ' ' + unit : ''}`;
  if (previous === null) return `${head} (no previous period)`;
  const change = pct === null ? '' : `, ${pct > 0 ? '+' : ''}${pct}%`;
  return `${head} (prev ${fmt(previous, dp)}${change})`;
}

function windowRows(daily: DailyRow[], from: string, to: string): DailyRow[] {
  return daily.filter((r) => typeof r.date === 'string' && r.date >= from && r.date <= to);
}

/** Values of one metric type across a window, newest day first. */
function seriesOf(rows: DailyRow[], spec: MetricSpec): Array<{ date: string; value: number }> {
  const out: Array<{ date: string; value: number }> = [];
  for (const row of rows) {
    const raw = row[spec.type];
    if (raw === undefined || raw === null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date: row.date, value: spec.scale ? value / spec.scale : value });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function aggregate(series: Array<{ date: string; value: number }>, agg: Agg): number | null {
  if (!series.length) return null;
  if (agg === 'latest') return series[0].value;
  const sum = series.reduce((s, p) => s + p.value, 0);
  return agg === 'sum' ? sum : sum / series.length;
}

function targetFor(targets: DigestTarget[] | undefined, type: string | undefined): number | null {
  if (!targets || !type) return null;
  const hit = targets.find((t) => t.type === type);
  if (!hit) return null;
  // 0 is how the API stores "unset" -- server.ts validates value as a finite
  // number and seeds new users with 0 rows -- so it must not become a target of
  // zero. src/lib/targets.ts owns that convention and the whole UI already goes
  // through it; this was the one path that only rejected null, which put
  // `target: 0` for steps and weight into the /api/digest and get_digest payloads.
  return normaliseTargetValue(hit.value);
}

/**
 * The target to compare a windowed average against. For a type with a rest-day
 * variant (item 88: `calories_rest`, `carbs_rest`) the applicable target differs
 * day to day, so the comparison is the mean of each day's own target -- measuring
 * a 7-day average against the training-day number alone reads as a deficit on any
 * week that contains a rest day.
 *
 * Days come from this module's own UTC `dayOf`, not from `dayTargets.trainedOn`'s
 * zoned day: a digest's windows are already UTC-sliced, and two day conventions in
 * one digest is worse than one imperfect one. The predicate itself is shared
 * (`isTrainingWorkout`) so the 20-minute threshold and the walk test cannot drift.
 *
 * The Nutrition tab's manual training/rest override lives in the browser's
 * localStorage and is not visible here, so an overridden day falls back to what
 * the workout rows say.
 */
function windowTarget(
  spec: MetricSpec,
  targets: DigestTarget[] | undefined,
  workouts: DigestWorkout[],
  window: { from: string; to: string },
): number | null {
  const base = targetFor(targets, spec.targetType);
  const variant = spec.targetType ? REST_VARIANTS[spec.targetType] : undefined;
  if (base === null || !variant) return base;
  const rest = targetFor(targets, variant);
  if (rest === null) return base;

  const trainingDays = new Set(
    workouts.filter(w => isTrainingWorkout({ name: w.name ?? undefined, duration: w.duration ?? undefined }))
      .map(w => dayOf(w.timestamp)),
  );
  let sum = 0;
  let n = 0;
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) {
    sum += trainingDays.has(day) ? base : rest;
    n += 1;
  }
  return n === 0 ? base : round(sum / n, spec.dp);
}

function line(
  spec: MetricSpec,
  current: DailyRow[],
  previous: DailyRow[],
  targets: DigestTarget[] | undefined,
  workouts: DigestWorkout[],
  window: { from: string; to: string },
): DigestLine {
  const cur = seriesOf(current, spec);
  const prev = seriesOf(previous, spec);
  const curValue = aggregate(cur, spec.agg);
  const prevValue = aggregate(prev, spec.agg);
  const rounded = curValue === null ? null : round(curValue, spec.dp);
  const prevRounded = prevValue === null ? null : round(prevValue, spec.dp);
  const pct = changeOf(rounded, prevRounded);
  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    current: rounded,
    previous: prevRounded,
    changePct: pct,
    direction: directionOf(pct),
    daysWithData: cur.length,
    target: windowTarget(spec, targets, workouts, window),
    text: sentence(spec.label, spec.unit, rounded, prevRounded, pct, spec.dp),
  };
}

/** Sessions, minutes and volume from the workout rows in each window. */
function trainingLines(workouts: DigestWorkout[], current: { from: string; to: string }, previous: { from: string; to: string }): DigestLine[] {
  const inWindow = (w: { from: string; to: string }) =>
    workouts.filter((x) => {
      const day = dayOf(x.timestamp);
      return day >= w.from && day <= w.to;
    });
  const cur = inWindow(current);
  const prev = inWindow(previous);
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  // `duration` is already MINUTES in this schema (src/mcp/tools.ts has the receipts).
  const totals = (list: DigestWorkout[]) => ({
    sessions: list.length,
    minutes: list.reduce((s, w) => s + num(w.duration), 0),
    volume: list.reduce((s, w) => s + num(w.volume), 0),
    days: new Set(list.map((w) => dayOf(w.timestamp))).size,
  });
  const c = totals(cur);
  const p = totals(prev);

  const make = (key: string, label: string, unit: string, cv: number, pv: number, dp: number): DigestLine => {
    // A previous window with no sessions gives pv = 0, and changeOf returns null
    // for a 0 baseline rather than an infinite percentage.
    const pct = changeOf(round(cv, dp), round(pv, dp));
    return {
      key, label, unit,
      current: round(cv, dp),
      previous: round(pv, dp),
      changePct: pct,
      direction: directionOf(pct),
      daysWithData: c.days,
      target: null,
      text: sentence(label, unit, round(cv, dp), round(pv, dp), pct, dp),
    };
  };

  return [
    make('sessions', 'Sessions', '', c.sessions, p.sessions, 0),
    make('training_minutes', 'Training time', 'min', c.minutes, p.minutes, 0),
    make('training_volume', 'Volume', 'kg', c.volume, p.volume, 0),
  ];
}

/**
 * Up to five headlines: the biggest movers by absolute percent change, plus one
 * combined line for anything with no data at all. A line with no previous value
 * cannot be a mover -- it has no change to be big.
 *
 * The missing metrics are one line rather than one line each because on a sparse
 * week there are more silent metrics than moving ones, and five "no data" bullets
 * would push every real finding out of the digest.
 */
function headlinesOf(sections: DigestSection[], days: number): string[] {
  const lines = sections.flatMap((s) => s.lines);
  const movers = lines
    .filter((l) => l.changePct !== null && Math.abs(l.changePct) >= 5)
    .sort((a, b) => Math.abs(b.changePct as number) - Math.abs(a.changePct as number))
    .map((l) => l.text);
  // weight_latest is the same metric as weight, so it would say "no data" twice.
  const missing = lines.filter((l) => l.current === null && l.key !== 'weight_latest').map((l) => l.label);
  const quiet = missing.length ? [`Nothing logged in the last ${days} days for: ${missing.join(', ')}`] : [];
  const out = [...movers.slice(0, quiet.length ? 4 : 5), ...quiet];
  return out.length ? out : ['Nothing moved more than 5% against the previous period.'];
}

export function buildDigest(input: DigestInput): Digest {
  const days = PERIOD_DAYS[input.period];
  const current = { from: addDays(input.today, -(days - 1)), to: input.today };
  const previous = { from: addDays(current.from, -days), to: addDays(current.from, -1) };

  const curRows = windowRows(input.daily, current.from, current.to);
  const prevRows = windowRows(input.daily, previous.from, previous.to);

  const sections: DigestSection[] = [
    { key: 'training', label: SECTION_LABELS.training, lines: trainingLines(input.workouts || [], current, previous) },
  ];
  for (const key of ['sleep', 'intake', 'body', 'activity'] as const) {
    const lines = METRIC_SPECS.filter((s) => s.section === key)
      .map((s) => line(s, curRows, prevRows, input.targets, input.workouts || [], current));
    sections.push({ key, label: SECTION_LABELS[key], lines });
  }

  return {
    period: input.period,
    days,
    timezone: input.timezone || null,
    generatedFor: input.today,
    current,
    previous,
    sections,
    headlines: headlinesOf(sections, days),
  };
}

/** Plain-text rendering, for whatever eventually delivers this. */
export function renderDigestText(digest: Digest): string {
  const title = digest.period === 'week' ? 'Weekly digest' : 'Monthly digest';
  const out: string[] = [`${title} — ${digest.current.from} to ${digest.current.to}`, ''];
  for (const h of digest.headlines) out.push(`• ${h}`);
  for (const section of digest.sections) {
    out.push('', section.label);
    for (const l of section.lines) out.push(`  ${l.text}`);
  }
  return out.join('\n');
}
