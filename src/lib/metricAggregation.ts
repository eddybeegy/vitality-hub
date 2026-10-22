/**
 * Daily roll-up of metric rows, shared by the MCP tools.
 *
 * The rule a caller gets wrong on its own: some metric types are DAILY TOTALS
 * (steps, calories in/out, every nutrient, the sleep stages) and some are
 * READINGS (weight, resting HR, HRV, blood pressure). Summing a reading gives
 * nonsense -- three weigh-ins would read as 240 kg -- and averaging a total
 * under-reports a day that arrived in hourly chunks, which is exactly how
 * Health Auto Export sends steps and energy.
 *
 * The sleep shift is also load-bearing: a `sleep*` row timestamped 02:40 belongs
 * to the night that STARTED the previous evening, so sleep types are moved back
 * 12 h before the day is taken. Nothing else is shifted. `bedtime`/`wake_time`
 * are not `sleep*` and must never reach here anyway (their value is an offset
 * from the row's own timestamp, not a quantity) -- see src/lib/sleepTiming.ts.
 *
 * These lists mirror the ones inlined in server.ts's AI-context and summary
 * paths. They were copied rather than hoisted on purpose: this file is only read
 * by the MCP server, and rewiring three live endpoints to a new import is a
 * change with its own blast radius. If a type is added to one, add it to both.
 */

export const NUTRITION_METRICS = [
  'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium',
  'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e',
  'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water',
  'biotin', 'caffeine', 'cholesterol', 'copper', 'folate', 'niacin', 'iodine',
  'fat_monounsaturated', 'fat_polyunsaturated', 'fat_saturated', 'riboflavin',
  'phosphorus', 'manganese', 'thiamin', 'selenium', 'pantothenic_acid',
] as const;

export const SUMMED_METRICS = [
  'steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time',
  // 'sleep_total' is this schema's nightly total; 'sleep' is kept because the
  // server.ts lists this mirrors still name it.
  'sleep', 'sleep_total', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake',
  'time_in_daylight', 'walking_running_distance',
] as const;

const SUMMED = new Set<string>([...NUTRITION_METRICS, ...SUMMED_METRICS]);

/** True when a day's value for `type` is the sum of its rows, not their mean. */
export const isSummedMetric = (type: string): boolean => SUMMED.has(type);

export interface MetricRow {
  type: string;
  value: number | string;
  timestamp: string | Date;
  source?: string;
  unit?: string | null;
}

export interface DailyRow {
  date: string;
  [type: string]: number | string;
}

const toDate = (ts: string | Date): Date => {
  if (ts instanceof Date) return new Date(ts.getTime());
  const s = String(ts);
  // A naive 'YYYY-MM-DD HH:MM:SS' from sqlite is UTC (in-app ingest writes UTC).
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(hasZone ? s : s.replace(' ', 'T') + 'Z');
};

/**
 * Roll `metrics` up to one object per local day, newest day first. Rows whose
 * timestamp will not parse are skipped rather than landing on an "Invalid Date"
 * key.
 */
export function aggregateDailyValues(metrics: MetricRow[], timezone?: string): DailyRow[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const grouped: Record<string, Record<string, { sum: number; count: number }>> = {};

  for (const m of metrics) {
    const value = Number(m.value);
    if (!Number.isFinite(value)) continue;
    const at = toDate(m.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    if (m.type.startsWith('sleep')) at.setHours(at.getHours() - 12);

    let date: string;
    try {
      date = formatter.format(at);
    } catch {
      date = at.toISOString().slice(0, 10);
    }

    const day = (grouped[date] ||= {});
    const cell = (day[m.type] ||= { sum: 0, count: 0 });
    cell.sum += value;
    cell.count += 1;
  }

  return Object.entries(grouped)
    .map(([date, types]) => {
      const row: DailyRow = { date };
      for (const [type, { sum, count }] of Object.entries(types)) {
        row[type] = isSummedMetric(type) ? sum : sum / count;
      }
      return row;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
