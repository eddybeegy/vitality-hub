import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  MIN_HR_SAMPLES,
  derivedWorkoutHrSql,
  mergeDerivedHeartRate,
} from './workoutHeartRate';

function sqliteFixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workouts (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT,
      timestamp TEXT, duration REAL, distance REAL, heart_rate_avg REAL);
    CREATE TABLE metrics (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT,
      timestamp TEXT, value REAL);
  `);
  const addWorkout = db.prepare(
    'INSERT INTO workouts (id, user_id, name, timestamp, duration, distance, heart_rate_avg) VALUES (?,?,?,?,?,?,?)');
  const addMetric = db.prepare(
    'INSERT INTO metrics (user_id, type, timestamp, value) VALUES (?,?,?,?)');
  const run = (userId: number, windowStart: string) =>
    db.prepare(derivedWorkoutHrSql('sqlite', 'w.timestamp', 'm.timestamp'))
      .all(userId, windowStart) as Array<{ id: number; avg_hr: number }>;
  return { db, addWorkout, addMetric, run };
}

describe('derivedWorkoutHrSql (sqlite)', () => {
  it('averages only the heart_rate readings inside the session', () => {
    const { addWorkout, addMetric, run } = sqliteFixture();
    // 30 minutes from 07:00. 100/110/120 inside; 200 before and 200 after must not count.
    addWorkout.run(1, 1, 'Outdoor Walk', '2026-10-13T07:00:00.000Z', 30, 2155, null);
    addMetric.run(1, 'heart_rate', '2026-10-13T06:59:00.000Z', 200);
    addMetric.run(1, 'heart_rate', '2026-10-13T07:00:00.000Z', 100);
    addMetric.run(1, 'heart_rate', '2026-10-13T07:15:00.000Z', 110);
    addMetric.run(1, 'heart_rate', '2026-10-13T07:29:59.000Z', 120);
    addMetric.run(1, 'heart_rate', '2026-10-13T07:30:00.000Z', 200); // end is exclusive
    expect(run(1, '2026-08-01T00:00:00.000Z')).toEqual([{ id: 1, avg_hr: 110 }]);
  });

  it('ignores other users, other metric types, and sessions outside the window', () => {
    const { addWorkout, addMetric, run } = sqliteFixture();
    addWorkout.run(1, 1, 'Outdoor Walk', '2026-10-13T07:00:00.000Z', 30, 2155, null);
    addWorkout.run(2, 2, 'Outdoor Walk', '2026-10-13T07:00:00.000Z', 30, 2155, null);
    addWorkout.run(3, 1, 'Outdoor Walk', '2026-01-01T07:00:00.000Z', 30, 2155, null);
    for (const w of ['2026-10-13', '2026-01-01']) {
      for (const m of ['07:01', '07:02', '07:03']) {
        addMetric.run(1, 'heart_rate', `${w}T${m}:00.000Z`, 150);
        addMetric.run(2, 'heart_rate', `${w}T${m}:00.000Z`, 150);
        addMetric.run(1, 'respiratory_rate', `${w}T${m}:00.000Z`, 14);
      }
    }
    expect(run(1, '2026-08-01T00:00:00.000Z')).toEqual([{ id: 1, avg_hr: 150 }]);
  });

  it(`needs ${MIN_HR_SAMPLES} samples, a distance, and no stored average`, () => {
    const { addWorkout, addMetric, run } = sqliteFixture();
    addWorkout.run(1, 1, 'Too few samples', '2026-10-13T07:00:00.000Z', 30, 2155, null);
    addWorkout.run(2, 1, 'No distance', '2026-10-13T08:00:00.000Z', 30, null, null);
    addWorkout.run(3, 1, 'Already measured', '2026-10-13T09:00:00.000Z', 30, 2155, 142);
    addWorkout.run(4, 1, 'Zero duration', '2026-10-13T10:00:00.000Z', 0, 2155, null);
    addWorkout.run(5, 1, 'Good', '2026-10-13T11:00:00.000Z', 30, 2155, null);
    for (let h = 7; h <= 11; h++) {
      const n = h === 7 ? MIN_HR_SAMPLES - 1 : MIN_HR_SAMPLES;
      for (let i = 0; i < n; i++) {
        addMetric.run(1, 'heart_rate', `2026-10-13T${String(h).padStart(2, '0')}:0${i}:00.000Z`, 130);
      }
    }
    expect(run(1, '2026-08-01T00:00:00.000Z')).toEqual([{ id: 5, avg_hr: 130 }]);
  });
});

describe('derivedWorkoutHrSql (postgres)', () => {
  // The timestamp convention differs per table -- healthsync stamps `metrics` as London
  // wall-clock but `workouts` as UTC -- so the caller's readingInstant expressions must
  // reach the comparison rather than the raw columns.
  const sql = derivedWorkoutHrSql(
    'postgres',
    "(w.timestamp AT TIME ZONE 'UTC')",
    "(CASE WHEN m.source = 'healthsync' THEN m.timestamp AT TIME ZONE 'Europe/London' ELSE m.timestamp AT TIME ZONE 'UTC' END)",
  );

  it('compares the caller instants, not the raw columns', () => {
    expect(sql).toContain("CASE WHEN m.source = 'healthsync'");
    expect(sql).toContain("(w.timestamp AT TIME ZONE 'UTC') + w.duration * interval '1 minute'");
    expect(sql).not.toMatch(/m\.timestamp >= w\.timestamp/);
  });

  it('keeps the scope that makes it a 5ms query', () => {
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain('w.distance IS NOT NULL');
    expect(sql).toContain('w.heart_rate_avg IS NULL');
    expect(sql).toContain(`hr.n >= ${MIN_HR_SAMPLES}`);
  });
});

describe('mergeDerivedHeartRate', () => {
  it('fills missing averages and marks them derived', () => {
    const workouts = [{ id: 1, heart_rate_avg: null }, { id: 2, heart_rate_avg: null }];
    expect(mergeDerivedHeartRate(workouts, [{ id: 1, avg_hr: 112 }])).toBe(1);
    expect(workouts[0]).toEqual({ id: 1, heart_rate_avg: 112, heart_rate_avg_derived: true });
    expect(workouts[1]).toEqual({ id: 2, heart_rate_avg: null });
  });

  it('never overwrites a measured average', () => {
    const workouts = [{ id: 1, heart_rate_avg: 142 }];
    expect(mergeDerivedHeartRate(workouts, [{ id: 1, avg_hr: 112 }])).toBe(0);
    expect(workouts[0].heart_rate_avg).toBe(142);
  });

  it('drops implausible and unusable values rather than publishing them', () => {
    const workouts = [1, 2, 3, 4].map(id => ({ id, heart_rate_avg: null as number | null }));
    expect(mergeDerivedHeartRate(workouts, [
      { id: 1, avg_hr: 12 }, { id: 2, avg_hr: 400 },
      { id: 3, avg_hr: null }, { id: 4, avg_hr: 'n/a' },
    ])).toBe(0);
    expect(workouts.every(w => w.heart_rate_avg === null)).toBe(true);
  });

  it('matches ids across the string/number divide between drivers', () => {
    const workouts = [{ id: '7', heart_rate_avg: null }];
    expect(mergeDerivedHeartRate(workouts, [{ id: 7, avg_hr: 112 }])).toBe(1);
    expect(workouts[0].heart_rate_avg).toBe(112);
  });
});
