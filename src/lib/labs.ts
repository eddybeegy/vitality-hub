/**
 * Blood test (lab) results: a catalogue of common analytes, validation, and the
 * in-range / out-of-range and trend arithmetic. Pure - no I/O, no clock.
 *
 * Reference ranges here are TYPICAL ADULT UK RANGES AND NOTHING MORE. Every lab
 * prints its own range next to the result, those ranges differ between labs and
 * assays, and the printed one is the authority. So each stored row carries its own
 * optional `ref_low`/`ref_high` copied off the report, and the catalogue value is
 * only a fallback for rows where the user did not type one. A result is never
 * described as abnormal without a range to say so against, and nothing here is
 * interpretation: "above the range" is a fact about two numbers, not advice.
 *
 * `taken_on` is a bare YYYY-MM-DD in the user's zone, like `day_tags` and the
 * medication log: a blood draw belongs to the day it happened, not to an instant,
 * so nothing ever converts it.
 */

export type Direction = 'lower' | 'higher' | 'within';

export interface AnalyteSpec {
  /** Stable key stored in the row. */
  key: string;
  label: string;
  /** Unit the catalogue range is expressed in; the row stores its own unit. */
  unit: string;
  /** Which way is better, for reading a trend. 'within' = neither. */
  better: Direction;
  /** Typical adult range. null bound = that end is not bounded in practice. */
  low: number | null;
  high: number | null;
  /** Male/female variants where the usual adult range differs by sex. */
  bySex?: { male?: { low: number | null; high: number | null }; female?: { low: number | null; high: number | null } };
  group: string;
  /** Sensible number of decimals for display. */
  dp: number;
  /** Shown next to the range when it needs a caveat of its own. */
  note?: string;
}

