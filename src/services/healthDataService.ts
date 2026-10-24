import { formatDateWithTimezone } from '../lib/utils';
import { METRIC_MAP } from '../constants';

export type HealthDataSource = 'apple_health' | 'hevy' | 'withings' | 'cronometer' | 'fitbit' | 'strava' | 'manual' | 'unknown';

const SOURCE_PRIORITY: Record<HealthDataSource, number> = {
  hevy: 12,
  apple_health: 10,
  strava: 9,
  fitbit: 8,
  withings: 6,
  cronometer: 5,
  manual: 4,
  unknown: 0
};

import { parseUTCDate } from '../lib/utils';

export interface StandardizedMetric {
  type: string;
  value: number;
  unit: string;
  timestamp: string;
  date: string;
  source: HealthDataSource;
  originalName?: string;
}

export interface StandardizedWorkout {
  id: string | number;
  name: string;
  duration: number; // minutes
  timestamp: string;
  source: HealthDataSource;
  volume?: number;
  calories?: number;
  /** Whole-workout distance and average HR (Apple workouts), for cardio trends. */
  distance?: number | null;
  distanceUnit?: string | null;
  avgHeartRate?: number | null;
  /** Hevy routine this session was logged against, when it was linked to one. */
  routineExternalId?: string | null;
  exercises: StandardizedExercise[];
}

export interface StandardizedExercise {
  id: string | number;
  title: string;
  type: 'strength' | 'cardio' | 'bodyweight' | 'unknown';
  primaryMuscleGroup?: string;
  secondaryMuscleGroups?: string[];
  sets: StandardizedSet[];
}

export interface StandardizedSet {
  index: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  calories?: number;
  heartRate?: number;
  /** Hevy set type: 'normal', 'warmup', 'dropset' or 'failure'. */
  type?: string;
}

/**
 * Maps external metric names to internal standardized keys
 */
export const mapMetricName = (name: string): string => {
  const normalized = name.toLowerCase().replace(/\s+/g, '_');
  return METRIC_MAP[normalized] || METRIC_MAP[name] || normalized;
};

export const standardizeMetric = (m: any): StandardizedMetric => {
  const type = mapMetricName(m.type || m.name);
  const ts = m.timestamp || m.date || new Date().toISOString();
  return {
    type,
    value: Number(m.value),
    unit: m.unit || '',
    timestamp: ts,
    date: ts.includes('T') ? ts.split('T')[0] : ts,
    source: (m.source as HealthDataSource) || 'unknown',
    originalName: m.type || m.name
  };
};

export const standardizeMetrics = (metrics: any[]): StandardizedMetric[] => {
  const standardized = metrics.map(standardizeMetric);
  return deduplicateMetrics(standardized);
};

/**
 * Deduplicates metrics based on type, value, and timestamp proximity.
 * If duplicates are found, the source with higher priority is kept.
 */
export const deduplicateMetrics = (metrics: StandardizedMetric[]): StandardizedMetric[] => {
  const result: StandardizedMetric[] = [];
  const buckets: Record<string, StandardizedMetric[]> = {};

  metrics.forEach(m => {
    // Create a bucket key based on type and a 2-minute time window to catch slight sync drifts
    const ts = parseUTCDate(m.timestamp).getTime();
    const bucketSize = 120000; // 2 minutes
    const bucketIndex = Math.floor(ts / bucketSize);
    const key = `${m.type}_${bucketIndex}`;

    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(m);
  });

  Object.values(buckets).forEach(bucket => {
    if (bucket.length === 1) {
      result.push(bucket[0]);
    } else {
      // Find metrics that are very similar in value (within 1%)
      const uniqueByValue: StandardizedMetric[] = [];
      
      bucket.forEach(m => {
        const duplicate = uniqueByValue.find(existing => {
          const valDiff = Math.abs(existing.value - m.value);
          const valThreshold = Math.max(existing.value, m.value) * 0.01;
          return valDiff <= valThreshold;
        });

        if (duplicate) {
          // If duplicate found, keep the one with higher source priority
          if (SOURCE_PRIORITY[m.source] > SOURCE_PRIORITY[duplicate.source]) {
            const idx = uniqueByValue.indexOf(duplicate);
            uniqueByValue[idx] = m;
          }
        } else {
          uniqueByValue.push(m);
        }
      });
      
      result.push(...uniqueByValue);
    }
  });

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
};

