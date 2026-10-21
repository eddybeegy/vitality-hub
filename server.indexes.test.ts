import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// item 49: server.ts creates indexes at boot from two places, the per-table block in
// the CREATE TABLE loop and the declarative `indexes` array. Both use IF NOT EXISTS,
// which matches by NAME only, so the same shape under two names is a full duplicate
// index that every boot rebuilds if a migration drops it. This reads the source and
// fails if any shape is created under more than one name.

type Created = { name: string; shape: string };

function bootIndexes(src: string): Created[] {
  const out: Created[] = [];
  const norm = (cols: string) => cols.split(',').map(c => c.trim()).join(', ');
  // CREATE [UNIQUE] INDEX IF NOT EXISTS name ON table (cols)
  for (const m of src.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+) ?\(([^)]*)\)/g)) {
    out.push({ name: m[2], shape: `${m[1] ? 'unique ' : ''}${m[3]}(${norm(m[4])})` });
  }
  // { name: '...', table: '...', columns: '...', unique: true }
  for (const m of src.matchAll(/\{ name: '(\w+)', table: '(\w+)', columns: '([^']+)'(, unique: true)? \}/g)) {
    out.push({ name: m[1], shape: `${m[4] ? 'unique ' : ''}${m[2]}(${norm(m[3])})` });
  }
  return out;
}

// Known pre-existing duplicate shapes outside item 49's scope (metrics, meal_items,
// workouts). Listed so a NEW duplicate still fails; remove an entry once fixed.
const KNOWN_DUPLICATES = new Set([
  'workout_exercises(workout_id)', // workout_ex_workout_idx + idx_workout_exercises_workout_id
  'workout_sets(exercise_id)',     // workout_sets_ex_idx + idx_workout_sets_exercise_id
]);

describe('server.ts boot indexes (item 49)', () => {
  const created = bootIndexes(readFileSync(join(__dirname, 'server.ts'), 'utf8'));

  it('finds the boot index definitions at all', () => {
    expect(created.length).toBeGreaterThan(15);
  });

  it('never creates the same shape under two names', () => {
    const byShape = new Map<string, Set<string>>();
    for (const c of created) {
      if (!byShape.has(c.shape)) byShape.set(c.shape, new Set());
      byShape.get(c.shape)!.add(c.name);
    }
    const dupes = [...byShape]
      .filter(([shape, names]) => names.size > 1 && !KNOWN_DUPLICATES.has(shape))
      .map(([shape, names]) => `${shape}: ${[...names].join(', ')}`);
    expect(dupes).toEqual([]);
  });

  it('keeps one creator for each name the item 49 migration keeps', () => {
    const names = new Set(created.map(c => c.name));
    for (const keeper of [
      'metrics_unique_idx', 'metrics_user_type_idx', 'metrics_user_timestamp_idx',
      'metrics_user_source_idx', 'metrics_user_source_ts_idx', 'metrics_timestamp_idx',
      'meal_items_unique_idx', 'meal_items_user_ts_idx', 'workouts_user_ts_idx',
    ]) {
      expect(names, keeper).toContain(keeper);
    }
  });

  it('no longer creates the names the item 49 migration drops', () => {
    const names = new Set(created.map(c => c.name));
    for (const dropped of [
      'idx_metrics_unique', 'idx_metrics_user_ts', 'idx_workouts_user_ts',
      'idx_meal_items_user_ts', 'idx_meal_items_unique',
    ]) {
      expect(names, dropped).not.toContain(dropped);
    }
  });
});