export const ANALYTES: AnalyteSpec[] = [
  // Lipids (UK labs report mmol/L; the "range" for most of these is a target, not
  // a distribution, which is why the low bound is 0).
  { key: 'total_cholesterol', label: 'Total cholesterol', unit: 'mmol/L', better: 'lower', low: null, high: 5, group: 'Lipids', dp: 2 },
  { key: 'ldl', label: 'LDL cholesterol', unit: 'mmol/L', better: 'lower', low: null, high: 3, group: 'Lipids', dp: 2 },
  { key: 'hdl', label: 'HDL cholesterol', unit: 'mmol/L', better: 'higher', low: 1, high: null, group: 'Lipids', dp: 2,
    bySex: { male: { low: 1, high: null }, female: { low: 1.2, high: null } } },
  { key: 'non_hdl', label: 'Non-HDL cholesterol', unit: 'mmol/L', better: 'lower', low: null, high: 4, group: 'Lipids', dp: 2 },
  { key: 'triglycerides', label: 'Triglycerides', unit: 'mmol/L', better: 'lower', low: null, high: 1.7, group: 'Lipids', dp: 2 },
  { key: 'chol_hdl_ratio', label: 'Total : HDL ratio', unit: 'ratio', better: 'lower', low: null, high: 4, group: 'Lipids', dp: 1 },
  { key: 'apob', label: 'Apolipoprotein B', unit: 'g/L', better: 'lower', low: null, high: 1, group: 'Lipids', dp: 2 },
  { key: 'lipoprotein_a', label: 'Lipoprotein(a)', unit: 'nmol/L', better: 'lower', low: null, high: 75, group: 'Lipids', dp: 0,
    note: 'Largely genetic and roughly stable - one measurement is usually enough.' },

  // Glucose
  { key: 'hba1c', label: 'HbA1c', unit: 'mmol/mol', better: 'lower', low: null, high: 41, group: 'Glucose', dp: 0,
    note: '42-47 is the UK pre-diabetes band; 48 and over is the diabetes threshold.' },
  { key: 'fasting_glucose', label: 'Fasting glucose', unit: 'mmol/L', better: 'within', low: 3.9, high: 5.5, group: 'Glucose', dp: 2 },
  { key: 'fasting_insulin', label: 'Fasting insulin', unit: 'pmol/L', better: 'lower', low: null, high: 174, group: 'Glucose', dp: 0 },

  // Iron and vitamins
  { key: 'ferritin', label: 'Ferritin', unit: 'ug/L', better: 'within', low: 30, high: 400, group: 'Iron & vitamins', dp: 0,
    bySex: { male: { low: 30, high: 400 }, female: { low: 15, high: 200 } } },
  { key: 'iron', label: 'Serum iron', unit: 'umol/L', better: 'within', low: 11, high: 30, group: 'Iron & vitamins', dp: 1 },
  { key: 'transferrin_saturation', label: 'Transferrin saturation', unit: '%', better: 'within', low: 20, high: 50, group: 'Iron & vitamins', dp: 0 },
  { key: 'vitamin_d', label: 'Vitamin D (25-OH)', unit: 'nmol/L', better: 'higher', low: 50, high: 125, group: 'Iron & vitamins', dp: 0,
    note: 'Under 25 is deficiency, 25-49 insufficiency, in UK guidance.' },
  { key: 'vitamin_b12', label: 'Vitamin B12', unit: 'ng/L', better: 'within', low: 200, high: 900, group: 'Iron & vitamins', dp: 0 },
  { key: 'folate', label: 'Folate', unit: 'ug/L', better: 'within', low: 3.9, high: 26.8, group: 'Iron & vitamins', dp: 1 },

  // Thyroid
  { key: 'tsh', label: 'TSH', unit: 'mIU/L', better: 'within', low: 0.4, high: 4, group: 'Thyroid', dp: 2 },
  { key: 'free_t4', label: 'Free T4', unit: 'pmol/L', better: 'within', low: 9, high: 23, group: 'Thyroid', dp: 1 },
  { key: 'free_t3', label: 'Free T3', unit: 'pmol/L', better: 'within', low: 3.1, high: 6.8, group: 'Thyroid', dp: 1 },

  // Liver
  { key: 'alt', label: 'ALT', unit: 'U/L', better: 'lower', low: null, high: 50, group: 'Liver', dp: 0,
    bySex: { male: { low: null, high: 50 }, female: { low: null, high: 35 } } },
  { key: 'ast', label: 'AST', unit: 'U/L', better: 'lower', low: null, high: 40, group: 'Liver', dp: 0 },
  { key: 'ggt', label: 'GGT', unit: 'U/L', better: 'lower', low: null, high: 71, group: 'Liver', dp: 0,
    bySex: { male: { low: null, high: 71 }, female: { low: null, high: 42 } } },
  { key: 'alp', label: 'ALP', unit: 'U/L', better: 'within', low: 30, high: 130, group: 'Liver', dp: 0 },
  { key: 'bilirubin', label: 'Bilirubin', unit: 'umol/L', better: 'within', low: null, high: 21, group: 'Liver', dp: 0 },
  { key: 'albumin', label: 'Albumin', unit: 'g/L', better: 'within', low: 35, high: 50, group: 'Liver', dp: 0 },

  // Kidney and electrolytes
  { key: 'creatinine', label: 'Creatinine', unit: 'umol/L', better: 'within', low: 59, high: 104, group: 'Kidney', dp: 0,
    bySex: { male: { low: 59, high: 104 }, female: { low: 45, high: 84 } },
    note: 'Rises with muscle mass and with a high-protein or creatine intake.' },
  { key: 'egfr', label: 'eGFR', unit: 'mL/min/1.73m2', better: 'higher', low: 90, high: null, group: 'Kidney', dp: 0 },
  { key: 'urea', label: 'Urea', unit: 'mmol/L', better: 'within', low: 2.5, high: 7.8, group: 'Kidney', dp: 1 },
  { key: 'uric_acid', label: 'Uric acid', unit: 'umol/L', better: 'within', low: 200, high: 430, group: 'Kidney', dp: 0,
    bySex: { male: { low: 200, high: 430 }, female: { low: 140, high: 360 } } },
  { key: 'sodium', label: 'Sodium', unit: 'mmol/L', better: 'within', low: 133, high: 146, group: 'Kidney', dp: 0 },
  { key: 'potassium', label: 'Potassium', unit: 'mmol/L', better: 'within', low: 3.5, high: 5.3, group: 'Kidney', dp: 1 },
  { key: 'calcium_adjusted', label: 'Calcium (adjusted)', unit: 'mmol/L', better: 'within', low: 2.2, high: 2.6, group: 'Kidney', dp: 2 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mmol/L', better: 'within', low: 0.7, high: 1, group: 'Kidney', dp: 2 },

  // Blood count
  { key: 'haemoglobin', label: 'Haemoglobin', unit: 'g/L', better: 'within', low: 130, high: 170, group: 'Blood count', dp: 0,
    bySex: { male: { low: 130, high: 170 }, female: { low: 120, high: 150 } } },
  { key: 'haematocrit', label: 'Haematocrit', unit: 'L/L', better: 'within', low: 0.4, high: 0.52, group: 'Blood count', dp: 2,
    bySex: { male: { low: 0.4, high: 0.52 }, female: { low: 0.36, high: 0.46 } } },
  { key: 'platelets', label: 'Platelets', unit: '10^9/L', better: 'within', low: 150, high: 400, group: 'Blood count', dp: 0 },
  { key: 'white_cells', label: 'White cell count', unit: '10^9/L', better: 'within', low: 4, high: 11, group: 'Blood count', dp: 1 },

  // Hormones and inflammation
  { key: 'testosterone', label: 'Testosterone (total)', unit: 'nmol/L', better: 'within', low: 8.6, high: 29, group: 'Hormones', dp: 1,
    note: 'Morning sample; the usual range is the male adult one.' },
  { key: 'free_testosterone', label: 'Testosterone (free)', unit: 'pmol/L', better: 'within', low: 200, high: 620, group: 'Hormones', dp: 0 },
  { key: 'shbg', label: 'SHBG', unit: 'nmol/L', better: 'within', low: 18.3, high: 54.1, group: 'Hormones', dp: 1 },
  { key: 'cortisol', label: 'Cortisol (morning)', unit: 'nmol/L', better: 'within', low: 166, high: 507, group: 'Hormones', dp: 0 },
  { key: 'crp', label: 'CRP', unit: 'mg/L', better: 'lower', low: null, high: 5, group: 'Inflammation', dp: 1 },
  { key: 'crp_hs', label: 'CRP (high sensitivity)', unit: 'mg/L', better: 'lower', low: null, high: 3, group: 'Inflammation', dp: 2 },
  { key: 'psa', label: 'PSA', unit: 'ug/L', better: 'lower', low: null, high: 3, group: 'Hormones', dp: 2,
    note: 'The usual threshold rises with age; the lab report is the authority.' },
];

export const ANALYTE_BY_KEY: Record<string, AnalyteSpec> = Object.fromEntries(ANALYTES.map((a) => [a.key, a]));

export const GROUPS = Array.from(new Set(ANALYTES.map((a) => a.group)));

export const MAX_UNIT_LENGTH = 16;
export const MAX_LAB_LENGTH = 60;
export const MAX_NOTES_LENGTH = 200;
export const MAX_ROWS_PER_POST = 60;
/** A lab value outside this is a typo, not a result. */
export const MAX_ABS_VALUE = 1e6;

export type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

export interface LabRow {
  id: number;
  taken_on: string;
  analyte: string;
  value: number;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  lab: string | null;
  notes: string | null;
}

export interface LabInput {
  taken_on: string;
  analyte: string;
  value: number;
  unit: string | null;
  ref_low: number | null;
  ref_high: number | null;
  lab: string | null;
  notes: string | null;
}

// Reuse the day-tags check rather than re-rolling one: `Date.parse` accepts
// 2026-02-30 and silently means 1 March, so a typed date that does not exist
// would be stored as a different day than the one on the report.
export { isCalendarDay } from './dayTags.js';
import { isCalendarDay } from './dayTags.js';

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const out = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return out || null;
};

