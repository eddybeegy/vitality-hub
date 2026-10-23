/**
 * Foods you already eat that would close a micronutrient gap (roadmap: "Weekly
 * micronutrient gaps" -> the second half of that idea, which #57 left unbuilt).
 *
 * weeklyMicroGaps() names the nutrients averaging under GAP_PCT of target. This
 * answers "so what do I eat": for each gap it ranks the user's OWN logged foods
 * by how cheaply, in calories, a realistic number of servings closes the daily
 * shortfall. Nothing here invents a food. If his log has no usable source for a
 * nutrient, that nutrient gets a `reason` and no suggestions -- the same
 * refuse-rather-than-guess rule as progressionPlan.
 *
 * Why these choices:
 *
 * - **Per-serving is the MEDIAN of the logged amounts, not the mean.** `meal_items`
 *   rows are whole logged portions and the portion varies (one 4x cashew night
 *   drags a mean well past anything he would actually eat again). The median is
 *   the serving he typically logs.
 * - **Only rows where the nutrient is > 0 count.** Cronometer omits zero values,
 *   so a 0 or NULL means "this food's value for this nutrient was not recorded"
 *   and is indistinguishable from a true zero. Either way it is not a source
 *   worth suggesting, so both are excluded -- but note that excludes them from
 *   the serving median too, which is correct: we are describing the food as a
 *   source, not auditing his intake. (The intake side is microGaps' job, and it
 *   deliberately counts a missing nutrient as 0.)
 * - **A food must be logged at least MIN_LOGGINGS times** in the window. A
 *   one-off restaurant dish is not a food "you already eat", and a single row is
 *   also a single data point for the median.
 * - **Ranked by total calorie cost to close the gap** (`servingsToClose x
 *   kcalPerServing`), lowest first, tie-broken by how often it is logged. Ranking
 *   on raw nutrient density would put a vitamin pill-like outlier top; ranking on
 *   frequency alone would recommend whatever he eats most regardless of whether it
 *   contains the nutrient. Calorie cost is the thing he actually trades away.
 * - **Suggestions needing more than MAX_SERVINGS servings are dropped.** "Six
 *   servings of spinach" is not advice. If every candidate is over the cap the
 *   nutrient reports that, which is itself the useful finding: nothing he
 *   currently eats can close this one.
 *
 * Calories are whatever `meal_items.calories` holds (kcal). Nutrient units are
 * the column's own and match MICRO_TARGETS, so no conversion happens here.
 *
 * KNOWN LIMITATION, deliberately not fixed: foods are grouped by the logged name
 * lowercased, so two Cronometer entries for the same thing stay separate and can
 * take two of the three slots -- live on 2026-10-23 fibre offered "Pear, Fresh"
 * and "Pears, Raw", and vitamin C offered two kinds of potato. Merging them needs
 * a food ontology this has no access to, and a wrong merge would average two
 * different portion sizes into a per-serving figure that matches neither. Two
 * honest near-duplicates beat one confident wrong number.
 */
import { addDays } from './dayTags';
import type { MicroAverage } from './microGaps';

/** How far back to look for foods he eats. Matches the summary payload's window. */
export const WINDOW_DAYS = 90;
/** Times a food must appear in the window before it can be suggested. */
export const MIN_LOGGINGS = 2;
/** Most servings of one food we will ever propose in a day. */
export const MAX_SERVINGS = 4;
/** Suggestions returned per nutrient. */
export const PER_NUTRIENT = 3;

/** The subset of a `meal_items` row this needs. Nutrient keys are column names. */
export interface MealItemRow {
  name?: string | null;
  calories?: number | string | null;
  timestamp?: string | null;
  [nutrient: string]: unknown;
}

export interface FoodSuggestion {
  /** The food's name exactly as it is logged, so it is findable in Cronometer. */
  name: string;
  /** Median logged amount of the nutrient in one serving. */
  perServing: number;
  /** Median calories of one serving, or null when the rows carry no calories. */
  kcalPerServing: number | null;
  /** Servings needed to cover the daily shortfall, 1..MAX_SERVINGS. */
  servingsToClose: number;
  /** servingsToClose x kcalPerServing, or null when calories are unknown. */
  kcalCost: number | null;
  timesLogged: number;
}

