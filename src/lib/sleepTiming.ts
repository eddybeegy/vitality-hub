/**
 * Bedtime and wake-time consistency (roadmap: the bedtime half of "Sleep debt and
 * bedtime consistency"; item 78 shipped the debt half).
 *
 * Storage. Apple Health (Health Auto Export) sends each night's sleepStart and
 * sleepEnd alongside the totals. The ingest stores them as metric rows of type
 * 'bedtime' and 'wake_time' whose value is SECONDS FROM THE ROW'S OWN TIMESTAMP
 * (the night's anchor date), not an epoch: metrics.value is float4 on Postgres,
 * which would round an epoch to about two minutes, while an offset under a day is
 * exact. The names deliberately do not start with 'sleep', so the roll-up's
 * `type LIKE 'sleep%'` 12-hour shift and every "sum the sleep types" path skip them.
 *
 * Analysis is in the user's zone. Bedtimes are measured in minutes after NOON so
 * 23:30 and 00:30 are an hour apart, not 23 hours; wake times are plain minutes
 * after midnight. Consistency is the standard deviation across nights. Social jet
 * lag is the shift of the sleep midpoint on free days (nights before Saturday and
 * Sunday) against work days.
 */

export const TIMING_TYPES = ['bedtime', 'wake_time'] as const;
export const MIN_NIGHTS = 5;
const MIN_WEEKEND = 2;
const MIN_WEEKDAY = 3;

export interface TimingRow {
  type: string;
  value: number | string;
  timestamp: string | Date;
}

export interface Night {
  /** Bedtime and wake time as ISO instants. */
  bed: string;
  wake: string;
}

function instantMs(ts: string | Date): number {
  if (ts instanceof Date) return ts.getTime();
  const s = String(ts);
  // A naive 'YYYY-MM-DD HH:MM:SS' from sqlite is UTC (in-app ingest writes UTC).
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(hasZone ? s : s.replace(' ', 'T') + 'Z').getTime();
}

/**
 * Pair 'bedtime' and 'wake_time' rows into nights by their shared anchor
 * timestamp. Nights missing either half, lasting under 2 h or over 16 h, are
 * dropped. Oldest first.
 */
export function pairNights(rows: TimingRow[]): Night[] {
  const byAnchor = new Map<number, { bed?: number; wake?: number }>();
  for (const r of rows) {
    if (r.type !== 'bedtime' && r.type !== 'wake_time') continue;
    const anchor = instantMs(r.timestamp);
    const offset = Number(r.value);
    if (!Number.isFinite(anchor) || !Number.isFinite(offset)) continue;
    const slot = byAnchor.get(anchor) ?? {};
    if (r.type === 'bedtime') slot.bed = anchor + offset * 1000;
    else slot.wake = anchor + offset * 1000;
    byAnchor.set(anchor, slot);
  }
  const nights: Night[] = [];
  for (const { bed, wake } of byAnchor.values()) {
    if (bed === undefined || wake === undefined) continue;
    const hours = (wake - bed) / 3_600_000;
    if (hours < 2 || hours > 16) continue;
    nights.push({ bed: new Date(bed).toISOString(), wake: new Date(wake).toISOString() });
  }
  return nights.sort((a, b) => (a.bed < b.bed ? -1 : 1));
}

/** Offset in seconds of `instant` from `anchor`, for the ingest. Null if either is unparseable. */
export function offsetSeconds(anchorIso: string, instantIso: string): number | null {
  const a = Date.parse(anchorIso);
  const b = Date.parse(instantIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const s = Math.round((b - a) / 1000);
  // A sleep boundary more than two days from its own night's date is not one.
  return Math.abs(s) <= 2 * 86400 ? s : null;
}

interface LocalParts { minutes: number; day: string; weekday: number }

function localParts(iso: string, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'UTC', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    day: `${get('year')}-${get('month')}-${get('day')}`,
    weekday,
  };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

export type Regularity = 'steady' | 'variable' | 'irregular';

export interface TimingSummary {
  nights: number;
  /** Clock minutes after midnight, 0-1439. */
  avgBed: number;
  avgWake: number;
  /** Standard deviation in minutes. */
  bedSd: number;
  wakeSd: number;
  regularity: Regularity;
  /** Free-day midpoint minus work-day midpoint, minutes; null with too few of either. */
  socialJetLag: number | null;
}

/** Summarise the nights whose wake day falls in the `days` days ending `today`. */
export function summariseTiming(nights: Night[], today: string, timezone: string, days = 28): TimingSummary | null {
  const from = new Date(Date.parse(today + 'T00:00:00Z') - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const beds: number[] = [];
  const wakes: number[] = [];
  const free: number[] = [];
  const work: number[] = [];
  for (const n of nights) {
    const w = localParts(n.wake, timezone);
    if (w.day < from || w.day > today) continue;
    const b = localParts(n.bed, timezone);
    const bedFromNoon = (b.minutes + 720) % 1440;
    const wakeFromNoon = (w.minutes + 720) % 1440;
    beds.push(bedFromNoon);
    wakes.push(w.minutes);
    // Midpoint on the noon-relative scale, where bed < wake within one night.
    const wakeAfterBed = wakeFromNoon >= bedFromNoon ? wakeFromNoon : wakeFromNoon + 1440;
    const mid = (bedFromNoon + wakeAfterBed) / 2;
    (w.weekday === 0 || w.weekday === 6 ? free : work).push(mid);
  }
  if (beds.length < MIN_NIGHTS) return null;
  const bedSd = sd(beds);
  const wakeSd = sd(wakes);
  const worst = Math.max(bedSd, wakeSd);
  return {
    nights: beds.length,
    avgBed: Math.round(mean(beds) + 720) % 1440,
    avgWake: Math.round(mean(wakes)) % 1440,
    bedSd,
    wakeSd,
    regularity: worst < 30 ? 'steady' : worst < 60 ? 'variable' : 'irregular',
    socialJetLag: free.length >= MIN_WEEKEND && work.length >= MIN_WEEKDAY ? mean(free) - mean(work) : null,
  };
}

/** 23:42 */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
