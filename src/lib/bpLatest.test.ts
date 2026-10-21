import { describe, expect, it } from 'vitest';
import { latestBpReadings, type BpRow } from './bpLatest';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const london = (d: Date) => fmt.format(d);

const reading = (source: string, ts: string, sys: number | null, dia: number | null): BpRow[] => [
  ...(sys === null ? [] : [{ type: 'blood_pressure_systolic', source, value: sys, timestamp: ts }]),
  ...(dia === null ? [] : [{ type: 'blood_pressure_diastolic', source, value: dia, timestamp: ts }]),
];

describe('latestBpReadings (item 69)', () => {
  it('2025-12-08: withings 133/75 then 117/73 shows 117/73, not the 125/74 mean', () => {
    const out = latestBpReadings([
      ...reading('withings', '2025-12-08T13:51:09Z', 133, 75),
      ...reading('withings', '2025-12-08T19:51:56Z', 117, 73),
    ], london);
    expect(out.blood_pressure_systolic['2025-12-08'].withings).toBe(117);
    expect(out.blood_pressure_diastolic['2025-12-08'].withings).toBe(73);
  });

  it('keeps each source separate', () => {
    const out = latestBpReadings([
      ...reading('withings', '2025-12-08T19:51:56Z', 117, 73),
      ...reading('apple_health', '2025-12-08T00:00:00Z', 120, 80),
    ], london);
    expect(out.blood_pressure_systolic['2025-12-08']).toEqual({ withings: 117, apple_health: 120 });
  });

  it('takes the latest COMPLETE reading, so both numbers come from one measurement', () => {
    // a lone later diastolic must not pair with the earlier systolic
    const out = latestBpReadings([
      ...reading('healthsync', '2026-09-09T07:00:00Z', 121, 79),
      ...reading('healthsync', '2026-09-09T20:00:00Z', null, 70),
    ], london);
    expect(out.blood_pressure_systolic['2026-09-09'].healthsync).toBe(121);
    expect(out.blood_pressure_diastolic['2026-09-09'].healthsync).toBe(79);
  });

  it('with no complete reading, each half falls back to its own latest', () => {
    const out = latestBpReadings([
      ...reading('apple_health', '2026-03-09T08:00:00Z', null, 75),
      ...reading('apple_health', '2026-03-09T09:00:00Z', null, 71),
    ], london);
    expect(out.blood_pressure_diastolic['2026-03-09'].apple_health).toBe(71);
    expect(out.blood_pressure_systolic).toBeUndefined();
  });

  it('days are the user\'s calendar days: 23:30Z in BST is the next London day', () => {
    const out = latestBpReadings([
      ...reading('healthsync', '2026-09-08T22:00:00Z', 118, 76),
      ...reading('healthsync', '2026-09-08T23:30:00Z', 125, 82),
    ], london);
    expect(out.blood_pressure_systolic['2026-09-08'].healthsync).toBe(118);
    expect(out.blood_pressure_systolic['2026-09-09'].healthsync).toBe(125);
  });

  it('accepts Date timestamps and node-pg string values, and ignores other types and garbage', () => {
    const out = latestBpReadings([
      { type: 'blood_pressure_systolic', source: 'withings', value: '130', timestamp: new Date('2026-05-10T08:00:00Z') },
      { type: 'blood_pressure_diastolic', source: 'withings', value: '85', timestamp: new Date('2026-05-10T08:00:00Z') },
      { type: 'heart_rate', source: 'withings', value: 60, timestamp: '2026-05-10T09:00:00Z' },
      { type: 'blood_pressure_systolic', source: 'withings', value: 'x', timestamp: '2026-05-10T10:00:00Z' },
      { type: 'blood_pressure_systolic', source: 'withings', value: 140, timestamp: 'not a date' },
    ], london);
    expect(out).toEqual({
      blood_pressure_systolic: { '2026-05-10': { withings: 130 } },
      blood_pressure_diastolic: { '2026-05-10': { withings: 85 } },
    });
  });

  it('pairs halves stamped a few ms apart, as healthsync writes them', () => {
    const out = latestBpReadings([
      { type: 'blood_pressure_systolic', source: 'healthsync', value: 103, timestamp: '2026-08-24T07:10:00.001Z' },
      { type: 'blood_pressure_diastolic', source: 'healthsync', value: 68, timestamp: '2026-08-24T07:10:00.009Z' },
      { type: 'blood_pressure_diastolic', source: 'healthsync', value: 66, timestamp: '2026-08-24T19:00:00.003Z' },
      { type: 'blood_pressure_systolic', source: 'healthsync', value: 101, timestamp: '2026-08-24T19:00:00.000Z' },
    ], london);
    expect(out.blood_pressure_systolic['2026-08-24'].healthsync).toBe(101);
    expect(out.blood_pressure_diastolic['2026-08-24'].healthsync).toBe(66);
  });

  it('halves more than 2 s apart are different readings', () => {
    const out = latestBpReadings([
      ...reading('withings', '2026-05-10T08:00:00Z', 130, 85),
      { type: 'blood_pressure_systolic', source: 'withings', value: 140, timestamp: '2026-05-10T09:00:00Z' },
      { type: 'blood_pressure_diastolic', source: 'withings', value: 90, timestamp: '2026-05-10T09:00:03Z' },
    ], london);
    expect(out.blood_pressure_systolic['2026-05-10'].withings).toBe(130);
    expect(out.blood_pressure_diastolic['2026-05-10'].withings).toBe(85);
  });

  it('two systolics inside the window are two readings, not one', () => {
    const out = latestBpReadings([
      { type: 'blood_pressure_systolic', source: 'withings', value: 120, timestamp: '2026-05-10T08:00:00.000Z' },
      { type: 'blood_pressure_systolic', source: 'withings', value: 125, timestamp: '2026-05-10T08:00:00.500Z' },
      { type: 'blood_pressure_diastolic', source: 'withings', value: 80, timestamp: '2026-05-10T08:00:00.600Z' },
    ], london);
    expect(out.blood_pressure_systolic['2026-05-10'].withings).toBe(125);
    expect(out.blood_pressure_diastolic['2026-05-10'].withings).toBe(80);
  });
});
