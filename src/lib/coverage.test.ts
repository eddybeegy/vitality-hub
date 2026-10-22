import { describe, it, expect } from 'vitest';
import { bandFor, buildCoverage, dayWindow, DEFAULT_DAYS } from './coverage';

describe('dayWindow', () => {
  it('ends at today, oldest first, and is `days` long', () => {
    expect(dayWindow('2026-10-22', 4)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('steps across the autumn DST transition without repeating a day', () => {
    // BST ends 2026-10-25. A local-time step would return the 25th twice.
    expect(dayWindow('2026-10-26', 4)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('steps across the spring transition and month ends', () => {
    expect(dayWindow('2027-03-30', 4)).toEqual(['2027-03-27', '2027-03-28', '2027-03-29', '2027-03-30']);
    expect(dayWindow('2027-03-02', 3)).toEqual(['2027-02-28', '2027-03-01', '2027-03-02']);
  });

  it('never returns an empty window', () => {
    expect(dayWindow('2026-10-22', 0)).toEqual(['2026-10-22']);
  });
});

describe('bandFor', () => {
  it('calls nothing-arrived none, and anything on a feed with no history normal', () => {
    expect(bandFor(0, 100)).toBe('none');
    expect(bandFor(5, 0)).toBe('normal');
  });

  it('bands against the feed`s own median', () => {
    expect(bandFor(10, 100)).toBe('low');     // under 25%
    expect(bandFor(25, 100)).toBe('normal');  // exactly 25% is not yet low
    expect(bandFor(300, 100)).toBe('normal'); // exactly 3x is not yet high
    expect(bandFor(301, 100)).toBe('high');
    // A three-rows-a-day feed and a 1,500-rows-a-day feed are both normal.
    expect(bandFor(3, 3)).toBe('normal');
    expect(bandFor(1500, 1500)).toBe('normal');
  });
});

describe('buildCoverage', () => {
  const today = '2026-10-22';

  it('zero-fills missing days and keeps the window order', () => {
    const series = buildCoverage([{ source: 'withings', day: '2026-10-21', rows: 3 }], today, 3);
    expect(series).toHaveLength(1);
    expect(series[0].days.map(c => [c.day, c.rows])).toEqual([
      ['2026-10-20', 0], ['2026-10-21', 3], ['2026-10-22', 0],
    ]);
    expect(series[0].days.map(c => c.band)).toEqual(['none', 'normal', 'none']);
  });

  it('counts the gap from the last delivering day to the end of the window', () => {
    // The standing example: apple_health workouts stopped nine days ago.
    const series = buildCoverage([{ source: 'apple_health', day: '2026-10-13', rows: 2 }], today, 30);
    expect(series[0].last_day).toBe('2026-10-13');
    expect(series[0].gap_days).toBe(9);
    expect(series[0].active_days).toBe(1);
  });

  it('reports a feed that delivered today as having no gap', () => {
    const series = buildCoverage([{ source: 'hevy', day: today, rows: 4 }], today, 7);
    expect(series[0].gap_days).toBe(0);
    expect(series[0].last_day).toBe(today);
  });

  it('ignores rows outside the window rather than clamping them into the first cell', () => {
    const series = buildCoverage([
      { source: 'cronometer', day: '2026-01-01', rows: 5000 },
      { source: 'cronometer', day: today, rows: 12 },
    ], today, 3);
    expect(series[0].total).toBe(12);
    expect(series[0].days[0].rows).toBe(0);
  });

  it('sums duplicate (source, day) groups and tolerates string counts from the driver', () => {
    const series = buildCoverage([
      { source: 'healthsync', day: today, rows: '7' },
      { source: 'healthsync', day: today, rows: 3 },
    ], today, 2);
    expect(series[0].total).toBe(10);
  });

  it('sorts busiest first, ties alphabetically, and labels a blank source', () => {
    const series = buildCoverage([
      { source: 'withings', day: today, rows: 3 },
      { source: 'apple_health', day: today, rows: 900 },
      { source: '', day: today, rows: 3 },
    ], today, 2);
    expect(series.map(s => s.source)).toEqual(['apple_health', 'unknown', 'withings']);
  });

  it('takes the median of non-empty days only, so a gap does not drag the band down', () => {
    const rows = [
      { source: 'apple_health', day: '2026-10-20', rows: 100 },
      { source: 'apple_health', day: '2026-10-22', rows: 10 },
    ];
    // Non-empty median is 55: the 10-row day is under 25% of it, the 100-row day is not.
    const series = buildCoverage(rows, today, 3);
    expect(series[0].typical).toBe(55);
    expect(series[0].days.map(c => c.band)).toEqual(['normal', 'none', 'low']);
  });

  it('drops zero and non-numeric counts, and returns nothing for no rows', () => {
    expect(buildCoverage([{ source: 'x', day: today, rows: 0 }], today, 2)).toEqual([]);
    expect(buildCoverage([{ source: 'x', day: today, rows: 'n/a' }], today, 2)).toEqual([]);
    expect(buildCoverage([], today, DEFAULT_DAYS)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const rows = [{ source: 'hevy', day: today, rows: 4 }];
    const copy = JSON.parse(JSON.stringify(rows));
    buildCoverage(rows, today, 5);
    expect(rows).toEqual(copy);
  });
});
