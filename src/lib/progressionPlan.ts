/**
 * Turns a plateau verdict into a concrete next-session prescription and finds
 * the Hevy routine to write it to (roadmap: "Plateau detection and overload
 * suggestions" -> push the suggestion back to Hevy).
 *
 * classifyProgress() only produces prose ("one lighter week at about 90%").
 * This module turns that into numbers, because POST /api/hevy/update-routine
 * takes sets, not advice: `{ exercise_title, sets: [{ weight_kg, reps }] }`.
 *
 * Where the numbers come from:
 *
 * - The *current* prescription is the most recent logged session of that lift,
 *   not the routine. `routine_exercises` stores `target_weight`/`target_reps`
 *   but every row is NULL (823/823 on 2026-10-22) - the Hevy sync only brings
 *   back set counts - so the last session's working sets are the only record of
 *   what was actually being lifted.
 * - Weights are kilograms everywhere: `workout_sets.weight` is stored in kg and
 *   Hevy's API takes `weight_kg`. Nothing here converts; callers format.
 *
 * The rules, deliberately boring:
 *
 * - plateau / regressing: every set drops to DELOAD_FRACTION of its weight,
 *   rounded to the *nearest* WEIGHT_STEP_KG, and never to the weight it is
 *   already at. Rounding down instead turned a 10% deload on 44 kg into 15%
 *   (44 -> 37.5) - on real data, every one of Kieron's four stalled lifts
 *   overshot. Reps are left alone: changing both at once makes the next
 *   session unreadable.
 * - progressing: every set gains one WEIGHT_STEP_KG, reps left alone.
 *
 * A plan is refused (reason, no plan) rather than guessed when the lift has no
 * recent weighted working sets (bodyweight or time-based work, where there is
 * no weight to step), when no routine contains it, or when more than one
 * routine does and the last session does not say which. A wrong weight pushed
 * into Hevy is a worse outcome than no button.
 */
import { isWeightedExercise, isWorkingSet, type StrengthWorkout } from './strength';
import type { ProgressStatus } from './plateaus';

/** Smallest plate step we assume is available, kg. */
export const WEIGHT_STEP_KG = 2.5;
/** A deload week's share of the current weight. */
export const DELOAD_FRACTION = 0.9;

export interface PlannedSet {
  weight_kg: number;
  reps: number;
}

export interface ProgressionPlan {
  exercise_title: string;
  sets: PlannedSet[];
  /** Heaviest set in the plan, kg. */
  topWeightKg: number;
  /** Heaviest set of the session it was derived from, kg. */
  previousTopWeightKg: number;
  /** Calendar day of that session, when the caller supplied dayOf. */
  fromDay: string | null;
}

export interface RoutineTarget {
  routine_external_id: string;
  routine_title: string;
}

export interface PlanResult {
  plan: ProgressionPlan | null;
  target: RoutineTarget | null;
  /** Why there is nothing to apply. Null when plan and target are both set. */
  reason: string | null;
}

export interface RoutineRow {
  id: number | string;
  name?: string | null;
  external_id?: string | null;
}

export interface RoutineExerciseRow {
  routine_id: number | string;
  exercise_title?: string | null;
}

const key = (title: unknown) => String(title ?? '').trim().toLowerCase();

/** Rounds down to a loadable weight, never past the smallest step. */
export function stepDown(kg: number, step: number = WEIGHT_STEP_KG): number {
  const rounded = Math.floor((kg / step) * (1 + 1e-9)) * step;
  // Below one step there is nothing to round to (light dumbbells, cable
  // stacks in odd increments): keep the raw value rather than rounding a
  // 2 kg set up to 2.5 and calling it a deload.
  if (rounded < step) return Number(kg.toFixed(1));
  return Number(rounded.toFixed(2));
}

/** Rounds up to a loadable weight. */
export function stepUp(kg: number, step: number = WEIGHT_STEP_KG): number {
  return Number((Math.ceil((kg / step) * (1 - 1e-9)) * step).toFixed(2));
}

/** Rounds to the nearest loadable weight, keeping sub-step weights as they are. */
export function stepNearest(kg: number, step: number = WEIGHT_STEP_KG): number {
  const rounded = Math.round(kg / step) * step;
  if (rounded < step) return Number(kg.toFixed(1));
  return Number(rounded.toFixed(2));
}

/**
 * A deload that is actually lighter: ~DELOAD_FRACTION, rounded to the nearest
 * plate, and one step down if that rounding lands back on the current weight.
 */
