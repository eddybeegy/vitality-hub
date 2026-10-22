import { describe, it, expect } from 'vitest';
import {
  ANALYTE_BY_KEY,
  effectiveRange,
  flagOf,
  normaliseAnalyte,
  outOfRange,
  panelDates,
  sexOf,
  trends,
  validateLabInput,
  validatePanelInput,
  type LabRow,
} from './labs';

const row = (over: Partial<LabRow> = {}): LabRow => ({
  id: 1,
  taken_on: '2026-10-01',
  analyte: 'ldl',
  value: 2.4,
  unit: 'mmol/L',
  ref_low: null,
  ref_high: null,
  lab: null,
  notes: null,
  ...over,
});

describe('validateLabInput', () => {
  it('fills the unit from the catalogue when none is given', () => {
    const out = validateLabInput({ taken_on: '2026-10-01', analyte: 'hba1c', value: 34 });
    expect(out.value).toMatchObject({ analyte: 'hba1c', value: 34, unit: 'mmol/mol', ref_low: null, ref_high: null });
  });

  it('keeps the unit the user typed, even when the catalogue disagrees', () => {
    const out = validateLabInput({ taken_on: '2026-10-01', analyte: 'hba1c', value: 5.2, unit: '%' });
    expect(out.value?.unit).toBe('%');
  });

  it('rejects a missing or non-numeric value rather than storing a zero', () => {
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl' }).error).toMatch(/value is required/);
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl', value: 'high' }).error).toMatch(/finite number/);
  });

  it('rejects a bad date and a missing analyte', () => {
    expect(validateLabInput({ taken_on: '01/10/2026', analyte: 'ldl', value: 2 }).error).toMatch(/YYYY-MM-DD/);
    expect(validateLabInput({ taken_on: '2026-02-30', analyte: 'ldl', value: 2 }).error).toMatch(/YYYY-MM-DD/);
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: '  ', value: 2 }).error).toMatch(/analyte is required/);
  });

  // A silently dropped range would mark a normal result abnormal with no sign that
  // anything had been ignored.
  it('rejects a malformed or reversed reference range', () => {
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl', value: 2, ref_low: 'x' }).error).toMatch(/ref_low/);
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl', value: 2, ref_low: 5, ref_high: 1 }).error).toMatch(/low 5 is above high 1/);
  });

  it('accepts one open-ended bound', () => {
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl', value: 2, ref_high: 3 }).value).toMatchObject({ ref_low: null, ref_high: 3 });
  });

  it('cleans text fields and clips them', () => {
    const out = validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl', value: 2, lab: '  Blue\u0000 Horizon\n ', notes: 'x'.repeat(400) });
    expect(out.value?.lab).toBe('Blue Horizon');
    expect(out.value?.notes).toHaveLength(200);
  });

  it('normalises an analyte key and allows a custom one', () => {
    expect(normaliseAnalyte(' Free T3 ')).toBe('free_t3');
    expect(normaliseAnalyte('custom:Omega-3 index')).toBe('custom:omega_3_index');
    expect(normaliseAnalyte(42)).toBeNull();
  });

  it('rejects an absurd value as a typo', () => {
    expect(validateLabInput({ taken_on: '2026-10-01', analyte: 'ldl', value: 1e9 }).error).toMatch(/finite number/);
  });
});

