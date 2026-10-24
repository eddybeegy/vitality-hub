import type { StandardizedMetric } from '../services/healthDataService';
import { metricDay, scoreAgainstBaseline, type Baseline } from './baselines';

export interface ReadinessComponent {
  name: string;
  score: number;
  label: string;
  weight: number;
  /** The user's normal range, for the components scored against one. */
  baseline?: Baseline | null;
}

export interface ReadinessResult {
  score: number;
  components: ReadinessComponent[];
  recommendation: string;
}

// Weights with and without a resting-HR reading. Without one, the score is
// exactly the original HRV/Sleep/Burn mix, so a user with no resting-HR source
// sees no change from adding the component.
const WEIGHTS_WITH_RHR = { hrv: 0.3, rhr: 0.15, sleep: 0.35, burn: 0.2 };
const WEIGHTS_WITHOUT_RHR = { hrv: 0.4, rhr: 0, sleep: 0.4, burn: 0.2 };

/**
 * Calculates current readiness score (0-100) based on HRV and resting HR against
 * the user's own baselines (see baselines.ts), Sleep, and Yesterday's Strain.
 *
 * The one implementation: the dashboard, Smart Adjustments and the server's
 * loadReadinessHistory() (which serves coach and the history) all call this, so they cannot drift.
 */