export function deloadWeight(kg: number, step: number = WEIGHT_STEP_KG): number {
  const target = stepNearest(kg * DELOAD_FRACTION, step);
  if (target < kg) return target;
  return stepDown(kg - step, step);
}

export interface LoggedSession {
  day: string | null;
  sets: PlannedSet[];
  routineExternalId: string | null;
}

/**
 * The most recent session with weighted working sets for `title`, newest
 * timestamp first. Warm-ups and sets missing a weight or a rep count are
 * dropped by isWorkingSet, matching what analyseStrength() scores.
 */
export function lastWeightedSession(
  workouts: StrengthWorkout[],
  title: string,
  dayOf?: (timestamp: string) => string
): LoggedSession | null {
  const wanted = key(title);
  const ordered = [...(workouts || [])].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  for (const workout of ordered) {
    for (const ex of workout.exercises || []) {
      if (key(ex.title) !== wanted || !isWeightedExercise(ex)) continue;
      const sets = (ex.sets || [])
        .filter(isWorkingSet)
        .map(s => ({ weight_kg: Number(s.weight), reps: Number(s.reps) }));
      if (sets.length === 0) continue;
      return {
        day: dayOf ? dayOf(workout.timestamp) : null,
        sets,
        // Standardized workouts carry routineExternalId; raw DB rows carry
        // routine_external_id. Accept either.
        routineExternalId:
          (workout as any).routineExternalId || (workout as any).routine_external_id || null,
      };
    }
  }
  return null;
}

/**
 * The routine holding `title`. `preferExternalId` (the routine of the last
 * session) breaks ties; without it, an exercise in several routines is
 * ambiguous and gets no plan.
 */
export function findRoutineForExercise(
  routines: RoutineRow[],
  routineExercises: RoutineExerciseRow[],
  title: string,
  preferExternalId?: string | null
): { target: RoutineTarget | null; reason: string | null } {
  const wanted = key(title);
  const byId = new Map<string, RoutineRow>();
  for (const r of routines || []) byId.set(String(r.id), r);

  const matches: RoutineTarget[] = [];
  for (const re of routineExercises || []) {
    if (key(re.exercise_title) !== wanted) continue;
    const routine = byId.get(String(re.routine_id));
    if (!routine?.external_id) continue;
    if (matches.some(m => m.routine_external_id === routine.external_id)) continue;
    matches.push({
      routine_external_id: String(routine.external_id),
      routine_title: String(routine.name || ''),
    });
  }

  if (matches.length === 0) return { target: null, reason: 'No Hevy routine lists this lift.' };
  if (matches.length === 1) return { target: matches[0], reason: null };
  const preferred = preferExternalId
    ? matches.find(m => m.routine_external_id === preferExternalId)
    : undefined;
  if (preferred) return { target: preferred, reason: null };
  return {
    target: null,
    reason: `This lift is in ${matches.length} routines, so there is no single one to update.`,
  };
}

/** The prescription itself: the only place a weight changes. */
export function planSets(status: ProgressStatus, sets: PlannedSet[]): PlannedSet[] {
  return sets.map(s => ({
    reps: s.reps,
    weight_kg:
      status === 'progressing'
        ? stepUp(s.weight_kg + WEIGHT_STEP_KG)
        : deloadWeight(s.weight_kg),
  }));
}

export interface PlanInput {
  title: string;
  status: ProgressStatus;
  workouts: StrengthWorkout[];
  routines: RoutineRow[];
  routineExercises: RoutineExerciseRow[];
  dayOf?: (timestamp: string) => string;
}

/** Plan + routine, or the reason there is nothing to apply. */
export function planForExercise(input: PlanInput): PlanResult {
  const session = lastWeightedSession(input.workouts, input.title, input.dayOf);
  if (!session) {
    return {
      plan: null,
      target: null,
      reason: 'No recent session logged a weight and reps for this lift.',
    };
  }
  const { target, reason } = findRoutineForExercise(
    input.routines,
    input.routineExercises,
    input.title,
    session.routineExternalId
  );
  if (!target) return { plan: null, target: null, reason };

  const sets = planSets(input.status, session.sets);
  const top = Math.max(...sets.map(s => s.weight_kg));
  const previousTop = Math.max(...session.sets.map(s => s.weight_kg));
  if (top === previousTop || sets.some(s => !(s.weight_kg > 0))) {
    return {
      plan: null,
      target: null,
      reason: 'The step would not change the weight on any set.',
    };
  }
  return {
    plan: {
      exercise_title: input.title,
      sets,
      topWeightKg: top,
      previousTopWeightKg: previousTop,
      fromDay: session.day,
    },
    target,
    reason: null,
  };
}
