/**
 * Medication and supplement log (roadmap: "A daily 'taken' check per item,
 * adherence over time, and start and stop dates drawn as markers on charts to
 * see effects").
 *
 * Two tables behind this: `medications` (the items) and `medication_doses` (one
 * row per item per day the user ticked or skipped). Both key off a bare
 * YYYY-MM-DD day in the user's zone, exactly like `day_tags` -- a dose belongs
 * to the day the user lived, not to an instant, so none of the per-source
 * timestamp conventions apply and nothing here ever converts a zone.
 *
 * Everything in this file is pure. The server passes rows in and gets numbers
 * back, so adherence is testable without a database or a clock.
 */
import { addDays, isCalendarDay, bucketKeyForDay, type TagMarker } from './dayTags.js';

export const KINDS = ['medication', 'supplement'] as const;
export type MedicationKind = (typeof KINDS)[number];

/**
 * How often an item is meant to be taken. The value is doses per day, which is
 * the adherence denominator: `as_needed` is 0 because there is no schedule to
 * adhere to, so it is tracked but never scored.
 */
export const FREQUENCIES = {
  daily: 1,
  twice_daily: 2,
  three_times_daily: 3,
  weekly: 1 / 7,
  as_needed: 0,
} as const;
export type MedicationFrequency = keyof typeof FREQUENCIES;

export const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
  daily: 'Once a day',
  twice_daily: 'Twice a day',
  three_times_daily: 'Three times a day',
  weekly: 'Weekly',
  as_needed: 'As needed',
};

export const MAX_NAME_LENGTH = 80;
export const MAX_DOSE_LENGTH = 40;
export const MAX_NOTES_LENGTH = 200;
export const MAX_ITEMS = 100;
/** Adherence over a year at most; the UI asks for 30 days. */
export const MAX_ADHERENCE_DAYS = 366;

export interface Medication {
  id: number;
  name: string;
  kind: MedicationKind;
  dose: string | null;
  frequency: MedicationFrequency;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

export interface DoseRow {
  medication_id: number;
  dose_date: string;
  /** 1 taken, 0 explicitly skipped. A missing row is "nothing said". */
  taken: number;
}

export type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

const isFrequency = (v: unknown): v is MedicationFrequency =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FREQUENCIES, v);

const isKind = (v: unknown): v is MedicationKind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v);

/** Strip control characters and collapse whitespace, then clip. */
const cleanText = (raw: unknown, max: number): string =>
  typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

export interface MedicationInput {
  name: string;
  kind: MedicationKind;
  dose: string | null;
  frequency: MedicationFrequency;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

/**
 * Validate a create/update body. Rejects rather than coerces on the fields that
 * change meaning if guessed -- an unknown frequency would silently become a
 * denominator of 1 and report a false adherence number.
 */
export function validateMedicationInput(body: unknown): Result<MedicationInput> {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const b = body as Record<string, unknown>;

  const name = cleanText(b.name, MAX_NAME_LENGTH);
  if (!name) return { error: 'Name is required' };

  const kind = b.kind === undefined ? 'medication' : b.kind;
  if (!isKind(kind)) return { error: `kind must be one of ${KINDS.join(', ')}` };

  const frequency = b.frequency === undefined ? 'daily' : b.frequency;
  if (!isFrequency(frequency)) return { error: `frequency must be one of ${Object.keys(FREQUENCIES).join(', ')}` };

  const day = (field: string, raw: unknown): Result<string | null> => {
    if (raw === undefined || raw === null || raw === '') return { value: null };
    if (typeof raw !== 'string' || !isCalendarDay(raw)) return { error: `${field} must be YYYY-MM-DD` };
    return { value: raw };
  };
  const start = day('start_date', b.start_date);
  if (start.error !== undefined) return { error: start.error };
  const end = day('end_date', b.end_date);
  if (end.error !== undefined) return { error: end.error };
  if (start.value && end.value && end.value < start.value) {
    return { error: `end_date ${end.value} is before start_date ${start.value}` };
  }

  const dose = cleanText(b.dose, MAX_DOSE_LENGTH);
  const notes = cleanText(b.notes, MAX_NOTES_LENGTH);

  return {
    value: {
      name,
      kind,
      frequency,
      start_date: start.value,
      end_date: end.value,
      dose: dose || null,
      notes: notes || null,
    },
  };
}

/** A dose write: which day, and taken or deliberately skipped. */
export function validateDoseInput(body: unknown): Result<{ date: string; taken: boolean }> {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const b = body as Record<string, unknown>;
  if (typeof b.date !== 'string' || !isCalendarDay(b.date)) return { error: 'date must be YYYY-MM-DD' };
  if (b.taken !== undefined && typeof b.taken !== 'boolean') return { error: 'taken must be a boolean' };
  return { value: { date: b.date, taken: b.taken !== false } };
}

/** Is the item meant to be taken on `day`? Outside start/end it is not scored. */
export function isActiveOn(med: Pick<Medication, 'start_date' | 'end_date'>, day: string): boolean {
  if (med.start_date && day < med.start_date) return false;
  if (med.end_date && day > med.end_date) return false;
  return true;
}

export interface Adherence {
  medication_id: number;
  name: string;
  kind: MedicationKind;
  frequency: MedicationFrequency;
  /** Days in the window the item was meant to be taken on. */
  scheduled_days: number;
  taken_days: number;
  skipped_days: number;
  /** Scheduled days with neither a tick nor a skip. */
  unlogged_days: number;
  /**
   * taken / scheduled as a whole percent. Null when nothing was scheduled AND
   * null when the window holds no tick or skip at all: an item nobody has
   * started logging has no adherence to report, and 0% would read as a failed
   * course rather than an empty one.
   */
  percent: number | null;
  /** Consecutive scheduled days ticked, counting back from the window's last day. */
  current_streak: number;
}

const windowDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push(day);
    if (out.length > MAX_ADHERENCE_DAYS) break;
  }
  return out;
};