describe('validatePanelInput', () => {
  it('applies the panel date and lab to every result', () => {
    const out = validatePanelInput({
      taken_on: '2026-10-02',
      lab: 'Medichecks',
      results: [{ analyte: 'ldl', value: 2.1 }, { analyte: 'hdl', value: 1.6, unit: 'mmol/L' }],
    });
    expect(out.value).toHaveLength(2);
    expect(out.value?.[0]).toMatchObject({ taken_on: '2026-10-02', lab: 'Medichecks', analyte: 'ldl' });
    expect(out.value?.[1]).toMatchObject({ taken_on: '2026-10-02', analyte: 'hdl', value: 1.6 });
  });

  it('lets a single result override the panel date', () => {
    const out = validatePanelInput({ taken_on: '2026-10-02', results: [{ analyte: 'ldl', value: 2.1, taken_on: '2026-09-30' }] });
    expect(out.value?.[0].taken_on).toBe('2026-09-30');
  });

  // Keeping whichever came last would be a coin toss over a health number.
  it('refuses the same analyte twice on one day', () => {
    const out = validatePanelInput({ taken_on: '2026-10-02', results: [{ analyte: 'ldl', value: 2.1 }, { analyte: 'LDL', value: 2.9 }] });
    expect(out.error).toMatch(/listed twice/);
  });

  it('names the offending row and rejects an empty list', () => {
    expect(validatePanelInput({ taken_on: '2026-10-02', results: [{ analyte: 'ldl', value: 2 }, { analyte: 'hdl' }] }).error).toMatch(/^Result 2: value is required/);
    expect(validatePanelInput({ taken_on: '2026-10-02', results: [] }).error).toMatch(/empty/);
    expect(validatePanelInput({ taken_on: '2026-10-02' }).error).toMatch(/must be a list/);
  });
});

describe('effectiveRange', () => {
  it("prefers the user's own range over the catalogue", () => {
    expect(effectiveRange(row({ ref_low: 0, ref_high: 4 }))).toEqual({ low: 0, high: 4, source: 'row' });
  });

  it('falls back to the catalogue, sex-specific where it differs', () => {
    expect(effectiveRange(row({ analyte: 'ferritin' }), 'male')).toEqual({ low: 30, high: 400, source: 'catalogue' });
    expect(effectiveRange(row({ analyte: 'ferritin' }), 'female')).toEqual({ low: 15, high: 200, source: 'catalogue' });
    expect(effectiveRange(row({ analyte: 'ferritin' }))).toEqual({ low: 30, high: 400, source: 'catalogue' });
  });

  it('reports no range for an analyte it has never heard of', () => {
    expect(effectiveRange(row({ analyte: 'custom:omega_3_index' }))).toEqual({ low: null, high: null, source: 'none' });
  });

  it('uses one bound when that is all there is', () => {
    expect(effectiveRange(row({ analyte: 'egfr' }))).toEqual({ low: 90, high: null, source: 'catalogue' });
  });
});

describe('flagOf', () => {
  it('flags either side and treats the bounds as inclusive', () => {
    const r = { low: 50, high: 125, source: 'catalogue' as const };
    expect(flagOf(49, r)).toBe('low');
    expect(flagOf(50, r)).toBe('in_range');
    expect(flagOf(125, r)).toBe('in_range');
    expect(flagOf(126, r)).toBe('high');
  });

  // Without a range there is nothing to call it against, and guessing "in range"
  // would be a reassurance nobody gave.
  it('says unknown when there is no range', () => {
    expect(flagOf(7, { low: null, high: null, source: 'none' })).toBe('unknown');
  });
});

