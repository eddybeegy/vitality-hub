/**
 * Adaptive TDEE: what the user actually burns, inferred from what they ate and
 * what the scale did, rather than from a formula or a watch.
 *
 * Energy balance over a window: intake - expenditure = stored energy change.
 * So expenditure = mean daily intake - (weight trend slope in kg/day * KCAL_PER_KG).
 * Eating 2,400 a day while the trend falls 0.25 kg a week gives
 * 2400 + (0.25 / 7) * 7700 = about 2,675 kcal/day.
 *
 * Choices that matter:
 * - The window is the WINDOW_DAYS complete days ending yesterday. Today's intake
 *   is still being logged, so including it would bias the estimate low.
 * - The weight trend is a least-squares line through every weigh-in in the
 *   window, so one heavy morning (salt, glycogen) barely moves it.
 * - A day with no intake logged is unknown, not zero, and is skipped. A day under
 *   MIN_LOGGED_KCAL is treated as a half-finished log and skipped too; counting it
 *   would make the user look like they burn far less than they do.
 * - Nothing is shown until there are MIN_INTAKE_DAYS logged days and
 *   MIN_WEIGH_INS weigh-ins spanning MIN_WEIGHT_SPAN_DAYS; with less, a single
 *   weigh-in swings the slope by hundreds of kcal.
 *
 * Input rows are the day-granularity rows of /api/metrics/aggregated, which has
 * already picked one source per (day, type) and put each reading on the right
 * local day (per-source timestamp conventions are handled server-side). All day
 * arithmetic is Date.UTC on a bare Y-M-D, so DST cannot move a day.
 */

export const WINDOW_DAYS = 28;
export const KCAL_PER_KG = 7700;
export const MIN_LOGGED_KCAL = 1000;
export const MIN_INTAKE_DAYS = 14;
export const MIN_WEIGH_INS = 4;
export const MIN_WEIGHT_SPAN_DAYS = 10;
export const MIN_APPLE_DAYS = 7;

export interface DailyValue {
  day: string;
  value: number;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface TdeeInputs {
  /** Daily total intake (kcal), one row per logged day. */
  intake: DailyValue[];
  /** Daily mean weight (kg). */
  weight: DailyValue[];
  /** Daily total Apple active energy (kcal). */
  activeEnergy?: DailyValue[];
  /** Daily total Apple basal (resting) energy (kcal). */
  basalEnergy?: DailyValue[];
  /** Today in the user's zone, 'YYYY-MM-DD'. The window ends the day before. */
  today: string;
}

export interface TdeeWindow {
  start: string;
  end: string;
}

export interface TdeeEstimate {
  status: 'ok';
  window: TdeeWindow;
  /** Estimated expenditure, kcal/day. */
  tdee: number;
  /** Mean intake over the logged days, kcal/day. */
  avgIntake: number;
  /** Weight trend, kg per week (negative = losing). */
  weeklyChangeKg: number;
  /** Trend weight at the end of the window, kg. */
  trendWeightKg: number;
  intakeDays: number;
  skippedLowDays: number;
  weighIns: number;
  confidence: Confidence;
  /** Mean Apple active + basal over days with both, or null with too few days. */
  apple: { tdee: number; days: number } | null;
}

export interface TdeeInsufficient {
  status: 'insufficient';
  window: TdeeWindow;
  intakeDays: number;
  skippedLowDays: number;
  weighIns: number;
  weightSpanDays: number;
  /** Plain-language reasons, one per unmet requirement. */
  missing: string[];
}

export type TdeeResult = TdeeEstimate | TdeeInsufficient;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** The WINDOW_DAYS complete days ending the day before `today`. */
export function tdeeWindow(today: string, windowDays = WINDOW_DAYS): TdeeWindow {
  const end = dayNumber(today) - 1;
  return { start: dayString(end - windowDays + 1), end: dayString(end) };
}

/** Rows inside [start, end] with a finite positive value; duplicate days keep the last. */
function inWindow(rows: DailyValue[] | undefined, w: TdeeWindow): Map<number, number> {
  const lo = dayNumber(w.start);
  const hi = dayNumber(w.end);
  const out = new Map<number, number>();
  for (const r of rows || []) {
    if (!r || typeof r.day !== 'string') continue;
    const v = Number(r.value);
    if (!Number.isFinite(v) || v <= 0) continue;
    const n = dayNumber(r.day);
    if (!Number.isFinite(n) || n < lo || n > hi) continue;
    out.set(n, v);
  }
  return out;
}

/** Least-squares slope and the fitted value at `atX`. Needs two distinct x values. */
export function linearFit(points: Array<[number, number]>, atX: number): { slope: number; valueAt: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, valueAt: my + slope * (atX - mx) };
}

