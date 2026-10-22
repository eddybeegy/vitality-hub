/**
 * Early illness / overreach warning (roadmap: "Early illness and overreach warning").
 *
 * A cold or an overreached training block usually shows in the morning numbers a
 * day or two before it is felt: resting HR climbs, HRV drops, and breathing rate
 * during sleep rises. Each of those moves on its own is ordinary noise, so this
 * only speaks up when they move TOGETHER, against the user's own normal range.
 *
 * - The normal range is personalBaseline() over the 28 days before the CHECK
 *   window (the last CHECK_DAYS days), not before each day, so two bad days in a
 *   row cannot drag the baseline towards themselves and hide the second one.
 * - A day is "off" when at least two of the signals are outside their range in
 *   the bad direction (>= 1 SD), or any one of them is far outside (>= 2 SD).
 * - 'watch' when the latest day is off; 'alert' when the latest day and the day
 *   before it are both off.
 * - Training load decides the likely cause: if the last 7 days' workout minutes
 *   are at least OVERREACH_RATIO times the weekly average of the 28 days before,
 *   it reads as overreach, otherwise as possible illness.
 *
 * Days are calendar days in the user's zone via dailySeries()/metricDay(), so no
 * timestamp is reparsed through the process timezone. A latest reading older
 * than yesterday is stale and produces no warning: an old dip is not news.
 */
import { dailySeries, personalBaseline, metricDay, type DailyValue } from './baselines';
import { addDays } from './dayTags';

export const CHECK_DAYS = 3;
export const OVERREACH_RATIO = 1.3;
const SOFT_Z = 1;
const HARD_Z = 2;

export type WarningLevel = 'none' | 'watch' | 'alert';
export type WarningCause = 'illness' | 'overreach';

interface SignalSpec {
  type: string;
  name: string;
  unit: string;
  /** Which way is bad. */
  bad: 'up' | 'down';
  log: boolean;
}

const SIGNALS: SignalSpec[] = [
  { type: 'resting_heart_rate', name: 'Resting HR', unit: 'bpm', bad: 'up', log: false },
  { type: 'hrv', name: 'HRV', unit: 'ms', bad: 'down', log: true },
  { type: 'respiratory_rate', name: 'Breathing rate', unit: 'br/min', bad: 'up', log: false },
];

export interface SignalReading {
  type: string;
  name: string;
  value: number;
  unit: string;
  /** Standard deviations from the personal mean, signed so that positive = worse. */
  badZ: number;
  low: number;
  high: number;
}

export interface DayCheck {
  day: string;
  /** Signals outside their normal range in the bad direction. */
  off: SignalReading[];
  flagged: boolean;
}

export interface IllnessWarning {
  level: WarningLevel;
  cause: WarningCause | null;
  /** The latest day checked first. */
  days: DayCheck[];
  /** 7-day workout minutes over the prior weekly average, null without history. */
  loadRatio: number | null;
  message: string;
}

interface MetricLike {
  type: string;
  value: number;
  timestamp: string;
}

interface WorkoutLike {
  timestamp: string;
  duration: number;
}

