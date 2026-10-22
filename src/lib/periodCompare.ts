/**
 * Period comparison for charts (roadmap: "Compare this period with the last one").
 *
 * With the toggle on, a chart showing the last N days also shows the N days
 * before that, shifted forward by N days so both periods share one x-axis: the
 * first day of the previous period sits on the first day of the current one.
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

/** The previous window for a current window starting on `currentFrom`: [from, to). */
export function previousWindow(currentFrom: string, days: number): { from: string; to: string } {
  return { from: addDays(currentFrom, -days), to: currentFrom };
}

/**
 * Rows of the previous window, each moved forward by `days` and given a bare
 * day as its date. `dayOf` turns a row's date into its local day ('' to skip).
 */
export function shiftPrevious<T extends { date?: unknown }>(
  rows: T[],
  dayOf: (row: T) => string,
  currentFrom: string,
  days: number,
): Array<T & { date: string }> {
  const { from, to } = previousWindow(currentFrom, days);
  const out: Array<T & { date: string }> = [];
  for (const row of rows) {
    const day = dayOf(row);
    if (!day || day < from || day >= to) continue;
    out.push({ ...row, date: addDays(day, days) });
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