const numberOrNull = (v: unknown): number | null | undefined => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS_VALUE) return undefined;
  return n;
};

/** An analyte key the catalogue knows, or a user's own `custom:<slug>`. */
export const normaliseAnalyte = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase().replace(/[^a-z0-9:_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return t || null;
};

export function validateLabInput(body: unknown): Result<LabInput> {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const b = body as Record<string, unknown>;

  if (!isCalendarDay(b.taken_on)) return { error: 'taken_on must be YYYY-MM-DD' };
  const analyte = normaliseAnalyte(b.analyte);
  if (!analyte) return { error: 'analyte is required' };

  const value = numberOrNull(b.value);
  if (value === undefined) return { error: 'value must be a finite number' };
  if (value === null) return { error: 'value is required' };

  // A bad range would silently mark a normal result abnormal, so a malformed one is
  // rejected rather than dropped: the user would not see that it had been ignored.
  const refLow = numberOrNull(b.ref_low);
  if (refLow === undefined) return { error: 'ref_low must be a number or blank' };
  const refHigh = numberOrNull(b.ref_high);
  if (refHigh === undefined) return { error: 'ref_high must be a number or blank' };
  if (refLow !== null && refHigh !== null && refLow > refHigh) {
    return { error: `Invalid range: low ${refLow} is above high ${refHigh}` };
  }

  return {
    value: {
      taken_on: b.taken_on,
      analyte,
      value,
      unit: cleanText(b.unit, MAX_UNIT_LENGTH) ?? ANALYTE_BY_KEY[analyte]?.unit ?? null,
      ref_low: refLow,
      ref_high: refHigh,
      lab: cleanText(b.lab, MAX_LAB_LENGTH),
      notes: cleanText(b.notes, MAX_NOTES_LENGTH),
    },
  };
}

/** A whole panel in one post: one date and lab, many analytes. */
export function validatePanelInput(body: unknown): Result<LabInput[]> {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.results)) return { error: 'results must be a list' };
  if (!b.results.length) return { error: 'results is empty' };
  if (b.results.length > MAX_ROWS_PER_POST) return { error: `At most ${MAX_ROWS_PER_POST} results per request` };

  const out: LabInput[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of b.results.entries()) {
    const merged = { taken_on: b.taken_on, lab: b.lab, ...(raw && typeof raw === 'object' ? raw : {}) };
    const parsed = validateLabInput(merged);
    if (parsed.error !== undefined) return { error: `Result ${i + 1}: ${parsed.error}` };
    const dedupeKey = `${parsed.value.taken_on}|${parsed.value.analyte}`;
    // Two values for one analyte on one day cannot both be stored (the unique key
    // keeps one), and silently keeping whichever the loop reached last would be a
    // coin toss over a health number.
    if (seen.has(dedupeKey)) return { error: `Result ${i + 1}: ${parsed.value.analyte} is listed twice for ${parsed.value.taken_on}` };
    seen.add(dedupeKey);
    out.push(parsed.value);
  }
  return { value: out };
}

