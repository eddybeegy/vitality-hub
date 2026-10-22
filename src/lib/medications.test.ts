import { describe, it, expect } from 'vitest';
import {
  adherence, dueOn, isActiveOn, medicationMarkers, validateDoseInput, validateMedicationInput,
  FREQUENCIES, MAX_NAME_LENGTH, type Medication, type DoseRow,
} from './medications';

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 1,
  name: 'Vitamin D',
  kind: 'supplement',
  dose: '1000 iu',
  frequency: 'daily',
  start_date: null,
  end_date: null,
  notes: null,
  ...over,
});

const dose = (dose_date: string, taken = 1, medication_id = 1): DoseRow => ({ medication_id, dose_date, taken });

describe('validateMedicationInput', () => {
  it('accepts a minimal item and defaults kind and frequency', () => {
    const out = validateMedicationInput({ name: 'Sertraline' });
    expect(out.value).toEqual({
      name: 'Sertraline', kind: 'medication', frequency: 'daily',
      start_date: null, end_date: null, dose: null, notes: null,
    });
  });

  it('requires a name', () => {
    expect(validateMedicationInput({ name: '   ' }).error).toBe('Name is required');
    expect(validateMedicationInput({}).error).toBe('Name is required');
    expect(validateMedicationInput(null).error).toBe('Body must be an object');
  });

  it('rejects an unknown frequency rather than defaulting it', () => {
    // A guessed frequency becomes an adherence denominator, so a wrong guess
    // would report a confident but false percentage.
    expect(validateMedicationInput({ name: 'X', frequency: 'hourly' }).error).toContain('frequency must be one of');
  });

  it('rejects an unknown kind', () => {
    expect(validateMedicationInput({ name: 'X', kind: 'potion' }).error).toContain('kind must be one of');
  });

  it('rejects a malformed or reversed date range', () => {
    expect(validateMedicationInput({ name: 'X', start_date: '12/01/2026' }).error).toBe('start_date must be YYYY-MM-DD');
    expect(validateMedicationInput({ name: 'X', start_date: '2026-10-10', end_date: '2026-10-01' }).error)
      .toBe('end_date 2026-10-01 is before start_date 2026-10-10');
  });

  it('treats an empty date as ongoing rather than invalid', () => {
    expect(validateMedicationInput({ name: 'X', end_date: '' }).value!.end_date).toBeNull();
  });

  it('strips control characters and clips a long name', () => {
    const out = validateMedicationInput({ name: `Vit\u0000amin\nD${'!'.repeat(200)}` });
    expect(out.value!.name).toHaveLength(MAX_NAME_LENGTH);
    expect(out.value!.name).not.toContain('\u0000');
    expect(out.value!.name.startsWith('Vit amin D')).toBe(true);
  });
});

describe('validateDoseInput', () => {
  it('defaults to taken', () => {
    expect(validateDoseInput({ date: '2026-10-22' }).value).toEqual({ date: '2026-10-22', taken: true });
  });

  it('accepts an explicit skip and rejects a bad day', () => {
    expect(validateDoseInput({ date: '2026-10-22', taken: false }).value!.taken).toBe(false);
    expect(validateDoseInput({ date: 'yesterday' }).error).toBe('date must be YYYY-MM-DD');
    expect(validateDoseInput({ date: '2026-10-22', taken: 'yes' }).error).toBe('taken must be a boolean');
  });
});

describe('isActiveOn', () => {
  it('is inclusive of both ends and open where a date is missing', () => {
    const m = med({ start_date: '2026-10-10', end_date: '2026-10-12' });
    expect(isActiveOn(m, '2026-10-09')).toBe(false);
    expect(isActiveOn(m, '2026-10-10')).toBe(true);
    expect(isActiveOn(m, '2026-10-12')).toBe(true);
    expect(isActiveOn(m, '2026-10-13')).toBe(false);
    expect(isActiveOn(med(), '1999-01-01')).toBe(true);
  });
});

