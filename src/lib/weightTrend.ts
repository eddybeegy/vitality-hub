/**
 * Smoothed weight trend and goal date (roadmap: "Smoothed weight trend and goal date").
 *
 * A single weigh-in moves a kilo with water and salt, so the widget's old "weeks
 * left" (first vs last weigh-in of 30 days) jumped about day to day. This uses:
 *
 * - Trend: an exponential moving average of the daily weights, 10% weight per
 *   day (the Hacker's Diet smoothing). A day with no weigh-in carries the trend
 *   forward unchanged, so gaps don't pull it.
 * - Rate: the least-squares slope of the trend over the last RATE_DAYS days,
 *   in kg per week.
 * - Goal date: today + remaining / rate, only when the trend is moving towards
 *   the goal faster than MIN_RATE_KG_WEEK and the result is under a year away.
 *
 * Day keys come from dailySeries() (bare YYYY-MM-DD in the user's zone); all
 * day arithmetic is Date.UTC on those keys via addDays().
 */
import { dailySeries } from './baselines';
import { addDays } from './dayTags';
import { linearFit } from './tdee';

export const ALPHA = 0.1;
export const RATE_DAYS = 28;
export const MIN_RATE_KG_WEEK = 0.05;
const MAX_PROJECTION_DAYS = 365;

export interface TrendPoint {
  day: string;
  /** The weigh-in that day, null on a day without one. */
  weight: number | null;
  trend: number;
}

export interface WeightTrend {
  points: TrendPoint[];
  trend: number;
  /** kg per week, negative when losing. */
  ratePerWeek: number;
}

export interface GoalProjection {
  remaining: number;
  /** YYYY-MM-DD, or null when the trend is flat, going the wrong way, or too slow. */
  goalDate: string | null;
  weeks: number | null;
  /** 0-100 from the first trend value in the series to the goal. */
  progress: number;
  reached: boolean;
}

const dayNum = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** The trend over every day from the first weigh-in to `today`. null with no weigh-in. */
export function weightTrend(metrics: { type: string; value: number; timestamp: string }[], today: string, timezone = 'UTC'): WeightTrend | null {
  const daily = dailySeries(metrics, 'weight', timezone).filter(p => p.day <= today);
  if (daily.length === 0) return null;
  const byDay = new Map(daily.map(p => [p.day, p.value]));

  const points: TrendPoint[] = [];
  let trend = daily[0].value;
  for (let day = daily[0].day; day <= today; day = addDays(day, 1)) {
    const w = byDay.get(day) ?? null;
    if (w != null) trend += (w - trend) * ALPHA;
    points.push({ day, weight: w, trend });
  }

  const recent = points.slice(-RATE_DAYS);
  const ratePerWeek = recent.length >= 2
    ? linearFit(recent.map(p => [dayNum(p.day), p.trend] as [number, number]), dayNum(today)).slope * 7
    : 0;
  return { points, trend, ratePerWeek };
}

export function projectGoal(t: WeightTrend, goal: number, today: string): GoalProjection {
  const remaining = t.trend - goal;
  const start = t.points[0].trend;
  const total = start - goal;
  const progress = total === 0 ? 100 : Math.max(0, Math.min(100, ((start - t.trend) / total) * 100));
  const reached = Math.abs(remaining) < 0.1;
  const towards = (remaining > 0 && t.ratePerWeek < -MIN_RATE_KG_WEEK) || (remaining < 0 && t.ratePerWeek > MIN_RATE_KG_WEEK);
  if (reached || !towards) return { remaining, goalDate: null, weeks: null, progress, reached };

  const days = Math.ceil(Math.abs(remaining / (t.ratePerWeek / 7)));
  if (days > MAX_PROJECTION_DAYS) return { remaining, goalDate: null, weeks: null, progress, reached };
  return { remaining, goalDate: addDays(today, days), weeks: days / 7, progress, reached };
}
