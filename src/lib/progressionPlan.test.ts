import { describe, it, expect } from 'vitest';
import {
  planForExercise,
  planSets,
  lastWeightedSession,
  findRoutineForExercise,
  stepDown,
  stepUp,
  stepNearest,
  deloadWeight,
  WEIGHT_STEP_KG,
} from './progressionPlan';

const workout = (id: number, timestamp: string, title: string, sets: any[], extra: any = {}) => ({
  id,
  timestamp,
  routine_external_id: 'r-1',
  exercises: [{ title, type: 'strength', sets }],
  ...extra,
});

const routines = [{ id: 1, name: 'Mon — Upper A', external_id: 'r-1' }];
const routineExercises = [{ routine_id: 1, exercise_title: 'Bench Press (Barbell)' }];

describe('stepDown / stepUp', () => {
  it('rounds to loadable weights', () => {
    expect(stepDown(85.5)).toBe(85);
    expect(stepDown(90)).toBe(90);
    expect(stepUp(85.1)).toBe(87.5);
    expect(stepUp(87.5)).toBe(87.5);
  });

  it('leaves weights below one step alone rather than rounding them up', () => {
    // A 2 kg dumbbell deloaded to 1.8 must not come back as 2.5 kg.
    expect(stepDown(1.8)).toBe(1.8);
    expect(stepDown(1.8)).toBeLessThan(WEIGHT_STEP_KG);
  });
});

describe('deloadWeight', () => {
  it('rounds ~90% to the nearest plate rather than down', () => {
    // Rounding down made this 37.5, a 15% cut dressed up as 10%.
    expect(deloadWeight(44)).toBe(40);
    expect(deloadWeight(60)).toBe(55);
    expect(deloadWeight(100)).toBe(90);
  });

  it('never returns the weight it was given', () => {
    // 2.5 * 0.9 = 2.25, which rounds back to 2.5.
    expect(deloadWeight(2.5)).toBeLessThan(2.5);
    expect(deloadWeight(5)).toBe(2.5);
  });

  it('nearest rounding keeps sub-step weights alone', () => {
    expect(stepNearest(1.1)).toBe(1.1);
    expect(stepNearest(2.4)).toBe(2.5);
  });
});

describe('planSets', () => {
  it('deloads to the nearest plate under 90%, reps untouched', () => {
    expect(planSets('plateau', [{ weight_kg: 100, reps: 8 }, { weight_kg: 95, reps: 6 }]))
      .toEqual([{ weight_kg: 90, reps: 8 }, { weight_kg: 85, reps: 6 }]);
  });

  it('treats regressing the same as plateau', () => {
    expect(planSets('regressing', [{ weight_kg: 100, reps: 5 }]))
      .toEqual([{ weight_kg: 90, reps: 5 }]);
  });

  it('adds one step when progressing', () => {
    expect(planSets('progressing', [{ weight_kg: 100, reps: 8 }]))
      .toEqual([{ weight_kg: 102.5, reps: 8 }]);
  });
});

describe('lastWeightedSession', () => {
  it('takes the newest session and drops warm-ups and incomplete sets', () => {
    const workouts = [
      workout(1, '2026-09-01T10:00:00Z', 'Bench Press (Barbell)', [{ weight: 80, reps: 8 }]),
      workout(2, '2026-10-01T10:00:00Z', 'Bench Press (Barbell)', [
        { weight: 40, reps: 10, type: 'warmup' },
        { weight: 95, reps: 5 },
        { weight: 95, reps: null },
      ]),
    ];
    expect(lastWeightedSession(workouts as any, 'bench press (barbell)')).toEqual({
      day: null,
      sets: [{ weight_kg: 95, reps: 5 }],
      routineExternalId: 'r-1',
    });
  });

  it('skips sessions with no weighted sets and reports the day when asked', () => {
    const workouts = [
      workout(3, '2026-10-05T10:00:00Z', 'Plank', [{ weight: 0, reps: 0 }]),
      workout(4, '2026-10-02T10:00:00Z', 'Bench Press (Barbell)', [{ weight: 95, reps: 5 }]),
    ];
    const session = lastWeightedSession(workouts as any, 'Bench Press (Barbell)', ts => ts.slice(0, 10));
    expect(session?.day).toBe('2026-10-02');
  });

  it('accepts the standardized camelCase routine id as well as the raw column', () => {
    const w = workout(6, '2026-10-05T10:00:00Z', 'Bench Press (Barbell)', [{ weight: 95, reps: 5 }]);
    delete (w as any).routine_external_id;
    (w as any).routineExternalId = 'r-9';
    expect(lastWeightedSession([w] as any, 'Bench Press (Barbell)')?.routineExternalId).toBe('r-9');
  });

  it('returns null for a lift that was never logged with a weight', () => {
    expect(lastWeightedSession([workout(5, '2026-10-05T10:00:00Z', 'Plank', [{ weight: 0, reps: 0 }])] as any, 'Plank'))
      .toBeNull();
  });
});