export const standardizeWorkout = (w: any, exercises: any[] = [], sets: any[] = []): StandardizedWorkout => {
  const workoutExercises = exercises
    .filter(ex => String(ex.workout_id) === String(w.id))
    .map(ex => ({
      id: ex.id,
      title: ex.exercise_title,
      type: ex.exercise_type as any || 'strength',
      primaryMuscleGroup: ex.primary_muscle_group || undefined,
      secondaryMuscleGroups: ex.secondary_muscle_groups ? String(ex.secondary_muscle_groups).split(',').filter(Boolean) : undefined,
      sets: sets
        .filter(s => String(s.exercise_id) === String(ex.id))
        .map(s => ({
          index: s.set_index,
          reps: s.reps,
          weight: s.weight,
          distance: s.distance,
          time: s.time,
          calories: s.calories,
          heartRate: s.avg_hr,
          type: s.type ?? undefined
        }))
    }));

  return {
    id: w.id,
    name: w.name,
    duration: w.duration,
    timestamp: w.timestamp,
    source: (w.source as HealthDataSource) || 'unknown',
    volume: w.volume,
    calories: w.calories,
    distance: w.distance ?? null,
    distanceUnit: w.distance_unit ?? null,
    avgHeartRate: w.heart_rate_avg ?? null,
    // Kept so a progression can be pushed back to the routine it came from
    // (src/lib/progressionPlan.ts) - without it an exercise that appears in
    // two routines has no tiebreak.
    routineExternalId: w.routine_external_id ?? null,
    exercises: workoutExercises
  };
};

export const standardizeWorkouts = (workouts: any[], exercises: any[] = [], sets: any[] = []): StandardizedWorkout[] => {
  const standardized = workouts.map(w => standardizeWorkout(w, exercises, sets));
  return deduplicateWorkouts(standardized);
};

/**
 * Deduplicates workouts based on start time and duration.
 */
export const deduplicateWorkouts = (workouts: StandardizedWorkout[]): StandardizedWorkout[] => {
  const result: StandardizedWorkout[] = [];
  const buckets: Record<string, StandardizedWorkout[]> = {};

  workouts.forEach(w => {
    const ts = parseUTCDate(w.timestamp).getTime();
    const bucketSize = 300000; // 5 minutes window for workout starts
    const bucketIndex = Math.floor(ts / bucketSize);
    const key = `${bucketIndex}_${w.duration}`;

    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(w);
  });

  Object.values(buckets).forEach(bucket => {
    if (bucket.length === 1) {
      result.push(bucket[0]);
    } else {
      // Keep the one with higher source priority
      const sorted = [...bucket].sort((a, b) => 
        (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0)
      );
      result.push(sorted[0]);
    }
  });

  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

export const groupMetricsByType = (metrics: StandardizedMetric[]): Record<string, StandardizedMetric[]> => {
  const grouped: Record<string, StandardizedMetric[]> = {};
  metrics.forEach(m => {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m);
  });
  return grouped;
};

export const getDailyAggregatedData = (
  metrics: StandardizedMetric[],
  type: string,
  aggregation: 'sum' | 'avg' = 'avg',
  timezone: string = 'UTC'
) => {
  const filtered = metrics.filter(m => m.type === type);
  const grouped: Record<string, { sum: number, count: number, unit: string }> = {};

  filtered.forEach(m => {
    const date = formatDateWithTimezone(m.timestamp, timezone).split(',')[0];
    if (!grouped[date]) grouped[date] = { sum: 0, count: 0, unit: m.unit };
    grouped[date].sum += m.value;
    grouped[date].count += 1;
  });

  return Object.entries(grouped).map(([date, data]) => ({
    date,
    [type]: aggregation === 'sum' ? data.sum : data.sum / data.count,
    unit: data.unit
  })).sort((a, b) => a.date.localeCompare(b.date));
};

export const getBloodPressureData = (metrics: StandardizedMetric[]) => {
  const bpTypes = ['blood_pressure_systolic', 'blood_pressure_diastolic'];
  const filtered = metrics.filter(m => bpTypes.includes(m.type));
  const grouped: Record<string, any> = {};
  
  filtered.forEach(m => {
    const ts = m.timestamp;
    if (!grouped[ts]) grouped[ts] = { date: ts };
    const key = m.type === 'blood_pressure_systolic' ? 'systolic' : 'diastolic';
    grouped[ts][key] = m.value;
  });
  
  return Object.values(grouped).sort((a: any, b: any) => a.date.localeCompare(b.date));
};

