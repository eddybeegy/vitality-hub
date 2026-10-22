/**
 * Data coverage calendar (roadmap: "Data coverage calendar").
 *
 * One series per source, one cell per day, so a feed that quietly stopped is visible
 * at a glance -- the stalled Apple Health *workouts* feed being the standing example:
 * its metrics arrive by the hundred thousand while its workouts have not moved since
 * 2026-10-13, which no single "last sync" line shows.
 *
 * Bands are computed PER SOURCE against that source's own median non-empty day, not
 * against a global number. Apple Health writes ~1,500 metric rows a day and Withings
 * writes three; both are healthy, and a shared threshold would paint one of them red
 * every day. `low` therefore means low *for this feed*.
 *
 * `rows` is a count, never a value: a day with rows is a day the feed delivered, which
 * is the only question this card answers. Whether those rows are any good is what the
 * freshness and sync-health widgets are for.
 */
import { addDays, toDateStr } from './dayWalk';

/** One (source, day) count, as grouped by the server. Days are 'YYYY-MM-DD' in the user's zone. */
export interface CoverageRow {
  source: string;
  day: string;
  rows: number | string;
}

export type CoverageBand = 'none' | 'low' | 'normal' | 'high';

export interface CoverageCell {
  day: string;
  rows: number;
  band: CoverageBand;
}

export interface CoverageSeries {
  source: string;
  /** Rows across the window. */
  total: number;
  /** Median of the non-empty days in the window -- the reference the bands use. */
  typical: number;
  days: CoverageCell[];
  /** Days in the window that received anything. */
  active_days: number;
  /** Most recent day with rows, or null when the feed delivered nothing all window. */
  last_day: string | null;
  /** Consecutive empty days ending at the last day of the window (so 0 = delivered today). */
  gap_days: number;
}

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 180;

/** Ratio of the median below which a day counts as `low`, and above which it counts as `high`. */
export const LOW_RATIO = 0.25;
export const HIGH_RATIO = 3;

/** The window as a list of days, oldest first, ending at `today`. */
export function dayWindow(today: string, days: number): string[] {
  const n = Math.max(1, Math.floor(days));
  const end = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(toDateStr(addDays(end, -i)));
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function bandFor(rows: number, typical: number): CoverageBand {
  if (rows <= 0) return 'none';
  // With no reference yet (a single day of data) anything that arrived is normal:
  // calling a feed's only day "low" would be an opinion, not a measurement.
  if (typical <= 0) return 'normal';
  if (rows < typical * LOW_RATIO) return 'low';
  if (rows > typical * HIGH_RATIO) return 'high';
  return 'normal';
}

/**
 * Shape grouped (source, day, rows) counts into one zero-filled series per source,
 * busiest source first. Rows outside the window are ignored rather than clamped --
 * a stray older row must not inflate the first cell.
 */
export function buildCoverage(rows: CoverageRow[], today: string, days = DEFAULT_DAYS): CoverageSeries[] {
  const window = dayWindow(today, days);
  const inWindow = new Set(window);
  const bySource = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const day = String(r.day ?? '').slice(0, 10);
    if (!inWindow.has(day)) continue;
    const count = Number(r.rows);
    if (!Number.isFinite(count) || count <= 0) continue;
    const source = String(r.source ?? '').trim() || 'unknown';
    if (!bySource.has(source)) bySource.set(source, new Map());
    const perDay = bySource.get(source)!;
    perDay.set(day, (perDay.get(day) || 0) + count);
  }

  const series: CoverageSeries[] = [];
  for (const [source, perDay] of bySource) {
    const counts = window.map(d => perDay.get(d) || 0);
    const typical = median(counts.filter(c => c > 0));
    const cells = window.map((day, i) => ({ day, rows: counts[i], band: bandFor(counts[i], typical) }));
    const lastIdx = counts.map((c, i) => (c > 0 ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    series.push({
      source,
      total: counts.reduce((a, b) => a + b, 0),
      typical,
      days: cells,
      active_days: counts.filter(c => c > 0).length,
      last_day: lastIdx === -1 ? null : window[lastIdx],
      gap_days: lastIdx === -1 ? window.length : window.length - 1 - lastIdx,
    });
  }

  return series.sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
}
