import { describe, it, expect } from 'vitest';
import SQLiteDatabase from 'better-sqlite3';
import {
  isCalendarDay, normaliseTag, tagLabel, validateDayTagInput, bucketKeyForDay,
  markersForBuckets, tagsOnBucket, tagsForAIContext, todayIn, addDays, daysBetween,
  MAX_NOTE_LENGTH, type DayTag,
} from './dayTags';

describe('isCalendarDay', () => {
  it('accepts real days and rejects anything else', () => {
    expect(isCalendarDay('2026-10-21')).toBe(true);
    expect(isCalendarDay('2024-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2026-10-21T00:00:00Z')).toBe(false);
    expect(isCalendarDay('21/10/2026')).toBe(false);
    expect(isCalendarDay(20261021)).toBe(false);
  });
});

describe('normaliseTag', () => {
  it('turns free text into a slug', () => {
    expect(normaliseTag('Late meal')).toBe('late_meal');
    expect(normaliseTag('  Jet-lag ')).toBe('jet_lag');
    expect(normaliseTag('Sauna!!')).toBe('sauna');
    expect(normaliseTag('a  -  b')).toBe('a_b');
  });

  it('rejects empty, non-string and over-long input', () => {
    expect(normaliseTag('')).toBeNull();
    expect(normaliseTag('!!!')).toBeNull();
    expect(normaliseTag(42)).toBeNull();
    expect(normaliseTag('x'.repeat(33))).toBeNull();
    expect(normaliseTag('x'.repeat(32))).toBe('x'.repeat(32));
  });
});

describe('tagLabel', () => {
  it('uses the preset label, else a readable slug', () => {
    expect(tagLabel('poor_sleep_env')).toBe('Poor sleep environment');
    expect(tagLabel('jet_lag')).toBe('Jet lag');
  });
});

describe('validateDayTagInput', () => {
  it('accepts a valid body and normalises it', () => {
    expect(validateDayTagInput({ date: '2026-10-21', tag: 'Late Meal', note: '  curry at 10pm ' }))
      .toEqual({ value: { date: '2026-10-21', tag: 'late_meal', note: 'curry at 10pm' } });
    expect(validateDayTagInput({ date: '2026-10-21', tag: 'ill' }).value?.note).toBeNull();
    expect(validateDayTagInput({ date: '2026-10-21', tag: 'ill', note: '   ' }).value?.note).toBeNull();
  });

  it('strips control characters from the note so it cannot forge lines in a prompt', () => {
    expect(validateDayTagInput({ date: '2026-10-21', tag: 'ill', note: 'a\nb\r\tc' }).value?.note).toBe('a b c');
  });

  it('rejects bad bodies with a reason', () => {
    expect(validateDayTagInput(null).error).toBeDefined();
    expect(validateDayTagInput([]).error).toBeDefined();
    expect(validateDayTagInput({ date: '2026-02-30', tag: 'ill' }).error).toMatch(/date/);
    expect(validateDayTagInput({ date: '2026-10-21', tag: '' }).error).toMatch(/tag/);
    expect(validateDayTagInput({ date: '2026-10-21', tag: 'ill', note: 5 }).error).toMatch(/note/);
    expect(validateDayTagInput({ date: '2026-10-21', tag: 'ill', note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }).error).toMatch(/note/);
  });
});