const DAY_FORMAT = (timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Is `day` flagged: two signals off by >= 1 SD, or one by >= 2 SD. */
export function isFlagged(off: SignalReading[]): boolean {
  return off.length >= 2 || off.some(s => s.badZ >= HARD_Z);
}

/**
 * Last-7-days workout minutes against the weekly average of the 28 days before.
 * null when the 28 days hold no workouts (no history to compare with).
 */
export function trainingLoadRatio(workouts: WorkoutLike[], today: string, timezone = 'UTC'): number | null {
  const fmt = DAY_FORMAT(timezone);
  const recentFrom = addDays(today, -6);
  const priorFrom = addDays(today, -34);
  let recent = 0;
  let prior = 0;
  for (const w of workouts) {
    const minutes = Number(w.duration);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const day = metricDay(String(w.timestamp ?? ''), fmt);
    if (!day || day > today) continue;
    if (day >= recentFrom) recent += minutes;
    else if (day >= priorFrom) prior += minutes;
  }
  if (prior <= 0) return null;
  return recent / (prior / 4);
}

function readingFor(spec: SignalSpec, series: DailyValue[], day: string, firstCheckDay: string): SignalReading | null {
  const point = series.find(p => p.day === day);
  if (!point) return null;
  const base = personalBaseline(series, firstCheckDay, { log: spec.log });
  if (!base) return null;
  const x = spec.log ? Math.log(point.value) : point.value;
  const z = (x - base.mu) / base.sd;
  return {
    type: spec.type,
    name: spec.name,
    value: point.value,
    unit: spec.unit,
    badZ: spec.bad === 'up' ? z : -z,
    low: base.low,
    high: base.high,
  };
}

const fmtValue = (s: SignalReading) => `${s.name} ${s.value.toFixed(0)} ${s.unit} (normal ${s.low.toFixed(0)}–${s.high.toFixed(0)})`;

function buildMessage(level: WarningLevel, cause: WarningCause | null, latest: DayCheck | undefined): string {
  if (level === 'none' || !latest) return '';
  const what = latest.off.map(s => s.name.toLowerCase()).join(' and ');
  if (cause === 'overreach') {
    return level === 'alert'
      ? `Two mornings in a row of ${what} outside your normal range after a heavy training week. Looks like overreach: an easy day or a deload is worth it.`
      : `This morning's ${what} is outside your normal range after a heavy training week. Keep today easy and see if it settles tomorrow.`;
  }
  return level === 'alert'
    ? `Two mornings in a row of ${what} outside your normal range without extra training. This pattern often comes a day or two before a cold: consider resting.`
    : `This morning's ${what} is outside your normal range. Could be nothing; worth watching tomorrow.`;
}

/**
 * Check the last CHECK_DAYS days for an illness or overreach pattern.
 * `today` is the user's local calendar day (getLocalDateString(timezone)).
 */
export function checkIllnessWarning(
  metrics: MetricLike[],
  workouts: WorkoutLike[],
  today: string,
  timezone = 'UTC'
): IllnessWarning {
  const series = new Map(SIGNALS.map(s => [s.type, dailySeries(metrics, s.type, timezone)]));

  // The latest day with any core reading (resting HR or HRV), if it is recent.
  const coreDays = ['resting_heart_rate', 'hrv']
    .flatMap(t => series.get(t)!.map(p => p.day))
    .filter(d => d <= today)
    .sort();
  const latestDay = coreDays[coreDays.length - 1];
  const empty: IllnessWarning = { level: 'none', cause: null, days: [], loadRatio: null, message: '' };
  if (!latestDay || latestDay < addDays(today, -1)) return empty;

  const firstCheckDay = addDays(latestDay, -(CHECK_DAYS - 1));
  const days: DayCheck[] = [];
  for (let i = 0; i < CHECK_DAYS; i++) {
    const day = addDays(latestDay, -i);
    const off = SIGNALS
      .map(spec => readingFor(spec, series.get(spec.type)!, day, firstCheckDay))
      .filter((r): r is SignalReading => r !== null && r.badZ >= SOFT_Z)
      .sort((a, b) => b.badZ - a.badZ);
    days.push({ day, off, flagged: isFlagged(off) });
  }

  const level: WarningLevel = days[0].flagged ? (days[1].flagged ? 'alert' : 'watch') : 'none';
  const loadRatio = trainingLoadRatio(workouts, today, timezone);
  const cause: WarningCause | null = level === 'none'
    ? null
    : loadRatio !== null && loadRatio >= OVERREACH_RATIO ? 'overreach' : 'illness';

  return { level, cause, days, loadRatio, message: buildMessage(level, cause, days[0]) };
}

/** One line per off signal on the latest day, for the card's detail list. */
export function describeSignals(w: IllnessWarning): string[] {
  return (w.days[0]?.off ?? []).map(fmtValue);
}
