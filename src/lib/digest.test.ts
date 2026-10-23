import { describe, it, expect } from 'vitest';
import { buildDigest, renderDigestText, changeOf, PERIOD_DAYS, isDigestPeriod, type DigestInput } from './digest';

const TODAY = '2026-10-18';

/** A daily row for `date` with the given metric values. */
const day = (date: string, values: Record<string, number>) => ({ date, ...values });

const base = (over: Partial<DigestInput> = {}): DigestInput => ({
  period: 'week',
  today: TODAY,
  timezone: 'Europe/London',
  daily: [],
  workouts: [],
  ...over,
});

const lineOf = (digest: any, key: string) =>
  digest.sections.flatMap((s: any) => s.lines).find((l: any) => l.key === key);

describe('buildDigest windows', () => {
  it('uses a trailing 7-day window ending today, and the 7 before it', () => {
    const d = buildDigest(base());
    expect(d.current).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(d.previous).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(d.days).toBe(7);
  });

  it('uses 30 days for a month', () => {
    const d = buildDigest(base({ period: 'month' }));
    expect(d.current).toEqual({ from: '2026-09-19', to: '2026-10-18' });
    expect(d.previous).toEqual({ from: '2026-08-20', to: '2026-09-18' });
    expect(PERIOD_DAYS.month).toBe(30);
  });

  it('ignores days outside both windows', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-12', { steps: 10000 }), day('2026-10-11', { steps: 2000 }), day('2026-09-01', { steps: 99999 })],
    }));
    const steps = lineOf(d, 'steps');
    expect(steps.current).toBe(10000);
    expect(steps.previous).toBe(2000);
  });
});

describe('aggregation', () => {
  it('averages sleep across nights with data and converts seconds to hours', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { sleep_total: 7 * 3600 }), day('2026-10-17', { sleep_total: 8 * 3600 })],
    }));
    const sleep = lineOf(d, 'sleep_hours');
    expect(sleep.current).toBe(7.5);
    expect(sleep.unit).toBe('h');
    // Averaged over the 2 nights that have data, not over all 7 days.
    expect(sleep.daysWithData).toBe(2);
  });

  it('reports the latest weight separately from the window average', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-14', { weight: 76 }), day('2026-10-18', { weight: 74 })],
    }));
    expect(lineOf(d, 'weight').current).toBe(75);
    expect(lineOf(d, 'weight_latest').current).toBe(74);
  });

  it('sums sessions, minutes and volume from workouts, duration as minutes', () => {
    const d = buildDigest(base({
      workouts: [
        { timestamp: '2026-10-18T09:00:00.000Z', duration: 49, volume: 4000 },
        { timestamp: '2026-10-16T09:00:00.000Z', duration: 51, volume: 3000 },
        { timestamp: '2026-10-08T09:00:00.000Z', duration: 40, volume: 1000 },
      ],
    }));
    expect(lineOf(d, 'sessions').current).toBe(2);
    expect(lineOf(d, 'sessions').previous).toBe(1);
    expect(lineOf(d, 'training_minutes').current).toBe(100);
    expect(lineOf(d, 'training_volume').current).toBe(7000);
  });

  it('accepts Date timestamps on workouts', () => {
    const d = buildDigest(base({ workouts: [{ timestamp: new Date('2026-10-17T22:00:00.000Z'), duration: 30 }] }));
    expect(lineOf(d, 'sessions').current).toBe(1);
  });

  it('skips unparseable metric values rather than producing NaN', () => {
    const d = buildDigest(base({
      daily: [{ date: '2026-10-18', steps: 'banana' as any }, day('2026-10-17', { steps: 4000 })],
    }));
    expect(lineOf(d, 'steps').current).toBe(4000);
  });
});

describe('change and direction', () => {
  it('computes percent change against the previous window', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { protein: 110 }), day('2026-10-08', { protein: 100 })],
    }));
    const protein = lineOf(d, 'protein');
    expect(protein.changePct).toBe(10);
    expect(protein.direction).toBe('up');
    expect(protein.text).toBe('Protein: 110 g (prev 100, +10%)');
  });

  it('reports no previous period rather than an infinite change', () => {
    const d = buildDigest(base({ daily: [day('2026-10-18', { steps: 5000 })] }));
    const steps = lineOf(d, 'steps');
    expect(steps.previous).toBeNull();
    expect(steps.changePct).toBeNull();
    expect(steps.direction).toBeNull();
    expect(steps.text).toBe('Steps: 5,000 /day (no previous period)');
  });

  it('calls a sub-1% move flat', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { weight: 74.6 }), day('2026-10-08', { weight: 74.65 })],
    }));
    expect(lineOf(d, 'weight').direction).toBe('flat');
  });

  it('changeOf refuses a zero baseline', () => {
    expect(changeOf(5, 0)).toBeNull();
    expect(changeOf(null, 10)).toBeNull();
    expect(changeOf(5, 4)).toBe(25);
  });

  it('a workout window with no previous sessions has no percentage', () => {
    const d = buildDigest(base({ workouts: [{ timestamp: '2026-10-18T09:00:00.000Z', duration: 45 }] }));
    expect(lineOf(d, 'sessions').previous).toBe(0);
    expect(lineOf(d, 'sessions').changePct).toBeNull();
  });
});

