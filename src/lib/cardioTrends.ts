/**
 * Cardio trends (roadmap: "Cardio trends").
 *
 * Aerobic fitness shows as covering more ground for the same heart rate. Routes
 * and paces vary too much to compare raw pace, so each session is scored by its
 * efficiency: metres per heartbeat, speed / average HR. Fitter = higher. Where
 * there is no heart rate the card falls back to plain speed, which is a weaker
 * signal but a real one for a fixed-duration protocol (see `basis` below).
 *
 * Sources, and why each needs its own handling (Kieron, 2026-10-22: "Cardio
 * trends should come from apple workouts or Strava or Hevy if I do any on there"):
 *
 * - **Apple workouts** carry whole-workout distance and duration, so the workout
 *   row is the session. `workouts.heart_rate_avg` is NULL on every row any source
 *   has ever written, so the server derives the average from the `heart_rate`
 *   metrics inside each session (src/lib/workoutHeartRate.ts) and ships it in that
 *   field.
 * - **Hevy** logs cardio as an *exercise inside a mixed session*: a 15-minute row
 *   sits in a 41-minute "Rowing & Core" workout. Scoring the workout row would
 *   divide the rowing distance by the whole session including planks and rest --
 *   3190 m in 41 min reads as 4.7 km/h, which is not what was rowed. So a workout
 *   with `type: 'cardio'` exercises is scored from those exercises' own sets
 *   (`distance` in metres, `time` in seconds), and its workout-level distance is
 *   ignored to avoid counting the same effort twice.
 * - **Strava** still stores nothing (the module is a placeholder), so it
 *   contributes no sessions. Nothing here needs changing when it lands: a Strava
 *   workout row with distance, duration and the derived HR is scored like Apple's.
 *
 * The heart rate is averaged over the whole workout, so it only describes a
 * measured effort that fills most of that workout. A 15-minute row inside a
 * 41-minute session gets `efficiency: null` rather than a flattering m/beat
 * computed against an average that includes the core work and the rest between
 * sets -- see HR_COVERAGE.
 *
 * Only sessions with a distance, a duration and a plausible speed for the sport
 * count (the speed band also drops a session whose duration was stored in the
 * wrong unit). The trend is the change between the mean of the first and last
 * TREND_SESSIONS sessions inside the window.
 */
import { metricDay } from './baselines';
import { addDays } from './dayTags';

export const WINDOW_DAYS = 90;
export const TREND_SESSIONS = 3;

/**
 * How much of a workout's duration the measured effort must cover before the
 * workout's average HR is treated as that effort's average HR. A 15-minute row in
 * a 41-minute session is 0.37 and so is scored on speed, not metres per heartbeat.
 */
export const HR_COVERAGE = 0.9;

export type Sport = 'run' | 'ride' | 'walk' | 'row';

/** What `change` and the headline number are measured in. */
export type TrendBasis = 'efficiency' | 'speed';

const SPEED_KMH: Record<Sport, [number, number]> = {
  run: [5, 25],
  ride: [8, 60],
  walk: [2.5, 8],
  // An ergometer at a sane rate: ~1500 m in 15 min at the slow end, a sprint
  // split at the top. Wider than it looks because `time` excludes the rests.
  row: [4, 20],
};

export interface CardioSession {
  day: string;
  sport: Sport;
  km: number;
  minutes: number;
  /** Null when no plausible average HR was available for this effort. */
  avgHr: number | null;
  /** Minutes per km. */
  pace: number;
  /** Km per hour. */
  speedKmh: number;
  /** Metres per heartbeat; null unless the HR covers this effort (HR_COVERAGE). */
  efficiency: number | null;
  /** Whether the distance and time came from the workout row or a cardio exercise. */
  from: 'workout' | 'exercise';
  /** The exercise that was measured, when `from` is 'exercise'. */
  title?: string;
}

export interface SportTrend {
  sport: Sport;
  sessions: CardioSession[];
  /** Relative change in the basis metric, first sessions to last; null under 2 x TREND_SESSIONS. */
  change: number | null;
  /** Which metric `change` and the card's headline describe. */
  basis: TrendBasis;
}

interface SetLike {
  distance?: number | null;
  time?: number | null;
}

interface ExerciseLike {
  title?: string;
  type?: string;
  sets?: SetLike[];
}

interface WorkoutLike {
  name?: string;
  timestamp: string;
  duration: number;
  distance?: number | null;
  distanceUnit?: string | null;
  avgHeartRate?: number | null;
  exercises?: ExerciseLike[];
}

