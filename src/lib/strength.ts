/**
 * Estimated one-rep max and personal records for weighted exercises.
 *
 * e1RM uses the Epley formula, weight * (1 + reps / 30), and a single is its
 * own 1RM. Sets above MAX_E1RM_REPS are left out of the estimate: past about a
 * dozen reps the formula drifts badly (it turns 20 easy reps into a big max),
 * but they still count for the rep-range records below.
 *
 * A rep-range record "kRM" is the heaviest weight lifted for at least k reps,
 * so 100 kg x 6 is also a 5RM of 100 kg.
 *
 * Only working sets count: warm-up sets (Hevy set type 'warmup') are skipped,
 * as are cardio and bodyweight exercises and sets without both a weight and a
 * rep count. Exercises are matched by their title.
 *
 * PRs are found by walking sessions oldest-first and comparing each session's
 * best against the bests from earlier sessions only. So an exercise's first
 * session is its baseline and sets no PRs, and a session that climbs through
 * three heavier sets records one PR (its best set) per record kind, not three.
 */

export const MAX_E1RM_REPS = 12;
export const REP_RANGES = [1, 3, 5, 10] as const;
export type RepRange = typeof REP_RANGES[number];
export type PrKind = 'e1rm' | `${RepRange}rm`;

export interface StrengthSet {
  reps?: number | null;
  weight?: number | null;
  type?: string | null;
}

export interface StrengthExercise {
  title: string;
  type?: string;
  sets: StrengthSet[];
}

export interface StrengthWorkout {
  id: number | string;
  timestamp: string;
  exercises: StrengthExercise[];
}

export interface RecordSet {
  weight: number;
  reps: number;
  e1rm: number | null;
  timestamp: string;
  workoutId: number | string;
}

export interface SessionPoint {
  /** Calendar day of the session, from the caller's dayOf. */
  day: string;
  workoutId: number | string;
  /** Best e1RM of the session, null when no working set had 1-12 reps. */
  e1rm: number | null;
}

export interface ExerciseStrength {
  title: string;
  sessions: SessionPoint[];
  bestE1rm: RecordSet | null;
  repMaxes: Record<RepRange, RecordSet | null>;
}

export interface PrEntry {
  title: string;
  workoutId: number | string;
  timestamp: string;
  weight: number;
  reps: number;
  e1rm: number | null;
  kinds: PrKind[];
}

export interface StrengthAnalysis {
  /** Weighted exercises, most sessions first. */
  exercises: ExerciseStrength[];
  /** PR kinds per set, keyed `${workoutId}-${exerciseIndex}-${setIndex}`. */
  prSets: Record<string, PrKind[]>;
  /** Number of record-setting sets per workout id. */
  prCountByWorkout: Record<string, number>;
  /** One entry per record-setting set, newest first. */
  prs: PrEntry[];
}

