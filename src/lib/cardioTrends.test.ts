import { describe, expect, it } from 'vitest';
import { cardioTrends, sportOf, toKm } from './cardioTrends';
import { addDays } from './dayTags';

const LONDON = 'Europe/London';
const TODAY = '2026-10-22';
const run = (daysAgo: number, km: number, minutes: number, hr: number, extra: object = {}) => ({
  name: 'Outdoor Run', timestamp: `${addDays(TODAY, -daysAgo)}T07:00:00Z`, duration: minutes,
  distance: km * 1000, distanceUnit: 'm', avgHeartRate: hr, ...extra,
});

describe('cardioTrends', () => {
  it('scores metres per heartbeat and reports the first-3 to last-3 change', () => {
    const sessions = [
      run(80, 5, 30, 160), run(70, 5, 30, 160), run(60, 5, 30, 160),
      run(20, 5, 28, 150), run(10, 5, 28, 150), run(1, 5, 28, 150),
    ];
    const [t] = cardioTrends(sessions, TODAY, LONDON);
    expect(t.sport).toBe('run');
    expect(t.sessions[0].efficiency).toBeCloseTo(5000 / (30 * 160), 6);
    expect(t.sessions[0].pace).toBeCloseTo(6, 6);
    expect(t.change).toBeCloseTo((5000 / (28 * 150)) / (5000 / (30 * 160)) - 1, 6);
  });

  it('needs six sessions for a change, and drops implausible or incomplete sessions', () => {
    const [t] = cardioTrends([
      run(5, 5, 30, 160),
      run(4, 5, 30 * 60, 160),          // duration stored in seconds: 0.17 km/h, dropped
      run(3, 5, 30, 0),                 // no HR, dropped
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
});

describe('sportOf and toKm', () => {
  it('maps names and units', () => {
    expect(sportOf('Indoor Running')).toBe('run');
    expect(sportOf('Outdoor Cycling')).toBe('ride');
    expect(sportOf('Hiking')).toBe('walk');
    expect(sportOf('Leg Day')).toBeNull();
    expect(toKm(3.1, 'mi')).toBeCloseTo(4.989, 3);
    expect(toKm(5000, null)).toBe(5);
    expect(toKm(5, 'furlongs')).toBeNull();
  });
});
