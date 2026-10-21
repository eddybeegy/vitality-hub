// Readiness history and "why it moved" (item 76).
//
// The readiness score used to be recomputed on every load and never kept, so
// there was no way to see how it had moved or why. Two pieces fix that:
//
// - Any past day can be scored "as of" that day (calculateReadinessScore's
//   asOf), so a history fills in at once from data already stored.
// - The server keeps one snapshot per *finished* calendar day in the user's
//   zone (readiness_snapshots), so a later settings change or baseline shift
//   does not rewrite what a past morning said. Today is always computed live.
//
// Days are bare 'YYYY-MM-DD' strings in the user's zone, never timestamps, and
// all arithmetic is Date.UTC on that string (addDays from dayTags.ts).
//
// Pure functions, shared by server.ts (history route, AI context) and the
// dashboard card.

import { calculateReadinessScore, type ReadinessResult } from './readiness';
import { metricDay } from './baselines';
import { addDays } from './dayTags';

/**
 * Bump when the score's definition changes. Stored snapshots carry the version
 * they were computed with, and the server recomputes any row whose version is
 * not this one, so a scoring fix never leaves stale history behind.
 */
export const READINESS_ALGO_VERSION = 1;

export const DEFAULT_HISTORY_DAYS = 30;
export const MAX_HISTORY_DAYS = 180;

/** A readiness component as stored: no baseline object, just what a chart needs. */
export interface SnapshotComponent {
  name: string;
  score: number;
  weight: number;
  label: string;
}

export interface ReadinessSnapshot {
  date: string;
  score: number;
  components: SnapshotComponent[];
}

/**
 * Inputs that make a day's score its own. A day with none of these carries
 * yesterday's HRV and sleep forward unchanged, so scoring it would only repeat
 * the previous day; history leaves such days as gaps instead.
 */
const FRESH_INPUT_TYPES = new Set(['hrv', 'resting_heart_rate', 'sleep', 'sleep_total', 'sleep_analysis', 'sleep_core', 'sleep_deep', 'sleep_rem']);

interface MetricLike {
  type: string;
  value: number;
  timestamp: string;
}

export function toSnapshot(date: string, r: ReadinessResult): ReadinessSnapshot {
  return {
    date,
    score: r.score,
    components: r.components.map(c => ({
      name: c.name,
      score: Math.round(c.score * 10) / 10,
      weight: c.weight,
      label: c.label,
    })),
  };
}

/** Days from `start` through `end` inclusive, oldest first. */
export function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Score each of `days` as of that day. Days with no fresh HRV, resting-HR or
 * sleep reading of their own are skipped (see FRESH_INPUT_TYPES).
 */
export function computeReadinessHistory(
  metrics: MetricLike[],
  targets: any[],
  timezone: string,
  days: string[]
): ReadinessSnapshot[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const freshDays = new Set<string>();
  for (const m of metrics) {
    if (!FRESH_INPUT_TYPES.has(m.type) || !(Number(m.value) > 0)) continue;
    const day = metricDay(String(m.timestamp ?? ''), formatter);
    // Sleep is dated by the night it started, so it belongs to the next morning.
    if (day) freshDays.add(m.type.startsWith('sleep') ? addDays(day, 1) : day);
  }
  const out: ReadinessSnapshot[] = [];
  for (const day of days) {
    if (!freshDays.has(day)) continue;
    const r = calculateReadinessScore(metrics, targets, timezone, day);
    if (r) out.push(toSnapshot(day, r));
  }
  return out;
}

export interface ComponentChange {
  name: string;
  /** Change in this component's weighted contribution to the total, in score points. */
  delta: number;
}

export interface ReadinessChange {
  /** Day compared against. */
  since: string;
  delta: number;
  /** Every component's contribution change, largest movement first. */
  components: ComponentChange[];
  /** The component that moved the total most, or null when nothing moved. */
  driver: ComponentChange | null;
  summary: string;
}

/** Below this the total is "steady" and no driver is named. */
const STEADY_POINTS = 2;

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

function sinceLabel(since: string, today: string): string {
  if (addDays(today, -1) === since) return 'yesterday';
  const [y, m, d] = since.split('-').map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  return label;
}

/**
 * Why today's score differs from `prev`'s: each component's change in weighted
 * contribution (score x weight), so the deltas add up to the change in the total
 * up to rounding. A component present on only one of the two days (resting HR
 * appearing or dropping out, which also reweights the rest) counts as 0 on the
 * other day.
 */
export function explainChange(today: ReadinessSnapshot, prev: ReadinessSnapshot): ReadinessChange {
  const contribution = (s: ReadinessSnapshot) =>
    new Map(s.components.map(c => [c.name, c.score * c.weight]));
  const now = contribution(today);
  const before = contribution(prev);
  const names = [...new Set([...now.keys(), ...before.keys()])];
  const components = names
    .map(name => ({ name, delta: Math.round((now.get(name) ?? 0) - (before.get(name) ?? 0)) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const delta = today.score - prev.score;
  const vs = sinceLabel(prev.date, today.date);
  const top = components[0];
  const driver = top && top.delta !== 0 && Math.abs(delta) >= STEADY_POINTS ? top : null;

  let summary: string;
  if (Math.abs(delta) < STEADY_POINTS) {
    summary = `Steady since ${vs}`;
  } else {
    summary = `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} since ${vs}`;
    if (driver) summary += `, mostly ${driver.name} (${signed(driver.delta)})`;
  }
  return { since: prev.date, delta, components, driver, summary };
}

/** The latest snapshot dated before `today`, or null. `history` may be in any order. */
export function previousSnapshot(history: ReadinessSnapshot[], today: string): ReadinessSnapshot | null {
  let best: ReadinessSnapshot | null = null;
  for (const s of history) {
    if (s.date < today && (!best || s.date > best.date)) best = s;
  }
  return best;
}

/** Compact rows for the AI context: date, score and each component's score. */
export function historyForAIContext(history: ReadinessSnapshot[]): Array<Record<string, number | string>> {
  return history.map(s => {
    const row: Record<string, number | string> = { date: s.date, score: s.score };
    for (const c of s.components) row[c.name.toLowerCase().replace(/[^a-z]+/g, '_')] = Math.round(c.score);
    return row;
  });
}

/** Parse a stored components column; anything malformed reads as no components. */
export function parseStoredComponents(raw: unknown): SnapshotComponent[] {
  if (typeof raw !== 'string') return Array.isArray(raw) ? (raw as SnapshotComponent[]) : [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
