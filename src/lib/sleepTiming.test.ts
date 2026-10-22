import { describe, expect, it } from 'vitest';
import { formatClock, offsetSeconds, pairNights, summariseTiming, type Night } from './sleepTiming';

const LONDON = 'Europe/London';

describe('offsetSeconds / pairNights', () => {
  it('round-trips a night through stored offsets', () => {
    const anchor = '2026-10-20T23:00:00.000Z'; // HAE's 00:00 BST date for the night ending 21 Oct
    const bed = '2026-10-20T22:40:00.000Z';
    const wake = '2026-10-21T06:05:00.000Z';
    const rows = [
      { type: 'bedtime', value: offsetSeconds(anchor, bed)!, timestamp: anchor },
      { type: 'wake_time', value: offsetSeconds(anchor, wake)!, timestamp: anchor },
    ];
    expect(rows[0].value).toBe(-1200);
    expect(pairNights(rows)).toEqual([{ bed, wake }]);
  });

  it('reads a naive sqlite timestamp as UTC and accepts Date objects', () => {
    const rows = [
      { type: 'bedtime', value: 0, timestamp: '2026-10-20 22:00:00' },
      { type: 'wake_time', value: 8 * 3600, timestamp: new Date('2026-10-20T22:00:00Z') },
    ];
    expect(pairNights(rows)).toEqual([{ bed: '2026-10-20T22:00:00.000Z', wake: '2026-10-21T06:00:00.000Z' }]);
  });

  it('drops half nights and implausible lengths', () => {
    const rows = [
      { type: 'bedtime', value: 0, timestamp: '2026-10-19T22:00:00Z' },
      { type: 'bedtime', value: 0, timestamp: '2026-10-20T22:00:00Z' },
      { type: 'wake_time', value: 3600, timestamp: '2026-10-20T22:00:00Z' },
    ];
    expect(pairNights(rows)).toEqual([]);
  });

  it('refuses offsets that are not plausibly the same night', () => {
    expect(offsetSeconds('2026-10-20T00:00:00Z', '2026-10-25T00:00:00Z')).toBeNull();
    expect(offsetSeconds('garbage', '2026-10-25T00:00:00Z')).toBeNull();
  });
});

/** A night in London: bed at hh:mm on `day` (or the next day if before noon), wake on the next morning. */
function night(day: string, bed: string, wake: string): Night {
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  const base = Date.parse(day + 'T00:00:00Z');
  // These October dates are BST (UTC+1).
  const bedMs = base + ((bh < 12 ? 24 : 0) + bh - 1) * 3600_000 + bm * 60_000;
  const wakeMs = base + (24 + wh - 1) * 3600_000 + wm * 60_000;
  return { bed: new Date(bedMs).toISOString(), wake: new Date(wakeMs).toISOString() };
}

describe('summariseTiming', () => {
  it('averages across midnight correctly', () => {
    const nights = [
      night('2026-10-12', '23:15', '06:15'),
      night('2026-10-13', '00:45', '07:45'),
      night('2026-10-14', '23:15', '06:15'),
      night('2026-10-15', '00:45', '07:45'),
      night('2026-10-16', '00:00', '07:00'),
    ];
    const s = summariseTiming(nights, '2026-10-20', LONDON)!;
    expect(formatClock(s.avgBed)).toBe('00:00');
    expect(formatClock(s.avgWake)).toBe('07:00');
    expect(s.bedSd).toBeCloseTo(Math.sqrt((4 * 45 * 45) / 5), 6);
    expect(s.regularity).toBe('variable');
  });

  it('is steady when bedtimes barely move, and needs five nights', () => {
    const four = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map(d => night(d, '22:45', '06:15'));
    expect(summariseTiming(four, '2026-10-20', LONDON)).toBeNull();
    const s = summariseTiming([...four, night('2026-10-17', '22:50', '06:20')], '2026-10-20', LONDON)!;
    expect(s.regularity).toBe('steady');
    expect(formatClock(s.avgBed)).toBe('22:46');
  });

  it('measures social jet lag from free-day against work-day midpoints', () => {
    // Work nights (wake Mon-Fri): 23:00-07:00, midpoint 03:00.
    // Free nights (wake Sat, Sun): 01:00-09:00, midpoint 05:00.
    const nights = [
      night('2026-10-11', '23:00', '07:00'), // wake Mon 12th
      night('2026-10-12', '23:00', '07:00'),
      night('2026-10-13', '23:00', '07:00'),
      night('2026-10-16', '01:00', '09:00'), // wake Sat 17th
      night('2026-10-17', '01:00', '09:00'), // wake Sun 18th
    ];
    const s = summariseTiming(nights, '2026-10-20', LONDON)!;
    expect(s.socialJetLag).toBeCloseTo(120, 6);
  });

  it('ignores nights outside the window', () => {
    const old = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map(d => night(d, '23:00', '07:00'));
    expect(summariseTiming(old, '2026-10-20', LONDON)).toBeNull();
  });
});

describe('formatClock', () => {
  it('wraps and pads', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1439)).toBe('23:59');
    expect(formatClock(1440 + 75)).toBe('01:15');
    expect(formatClock(-30)).toBe('23:30');
  });
});
