import { describe, expect, it } from 'vitest';
import { suggestTargets } from './adaptiveTargets';

describe('suggestTargets', () => {
  it('maintains with no goal, or a goal inside 0.5 kg', () => {
    expect(suggestTargets({ tdee: 2612, trendWeightKg: 80 })).toMatchObject({ direction: 'maintain', ratePerWeek: 0, calories: 2600 });
    expect(suggestTargets({ tdee: 2612, trendWeightKg: 80, goalWeightKg: 79.6 }).direction).toBe('maintain');
    expect(suggestTargets({ tdee: 2612, trendWeightKg: 80, goalWeightKg: 0 }).direction).toBe('maintain');
  });

  it('loses at 0.5% of body weight a week, capped at 0.5 kg', () => {
    const s = suggestTargets({ tdee: 2600, trendWeightKg: 80, goalWeightKg: 75 });
    expect(s.direction).toBe('lose');
    expect(s.ratePerWeek).toBeCloseTo(-0.4, 6);
    expect(s.calories).toBe(Math.round((2600 - (0.4 * 7700) / 7) / 50) * 50); // 2160 -> 2150
    expect(suggestTargets({ tdee: 3200, trendWeightKg: 120, goalWeightKg: 100 }).ratePerWeek).toBe(-0.5);
  });

  it('gains at 0.25% a week, capped at 0.25 kg', () => {
    const s = suggestTargets({ tdee: 2600, trendWeightKg: 70, goalWeightKg: 75 });
    expect(s.direction).toBe('gain');
    expect(s.ratePerWeek).toBeCloseTo(0.175, 6);
    expect(s.calories).toBe(2800);
  });

  it('never suggests under 1500 kcal', () => {
    expect(suggestTargets({ tdee: 1600, trendWeightKg: 60, goalWeightKg: 50 }).calories).toBe(1500);
  });

  it('sets protein from lean mass when it is plausible, else body weight', () => {
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80, leanMassKg: 64 })).toMatchObject({ protein: 140, proteinBasis: 'lean_mass' });
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80, leanMassKg: 90 })).toMatchObject({ protein: 145, proteinBasis: 'body_weight' });
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80 }).protein).toBe(145);
  });
});
