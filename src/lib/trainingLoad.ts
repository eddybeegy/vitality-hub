/**
 * Training load: fitness, fatigue and form (roadmap: "Training load").
 *
 * Daily load is workout minutes from every source (Hevy, Strava, Apple
 * workouts, healthsync), so a long ride and a lifting session land on the same
 * scale. The old Training Status widget used lifted volume (kg x reps) and so
 * saw nothing of cardio.
 *
 * - Fitness (CTL): 42-day exponentially weighted average of daily minutes.
 * - Fatigue (ATL): 7-day exponentially weighted average.
 * - Form (TSB):    fitness - fatigue as of yesterday's close, so today's
 *                  session doesn't make today look worse before it is over.
 * - Ratio (ACWR):  7-day mean / 28-day mean of daily minutes, the number the
 *                  old widget showed, kept with the same zones.
 *
 * Days are calendar days in the user's zone (workout timestamps are UTC for
 * every source; metricDay formats them into the zone). Rest days count as 0.
 */
import { metricDay } from './baselines';
import { addDays } from './dayTags';

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;
/** How far back the EWMAs start; long enough for the 42-day average to settle. */
export const HISTORY_DAYS = 120;

export type LoadZone = 'detraining' | 'optimal' | 'building' | 'high';

export interface LoadPoint {
  day: string;
  minutes: number;
  fitness: number;
  fatigue: number;
}

export interface TrainingLoad {
  series: LoadPoint[];
  fitness: number;
  fatigue: number;
  form: number;
  ratio: number;
  zone: LoadZone;
}

interface WorkoutLike { timestamp: string; duration: number }

export function loadZone(ratio: number): LoadZone {
  if (ratio >= 1.5) return 'high';
  if (ratio >= 1.3) return 'building';
  if (ratio >= 0.8) return 'optimal';
  return 'detraining';
}

/** Workout minutes per day for the `days` days ending `today`, oldest first. */
export function dailyMinutes(workouts: WorkoutLike[], today: string, timezone = 'UTC', days = HISTORY_DAYS): { day: string; minutes: number }[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const from = addDays(today, -(days - 1));
  const byDay: Record<string, number> = {};
  for (const w of workouts) {
    const minutes = Number(w.duration);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const day = metricDay(String(w.timestamp ?? ''), fmt);
    if (!day || day < from || day > today) continue;
    byDay[day] = (byDay[day] || 0) + minutes;
  }
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    return { day, minutes: byDay[day] || 0 };
  });
}

/** null when there is no workout at all in the history window. */
export function computeTrainingLoad(workouts: WorkoutLike[], today: string, timezone = 'UTC'): TrainingLoad | null {
  const daily = dailyMinutes(workouts, today, timezone);
  if (!daily.some(d => d.minutes > 0)) return null;

  const kFit = 1 - Math.exp(-1 / FITNESS_DAYS);
  const kFat = 1 - Math.exp(-1 / FATIGUE_DAYS);
  let fitness = 0;
  let fatigue = 0;
  const series: LoadPoint[] = daily.map(d => {
    fitness += (d.minutes - fitness) * kFit;
    fatigue += (d.minutes - fatigue) * kFat;
    return { day: d.day, minutes: d.minutes, fitness, fatigue };
  });

  const yesterday = series[series.length - 2] ?? series[series.length - 1];
  const mean = (n: number) => daily.slice(-n).reduce((s, d) => s + d.minutes, 0) / n;
  const acute = mean(7);
  const chronic = mean(28);
  const ratio = chronic > 0 ? acute / chronic : acute > 0 ? 2 : 0;
  const last = series[series.length - 1];

  return {
    series,
    fitness: last.fitness,
    fatigue: last.fatigue,
    form: yesterday.fitness - yesterday.fatigue,
    ratio,
    zone: loadZone(ratio),
  };
}
