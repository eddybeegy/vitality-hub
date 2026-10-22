/**
 * Plateau detection and next-step suggestions (roadmap: "Plateau detection and
 * overload suggestions").
 *
 * Builds on the per-session best e1RM from analyseStrength(). For each exercise
 * still being trained, the best e1RM of the last RECENT_DAYS days is compared
 * with the best of the PRIOR_DAYS before that:
 *
 * - progressing: recent best more than GAIN_EPSILON above the prior best
 * - plateau:     within GAIN_EPSILON either way (no real gain in four weeks)
 * - regressing:  more than DROP_THRESHOLD below the prior best
 *
 * An exercise needs MIN_SESSIONS sessions in each window and a session in the
 * last ACTIVE_DAYS, so a lift dropped from the programme or a one-off is never
 * called a plateau. Days are the caller's calendar-day keys (SessionPoint.day),
 * compared as Y-M-D strings with Date.UTC arithmetic via addDays().
 */
import { addDays } from './dayTags';
import type { ExerciseStrength } from './strength';

export const RECENT_DAYS = 28;
export const PRIOR_DAYS = 56;
export const ACTIVE_DAYS = 14;
export const MIN_SESSIONS = 2;
export const GAIN_EPSILON = 0.01;
export const DROP_THRESHOLD = 0.05;

export type ProgressStatus = 'progressing' | 'plateau' | 'regressing';

export interface ExerciseProgress {
  title: string;
  status: ProgressStatus;
  recentBest: number;
  priorBest: number;
  /** recentBest / priorBest - 1. */
  change: number;
  recentSessions: number;
  suggestion: string;
}

const SUGGESTIONS: Record<ProgressStatus, string> = {
  progressing: 'Keep the current plan: add a rep or the smallest weight step when every set hits the top of the rep range.',
  plateau: 'Change the stimulus: one lighter week at about 90%, then build back, or move to a new rep range (e.g. 5s instead of 8s).',
  regressing: 'Check recovery first (sleep debt, readiness, weekly sets). Then take a lighter week before pushing again.',
};

export function classifyProgress(
  exercises: ExerciseStrength[],
  today: string
): ExerciseProgress[] {
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));
  const priorFrom = addDays(recentFrom, -PRIOR_DAYS);
  const activeFrom = addDays(today, -(ACTIVE_DAYS - 1));
  const out: ExerciseProgress[] = [];

  for (const ex of exercises) {
    const points = ex.sessions.filter(s => s.e1rm != null && s.day <= today);
    const recent = points.filter(s => s.day >= recentFrom);
    const prior = points.filter(s => s.day >= priorFrom && s.day < recentFrom);
    if (recent.length < MIN_SESSIONS || prior.length < MIN_SESSIONS) continue;
    if (!recent.some(s => s.day >= activeFrom)) continue;

    const recentBest = Math.max(...recent.map(s => s.e1rm as number));
    const priorBest = Math.max(...prior.map(s => s.e1rm as number));
    const change = recentBest / priorBest - 1;
    const status: ProgressStatus = change > GAIN_EPSILON ? 'progressing' : change < -DROP_THRESHOLD ? 'regressing' : 'plateau';
    out.push({ title: ex.title, status, recentBest, priorBest, change, recentSessions: recent.length, suggestion: SUGGESTIONS[status] });
  }

  const order: Record<ProgressStatus, number> = { regressing: 0, plateau: 1, progressing: 2 };
  return out.sort((a, b) => order[a.status] - order[b.status] || a.change - b.change || a.title.localeCompare(b.title));
}
