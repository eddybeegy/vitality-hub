import { describe, expect, it } from 'vitest';
import { analyseStrength, estimate1RM, prSetKey, type StrengthWorkout } from './strength';

const day = (ts: string) => ts.slice(0, 10);

const session = (id: number, timestamp: string, title: string, sets: Array<[number, number, string?]>, type = 'strength'): StrengthWorkout => ({
  id,
  timestamp,
  exercises: [{ title, type, sets: sets.map(([weight, reps, setType]) => ({ weight, reps, type: setType ?? 'normal' })) }],
});

describe('estimate1RM', () => {
  it('counts a single as its own 1RM (the old Top Exercises code skipped reps = 1)', () => {
    expect(estimate1RM(140, 1)).toBe(140);
  });
  it('uses Epley for 2-12 reps', () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.667, 3);
    expect(estimate1RM(60, 12)).toBeCloseTo(84, 6);
  });
  it('gives no estimate past 12 reps or without weight', () => {
    expect(estimate1RM(40, 20)).toBeNull();
    expect(estimate1RM(0, 5)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
  });
});

describe('analyseStrength', () => {
  it("an exercise's first session is a baseline, not a PR", () => {
    const out = analyseStrength([session(1, '2026-10-01T09:00:00Z', 'Bench Press', [[60, 8], [80, 5]])], day);
    expect(out.prs).toEqual([]);
    expect(out.prSets).toEqual({});
    expect(out.exercises[0].bestE1rm?.weight).toBe(80);
    expect(out.exercises[0].repMaxes[5]?.weight).toBe(80);
    expect(out.exercises[0].repMaxes[10]).toBeNull();
  });

  it('credits only the best set of a session that climbs through heavier sets', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'Squat', [[100, 5]]),
      session(2, '2026-10-08T09:00:00Z', 'Squat', [[102.5, 5], [105, 5], [107.5, 5]]),
    ], day);
    expect(Object.keys(out.prSets)).toEqual([prSetKey(2, 0, 2)]);
    expect(out.prSets[prSetKey(2, 0, 2)].sort()).toEqual(['1rm', '3rm', '5rm', 'e1rm']);
    expect(out.prCountByWorkout['2']).toBe(1);
  });

  it('a heavier triple is a 3RM and 1RM PR but not a 5RM PR', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'Deadlift', [[140, 5]]),
      session(2, '2026-10-08T09:00:00Z', 'Deadlift', [[150, 3]]),
    ], day);
    const kinds = out.prSets[prSetKey(2, 0, 0)];
    expect(kinds).toContain('3rm');
    expect(kinds).toContain('1rm');
    expect(kinds).not.toContain('5rm');
    // 150x3 = 165 e1RM beats 140x5 = 163.3
    expect(kinds).toContain('e1rm');
  });

  it('ignores warm-up sets, bodyweight and cardio exercises', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'Bench Press', [[80, 5]]),
      session(2, '2026-10-08T09:00:00Z', 'Bench Press', [[90, 5, 'warmup'], [80, 5]]),
      session(3, '2026-10-01T09:00:00Z', 'Pull Up', [[10, 10]], 'bodyweight'),
      session(4, '2026-10-08T09:00:00Z', 'Pull Up', [[20, 10]], 'bodyweight'),
    ], day);
    expect(out.prs).toEqual([]);
    expect(out.exercises.map(e => e.title)).toEqual(['Bench Press']);
  });

  it('does not call the first ever 10RM a PR when heavier low-rep sets exist', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'Row', [[80, 5]]),
      session(2, '2026-10-08T09:00:00Z', 'Row', [[60, 10]]),
      session(3, '2026-10-15T09:00:00Z', 'Row', [[62.5, 10]]),
    ], day);
    expect(out.prSets[prSetKey(2, 0, 0)]).toBeUndefined();
    expect(out.prSets[prSetKey(3, 0, 0)]).toEqual(['10rm']);
  });

  it('keeps sets over 12 reps out of e1RM but counts them for 10RM', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'Leg Press', [[100, 10]]),
      session(2, '2026-10-08T09:00:00Z', 'Leg Press', [[110, 20]]),
    ], day);
    expect(out.prSets[prSetKey(2, 0, 0)]).toEqual(['1rm', '3rm', '5rm', '10rm']);
    expect(out.exercises[0].sessions.map(s => s.e1rm)).toEqual([expect.closeTo(133.333, 3), null]);
  });

  it('walks sessions oldest-first whatever order they arrive in, and lists PRs newest first', () => {
    const out = analyseStrength([
      session(3, '2026-10-15T09:00:00Z', 'OHP', [[50, 5]]),
      session(1, '2026-10-01T09:00:00Z', 'OHP', [[40, 5]]),
      session(2, '2026-10-08T09:00:00Z', 'OHP', [[45, 5]]),
    ], day);
    expect(out.prs.map(p => p.workoutId)).toEqual([3, 2]);
    expect(out.exercises[0].sessions.map(s => s.day)).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
  });

  it('a tie is not a PR', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'Curl', [[20, 8]]),
      session(2, '2026-10-08T09:00:00Z', 'Curl', [[20, 8]]),
    ], day);
    expect(out.prs).toEqual([]);
  });

  it('keeps the better session when one day has two', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T08:00:00Z', 'Bench Press', [[80, 5]]),
      session(2, '2026-10-01T18:00:00Z', 'Bench Press', [[70, 5]]),
    ], day);
    expect(out.exercises[0].sessions).toHaveLength(1);
    expect(out.exercises[0].sessions[0].workoutId).toBe(1);
  });

  it('sorts exercises by number of sessions', () => {
    const out = analyseStrength([
      session(1, '2026-10-01T09:00:00Z', 'A', [[10, 5]]),
      session(2, '2026-10-02T09:00:00Z', 'B', [[10, 5]]),
      session(3, '2026-10-03T09:00:00Z', 'B', [[10, 5]]),
    ], day);
    expect(out.exercises.map(e => e.title)).toEqual(['B', 'A']);
  });
});
