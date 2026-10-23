import { describe, expect, it } from 'vitest';
import { MAX_SERVINGS, MIN_LOGGINGS, suggestFoodsForGaps } from './foodSuggestions';
import { addDays } from './dayTags';
import type { MicroAverage } from './microGaps';

const TODAY = '2026-10-22';

const gap = (nutrient: string, average: number, target: number): MicroAverage => ({
  nutrient,
  label: nutrient,
  average,
  target,
  pct: (average / target) * 100,
});

/** A meal_items row: a name, a day offset, calories, and nutrient columns. */
const item = (
  name: string,
  daysAgo: number,
  calories: number | null,
  nutrients: Record<string, number | null> = {}
) => ({ name, timestamp: addDays(TODAY, -daysAgo), calories, ...nutrients });

describe('suggestFoodsForGaps', () => {
  it('ranks by the calorie cost of closing the gap, not by density or frequency', () => {
    // Shortfall 200 mg. cashews: 100/serving -> 2 servings x 250 = 500 kcal.
    // spinach: 50/serving -> 4 servings x 20 = 80 kcal (cheapest, though weaker per serving).
    // chocolate: 200/serving -> 1 serving x 600 = 600 kcal (strongest per serving, dearest).
    const meals = [
      ...[1, 2, 3].map(d => item('cashews', d, 250, { magnesium: 100 })),
      ...[1, 2].map(d => item('spinach', d, 20, { magnesium: 50 })),
      ...[1, 2, 3, 4].map(d => item('chocolate', d, 600, { magnesium: 200 })),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 200, 400)], meals, TODAY);
    expect(out.deficit).toBe(200);
    expect(out.foods.map(f => [f.name, f.servingsToClose, f.kcalCost])).toEqual([
      ['spinach', 4, 80],
      ['cashews', 2, 500],
      ['chocolate', 1, 600],
    ]);
  });

  it('uses the median serving, so one outsized portion cannot set the suggestion', () => {
    // 20, 20, 400 -> median 20, so the gap takes 5 servings and is refused.
    // A mean of 147 would have claimed 2 servings closes it.
    const meals = [
      item('cashews', 1, 250, { magnesium: 20 }),
      item('cashews', 2, 250, { magnesium: 20 }),
      item('cashews', 3, 900, { magnesium: 400 }),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods).toEqual([]);
    expect(out.reason).toContain(`${MAX_SERVINGS} servings or fewer`);
    expect(out.reason).toContain('cashews, 5');
  });

  it('ignores rows where the nutrient is zero, null or absent, as Cronometer omits zeros', () => {
    const meals = [
      item('chicken', 1, 245, { magnesium: 0 }),
      item('chicken', 2, 245, { magnesium: null }),
      item('chicken', 3, 245),
      item('cashews', 1, 250, { magnesium: 100 }),
      item('cashews', 2, 250, { magnesium: 100 }),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods.map(f => f.name)).toEqual(['cashews']);
  });

  it(`refuses a food logged fewer than ${MIN_LOGGINGS} times`, () => {
    const meals = [item('one-off tasting menu', 1, 900, { magnesium: 400 })];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods).toEqual([]);
    expect(out.reason).toBe(`no food logged ${MIN_LOGGINGS}+ times records magnesium`);
  });

  it('says so when nothing in the window records the nutrient at all', () => {
    const meals = [item('cashews', 1, 250, { magnesium: 100 }), item('cashews', 2, 250, { magnesium: 100 })];
    const [out] = suggestFoodsForGaps([gap('vitamin_d', 5, 20)], meals, TODAY);
    expect(out.foods).toEqual([]);
    expect(out.reason).toBe('nothing in the last 90 days records vitamin_d');
  });

  it('excludes rows outside the window', () => {
    const meals = [
      item('cashews', 95, 250, { magnesium: 100 }),
      item('cashews', 120, 250, { magnesium: 100 }),
      item('cashews', 1, 250, { magnesium: 100 }),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.reason).toBe(`no food logged ${MIN_LOGGINGS}+ times records magnesium`);
  });

  it('ignores a future-dated row rather than counting it', () => {
    const meals = [
      item('cashews', -1, 250, { magnesium: 100 }),
      item('cashews', 1, 250, { magnesium: 100 }),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.reason).toBe(`no food logged ${MIN_LOGGINGS}+ times records magnesium`);
  });

  it('sorts an unpriced food after every priced one instead of dropping it', () => {
    const meals = [
      ...[1, 2].map(d => item('home-made dhal', d, null, { magnesium: 150 })),
      ...[1, 2].map(d => item('cashews', d, 250, { magnesium: 100 })),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods.map(f => [f.name, f.kcalCost])).toEqual([
      ['cashews', 250],
      ['home-made dhal', null],
    ]);
  });

  it('treats a nutrient already at target as not a gap', () => {
    const meals = [...[1, 2].map(d => item('cashews', d, 250, { magnesium: 100 }))];
    const [out] = suggestFoodsForGaps([gap('magnesium', 400, 400)], meals, TODAY);
    expect(out.foods).toEqual([]);
    expect(out.reason).toBe('already at target');
  });

  it('matches the same food case-insensitively and keeps the first spelling logged', () => {
    const meals = [item('Cashews', 1, 250, { magnesium: 100 }), item('cashews', 2, 250, { magnesium: 100 })];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods.map(f => [f.name, f.timesLogged])).toEqual([['Cashews', 2]]);
  });

  it('caps the list per nutrient and handles several gaps at once', () => {
    const meals = [
      ...[1, 2].map(d => item('a', d, 10, { magnesium: 100 })),
      ...[1, 2].map(d => item('b', d, 20, { magnesium: 100 })),
      ...[1, 2].map(d => item('c', d, 30, { magnesium: 100 })),
      ...[1, 2].map(d => item('d', d, 40, { magnesium: 100 })),
      ...[1, 2].map(d => item('salmon', d, 300, { vitamin_d: 10 })),
    ];
    const out = suggestFoodsForGaps([gap('magnesium', 300, 400), gap('vitamin_d', 10, 20)], meals, TODAY);
    expect(out.map(n => n.nutrient)).toEqual(['magnesium', 'vitamin_d']);
    expect(out[0].foods.map(f => f.name)).toEqual(['a', 'b', 'c']);
    expect(out[1].foods.map(f => [f.name, f.servingsToClose])).toEqual([['salmon', 1]]);
  });

  it('ignores a row with no usable name', () => {
    const meals = [
      item('   ', 1, 250, { magnesium: 100 }),
      item('', 2, 250, { magnesium: 100 }),
      ...[1, 2].map(d => item('cashews', d, 250, { magnesium: 100 })),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods.map(f => f.name)).toEqual(['cashews']);
  });

  it('returns one entry per gap and nothing when there are no gaps', () => {
    expect(suggestFoodsForGaps([], [item('cashews', 1, 250, { magnesium: 100 })], TODAY)).toEqual([]);
  });

  // Pins the `amount <= 0` half of the exclusion guard specifically. Dropping it
  // and keeping only the null check still passed every other test here by
  // accident: a food with a single zero row gets a median of 0, so ceil(deficit/0)
  // is Infinity and MAX_SERVINGS discards it anyway. Two zeros and two real
  // amounts is the case where the accident stops covering for the bug -- the
  // lower median of [0, 0, 100, 100] is 0, so the food vanishes instead of being
  // the obvious suggestion.
  it('counts only the servings that actually recorded the nutrient', () => {
    const meals = [
      item('chicken', 1, 245, { magnesium: 0 }),
      item('chicken', 2, 245, { magnesium: 0 }),
      item('chicken', 3, 245, { magnesium: 100 }),
      item('chicken', 4, 245, { magnesium: 100 }),
    ];
    const [out] = suggestFoodsForGaps([gap('magnesium', 300, 400)], meals, TODAY);
    expect(out.foods.map(f => [f.name, f.perServing, f.timesLogged, f.servingsToClose])).toEqual([
      ['chicken', 100, 2, 1],
    ]);
  });
});