export type Sex = 'male' | 'female' | null;

export const sexOf = (gender: unknown): Sex => {
  const t = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
  if (t === 'male' || t === 'm' || t === 'man') return 'male';
  if (t === 'female' || t === 'f' || t === 'woman') return 'female';
  return null;
};

export interface EffectiveRange {
  low: number | null;
  high: number | null;
  /** Where the range came from, so the UI never implies the lab said it. */
  source: 'row' | 'catalogue' | 'none';
}

/**
 * The range to judge a row against: the one off the user's own report if they
 * entered it, otherwise the catalogue's typical adult range (sex-specific where
 * that differs), otherwise none - and with none, the row is simply "no range".
 */
export function effectiveRange(row: Pick<LabRow, 'analyte' | 'ref_low' | 'ref_high'>, sex: Sex = null): EffectiveRange {
  if (row.ref_low !== null || row.ref_high !== null) {
    return { low: row.ref_low, high: row.ref_high, source: 'row' };
  }
  const spec = ANALYTE_BY_KEY[row.analyte];
  if (!spec) return { low: null, high: null, source: 'none' };
  const variant = sex && spec.bySex ? spec.bySex[sex] : undefined;
  const low = variant ? variant.low : spec.low;
  const high = variant ? variant.high : spec.high;
  if (low === null && high === null) return { low: null, high: null, source: 'none' };
  return { low, high, source: 'catalogue' };
}

export type Flag = 'low' | 'in_range' | 'high' | 'unknown';

export function flagOf(value: number, range: EffectiveRange): Flag {
  if (range.source === 'none') return 'unknown';
  if (range.low !== null && value < range.low) return 'low';
  if (range.high !== null && value > range.high) return 'high';
  return 'in_range';
}

export interface LabTrend {
  analyte: string;
  label: string;
  group: string;
  unit: string | null;
  dp: number;
  better: Direction;
  latest: LabRow;
  previous: LabRow | null;
  /** latest minus previous, in the row's own unit. */
  change: number | null;
  /** Whether the change moved toward or away from the better end. null = neither. */
  movement: 'better' | 'worse' | 'flat' | null;
  range: EffectiveRange;
  flag: Flag;
  /** Every value for this analyte, oldest first, for a trend line. */
  history: Array<{ taken_on: string; value: number }>;
  note?: string;
}

