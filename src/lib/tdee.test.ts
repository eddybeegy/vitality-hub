import { describe, it, expect } from 'vitest';
import { estimateTdee, tdeeWindow, linearFit, seriesOf, KCAL_PER_KG, type DailyValue } from './tdee';

const TODAY = '2026-10-21';

/** Days 1..n before today (day 1 = yesterday), oldest first. */
function daysBack(n: number): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(2026, 9, 21 - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const series = (days: string[], f: (i: number) => number): DailyValue[] => days.map((day, i) => ({ day, value: f(i) }));

describe('tdeeWindow', () => {
  it('is the 28 complete days ending yesterday', () => {
    expect(tdeeWindow(TODAY)).toEqual({ start: '2026-09-23', end: '2026-10-20' });
  });

  it('is unaffected by the UK clock change', () => {
    // 2026-10-25 is the BST -> GMT change; 2026-03-29 the other way.
    expect(tdeeWindow('2026-10-26', 7)).toEqual({ start: '2026-10-19', end: '2026-10-25' });
    expect(tdeeWindow('2026-03-30', 7)).toEqual({ start: '2026-03-23', end: '2026-03-29' });
  });
});

describe('linearFit', () => {
  it('recovers a straight line', () => {
    const fit = linearFit([[0, 80], [7, 79.75], [14, 79.5]], 14);
    expect(fit.slope).toBeCloseTo(-0.25 / 7, 10);
    expect(fit.valueAt).toBeCloseTo(79.5, 10);
  });
});

describe('estimateTdee', () => {
  const days = daysBack(28);

  it('adds the energy of a falling weight trend to intake', () => {
    // 2,400 kcal a day while losing exactly 0.25 kg a week.
    const r = estimateTdee({
      today: TODAY,
      intake: series(days, () => 2400),
      weight: series(days, i => 80 - (0.25 / 7) * i),
    });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.avgIntake).toBe(2400);
    expect(r.weeklyChangeKg).toBeCloseTo(-0.25, 6);
    expect(r.tdee).toBeCloseTo(2400 + (0.25 / 7) * KCAL_PER_KG, 6);
    expect(Math.round(r.tdee)).toBe(2675);
    expect(r.trendWeightKg).toBeCloseTo(80 - (0.25 / 7) * 27, 6);
    expect(r.confidence).toBe('high');
  });

  it('equals intake when weight is flat, and subtracts a gain', () => {
    const flat = estimateTdee({ today: TODAY, intake: series(days, () => 2500), weight: series(days, () => 75) });
    expect(flat.status === 'ok' && flat.tdee).toBe(2500);

    const gaining = estimateTdee({ today: TODAY, intake: series(days, () => 3000), weight: series(days, i => 70 + (0.5 / 7) * i) });
    expect(gaining.status === 'ok' && Math.round(gaining.tdee)).toBe(Math.round(3000 - 550));
  });

  it('is barely moved by one heavy weigh-in', () => {
    const weight = series(days, () => 80);
    weight[20] = { day: weight[20].day, value: 81.5 };
    const r = estimateTdee({ today: TODAY, intake: series(days, () => 2400), weight });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(Math.abs(r.tdee - 2400)).toBeLessThan(150);
  });

  it('skips unlogged and half-logged days instead of counting them as low intake', () => {
    const intake = series(days, i => (i % 4 === 0 ? 450 : 2400)); // 7 half-logged days
    const r = estimateTdee({ today: TODAY, intake, weight: series(days, () => 80) });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.avgIntake).toBe(2400);
    expect(r.intakeDays).toBe(21);
    expect(r.skippedLowDays).toBe(7);
  });

  it('ignores today and anything outside the window', () => {
    const r = estimateTdee({
      today: TODAY,
      intake: [...series(days, () => 2400), { day: TODAY, value: 600 }, { day: '2026-09-01', value: 9000 }],
      weight: [...series(days, () => 80), { day: TODAY, value: 60 }],
    });
    expect(r.status === 'ok' && r.tdee).toBe(2400);
  });

  it('says what is missing when there is too little data', () => {
    const r = estimateTdee({
      today: TODAY,
      intake: series(days.slice(-10), () => 2400),
      weight: series(days.slice(-3), () => 80),
    });
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect(r.intakeDays).toBe(10);
    expect(r.weighIns).toBe(3);
    expect(r.missing).toHaveLength(2);
    expect(r.missing[0]).toContain('4 more days of logged food');
    expect(r.missing[1]).toContain('1 more weigh-in');
  });

  it('wants weigh-ins spread out, not bunched together', () => {
    const r = estimateTdee({
      today: TODAY,
      intake: series(days, () => 2400),
      weight: series(days.slice(-5), () => 80),
    });
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect(r.weightSpanDays).toBe(4);
    expect(r.missing[0]).toContain('at least 10 days');
  });

  it('compares with Apple active + basal on days that have both', () => {
    const r = estimateTdee({
      today: TODAY,
      intake: series(days, () => 2400),
      weight: series(days, () => 80),
      activeEnergy: series(days, () => 600),
      basalEnergy: [...series(days.slice(0, 10), () => 1800)],
    });
    expect(r.status === 'ok' && r.apple).toEqual({ tdee: 2400, days: 10 });

    const few = estimateTdee({
      today: TODAY,
      intake: series(days, () => 2400),
      weight: series(days, () => 80),
      activeEnergy: series(days, () => 600),
      basalEnergy: series(days.slice(0, 3), () => 1800),
    });
    expect(few.status === 'ok' && few.apple).toBeNull();
  });

  it('rates sparse data as low confidence', () => {
    const sparse = estimateTdee({
      today: TODAY,
      intake: series(days.slice(0, 15), () => 2400),
      weight: series(days.filter((_, i) => i % 7 === 0), () => 80),
    });
    expect(sparse.status === 'ok' && sparse.confidence).toBe('low');
  });
});

describe('seriesOf', () => {
  it('reads one key from aggregated day rows and drops rows without it', () => {
    const rows = [
      { date: '2026-10-01', calories_in: 2100, active_energy: 500 },
      { date: '2026-10-02', active_energy: 450 },
      { date: '2026-10-03', calories_in: '1900' },
    ];
    expect(seriesOf(rows, 'calories_in')).toEqual([
      { day: '2026-10-01', value: 2100 },
      { day: '2026-10-03', value: 1900 },
    ]);
    expect(seriesOf(null, 'x')).toEqual([]);
  });
});