/**
 * Adherence per item over [from, to].
 *
 * Weekly items are scheduled on the day of week they started, not on every
 * seventh day from the window's edge: a weekly vitamin D on a Sunday should
 * score 100% for one Sunday tick, and anchoring to the window would move the
 * expected day every time the window did.
 *
 * `as_needed` items have no schedule, so they report percent null and a
 * scheduled_days of 0 rather than a flattering 100%.
 */
export function adherence(
  medications: readonly Medication[],
  doses: readonly DoseRow[],
  from: string,
  to: string,
): Adherence[] {
  const days = windowDays(from, to);
  const byMed = new Map<number, Map<string, number>>();
  for (const d of doses) {
    const map = byMed.get(d.medication_id) || new Map<string, number>();
    map.set(d.dose_date, Number(d.taken) ? 1 : 0);
    byMed.set(d.medication_id, map);
  }

  return medications.map((med) => {
    const logged = byMed.get(med.id) || new Map<string, number>();
    const perDay = FREQUENCIES[med.frequency];
    const weekday = med.frequency === 'weekly' && med.start_date
      ? new Date(`${med.start_date}T00:00:00Z`).getUTCDay()
      : null;

    const scheduled = days.filter((day) => {
      if (perDay === 0 || !isActiveOn(med, day)) return false;
      if (weekday === null) return true;
      return new Date(`${day}T00:00:00Z`).getUTCDay() === weekday;
    });

    let taken = 0;
    let skipped = 0;
    for (const day of scheduled) {
      const state = logged.get(day);
      if (state === 1) taken += 1;
      else if (state === 0) skipped += 1;
    }

    let streak = 0;
    for (let i = scheduled.length - 1; i >= 0; i -= 1) {
      if (logged.get(scheduled[i]) === 1) streak += 1;
      else break;
    }

    return {
      medication_id: med.id,
      name: med.name,
      kind: med.kind,
      frequency: med.frequency,
      scheduled_days: scheduled.length,
      taken_days: taken,
      skipped_days: skipped,
      unlogged_days: scheduled.length - taken - skipped,
      // Unlogged days still count against the percentage once the user has
      // started logging - a day never ticked is not a day the dose was taken.
      // But a window with nothing said at all reports null, not 0%.
      percent: scheduled.length && taken + skipped > 0
        ? Math.round((taken / scheduled.length) * 100)
        : null,
      current_streak: streak,
    };
  });
}

/** Items due on `day` that have no dose row yet, for today's checklist. */
export function dueOn(
  medications: readonly Medication[],
  doses: readonly DoseRow[],
  day: string,
): Array<Medication & { taken: boolean | null }> {
  const state = new Map<number, number>();
  for (const d of doses) {
    if (d.dose_date === day) state.set(d.medication_id, Number(d.taken) ? 1 : 0);
  }
  return medications
    .filter((med) => isActiveOn(med, day))
    .map((med) => {
      const logged = state.get(med.id);
      return { ...med, taken: logged === undefined ? null : logged === 1 };
    });
}

/**
 * Start/stop markers for a chart's buckets, in the shape HealthChart already
 * draws for day tags.
 *
 * Only days the chart actually has a bucket for are returned: recharts can put a
 * category reference line only on a category that exists. A start and a stop in
 * the same bucket collapse into one marker with both labels, same as two tags on
 * one day.
 */
export function medicationMarkers(
  medications: readonly Medication[],
  bucketKeys: readonly string[],
  granularity: 'day' | 'week' | 'month',
): TagMarker[] {
  if (!medications.length || !bucketKeys.length) return [];
  const present = new Set(bucketKeys);
  const byBucket = new Map<string, string[]>();

  const add = (day: string | null, text: string) => {
    if (!day || !isCalendarDay(day)) return;
    const key = bucketKeyForDay(day, granularity);
    if (!present.has(key)) return;
    const list = byBucket.get(key) || [];
    if (!list.includes(text)) list.push(text);
    byBucket.set(key, list);
  };

  for (const med of medications) {
    add(med.start_date, `Start ${med.name}`);
    add(med.end_date, `Stop ${med.name}`);
  }

  return bucketKeys
    .filter((k) => byBucket.has(k))
    .map((x) => {
      const list = byBucket.get(x)!;
      const label = list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0];
      return { x, tags: list, label };
    });
}
