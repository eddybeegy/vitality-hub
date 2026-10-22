/**
 * Period comparison for charts (roadmap: "Compare this period with the last one").
 *
 * With the toggle on, a chart showing the last N days also shows an EARLIER N-day
 * window, shifted forward onto the current one so both share a single x-axis: the
 * first day of the baseline window sits on the first day of the current one.
 *
 * Which earlier window is the "baseline" is chosen by the user. The immediately
 * preceding N days is the default, but "the same N days a month ago" and "a year
 * ago" answer a different question -- a 7-day step average against last week says
 * whether this week was busy, against last year it says whether the year changed.
 * The offset is a separate number from the window length for exactly that reason.
 *
 * Days are bare YYYY-MM-DD in the user's zone. Shifting uses addDays (Date.UTC
 * on a bare day), so a DST change inside either window cannot move a point.
 * '1d' and 'all' have no meaningful "previous" and are not comparable.
 */
import { addDays } from './dayTags';

export type ComparablePeriod = '7d' | '30d' | '90d' | '1y';

const DAYS: Record<ComparablePeriod, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

/** Length of the period in days, or null when it cannot be compared. */
export function periodDays(period: string): number | null {
  return (DAYS as Record<string, number>)[period] ?? null;
}

/** Baseline choices offered in the UI, in order. */
export const BASELINES = [
  { key: 'prev', label: 'vs prev', days: 0, title: 'Compare with the period of the same length immediately before this one' },
  { key: 'month', label: 'vs 1mo', days: 30, title: 'Compare with the same length window 30 days earlier' },
  { key: 'year', label: 'vs 1yr', days: 365, title: 'Compare with the same length window a year earlier' },
] as const;

export type BaselineKey = typeof BASELINES[number]['key'];

/**
 * How far back the baseline window starts, in days, or null when that baseline is
 * not offered for this period length.
 *
 * An offset shorter than the window would make the baseline overlap the current
 * period -- a 90-day chart "vs 1mo" would compare two windows sharing 60 days and
 * report a change that is mostly the data compared against itself. Rather than
 * silently clamping it to something the label no longer describes, that combination
 * is not offered at all: `baselineOffset('month', 90)` is null and the UI omits
 * the button.
 */
export function baselineOffset(key: BaselineKey, days: number): number | null {
  const baseline = BASELINES.find(b => b.key === key);
  if (!baseline) return null;
  if (baseline.days === 0) return days;             // "prev" is always adjacent
  return baseline.days >= days ? baseline.days : null;
}

/** The baselines that are meaningful for a window of `days` days. */
export function availableBaselines(days: number): BaselineKey[] {
  return BASELINES.filter(b => baselineOffset(b.key, days) !== null).map(b => b.key);
}

/**
 * The baseline window for a current window starting on `currentFrom`: [from, to).
 * `offset` defaults to the window length, which is the adjacent previous period.
 */
export function previousWindow(currentFrom: string, days: number, offset: number = days): { from: string; to: string } {
  const from = addDays(currentFrom, -offset);
  return { from, to: addDays(from, days) };
}

/**
 * Rows of the baseline window, each moved forward by `offset` and given a bare day
 * as its date. `dayOf` turns a row's date into its local day ('' to skip).
 *
 * Rows are shifted by the OFFSET, not by the window length: with a 7-day window a
 * year ago, the two differ, and shifting by the length would land the baseline 358
 * days away from the current period instead of on top of it.
 */
export function shiftPrevious<T extends { date?: unknown }>(
  rows: T[],
  dayOf: (row: T) => string,
  currentFrom: string,
  days: number,
  offset: number = days,
): Array<T & { date: string }> {
  const { from, to } = previousWindow(currentFrom, days, offset);
  const out: Array<T & { date: string }> = [];
  for (const row of rows) {
    const day = dayOf(row);
    if (!day || day < from || day >= to) continue;
    out.push({ ...row, date: addDays(day, offset) });
  }
  return out;
}

/**
 * Put the previous period's value for each bucket on the current rows under
 * `prevKey`. A bucket only the previous period has is added, so the dashed line
 * stays continuous across a gap in the current data. Sorted by date.
 */
export function mergePrevious(
  current: Array<Record<string, any>>,
  previous: Array<Record<string, any>>,
  valueKey: string,
  prevKey: string,
): Array<Record<string, any>> {
  const byDate = new Map<string, Record<string, any>>();
  for (const row of current) byDate.set(row.date, { ...row });
  for (const row of previous) {
    const v = row[valueKey];
    if (v == null || Array.isArray(v)) continue;
    const target = byDate.get(row.date) ?? { date: row.date };
    target[prevKey] = v;
    byDate.set(row.date, target);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Percentage change from previous to current, or null when it is not meaningful. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** "+4.2%" / "-0.8%" / "0%". */
export function formatChange(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  if (r === 0) return '0%';
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`;
}
