import { describe, it, expect } from 'vitest';
import {
  formatWorkoutWeight,
  formatWeight,
  convertWeight,
  convertDistance,
  getWeightUnit,
  getDistanceUnit,
  formatPaceAndSpeed,
  parseUTCDate,
  convertHeight,
  getHeightUnit,
} from './utils';

describe('formatWorkoutWeight', () => {
  it('returns kg for metric', () => {
    expect(formatWorkoutWeight(80, 'metric')).toBe('80.0 kg');
  });
  it('converts to lbs for imperial', () => {
    expect(formatWorkoutWeight(100, 'imperial')).toBe('220.5 lbs');
  });
  it('converts to lbs for stone (same conversion)', () => {
    expect(formatWorkoutWeight(100, 'stone')).toBe('220.5 lbs');
  });
  it('defaults to metric when unit omitted', () => {
    expect(formatWorkoutWeight(60)).toBe('60.0 kg');
  });
});

describe('formatWeight', () => {
  it('returns kg for metric', () => {
    expect(formatWeight(70, 'metric')).toBe('70.0 kg');
  });
  it('converts to lbs for imperial', () => {
    expect(formatWeight(100, 'imperial')).toBe('220.5 lbs');
  });
  it('returns stones and lbs for stone', () => {
    // 100 kg = 220.462 lbs = 15st 10.5lb
    const result = formatWeight(100, 'stone');
    expect(result).toMatch(/^\d+st \d+\.\dlb$/);
    expect(result).toBe('15st 10.5lb');
  });
});

describe('convertWeight', () => {
  it('keeps kg for metric', () => {
    expect(convertWeight(70, 'metric')).toBe(70.0);
  });
  it('converts kg to lbs for imperial', () => {
    expect(convertWeight(100, 'imperial')).toBe(220.5);
  });
  it('converts kg to lbs for stone', () => {
    expect(convertWeight(50, 'stone')).toBe(110.2);
  });
});

describe('convertDistance', () => {
  it('keeps km for metric', () => {
    expect(convertDistance(10, 'metric')).toBe(10.0);
  });
  it('converts km to miles for imperial', () => {
    expect(convertDistance(10, 'imperial')).toBe(6.21);
  });
  it('converts km to miles for stone', () => {
    expect(convertDistance(5, 'stone')).toBe(3.11);
  });
});

describe('getWeightUnit', () => {
  it('returns kg for metric', () => expect(getWeightUnit('metric')).toBe('kg'));
  it('returns lbs for imperial', () => expect(getWeightUnit('imperial')).toBe('lbs'));
  it('returns st for stone', () => expect(getWeightUnit('stone')).toBe('st'));
  it('defaults to kg', () => expect(getWeightUnit()).toBe('kg'));
});

describe('getDistanceUnit', () => {
  it('returns km for metric', () => expect(getDistanceUnit('metric')).toBe('km'));
  it('returns mi for imperial', () => expect(getDistanceUnit('imperial')).toBe('mi'));
  it('returns mi for stone', () => expect(getDistanceUnit('stone')).toBe('mi'));
});

describe('formatPaceAndSpeed', () => {
  it('returns empty string when distance is zero', () => {
    expect(formatPaceAndSpeed(0, 600)).toBe('');
  });
  it('returns empty string when time is zero', () => {
    expect(formatPaceAndSpeed(5000, 0)).toBe('');
  });
  it('formats metric pace and speed correctly', () => {
    // 10 km in 60 min → 6:00 min/km, 10.0 km/h
    const result = formatPaceAndSpeed(10000, 3600, 'metric');
    expect(result).toBe('6:00 min/km • 10.0 km/h');
  });
  it('formats imperial pace and speed correctly', () => {
    // 10 km in 60 min → 6.214 mi → pace ≈ 9:39 min/mi, speed ≈ 6.2 mph
    const result = formatPaceAndSpeed(10000, 3600, 'imperial');
    expect(result).toMatch(/min\/mi.*mph/);
  });
});

describe('parseUTCDate', () => {
  it('parses ISO date-only string as midnight UTC', () => {
    const d = parseUTCDate('2024-01-15');
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(0);
  });
  it('parses ISO datetime with Z', () => {
    const d = parseUTCDate('2024-06-01T12:30:00Z');
    expect(d.getUTCHours()).toBe(12);
    expect(d.getUTCMinutes()).toBe(30);
  });
  it('parses space-separated datetime as UTC', () => {
    const d = parseUTCDate('2024-03-10 08:00:00');
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(2);
  });
  it('returns a Date for empty string (fallback)', () => {
    const d = parseUTCDate('');
    expect(d).toBeInstanceOf(Date);
  });
});

describe('convertHeight', () => {
  it('returns meters for metric', () => {
    expect(convertHeight(1.8, 'metric')).toBe(1.8);
  });
  it('converts to inches for imperial', () => {
    // 1.8m * 39.3701 = 70.9 inches
    expect(convertHeight(1.8, 'imperial')).toBe(70.9);
  });
});

describe('getHeightUnit', () => {
  it('returns m for metric', () => expect(getHeightUnit('metric')).toBe('m'));
  it('returns in for imperial', () => expect(getHeightUnit('imperial')).toBe('in'));
  it('defaults to m', () => expect(getHeightUnit()).toBe('m'));
});