export function sportOf(name: string | undefined): Sport | null {
  const n = (name || '').toLowerCase();
  if (/\b(run|running|jog|treadmill)/.test(n)) return 'run';
  if (/\b(cycl|ride|bike|biking|spin)/.test(n)) return 'ride';
  if (/\b(walk|walking|hike|hiking)/.test(n)) return 'walk';
  if (/\b(row|rowing|rower|erg)/.test(n)) return 'row';
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

interface RawEffort {
  sport: Sport;
  km: number;
  minutes: number;
  from: 'workout' | 'exercise';
  title?: string;
}

/**
 * The cardio efforts in one workout. A workout with cardio exercises is described
 * by those exercises; only a workout without them falls back to its own distance
 * and duration, so the same metres are never counted twice. Efforts of the same
 * sport in one session are merged (a row split over two blocks is one row).
 */
export function effortsOf(w: WorkoutLike): RawEffort[] {
  const bySport = new Map<Sport, RawEffort>();
  for (const ex of w.exercises || []) {
    if (ex.type !== 'cardio') continue;
    const sport = sportOf(ex.title);
    if (!sport) continue;
    let metres = 0;
    let seconds = 0;
    for (const s of ex.sets || []) {
      metres += Number(s.distance) > 0 ? Number(s.distance) : 0;
      seconds += Number(s.time) > 0 ? Number(s.time) : 0;
    }
    if (!(metres > 0) || !(seconds > 0)) continue;
    const prev = bySport.get(sport);
    if (prev) {
      prev.km += metres / 1000;
      prev.minutes += seconds / 60;
    } else {
      bySport.set(sport, { sport, km: metres / 1000, minutes: seconds / 60, from: 'exercise', title: ex.title });
    }
  }
  if (bySport.size > 0) return [...bySport.values()];

  const sport = sportOf(w.name);
  if (!sport) return [];
  const km = toKm(Number(w.distance), w.distanceUnit);
  const minutes = Number(w.duration);
  if (km == null || !(minutes > 0)) return [];
  return [{ sport, km, minutes, from: 'workout' }];
}

export function cardioTrends(workouts: WorkoutLike[], today: string, timezone = 'UTC'): SportTrend[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const bySport: Record<Sport, CardioSession[]> = { run: [], ride: [], walk: [], row: [] };

  for (const w of workouts) {
    const day = metricDay(String(w.timestamp ?? ''), fmt);
    if (!day || day < from || day > today) continue;
    const workoutMinutes = Number(w.duration);
    const hr = Number(w.avgHeartRate);
    const hrOk = hr >= 60 && hr <= 220;

    for (const effort of effortsOf(w)) {
      const { sport, km, minutes } = effort;
      const speedKmh = km / (minutes / 60);
      const [lo, hi] = SPEED_KMH[sport];
      if (!(speedKmh >= lo && speedKmh <= hi)) continue;
      // The HR is the whole workout's, so it only describes an effort that fills it.
      const covers = !(workoutMinutes > 0) || minutes / workoutMinutes >= HR_COVERAGE;
      bySport[sport].push({
        day,
        sport,
        km,
        minutes,
        avgHr: hrOk ? hr : null,
        pace: minutes / km,
        speedKmh,
        efficiency: hrOk && covers ? (km * 1000) / (minutes * hr) : null,
        from: effort.from,
        title: effort.title,
      });
    }
  }

  return (Object.keys(bySport) as Sport[])
    .filter(sport => bySport[sport].length > 0)
    .map(sport => {
      const all = bySport[sport].sort((a, b) => a.day.localeCompare(b.day));
      // Prefer metres per heartbeat, but not at the cost of the trend itself: an
      // HR-less session is dropped only while enough scored ones remain to compare.
      const scored = all.filter(s => s.efficiency != null);
      const useEfficiency = scored.length === all.length || scored.length >= 2 * TREND_SESSIONS;
      const sessions = useEfficiency ? scored : all;
      const basis: TrendBasis = useEfficiency ? 'efficiency' : 'speed';
      const value = (s: CardioSession) => (basis === 'efficiency' ? (s.efficiency as number) : s.speedKmh);
      const mean = (xs: CardioSession[]) => xs.reduce((t, x) => t + value(x), 0) / xs.length;
      const change = sessions.length >= 2 * TREND_SESSIONS
        ? mean(sessions.slice(-TREND_SESSIONS)) / mean(sessions.slice(0, TREND_SESSIONS)) - 1
        : null;
      return { sport, sessions, change, basis };
    })
    .filter(t => t.sessions.length > 0);
}
