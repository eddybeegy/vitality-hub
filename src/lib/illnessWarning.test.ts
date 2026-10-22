import { describe, expect, it } from 'vitest';
import { checkIllnessWarning, describeSignals, isFlagged, trainingLoadRatio, type SignalReading } from './illnessWarning';
import { addDays } from './dayTags';

const LONDON = 'Europe/London';
const TODAY = '2026-11-10';

/** 28 normal days before `firstCheck`, alternating around the given centre. */
function history(type: string, firstCheck: string, centre: number, wobble: number) {
  return Array.from({ length: 28 }, (_, i) => ({
    type,
    value: centre + (i % 2 === 0 ? wobble : -wobble),
    timestamp: addDays(firstCheck, -(28 - i)),
  }));
}

/** Baseline: resting HR 52 +/- 2, HRV 50 +/- ~5, breathing 14 +/- 0.5. Then the check days. */
function scenario(check: { day: string; rhr?: number; hrv?: number; rr?: number }[]) {
  const firstCheck = check[0].day;
  const rows = [
    ...history('resting_heart_rate', firstCheck, 52, 2),
    ...history('hrv', firstCheck, 50, 5),
    ...history('respiratory_rate', firstCheck, 14, 0.5),
  ];
  for (const c of check) {
    if (c.rhr != null) rows.push({ type: 'resting_heart_rate', value: c.rhr, timestamp: c.day });
    if (c.hrv != null) rows.push({ type: 'hrv', value: c.hrv, timestamp: c.day });
    if (c.rr != null) rows.push({ type: 'respiratory_rate', value: c.rr, timestamp: c.day });
  }
  return rows;
}

const normalDay = (day: string) => ({ day, rhr: 52, hrv: 50, rr: 14 });
const badDay = (day: string) => ({ day, rhr: 57, hrv: 40, rr: 14 });

describe('checkIllnessWarning', () => {
  it('stays quiet on normal days', () => {
    const m = scenario([normalDay('2026-11-08'), normalDay('2026-11-09'), normalDay(TODAY)]);
    const w = checkIllnessWarning(m, [], TODAY, LONDON);
    expect(w.level).toBe('none');
    expect(w.message).toBe('');
    expect(w.days).toHaveLength(3);
  });

  it('watches when only today has resting HR up and HRV down', () => {
    const m = scenario([normalDay('2026-11-08'), normalDay('2026-11-09'), badDay(TODAY)]);
    const w = checkIllnessWarning(m, [], TODAY, LONDON);
    expect(w.level).toBe('watch');
    expect(w.cause).toBe('illness');
    expect(w.days[0].off.map(s => s.type).sort()).toEqual(['hrv', 'resting_heart_rate']);
    expect(describeSignals(w)[0]).toMatch(/normal \d+–\d+/);
  });

  it('alerts on two bad mornings in a row, and the first bad day does not hide the second', () => {
    const m = scenario([normalDay('2026-11-08'), badDay('2026-11-09'), badDay(TODAY)]);
    const w = checkIllnessWarning(m, [], TODAY, LONDON);
    expect(w.level).toBe('alert');
    expect(w.message).toMatch(/Two mornings in a row/);
  });

  it('a single signal is not enough unless it is far outside the range', () => {
    const one = scenario([normalDay('2026-11-08'), normalDay('2026-11-09'), { day: TODAY, rhr: 55, hrv: 50, rr: 14 }]);
    expect(checkIllnessWarning(one, [], TODAY, LONDON).level).toBe('none');
    const far = scenario([normalDay('2026-11-08'), normalDay('2026-11-09'), { day: TODAY, rhr: 60, hrv: 50, rr: 14 }]);
    expect(checkIllnessWarning(far, [], TODAY, LONDON).level).toBe('watch');
  });

  it('counts a raised breathing rate as a second signal', () => {
    const m = scenario([normalDay('2026-11-08'), normalDay('2026-11-09'), { day: TODAY, rhr: 55, hrv: 50, rr: 14.9 }]);
    const w = checkIllnessWarning(m, [], TODAY, LONDON);
    expect(w.level).toBe('watch');
    expect(w.days[0].off.map(s => s.type).sort()).toEqual(['respiratory_rate', 'resting_heart_rate']);
  });

  it('says nothing about a stale dip', () => {
    const m = scenario([badDay('2026-11-05'), badDay('2026-11-06'), badDay('2026-11-07')]);
    expect(checkIllnessWarning(m, [], TODAY, LONDON).level).toBe('none');
  });

  it("checks yesterday when today's readings have not arrived yet", () => {
    const m = scenario([normalDay('2026-11-07'), badDay('2026-11-08'), badDay('2026-11-09')]);
    const w = checkIllnessWarning(m, [], TODAY, LONDON);
    expect(w.level).toBe('alert');
    expect(w.days[0].day).toBe('2026-11-09');
  });

  it('needs a baseline: under 7 days of history gives no warning', () => {
    const m = [
      { type: 'resting_heart_rate', value: 52, timestamp: '2026-11-06' },
      { type: 'resting_heart_rate', value: 70, timestamp: TODAY },
      { type: 'hrv', value: 20, timestamp: TODAY },
    ];
    expect(checkIllnessWarning(m, [], TODAY, LONDON).level).toBe('none');
  });

  it('reads as overreach after a heavy training week', () => {
    const m = scenario([normalDay('2026-11-08'), badDay('2026-11-09'), badDay(TODAY)]);
    // 28 prior days: 4 x 60 min a week. Last 7 days: 7 x 60 min.
    const workouts = [
      ...Array.from({ length: 16 }, (_, i) => ({ timestamp: `${addDays(TODAY, -8 - i)}T07:00:00Z`, duration: 60 })),
      ...Array.from({ length: 7 }, (_, i) => ({ timestamp: `${addDays(TODAY, -i)}T07:00:00Z`, duration: 60 })),
    ];
    const w = checkIllnessWarning(m, workouts, TODAY, LONDON);
    expect(w.loadRatio).toBeCloseTo(7 * 60 / (16 * 60 / 4), 5);
    expect(w.cause).toBe('overreach');
    expect(w.message).toMatch(/overreach/);
  });
});

describe('trainingLoadRatio', () => {
  it('is null with no prior history', () => {
    expect(trainingLoadRatio([{ timestamp: `${TODAY}T07:00:00Z`, duration: 60 }], TODAY, LONDON)).toBeNull();
  });

  it('puts a late-evening BST workout on its London day, not the UTC one', () => {
    // 23:30 UTC on 2026-10-17 is 00:30 BST on 2026-10-18: inside the recent 7 days for today = 2026-10-24.
    const today = '2026-10-24';
    const prior = { timestamp: '2026-10-01T07:00:00Z', duration: 120 };
    const edge = { timestamp: '2026-10-17T23:30:00Z', duration: 30 };
    expect(trainingLoadRatio([prior, edge], today, LONDON)).toBeCloseTo(30 / 30, 5);
    expect(trainingLoadRatio([prior, edge], today, 'UTC')).toBeCloseTo(0, 5);
  });
});

describe('isFlagged', () => {
  const s = (badZ: number): SignalReading => ({ type: 't', name: 't', value: 1, unit: '', badZ, low: 0, high: 2 });
  it('needs two signals or one far out', () => {
    expect(isFlagged([])).toBe(false);
    expect(isFlagged([s(1.5)])).toBe(false);
    expect(isFlagged([s(1.1), s(1.2)])).toBe(true);
    expect(isFlagged([s(2.1)])).toBe(true);
  });
});
