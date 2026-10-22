import { describe, it, expect } from 'vitest';
import { tzOffsetMs, zonedTimeToInstant } from './tzPoint';

const H = 3600_000;
const iso = (d: Date) => d.toISOString();

describe('tzOffsetMs', () => {
  it('reads the London offset either side of the autumn transition', () => {
    expect(tzOffsetMs('Europe/London', new Date('2026-10-25T00:30:00Z'))).toBe(H);  // BST
    expect(tzOffsetMs('Europe/London', new Date('2026-10-25T02:30:00Z'))).toBe(0);  // GMT
  });
  it('handles zones ahead of and behind UTC, and UTC itself', () => {
    expect(tzOffsetMs('UTC', new Date('2026-06-01T12:00:00Z'))).toBe(0);
    expect(tzOffsetMs('Asia/Tokyo', new Date('2026-06-01T12:00:00Z'))).toBe(9 * H);
    expect(tzOffsetMs('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-5 * H);
  });
});

describe('zonedTimeToInstant', () => {
  it('resolves an ordinary BST and an ordinary GMT morning', () => {
    expect(iso(zonedTimeToInstant('Europe/London', '2026-06-01', '09:30'))).toBe('2026-06-01T08:30:00.000Z');
    expect(iso(zonedTimeToInstant('Europe/London', '2026-12-01', '09:30'))).toBe('2026-12-01T09:30:00.000Z');
  });

  it('resolves times either side of the autumn transition on the transition day', () => {
    // 2026-10-25: clocks go back at 02:00 BST -> 01:00 GMT.
    expect(iso(zonedTimeToInstant('Europe/London', '2026-10-25', '00:30'))).toBe('2026-10-24T23:30:00.000Z');
    expect(iso(zonedTimeToInstant('Europe/London', '2026-10-25', '09:30'))).toBe('2026-10-25T09:30:00.000Z');
  });

  it('resolves a spring-forward time that does not exist to the jumped-to instant', () => {
    // 2027-03-28: 01:00 GMT -> 02:00 BST, so 01:30 local never happens.
    const d = zonedTimeToInstant('Europe/London', '2027-03-28', '01:30');
    expect(iso(d)).toBe('2027-03-28T01:30:00.000Z'); // == 02:30 BST, the clock's next reading
    expect(iso(zonedTimeToInstant('Europe/London', '2027-03-28', '09:30'))).toBe('2027-03-28T08:30:00.000Z');
  });

  it('round-trips: rendering the result back in the zone gives the requested wall clock', () => {
    for (const [tz, day] of [['Europe/London', '2026-10-25'], ['America/New_York', '2026-11-01'],
                             ['Asia/Tokyo', '2026-10-25'], ['UTC', '2026-10-25']] as const) {
      const d = zonedTimeToInstant(tz, day, '09:30');
      const shown = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
      }).format(d);
      expect(`${tz} ${shown}`).toBe(`${tz} 09:30`);
    }
  });

  it('falls back deterministically on an unusable zone or an unparseable date', () => {
    expect(iso(zonedTimeToInstant('Not/AZone', '2026-06-01', '09:30'))).toBe('2026-06-01T09:30:00.000Z');
    expect(isNaN(zonedTimeToInstant('Europe/London', 'nonsense', '09:30').getTime())).toBe(true);
  });
});
