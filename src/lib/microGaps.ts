/**
 * Weekly micronutrient gaps (roadmap: "Weekly micronutrient gaps").
 *
 * The Micronutrient radar shows today only, and today is half-logged until
 * the evening. This averages the last WEEK_DAYS complete days (yesterday back)
 * and names the nutrients under GAP_PCT of their daily target.
 *
 * Only logged days count: a day with under MIN_LOGGED_KCAL of calories_in is a
 * half-finished log (the same rule as adaptive TDEE) and is left out rather
 * than dragging every nutrient down. Within a logged day a nutrient with no row
 * is 0, since Cronometer omits zero values.
 *
 * Rows are the dashboard summary's day rows (timestamp is a bare YYYY-MM-DD in
 * the user's zone); day arithmetic is addDays() on those keys.
 */
import { addDays } from './dayTags';
import { MIN_LOGGED_KCAL } from './tdee';

export const WEEK_DAYS = 7;
export const GAP_PCT = 70;

/** Daily targets, the same values and units the Micronutrient radar uses. */
export const MICRO_TARGETS: Record<string, number> = {
  vitamin_d: 20, // mcg
  magnesium: 400, // mg
  zinc: 11, // mg
  vitamin_c: 90, // mg
  iron: 14, // mg
  calcium: 1000, // mg
  fiber: 30, // g
};

export const microLabel = (key: string) =>
  key.replace('vitamin_', 'Vit ').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

export interface MicroAverage {
  nutrient: string;
  label: string;
  average: number;
  target: number;
  pct: number;
}

export interface MicroWeek {
  loggedDays: number;
  /** Every tracked nutrient, lowest % first. */
  averages: MicroAverage[];
  /** The ones under GAP_PCT. */
  gaps: MicroAverage[];
}

export function weeklyMicroGaps(
  metrics: { type: string; value: number; timestamp: string }[],
  today: string,
  targets: Record<string, number> = MICRO_TARGETS
): MicroWeek | null {
  const days = new Set(Array.from({ length: WEEK_DAYS }, (_, i) => addDays(today, -(i + 1))));
  const kcal: Record<string, number> = {};
  const totals: Record<string, Record<string, number>> = {};
  for (const m of metrics) {
    const day = String(m.timestamp ?? '').slice(0, 10);
    if (!days.has(day)) continue;
    const v = Number(m.value);
    if (!Number.isFinite(v)) continue;
    if (m.type === 'calories_in') kcal[day] = (kcal[day] || 0) + v;
    if (m.type in targets) {
      totals[day] ??= {};
      totals[day][m.type] = (totals[day][m.type] || 0) + v;
    }
  }

  const logged = [...days].filter(d => (kcal[d] || 0) >= MIN_LOGGED_KCAL);
  if (logged.length === 0) return null;

  const averages = Object.entries(targets)
    .map(([nutrient, target]) => {
      const average = logged.reduce((s, d) => s + (totals[d]?.[nutrient] || 0), 0) / logged.length;
      return { nutrient, label: microLabel(nutrient), average, target, pct: (average / target) * 100 };
    })
    .sort((a, b) => a.pct - b.pct);
  return { loggedDays: logged.length, averages, gaps: averages.filter(a => a.pct < GAP_PCT) };
}
