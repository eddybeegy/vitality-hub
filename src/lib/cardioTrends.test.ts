import { describe, expect, it } from 'vitest';
import { cardioTrends, effortsOf, sportOf, toKm } from './cardioTrends';
import { addDays } from './dayTags';

const LONDON = 'Europe/London';
const TODAY = '2026-10-22';
const run = (daysAgo: number, km: number, minutes: number, hr: number, extra: object = {}) => ({
  name: 'Outdoor Run', timestamp: `${addDays(TODAY, -daysAgo)}T07:00:00Z`, duration: minutes,
  distance: km * 1000, distanceUnit: 'm', avgHeartRate: hr, ...extra,
});
/** A Hevy session: a rowing block of `metres` in `seconds`, inside a longer workout. */
const rowSession = (daysAgo: number, metres: number, seconds: number, duration: number, hr: number | null = null) => ({
  name: 'Tue — Rowing & Core', timestamp: `${addDays(TODAY, -daysAgo)}T18:00:00Z`, duration,
  distance: metres, distanceUnit: 'm', avgHeartRate: hr,
  exercises: [
    { title: 'Rowing Machine', type: 'cardio', sets: [
      { distance: metres / 2, time: seconds / 2 }, { distance: metres / 2, time: seconds / 2 },
    ] },
    { title: 'Plank', type: 'strength', sets: [{ time: 60 }, { time: 60 }] },
  ],
});

describe('cardioTrends', () => {
  it('scores metres per heartbeat and reports the first-3 to last-3 change', () => {
    const sessions = [
      run(80, 5, 30, 160), run(70, 5, 30, 160), run(60, 5, 30, 160),
      run(20, 5, 28, 150), run(10, 5, 28, 150), run(1, 5, 28, 150),
    ];
    const [t] = cardioTrends(sessions, TODAY, LONDON);
    expect(t.sport).toBe('run');
    expect(t.basis).toBe('efficiency');
    expect(t.sessions[0].efficiency).toBeCloseTo(5000 / (30 * 160), 6);
    expect(t.sessions[0].pace).toBeCloseTo(6, 6);
    expect(t.sessions[0].from).toBe('workout');
    expect(t.change).toBeCloseTo((5000 / (28 * 150)) / (5000 / (30 * 160)) - 1, 6);
  });

  it('needs six sessions for a change, and drops implausible or incomplete sessions', () => {
    const [t] = cardioTrends([
      run(5, 5, 30, 160),
      run(4, 5, 30 * 60, 160),          // duration stored in seconds: 0.17 km/h, dropped
      run(2, 5, 30, 160, { distance: null }),
      run(200, 5, 30, 160),             // outside 90 days
    ], TODAY, LONDON);
    expect(t.sessions).toHaveLength(1);
    expect(t.change).toBeNull();
  });

  it('splits by sport and ignores strength sessions', () => {
    const t = cardioTrends([
      run(3, 5, 30, 160),
      { name: 'Cycling', timestamp: `${TODAY}T07:00:00Z`, duration: 60, distance: 25, distanceUnit: 'km', avgHeartRate: 140 },
      { name: 'Push Day', timestamp: `${TODAY}T07:00:00Z`, duration: 60 },
    ], TODAY, LONDON);
    expect(t.map(x => x.sport)).toEqual(['run', 'ride']);
  });

  it('scores a Hevy rowing block from its own sets, not the whole mixed session', () => {
    // 3190 m in 15 min is 12.8 km/h; over the 41-minute workout it would be 4.7,
    // and over the workout row the sport band would have let that through.
    const [t] = cardioTrends([rowSession(2, 3190, 900, 41)], TODAY, LONDON);
    expect(t.sport).toBe('row');
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0].from).toBe('exercise');
    expect(t.sessions[0].title).toBe('Rowing Machine');
    expect(t.sessions[0].km).toBeCloseTo(3.19, 6);
    expect(t.sessions[0].minutes).toBeCloseTo(15, 6);
    expect(t.sessions[0].speedKmh).toBeCloseTo(12.76, 2);
  });

  it('will not score a 15-minute block against a 41-minute average HR', () => {
    const [t] = cardioTrends([rowSession(2, 3190, 900, 41, 150)], TODAY, LONDON);
    expect(t.sessions[0].avgHr).toBe(150);
    expect(t.sessions[0].efficiency).toBeNull();
    expect(t.basis).toBe('speed');
  });

  it('scores the block when it fills the session', () => {
    const [t] = cardioTrends([rowSession(2, 3190, 900, 15, 150)], TODAY, LONDON);
    expect(t.sessions[0].efficiency).toBeCloseTo(3190 / (15 * 150), 6);
    expect(t.basis).toBe('efficiency');
  });

  it('trends rowing on speed when no session has a usable heart rate', () => {
    const t = cardioTrends([
      rowSession(80, 3000, 900, 41), rowSession(70, 3010, 900, 41), rowSession(60, 3020, 900, 41),
      rowSession(20, 3190, 900, 41), rowSession(10, 3200, 900, 41), rowSession(2, 3250, 900, 41),
    ], TODAY, LONDON)[0];
    expect(t.basis).toBe('speed');
    expect(t.sessions).toHaveLength(6);
    expect(t.change).toBeCloseTo((3190 + 3200 + 3250) / (3000 + 3010 + 3020) - 1, 6);
  });

  it('keeps the efficiency basis when enough sessions have HR, dropping the ones without', () => {
    const t = cardioTrends([
      run(80, 5, 30, 160), run(70, 5, 30, 160), run(60, 5, 30, 160),
      run(20, 5, 28, 150), run(10, 5, 28, 150), run(1, 5, 28, 150),
      run(3, 5, 28, 0),                 // no HR: dropped, six scored ones remain
    ], TODAY, LONDON)[0];
    expect(t.basis).toBe('efficiency');
    expect(t.sessions).toHaveLength(6);
  });

  it('falls back to speed rather than losing the sport when too few have HR', () => {
    const t = cardioTrends([
      run(5, 5, 30, 0), run(4, 5, 29, 0), run(3, 5, 28, 160),
    ], TODAY, LONDON)[0];
    expect(t.basis).toBe('speed');
    expect(t.sessions).toHaveLength(3);
  });
});

