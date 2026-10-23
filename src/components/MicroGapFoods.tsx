import React from 'react';
import { suggestFoodsForGaps, type MealItemRow } from '../lib/foodSuggestions';
import type { MicroAverage } from '../lib/microGaps';

/**
 * The "and here is what to eat" half of the weekly micronutrient gaps card.
 *
 * Renders, per short nutrient, up to three of the user's OWN logged foods and
 * how many servings of each would cover the daily shortfall, cheapest in
 * calories first (the ranking and all the refusal rules live in
 * src/lib/foodSuggestions.ts).
 *
 * When a nutrient has no usable source in the log this shows the reason rather
 * than nothing, because "no suggestion" and "nothing you eat contains this" are
 * different findings and the second is the more useful one. Vitamin D is the
 * nutrient most likely to hit it: only 198 of 2,869 logged foods record it at
 * all (though on 2026-10-23 it was averaging 405% of target, so not a gap).
 */
export const MicroGapFoods = React.memo(
  ({ gaps, mealItems, today }: { gaps: MicroAverage[]; mealItems: MealItemRow[]; today: string }) => {
    const suggestions = React.useMemo(
      () => suggestFoodsForGaps(gaps, mealItems, today),
      [gaps, mealItems, today]
    );
    if (suggestions.length === 0) return null;

    const round = (x: number) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

    return (
      <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/5 space-y-1.5">
        <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
          From what you already eat
        </p>
        {suggestions.map(s => (
          <div key={s.nutrient} className="text-[11px] leading-snug">
            <span className="font-semibold text-zinc-600 dark:text-zinc-300">
              {s.label} &middot; short {round(s.deficit)}/day
            </span>
            {s.foods.length === 0 ? (
              <span className="text-zinc-400 dark:text-zinc-500"> &mdash; {s.reason}</span>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {s.foods.map(f => (
                  <li key={f.name} className="text-zinc-500 dark:text-zinc-400 flex gap-1.5">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                      {f.servingsToClose}&times;
                    </span>
                    <span className="truncate" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                      ({round(f.perServing)} each
                      {f.kcalCost === null ? ', kcal unknown' : `, ${Math.round(f.kcalCost)} kcal`})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    );
  }
);
