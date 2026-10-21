import { describe, expect, it } from 'vitest';
import { chooseSource, listFor, type SourceCounts, type SourcePolicy } from './sourcePriority';

// Same table as server.ts's SOURCE_RANK.
const SOURCE_RANK: Record<string, number> = {
  cronometer: 1, nutracheck: 2, nutrachek: 2, hevy: 2, apple_health: 3, withings: 4, healthsync: 4,
};
const policy = (priorities: Record<string, string[]> | null = null): SourcePolicy =>
  ({ priorities, sourceRank: SOURCE_RANK, unknownSourceRank: 4 });

const day = (byType: Record<string, SourceCounts>) => (t: string) => byType[t];

// The comparator the three resolvers carried inline before this module.
function oldWinner(counts: SourceCounts, list: string[] | undefined): string | null {
  const userRank = (src: string) => {
    if (!list || list.length === 0) return Infinity;
    const i = list.indexOf(src);
    return i === -1 ? Infinity : i;
  };
  return Object.keys(counts).sort((a, b) => {
    const ua = userRank(a), ub = userRank(b);
    if (ua !== ub) return ua - ub;
    const ra = SOURCE_RANK[a] ?? 4, rb = SOURCE_RANK[b] ?? 4;
    if (ra !== rb) return ra - rb;
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return a.localeCompare(b);
  })[0] ?? null;
}

describe('chooseSource, unpaired types (unchanged policy)', () => {
  const cases: Array<[string, SourceCounts, Record<string, string[]> | null]> = [
    ['weight', { withings: 1, apple_health: 2 }, null],
    ['weight', { withings: 1, apple_health: 2 }, { weight: ['withings', 'apple_health'] }],
    ['calories_in', { apple_health: 30, cronometer: 1, nutrachek: 4 }, null],
    ['heart_rate', { healthsync: 200, withings: 3 }, null],
    ['heart_rate', { healthsync: 3, withings: 3 }, null],
    ['steps', { mystery: 5, healthsync: 5 }, null],
    ['steps', { apple_health: 1, healthsync: 9 }, { steps: ['strava'] }],
    ['body_fat', {}, null],
  ];
  it.each(cases)('%s %j with %j matches the old comparator', (type, counts, priorities) => {
    const got = chooseSource(type, day({ [type]: counts }), policy(priorities));
    expect(got.winner).toBe(oldWinner(counts, priorities?.[type]));
    expect(got.contenders.length).toBe(Object.keys(counts).length);
  });

  it('ignores other types the same day', () => {
    const got = chooseSource('weight', day({ weight: { withings: 1 }, blood_pressure_systolic: { apple_health: 1 } }), policy());
    expect(got).toEqual({ winner: 'withings', contenders: ['withings'] });
  });
});

