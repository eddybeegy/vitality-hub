import { describe, it, expect } from 'vitest';
import { freshnessStatus, stalenessThresholdHours, STALENESS_THRESHOLD_HOURS } from './freshness';

// Fixed clock with an explicit offset, so nothing leans on the runner's zone.
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toISOString();

describe('freshnessStatus', () => {
  it('uses the approved thresholds', () => {
    expect(STALENESS_THRESHOLD_HOURS).toEqual({
      apple_health: 24,
      apple_workouts: 24,
      healthsync: 24,
      withings: 24,
      cronometer: 72,
      hevy: 72,
      nutracheck: 72,
      nutrachek: 72,
    });
  });

  for (const [moduleId, threshold] of Object.entries(STALENESS_THRESHOLD_HOURS)) {
    it(`${moduleId}: good just under ${threshold}h`, () => {
      expect(freshnessStatus(moduleId, hoursAgo(threshold - 0.01), NOW)).toBe('good');
    });
    it(`${moduleId}: error just over ${threshold}h`, () => {
      expect(freshnessStatus(moduleId, hoursAgo(threshold + 0.01), NOW)).toBe('error');
    });
  }

  it('falls back to 24h for an unknown module id', () => {
    expect(stalenessThresholdHours('strava')).toBe(24);
    expect(freshnessStatus('strava', hoursAgo(23.99), NOW)).toBe('good');
    expect(freshnessStatus('strava', hoursAgo(24.01), NOW)).toBe('error');
  });

  it('does not treat inherited object keys as module ids', () => {
    expect(stalenessThresholdHours('toString')).toBe(24);
  });

  it("returns 'unknown' for a missing or never reading", () => {
    expect(freshnessStatus('withings', undefined, NOW)).toBe('unknown');
    expect(freshnessStatus('withings', null, NOW)).toBe('unknown');
    expect(freshnessStatus('withings', '', NOW)).toBe('unknown');
  });

  it('a 30h-old reading is good for cronometer but error for withings', () => {
    const reading = hoursAgo(30);
    expect(freshnessStatus('cronometer', reading, NOW)).toBe('good');
    expect(freshnessStatus('withings', reading, NOW)).toBe('error');
  });

  it('reads a naive server timestamp as UTC', () => {
    // 2026-10-20 12:30 UTC, naive, as the summary payload can carry it: 23.5h old.
    expect(freshnessStatus('withings', '2026-10-20 12:30:00', NOW)).toBe('good');
  });
});
