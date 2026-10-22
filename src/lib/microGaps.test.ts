import { describe, expect, it } from 'vitest';
import { weeklyMicroGaps } from './microGaps';
import { addDays } from './dayTags';

const TODAY = '2026-10-22';
const row = (daysAgo: number, type: string, value: number) => ({ type, value, timestamp: addDays(TODAY, -daysAgo) });

describe('weeklyMicroGaps', () => {
  it('is null with no fully logged day in the last 7', () => {
    expect(weeklyMicroGaps([row(1, 'calories_in', 800), row(0, 'calories_in', 2500), row(8, 'calories_in', 2500)], TODAY)).toBeNull();
  });

  it('averages logged days only, counts a missing nutrient as 0, and lists gaps lowest first', () => {
    const rows = [
      row(1, 'calories_in', 2400), row(1, 'vitamin_d', 10), row(1, 'magnesium', 400), row(1, 'fiber', 30),
      row(2, 'calories_in', 2200), row(2, 'magnesium', 200), row(2, 'fiber', 30),
      row(3, 'calories_in', 600), row(3, 'vitamin_d', 100), // half-logged, skipped
      row(0, 'calories_in', 2000), row(0, 'vitamin_d', 100), // today, skipped
    ];
    const w = weeklyMicroGaps(rows, TODAY, { vitamin_d: 20, magnesium: 400, fiber: 30 })!;
    expect(w.loggedDays).toBe(2);
    expect(w.averages.map(a => [a.nutrient, a.pct])).toEqual([
      ['vitamin_d', 25],
      ['magnesium', 75],
      ['fiber', 100],
    ]);
    expect(w.gaps.map(g => g.label)).toEqual(['Vit D']);
  });
});
