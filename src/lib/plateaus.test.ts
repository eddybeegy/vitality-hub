import { describe, expect, it } from 'vitest';
import { classifyProgress } from './plateaus';
import { addDays } from './dayTags';
import type { ExerciseStrength } from './strength';

const TODAY = '2026-10-22';

function exercise(title: string, points: [number, number][]): ExerciseStrength {
  return {
    title,
    sessions: points.map(([daysAgo, e1rm], i) => ({ day: addDays(TODAY, -daysAgo), workoutId: `${title}-${i}`, e1rm })),
    bestE1rm: null,
    repMaxes: { 1: null, 3: null, 5: null, 10: null },
  };
}

describe('classifyProgress', () => {
  it('sorts regressing, plateau, progressing and gives each a suggestion', () => {
    const r = classifyProgress([
      exercise('Squat', [[60, 140], [45, 145], [20, 150], [5, 152]]),
      exercise('Bench', [[60, 100], [40, 101], [20, 100.5], [3, 100]]),
      exercise('Row', [[50, 90], [35, 92], [15, 85], [2, 86]]),
    ], TODAY);
    expect(r.map(p => [p.title, p.status])).toEqual([
      ['Row', 'regressing'],
      ['Bench', 'plateau'],
      ['Squat', 'progressing'],
    ]);
    expect(r[1].change).toBeCloseTo(100.5 / 101 - 1, 6);
    expect(r[1].suggestion).toMatch(/lighter week/);
  });

  it('needs two sessions in each window and one in the last 14 days', () => {
    const r = classifyProgress([
      exercise('One recent', [[60, 100], [40, 100], [3, 100]]),
      exercise('One prior', [[40, 100], [10, 100], [3, 100]]),
      exercise('Dropped', [[60, 100], [40, 100], [25, 100], [20, 100]]),
      exercise('Too old', [[100, 100], [90, 100], [10, 100], [3, 100]]),
    ], TODAY);
    expect(r).toEqual([]);
  });

  it('puts the 28-day boundary on calendar days: 27 days ago is recent, 28 is prior', () => {
    const r = classifyProgress([exercise('Deadlift', [[60, 180], [28, 180], [27, 200], [1, 200]])], TODAY);
    expect(r).toHaveLength(1);
    expect(r[0].priorBest).toBe(180);
    expect(r[0].recentBest).toBe(200);
  });

  it('ignores sessions with no e1RM and future days', () => {
    const ex = exercise('Press', [[60, 60], [40, 60], [10, 60], [2, 60]]);
    ex.sessions.push({ day: addDays(TODAY, -1), workoutId: 'x', e1rm: null });
    ex.sessions.push({ day: addDays(TODAY, 1), workoutId: 'y', e1rm: 80 });
    const r = classifyProgress([ex], TODAY);
    expect(r[0].status).toBe('plateau');
    expect(r[0].recentSessions).toBe(2);
  });
});