describe('findRoutineForExercise', () => {
  it('matches on title, case and padding insensitive', () => {
    const { target } = findRoutineForExercise(routines, [{ routine_id: 1, exercise_title: '  BENCH press (Barbell) ' }], 'Bench Press (Barbell)');
    expect(target).toEqual({ routine_external_id: 'r-1', routine_title: 'Mon — Upper A' });
  });

  it('refuses when several routines list the lift and the last session does not say which', () => {
    const many = [...routines, { id: 2, name: 'Fri — Upper C', external_id: 'r-2' }];
    const res = findRoutineForExercise(many, [...routineExercises, { routine_id: 2, exercise_title: 'Bench Press (Barbell)' }], 'Bench Press (Barbell)');
    expect(res.target).toBeNull();
    expect(res.reason).toContain('2 routines');
  });

  it('breaks that tie with the routine of the last session', () => {
    const many = [...routines, { id: 2, name: 'Fri — Upper C', external_id: 'r-2' }];
    const res = findRoutineForExercise(many, [...routineExercises, { routine_id: 2, exercise_title: 'Bench Press (Barbell)' }], 'Bench Press (Barbell)', 'r-2');
    expect(res.target?.routine_external_id).toBe('r-2');
  });

  it('ignores routines with no external id - they cannot be pushed to Hevy', () => {
    const res = findRoutineForExercise([{ id: 1, name: 'Local only', external_id: null }], routineExercises, 'Bench Press (Barbell)');
    expect(res.target).toBeNull();
    expect(res.reason).toContain('No Hevy routine');
  });
});

describe('planForExercise', () => {
  const base = {
    title: 'Bench Press (Barbell)',
    status: 'plateau' as const,
    workouts: [workout(1, '2026-10-20T10:00:00Z', 'Bench Press (Barbell)', [
      { weight: 95, reps: 5 },
      { weight: 95, reps: 5 },
      { weight: 90, reps: 6 },
    ])] as any,
    routines,
    routineExercises,
  };

  it('plans from the last session and names the routine', () => {
    const res = planForExercise(base);
    expect(res.reason).toBeNull();
    expect(res.target).toEqual({ routine_external_id: 'r-1', routine_title: 'Mon — Upper A' });
    expect(res.plan?.sets).toEqual([
      { weight_kg: 85, reps: 5 },
      { weight_kg: 85, reps: 5 },
      { weight_kg: 80, reps: 6 },
    ]);
    expect(res.plan?.topWeightKg).toBe(85);
    expect(res.plan?.previousTopWeightKg).toBe(95);
  });

  it('refuses without a weighted session', () => {
    const res = planForExercise({ ...base, title: 'Plank', workouts: [] as any });
    expect(res.plan).toBeNull();
    expect(res.reason).toContain('No recent session');
  });

  it('refuses when no routine lists the lift', () => {
    const res = planForExercise({ ...base, routineExercises: [] });
    expect(res.plan).toBeNull();
    expect(res.reason).toContain('No Hevy routine');
  });

  it('refuses a no-op rather than pushing an unchanged routine', () => {
    // 0.1 kg is far below one plate step: 90% of it rounds back to itself and
    // a step down would be negative, so there is nothing to apply.
    const res = planForExercise({
      ...base,
      workouts: [workout(2, '2026-10-20T10:00:00Z', 'Bench Press (Barbell)', [{ weight: 0.1, reps: 5 }])] as any,
    });
    expect(res.plan).toBeNull();
    expect(res.reason).toContain('would not change');
  });
});
