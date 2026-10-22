/**
 * Cardio trends (roadmap: "Cardio trends").
 *
 * Aerobic fitness shows as covering more ground for the same heart rate. Routes
 * and paces vary too much to compare raw pace, so each run or ride is scored by
 * its efficiency: metres per heartbeat, speed / average HR. Fitter = higher.
 *
 * Only workouts with a distance, a duration and an average HR count, and only
 * at a plausible speed for the sport (which also drops a session whose duration
 * was stored in the wrong unit). The trend is the change between the mean of
 * the first and last TREND_SESSIONS sessions inside the window.
 *
 * The data comes from Apple workouts today (they carry distance and average HR);
 * the Strava module is still a placeholder that stores nothing.
 */
import { metricDay } from './baselines';
import { addDays } from './dayTags';

export const WINDOW_DAYS = 90;
export const TREND_SESSIONS = 3;

export type Sport = 'run' | 'ride' | 'walk';

const SPEED_KMH: Record<Sport, [number, number]> = {
  run: [5, 25],
  ride: [8, 60],
  walk: [2.5, 8],
};

export interface CardioSession {
  day: string;
  sport: Sport;
  km: number;
  minutes: number;
  avgHr: number;
  /** Minutes per km. */
  pace: number;
  /** Metres per heartbeat. */
  efficiency: number;
}

export interface SportTrend {
  sport: Sport;
  sessions: CardioSession[];
  /** Relative change in efficiency, first sessions to last; null under 2 x TREND_SESSIONS. */
  change: number | null;
}

interface WorkoutLike {
  name?: string;
  timestamp: string;
  duration: number;
  distance?: number | null;
  distanceUnit?: string | null;
  avgHeartRate?: number | null;
}

export function sportOf(name: string | undefined): Sport | null {
  const n = (name || '').toLowerCase();
  if (/\b(run|running|jog)/.test(n)) return 'run';
  if (/\b(cycl|ride|bike|biking)/.test(n)) return 'ride';
  if (/\b(walk|walking|hike|hiking)/.test(n)) return 'walk';
  return null;
}

/** Distance in km from a value and its unit; Apple's default unit is metres. */
export function toKm(value: number, unit: string | null | undefined): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const u = (unit || 'm').toLowerCase();
  if (u === 'km') return value;
  if (u === 'mi' || u === 'mile' || u === 'miles') return value * 1.609344;
  if (u === 'm' || u === 'meter' || u === 'metre' || u === 'meters' || u === 'metres') return value / 1000;
  if (u === 'yd' || u === 'yards') return value * 0.0009144;
  return null;
}

export function cardioTrends(workouts: WorkoutLike[], today: string, timezone = 'UTC'): SportTrend[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const bySport: Record<Sport, CardioSession[]> = { run: [], ride: [], walk: [] };

  for (const w of workouts) {
    const sport = sportOf(w.name);
    if (!sport) continue;
    const day = metricDay(String(w.timestamp ?? ''), fmt);
    if (!day || day < from || day > today) continue;
    const km = toKm(Number(w.distance), w.distanceUnit);
    const minutes = Number(w.duration);
    const avgHr = Number(w.avgHeartRate);
    if (km == null || !(minutes > 0) || !(avgHr >= 60 && avgHr <= 220)) continue;
    const kmh = km / (minutes / 60);
    const [lo, hi] = SPEED_KMH[sport];
    if (kmh < lo || kmh > hi) continue;
    bySport[sport].push({
      day,
      sport,
      km,
      minutes,
      avgHr,
      pace: minutes / km,
      efficiency: (km * 1000) / (minutes * avgHr),
    });
  }

  const mean = (xs: CardioSession[]) => xs.reduce((s, x) => s + x.efficiency, 0) / xs.length;
  return (Object.keys(bySport) as Sport[])
    .filter(sport => bySport[sport].length > 0)
    .map(sport => {
      const sessions = bySport[sport].sort((a, b) => a.day.localeCompare(b.day));
      const change = sessions.length >= 2 * TREND_SESSIONS
        ? mean(sessions.slice(-TREND_SESSIONS)) / mean(sessions.slice(0, TREND_SESSIONS)) - 1
        : null;
      return { sport, sessions, change };
    });
}
