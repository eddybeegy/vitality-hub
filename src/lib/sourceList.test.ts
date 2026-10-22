import { describe, it, expect } from 'vitest';
import { withAllSources } from './sourceList';

const CATALOGUE = ['apple_health', 'cronometer', 'withings', 'healthsync', 'manual'];

describe('withAllSources', () => {
  it('appends a newly catalogued source to a priority list saved before it existed', () => {
    const stored = ['cronometer', 'apple_health', 'withings', 'manual'];
    expect(withAllSources(stored, CATALOGUE)).toEqual([
      'cronometer', 'apple_health', 'withings', 'manual', 'healthsync',
    ]);
  });

  it('leaves a list that already covers the catalogue untouched, order and all', () => {
    const stored = ['healthsync', 'manual', 'withings', 'cronometer', 'apple_health'];
    expect(withAllSources(stored, CATALOGUE)).toEqual(stored);
  });

  it('keeps ids that are no longer in the catalogue', () => {
    expect(withAllSources(['retired_source'], CATALOGUE)).toEqual([
      'retired_source', ...CATALOGUE,
    ]);
  });

  it('returns the catalogue for an empty stored list and does not mutate its inputs', () => {
    const stored: string[] = [];
    expect(withAllSources(stored, CATALOGUE)).toEqual(CATALOGUE);
    expect(stored).toEqual([]);
    expect(CATALOGUE).toHaveLength(5);
  });
});
