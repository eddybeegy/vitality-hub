/**
 * Weekly hard sets per muscle group (roadmap: "Weekly sets per muscle group").
 *
 * Counts working sets over the last 7 calendar days in the user's zone and
 * compares each muscle group with a weekly target range (10-20 hard sets is
 * the common evidence-based range for growth). A set counts 1 for the
 * exercise's primary muscle and 0.5 for each secondary muscle, the same
 * weighting the Muscle Group Load radar has always used.
 *
 * Warm-up sets (Hevy set type 'warmup') and cardio exercises do not count.
 * Workout timestamps are UTC for every source, so a workout's day is that
 * instant formatted into the user's zone (metricDay), never a reparsed
 * locale string.
 */
import { metricDay } from './baselines';
import { addDays } from './dayTags';

export const WEEK_DAYS = 7;
export const DEFAULT_RANGE = { low: 10, high: 20 } as const;

export type SetStatus = 'under' | 'in_range' | 'over';

export interface MuscleSets {
  group: string;
  label: string;
  sets: number;
  status: SetStatus;
}

interface SetLike { type?: string | null }
interface ExerciseLike {
  type?: string;
  primaryMuscleGroup?: string | null;
  secondaryMuscleGroups?: string[] | null;
  sets?: SetLike[];
}
interface WorkoutLike { timestamp: string; exercises?: ExerciseLike[] }

/** 'upper_back' -> 'Upper Back'. */
export function muscleLabel(group: string): string {
  return group.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export function setStatus(sets: number, range: { low: number; high: number } = DEFAULT_RANGE): SetStatus {
  return sets < range.low ? 'under' : sets > range.high ? 'over' : 'in_range';
}

/**
 * Hard sets per muscle group over the WEEK_DAYS calendar days ending `today`,
 * most sets first. `today` is the user's local day (getLocalDateString).
 */
export function weeklySetsByMuscle(
  workouts: WorkoutLike[],
  today: string,
  timezone = 'UTC',
  range: { low: number; high: number } = DEFAULT_RANGE
): MuscleSets[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const from = addDays(today, -(WEEK_DAYS - 1));
  const totals: Record<string, number> = {};

  for (const w of workouts) {
    const day = metricDay(String(w.timestamp ?? ''), fmt);
    if (!day || day < from || day > today) continue;
    for (const ex of w.exercises || []) {
      if (ex.type === 'cardio') continue;
      const hard = (ex.sets || []).filter(s => s.type !== 'warmup').length;
      if (!hard) continue;
      if (ex.primaryMuscleGroup) totals[ex.primaryMuscleGroup] = (totals[ex.primaryMuscleGroup] || 0) + hard;
      for (const g of ex.secondaryMuscleGroups || []) {
        if (g && g !== ex.primaryMuscleGroup) totals[g] = (totals[g] || 0) + hard * 0.5;
      }
    }
  }

  return Object.entries(totals)
    .map(([group, sets]) => ({ group, label: muscleLabel(group), sets, status: setStatus(sets, range) }))
    .sort((a, b) => b.sets - a.sets || a.group.localeCompare(b.group));
}
