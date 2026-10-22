import { describe, expect, it } from 'vitest';
import { muscleLabel, setStatus, weeklySetsByMuscle } from './weeklySets';

const LONDON = 'Europe/London';
const TODAY = '2026-10-22';

const sets = (n: number, type = 'normal') => Array.from({ length: n }, () => ({ type }));

describe('weeklySetsByMuscle', () => {
  it('counts primary 1 and secondary 0.5, skipping warm-ups and cardio', () => {
    const r = weeklySetsByMuscle([
      {
        timestamp: '2026-10-21T07:00:00Z',
        exercises: [
          { type: 'strength', primaryMuscleGroup: 'chest', secondaryMuscleGroups: ['triceps'], sets: [...sets(2, 'warmup'), ...sets(4)] },
          { type: 'strength', primaryMuscleGroup: 'triceps', sets: sets(3) },
          { type: 'cardio', primaryMuscleGroup: 'quadriceps', sets: sets(1) },
        ],
      },
    ], TODAY, LONDON);
    expect(r).toEqual([
      { group: 'triceps', label: 'Triceps', sets: 5, status: 'under' },
      { group: 'chest', label: 'Chest', sets: 4, status: 'under' },
    ]);
  });

  it('uses the last 7 London calendar days, including a just-after-midnight BST workout', () => {
    const ex = [{ type: 'strength', primaryMuscleGroup: 'lats', sets: sets(10) }];
    const r = weeklySetsByMuscle([
      { timestamp: '2026-10-15T22:30:00Z', exercises: ex }, // 23:30 BST 15 Oct: 8 days back, out
      { timestamp: '2026-10-15T23:30:00Z', exercises: ex }, // 00:30 BST 16 Oct: first day of the window, in
      { timestamp: '2026-10-22T10:00:00Z', exercises: ex }, // today, in
      { timestamp: '2026-10-23T10:00:00Z', exercises: ex }, // future, out
    ], TODAY, LONDON);
    expect(r).toEqual([{ group: 'lats', label: 'Lats', sets: 20, status: 'in_range' }]);
  });

  it('is empty with nothing in the week', () => {
    expect(weeklySetsByMuscle([], TODAY, LONDON)).toEqual([]);
  });
});

describe('setStatus', () => {
  it('splits at 10 and 20 inclusive', () => {
    expect(setStatus(9.5)).toBe('under');
    expect(setStatus(10)).toBe('in_range');
    expect(setStatus(20)).toBe('in_range');
    expect(setStatus(20.5)).toBe('over');
  });
});

describe('muscleLabel', () => {
  it('title-cases snake case', () => {
    expect(muscleLabel('upper_back')).toBe('Upper Back');
  });
});
