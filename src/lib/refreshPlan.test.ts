import { describe, it, expect } from 'vitest';
import { planRefresh, refreshStartMessage, refreshFinishMessage, PULL_MODULE_IDS } from './refreshPlan';

// Registry order from modules/index.ts.
const ALL = ['apple_health', 'apple_workouts', 'withings', 'cronometer', 'hevy', 'nutrachek', 'strava', 'myfitnesspal'];

describe('planRefresh', () => {
  it('syncs every pull module when nothing is configured (enabled is the default)', () => {
    const plan = planRefresh(ALL, {});
    expect(plan.sync).toEqual(['withings', 'cronometer', 'hevy']);
    expect(plan.sync).toEqual([...PULL_MODULE_IDS]);
  });

  it('skips not-pull modules instead of calling sync() with no body', () => {
    const plan = planRefresh(ALL, null);
    expect(plan.skipped).toEqual([
      { id: 'apple_health', reason: 'not-pull' },
      { id: 'apple_workouts', reason: 'not-pull' },
      { id: 'nutrachek', reason: 'not-pull' },
      { id: 'strava', reason: 'not-pull' },
      { id: 'myfitnesspal', reason: 'not-pull' },
    ]);
  });

  it('respects enabled: false, and only that (missing or true means on)', () => {
    const plan = planRefresh(ALL, { hevy: { enabled: false }, withings: { enabled: true }, cronometer: { settings: {} } });
    expect(plan.sync).toEqual(['withings', 'cronometer']);
    expect(plan.skipped).toContainEqual({ id: 'hevy', reason: 'disabled' });
  });

  it('can end up with nothing to sync', () => {
    const plan = planRefresh(ALL, { withings: { enabled: false }, cronometer: { enabled: false }, hevy: { enabled: false } });
    expect(plan.sync).toEqual([]);
  });
});

describe('refresh log messages', () => {
  it('start row names what will sync and what was skipped', () => {
    const msg = refreshStartMessage({ sync: ['withings', 'hevy'], skipped: [{ id: 'apple_health', reason: 'not-pull' }, { id: 'cronometer', reason: 'disabled' }] });
    expect(msg).toBe('Refresh Data: sync started for withings, hevy (skipped: apple_health not-pull, cronometer disabled)');
  });

  it('start row says so when there is nothing to sync', () => {
    expect(refreshStartMessage({ sync: [], skipped: [] })).toBe('Refresh Data: nothing to sync');
  });

  it('finish row gives the per-module verdict and elapsed time', () => {
    const msg = refreshFinishMessage(
      [{ id: 'withings', ok: true }, { id: 'cronometer', ok: false, message: 'timeout' }, { id: 'hevy', ok: true }],
      1234.4,
    );
    expect(msg).toBe('Refresh Data: finished 2/3 ok in 1234 ms — withings ok; cronometer failed: timeout; hevy ok');
  });
});
