import { describe, expect, it } from 'vitest';
import {
  FOCUS_LABELS, HEART_FIBER_G, RECOMP_DEFICIT_KCAL,
  fatGapKg, normaliseFocus, suggestTargets,
} from './adaptiveTargets';
import { KCAL_PER_KG } from './tdee';

describe('normaliseFocus', () => {
  it('accepts every stored label', () => {
    for (const [focus, label] of Object.entries(FOCUS_LABELS)) {
      expect(normaliseFocus(label)).toBe(focus);
    }
  });

  it('is case- and punctuation-insensitive, and tolerates synonyms', () => {
    expect(normaliseFocus('body recomposition')).toBe('recomp');
    expect(normaliseFocus('Body Recomp')).toBe('recomp');
    expect(normaliseFocus('WEIGHT-LOSS')).toBe('fat_loss');
    expect(normaliseFocus('Hypertrophy')).toBe('muscle_gain');
    expect(normaliseFocus('maintenance')).toBe('maintain');
    expect(normaliseFocus('Marathon')).toBe('endurance');
    expect(normaliseFocus('rehab')).toBe('injury');
  });

  it('maps longevity to heart health rather than inventing a tenth focus', () => {
    expect(normaliseFocus('Longevity')).toBe('heart');
    expect(normaliseFocus('healthspan')).toBe('heart');
    expect(normaliseFocus('blood pressure')).toBe('heart');
  });

  it('falls back to general for anything unrecognised', () => {
    expect(normaliseFocus(undefined)).toBe('general');
    expect(normaliseFocus(null)).toBe('general');
    expect(normaliseFocus('')).toBe('general');
    expect(normaliseFocus('skiing in March')).toBe('general');
  });
});

describe('fatGapKg', () => {
  it('holds lean mass constant: 80 kg at 25% needs 5 kg off to reach 20%', () => {
    expect(fatGapKg(80, 25, 20)).toBeCloseTo(5, 10);
  });

  it('is negative when already below the target', () => {
    expect(fatGapKg(80, 18, 20)!).toBeLessThan(0);
  });

  it('refuses impossible inputs rather than returning a number', () => {
    expect(fatGapKg(0, 25, 20)).toBeNull();
    expect(fatGapKg(80, 0, 20)).toBeNull();
    expect(fatGapKg(80, 100, 20)).toBeNull();
    expect(fatGapKg(80, 25, 100)).toBeNull();
  });
});

describe('suggestTargets, general health (the original rule)', () => {
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
    expect(suggestTargets({ tdee: 1600, trendWeightKg: 60, focus: 'Fat Loss', bodyFatPct: 30, bodyFatTargetPct: 20 }).calories).toBe(1500);
  });

  it('sets protein from lean mass when it is plausible, else body weight', () => {
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80, leanMassKg: 64 })).toMatchObject({ protein: 140, proteinBasis: 'lean_mass' });
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80, leanMassKg: 90 })).toMatchObject({ protein: 145, proteinBasis: 'body_weight' });
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80 }).protein).toBe(145);
  });

  it('reports the focus it used', () => {
    expect(suggestTargets({ tdee: 2600, trendWeightKg: 80 })).toMatchObject({ focus: 'general', focusLabel: 'General Health' });
  });
});

// The whole point of item 98: someone 0.2 kg from their weight goal but 5 kg of fat
// above their body-fat target gets maintenance calories under the old rule.
const AT_WEIGHT_GOAL_BUT_FAT = {
  tdee: 2600, trendWeightKg: 80, goalWeightKg: 79.8,
  bodyFatPct: 25, bodyFatTargetPct: 20, leanMassKg: 60,
};

describe('suggestTargets, fat loss', () => {
  it('drives off the fat gap where the scale gap sees nothing', () => {
    expect(suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT }).calories).toBe(2600);
    const s = suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Fat Loss' });
    expect(s.direction).toBe('lose');
    expect(s.ratePerWeek).toBeCloseTo(-0.4, 6);
    expect(s.calories).toBe(2150);
    expect(s.why).toContain('5 kg of fat above your 20% target');
    expect(s.fallback).toBeUndefined();
  });

  it('maintains once the fat gap is inside the band', () => {
    const s = suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Fat Loss', bodyFatPct: 20.2 });
    expect(s.direction).toBe('maintain');
    expect(s.calories).toBe(2600);
  });

  it('falls back to the weight goal when the driver is missing, and says so', () => {
    const noReading = suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Fat Loss', bodyFatPct: null, goalWeightKg: 75 });
    expect(noReading.fallback).toContain('no body-fat reading');
    expect(noReading.direction).toBe('lose');
    expect(noReading.calories).toBe(2150);

    const noTarget = suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Fat Loss', bodyFatTargetPct: null });
    expect(noTarget.fallback).toContain('no body-fat target');
    expect(noTarget.direction).toBe('maintain');
  });

  it('puts protein on lean mass at 2.2 g/kg', () => {
    expect(suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Fat Loss' })).toMatchObject({ protein: 130, proteinBasis: 'lean_mass' });
  });
});

describe('suggestTargets, muscle gain', () => {
  const base = { tdee: 2600, trendWeightKg: 80, goalWeightKg: 79.8, focus: 'Muscle Gain', leanMassKg: 60 };

  it('drives off the muscle-mass gap, in a surplus', () => {
    const s = suggestTargets({ ...base, muscleMassKg: 60, muscleMassTargetKg: 62 });
    expect(s.direction).toBe('gain');
    expect(s.ratePerWeek).toBeCloseTo(0.2, 6);
    expect(s.calories).toBe(2800);
    expect(s.why).toContain('2 kg under your 62 kg muscle-mass target');
  });

  it('maintains once muscle mass is at target', () => {
    expect(suggestTargets({ ...base, muscleMassKg: 61.8, muscleMassTargetKg: 62 }).direction).toBe('maintain');
  });

  it('falls back to the weight goal with no reading or no target', () => {
    expect(suggestTargets({ ...base, muscleMassTargetKg: 62 }).fallback).toContain('no muscle-mass reading');
    expect(suggestTargets({ ...base, muscleMassKg: 60 }).fallback).toContain('no muscle-mass target');
  });
});

