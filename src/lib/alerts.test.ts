import { describe, it, expect } from 'vitest';

import {
  DEFAULT_ALERT_SETTINGS,
  evaluateAlerts,
  inQuietHours,
  type AlertInput,
  type AlertSettings,
} from './alerts';

const on = (over: Partial<AlertSettings> = {}): AlertSettings => ({
  ...DEFAULT_ALERT_SETTINGS,
  enabled: true,
  ...over,
});

const NOW = new Date('2026-10-23T10:00:00Z');

const input = (over: Partial<AlertInput> = {}): AlertInput => ({
  now: NOW,
  hourNow: 10,
  today: '2026-10-23',
  freshness: {},
  bp: null,
  readiness: null,
  settings: on(),
  ...over,
});

describe('inQuietHours', () => {
  it('wraps midnight', () => {
    expect(inQuietHours(23, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(10, 22, 7)).toBe(false);
  });

  it('handles a window that does not wrap', () => {
    expect(inQuietHours(3, 1, 5)).toBe(true);
    expect(inQuietHours(6, 1, 5)).toBe(false);
  });

  // A single mistyped setting should not silence every alert forever.
  it('treats start === end as no quiet window, not a 24h gag', () => {
    for (let h = 0; h < 24; h++) expect(inQuietHours(h, 9, 9)).toBe(false);
  });
});

describe('evaluateAlerts — master switch', () => {
  it('returns nothing at all when disabled', () => {
    const out = evaluateAlerts(
      input({
        settings: on({ enabled: false }),
        freshness: { apple_health: '2026-10-01T00:00:00Z' },
        bp: { systolic: 180, diastolic: 110, timestamp: '2026-10-23T09:00:00Z' },
      }),
    );
    expect(out).toEqual([]);
  });
});

describe('evaluateAlerts — stale feeds', () => {
  it('fires once a feed passes its own threshold', () => {
    // apple_health threshold is 24h; 25h old.
    const out = evaluateAlerts(input({ freshness: { apple_health: '2026-10-22T09:00:00Z' } }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('stale');
    expect(out[0].text).toContain('apple_health');
    expect(out[0].text).toContain('threshold 24h');
  });

  it('respects the per-module thresholds rather than one global number', () => {
    // 25h old. apple_health (24h) is stale; hevy (72h) and withings (168h) are not.
    const stale = '2026-10-22T09:00:00Z';
    const out = evaluateAlerts(
      input({ freshness: { apple_health: stale, hevy: stale, withings: stale } }),
    );
    expect(out.map((a) => a.text.split(' ')[1])).toEqual(['apple_health']);
  });

  // The whole point of the per-day key: a feed dead for four days must not
  // produce 96 alerts.
  it('keys per module per local day so a dead feed pages once a day', () => {
    const out = evaluateAlerts(input({ freshness: { apple_health: '2026-10-01T00:00:00Z' } }));
    expect(out[0].key).toBe('stale:apple_health:2026-10-23');
  });

  // A module he has never used would otherwise alert every day, forever.
  it('ignores a feed that has never produced a reading', () => {
    expect(evaluateAlerts(input({ freshness: { cronometer: null } }))).toEqual([]);
    expect(evaluateAlerts(input({ freshness: { cronometer: undefined } }))).toEqual([]);
  });

  it('ignores an unparseable timestamp rather than reporting NaN hours', () => {
    expect(evaluateAlerts(input({ freshness: { hevy: 'not a date' } }))).toEqual([]);
  });

  it('is silent during quiet hours', () => {
    const out = evaluateAlerts(
      input({ hourNow: 2, freshness: { apple_health: '2026-10-01T00:00:00Z' } }),
    );
    expect(out).toEqual([]);
  });

  it('switches off independently of the other triggers', () => {
    const out = evaluateAlerts(
      input({
        settings: on({ staleEnabled: false }),
        freshness: { apple_health: '2026-10-01T00:00:00Z' },
        bp: { systolic: 140, diastolic: 90, timestamp: '2026-10-23T09:00:00Z' },
      }),
    );
    expect(out.map((a) => a.kind)).toEqual(['bp']);
  });
});

describe('evaluateAlerts — blood pressure', () => {
  it('fires on systolic alone, naming which half was high', () => {
    const out = evaluateAlerts(
      input({ bp: { systolic: 133, diastolic: 70, timestamp: '2026-10-23T09:00:00Z' } }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('systolic is');
    expect(out[0].text).toContain('133/70');
  });

  it('fires on diastolic alone', () => {
    const out = evaluateAlerts(
      input({ bp: { systolic: 110, diastolic: 84, timestamp: '2026-10-23T09:00:00Z' } }),
    );
    expect(out[0].text).toContain('diastolic is');
  });

  it('says "both" when both halves are high', () => {
    const out = evaluateAlerts(
      input({ bp: { systolic: 135, diastolic: 90, timestamp: '2026-10-23T09:00:00Z' } }),
    );
    expect(out[0].text).toContain('both are');
  });

  // His own numbers, not the textbook ones: 112/71 average must stay quiet.
  it('stays quiet at his typical reading', () => {
    expect(
      evaluateAlerts(input({ bp: { systolic: 112, diastolic: 71, timestamp: '2026-10-23T09:00:00Z' } })),
    ).toEqual([]);
  });

  it('treats the threshold as inclusive', () => {
    const out = evaluateAlerts(
      input({ bp: { systolic: 130, diastolic: 70, timestamp: '2026-10-23T09:00:00Z' } }),
    );
    expect(out).toHaveLength(1);
  });

  // Deliberate: a high reading at 3am is the one thing worth waking him for.
  it('is NOT suppressed by quiet hours', () => {
    const out = evaluateAlerts(
      input({ hourNow: 3, bp: { systolic: 150, diastolic: 95, timestamp: '2026-10-23T03:00:00Z' } }),
    );
    expect(out.map((a) => a.kind)).toEqual(['bp']);
  });

  it('keys per reading, so a still-high recheck does alert again', () => {
    const a = evaluateAlerts(
      input({ bp: { systolic: 150, diastolic: 95, timestamp: '2026-10-23T09:00:00Z' } }),
    )[0];
    const b = evaluateAlerts(
      input({ bp: { systolic: 150, diastolic: 95, timestamp: '2026-10-23T10:00:00Z' } }),
    )[0];
    expect(a.key).not.toBe(b.key);
  });

  it('handles a half-missing reading without firing on the missing half', () => {
    expect(
      evaluateAlerts(input({ bp: { systolic: null, diastolic: 70, timestamp: '2026-10-23T09:00:00Z' } })),
    ).toEqual([]);
  });
});

describe('evaluateAlerts — low readiness morning', () => {
  it('fires below the floor and includes the recent average', () => {
    const out = evaluateAlerts(
      input({ readiness: { date: '2026-10-23', score: 53, average: 73.4 } }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('readiness');
    expect(out[0].text).toContain('53');
    expect(out[0].text).toContain('73');
  });

  it('omits the context sentence when there is no average', () => {
    const out = evaluateAlerts(input({ readiness: { date: '2026-10-23', score: 53 } }));
    expect(out[0].text).not.toContain('average');
  });

  // 73.4 is his mean; it must not page.
  it('stays quiet at a normal score', () => {
    expect(evaluateAlerts(input({ readiness: { date: '2026-10-23', score: 73 } }))).toEqual([]);
  });

  it('keys per date, so it cannot repeat within a day', () => {
    const out = evaluateAlerts(input({ readiness: { date: '2026-10-23', score: 40 } }));
    expect(out[0].key).toBe('readiness:2026-10-23');
  });

  // A score that lands at 16:00 is no longer advice about how to train today.
  it('only fires in the morning', () => {
    expect(evaluateAlerts(input({ hourNow: 16, readiness: { date: '2026-10-23', score: 40 } }))).toEqual([]);
    expect(evaluateAlerts(input({ hourNow: 11, readiness: { date: '2026-10-23', score: 40 } }))).toHaveLength(1);
  });

  it('is silent during quiet hours even though 03:00 is before noon', () => {
    expect(evaluateAlerts(input({ hourNow: 3, readiness: { date: '2026-10-23', score: 40 } }))).toEqual([]);
  });
});

describe('evaluateAlerts — several at once', () => {
  it('returns every true alert, each with a distinct key', () => {
    const out = evaluateAlerts(
      input({
        freshness: { apple_health: '2026-10-01T00:00:00Z', hevy: '2026-10-01T00:00:00Z' },
        bp: { systolic: 140, diastolic: 90, timestamp: '2026-10-23T09:00:00Z' },
        readiness: { date: '2026-10-23', score: 40, average: 73.4 },
      }),
    );
    expect(out.map((a) => a.kind).sort()).toEqual(['bp', 'readiness', 'stale', 'stale']);
    expect(new Set(out.map((a) => a.key)).size).toBe(4);
  });
});