const byDayAsc = (a: { taken_on: string }, b: { taken_on: string }) => a.taken_on.localeCompare(b.taken_on);

/**
 * One entry per analyte the user has ever entered, newest value first, with the
 * previous value and which way it moved.
 *
 * A change is only called better or worse for analytes with a direction; for the
 * many that are simply meant to sit inside a range, a move is reported as a number
 * and left at that, because "up" is not news on its own.
 */
export function trends(rows: readonly LabRow[], sex: Sex = null): LabTrend[] {
  const byAnalyte = new Map<string, LabRow[]>();
  for (const r of rows) {
    const list = byAnalyte.get(r.analyte) || [];
    list.push(r);
    byAnalyte.set(r.analyte, list);
  }

  const out: LabTrend[] = [];
  for (const [analyte, list] of byAnalyte) {
    const sorted = [...list].sort(byDayAsc);
    const latest = sorted[sorted.length - 1];
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    const spec = ANALYTE_BY_KEY[analyte];
    const range = effectiveRange(latest, sex);
    const change = previous ? Number((latest.value - previous.value).toFixed(6)) : null;
    const better = spec?.better ?? 'within';
    let movement: LabTrend['movement'] = null;
    if (change !== null) {
      if (change === 0) movement = 'flat';
      else if (better === 'lower') movement = change < 0 ? 'better' : 'worse';
      else if (better === 'higher') movement = change > 0 ? 'better' : 'worse';
    }
    out.push({
      analyte,
      label: spec?.label ?? analyte.replace(/^custom:/, '').replace(/_/g, ' '),
      group: spec?.group ?? 'Other',
      unit: latest.unit ?? spec?.unit ?? null,
      dp: spec?.dp ?? 2,
      better,
      latest,
      previous,
      change,
      movement,
      range,
      flag: flagOf(latest.value, range),
      history: sorted.map((r) => ({ taken_on: r.taken_on, value: r.value })),
      ...(spec?.note ? { note: spec.note } : {}),
    });
  }

  return out.sort((a, b) => {
    const ga = GROUPS.indexOf(a.group);
    const gb = GROUPS.indexOf(b.group);
    if (ga !== gb) return (ga < 0 ? GROUPS.length : ga) - (gb < 0 ? GROUPS.length : gb);
    return a.label.localeCompare(b.label);
  });
}

/** The distinct dates the user has results for, newest first. */
export interface PanelDate { taken_on: string; count: number; lab: string | null }

export function panelDates(rows: readonly LabRow[]): PanelDate[] {
  const map = new Map<string, { taken_on: string; count: number; lab: string | null }>();
  for (const r of rows) {
    const e = map.get(r.taken_on) || { taken_on: r.taken_on, count: 0, lab: null };
    e.count += 1;
    if (!e.lab && r.lab) e.lab = r.lab;
    map.set(r.taken_on, e);
  }
  return [...map.values()].sort((a, b) => b.taken_on.localeCompare(a.taken_on));
}

/**
 * The out-of-range results from the most recent panel, for the AI context and the
 * card's summary line. Reports the facts - value, range, which side - and nothing
 * about what they might mean.
 */
export interface OutOfRangeRow { analyte: string; label: string; value: number; unit: string | null; flag: Flag; low: number | null; high: number | null; source: EffectiveRange['source']; taken_on: string }

/**
 * Current exceptions: the LATEST VALUE FOR EACH ANALYTE that sits outside its range,
 * which is not the same as "everything on the newest panel". A follow-up that retests
 * one analyte must not hide a low ferritin from the panel a month earlier - nothing
 * has been measured since, so it is still the current reading.
 *
 * Each row therefore carries its own `taken_on`, and callers should show it when it
 * differs from the newest panel's date: "ferritin low (as of 1 Sep)" is honest about
 * its age in a way a bare "ferritin low" is not.
 */
export function outOfRange(rows: readonly LabRow[], sex: Sex = null): OutOfRangeRow[] {
  return trends(rows, sex)
    .filter((t) => t.flag === 'low' || t.flag === 'high')
    .map((t) => ({
      analyte: t.analyte,
      label: t.label,
      value: t.latest.value,
      unit: t.unit,
      flag: t.flag,
      low: t.range.low,
      high: t.range.high,
      source: t.range.source,
      taken_on: t.latest.taken_on,
    }));
}
