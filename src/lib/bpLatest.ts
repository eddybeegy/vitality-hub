// Item 69: which blood-pressure reading represents a day. The summary roll-up
// (`aggregateDailyMetrics`) divides by row count for every non-summed type, so a day
// with two real readings showed their mean -- 2025-12-08 has withings 133/75 at 13:51
// and 117/73 at 19:51 and the widget showed 125/74, a reading nobody took. Kieron's
// call (2026-10-21): show the LATEST reading of the day.
//
// A reading is one cuff inflation: a systolic and a diastolic from the same source at
// the same instant. The latest reading is the latest instant that has both halves, so
// the two numbers on screen always come from one measurement. Only when a source has
// no complete reading that day does each half fall back to its own latest value
// (item 66 already prefers a source with the whole pair, so that is the rare case).

export const BP_SYSTOLIC = 'blood_pressure_systolic';
export const BP_DIASTOLIC = 'blood_pressure_diastolic';
export const BP_TYPES: readonly string[] = [BP_SYSTOLIC, BP_DIASTOLIC];

export interface BpRow {
  type: string;
  source: string;
  value: number | string;
  timestamp: string | Date;
}

/** type -> day -> source -> the value to display for that day. */
export type LatestBp = Record<string, Record<string, Record<string, number>>>;

interface Slot { ms: number; sys?: number; dia?: number }

/**
 * Latest blood-pressure reading per (day, source). `dayOf` maps an instant to the
 * user's calendar day, and must be the same day rule the roll-up's buckets used.
 */
export function latestBpReadings(rows: BpRow[], dayOf: (instant: Date) => string | null): LatestBp {
  // (day, source) -> instant ms -> the halves taken at that instant
  const byDaySource = new Map<string, { day: string; source: string; slots: Map<number, Slot> }>();
  for (const r of rows) {
    if (r.type !== BP_SYSTOLIC && r.type !== BP_DIASTOLIC) continue;
    const value = Number(r.value);
    if (!Number.isFinite(value)) continue;
    const instant = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
    const ms = instant.getTime();
    if (isNaN(ms)) continue;
    const day = dayOf(instant);
    if (!day) continue;
    const key = `${day}|${r.source}`;
    let entry = byDaySource.get(key);
    if (!entry) byDaySource.set(key, entry = { day, source: r.source, slots: new Map() });
    let slot = entry.slots.get(ms);
    if (!slot) entry.slots.set(ms, slot = { ms });
    if (r.type === BP_SYSTOLIC) slot.sys = value; else slot.dia = value;
  }

  const out: LatestBp = {};
  const put = (type: string, day: string, source: string, value: number) => {
    ((out[type] ??= {})[day] ??= {})[source] = value;
  };
  for (const { day, source, slots } of byDaySource.values()) {
    const newestFirst = [...slots.values()].sort((a, b) => b.ms - a.ms);
    const paired = newestFirst.find(s => s.sys !== undefined && s.dia !== undefined);
    if (paired) {
      put(BP_SYSTOLIC, day, source, paired.sys!);
      put(BP_DIASTOLIC, day, source, paired.dia!);
      continue;
    }
    const sys = newestFirst.find(s => s.sys !== undefined);
    const dia = newestFirst.find(s => s.dia !== undefined);
    if (sys) put(BP_SYSTOLIC, day, source, sys.sys!);
    if (dia) put(BP_DIASTOLIC, day, source, dia.dia!);
  }
  return out;
}
