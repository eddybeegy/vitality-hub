import React, { useCallback, useEffect, useState } from 'react';
import { Flame, Info } from 'lucide-react';
import { fetchJson } from '../lib/apiFetch';
import { getLocalDateString } from '../lib/utils';
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus';
import { estimateTdee, seriesOf, tdeeWindow, MIN_LOGGED_KCAL, type TdeeResult } from '../lib/tdee';

interface AdaptiveTdeeCardProps {
  timezone?: string;
  preferredUnits?: string;
}

const KG_TO_LB = 2.20462;

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

// Item 73 (roadmap feature 3): expenditure inferred from logged intake and the
// weight trend over the last 28 complete days -- the maths and every data rule
// live in src/lib/tdee.ts. Two reads of /api/metrics/aggregated because weight
// wants the day's mean and energy wants the day's total; the server has already
// chosen one source per (day, type) and placed each reading on its local day.
export const AdaptiveTdeeCard: React.FC<AdaptiveTdeeCardProps> = ({ timezone, preferredUnits }) => {
  const [result, setResult] = useState<TdeeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const today = getLocalDateString(timezone);
      // Two days of slack before the window: the route's startDate is a UTC
      // midnight, which is not the user's midnight. estimateTdee trims to the window.
      const from = new Date(tdeeWindow(today).start + 'T00:00:00Z');
      from.setUTCDate(from.getUTCDate() - 2);
      const startDate = from.toISOString();
      const [weightRows, energyRows] = await Promise.all([
        fetchJson<any[]>(`/api/metrics/aggregated?type=weight&granularity=day&aggregation=avg&startDate=${startDate}`),
        fetchJson<any[]>(`/api/metrics/aggregated?type=calories_in,active_energy,basal_energy&granularity=day&aggregation=sum&startDate=${startDate}`),
      ]);
      setResult(estimateTdee({
        today,
        weight: seriesOf(weightRows, 'weight'),
        intake: seriesOf(energyRows, 'calories_in'),
        activeEnergy: seriesOf(energyRows, 'active_energy'),
        basalEnergy: seriesOf(energyRows, 'basal_energy'),
      }));
      setError(null);
    } catch (e) {
      console.error('Failed to load adaptive TDEE inputs', e);
      setError("Couldn't load intake and weight data.");
    }
  }, [timezone]);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnFocus(() => { void load(); });

  const imperial = preferredUnits === 'imperial' || preferredUnits === 'stone';
  const formatRate = (kgPerWeek: number) => {
    const v = imperial ? kgPerWeek * KG_TO_LB : kgPerWeek;
    const sign = v > 0.005 ? '+' : v < -0.005 ? '−' : '';
    return `${sign}${Math.abs(v).toFixed(2)} ${imperial ? 'lb' : 'kg'}/wk`;
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-zinc-400" />
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Adaptive TDEE (28 days)</p>
        </div>
        {result?.status === 'ok' && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${CONFIDENCE_STYLE[result.confidence]}`}>
            {result.confidence} confidence
          </span>
        )}
      </div>

      {error ? (
        <p className="text-sm text-rose-500">{error}</p>
      ) : !result ? (
        <div className="h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
      ) : result.status === 'insufficient' ? (
        <div className="space-y-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Not enough data yet to estimate what you burn. Still needed:</p>
          <ul className="list-disc pl-5 text-sm text-zinc-500 dark:text-zinc-400">
            {result.missing.map(m => <li key={m}>{m}</li>)}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-8">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-orange-500">{Math.round(result.tdee).toLocaleString()}</span>
                <span className="text-sm font-medium text-zinc-500">kcal/day</span>
              </div>
              <p className="text-[11px] text-zinc-400">estimated from what you ate and how your weight moved</p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Avg intake</p>
                <p className="font-semibold text-zinc-700 dark:text-zinc-200">{Math.round(result.avgIntake).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Weight trend</p>
                <p className="font-semibold text-zinc-700 dark:text-zinc-200">{formatRate(result.weeklyChangeKg)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Apple</p>
                <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {result.apple ? Math.round(result.apple.tdee).toLocaleString() : '–'}
                  {result.apple && (
                    <span className="ml-1 text-[11px] font-medium text-zinc-400">
                      ({result.apple.tdee >= result.tdee ? '+' : '−'}{Math.abs(Math.round(result.apple.tdee - result.tdee))})
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-zinc-400">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              {result.window.start} to {result.window.end}: {result.intakeDays} logged days, {result.weighIns} weigh-ins
              {result.skippedLowDays > 0 && `, ${result.skippedLowDays} day${result.skippedLowDays === 1 ? '' : 's'} under ${MIN_LOGGED_KCAL} kcal skipped as incomplete`}
              {result.apple ? `. Apple is active + resting energy over ${result.apple.days} days.` : '. Not enough Apple active + resting energy to compare.'}
            </span>
          </p>
        </div>
      )}
    </div>
  );
};