describe('effortsOf', () => {
  const ts = `${TODAY}T18:00:00Z`;

  it('ignores the workout row when the session has a cardio exercise', () => {
    const [e] = effortsOf({ name: 'Tue — Rowing & Core', timestamp: ts, duration: 41, distance: 3190, distanceUnit: 'm',
      exercises: [{ title: 'Rowing Machine', type: 'cardio', sets: [{ distance: 3190, time: 900 }] }] });
    expect(e.from).toBe('exercise');
    expect(e.minutes).toBeCloseTo(15, 6);
  });

  it('merges two blocks of the same sport in one session', () => {
    const efforts = effortsOf({ name: 'Intervals', timestamp: ts, duration: 40,
      exercises: [
        { title: 'Rowing Machine', type: 'cardio', sets: [{ distance: 1000, time: 300 }] },
        { title: 'Rower', type: 'cardio', sets: [{ distance: 2000, time: 600 }] },
      ] });
    expect(efforts).toHaveLength(1);
    expect(efforts[0].km).toBeCloseTo(3, 6);
    expect(efforts[0].minutes).toBeCloseTo(15, 6);
  });

  it('keeps two different sports apart', () => {
    const efforts = effortsOf({ name: 'Brick', timestamp: ts, duration: 60,
      exercises: [
        { title: 'Treadmill', type: 'cardio', sets: [{ distance: 3000, time: 900 }] },
        { title: 'Stationary Bike', type: 'cardio', sets: [{ distance: 8000, time: 1200 }] },
      ] });
    expect(efforts.map(e => e.sport).sort()).toEqual(['ride', 'run']);
  });

  it('skips a cardio exercise with no distance or no time', () => {
    expect(effortsOf({ name: 'Core', timestamp: ts, duration: 20,
      exercises: [{ title: 'Rowing Machine', type: 'cardio', sets: [{ time: 900 }] }] })).toEqual([]);
    expect(effortsOf({ name: 'Core', timestamp: ts, duration: 20,
      exercises: [{ title: 'Rowing Machine', type: 'cardio', sets: [{ distance: 3000 }] }] })).toEqual([]);
  });

  it('does not treat a weighted barbell row as cardio', () => {
    expect(effortsOf({ name: 'Pull Day', timestamp: ts, duration: 50,
      exercises: [{ title: 'Barbell Row', type: 'strength', sets: [{ distance: 0, time: 0 }] }] })).toEqual([]);
  });
});

describe('sportOf and toKm', () => {
  it('maps names and units', () => {
    expect(sportOf('Indoor Running')).toBe('run');
    expect(sportOf('Outdoor Cycling')).toBe('ride');
    expect(sportOf('Hiking')).toBe('walk');
    expect(sportOf('Rowing Machine')).toBe('row');
    expect(sportOf('Treadmill')).toBe('run');
    expect(sportOf('Leg Day')).toBeNull();
    expect(toKm(3.1, 'mi')).toBeCloseTo(4.989, 3);
    expect(toKm(5000, null)).toBe(5);
    expect(toKm(5, 'furlongs')).toBeNull();
  });
});
