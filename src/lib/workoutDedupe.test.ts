import { describe, it, expect } from 'vitest';
import {
  dedupeOverlappingWorkouts,
  detailScore,
  DEDUPE_WINDOW_MS,
} from './workoutDedupe';

const at = (iso: string) => iso;

/** The live pair from 2026-10-23 that prompted this filter. */
const HEVY = {
  id: 203071,
  source: 'hevy',
  name: 'Fri — Arms/Shoulders + Back + Leg Maintenance',
  timestamp: at('2026-10-23T04:26:45.000Z'),
  volume: 4820,
};
const HEALTHSYNC = {
  id: 203066,
  source: 'healthsync',
  name: 'Traditional Strength Training',
  timestamp: at('2026-10-23T04:30:44.048Z'),
  volume: null,
};

const counts = (m: Record<number, number>) => (id: number | string) => m[id as number] ?? 0;

describe('detailScore', () => {
  it('ranks any workout with exercises above any without', () => {
    const bare = { id: 1, volume: 999, distance: 999, energy_burned: 999, heart_rate_avg: 200 };
    expect(detailScore({ id: 2 }, 1)).toBeGreaterThan(detailScore(bare, 0));
  });

  it('prefers more exercises', () => {
    expect(detailScore({ id: 1 }, 7)).toBeGreaterThan(detailScore({ id: 2 }, 3));
  });
});

describe('dedupeOverlappingWorkouts', () => {
  it('hides the HealthSync row behind the Hevy one', () => {
    const { kept, suppressed } = dedupeOverlappingWorkouts(
      [HEVY, HEALTHSYNC],
      counts({ 203071: 9 })
    );
    expect(kept.map(w => w.id)).toEqual([203071]);
    expect(suppressed).toEqual([{ workout: HEALTHSYNC, supersededBy: 203071 }]);
  });

  it('hides it regardless of which row was written first', () => {
    const { kept } = dedupeOverlappingWorkouts([HEALTHSYNC, HEVY], counts({ 203071: 9 }));
    expect(kept.map(w => w.id)).toEqual([203071]);
  });

  it('applies to apple_health the same way, not just healthsync', () => {
    const apple = { ...HEALTHSYNC, id: 300, source: 'apple_health' };
    const { kept } = dedupeOverlappingWorkouts([HEVY, apple], counts({ 203071: 9 }));
    expect(kept.map(w => w.id)).toEqual([203071]);
  });

  it('keeps both when the sources match (two real workouts)', () => {
    const second = { ...HEVY, id: 203072, timestamp: at('2026-10-23T04:40:00.000Z') };
    const { kept } = dedupeOverlappingWorkouts(
      [HEVY, second],
      counts({ 203071: 9, 203072: 4 })
    );
    expect(kept.map(w => w.id)).toEqual([203071, 203072]);
  });

  it('keeps a different-source workout outside the window', () => {
    const later = { ...HEALTHSYNC, timestamp: at('2026-10-23T06:00:00.000Z') };
    const { kept } = dedupeOverlappingWorkouts([HEVY, later], counts({ 203071: 9 }));
    expect(kept.map(w => w.id)).toEqual([203071, 203066]);
  });

  it('respects a custom window', () => {
    const { kept } = dedupeOverlappingWorkouts(
      [HEVY, HEALTHSYNC],
      counts({ 203071: 9 }),
      60 * 1000
    );
    expect(kept).toHaveLength(2);
  });

  it('keeps the richer row even when the sparse one has exercises too', () => {
    const { kept } = dedupeOverlappingWorkouts(
      [HEVY, HEALTHSYNC],
      counts({ 203071: 9, 203066: 2 })
    );
    expect(kept.map(w => w.id)).toEqual([203071]);
  });

  it('falls back to source rank when detail is identical', () => {
    const { kept } = dedupeOverlappingWorkouts(
      [{ ...HEALTHSYNC, volume: 4820 }, { ...HEVY, volume: 4820 }],
      counts({})
    );
    expect(kept.map(w => w.id)).toEqual([203071]);
  });

  it('keeps both when detail and source rank are both tied', () => {
    const a = { id: 1, source: 'mystery_a', timestamp: at('2026-10-23T04:26:00.000Z') };
    const b = { id: 2, source: 'mystery_b', timestamp: at('2026-10-23T04:30:00.000Z') };
    const { kept } = dedupeOverlappingWorkouts([a, b], counts({}));
    expect(kept.map(w => w.id)).toEqual([1, 2]);
  });

  it('never lets a suppressed row suppress a third session', () => {
    // C overlaps B but not A. Were suppression allowed to chain, C would be
    // hidden by a row that is itself hidden and the session would vanish.
    const a = { id: 1, source: 'hevy', timestamp: at('2026-10-23T04:00:00.000Z') };
    const b = { id: 2, source: 'healthsync', timestamp: at('2026-10-23T04:25:00.000Z'), volume: 10 };
    const c = { id: 3, source: 'apple_health', timestamp: at('2026-10-23T04:50:00.000Z') };
    const { kept } = dedupeOverlappingWorkouts([a, b, c], counts({ 1: 5 }));
    expect(kept.map(w => w.id)).toContain(1);
    expect(kept.map(w => w.id)).toContain(3);
  });

  it('keeps rows with unparseable or missing timestamps', () => {
    const broken = { id: 9, source: 'healthsync', timestamp: 'not-a-date' };
    const missing = { id: 10, source: 'healthsync', timestamp: null };
    const { kept } = dedupeOverlappingWorkouts(
      [HEVY, broken, missing],
      counts({ 203071: 9 })
    );
    expect(kept.map(w => w.id)).toEqual([203071, 9, 10]);
  });

  it('accepts Date and epoch-millis timestamps', () => {
    const d = { ...HEVY, timestamp: new Date('2026-10-23T04:26:45.000Z') };
    const ms = { ...HEALTHSYNC, timestamp: new Date('2026-10-23T04:30:44.048Z').getTime() };
    const { kept } = dedupeOverlappingWorkouts([d, ms], counts({ 203071: 9 }));
    expect(kept.map(w => w.id)).toEqual([203071]);
  });

  it('preserves input order and is a no-op on an empty list', () => {
    expect(dedupeOverlappingWorkouts([], counts({})).kept).toEqual([]);
    const far = [
      { id: 1, source: 'hevy', timestamp: at('2026-10-23T10:00:00.000Z') },
      { id: 2, source: 'hevy', timestamp: at('2026-10-22T10:00:00.000Z') },
      { id: 3, source: 'healthsync', timestamp: at('2026-10-21T10:00:00.000Z') },
    ];
    expect(dedupeOverlappingWorkouts(far, counts({})).kept.map(w => w.id)).toEqual([1, 2, 3]);
  });

  it('uses a 30 minute default window', () => {
    expect(DEDUPE_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});