describe('targets and missing data', () => {
  it('attaches the matching target to its line', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { calories_in: 2100, steps: 8000 })],
      // `calories` is the target type; `calories_in` is the metric. The spec used to
      // ask for the metric name, so this line carried no target at all.
      targets: [{ type: 'calories', value: 2000 }, { type: 'protein', value: '180' }],
    }));
    expect(lineOf(d, 'calories_in').target).toBe(2000);
    expect(lineOf(d, 'protein').target).toBe(180);
    expect(lineOf(d, 'steps').target).toBeNull();
  });

  it('averages the training- and rest-day calorie targets across the window', () => {
    // Four training days (>= 20 min, not a walk) and three rest days in the week
    // ending 2026-10-18: (4 * 2600 + 3 * 2000) / 7 = 2343.
    const session = (date: string, duration: number, name = 'Upper A') =>
      ({ timestamp: `${date}T18:00:00Z`, duration, name });
    const d = buildDigest(base({
      daily: [day('2026-10-18', { calories_in: 2400 })],
      targets: [{ type: 'calories', value: 2600 }, { type: 'calories_rest', value: 2000 }],
      workouts: [
        session('2026-10-12', 45), session('2026-10-14', 45), session('2026-10-16', 45), session('2026-10-18', 45),
        session('2026-10-13', 60, 'Outdoor Walk'),   // a walk is not training
        session('2026-10-15', 10),                   // under 20 minutes
      ],
    }));
    expect(lineOf(d, 'calories_in').target).toBe(2343);
  });

  // 0 is the API's storage form for "unset" (new users are seeded with 0 rows),
  // so it must not read as a goal of zero -- live data has steps and weight at 0.
  // The card renders line.target and the copy button renders line.text; both must
  // name the same number, so the sentence carries the target too.
  it('names the target in the line sentence, and says nothing when there is none', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { calories_in: 2400, steps: 8000 })],
      targets: [{ type: 'calories', value: 2055 }],
    }));
    expect(lineOf(d, 'calories_in').text).toContain('vs 2,055 target');
    expect(lineOf(d, 'steps').text).not.toContain('target');
    expect(lineOf(d, 'steps').target).toBeNull();
  });

  it('treats a 0 target as unset, not as a target of zero', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { steps: 8000, weight: 82 })],
      targets: [{ type: 'steps', value: 0 }, { type: 'weight', value: 0 }],
    }));
    expect(lineOf(d, 'steps').target).toBeNull();
    expect(lineOf(d, 'weight').target).toBeNull();
  });

  it('ignores a 0 rest-day variant and keeps the base target', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { calories_in: 2400 })],
      targets: [{ type: 'calories', value: 2600 }, { type: 'calories_rest', value: 0 }],
      workouts: [{ timestamp: '2026-10-18T18:00:00Z', duration: 45, name: 'Upper A' }],
    }));
    expect(lineOf(d, 'calories_in').target).toBe(2600);
  });

  it('uses the base target when no rest-day variant is set', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { calories_in: 2400 })],
      targets: [{ type: 'calories', value: 2600 }],
      workouts: [{ timestamp: '2026-10-18T18:00:00Z', duration: 45, name: 'Upper A' }],
    }));
    expect(lineOf(d, 'calories_in').target).toBe(2600);
  });

  // Every target type the UI can set now reaches a line. Two of the pairings do
  // NOT share a name -- the `calories` target drives the `calories_in` metric and
  // the `vo2_max` target drives the `vo2max` metric -- which is exactly how the
  // intake line came to carry no target for as long as it did. TargetsTab.tsx's
  // TARGET_METRIC_MAP is the authority on the pairings; this pins the digest to it.
  it('resolves every settable target onto its line, mismatched names included', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', {
        sleep_total: 7 * 3600, calories_in: 2400, protein: 150, carbs: 180, fat: 70,
        weight: 82, body_fat: 21, muscle_mass: 58, steps: 9000, active_energy: 700,
        resting_heart_rate: 55, vo2max: 36,
      })],
      targets: [
        { type: 'sleep', value: 8 }, { type: 'calories', value: 2600 }, { type: 'protein', value: 160 },
        { type: 'carbs', value: 185 }, { type: 'fat', value: 75 }, { type: 'weight', value: 80 },
        { type: 'body_fat', value: 20 }, { type: 'muscle_mass', value: 59 }, { type: 'steps', value: 10000 },
        { type: 'active_energy', value: 600 }, { type: 'resting_heart_rate', value: 52 },
        { type: 'vo2_max', value: 37 },
      ],
    }));
    const targetsByKey = Object.fromEntries(
      d.sections.flatMap((s: any) => s.lines).map((l: any) => [l.key, l.target]),
    );
    expect(targetsByKey).toEqual({
      sessions: null, training_minutes: null, training_volume: null,
      sleep_hours: 8, sleep_deep_hours: null,
      calories_in: 2600, protein: 160, carbs: 185, fat: 75,
      weight: 80, weight_latest: null, body_fat: 20, muscle_mass: 59,
      steps: 10000, active_energy: 600, resting_heart_rate: 52, vo2max: 37,
    });
    expect(lineOf(d, 'body_fat').text).toContain('vs 20.0 target');
    expect(lineOf(d, 'vo2max').text).toContain('vs 37.0 target');
  });

  it('marks a metric with no data as no data and headlines it', () => {
    const d = buildDigest(base({ daily: [day('2026-10-18', { steps: 8000 })] }));
    const bodyFat = lineOf(d, 'body_fat');
    expect(bodyFat.current).toBeNull();
    expect(bodyFat.text).toBe('Body fat: no data');
    expect(d.headlines.some((h) => h.startsWith('Nothing logged in the last 7 days for:') && h.includes('Body fat'))).toBe(true);
  });
});