describe('trends', () => {
  const rows: LabRow[] = [
    row({ id: 1, analyte: 'ldl', taken_on: '2026-04-01', value: 3.4 }),
    row({ id: 2, analyte: 'ldl', taken_on: '2026-10-01', value: 2.6 }),
    row({ id: 3, analyte: 'hdl', taken_on: '2026-04-01', value: 1.5 }),
    row({ id: 4, analyte: 'hdl', taken_on: '2026-10-01', value: 1.3 }),
    row({ id: 5, analyte: 'tsh', taken_on: '2026-10-01', value: 2.1 }),
  ];

  it('reads a fall in LDL as better and a fall in HDL as worse', () => {
    const t = trends(rows);
    const ldl = t.find((x) => x.analyte === 'ldl')!;
    const hdl = t.find((x) => x.analyte === 'hdl')!;
    expect(ldl).toMatchObject({ change: -0.8, movement: 'better', flag: 'in_range' });
    expect(hdl).toMatchObject({ change: -0.2, movement: 'worse' });
  });

  it('leaves movement null for an analyte that is just meant to sit in range', () => {
    const t = trends([row({ analyte: 'tsh', taken_on: '2026-04-01', value: 1.1 }), row({ id: 2, analyte: 'tsh', taken_on: '2026-10-01', value: 2.1 })]);
    expect(t[0]).toMatchObject({ change: 1, movement: null, better: 'within' });
  });

  it('has no previous value or change for a first result', () => {
    const t = trends(rows).find((x) => x.analyte === 'tsh')!;
    expect(t.previous).toBeNull();
    expect(t.change).toBeNull();
    expect(t.movement).toBeNull();
  });

  it('takes the latest by date, not by insertion order', () => {
    const t = trends([row({ id: 1, taken_on: '2026-10-01', value: 2.6 }), row({ id: 2, taken_on: '2026-04-01', value: 3.4 })]);
    expect(t[0].latest.taken_on).toBe('2026-10-01');
    expect(t[0].history.map((h) => h.taken_on)).toEqual(['2026-04-01', '2026-10-01']);
  });

  it('labels and groups an unknown analyte without pretending to a range', () => {
    const t = trends([row({ analyte: 'custom:omega_3_index', value: 7.2, unit: '%' })]);
    expect(t[0]).toMatchObject({ label: 'omega 3 index', group: 'Other', flag: 'unknown', unit: '%' });
  });

  it('carries the catalogue caveat where there is one', () => {
    expect(trends([row({ analyte: 'hba1c', value: 34 })])[0].note).toMatch(/pre-diabetes/);
    expect(trends([row({ analyte: 'ldl', value: 2 })])[0].note).toBeUndefined();
  });

  it('calls an identical repeat flat', () => {
    const t = trends([row({ id: 1, taken_on: '2026-04-01', value: 2.6 }), row({ id: 2, taken_on: '2026-10-01', value: 2.6 })]);
    expect(t[0].movement).toBe('flat');
  });

  it('orders by catalogue group then label', () => {
    const t = trends(rows).map((x) => x.analyte);
    expect(t.indexOf('hdl')).toBeLessThan(t.indexOf('tsh'));
  });
});

describe('outOfRange', () => {
  it('reports only the latest panel and says which range it used', () => {
    const out = outOfRange([
      row({ id: 1, analyte: 'vitamin_d', taken_on: '2026-04-01', value: 30 }),
      row({ id: 2, analyte: 'vitamin_d', taken_on: '2026-10-01', value: 80 }),
      row({ id: 3, analyte: 'ferritin', taken_on: '2026-10-01', value: 12 }),
      row({ id: 4, analyte: 'alt', taken_on: '2026-10-01', value: 70, ref_high: 60 }),
    ], 'male');
    expect(out.map((o) => o.analyte).sort()).toEqual(['alt', 'ferritin']);
    expect(out.find((o) => o.analyte === 'ferritin')).toMatchObject({ flag: 'low', low: 30, source: 'catalogue' });
    expect(out.find((o) => o.analyte === 'alt')).toMatchObject({ flag: 'high', high: 60, source: 'row' });
  });

  it('is empty when everything sits inside its range', () => {
    expect(outOfRange([row({ analyte: 'ldl', value: 2.2 })])).toEqual([]);
  });
});

describe('panelDates and sexOf', () => {
  it('counts results per date, newest first, keeping the lab name', () => {
    expect(panelDates([
      row({ id: 1, taken_on: '2026-04-01', lab: 'GP' }),
      row({ id: 2, taken_on: '2026-10-01', analyte: 'hdl', lab: 'Medichecks' }),
      row({ id: 3, taken_on: '2026-10-01', analyte: 'ldl' }),
    ])).toEqual([
      { taken_on: '2026-10-01', count: 2, lab: 'Medichecks' },
      { taken_on: '2026-04-01', count: 1, lab: 'GP' },
    ]);
  });

  it('reads the stored gender loosely and gives up rather than guessing', () => {
    expect(sexOf('Male')).toBe('male');
    expect(sexOf('f')).toBe('female');
    expect(sexOf('other')).toBeNull();
    expect(sexOf(undefined)).toBeNull();
  });
});

describe('catalogue', () => {
  it('has unique keys and a sane range on every entry', () => {
    const keys = Object.keys(ANALYTE_BY_KEY);
    expect(new Set(keys).size).toBe(keys.length);
    for (const spec of Object.values(ANALYTE_BY_KEY)) {
      if (spec.low !== null && spec.high !== null) expect(spec.low).toBeLessThan(spec.high);
      expect(spec.unit.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });
});
