import { describe, it, expect } from 'vitest';
import {
  decideAutoTargets,
  autoTargetsDue,
  daysBetween,
  AUTO_TARGET_WEEKDAY,
  DEFAULT_MAX_CHANGE_KCAL,
  type AutoTargetInput,
} from './autoTargets';

// A Monday, with an estimate the guards are happy with and targets 100 kcal away.
const base = (over: Partial<AutoTargetInput> = {}): AutoTargetInput => ({
  enabled: true,
  today: '2026-10-26',
  weekday: AUTO_TARGET_WEEKDAY,
  lastAppliedDay: null,
  confidence: 'high',
  suggestion: { calories: 2150, protein: 165 },
  current: { calories: 2055, protein: 160 },
  maxChangeKcal: DEFAULT_MAX_CHANGE_KCAL,
  ...over,
});

describe('daysBetween', () => {
  it('counts whole days across a DST change', () => {
    // UK clocks go back on 2026-10-25; a naive local-midnight subtraction gives 0.96 days.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('returns null for an unparseable day', () => {
    expect(daysBetween('not-a-day', '2026-10-26')).toBeNull();
  });
});

describe('decideAutoTargets', () => {
  it('applies both targets and names the before and after', () => {
    const d = decideAutoTargets(base());
    expect(d).toEqual({
      apply: true,
      targets: [
        { type: 'calories', value: 2150, unit: 'kcal' },
        { type: 'protein', value: 165, unit: 'g' },
      ],
      changes: ['calories 2055 to 2150', 'protein 160 to 165'],
    });
  });

  it('refuses when the feature is off', () => {
    expect(decideAutoTargets(base({ enabled: false }))).toEqual({
      apply: false,
      reason: 'automatic targets are off',
    });
  });

  it('refuses on any day that is not the scheduled weekday', () => {
    for (const weekday of [0, 2, 3, 4, 5, 6]) {
      expect(decideAutoTargets(base({ weekday }))).toEqual({
        apply: false,
        reason: 'only runs on Monday',
      });
    }
  });

  it('refuses when it already applied inside the week', () => {
    const d = decideAutoTargets(base({ lastAppliedDay: '2026-10-20' }));
    expect(d.apply).toBe(false);
    expect((d as any).reason).toBe('already applied 6 day(s) ago (2026-10-20)');
  });

  it('applies again once a full week has passed', () => {
    expect(decideAutoTargets(base({ lastAppliedDay: '2026-10-19' })).apply).toBe(true);
  });

  it('refuses rather than writing when the stored last-applied day is corrupt', () => {
    const d = decideAutoTargets(base({ lastAppliedDay: 'garbage' }));
    expect(d.apply).toBe(false);
    expect((d as any).reason).toContain('unreadable');
  });

  it('refuses when there is no estimate at all', () => {
    expect(decideAutoTargets(base({ suggestion: null })).apply).toBe(false);
    expect(decideAutoTargets(base({ confidence: null }))).toEqual({
      apply: false,
      reason: 'no adaptive TDEE estimate yet',
    });
  });

  it('refuses on low confidence rather than applying a guess', () => {
    expect(decideAutoTargets(base({ confidence: 'low' }))).toEqual({
      apply: false,
      reason: 'TDEE confidence is low',
    });
  });

  it('applies on medium confidence', () => {
    expect(decideAutoTargets(base({ confidence: 'medium' })).apply).toBe(true);
  });

  it('refuses a move past the cap and names the numbers', () => {
    const d = decideAutoTargets(base({ suggestion: { calories: 2600, protein: 165 } }));
    expect(d).toEqual({
      apply: false,
      reason: 'suggested calories move 545 kcal (2055 to 2600), over the 300 kcal limit',
    });
  });

  it('caps a rise and a fall alike', () => {
    expect(decideAutoTargets(base({ suggestion: { calories: 1500, protein: 165 } })).apply).toBe(false);
  });

  it('allows a move exactly at the cap', () => {
    const d = decideAutoTargets(base({ suggestion: { calories: 2355, protein: 160 } }));
    expect(d).toEqual({
      apply: true,
      targets: [{ type: 'calories', value: 2355, unit: 'kcal' }],
      changes: ['calories 2055 to 2355'],
    });
  });

  it('honours a user-raised cap', () => {
    const d = decideAutoTargets(base({
      suggestion: { calories: 2600, protein: 160 },
      maxChangeKcal: 600,
    }));
    expect(d.apply).toBe(true);
  });

  it('does not cap the first calorie target, because there is no number to protect', () => {
    const d = decideAutoTargets(base({
      current: { calories: null, protein: null },
      suggestion: { calories: 2600, protein: 165 },
    }));
    expect(d).toEqual({
      apply: true,
      targets: [
        { type: 'calories', value: 2600, unit: 'kcal' },
        { type: 'protein', value: 165, unit: 'g' },
      ],
      changes: ['calories unset to 2600', 'protein unset to 165'],
    });
  });

  it('treats a stored 0 target as unset', () => {
    const d = decideAutoTargets(base({ current: { calories: 0, protein: 0 } }));
    expect((d as any).changes).toEqual(['calories unset to 2150', 'protein unset to 165']);
  });

  it('does not cap protein, which moves with lean mass and is low risk', () => {
    const d = decideAutoTargets(base({ suggestion: { calories: 2055, protein: 260 } }));
    expect(d).toEqual({
      apply: true,
      targets: [{ type: 'protein', value: 260, unit: 'g' }],
      changes: ['protein 160 to 260'],
    });
  });

  it('writes only the target that changed', () => {
    const d = decideAutoTargets(base({ suggestion: { calories: 2150, protein: 160 } }));
    expect((d as any).targets).toEqual([{ type: 'calories', value: 2150, unit: 'kcal' }]);
  });

  it('refuses when both targets already match', () => {
    expect(decideAutoTargets(base({ suggestion: { calories: 2055, protein: 160 } }))).toEqual({
      apply: false,
      reason: 'targets already match the suggestion',
    });
  });

  it('refuses a suggestion that is not a usable number', () => {
    for (const suggestion of [
      { calories: 0, protein: 165 },
      { calories: 2150, protein: 0 },
      { calories: NaN, protein: 165 },
    ]) {
      expect(decideAutoTargets(base({ suggestion }))).toEqual({
        apply: false,
        reason: 'suggested targets are not usable numbers',
      });
    }
  });

  it('rounds the suggestion before comparing, so a fractional protein is not a change', () => {
    const d = decideAutoTargets(base({ suggestion: { calories: 2055.2, protein: 160.4 } }));
    expect(d).toEqual({ apply: false, reason: 'targets already match the suggestion' });
  });
});

describe('autoTargetsDue', () => {
  it('is the same schedule decision decideAutoTargets makes', () => {
    const d = { enabled: true, today: '2026-10-26', weekday: AUTO_TARGET_WEEKDAY, lastAppliedDay: null };
    expect(autoTargetsDue(d)).toEqual({ due: true });
    expect(autoTargetsDue({ ...d, weekday: 3 })).toEqual({ due: false, reason: 'only runs on Monday' });
    expect(autoTargetsDue({ ...d, enabled: false })).toEqual({ due: false, reason: 'automatic targets are off' });
    expect(autoTargetsDue({ ...d, lastAppliedDay: '2026-10-25' })).toEqual({
      due: false,
      reason: 'already applied 1 day(s) ago (2026-10-25)',
    });
  });
});
