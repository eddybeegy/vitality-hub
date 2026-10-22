/**
 * Blood pressure bands and a 7-day home average (roadmap: "Blood pressure
 * categories and averages").
 *
 * Bands follow NICE NG136 for HOME readings, which sit 5 mmHg below the clinic
 * thresholds: a home average of 135/85 or more is stage 1 hypertension, 150/95 or
 * more is stage 2, and 180 systolic or 120 diastolic is severe (NICE's same-day
 * review threshold, clinic-measured, shown here as a prompt to re-measure and
 * seek advice). Under 90/60 is low. The higher band of the two numbers wins.
 *
 * The average is over the last AVG_DAYS days ending today, one reading per day
 * (the dashboard's day is the latest reading of that day, item 69). It needs
 * MIN_AVG_DAYS days. This is not the full NICE home protocol (two seated
 * readings morning and evening for 4-7 days, day one discarded); it is the same
 * shape of number from the readings that exist, and the card says so.
 *
 * This is information, not a diagnosis.
 */
import { addDays } from './dayTags';

export const AVG_DAYS = 7;
export const MIN_AVG_DAYS = 4;

export type BpBand = 'low' | 'normal' | 'stage1' | 'stage2' | 'severe';

const ORDER: BpBand[] = ['low', 'normal', 'stage1', 'stage2', 'severe'];

export const BAND_LABEL: Record<BpBand, string> = {
  low: 'Low',
  normal: 'Normal',
  stage1: 'Stage 1 high',
  stage2: 'Stage 2 high',
  severe: 'Very high',
};

/** Home-reading thresholds: [systolic, diastolic] at or above which the band applies. */
export const HOME_THRESHOLDS = {
  stage1: [135, 85],
  stage2: [150, 95],
  severe: [180, 120],
} as const;

function bandOfSystolic(s: number): BpBand {
  if (s >= HOME_THRESHOLDS.severe[0]) return 'severe';
  if (s >= HOME_THRESHOLDS.stage2[0]) return 'stage2';
  if (s >= HOME_THRESHOLDS.stage1[0]) return 'stage1';
  if (s < 90) return 'low';
  return 'normal';
}

function bandOfDiastolic(d: number): BpBand {
  if (d >= HOME_THRESHOLDS.severe[1]) return 'severe';
  if (d >= HOME_THRESHOLDS.stage2[1]) return 'stage2';
  if (d >= HOME_THRESHOLDS.stage1[1]) return 'stage1';
  if (d < 60) return 'low';
  return 'normal';
}

/**
 * The band for one reading or average. A high band on either number wins over
 * low on the other (120/55 is normal-systolic, low-diastolic: 'low'; 140/55 is
 * 'stage1').
 */
export function bpBand(systolic: number, diastolic: number): BpBand {
  const a = bandOfSystolic(systolic);
  const b = bandOfDiastolic(diastolic);
  const high = ORDER.indexOf(a) > ORDER.indexOf(b) ? a : b;
  if (high !== 'normal' && high !== 'low') return high;
  return a === 'low' || b === 'low' ? 'low' : 'normal';
}

export interface BpDay {
  date: string;
  systolic?: number | string;
  diastolic?: number | string;
}

export interface BpAverage {
  systolic: number;
  diastolic: number;
  days: number;
  from: string;
  to: string;
  band: BpBand;
}

/** Mean of the paired days in the AVG_DAYS ending `today`, or null with too few. */
export function homeAverage(rows: BpDay[], today: string): BpAverage | null {
  const from = addDays(today, -(AVG_DAYS - 1));
  let sys = 0;
  let dia = 0;
  let n = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const day = String(r.date ?? '').slice(0, 10);
    if (day < from || day > today || seen.has(day)) continue;
    const s = Number(r.systolic);
    const d = Number(r.diastolic);
    if (!Number.isFinite(s) || !Number.isFinite(d) || s <= 0 || d <= 0) continue;
    seen.add(day);
    sys += s;
    dia += d;
    n++;
  }
  if (n < MIN_AVG_DAYS) return null;
  const systolic = sys / n;
  const diastolic = dia / n;
  return { systolic, diastolic, days: n, from, to: today, band: bpBand(systolic, diastolic) };
}

/** The latest paired day, with its band. */
export function latestReading(rows: BpDay[]): { date: string; systolic: number; diastolic: number; band: BpBand } | null {
  let best: { date: string; systolic: number; diastolic: number } | null = null;
  for (const r of rows) {
    const s = Number(r.systolic);
    const d = Number(r.diastolic);
    if (!Number.isFinite(s) || !Number.isFinite(d) || s <= 0 || d <= 0) continue;
    const date = String(r.date ?? '').slice(0, 10);
    if (!best || date > best.date) best = { date, systolic: s, diastolic: d };
  }
  return best ? { ...best, band: bpBand(best.systolic, best.diastolic) } : null;
}
