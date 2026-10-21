import { describe, it, expect } from 'vitest';
import { normaliseTargetValue, isTargetSet, toApiTargetValue, formatTargetLabel } from './targets';

describe('normaliseTargetValue', () => {
  it('treats the stored 0 sentinel as unset', () => {
    expect(normaliseTargetValue(0)).toBeNull();
    expect(normaliseTargetValue('0')).toBeNull();
  });
  it('treats missing, empty and invalid values as unset', () => {
    expect(normaliseTargetValue(null)).toBeNull();
    expect(normaliseTargetValue(undefined)).toBeNull();
    expect(normaliseTargetValue('')).toBeNull();
    expect(normaliseTargetValue(NaN)).toBeNull();
    expect(normaliseTargetValue(-5)).toBeNull();
  });
  it('keeps positive goals, including numeric strings from the DB driver', () => {
    expect(normaliseTargetValue(10000)).toBe(10000);
    expect(normaliseTargetValue('76.5')).toBe(76.5);
    expect(normaliseTargetValue(0.5)).toBe(0.5);
  });
});

describe('isTargetSet', () => {
  it('is false for 0 and null, true for a real goal', () => {
    expect(isTargetSet(0)).toBe(false);
    expect(isTargetSet(null)).toBe(false);
    expect(isTargetSet(150)).toBe(true);
  });
});

describe('toApiTargetValue', () => {
  it('sends unset as 0, which the API accepts', () => {
    expect(toApiTargetValue(null)).toBe(0);
    expect(toApiTargetValue(8)).toBe(8);
  });
});

describe('formatTargetLabel', () => {
  it('omits empty parens for unitless targets', () => {
    expect(formatTargetLabel('Steps', '')).toBe('Steps');
    expect(formatTargetLabel('Steps', null)).toBe('Steps');
    expect(formatTargetLabel('Daily Protein', 'g')).toBe('Daily Protein (g)');
  });
});