export function calculateReadinessScore(
  allMetrics: Pick<StandardizedMetric, 'type' | 'value' | 'timestamp'>[],
  targets: any[] = [],
  timezone: string = 'UTC',
  /**
   * Score as of this calendar day (YYYY-MM-DD, user's zone) instead of today:
   * only readings on or before it count and "yesterday" is the day before it.
   * Used to rebuild readiness history (readinessHistory.ts). Omitted = today.
   * Passing today's date gives the same result unless a sleep row is already
   * dated today (a sleep ending after midday), which the live score counts and
   * the as-of score leaves for tomorrow.
   */
  asOf?: string
): ReadinessResult | null {
  if (!allMetrics || allMetrics.length === 0) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // Yesterday, as a calendar day in the user's timezone.
  //
  // This used to be `new Date(new Date().toLocaleString("en-US", {timeZone: tz}))`
  // minus 24h. That formats "now" as *tz* wall-clock and then reparses the
  // result as the **process's** local time, so the instant lands off by
  // (tz offset - process offset). The vitality container runs UTC while this
  // user's timezone is Europe/London, so under BST every local time from
  // 23:00 onwards pushed "yesterday" forward into today: coach scored TODAY's
  // partial activity burn as yesterday's strain (626 kcal vs the correct 331)
  // and so reported readiness 76 against the dashboard's 82. The dashboard
  // only escaped it because the browser's own timezone happened to match the
  // configured one -- any user whose browser TZ differs from their app
  // timezone setting hit the identical bug client-side.
  //
  // Formatting first and doing the arithmetic on the calendar date is immune
  // to both the process timezone and to DST: Date.UTC on a pure Y-M-D is
  // exact, and subtracting one UTC day of a date-only value cannot cross a
  // DST boundary incorrectly because there is no clock time involved.
  // Setting TZ=Europe/London on the container would have masked this for one
  // user and left the bug in place.
  const todayInTz = asOf ?? formatter.format(new Date());
  // As of a past day, keep only what was known that morning. Sleep rows are
  // dated by the night they started (aggregateDailyMetrics shifts sleep back 12h),
  // so the night that ended on the morning of asOf is dated the day before it,
  // and a sleep row dated asOf itself is the *following* night: excluded.
  const metrics = asOf
    ? allMetrics.filter(m => {
        const day = metricDay(String(m.timestamp ?? ''), formatter);
        if (day === null) return false;
        return m.type.startsWith('sleep') ? day < asOf : day <= asOf;
      })
    : allMetrics;
  if (metrics.length === 0) return null;
  const [tzY, tzM, tzD] = todayInTz.split('-').map(Number);
  const yesterday = new Date(Date.UTC(tzY, tzM - 1, tzD) - 86400000).toISOString().slice(0, 10);

  // 1. HRV and resting HR, each against the user's own 28-day normal range.
  const hrv = scoreAgainstBaseline(metrics, 'hrv', { direction: 'higher', unit: 'ms', log: true, timezone });
  const hrvScore = hrv?.score ?? 70; // Baseline default
  const hrvLabel = hrv?.label ?? "No data";
  const rhr = scoreAgainstBaseline(metrics, 'resting_heart_rate', { direction: 'lower', unit: 'bpm', timezone });

  // 2. Sleep Score (Relative to Target or 8h)
  const sleepTarget = targets.find(t => t.type === 'sleep')?.value || 8;
  
  // Find latest sleep record - try types: 'sleep' (direct), or calculate from stages
  // We'll look at the last 3 days of metrics to find the most recent complete sleep record
  const sleepDays: Record<string, { total: number, stages: number, totalRecord: number }> = {};
  
  metrics.forEach(m => {
    if (!m.type.startsWith('sleep')) return;
    if (!m.timestamp || m.timestamp === 'null' || m.timestamp === 'undefined' || m.timestamp.includes('null')) return;
    
    const day = m.timestamp.split('T')[0];
    if (day.length < 10) return;
    
    if (!sleepDays[day]) sleepDays[day] = { total: 0, stages: 0, totalRecord: 0 };
    
    // MAX, not +=, for the two whole-night figures -- same reason as
    // getSleepDurationData: a day bucket is one night, and `sleep` / `sleep_total`
    // are two representations of it (METRIC_MAP folds `sleep` into `sleep_total`
    // client-side), not two sleeps. Summing them is what put 11.9 h on the Sleep
    // Duration card. Stages are genuine parts and still add.
    if (m.type === 'sleep') {
      sleepDays[day].total = Math.max(sleepDays[day].total, m.value);
    } else if (['sleep_core', 'sleep_deep', 'sleep_rem'].includes(m.type)) {
      sleepDays[day].stages += m.value;
    } else if (m.type === 'sleep_total' || m.type === 'sleep_analysis') {
      sleepDays[day].totalRecord = Math.max(sleepDays[day].totalRecord, m.value);
    }
  });

  const sortedDays = Object.keys(sleepDays).sort((a, b) => b.localeCompare(a));
  
  let sleepScore = 60;
  let sleepLabel = "No data";

  if (sortedDays.length > 0) {
    const latestDay = sortedDays[0];
    const data = sleepDays[latestDay];
    
    // Priority:
    // 1. Explicit 'sleep' metric (ideal)
    // 2. Sum of stages (very accurate)
    // 3. 'sleep_total' if it's within a reasonable "asleep" range (< 11-12h)
    let actualSleepSeconds = data.total || data.stages;
    
    // If we have neither 'sleep' nor stages, but have sleep_total
    if (actualSleepSeconds === 0 && data.totalRecord > 0) {
      // Use sleep_total as a fallback if it looks like an asleep duration rather than "time in bed"
      // If it's over 12 hours, it's weighted down or capped because it's likely "Time in Bed"
      actualSleepSeconds = data.totalRecord > 43200 ? 28800 : data.totalRecord; 
    }
    
    if (actualSleepSeconds > 0) {
      const hours = actualSleepSeconds / 3600;
      const ratio = hours / sleepTarget;
      sleepScore = Math.min(100, Math.max(0, ratio * 100));
      sleepLabel = `${hours.toFixed(1)}h / ${sleepTarget}h`;
    }
  }

  // 3. Yesterday's Strain (Negative impact)
  const activeEnergyMetrics = metrics
    .filter(m => m.type === 'active_energy');
  
  // Calculate yesterday's total
  const yesterdayEnergy = activeEnergyMetrics
    .filter(m => m.timestamp.includes(yesterday))
    .reduce((acc, m) => acc + m.value, 0);
  
  // Calculate average daily energy for baseline
  const energyByDay: Record<string, number> = {};
  activeEnergyMetrics.forEach(m => {
    const day = m.timestamp.split('T')[0];
    energyByDay[day] = (energyByDay[day] || 0) + m.value;
  });
  const avgEnergy = Object.values(energyByDay).length > 0 
    ? Object.values(energyByDay).reduce((a, b) => a + b, 0) / Object.values(energyByDay).length
    : 500; // Generic baseline

  let strainScore = 90; // Default high (fully rested)
  let strainLabel = "Light burn";

  if (yesterdayEnergy > 0) {
    const strainRatio = yesterdayEnergy / avgEnergy;
    // If you did exactly your average yesterday, you are at 80% readiness (standard fatigue)
    // If you did 2x average, you are at 40% readiness
    strainScore = Math.min(100, Math.max(0, 100 - (strainRatio * 30)));
    strainLabel = `${yesterdayEnergy.toFixed(0)} kcal burned`;
  }

  // Calculate weighted average
  const w = rhr ? WEIGHTS_WITH_RHR : WEIGHTS_WITHOUT_RHR;
  const components: ReadinessComponent[] = [
    { name: 'HRV', score: hrvScore, label: hrvLabel, weight: w.hrv, baseline: hrv?.baseline ?? null },
    ...(rhr ? [{ name: 'Resting HR', score: rhr.score, label: rhr.label, weight: w.rhr, baseline: rhr.baseline }] : []),
    { name: 'Sleep', score: sleepScore, label: sleepLabel, weight: w.sleep },
    { name: 'Activity Burn', score: strainScore, label: strainLabel, weight: w.burn }
  ];

  const totalScore = components.reduce((acc, c) => acc + (c.score * c.weight), 0);
  
  // Recommendations
  let recommendation = "You're primed for peak performance today. Go for it!";
  if (totalScore < 40) recommendation = "Your body is under high stress. Prioritize deep rest today.";
  else if (totalScore < 60) recommendation = "Take it easy today. Focus on light movement and mobility.";
  else if (totalScore < 80) recommendation = "A solid day for steady work. Listen to your body's signals.";

  return {
    score: Math.round(totalScore),
    components,
    recommendation
  };
}