export const getSleepStagesData = (metrics: StandardizedMetric[], timezone: string = 'UTC') => {
  const sleepTypes = ['sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake'];
  const filtered = metrics.filter(m => sleepTypes.includes(m.type));
  const grouped: Record<string, any> = {};
  
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  filtered.forEach(m => {
    let dateStr = '';
    const d = parseUTCDate(m.timestamp);
    // The backend already shifts sleep by 12 hours and returns a date string (YYYY-MM-DD).
    // If the timestamp is just a date, parseUTCDate returns it at midnight UTC.
    // We don't want to shift it further.
    if (m.timestamp.length > 10) {
      const adjusted = new Date(d.getTime() - (12 * 60 * 60 * 1000));
      dateStr = dayFormatter.format(adjusted);
    } else {
      dateStr = m.timestamp;
    }
    
    if (!grouped[dateStr]) grouped[dateStr] = { date: dateStr };
    const key = m.type.replace('sleep_', '');
    
    // Sum if multiple entries for the same stage in the same day (though usually they are unique)
    const val = Number(m.value) / 3600;
    grouped[dateStr][key] = (grouped[dateStr][key] || 0) + val;
  });
  
  return Object.values(grouped).sort((a: any, b: any) => a.date.localeCompare(b.date));
};

export const getSleepDurationData = (metrics: StandardizedMetric[], timezone: string = 'UTC') => {
  const grouped: Record<string, any> = {};
  
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  metrics.forEach(m => {
    if (!m.type.startsWith('sleep') || !m.timestamp) return;
    if (m.timestamp === 'null' || m.timestamp === 'undefined' || m.timestamp.includes('null')) return;

    let dateStr = '';
    const d = parseUTCDate(m.timestamp);
    if (m.timestamp.length > 10) {
      const adjusted = new Date(d.getTime() - (12 * 60 * 60 * 1000));
      dateStr = dayFormatter.format(adjusted);
    } else {
      dateStr = m.timestamp;
    }
    
    if (!grouped[dateStr]) grouped[dateStr] = { date: dateStr, direct: 0, stages: 0, total: 0 };
    
    const valObj = Number(m.value);
    const val = (m.unit === 's' || m.unit === 'sec' || valObj > 100) ? valObj / 3600 : 
                (m.unit === 'min' || m.unit === 'minutes') ? valObj / 60 : valObj;
                
    // MAX, not +=, for `direct` and `total`. One day bucket is one night, and the
    // rows reaching here are the server's daily roll-ups -- so two entries landing in
    // the same bucket are never two sleeps to add up, they are two REPRESENTATIONS of
    // the same night. /api/data/summary emits both an aggregated `sleep_total` row and
    // a synthetic `sleep` row (server.ts aggregateDailyMetrics' stage reconciliation),
    // and `standardizeMetrics` maps `sleep` -> `sleep_total` via METRIC_MAP, so both
    // arrive here typed `sleep_total` and `+=` summed them. That was hidden for as long
    // as the two agreed: `deduplicateMetrics` drops the second of two same-type values
    // within 1% of each other, and until 2026-10-23 the recorded total always equalled
    // the stage sum exactly. The night of 2026-10-23 was the first to diverge (6.65 h
    // asleep vs a 5.23 h stage breakdown, matching Apple Health's own 6h40m / 5h16m),
    // the 1% guard no longer applied, and the card read 11.9 h -- the two added
    // together. Stages still sum: core/deep/rem are distinct parts of one night.
    if (m.type === 'sleep') grouped[dateStr].direct = Math.max(grouped[dateStr].direct, val);
    else if (['sleep_core', 'sleep_deep', 'sleep_rem'].includes(m.type)) grouped[dateStr].stages += val;
    else if (m.type === 'sleep_total' || m.type === 'sleep_analysis') grouped[dateStr].total = Math.max(grouped[dateStr].total, val);
  });
  
  return Object.values(grouped).map((d: any) => {
    // The stage breakdown (core/deep/rem) can undercount when HealthKit's
    // classification has gaps, so never let it override a larger recorded total.
    const total = d.total > 15 ? 8 : d.total; // sensible capping if total is a massive timeframe
    let hours = Math.max(total, d.direct, d.stages);
    return { date: d.date, hours };
  }).filter((d: any) => d.hours > 0).sort((a: any, b: any) => a.date.localeCompare(b.date));
};
