import React, { useState, useMemo, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Legend, AreaChart, Area, ReferenceLine 
} from 'recharts';
import { ChartSkeleton } from './ui/Skeleton';
import { SyncStatus } from './SyncStatus';
import { cn, parseUTCDate } from '../lib/utils';

interface ReferenceLineProps {
  value: number;
  label: string;
  color?: string;
}

interface ChartProps {
  data?: any[];
  url?: string;
  title: string;
  dataKey: string;
  name?: string;
  stackKeys?: { key: string, color: string, name: string }[];
  color?: string;
  type?: 'line' | 'bar' | 'area' | 'rangeBar';
  rangeKeys?: [string, string];
  unit?: string;
  preferredUnits?: string;
  aggregation?: 'sum' | 'avg' | 'max' | 'min';
  sumStackInLatest?: boolean;
  variant?: 'default' | 'mini';
  referenceLines?: ReferenceLineProps[];
  barSize?: number;
  defaultPeriod?: Period;
  defaultGranularity?: Granularity;
  timezone?: string;
  loading?: boolean;
  sourceName?: string;
  lastSyncStr?: string | null;
}

type Granularity = 'day' | 'week' | 'month';
type Period = '1d' | '7d' | '30d' | '90d' | '1y' | 'all';

export const HealthChart = ({ 
  data, url, title, dataKey, name, stackKeys, rangeKeys, color = "#10b981", type = 'line', unit = "", preferredUnits = "metric", aggregation = 'avg', sumStackInLatest = true, variant = 'default', referenceLines, barSize, defaultPeriod, defaultGranularity, timezone, loading: externalLoading, sourceName, lastSyncStr
}: ChartProps) => {
  const [granularity, setGranularity] = useState<Granularity>(defaultGranularity || 'day');
  const [period, setPeriod] = useState<Period>(defaultPeriod || (variant === 'mini' ? '7d' : '90d'));
  const [fetchedData, setFetchedData] = useState<any[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = externalLoading || internalLoading;

  // Sync with default props only once when they first become available
  const [hasInitializedFromProps, setHasInitializedFromProps] = useState(false);

  useEffect(() => {
    if ((defaultGranularity || defaultPeriod) && !hasInitializedFromProps) {
      if (defaultGranularity) setGranularity(defaultGranularity);
      if (defaultPeriod) setPeriod(defaultPeriod);
      setHasInitializedFromProps(true);
    }
  }, [defaultGranularity, defaultPeriod, hasInitializedFromProps]);

  useEffect(() => {
    if (url) {
      const fetchData = async () => {
        setFetchedData([]); // Clear old data to show loading state and avoid stale data
        setInternalLoading(true);
        try {
          // Calculate startDate based on period
          const now = new Date();
          let startDate = new Date();
          if (period === '1d') startDate.setDate(now.getDate() - 1);
          else if (period === '7d') startDate.setDate(now.getDate() - 7);
          else if (period === '30d') startDate.setDate(now.getDate() - 30);
          else if (period === '90d') startDate.setDate(now.getDate() - 90);
          else if (period === '1y') startDate.setFullYear(now.getFullYear() - 1);
          else startDate.setFullYear(now.getFullYear() - 10); // All time

          // Always request DAY granularity, regardless of the toggle. The server applies
          // `aggregation` to collapse intraday samples into a day -- that is stage one and
          // it is correct. Asking it for week/month made it apply the SAME aggregation a
          // second time to collapse days into the coarser bucket, which for
          // `aggregation="sum"` produced a weekly/monthly TOTAL still labelled with the
          // daily unit ("80.5 hrs" of sleep for a month). It also destroyed the per-day
          // values this component needs to do stage two itself. The day->week/month
          // collapse now happens in `processedData` below. See sweep item 9.
          const response = await fetch(`${url}&granularity=day&aggregation=${aggregation}&startDate=${startDate.toISOString()}`);
          const result = await response.json();
          setFetchedData(result);
        } catch (error) {
          console.error("Failed to fetch aggregated data:", error);
        } finally {
          setInternalLoading(false);
        }
      };
      fetchData();
    }
    // `granularity` is deliberately NOT a dependency any more: the request is always
    // day-granularity, so toggling DAY/WEEK/MONTH re-buckets the data we already have
    // instead of refetching identical rows.
  }, [url, aggregation, period]);

  const isMini = variant === 'mini';
  const isWeightBased = dataKey === 'weight' || dataKey === 'muscle_mass' || dataKey === 'bone_mass' || dataKey === 'lean_body_mass' || dataKey === 'fat_mass';

  const processedData = useMemo(() => {
    let chartData = url ? fetchedData : data;
    if (!chartData || chartData.length === 0) return [];
    
    const weightKeys = ['weight', 'muscle_mass', 'bone_mass', 'lean_body_mass', 'fat_mass'];
    const distanceKeys = ['distance', 'walking_running_distance'];
    const heightKeys = ['height'];

    // Convert units if necessary
    if (preferredUnits === 'imperial' || preferredUnits === 'stone') {
      chartData = chartData.map(d => {
        const newD = { ...d };
        
        // Convert all weight-based fields found in the object
        Object.keys(newD).forEach(key => {
          if (weightKeys.includes(key)) {
            newD[key] = Number(newD[key]) * 2.20462;
          }
          if (distanceKeys.includes(key)) {
            newD[key] = Number(newD[key]) * 0.000621371; // m to mi
          }
          if (heightKeys.includes(key)) {
            newD[key] = Number(newD[key]) * 39.3701; // m to in
          }
        });
        
        return newD;
      });
    }

    // Filter by period (even for URL data, as a fallback/extra safety)
    const now = new Date();
    const cutoff = new Date();
    if (period === '1d') cutoff.setDate(now.getDate() - 1);
    else if (period === '7d') cutoff.setDate(now.getDate() - 7);
    else if (period === '30d') cutoff.setDate(now.getDate() - 30);
    else if (period === '90d') cutoff.setDate(now.getDate() - 90);
    else if (period === '1y') cutoff.setDate(now.getDate() - 365);
    else cutoff.setFullYear(now.getFullYear() - 10); // 'all' - last 10 years

    // For date-only strings (YYYY-MM-DD), we should compare against a date-only cutoff
    // to avoid timezone shifts hiding data from the start of the period
    const cutoffDateOnly = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(cutoff);

    // NO early return for `url` data any more. This used to be:
    //   if (url) return chartData.filter(byPeriod).sort(byDate);
    // i.e. server-fetched rows skipped the client-side grouping below entirely, and the
    // DAY/WEEK/MONTH toggle only had an effect because it was passed to the server in the
    // request (`&granularity=${granularity}`) -- which is the double-aggregation bug of
    // sweep item 9. Now that the request is pinned to `granularity=day`, keeping this
    // early return would leave every url-backed chart (Active Energy, Calorie Intake, all
    // of ActivityTab) permanently stuck on day buckets with the toggle doing nothing.
    // So url rows fall through to the same stage-two grouping as `data` rows. The filter
    // and sort below are identical to the ones this block used, so nothing else changes.
    // Rows arrive as one-per-day with a date-only `date`, which the grouping handles via
    // its `isDateOnly` branches.
    // Filter out invalid dates and sort
    const validData = chartData.filter(item => {
      if (!item.date) return false;
      const isDateOnly = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
      if (isDateOnly) return item.date >= cutoffDateOnly;

      const d = new Date(item.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

    const sorted = [...validData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    const grouped: Record<string, { 
      date: string, 
      sums: Record<string, number>, 
      counts: Record<string, number>,
      maxes: Record<string, number>,
      mins: Record<string, number>
    }> = {};
    
    const allKeys = stackKeys ? [dataKey, ...stackKeys.map(s => s.key)] : [dataKey];
    if (type === 'rangeBar' && rangeKeys) {
      if (!allKeys.includes(rangeKeys[0])) allKeys.push(rangeKeys[0]);
      if (!allKeys.includes(rangeKeys[1])) allKeys.push(rangeKeys[1]);
    }

    const dayFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    sorted.forEach(item => {
      const d = parseUTCDate(item.date);
      const isDateOnly = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
      
      let key = "";
      if (granularity === 'day') {
        if (isDateOnly) {
          key = item.date;
        } else {
          try {
            key = dayFormatter.format(d);
          } catch (e) {
            key = d.toISOString().split('T')[0];
          }
        }
      } else if (granularity === 'week') {
        let weekStart: Date;
        if (isDateOnly) {
          // For date-only, treat as UTC to avoid shifts
          weekStart = new Date(item.date + 'T00:00:00Z');
          weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
          key = weekStart.toISOString().split('T')[0];
        } else {
          // For full timestamps, use timezone-aware logic
          // This is tricky because we need the "local" day first
          let localDayStr = "";
          try {
            localDayStr = dayFormatter.format(d);
          } catch (e) {
            localDayStr = d.toISOString().split('T')[0];
          }
          const localDay = new Date(localDayStr + 'T00:00:00Z');
          localDay.setUTCDate(localDay.getUTCDate() - localDay.getUTCDay());
          key = localDay.toISOString().split('T')[0];
        }
      } else {
        if (isDateOnly) {
          key = `${item.date.substring(0, 7)}-01`;
        } else {
          let localDayStr = "";
          try {
            localDayStr = dayFormatter.format(d);
          } catch (e) {
            localDayStr = d.toISOString().split('T')[0];
          }
          key = `${localDayStr.substring(0, 7)}-01`;
        }
      }

      if (!grouped[key]) {
        grouped[key] = { date: key, sums: {}, counts: {}, maxes: {}, mins: {} };
        allKeys.forEach(k => {
          grouped[key].sums[k] = 0;
          grouped[key].counts[k] = 0;
          grouped[key].maxes[k] = -Infinity;
          grouped[key].mins[k] = Infinity;
        });
      }

      allKeys.forEach(k => {
        const val = Number(item[k]);
        if (!isNaN(val)) {
          grouped[key].sums[k] += val;
          grouped[key].counts[k] += 1;
          if (val > grouped[key].maxes[k]) grouped[key].maxes[k] = val;
          if (val < grouped[key].mins[k]) grouped[key].mins[k] = val;
        }
      });
    });

    return Object.values(grouped)
      .map(g => {
        const result: any = { date: g.date };
        allKeys.forEach(k => {
          if (g.counts[k] > 0) {
            // Stage two. Each `item` fed into `grouped` is one DAY (the server now always
            // returns day granularity), so at `granularity === 'day'` every bucket holds
            // exactly one value and all four branches agree.
            //
            // For coarser buckets, `sum` becomes the MEAN of the daily values, not their
            // total. That is the fix for sweep item 9: a weekly/monthly total carries a
            // different unit from the daily one it is labelled with, and it made the
            // card's "latest" and "avg" incomparable -- "latest" is the current, PARTIAL
            // bucket, so WEEK showed a one-day part-total (6.1 hrs) next to an average of
            // whole-week totals (32.2 hrs). Averaging daily values keeps the unit honest,
            // makes DAY/WEEK/MONTH directly comparable, and makes a partial bucket a
            // valid daily average rather than a meaningless fragment. `max`/`min` stay as
            // the extreme daily value in the bucket, which is already the useful reading.
            let val: number;
            if (aggregation === 'sum') val = granularity === 'day' ? g.sums[k] : g.sums[k] / g.counts[k];
            else if (aggregation === 'max') val = g.maxes[k];
            else if (aggregation === 'min') val = g.mins[k];
            else val = g.sums[k] / g.counts[k];
            
            result[k] = Number(val.toFixed(2));
          }
        });
        if (type === 'rangeBar' && rangeKeys) {
          if (result[rangeKeys[0]] !== undefined && result[rangeKeys[1]] !== undefined) {
            result[dataKey] = [result[rangeKeys[0]], result[rangeKeys[1]]];
          }
        }
        return result;
      })
      .filter(r => Object.keys(r).length > 1);
  }, [data, fetchedData, url, granularity, period, dataKey, stackKeys, rangeKeys, type, aggregation, preferredUnits]);

  const computedReferenceLines = useMemo(() => {
    if (!referenceLines) return undefined;
    if (preferredUnits === 'imperial' || preferredUnits === 'stone') {
      return referenceLines.map(rl => {
        let val = rl.value;
        if (isWeightBased) val *= 2.20462;
        else if (dataKey === 'distance' || dataKey === 'walking_running_distance') val *= 0.000621371;
        else if (dataKey === 'height') val *= 39.3701;
        return { ...rl, value: val };
      });
    }
    return referenceLines;
  }, [referenceLines, preferredUnits, isWeightBased, dataKey]);
  const periodStats = useMemo(() => {
    const stats = { latest: null as number | null, average: null as number | null, latestRange: null as [number, number] | null };
    
    if (!processedData || processedData.length === 0) return stats;

    // The one quantity both headlines report for a bucket, so "latest" and "avg" are
    // always comparable (item 22). For a summed stack (e.g. Sleep Stages) that is the
    // stack total -- the height of the bar -- otherwise it is the primary dataKey.
    const headlineValue = (item: any): number | null => {
      if (stackKeys && stackKeys.length > 0 && sumStackInLatest) {
        let sum = 0;
        let seen = false;
        stackKeys.forEach(s => {
          const v = Number(item[s.key]);
          if (item[s.key] != null && !isNaN(v)) { sum += v; seen = true; }
        });
        // Also add the primary dataKey if it's not already in stackKeys
        if (!stackKeys.find(s => s.key === dataKey)) {
          const v = Number(item[dataKey]);
          if (item[dataKey] != null && !isNaN(v)) { sum += v; seen = true; }
        }
        return seen ? sum : null;
      }
      const val = Number(item[dataKey]);
      return item[dataKey] == null || isNaN(val) ? null : val;
    };

    const lastItem = processedData[processedData.length - 1];
    
    // For latest value, we now favor the aggregated value from processedData
    // This ensures consistency between the "latest" text and the last bar/point in the chart
    if (type === 'rangeBar' && Array.isArray(lastItem[dataKey])) {
      stats.latestRange = [Number(lastItem[dataKey][0]), Number(lastItem[dataKey][1])];
      stats.latest = Number(lastItem[dataKey][1]);
    } else {
      stats.latest = headlineValue(lastItem);
    }

    // Fallback to raw data ONLY if latest is still null (rarely happens if processedData exists)
    if (stats.latest === null) {
      const rawData = url ? fetchedData : data;
      if (rawData && rawData.length > 0) {
        const sortedRaw = [...rawData].sort((a, b) => new Date(a.date || a.timestamp).getTime() - new Date(b.date || b.timestamp).getTime());
        const lastRaw = sortedRaw[sortedRaw.length - 1];
        
        if (type === 'rangeBar' && rangeKeys) {
          if (lastRaw[rangeKeys[0]] !== undefined && lastRaw[rangeKeys[1]] !== undefined) {
            stats.latestRange = [Number(lastRaw[rangeKeys[0]]), Number(lastRaw[rangeKeys[1]])];
            stats.latest = Number(lastRaw[rangeKeys[1]]);
          }
        } else {
          const val = Number(lastRaw[dataKey]);
          stats.latest = isNaN(val) ? null : val;
        }
      }
    }

    let sum = 0;
    let count = 0;
    processedData.forEach(item => {
      const val = type === 'rangeBar' && Array.isArray(item[dataKey]) ? Number(item[dataKey][1]) : headlineValue(item);
      if (val !== null && !isNaN(val)) {
        sum += val;
        count++;
      }
    });
    stats.average = count > 0 ? sum / count : null;
    
    return stats;
  }, [data, fetchedData, url, processedData, dataKey, type, rangeKeys, stackKeys, sumStackInLatest]);

  const safeDateFormatter = (str: string) => {
    const d = parseUTCDate(str);
    if (isNaN(d.getTime())) return "";
    
    try {
      return d.toLocaleDateString(undefined, { 
        timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        month: 'short', 
        day: 'numeric' 
      });
    } catch (e) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  };

  if (loading || internalLoading) {
    return <ChartSkeleton />;
  }

  return (
    <div className={cn(
      "bg-white dark:bg-zinc-900 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col relative",
      isMini ? "p-4 h-[220px]" : "p-6 h-[400px]"
    )}>
      <div className={cn("flex flex-col gap-4", isMini ? "mb-2" : "mb-4")}>
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <h3 className={cn("font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate", isMini ? "text-[10px]" : "text-sm")}>{title}</h3>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={cn("font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate", isMini ? "text-lg" : "text-2xl")}>
                {(() => {
                  if (type === 'rangeBar' && periodStats.latestRange) {
                    return `${periodStats.latestRange[1].toFixed(0)}/${periodStats.latestRange[0].toFixed(0)}`;
                  }
                  if (periodStats.latest === null) return '--';
                  const val = Number(periodStats.latest);
                  
                  if (preferredUnits === 'stone' && isWeightBased) {
                    // val here is in lbs (if we converted it in processedData) OR in kg (if we didn't)
                    // Wait, processedData already converted it to lbs for 'stone' or 'imperial'.
                    // So val is in lbs.
                    const stones = Math.floor(val / 14);
                    const lbs = (val % 14).toFixed(1);
                    return `${stones}st ${lbs}lb`;
                  }

                  if (unit.includes('steps') || unit.includes('kcal') || unit.includes('count')) {
                    return val.toLocaleString();
                  }
                  return val.toFixed(1);
                })()}
              </span>
              <div className="flex flex-col">
                <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                  latest {preferredUnits === 'stone' && isWeightBased ? '' : unit}
                </span>
                <span className="text-[9px] font-medium text-zinc-400/70 dark:text-zinc-500/70">
                  avg: {(() => {
                    if (periodStats.average === null) return '--';
                    const val = Number(periodStats.average);

                    if (preferredUnits === 'stone' && isWeightBased) {
                      const stones = Math.floor(val / 14);
                      const lbs = (val % 14).toFixed(1);
                      return `${stones}st ${lbs}lb`;
                    }

                    if (unit.includes('steps') || unit.includes('kcal') || unit.includes('count')) {
                      return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
                    }
                    return val.toFixed(1);
                  })()} {preferredUnits === 'stone' && isWeightBased ? '' : unit}
                </span>
              </div>
            </div>
          </div>
          {!isMini && (
            <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 shrink-0 w-full sm:w-auto justify-between sm:justify-start">
              <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                {(['day', 'week', 'month'] as Granularity[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-bold uppercase rounded-md transition-all",
                      granularity === g ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {lastSyncStr && (
                <SyncStatus lastSyncStr={lastSyncStr} sourceName={sourceName} className="static" />
              )}
            </div>
          )}
        </div>
        
        {isMini && lastSyncStr && (
          <div className="absolute top-4 right-4">
             <SyncStatus lastSyncStr={lastSyncStr} sourceName={sourceName} className="static" />
          </div>
        )}
        
        {!isMini && (
          <div className="flex justify-end">
            <div className="flex bg-zinc-50 dark:bg-zinc-800/50 p-1 rounded-lg border border-black/5 dark:border-white/5">
              {(['1d', '7d', '30d', '90d', '1y', 'all'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all",
                    period === p ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className={cn("flex-1 w-full relative", isMini ? "h-[120px] min-h-[120px]" : "h-[240px] min-h-[240px]")}>
        {processedData.length === 0 && !loading && !internalLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/50 dark:bg-zinc-800/50 rounded-xl z-10">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No data available for this period</p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%" debounce={50} minWidth={0} minHeight={0}>
          {type === 'line' ? (
            <LineChart data={processedData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 8, fill: 'currentColor' }} 
                className="text-zinc-400 dark:text-zinc-600"
                tickFormatter={safeDateFormatter}
                hide={isMini}
              />
              <YAxis 
                tick={{ fontSize: 8, fill: 'currentColor' }} 
                className="text-zinc-400 dark:text-zinc-600"
                width={35}
                tickFormatter={(val) => {
                  if (preferredUnits === 'stone' && isWeightBased) {
                    return `${Math.round(val / 14)}st`;
                  }
                  return (val || 0).toFixed(1);
                }}
                hide={isMini}
                domain={['dataMin', 'dataMax']}
                allowDataOverflow={false}
                padding={{ top: 20, bottom: 20 }}
              />
              <Tooltip 
                labelFormatter={safeDateFormatter}
                formatter={(val: number, name: string) => {
                  const num = val || 0;
                  if (preferredUnits === 'stone' && isWeightBased) {
                    const stones = Math.floor(num / 14);
                    const lbs = (num % 14).toFixed(1);
                    return [`${stones}st ${lbs}lb`, name];
                  }
                  return [num.toFixed(2) + unit, name];
                }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px', backgroundColor: 'var(--tooltip-bg)', color: 'var(--tooltip-color)' }}
                itemStyle={{ color: 'var(--tooltip-color)' }}
              />
              {!isMini && <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />}
              {/* <ReferenceLine y={periodStats.avg} stroke={color} strokeDasharray="3 3" /> */}
              {computedReferenceLines?.map((rl, i) => (
                <ReferenceLine key={i} y={rl.value} label={{ value: rl.label, position: 'right', fontSize: 8, fill: rl.color || '#999' }} stroke={rl.color || '#999'} strokeDasharray="3 3" />
              ))}
              <Line name={name || title} type="monotone" dataKey={dataKey} stroke={color} strokeWidth={isMini ? 1.5 : 2} dot={true} />
              {stackKeys?.map(s => (
                <Line key={s.key} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={isMini ? 1.5 : 2} dot={true} />
              ))}
            </LineChart>
          ) : type === 'rangeBar' ? (
            <BarChart data={processedData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 8, fill: 'currentColor' }}
                className="text-zinc-400 dark:text-zinc-600"
                tickFormatter={safeDateFormatter}
                hide={isMini}
              />
              <YAxis 
                tick={{ fontSize: 8, fill: 'currentColor' }} 
                className="text-zinc-400 dark:text-zinc-600"
                width={35} 
                hide={isMini} 
                domain={[0, 'auto']}
                allowDataOverflow={false}
                padding={{ top: 20, bottom: 0 }}
              />
              <Tooltip 
                labelFormatter={safeDateFormatter}
                formatter={(val: any, name: string) => {
                  if (Array.isArray(val)) {
                    if (preferredUnits === 'stone' && isWeightBased) {
                        const lowSt = Math.floor(val[0] / 14);
                        const lowLb = (val[0] % 14).toFixed(0);
                        const highSt = Math.floor(val[1] / 14);
                        const highLb = (val[1] % 14).toFixed(0);
                        return [`${highSt}st ${highLb}lb / ${lowSt}st ${lowLb}lb`, name];
                    }
                    return [`${val[1]}/${val[0]}${unit}`, name];
                  }
                  const num = Number(val) || 0;
                  if (preferredUnits === 'stone' && isWeightBased) {
                    const stones = Math.floor(num / 14);
                    const lbs = (num % 14).toFixed(1);
                    return [`${stones}st ${lbs}lb`, name];
                  }
                  return [num.toFixed(2) + unit, name];
                }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px', backgroundColor: 'var(--tooltip-bg)', color: 'var(--tooltip-color)' }}
                itemStyle={{ color: 'var(--tooltip-color)' }}
              />
              {!isMini && <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />}
              {/* <ReferenceLine y={periodStats.avg} stroke={color} strokeDasharray="3 3" /> */}
              {computedReferenceLines?.map((rl, i) => (
                <ReferenceLine key={i} y={rl.value} label={{ value: rl.label, position: 'right', fontSize: 8, fill: rl.color || '#999' }} stroke={rl.color || '#999'} strokeDasharray="3 3" />
              ))}
              <Bar name={name || title} dataKey={dataKey} fill={color} radius={[4, 4, 4, 4]} barSize={barSize} />
            </BarChart>
          ) : type === 'bar' ? (
            <BarChart data={processedData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 8, fill: 'currentColor' }}
                className="text-zinc-400 dark:text-zinc-600"
                tickFormatter={safeDateFormatter}
                hide={isMini}
              />
              <YAxis tick={{ fontSize: 8, fill: 'currentColor' }} className="text-zinc-400 dark:text-zinc-600" width={35} hide={isMini} domain={[0, 'auto']} tickFormatter={(val) => {
                if (preferredUnits === 'stone' && isWeightBased) {
                  return `${Math.round(val / 14)}st`;
                }
                return (val || 0).toFixed(1);
              }} padding={{ top: 20, bottom: 0 }} />
              <Tooltip 
                labelFormatter={safeDateFormatter}
                formatter={(val: number, name: string) => {
                  const num = val || 0;
                  if (preferredUnits === 'stone' && isWeightBased) {
                    const stones = Math.floor(num / 14);
                    const lbs = (num % 14).toFixed(1);
                    return [`${stones}st ${lbs}lb`, name];
                  }
                  return [num.toFixed(2) + unit, name];
                }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px', backgroundColor: 'var(--tooltip-bg)', color: 'var(--tooltip-color)' }}
                itemStyle={{ color: 'var(--tooltip-color)' }}
              />
              {!isMini && <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />}
              {/* <ReferenceLine y={periodStats.avg} stroke={color} strokeDasharray="3 3" /> */}
              {computedReferenceLines?.map((rl, i) => (
                <ReferenceLine key={i} y={rl.value} label={{ value: rl.label, position: 'right', fontSize: 8, fill: rl.color || '#999' }} stroke={rl.color || '#999'} strokeDasharray="3 3" />
              ))}
              {stackKeys ? (
                stackKeys.map(s => (
                  <Bar key={s.key} name={s.name} dataKey={s.key} stackId="a" fill={s.color} radius={[0, 0, 0, 0]} barSize={barSize} />
                ))
              ) : (
                <Bar name={name || title} dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} barSize={barSize} />
              )}
            </BarChart>
          ) : (
            <AreaChart data={processedData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 8, fill: 'currentColor' }}
                className="text-zinc-400 dark:text-zinc-600"
                tickFormatter={safeDateFormatter}
                hide={isMini}
              />
              <YAxis tick={{ fontSize: 8, fill: 'currentColor' }} className="text-zinc-400 dark:text-zinc-600" width={35} hide={isMini} domain={['dataMin', 'dataMax']} tickFormatter={(val) => {
                if (preferredUnits === 'stone' && isWeightBased) {
                  return `${Math.round(val / 14)}st`;
                }
                return (val || 0).toFixed(1);
              }} padding={{ top: 20, bottom: 20 }} />
              <Tooltip 
                labelFormatter={safeDateFormatter}
                formatter={(val: number, name: string) => {
                  const num = val || 0;
                  if (preferredUnits === 'stone' && isWeightBased) {
                    const stones = Math.floor(num / 14);
                    const lbs = (num % 14).toFixed(1);
                    return [`${stones}st ${lbs}lb`, name];
                  }
                  return [num.toFixed(2) + unit, name];
                }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px', backgroundColor: 'var(--tooltip-bg)', color: 'var(--tooltip-color)' }}
                itemStyle={{ color: 'var(--tooltip-color)' }}
              />
              {!isMini && <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />}
              {/* <ReferenceLine y={periodStats.avg} stroke={color} strokeDasharray="3 3" /> */}
              {computedReferenceLines?.map((rl, i) => (
                <ReferenceLine key={i} y={rl.value} label={{ value: rl.label, position: 'right', fontSize: 8, fill: rl.color || '#999' }} stroke={rl.color || '#999'} strokeDasharray="3 3" />
              ))}
              <Area name={name || title} type="monotone" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.1} />
              {stackKeys?.map(s => (
                <Area key={s.key} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.1} />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
