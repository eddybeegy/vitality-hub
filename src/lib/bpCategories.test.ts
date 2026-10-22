import { describe, expect, it } from 'vitest';
import { bpBand, homeAverage, latestReading } from './bpCategories';

describe('bpBand (NICE home thresholds)', () => {
  it('bands by the worse of the two numbers', () => {
    expect(bpBand(118, 76)).toBe('normal');
    expect(bpBand(134, 84)).toBe('normal');
    expect(bpBand(135, 70)).toBe('stage1');
    expect(bpBand(120, 85)).toBe('stage1');
    expect(bpBand(150, 80)).toBe('stage2');
    expect(bpBand(130, 95)).toBe('stage2');
    expect(bpBand(181, 90)).toBe('severe');
    expect(bpBand(140, 120)).toBe('severe');
  });

  it('calls low only when nothing is high', () => {
    expect(bpBand(88, 70)).toBe('low');
    expect(bpBand(120, 55)).toBe('low');
    expect(bpBand(140, 55)).toBe('stage1');
  });
});

describe('homeAverage', () => {
  const TODAY = '2026-10-22';
  const day = (d: string, s: number, di: number) => ({ date: d, systolic: s, diastolic: di });

  it('averages paired days in the last 7, inclusive of today', () => {
    const rows = [
      day('2026-10-15', 200, 120), // 8 days back: outside
      day('2026-10-16', 130, 80),
      day('2026-10-18', 134, 82),
      day('2026-10-20', 138, 86),
      day('2026-10-22', 138, 88),
    ];
    const a = homeAverage(rows, TODAY)!;
    expect(a.days).toBe(4);
    expect(a.systolic).toBeCloseTo(135, 6);
    expect(a.diastolic).toBeCloseTo(84, 6);
    expect(a.band).toBe('stage1');
    expect(a.from).toBe('2026-10-16');
  });

  it('needs four days, and skips half readings', () => {
    const rows = [day('2026-10-20', 120, 80), day('2026-10-21', 121, 79), day('2026-10-22', 119, 78), { date: '2026-10-19', systolic: 125 }];
    expect(homeAverage(rows, TODAY)).toBeNull();
  });
});

describe('latestReading', () => {
  it('picks the newest paired day', () => {
    const rows = [{ date: '2026-10-21', systolic: 128, diastolic: 82 }, { date: '2026-10-22', systolic: 140 }, { date: '2026-10-19', systolic: 110, diastolic: 70 }];
    expect(latestReading(rows)).toEqual({ date: '2026-10-21', systolic: 128, diastolic: 82, band: 'normal' });
    expect(latestReading([])).toBeNull();
  });
});
