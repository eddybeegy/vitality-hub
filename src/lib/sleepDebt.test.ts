import { describe, expect, it } from 'vitest';
import { computeSleepDebt, formatHours, sleepTargetHours } from './sleepDebt';
import { addDays } from './dayTags';

const TODAY = '2026-10-26'; // the day after BST ends: day keys are plain dates, so no hour shifts

const nights = (hours: number[]) => hours.map((h, i) => ({ date: addDays(TODAY, -(hours.length - 1 - i)), hours: h }));

describe('computeSleepDebt', () => {
  it('is null with no nights in the window', () => {
    expect(computeSleepDebt([{ date: '2026-09-01', hours: 7 }], 8, TODAY)).toBeNull();
    expect(computeSleepDebt([], 8, TODAY)).toBeNull();
  });

  it('adds up the net shortfall over 14 nights', () => {
    const d = computeSleepDebt(nights(Array(14).fill(7.5)), 8, TODAY)!;
    expect(d.debtHours).toBeCloseTo(7, 5);
    expect(d.level).toBe('high');
    expect(d.nights).toBe(14);
    expect(d.shortNights).toBe(14);
    expect(d.paybackMinutesPerNight).toBe(60);
  });

  it('lets a long night pay back a short one, but never banks credit', () => {
    expect(computeSleepDebt(nights([6, 10]), 8, TODAY)!.debtHours).toBe(0);
    const surplus = computeSleepDebt(nights([9, 9, 9]), 8, TODAY)!;
    expect(surplus.debtHours).toBe(0);
    expect(surplus.level).toBe('ok');
    expect(surplus.paybackMinutesPerNight).toBe(0);
  });

  it('ignores nights outside the window and nights with no reading', () => {
    const rows = [
      { date: addDays(TODAY, -14), hours: 2 }, // one day too old
      { date: addDays(TODAY, -3), hours: 0 },  // charger night
      { date: addDays(TODAY, -1), hours: 6.5 },
      { date: TODAY, hours: 7 },
    ];
    const d = computeSleepDebt(rows, 8, TODAY)!;
    expect(d.nights).toBe(2);
    expect(d.debtHours).toBeCloseTo(2.5, 5);
    expect(d.level).toBe('some');
    expect(d.averageHours).toBeCloseTo(6.75, 5);
  });
});

describe('sleepTargetHours', () => {
  it('uses the sleep target, or 8h when unset or nonsense', () => {
    expect(sleepTargetHours([{ type: 'sleep', value: 7.5 }])).toBe(7.5);
    expect(sleepTargetHours([{ type: 'sleep', value: 0 }])).toBe(8);
    expect(sleepTargetHours([{ type: 'sleep', value: null }])).toBe(8);
    expect(sleepTargetHours([{ type: 'steps', value: 10000 }])).toBe(8);
    expect(sleepTargetHours()).toBe(8);
  });
});

describe('formatHours', () => {
  it('rounds to 5 minutes', () => {
    expect(formatHours(4.5)).toBe('4h 30m');
    expect(formatHours(0.4)).toBe('25m');
    expect(formatHours(3)).toBe('3h');
  });
});
