import { describe, expect, it } from 'vitest';
import { dayTypeFor, hasRestTargets, targetForDay, trainedOn } from './dayTargets';

const LONDON = 'Europe/London';

describe('trainedOn', () => {
  it('counts a 20+ minute non-walk workout on the London day', () => {
    expect(trainedOn([{ timestamp: '2026-10-22T07:00:00Z', name: 'Push', duration: 55 }], '2026-10-22', LONDON)).toBe(true);
  });

  it('ignores walks and short sessions', () => {
    const w = [
      { timestamp: '2026-10-22T12:00:00Z', name: 'Outdoor Walk', duration: 60 },
      { timestamp: '2026-10-22T12:00:00Z', name: 'Core', duration: 10 },
    ];
    expect(trainedOn(w, '2026-10-22', LONDON)).toBe(false);
  });

  it('puts a late BST session on the next London day', () => {
    // 23:30 UTC on 21 Oct is 00:30 BST on 22 Oct.
    const w = [{ timestamp: '2026-10-21T23:30:00Z', name: 'Legs', duration: 45 }];
    expect(trainedOn(w, '2026-10-22', LONDON)).toBe(true);
    expect(trainedOn(w, '2026-10-21', LONDON)).toBe(false);
  });
});

describe('dayTypeFor', () => {
  const legs = [{ timestamp: '2026-10-22T07:00:00Z', name: 'Legs', duration: 50 }];
  it('infers from workouts', () => {
    expect(dayTypeFor(legs, '2026-10-22', LONDON, null)).toEqual({ type: 'training', source: 'auto' });
    expect(dayTypeFor([], '2026-10-22', LONDON, null)).toEqual({ type: 'rest', source: 'auto' });
  });

  it('treats unloaded workouts as a training day', () => {
    expect(dayTypeFor(undefined, '2026-10-22', LONDON, null).type).toBe('training');
  });

  it('lets an override win both ways', () => {
    expect(dayTypeFor([], '2026-10-22', LONDON, 'training')).toEqual({ type: 'training', source: 'manual' });
    expect(dayTypeFor(legs, '2026-10-22', LONDON, 'rest')).toEqual({ type: 'rest', source: 'manual' });
  });
});

describe('targetForDay', () => {
  const targets: Record<string, number> = { calories: 2600, carbs: 300, protein: 160, calories_rest: 2200 };
  const base = (t: string) => targets[t];

  it('uses the rest variant on a rest day when it is set', () => {
    expect(targetForDay('calories', 'rest', base)).toBe(2200);
    expect(targetForDay('calories', 'training', base)).toBe(2600);
  });

  it('falls back to the base target when no rest variant is set', () => {
    expect(targetForDay('carbs', 'rest', base)).toBe(300);
    expect(targetForDay('protein', 'rest', base)).toBe(160);
  });

  it('knows whether any rest target is set', () => {
    expect(hasRestTargets(base)).toBe(true);
    expect(hasRestTargets(t => (t === 'calories' ? 2000 : undefined))).toBe(false);
  });
});
