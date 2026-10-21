// Maps Hevy's exercise_templates muscle-group vocabulary onto the body-diagram
// GLB's mesh regions. 'forearms' and 'adductors' have no corresponding mesh in
// the current asset and are intentionally dropped; 'cardio'/'full_body' are not
// localized muscle regions and are excluded.
export const BODY_DIAGRAM_REGIONS = [
  'chest', 'shoulders', 'biceps', 'abdominals', 'quadriceps', 'calves',
  'upper_back', 'lats', 'lower_back', 'triceps', 'glutes', 'hamstrings',
] as const;

export type BodyDiagramRegion = typeof BODY_DIAGRAM_REGIONS[number];

const REGION_SET = new Set<string>(BODY_DIAGRAM_REGIONS);

function toRegion(hevyGroup: string | null | undefined): BodyDiagramRegion | null {
  if (!hevyGroup) return null;
  return REGION_SET.has(hevyGroup) ? (hevyGroup as BodyDiagramRegion) : null;
}

interface WorkoutExerciseLike {
  primaryMuscleGroup?: string | null;
  secondaryMuscleGroups?: string[] | null;
  sets?: unknown[];
}

interface WorkoutLike {
  timestamp: string | number | Date;
  exercises?: WorkoutExerciseLike[];
}

/**
 * Per-region readiness (0-100) via a time-since-last-trained decay: a region
 * trained today is 0 (least ready), a region untouched for `recoveryDays` or
 * longer is 100 (fully recovered). Regions never seen in `workouts` return
 * null (no data, render as neutral rather than implying full readiness).
 */
export function computeReadiness(
  workouts: WorkoutLike[] | undefined | null,
  recoveryDays = 3,
  now: Date = new Date(),
): Record<BodyDiagramRegion, number | null> {
  const lastTrained: Partial<Record<BodyDiagramRegion, Date>> = {};

  for (const workout of workouts || []) {
    const workoutDate = new Date(workout.timestamp);
    for (const exercise of workout.exercises || []) {
      if (!exercise.sets?.length) continue;

      const regions = [
        toRegion(exercise.primaryMuscleGroup),
        ...(exercise.secondaryMuscleGroups || []).map(toRegion),
      ].filter((r): r is BodyDiagramRegion => r !== null);

      for (const region of regions) {
        if (!lastTrained[region] || workoutDate > lastTrained[region]!) {
          lastTrained[region] = workoutDate;
        }
      }
    }
  }

  const result = {} as Record<BodyDiagramRegion, number | null>;
  for (const region of BODY_DIAGRAM_REGIONS) {
    const last = lastTrained[region];
    if (!last) {
      result[region] = null;
      continue;
    }
    const daysSince = (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
    result[region] = Math.max(0, Math.min(100, Math.round((daysSince / recoveryDays) * 100)));
  }
  return result;
}
