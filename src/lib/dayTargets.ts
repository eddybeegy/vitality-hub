/**
 * Training-day and rest-day targets (roadmap: "Training-day and rest-day targets").
 *
 * The existing 'calories' and 'carbs' targets stay the training-day values. Two
 * optional targets, 'calories_rest' and 'carbs_rest', apply on rest days. With
 * them unset nothing changes: every day uses the base targets.
 *
 * A day is a training day when a workout of at least MIN_TRAINING_MINUTES that is
 * not a walk is logged on it (in the user's zone; workout timestamps are UTC).
 * Routines carry no schedule, so a planned session cannot be seen: the user can
 * override the day either way from the Nutrition tab before training.
 * Unknown (workouts not loaded yet) reads as a training day, the base targets,
 * so a slow load never shows the lower rest-day numbers by mistake.
 */
import { metricDay } from './baselines';

export const MIN_TRAINING_MINUTES = 20;

export type DayType = 'training' | 'rest';
export type DayTypeOverride = DayType | null;

/** Target types with a rest-day variant, and the variant's type. */
export const REST_VARIANTS: Record<string, string> = {
  calories: 'calories_rest',
  carbs: 'carbs_rest',
};

interface WorkoutLike {
  timestamp?: string;
  name?: string;
  duration?: number | string;
}

const isWalk = (name: string | undefined) => /\b(walk|walking|hike|hiking)/i.test(name || '');

/**
 * Does this workout make its day a training day? Exported so the digest
 * (src/lib/digest.ts) can apply the same rule without copying the threshold or
 * the walk test -- it assigns days by its own UTC convention, so it needs the
 * predicate on its own.
 */
export function isTrainingWorkout(w: WorkoutLike): boolean {
  const minutes = Number(w.duration);
  return Number.isFinite(minutes) && minutes >= MIN_TRAINING_MINUTES && !isWalk(w.name);
}

/** Is a qualifying workout logged on `day` (YYYY-MM-DD in `timezone`)? */
export function trainedOn(workouts: WorkoutLike[], day: string, timezone = 'UTC'): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  return workouts.some(w => {
    if (!isTrainingWorkout(w)) return false;
    return metricDay(String(w.timestamp ?? ''), fmt) === day;
  });
}

export interface DayTypeResult {
  type: DayType;
  /** 'auto' when inferred from workouts, 'manual' when overridden. */
  source: 'auto' | 'manual';
}

export function dayTypeFor(
  workouts: WorkoutLike[] | null | undefined,
  day: string,
  timezone: string,
  override: DayTypeOverride,
): DayTypeResult {
  if (override) return { type: override, source: 'manual' };
  if (!Array.isArray(workouts)) return { type: 'training', source: 'auto' };
  return { type: trainedOn(workouts, day, timezone) ? 'training' : 'rest', source: 'auto' };
}

/**
 * The target that applies today: on a rest day the rest variant when it is set,
 * otherwise the base value. `base` is the plain lookup (undefined when unset).
 */
export function targetForDay(
  type: string,
  dayType: DayType,
  base: (type: string) => number | undefined,
): number | undefined {
  const variant = REST_VARIANTS[type];
  if (dayType === 'rest' && variant) {
    const rest = base(variant);
    if (rest !== undefined) return rest;
  }
  return base(type);
}

/** Does the user have any rest-day target set (so the day toggle is worth showing)? */
export function hasRestTargets(base: (type: string) => number | undefined): boolean {
  return Object.values(REST_VARIANTS).some(v => base(v) !== undefined);
}

const overrideKey = (day: string) => `vh.dayTypeOverride.${day}`;

/** The override saved for `day` in this browser, if any. Storage can throw; that reads as none. */
export function loadOverride(day: string): DayTypeOverride {
  try {
    const v = globalThis.localStorage?.getItem(overrideKey(day));
    return v === 'training' || v === 'rest' ? v : null;
  } catch {
    return null;
  }
}

export function saveOverride(day: string, value: DayTypeOverride): void {
  try {
    if (value) globalThis.localStorage?.setItem(overrideKey(day), value);
    else globalThis.localStorage?.removeItem(overrideKey(day));
  } catch {
    // Private mode or blocked storage: the override just lasts for this page view.
  }
}