function confidenceFor(intakeDays: number, weighIns: number, windowDays: number): Confidence {
  if (intakeDays >= windowDays * 0.85 && weighIns >= windowDays * 0.4) return 'high';
  if (intakeDays >= windowDays * 0.65 && weighIns >= windowDays * 0.25) return 'medium';
  return 'low';
}

export function estimateTdee(input: TdeeInputs, windowDays = WINDOW_DAYS): TdeeResult {
  const window = tdeeWindow(input.today, windowDays);

  const intakeAll = inWindow(input.intake, window);
  const intake = [...intakeAll.values()].filter(v => v >= MIN_LOGGED_KCAL);
  const skippedLowDays = intakeAll.size - intake.length;

  const weights = inWindow(input.weight, window);
  const weightDays = [...weights.keys()];
  const weightSpanDays = weightDays.length ? Math.max(...weightDays) - Math.min(...weightDays) : 0;

  const missing: string[] = [];
  if (intake.length < MIN_INTAKE_DAYS) {
    missing.push(`${MIN_INTAKE_DAYS - intake.length} more days of logged food (${intake.length} of ${MIN_INTAKE_DAYS})`);
  }
  if (weights.size < MIN_WEIGH_INS) {
    missing.push(`${MIN_WEIGH_INS - weights.size} more weigh-ins (${weights.size} of ${MIN_WEIGH_INS})`);
  } else if (weightSpanDays < MIN_WEIGHT_SPAN_DAYS) {
    missing.push(`weigh-ins spread over at least ${MIN_WEIGHT_SPAN_DAYS} days (currently ${weightSpanDays})`);
  }
  if (missing.length) {
    return { status: 'insufficient', window, intakeDays: intake.length, skippedLowDays, weighIns: weights.size, weightSpanDays, missing };
  }

  const avgIntake = intake.reduce((s, v) => s + v, 0) / intake.length;
  const fit = linearFit([...weights.entries()], dayNumber(window.end));
  const tdee = avgIntake - fit.slope * KCAL_PER_KG;

  const active = inWindow(input.activeEnergy, window);
  const basal = inWindow(input.basalEnergy, window);
  const appleDays: number[] = [];
  for (const [n, a] of active) {
    const b = basal.get(n);
    if (b !== undefined) appleDays.push(a + b);
  }
  const apple = appleDays.length >= MIN_APPLE_DAYS
    ? { tdee: appleDays.reduce((s, v) => s + v, 0) / appleDays.length, days: appleDays.length }
    : null;

  return {
    status: 'ok',
    window,
    tdee,
    avgIntake,
    weeklyChangeKg: fit.slope * 7,
    trendWeightKg: fit.valueAt,
    intakeDays: intake.length,
    skippedLowDays,
    weighIns: weights.size,
    confidence: confidenceFor(intake.length, weights.size, windowDays),
    apple,
  };
}

/** Pull one canonical type out of /api/metrics/aggregated day rows. */
export function seriesOf(rows: any[] | null | undefined, key: string): DailyValue[] {
  const out: DailyValue[] = [];
  for (const r of rows || []) {
    if (!r || typeof r.date !== 'string' || r[key] === undefined || r[key] === null) continue;
    out.push({ day: r.date, value: Number(r[key]) });
  }
  return out;
}