export interface NutrientSuggestions {
  nutrient: string;
  label: string;
  /** Daily shortfall against target: target - average, always > 0. */
  deficit: number;
  foods: FoodSuggestion[];
  /** Set only when `foods` is empty, explaining which way it came up empty. */
  reason?: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Lower median: for an even count takes the lower of the two middles. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * @param gaps      The `gaps` array from weeklyMicroGaps(), or any subset of its averages.
 * @param mealItems `meal_items` rows; rows outside the window or without a name are ignored.
 * @param today     Calendar day key in the user's zone, as elsewhere.
 */
export function suggestFoodsForGaps(
  gaps: MicroAverage[],
  mealItems: MealItemRow[],
  today: string,
  windowDays: number = WINDOW_DAYS
): NutrientSuggestions[] {
  const from = addDays(today, -(windowDays - 1));
  const inWindow = mealItems.filter(m => {
    const day = String(m.timestamp ?? '').slice(0, 10);
    return day >= from && day <= today && String(m.name ?? '').trim() !== '';
  });

  return gaps.map(gap => {
    const deficit = gap.target - gap.average;
    const base: NutrientSuggestions = {
      nutrient: gap.nutrient,
      label: gap.label,
      deficit,
      foods: [],
    };
    // A nutrient already at or over target is not a gap; say so rather than
    // dividing by a zero or negative shortfall.
    if (!(deficit > 0)) return { ...base, reason: 'already at target' };

    // name -> the nutrient amounts and calories of each serving that recorded it
    const byFood = new Map<string, { name: string; amounts: number[]; kcals: number[] }>();
    for (const m of inWindow) {
      const amount = num(m[gap.nutrient]);
      if (amount === null || amount <= 0) continue;
      const name = String(m.name).trim();
      const key = name.toLowerCase();
      const entry = byFood.get(key) ?? { name, amounts: [], kcals: [] };
      entry.amounts.push(amount);
      const kcal = num(m.calories);
      if (kcal !== null && kcal > 0) entry.kcals.push(kcal);
      byFood.set(key, entry);
    }

    if (byFood.size === 0) {
      return { ...base, reason: `nothing in the last ${windowDays} days records ${gap.label}` };
    }

    const repeated = [...byFood.values()].filter(f => f.amounts.length >= MIN_LOGGINGS);
    if (repeated.length === 0) {
      return {
        ...base,
        reason: `no food logged ${MIN_LOGGINGS}+ times records ${gap.label}`,
      };
    }

    const candidates: FoodSuggestion[] = repeated.map(f => {
      const perServing = median(f.amounts);
      const kcalPerServing = f.kcals.length ? median(f.kcals) : null;
      const servingsToClose = Math.ceil(deficit / perServing);
      return {
        name: f.name,
        perServing,
        kcalPerServing,
        servingsToClose,
        kcalCost: kcalPerServing === null ? null : servingsToClose * kcalPerServing,
        timesLogged: f.amounts.length,
      };
    });

    const affordable = candidates.filter(c => c.servingsToClose <= MAX_SERVINGS);
    if (affordable.length === 0) {
      const best = candidates.reduce((a, b) => (a.servingsToClose <= b.servingsToClose ? a : b));
      return {
        ...base,
        reason:
          `nothing you eat closes ${gap.label} in ${MAX_SERVINGS} servings or fewer ` +
          `(closest: ${best.name}, ${best.servingsToClose})`,
      };
    }

    // Cheapest in calories first. A food with no recorded calories cannot be
    // compared on cost, so it sorts after every food that can -- it is still a
    // real option, just an unpriced one.
    affordable.sort((a, b) => {
      if (a.kcalCost === null && b.kcalCost === null) return b.timesLogged - a.timesLogged;
      if (a.kcalCost === null) return 1;
      if (b.kcalCost === null) return -1;
      if (a.kcalCost !== b.kcalCost) return a.kcalCost - b.kcalCost;
      return b.timesLogged - a.timesLogged;
    });

    return { ...base, foods: affordable.slice(0, PER_NUTRIENT) };
  });
}
