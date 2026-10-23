/**
 * Targets that adjust themselves, automatically (item 97).
 *
 * Item 73 inferred the adaptive TDEE, `adaptiveTargets.ts` turned it into a
 * suggested calorie and protein target, and #77 put an Apply button on it. This
 * is the last step: once a week, with no button pressed, write the suggestion
 * into Targets.
 *
 * It ships OFF. Automatically rewriting a number the user set by hand is the
 * kind of change that has to be asked for, so `auto_targets_enabled` defaults to
 * 0 and he turns it on in Settings -- the same shape as the phone alerts (item 95).
 *
 * The decision is all here, as a pure function, because the interesting part is
 * the refusals rather than the arithmetic:
 *
 * - **Weekly, on Monday.** A target that moves daily is noise: the TDEE window is
 *   28 days, so consecutive days differ by a rounding step and the user would
 *   watch their target drift for no reason. MIN_DAYS_BETWEEN is a day count
 *   rather than an ISO week so a run that slips past midnight cannot double-apply.
 * - **Never on low confidence.** `estimateTdee` already says when it is guessing;
 *   applying a guess to a real target is worse than applying nothing. Same
 *   refuse-rather-than-guess rule as `progressionPlan.ts`.
 * - **Capped movement.** A bad week of logging (a few days of 400 kcal, a salt-heavy
 *   weigh-in) can move the estimate hundreds of kcal. Past `maxChangeKcal` the
 *   decision refuses and says so rather than applying it, and keeps refusing until
 *   the estimate settles or the user presses Apply himself. A silent 600 kcal cut
 *   is the failure mode this exists to prevent.
 * - **Both targets are capped.** Calories and protein each have their own limit. The
 *   first live rehearsal of this sweep moved protein 160 g -> 130 g in one run: the
 *   suggestion is formulaic (2.2 g/kg lean mass, or 1.8 g/kg body weight) while the
 *   stored 160 was deliberate, and silently overwriting it is the same surprise as a
 *   silent calorie cut. An uncapped protein target was wrong for the same reason a
 *   capped calorie one is right.
 *
 * Every applied change is logged server-side (source `targets`) with the before and
 * after, so an unexplained target can always be traced back to a run.
 */
import type { Confidence } from './tdee';

/** 0 = Sunday. Monday: a week's data is in, and it reads as a fresh start. */
export const AUTO_TARGET_WEEKDAY = 1;
export const MIN_DAYS_BETWEEN = 7;
export const DEFAULT_MAX_CHANGE_KCAL = 300;
export const MIN_MAX_CHANGE_KCAL = 50;
export const MAX_MAX_CHANGE_KCAL = 1000;
export const DEFAULT_MAX_CHANGE_G = 20;
export const MIN_MAX_CHANGE_G = 5;
export const MAX_MAX_CHANGE_G = 100;

export interface AutoTargetTarget {
  type: 'calories' | 'protein';
  value: number;
  unit: string;
}

export interface AutoTargetInput {
  enabled: boolean;
  /** The user's local date, 'YYYY-MM-DD'. */
  today: string;
  /** The user's local weekday for `today`, 0 = Sunday. */
  weekday: number;
  /** users.auto_targets_last_day: the local day of the last applied run. */
  lastAppliedDay: string | null;
  /** From estimateTdee; null when there is no estimate at all yet. */
  confidence: Confidence | null;
  /** From suggestTargets; null when there is no estimate to suggest from. */
  suggestion: { calories: number; protein: number } | null;
  /** The stored targets now. null/0 means "no target set". */
  current: { calories: number | null; protein: number | null };
  maxChangeKcal: number;
  maxChangeG: number;
}

export type AutoTargetDecision =
  | { apply: false; reason: string }
  | { apply: true; targets: AutoTargetTarget[]; changes: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two bare 'YYYY-MM-DD' days, via Date.UTC so DST cannot shift one. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

const positive = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/**
 * The guards that need no data: switched on, the right weekday, not already done
 * this week. Split out so the sweep can skip reading 28 days of metrics for every
 * user on the six days out of seven when it would refuse anyway.
 */
export function autoTargetsDue(input: {
  enabled: boolean;
  today: string;
  weekday: number;
  lastAppliedDay: string | null;
}): { due: true } | { due: false; reason: string } {
  if (!input.enabled) return { due: false, reason: 'automatic targets are off' };

  if (input.weekday !== AUTO_TARGET_WEEKDAY) {
    return { due: false, reason: 'only runs on Monday' };
  }

  if (input.lastAppliedDay) {
    const since = daysBetween(input.lastAppliedDay, input.today);
    // An unparseable stored day is treated as "applied, date unknown" rather than as
    // "never applied": the safe reading of a corrupt marker is the one that does not write.
    if (since === null) {
      return { due: false, reason: `last applied day is unreadable (${input.lastAppliedDay})` };
    }
    if (since < MIN_DAYS_BETWEEN) {
      return { due: false, reason: `already applied ${since} day(s) ago (${input.lastAppliedDay})` };
    }
  }

  return { due: true };
}

export function decideAutoTargets(input: AutoTargetInput): AutoTargetDecision {
  const due = autoTargetsDue(input);
  if (due.due === false) return { apply: false, reason: due.reason };

  if (!input.suggestion || !input.confidence) {
    return { apply: false, reason: 'no adaptive TDEE estimate yet' };
  }
  if (input.confidence === 'low') {
    return { apply: false, reason: 'TDEE confidence is low' };
  }

  const calories = Math.round(input.suggestion.calories);
  const protein = Math.round(input.suggestion.protein);
  if (!(calories > 0) || !(protein > 0)) {
    return { apply: false, reason: 'suggested targets are not usable numbers' };
  }

  const currentCalories = positive(input.current.calories);
  const currentProtein = positive(input.current.protein);

  // Both caps, one shape. A refusal names the numbers, because "my target did not
  // move" has to be answerable from the log line on its own. With no stored target
  // there is nothing established to protect, so the first value is never capped.
  const overCap = (label: string, unit: string, current: number | null, next: number, cap: number): string | null => {
    if (current === null) return null;
    const delta = Math.abs(next - current);
    const limit = Math.round(cap);
    return delta > limit
      ? `suggested ${label} moves ${delta} ${unit} (${current} to ${next}), over the ${limit} ${unit} limit`
      : null;
  };
  const overLimit =
    overCap('calories', 'kcal', currentCalories, calories, input.maxChangeKcal)
    ?? overCap('protein', 'g', currentProtein, protein, input.maxChangeG);
  if (overLimit) return { apply: false, reason: overLimit };

  const changes: string[] = [];
  const targets: AutoTargetTarget[] = [];
  if (calories !== currentCalories) {
    targets.push({ type: 'calories', value: calories, unit: 'kcal' });
    changes.push(`calories ${currentCalories ?? 'unset'} to ${calories}`);
  }
  if (protein !== currentProtein) {
    targets.push({ type: 'protein', value: protein, unit: 'g' });
    changes.push(`protein ${currentProtein ?? 'unset'} to ${protein}`);
  }
  if (!targets.length) {
    return { apply: false, reason: 'targets already match the suggestion' };
  }

  return { apply: true, targets, changes };
}
