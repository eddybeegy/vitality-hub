/**
 * Targets that adjust themselves (roadmap: "Targets that adjust themselves").
 *
 * Turns the adaptive TDEE (item 73) and the weight goal into a suggested daily
 * calorie target, and lean mass into a protein target. Suggestions only: the
 * user decides whether to copy them into Targets.
 *
 * - Goal rate: losing at 0.5% of body weight a week (capped at 0.5 kg),
 *   gaining at 0.25% (capped at 0.25 kg), or maintaining when the trend is
 *   within MAINTAIN_BAND_KG of the goal or no goal is set. Those are the usual
 *   rates that keep muscle on a cut and limit fat on a gain.
 * - Calories: TDEE + rate x 7700 / 7, rounded to 50, with the deficit capped at
 *   MAX_DEFICIT and never under MIN_CALORIES.
 * - Protein: 2.2 g per kg of lean mass when Withings has it, otherwise
 *   1.8 g per kg of body weight, rounded to 5 g.
 */
import { KCAL_PER_KG } from './tdee';

export const MAINTAIN_BAND_KG = 0.5;
export const MAX_DEFICIT = 1000;
export const MIN_CALORIES = 1500;

export type GoalDirection = 'lose' | 'gain' | 'maintain';

export interface TargetSuggestion {
  direction: GoalDirection;
  /** kg per week, negative when losing. */
  ratePerWeek: number;
  calories: number;
  protein: number;
  proteinBasis: 'lean_mass' | 'body_weight';
}

const round = (x: number, step: number) => Math.round(x / step) * step;

export function suggestTargets(input: {
  tdee: number;
  trendWeightKg: number;
  goalWeightKg?: number | null;
  leanMassKg?: number | null;
}): TargetSuggestion {
  const { tdee, trendWeightKg: w } = input;
  const goal = input.goalWeightKg && input.goalWeightKg > 0 ? input.goalWeightKg : null;

  let direction: GoalDirection = 'maintain';
  let ratePerWeek = 0;
  if (goal != null && Math.abs(w - goal) >= MAINTAIN_BAND_KG) {
    direction = goal < w ? 'lose' : 'gain';
    ratePerWeek = direction === 'lose' ? -Math.min(0.5, 0.005 * w) : Math.min(0.25, 0.0025 * w);
  }

  const delta = Math.max(-MAX_DEFICIT, (ratePerWeek * KCAL_PER_KG) / 7);
  const calories = Math.max(MIN_CALORIES, round(tdee + delta, 50));

  const lean = input.leanMassKg && input.leanMassKg > 0 && input.leanMassKg < w ? input.leanMassKg : null;
  const protein = round(lean ? 2.2 * lean : 1.8 * w, 5);

  return { direction, ratePerWeek, calories, protein, proteinBasis: lean ? 'lean_mass' : 'body_weight' };
}
