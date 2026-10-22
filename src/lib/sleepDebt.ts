/**
 * Sleep debt (roadmap: "Sleep debt and timing").
 *
 * The running shortfall against the user's sleep target over the last
 * WINDOW_NIGHTS calendar days. A long night pays back a short one (net, not a sum
 * of shortfalls), but the total never goes below zero: banking sleep in advance
 * does not work, so a surplus is reported as "no debt", never as credit.
 *
 * Nights with no reading are left out rather than counted as zero hours: a watch
 * left on the charger is not a night without sleep. `nights` says how many were
 * actually measured so the card can show the coverage.
 *
 * Days are the bare YYYY-MM-DD keys getSleepDurationData() already produces in
 * the user's zone; window arithmetic is Date.UTC on those keys via addDays().
 */
import { addDays } from './dayTags';

export const WINDOW_NIGHTS = 14;
export const DEFAULT_TARGET_HOURS = 8;
/** Under this much debt is ordinary night-to-night variation. */
export const DEBT_OK_HOURS = 2;
export const DEBT_HIGH_HOURS = 5;
/** Over how many nights the payback suggestion spreads the debt. */
const PAYBACK_NIGHTS = 7;

export type DebtLevel = 'ok' | 'some' | 'high';

export interface SleepDebt {
  /** Net shortfall in hours, floored at 0. */
  debtHours: number;
  /** Mean nightly hours over the measured nights. */
  averageHours: number;
  targetHours: number;
  /** Measured nights in the window, and nights below target. */
  nights: number;
  shortNights: number;
  windowNights: number;
  level: DebtLevel;
  /** Extra minutes a night for a week to clear the debt, 0 with no debt. */
  paybackMinutesPerNight: number;
}

/** A positive, finite sleep target in hours, or the 8h default. */
export function sleepTargetHours(targets: { type: string; value: unknown }[] = []): number {
  const raw = Number(targets.find(t => t.type === 'sleep')?.value);
  return Number.isFinite(raw) && raw > 0 && raw <= 16 ? raw : DEFAULT_TARGET_HOURS;
}

export function computeSleepDebt(
  nightly: { date: string; hours: number }[],
  targetHours: number,
  today: string,
  windowNights = WINDOW_NIGHTS
): SleepDebt | null {
  const from = addDays(today, -(windowNights - 1));
  const inWindow = nightly.filter(n => n.date >= from && n.date <= today && Number.isFinite(n.hours) && n.hours > 0);
  if (inWindow.length === 0) return null;

  const net = inWindow.reduce((sum, n) => sum + (targetHours - n.hours), 0);
  const debtHours = Math.max(0, net);
  const level: DebtLevel = debtHours < DEBT_OK_HOURS ? 'ok' : debtHours < DEBT_HIGH_HOURS ? 'some' : 'high';
  return {
    debtHours,
    averageHours: inWindow.reduce((s, n) => s + n.hours, 0) / inWindow.length,
    targetHours,
    nights: inWindow.length,
    shortNights: inWindow.filter(n => n.hours < targetHours).length,
    windowNights,
    level,
    paybackMinutesPerNight: debtHours > 0 ? Math.ceil((debtHours * 60) / PAYBACK_NIGHTS / 5) * 5 : 0,
  };
}

/** "4h 30m" from hours, rounded to 5 minutes. */
export function formatHours(hours: number): string {
  const mins = Math.round((hours * 60) / 5) * 5;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}
