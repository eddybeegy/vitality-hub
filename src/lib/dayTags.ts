// Day tags (item 74, roadmap feature 4): short labels the user puts on a calendar
// day -- ill, travel, alcohol -- so a chart dip or an AI insight has a reason next to
// it.
//
// A tag belongs to a *calendar day in the user's zone*, stored as a bare
// 'YYYY-MM-DD' string. It is never a timestamp, so no column-zone convention
// (metrics London-for-healthsync, workouts UTC, logs London) applies to it and no
// conversion ever happens on read or write. All day arithmetic here is Date.UTC on
// that bare string, the same rule the rest of src/lib follows.
//
// Pure functions, no Express or React, so they are unit-tested directly and shared
// by server.ts (validation, AI context) and the client (chips, chart markers).

export interface PresetTag {
  id: string;
  label: string;
}

/** The one-tap tags offered on the card. Any other valid slug is a custom tag. */
export const PRESET_TAGS: readonly PresetTag[] = [
  { id: 'ill', label: 'Ill' },
  { id: 'travel', label: 'Travel' },
  { id: 'alcohol', label: 'Alcohol' },
  { id: 'late_meal', label: 'Late meal' },
  { id: 'poor_sleep_env', label: 'Poor sleep environment' },
];

export const MAX_TAG_LENGTH = 32;
export const MAX_NOTE_LENGTH = 200;
/** A GET may ask for at most this many days at once. */
export const MAX_RANGE_DAYS = 3660;
/** Longest tag name shown on a chart marker before it is cut short. */
export const MARKER_LABEL_CHARS = 10;

export interface DayTag {
  date: string;
  tag: string;
  note?: string | null;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAG_RE = /^[a-z0-9_]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** True for a real calendar day written as YYYY-MM-DD (rejects 2026-02-30). */
export function isCalendarDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Days from a to b (b - a), both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const n = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY_MS;
  };
  return Math.round(n(b) - n(a));
}

/** Today's calendar day in `timeZone` as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 'YYYY-MM-DD' shifted by `delta` days. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * Free text to a tag slug: "Late meal" -> 'late_meal', "Jet-lag" -> 'jet_lag'.
 * Returns null when nothing usable is left or it is too long, so the caller can say
 * so rather than store a mangled tag.
 */
export function normaliseTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!slug || slug.length > MAX_TAG_LENGTH || !TAG_RE.test(slug)) return null;
  return slug;
}

/** Display text for a stored tag: the preset label, else the slug with spaces. */
export function tagLabel(tag: string): string {
  const preset = PRESET_TAGS.find(p => p.id === tag);
  if (preset) return preset.label;
  const s = tag.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Keyed on `error` like queryParams.ts: the project compiles without
// strictNullChecks, where an `ok: boolean` discriminant does not narrow.
export type TagResult<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

/**
 * The body of POST /api/day-tags: { date, tag, note? }. The tag is normalised, the
 * note trimmed, stripped of control characters and capped. An empty note is null.
 */
export function validateDayTagInput(body: unknown): TagResult<{ date: string; tag: string; note: string | null }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Expected a JSON object' };
  const b = body as Record<string, unknown>;
  if (!isCalendarDay(b.date)) return { error: 'date must be a calendar date as YYYY-MM-DD' };
  const tag = normaliseTag(b.tag);
  if (!tag) return { error: `tag must be 1-${MAX_TAG_LENGTH} letters, digits or spaces` };
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string') return { error: 'note must be a string' };
    // eslint-disable-next-line no-control-regex
    const cleaned = b.note.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (cleaned.length > MAX_NOTE_LENGTH) return { error: `note must be at most ${MAX_NOTE_LENGTH} characters` };
    note = cleaned || null;
  }
  return { value: { date: b.date, tag, note } };
}

/**
 * The bucket a day falls in at a chart granularity. Must match HealthChart's own
 * grouping exactly, or a marker lands on no category: day = the day, week = the
 * Sunday that starts it (getUTCDay on a bare Y-M-D), month = the 1st.
 */
export function bucketKeyForDay(day: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return day;
  if (granularity === 'month') return `${day.slice(0, 7)}-01`;
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  return t.toISOString().slice(0, 10);
}

export interface TagMarker {
  /** The x-axis category (a bucket key present in the chart's data). */
  x: string;
  /** Distinct tags in the bucket, in first-seen order. */
  tags: string[];
  /** Short text for the marker label, e.g. "Ill", "Ill +1", "Poor sleep… +2". Kept
   *  short because markers on neighbouring days sit a few pixels apart; the tooltip
   *  carries the full list. */
  label: string;
}

/**
 * One marker per chart bucket that holds at least one tagged day. Buckets the chart
 * has no data for are skipped: recharts can only place a category-axis reference
 * line on a category that exists.
 */
export function markersForBuckets(
  tags: readonly DayTag[],
  bucketKeys: readonly string[],
  granularity: 'day' | 'week' | 'month',
): TagMarker[] {
  if (!tags.length || !bucketKeys.length) return [];
  const present = new Set(bucketKeys);
  const byBucket = new Map<string, string[]>();
  for (const t of tags) {
    if (!isCalendarDay(t.date)) continue;
    const key = bucketKeyForDay(t.date, granularity);
    if (!present.has(key)) continue;
    const list = byBucket.get(key) || [];
    if (!list.includes(t.tag)) list.push(t.tag);
    byBucket.set(key, list);
  }
  return bucketKeys
    .filter(k => byBucket.has(k))
    .map(x => {
      const list = byBucket.get(x)!;
      const first = tagLabel(list[0]);
      const head = first.length > MARKER_LABEL_CHARS ? `${first.slice(0, MARKER_LABEL_CHARS - 1).trimEnd()}…` : first;
      const label = list.length > 1 ? `${head} +${list.length - 1}` : head;
      return { x, tags: list, label };
    });
}

/** Tags for one day, for the chart tooltip. */
export function tagsOnBucket(
  tags: readonly DayTag[],
  bucketKey: string,
  granularity: 'day' | 'week' | 'month',
): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (isCalendarDay(t.date) && bucketKeyForDay(t.date, granularity) === bucketKey && !out.includes(t.tag)) {
      out.push(t.tag);
    }
  }
  return out;
}

/**
 * The AI context form: newest day first, one entry per day, tag labels plus any
 * notes. Compact on purpose -- it rides in the same prompt as 25 days of metrics.
 */
export function tagsForAIContext(tags: readonly DayTag[]): Array<{ date: string; tags: string[]; notes?: string[] }> {
  const byDay = new Map<string, { tags: string[]; notes: string[] }>();
  for (const t of tags) {
    if (!isCalendarDay(t.date)) continue;
    const entry = byDay.get(t.date) || { tags: [], notes: [] };
    const label = tagLabel(t.tag).toLowerCase();
    if (!entry.tags.includes(label)) entry.tags.push(label);
    if (t.note) entry.notes.push(`${label}: ${t.note}`);
    byDay.set(t.date, entry);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, e]) => (e.notes.length ? { date, tags: e.tags, notes: e.notes } : { date, tags: e.tags }));
}