describe('headlines', () => {
  it('leads with the biggest movers and caps at five', () => {
    const d = buildDigest(base({
      daily: [
        day('2026-10-18', { steps: 10000, protein: 200, calories_in: 3000, weight: 70, body_fat: 20, active_energy: 900, resting_heart_rate: 70, sleep_total: 8 * 3600, sleep_deep: 2 * 3600 }),
        day('2026-10-08', { steps: 5000, protein: 100, calories_in: 1500, weight: 80, body_fat: 25, active_energy: 300, resting_heart_rate: 50, sleep_total: 4 * 3600, sleep_deep: 1 * 3600 }),
      ],
    }));
    expect(d.headlines).toHaveLength(5);
    expect(d.headlines[0]).toMatch(/\+200%|200%/);
  });

  it('lists every silent metric on one line, not one bullet each', () => {
    const d = buildDigest(base({
      daily: [day('2026-10-18', { steps: 5000 }), day('2026-10-08', { steps: 5000 })],
    }));
    const quiet = d.headlines.filter((h) => h.startsWith('Nothing logged'));
    expect(quiet).toHaveLength(1);
    expect(quiet[0]).toContain('Sleep, Deep sleep, Calories in, Protein, Carbs, Fat, Weight, Body fat, Muscle mass');
    // Weight and "latest weight" are the same metric; it is named once.
    expect(quiet[0].match(/Weight/g)).toHaveLength(1);
  });

  it('says so when nothing moved and nothing is missing', () => {
    const full = (date: string) => day(date, {
      sleep_total: 7 * 3600, sleep_deep: 3600, calories_in: 2000, protein: 150,
      carbs: 200, fat: 70, weight: 75, body_fat: 20, muscle_mass: 58, steps: 5000,
      active_energy: 500, resting_heart_rate: 55, vo2max: 36,
    });
    const d = buildDigest(base({
      daily: [full('2026-10-18'), full('2026-10-08')],
      workouts: [{ timestamp: '2026-10-18T09:00:00.000Z', duration: 45, volume: 3000 },
                 { timestamp: '2026-10-08T09:00:00.000Z', duration: 45, volume: 3000 }],
    }));
    expect(d.headlines).toEqual(['Nothing moved more than 5% against the previous period.']);
  });
});

describe('rendering', () => {
  it('renders a plain-text digest with every section', () => {
    const text = renderDigestText(buildDigest(base({
      daily: [day('2026-10-18', { sleep_total: 7 * 3600, steps: 6000 })],
      workouts: [{ timestamp: '2026-10-17T09:00:00.000Z', duration: 45, volume: 3000 }],
    })));
    expect(text.split('\n')[0]).toBe('Weekly digest — 2026-10-12 to 2026-10-18');
    for (const section of ['Training', 'Sleep', 'Intake', 'Body', 'Activity']) {
      expect(text).toContain(section);
    }
    expect(text).toContain('Sessions: 1');
  });

  it('titles a monthly digest as monthly', () => {
    expect(renderDigestText(buildDigest(base({ period: 'month' })))).toContain('Monthly digest');
  });
});

describe('isDigestPeriod', () => {
  it('accepts only week and month', () => {
    expect(isDigestPeriod('week')).toBe(true);
    expect(isDigestPeriod('month')).toBe(true);
    expect(isDigestPeriod('year')).toBe(false);
    expect(isDigestPeriod(undefined)).toBe(false);
  });
});