describe('chooseSource, blood pressure resolves as one reading (item 66)', () => {
  // The live shape behind 6 of 40 readings: withings has the whole pair, apple_health
  // only a diastolic. Per-type resolution gave systolic=withings, diastolic=apple_health.
  const split = day({
    blood_pressure_systolic: { withings: 1 },
    blood_pressure_diastolic: { withings: 1, apple_health: 1 },
  });

  it('both halves come from the device that has the whole pair', () => {
    expect(chooseSource('blood_pressure_systolic', split, policy()).winner).toBe('withings');
    expect(chooseSource('blood_pressure_diastolic', split, policy()).winner).toBe('withings');
  });

  it('the losing half is still listed as a contender, after the winner', () => {
    expect(chooseSource('blood_pressure_diastolic', split, policy()).contenders).toEqual(['withings', 'apple_health']);
  });

  it('with two complete pairs, the usual policy picks one source for both', () => {
    const both = day({
      blood_pressure_systolic: { withings: 1, apple_health: 1 },
      blood_pressure_diastolic: { withings: 1, apple_health: 1 },
    });
    expect(chooseSource('blood_pressure_systolic', both, policy()).winner).toBe('apple_health');
    expect(chooseSource('blood_pressure_diastolic', both, policy()).winner).toBe('apple_health');
  });

  it('ties at the same rank break on combined row count, then name, for both halves alike', () => {
    const tie = day({
      blood_pressure_systolic: { withings: 1, healthsync: 2 },
      blood_pressure_diastolic: { withings: 3, healthsync: 2 },
    });
    // combined: withings 4, healthsync 4 -> name -> healthsync
    expect(chooseSource('blood_pressure_systolic', tie, policy()).winner).toBe('healthsync');
    expect(chooseSource('blood_pressure_diastolic', tie, policy()).winner).toBe('healthsync');
  });

  it('a per-half priority list applies to the whole reading', () => {
    const both = day({
      blood_pressure_systolic: { withings: 1, apple_health: 1 },
      blood_pressure_diastolic: { withings: 1, apple_health: 1 },
    });
    const p = policy({ blood_pressure_systolic: ['withings'] });
    expect(chooseSource('blood_pressure_systolic', both, p).winner).toBe('withings');
    expect(chooseSource('blood_pressure_diastolic', both, p).winner).toBe('withings');
  });

  it('with no complete pair, only the best source shows its half; the other device is dropped', () => {
    const halves = day({
      blood_pressure_systolic: { withings: 1 },
      blood_pressure_diastolic: { apple_health: 1 },
    });
    expect(chooseSource('blood_pressure_diastolic', halves, policy())).toEqual({ winner: 'apple_health', contenders: ['apple_health'] });
    expect(chooseSource('blood_pressure_systolic', halves, policy())).toEqual({ winner: null, contenders: ['withings'] });
  });

  it('one device on its own is unaffected', () => {
    const one = day({ blood_pressure_systolic: { healthsync: 2 }, blood_pressure_diastolic: { healthsync: 2 } });
    expect(chooseSource('blood_pressure_systolic', one, policy()).winner).toBe('healthsync');
    expect(chooseSource('blood_pressure_diastolic', one, policy()).winner).toBe('healthsync');
  });
});

describe('the blood_pressure priority key (item 67)', () => {
  // What Settings > Metric Source Priority writes for the "Blood Pressure" card.
  const ui = { blood_pressure: ['withings', 'apple_health'] };
  const both = day({
    blood_pressure_systolic: { withings: 1, apple_health: 1 },
    blood_pressure_diastolic: { withings: 1, apple_health: 1 },
  });

  it('used to be dead config: by SOURCE_RANK alone apple_health wins', () => {
    expect(chooseSource('blood_pressure_systolic', both, policy()).winner).toBe('apple_health');
  });

  it('now decides both halves', () => {
    expect(chooseSource('blood_pressure_systolic', both, policy(ui)).winner).toBe('withings');
    expect(chooseSource('blood_pressure_diastolic', both, policy(ui)).winner).toBe('withings');
  });

  it('still prefers a device with the whole reading over a listed device with half of it', () => {
    const half = day({
      blood_pressure_systolic: { apple_health: 1 },
      blood_pressure_diastolic: { withings: 1, apple_health: 1 },
    });
    expect(chooseSource('blood_pressure_diastolic', half, policy(ui)).winner).toBe('apple_health');
  });

  it('listFor: the group key first, then either half, and an exact lookup for anything else', () => {
    expect(listFor('blood_pressure_diastolic', ui)).toEqual(['withings', 'apple_health']);
    expect(listFor('blood_pressure_systolic', { blood_pressure: [], blood_pressure_diastolic: ['healthsync'] })).toEqual(['healthsync']);
    expect(listFor('blood_pressure_systolic', { ...ui, blood_pressure_systolic: ['healthsync'] })).toEqual(['withings', 'apple_health']);
    expect(listFor('weight', ui)).toBeUndefined();
    expect(listFor('weight', null)).toBeUndefined();
  });

  it('does not leak onto other types', () => {
    const w = day({ weight: { withings: 1, apple_health: 1 } });
    expect(chooseSource('weight', w, policy(ui)).winner).toBe('apple_health');
  });
});