describe('day arithmetic', () => {
  it('is unaffected by the UK clock changes', () => {
    // 2026-10-25 BST -> GMT, 2026-03-29 GMT -> BST.
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
    expect(daysBetween('2026-03-25', '2026-04-01')).toBe(7);
  });

  it('todayIn uses the given zone, not the process zone', () => {
    // 23:30 UTC on 21 Oct is already 22 Oct in London during BST...
    expect(todayIn('Europe/London', new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-22');
    // ...but not after the clocks go back.
    expect(todayIn('Europe/London', new Date('2026-10-26T23:30:00Z'))).toBe('2026-10-26');
    expect(todayIn('UTC', new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-21');
  });
});

describe('bucketKeyForDay', () => {
  it('matches HealthChart grouping: Sunday-start weeks, first-of-month months', () => {
    expect(bucketKeyForDay('2026-10-21', 'day')).toBe('2026-10-21');
    // 2026-10-21 is a Wednesday; its week starts Sunday 2026-10-18.
    expect(bucketKeyForDay('2026-10-21', 'week')).toBe('2026-10-18');
    expect(bucketKeyForDay('2026-10-18', 'week')).toBe('2026-10-18');
    expect(bucketKeyForDay('2026-10-21', 'month')).toBe('2026-10-01');
  });
});

describe('markersForBuckets', () => {
  const tags: DayTag[] = [
    { date: '2026-10-19', tag: 'alcohol' },
    { date: '2026-10-21', tag: 'ill' },
    { date: '2026-10-21', tag: 'travel' },
    { date: '2026-10-22', tag: 'ill' },
    { date: '2026-10-22', tag: 'late_meal' },
    { date: '2026-10-22', tag: 'jet_lag' },
    { date: 'not-a-day', tag: 'ill' },
  ];

  it('marks only buckets the chart has data for', () => {
    const m = markersForBuckets(tags, ['2026-10-20', '2026-10-21', '2026-10-22'], 'day');
    expect(m.map(x => x.x)).toEqual(['2026-10-21', '2026-10-22']);
    expect(m[0].label).toBe('Ill +1');
    expect(m[1].label).toBe('Ill +2');
    expect(markersForBuckets([{ date: '2026-10-21', tag: 'poor_sleep_env' }], ['2026-10-21'], 'day')[0].label).toBe('Poor slee…');
    expect(markersForBuckets([{ date: '2026-10-21', tag: 'travel' }], ['2026-10-21'], 'day')[0].label).toBe('Travel');
    expect(m[1].tags).toEqual(['ill', 'late_meal', 'jet_lag']);
  });

  it('collapses a week of tags onto the week bucket without repeating a tag', () => {
    const m = markersForBuckets(tags, ['2026-10-11', '2026-10-18'], 'week');
    expect(m).toHaveLength(1);
    expect(m[0].x).toBe('2026-10-18');
    expect(m[0].tags).toEqual(['alcohol', 'ill', 'travel', 'late_meal', 'jet_lag']);
  });

  it('returns nothing for no tags or no data', () => {
    expect(markersForBuckets([], ['2026-10-21'], 'day')).toEqual([]);
    expect(markersForBuckets(tags, [], 'day')).toEqual([]);
  });

  it('tagsOnBucket lists the tags for one tooltip', () => {
    expect(tagsOnBucket(tags, '2026-10-21', 'day')).toEqual(['ill', 'travel']);
    expect(tagsOnBucket(tags, '2026-10-01', 'month')).toEqual(['alcohol', 'ill', 'travel', 'late_meal', 'jet_lag']);
    expect(tagsOnBucket(tags, '2026-10-20', 'day')).toEqual([]);
  });
});

describe('tagsForAIContext', () => {
  it('groups by day, newest first, with notes only where present', () => {
    expect(tagsForAIContext([
      { date: '2026-10-19', tag: 'alcohol', note: 'wedding' },
      { date: '2026-10-21', tag: 'ill', note: null },
      { date: '2026-10-21', tag: 'poor_sleep_env' },
    ])).toEqual([
      { date: '2026-10-21', tags: ['ill', 'poor sleep environment'] },
      { date: '2026-10-19', tags: ['alcohol'], notes: ['alcohol: wedding'] },
    ]);
  });
});

// The exact DDL server.ts builds for day_tags and the exact statements the routes run,
// against a real SQLite. Postgres and MySQL are not available here; see the PR body.
describe('day_tags SQL (sqlite)', () => {
  const db = new SQLiteDatabase(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS day_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, tag_date VARCHAR(10), tag VARCHAR(32), note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, tag_date, tag))`);
  const upsert = (u: number, d: string, t: string, n: string | null) => {
    const r = db.prepare('UPDATE day_tags SET note = ? WHERE user_id = ? AND tag_date = ? AND tag = ?').run(n, u, d, t);
    if (!r.changes) db.prepare('INSERT OR IGNORE INTO day_tags (user_id, tag_date, tag, note) VALUES (?, ?, ?, ?)').run(u, d, t, n);
  };

  it('upserts one row per (user, day, tag) and updates the note in place', () => {
    upsert(1, '2026-10-21', 'ill', null);
    upsert(1, '2026-10-21', 'ill', 'flu');
    upsert(2, '2026-10-21', 'ill', null);
    const rows = db.prepare('SELECT user_id, tag_date AS date, tag, note FROM day_tags ORDER BY user_id').all();
    expect(rows).toEqual([
      { user_id: 1, date: '2026-10-21', tag: 'ill', note: 'flu' },
      { user_id: 2, date: '2026-10-21', tag: 'ill', note: null },
    ]);
  });

  it('range reads compare bare days as strings', () => {
    upsert(1, '2026-09-30', 'travel', null);
    upsert(1, '2026-10-01', 'travel', null);
    const rows = db.prepare('SELECT tag_date AS date FROM day_tags WHERE user_id = ? AND tag_date >= ? AND tag_date <= ? ORDER BY tag_date').all(1, '2026-10-01', '2026-10-21');
    expect(rows).toEqual([{ date: '2026-10-01' }, { date: '2026-10-21' }]);
  });

  it('delete removes only the named tag for the named user', () => {
    const r = db.prepare('DELETE FROM day_tags WHERE user_id = ? AND tag_date = ? AND tag = ?').run(1, '2026-10-21', 'ill');
    expect(r.changes).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM day_tags WHERE tag = ?').get('ill')).toEqual({ n: 1 });
  });
});