describe('suggestTargets, body recomposition', () => {
  const base = { ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Body Recomposition' };

  it('takes a small deficit while fat is above target', () => {
    const s = suggestTargets(base);
    expect(s.direction).toBe('recomp');
    expect(s.calories).toBe(2350);
    expect(s.ratePerWeek).toBeCloseTo(-(RECOMP_DEFICIT_KCAL * 7) / KCAL_PER_KG, 10);
    expect(s.why).toContain(`${RECOMP_DEFICIT_KCAL} kcal deficit`);
  });

  it('eats at maintenance once fat is at target but muscle is short', () => {
    const s = suggestTargets({ ...base, bodyFatPct: 20.1, muscleMassKg: 58, muscleMassTargetKg: 62 });
    expect(s.direction).toBe('recomp');
    expect(s.calories).toBe(2600);
    expect(s.why).toContain('muscle mass is 4 kg short');
  });

  it('maintains when both are at target', () => {
    const s = suggestTargets({ ...base, bodyFatPct: 20.1, muscleMassKg: 61.9, muscleMassTargetKg: 62 });
    expect(s.direction).toBe('maintain');
    expect(s.calories).toBe(2600);
  });

  it('never eats in a surplus, even when falling back to a weight goal above the trend', () => {
    const s = suggestTargets({ ...base, bodyFatPct: null, trendWeightKg: 70, goalWeightKg: 75 });
    expect(s.direction).toBe('maintain');
    expect(s.calories).toBe(2600);
    expect(s.fallback).toContain('no body-fat reading');
    expect(s.why).toContain('never eats in a surplus');
  });

  it('puts protein on lean mass at 2.4 g/kg', () => {
    expect(suggestTargets(base)).toMatchObject({ protein: 145, proteinBasis: 'lean_mass' });
  });
});

describe('suggestTargets, the maintenance focuses', () => {
  const base = { tdee: 2600, trendWeightKg: 80, goalWeightKg: 70, leanMassKg: 60, bodyFatPct: 25, bodyFatTargetPct: 20 };

  it('ignores both goals and holds calories at TDEE', () => {
    for (const focus of ['Strength', 'Endurance', 'Maintain Weight', 'Heart Health', 'Injury Recovery']) {
      const s = suggestTargets({ ...base, focus });
      expect(s.direction, focus).toBe('maintain');
      expect(s.ratePerWeek, focus).toBe(0);
      expect(s.calories, focus).toBe(2600);
    }
  });

  it('keeps protein on lean mass where muscle is the point, body weight where it is not', () => {
    expect(suggestTargets({ ...base, focus: 'Strength' })).toMatchObject({ protein: 130, proteinBasis: 'lean_mass' });
    expect(suggestTargets({ ...base, focus: 'Injury Recovery' })).toMatchObject({ protein: 130, proteinBasis: 'lean_mass' });
    expect(suggestTargets({ ...base, focus: 'Endurance' })).toMatchObject({ protein: 145, proteinBasis: 'body_weight' });
    expect(suggestTargets({ ...base, focus: 'Maintain Weight' })).toMatchObject({ protein: 145, proteinBasis: 'body_weight' });
    expect(suggestTargets({ ...base, focus: 'Heart Health' })).toMatchObject({ protein: 145, proteinBasis: 'body_weight' });
  });

  it('adds carbs for endurance and fibre for heart health, and nothing elsewhere', () => {
    expect(suggestTargets({ ...base, focus: 'Endurance' }).carbs).toBe(400);
    expect(suggestTargets({ ...base, focus: 'Heart Health' }).fiber).toBe(HEART_FIBER_G);
    const plain = suggestTargets({ ...base, focus: 'Strength' });
    expect(plain.carbs).toBeUndefined();
    expect(plain.fiber).toBeUndefined();
    expect(suggestTargets({ ...base, focus: 'Endurance' }).fiber).toBeUndefined();
    expect(suggestTargets({ ...base, focus: 'Heart Health' }).carbs).toBeUndefined();
  });
});

describe('suggestTargets, protein as a floor', () => {
  const base = { ...AT_WEIGHT_GOAL_BUT_FAT, currentProteinG: 160 };

  it('keeps an existing higher target instead of cutting it', () => {
    const s = suggestTargets({ ...base, focus: 'Body Recomposition' });
    expect(s.protein).toBe(160);
    expect(s.proteinFloored).toBe(true);
  });

  it('still raises protein when the formula is higher', () => {
    const s = suggestTargets({ ...base, focus: 'Body Recomposition', currentProteinG: 100 });
    expect(s.protein).toBe(145);
    expect(s.proteinFloored).toBe(false);
  });

  it('does not floor the body-weight focuses, where a lower number is the point', () => {
    const s = suggestTargets({ ...base, focus: 'Endurance' });
    expect(s.protein).toBe(145);
    expect(s.proteinFloored).toBe(false);
  });

  it('is inert with no stored target', () => {
    expect(suggestTargets({ ...AT_WEIGHT_GOAL_BUT_FAT, focus: 'Fat Loss' }).proteinFloored).toBe(false);
  });
});
