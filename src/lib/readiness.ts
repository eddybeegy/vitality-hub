import { StandardizedMetric } from '../services/healthDataService';
import { parseUTCDate, getLocalDateString } from './utils';

export interface ReadinessComponent {
  name: string;
  score: number;
  label: string;
  weight: number;
}

export interface ReadinessResult {
  score: number;
  components: ReadinessComponent[];
  recommendation: string;
}

/**
 * Calculates current readiness score (0-100) based on HRV, Sleep, and Yesterday's Strain.
 */
export function calculateReadinessScore(
  metrics: StandardizedMetric[], 
  targets: any[] = [], 
  timezone: string = 'UTC'
): ReadinessResult | null {
  if (!metrics || metrics.length === 0) return null;

  const today = getLocalDateString(timezone);
  
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
  const todayInTz = formatter.format(new Date());
  const [tzY, tzM, tzD] = todayInTz.split('-').map(Number);
  const yesterday = new Date(Date.UTC(tzY, tzM - 1, tzD) - 86400000).toISOString().slice(0, 10);

  // 1. HRV Score (Relative to 7-day baseline)
  const hrvMetrics = metrics
    .filter(m => m.type === 'hrv')
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  
  let hrvScore = 70; // Baseline default
  let hrvLabel = "No data";
  
  if (hrvMetrics.length > 0) {
    const latestHrv = hrvMetrics[0].value;
    const baselineHrvs = hrvMetrics.slice(1, 8); // Last 7 days baseline
    if (baselineHrvs.length > 0) {
      const avgBaseline = baselineHrvs.reduce((acc, m) => acc + m.value, 0) / baselineHrvs.length;
      const ratio = latestHrv / avgBaseline;
      // 1.0 ratio = 85 points. Above 1.0 = bonus. Below 0.7 = crash.
      hrvScore = Math.min(100, Math.max(0, ratio * 85));
      hrvLabel = `${latestHrv.toFixed(0)}ms (${ratio > 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%)`;
    } else {
      hrvScore = 80; // Not enough data for baseline, assume good if measurement exists
      hrvLabel = `${latestHrv.toFixed(0)}ms (No baseline)`;
    }
  }

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
    
    if (m.type === 'sleep') {
      sleepDays[day].total += m.value;
    } else if (['sleep_core', 'sleep_deep', 'sleep_rem'].includes(m.type)) {
      sleepDays[day].stages += m.value;
    } else if (m.type === 'sleep_total' || m.type === 'sleep_analysis') {
      sleepDays[day].totalRecord += m.value;
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
  const components: ReadinessComponent[] = [
    { name: 'HRV', score: hrvScore, label: hrvLabel, weight: 0.4 },
    { name: 'Sleep', score: sleepScore, label: sleepLabel, weight: 0.4 },
    { name: 'Activity Burn', score: strainScore, label: strainLabel, weight: 0.2 }
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