export function estimate1RM(weight: number | null | undefined, reps: number | null | undefined): number | null {
  if (!weight || weight <= 0 || !reps || reps < 1 || reps > MAX_E1RM_REPS) return null;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function isWeightedExercise(ex: { type?: string }): boolean {
  return ex.type !== 'cardio' && ex.type !== 'bodyweight';
}

export function isWorkingSet(set: StrengthSet): boolean {
  return set.type !== 'warmup' && (set.weight || 0) > 0 && (set.reps || 0) > 0;
}

export const prSetKey = (workoutId: number | string, exerciseIndex: number, setIndex: number) =>
  `${workoutId}-${exerciseIndex}-${setIndex}`;

const emptyRepMaxes = (): Record<RepRange, RecordSet | null> => ({ 1: null, 3: null, 5: null, 10: null });

interface Candidate {
  key: string;
  record: RecordSet;
}

export function analyseStrength(workouts: StrengthWorkout[], dayOf: (timestamp: string) => string): StrengthAnalysis {
  const sorted = [...workouts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const byTitle = new Map<string, ExerciseStrength>();
  const prSets: Record<string, PrKind[]> = {};
  const prCountByWorkout: Record<string, number> = {};
  const prs: PrEntry[] = [];

  for (const workout of sorted) {
    // Gather this session's best candidate per exercise and record kind first,
    // so an exercise logged twice in one workout is still one session.
    const sessionBests = new Map<string, { e1rm: Candidate | null; reps: Record<RepRange, Candidate | null> }>();

    workout.exercises.forEach((ex, exIdx) => {
      if (!isWeightedExercise(ex)) return;
      ex.sets.forEach((set, setIdx) => {
        if (!isWorkingSet(set)) return;
        const weight = set.weight as number;
        const reps = set.reps as number;
        const record: RecordSet = { weight, reps, e1rm: estimate1RM(weight, reps), timestamp: workout.timestamp, workoutId: workout.id };
        const candidate = { key: prSetKey(workout.id, exIdx, setIdx), record };

        let best = sessionBests.get(ex.title);
        if (!best) {
          best = { e1rm: null, reps: { 1: null, 3: null, 5: null, 10: null } };
          sessionBests.set(ex.title, best);
        }
        if (record.e1rm != null && (best.e1rm == null || record.e1rm > (best.e1rm.record.e1rm as number))) {
          best.e1rm = candidate;
        }
        for (const k of REP_RANGES) {
          const current = best.reps[k];
          if (reps >= k && (current == null || weight > current.record.weight)) best.reps[k] = candidate;
        }
      });
    });

    for (const [title, best] of sessionBests) {
      let history = byTitle.get(title);
      const isBaseline = !history;
      if (!history) {
        history = { title, sessions: [], bestE1rm: null, repMaxes: emptyRepMaxes() };
        byTitle.set(title, history);
      }
      history.sessions.push({ day: dayOf(workout.timestamp), workoutId: workout.id, e1rm: best.e1rm?.record.e1rm ?? null });

      const kindsBySet = new Map<string, { record: RecordSet; kinds: PrKind[] }>();
      const credit = (candidate: Candidate, kind: PrKind) => {
        if (isBaseline) return;
        const entry = kindsBySet.get(candidate.key) ?? { record: candidate.record, kinds: [] };
        entry.kinds.push(kind);
        kindsBySet.set(candidate.key, entry);
      };

      if (best.e1rm && (history.bestE1rm == null || (best.e1rm.record.e1rm as number) > (history.bestE1rm.e1rm as number))) {
        if (history.bestE1rm != null) credit(best.e1rm, 'e1rm');
        history.bestE1rm = best.e1rm.record;
      }
      for (const k of REP_RANGES) {
        const candidate = best.reps[k];
        const prior = history.repMaxes[k];
        if (candidate && (prior == null || candidate.record.weight > prior.weight)) {
          // A first-ever 10RM is not a PR when heavier sets already exist at
          // fewer reps; it only becomes one once there is a 10RM to beat.
          if (prior != null) credit(candidate, `${k}rm`);
          history.repMaxes[k] = candidate.record;
        }
      }

      for (const [key, { record, kinds }] of kindsBySet) {
        prSets[key] = kinds;
        prCountByWorkout[String(workout.id)] = (prCountByWorkout[String(workout.id)] || 0) + 1;
        prs.push({ title, workoutId: workout.id, timestamp: workout.timestamp, weight: record.weight, reps: record.reps, e1rm: record.e1rm, kinds });
      }
    }
  }

  // A day with two sessions of the same exercise keeps the better one.
  for (const history of byTitle.values()) {
    const byDay = new Map<string, SessionPoint>();
    for (const point of history.sessions) {
      const existing = byDay.get(point.day);
      if (!existing || (point.e1rm ?? -1) > (existing.e1rm ?? -1)) byDay.set(point.day, point);
    }
    history.sessions = [...byDay.values()];
  }

  const exercises = [...byTitle.values()].sort((a, b) => b.sessions.length - a.sessions.length || a.title.localeCompare(b.title));
  return { exercises, prSets, prCountByWorkout, prs: prs.reverse() };
}

export function prKindLabel(kind: PrKind): string {
  return kind === 'e1rm' ? 'Est. 1RM' : kind.toUpperCase();
}