describe('adherence', () => {
  it('scores taken days against scheduled days', () => {
    const out = adherence([med()], [dose('2026-10-20'), dose('2026-10-21'), dose('2026-10-22')], '2026-10-19', '2026-10-22');
    expect(out[0]).toMatchObject({
      scheduled_days: 4, taken_days: 3, skipped_days: 0, unlogged_days: 1, percent: 75, current_streak: 3,
    });
  });

  it('counts an explicit skip separately from an unlogged day', () => {
    const out = adherence([med()], [dose('2026-10-22', 0)], '2026-10-21', '2026-10-22');
    expect(out[0]).toMatchObject({ taken_days: 0, skipped_days: 1, unlogged_days: 1, percent: 0 });
  });

  it('only scores days inside the item\'s start and stop', () => {
    const out = adherence(
      [med({ start_date: '2026-10-21', end_date: '2026-10-22' })],
      [dose('2026-10-21'), dose('2026-10-22'), dose('2026-10-19')],
      '2026-10-18', '2026-10-23',
    );
    // 6 days in the window, 2 of them scheduled; the dose outside the range is ignored.
    expect(out[0]).toMatchObject({ scheduled_days: 2, taken_days: 2, percent: 100 });
  });

  it('schedules a weekly item on its start weekday, not every seventh day of the window', () => {
    // 2026-10-04 is a Sunday; the window holds three Sundays.
    const out = adherence(
      [med({ frequency: 'weekly', start_date: '2026-10-04' })],
      [dose('2026-10-11')],
      '2026-10-04', '2026-10-22',
    );
    expect(out[0].scheduled_days).toBe(3);
    expect(out[0].taken_days).toBe(1);
    expect(out[0].percent).toBe(33);
  });

  it('never scores an as-needed item', () => {
    const out = adherence([med({ frequency: 'as_needed' })], [dose('2026-10-22')], '2026-10-20', '2026-10-22');
    expect(out[0]).toMatchObject({ scheduled_days: 0, percent: null, current_streak: 0 });
    expect(FREQUENCIES.as_needed).toBe(0);
  });

  it('breaks the streak at the first scheduled day without a tick', () => {
    const out = adherence([med()], [dose('2026-10-20'), dose('2026-10-22')], '2026-10-19', '2026-10-22');
    expect(out[0].current_streak).toBe(1);
  });

  it('keeps each item\'s doses to itself', () => {
    const out = adherence(
      [med(), med({ id: 2, name: 'Creatine' })],
      [dose('2026-10-22', 1, 1)],
      '2026-10-22', '2026-10-22',
    );
    expect(out[0].taken_days).toBe(1);
    expect(out[1].taken_days).toBe(0);
    expect(out[1].name).toBe('Creatine');
  });

  it('handles an empty log and an empty item list', () => {
    expect(adherence([], [], '2026-10-01', '2026-10-22')).toEqual([]);
  });

  // Caught on the live database: a freshly added item read "0%", which says the
  // user failed a course they had not started logging. Nothing said at all is
  // not a miss, so the percentage is withheld until there is one tick or skip.
  it('reports no percentage at all until something is logged', () => {
    const out = adherence([med()], [], '2026-10-16', '2026-10-22');
    expect(out[0]).toMatchObject({ scheduled_days: 7, taken_days: 0, skipped_days: 0, unlogged_days: 7, percent: null });
  });

  it('counts unlogged days against the percentage once logging has started', () => {
    const out = adherence([med()], [{ medication_id: 1, dose_date: '2026-10-22', taken: 1 }], '2026-10-20', '2026-10-22');
    expect(out[0]).toMatchObject({ scheduled_days: 3, taken_days: 1, unlogged_days: 2, percent: 33 });
  });
});

describe('dueOn', () => {
  it('reports null for an item with nothing logged, and the state when there is', () => {
    const out = dueOn([med(), med({ id: 2, name: 'Creatine' }), med({ id: 3, name: 'Old', end_date: '2026-10-01' })],
      [dose('2026-10-22', 0, 2)], '2026-10-22');
    expect(out.map((m) => [m.name, m.taken])).toEqual([['Vitamin D', null], ['Creatine', false]]);
  });

  it('includes as-needed items so they can still be ticked', () => {
    const out = dueOn([med({ frequency: 'as_needed' })], [], '2026-10-22');
    expect(out).toHaveLength(1);
  });
});

describe('medicationMarkers', () => {
  const buckets = ['2026-10-20', '2026-10-21', '2026-10-22'];

  it('marks a start and a stop that fall on a bucket the chart has', () => {
    const out = medicationMarkers(
      [med({ start_date: '2026-10-20', end_date: '2026-10-22' })], buckets, 'day');
    expect(out).toEqual([
      { x: '2026-10-20', tags: ['Start Vitamin D'], label: 'Start Vitamin D' },
      { x: '2026-10-22', tags: ['Stop Vitamin D'], label: 'Stop Vitamin D' },
    ]);
  });

  it('skips days the chart has no bucket for', () => {
    expect(medicationMarkers([med({ start_date: '2026-01-01' })], buckets, 'day')).toEqual([]);
  });

  it('collapses several events in one bucket into one marker', () => {
    const out = medicationMarkers(
      [med({ start_date: '2026-10-21' }), med({ id: 2, name: 'Creatine', start_date: '2026-10-21' })],
      buckets, 'day');
    expect(out).toHaveLength(1);
    expect(out[0].tags).toEqual(['Start Vitamin D', 'Start Creatine']);
    expect(out[0].label).toBe('Start Vitamin D +1');
  });

  it('maps a day onto its week or month bucket', () => {
    const weekly = medicationMarkers([med({ start_date: '2026-10-21' })], ['2026-10-18'], 'week');
    expect(weekly[0].x).toBe('2026-10-18');
    const monthly = medicationMarkers([med({ start_date: '2026-10-21' })], ['2026-10-01'], 'month');
    expect(monthly[0].x).toBe('2026-10-01');
  });

  it('returns nothing without items or buckets', () => {
    expect(medicationMarkers([], buckets, 'day')).toEqual([]);
    expect(medicationMarkers([med({ start_date: '2026-10-20' })], [], 'day')).toEqual([]);
  });
});
