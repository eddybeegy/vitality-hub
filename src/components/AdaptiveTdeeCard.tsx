import React, { useCallback, useEffect, useState } from 'react';
import { Check, Flame, Info, RefreshCw } from 'lucide-react';
import { fetchJson } from '../lib/apiFetch';
import { getLocalDateString } from '../lib/utils';
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus';
import { estimateTdee, seriesOf, tdeeWindow, MIN_LOGGED_KCAL, type TdeeResult } from '../lib/tdee';
import { PROTEIN_RULE, suggestTargets } from '../lib/adaptiveTargets';
import { useSettingsStore } from '../store/useSettingsStore';

interface AdaptiveTdeeCardProps {
  timezone?: string;
  preferredUnits?: string;
  /** users.focus: which goal the suggestion should chase (item 98). */
  focus?: string;
  /** Current targets, to compare the suggestion with; unset or 0 means none. */
  weightGoalKg?: number;
  bodyFatTargetPct?: number;
  muscleMassTargetKg?: number;
  calorieTarget?: number;
  proteinTarget?: number;
  carbsTarget?: number;
  fiberTarget?: number;
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
//
// The first read also carries the body-composition readings item 98 needs: the
// suggestion's driver depends on the user's Focus, and Fat Loss or Recomposition
// cannot be computed from the scale weight alone.
export const AdaptiveTdeeCard: React.FC<AdaptiveTdeeCardProps> = ({
  timezone, preferredUnits, focus, weightGoalKg, bodyFatTargetPct, muscleMassTargetKg,
  calorieTarget, proteinTarget, carbsTarget, fiberTarget,
}) => {
  const applyTargetValues = useSettingsStore(s => s.applyTargetValues);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<TdeeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leanMassKg, setLeanMassKg] = useState<number | null>(null);
  const [bodyFatPct, setBodyFatPct] = useState<number | null>(null);
  const [muscleMassKg, setMuscleMassKg] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const today = getLocalDateString(timezone);
      // Two days of slack before the window: the route's startDate is a UTC
      // midnight, which is not the user's midnight. estimateTdee trims to the window.
      const from = new Date(tdeeWindow(today).start + 'T00:00:00Z');
      from.setUTCDate(from.getUTCDate() - 2);
      const startDate = from.toISOString();
      const [weightRows, energyRows] = await Promise.all([
        fetchJson<any[]>(`/api/metrics/aggregated?type=weight,lean_body_mass,body_fat,muscle_mass&granularity=day&aggregation=avg&startDate=${startDate}`),
        fetchJson<any[]>(`/api/metrics/aggregated?type=calories_in,active_energy,basal_energy&granularity=day&aggregation=sum&startDate=${startDate}`),
      ]);
      setResult(estimateTdee({
        today,
        weight: seriesOf(weightRows, 'weight'),
        intake: seriesOf(energyRows, 'calories_in'),
        activeEnergy: seriesOf(energyRows, 'active_energy'),
        basalEnergy: seriesOf(energyRows, 'basal_energy'),
      }));
      // Latest of each, not a mean: a target is set against where you are now.
      const latest = (type: string) => {
        const series = seriesOf(weightRows, type);
        return series.length ? series[series.length - 1].value : null;
      };
      setLeanMassKg(latest('lean_body_mass'));
      setBodyFatPct(latest('body_fat'));
      setMuscleMassKg(latest('muscle_mass'));
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
          {(() => {
            const s = suggestTargets({
              tdee: result.tdee,
              trendWeightKg: result.trendWeightKg,
              focus,
              goalWeightKg: weightGoalKg,
              leanMassKg,
              bodyFatPct,
              bodyFatTargetPct,
              muscleMassKg,
              muscleMassTargetKg,
              currentProteinG: proteinTarget,
            });
            const current = (v?: number) => (v && v > 0 ? Math.round(v).toLocaleString() : 'not set');
            // One list, so the button, the "already applied" check and the display
            // can never disagree about which targets this suggestion covers.
            const rows: { type: string; value: number; label: string; now?: number }[] = [
              { type: 'calories', value: s.calories, label: `${s.calories.toLocaleString()} kcal`, now: calorieTarget },
              { type: 'protein', value: s.protein, label: `${s.protein} g protein`, now: proteinTarget },
              ...(s.carbs != null ? [{ type: 'carbs', value: s.carbs, label: `${s.carbs} g carbs`, now: carbsTarget }] : []),
              ...(s.fiber != null ? [{ type: 'fiber', value: s.fiber, label: `${s.fiber} g fibre`, now: fiberTarget }] : []),
            ];
            // Lean mass is what 2.2 (or 2.4) g/kg is defined against, so a focus that
            // wants it but has no reading says so rather than passing the body-weight
            // number off as the intended rule.
            const wantedLean = PROTEIN_RULE[s.focus] === 'lean';
            const proteinNote = s.proteinFloored
              ? 'Protein: keeping your current target, which is above the formula \u2014 this focus never cuts protein.'
              : `Protein: ${s.proteinPerKg} g per kg of ${s.proteinBasis === 'lean_mass' ? 'lean mass' : 'body weight'}${wantedLean && s.proteinBasis === 'body_weight' ? ' (no lean mass reading)' : ''}.`;
            return (
              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Suggested targets</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">focus: {s.focusLabel}</p>
                </div>
                <div className={`grid gap-4 text-sm ${rows.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {rows.map(r => (
                    <div key={r.type}>
                      <p className="font-semibold text-zinc-800 dark:text-zinc-100">{r.label}</p>
                      <p className="text-[11px] text-zinc-400">now {current(r.now)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-400 mt-2">
                  Calories: {s.why}. {proteinNote}
                </p>
                {s.fallback && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                    {s.focusLabel} normally drives this, but {s.fallback}.
                  </p>
                )}
                {(() => {
                  // Already-applied is judged on every suggested target, so the button
                  // stays live while any one of them still differs from the stored value.
                  const matches = rows.every(r => Math.round(r.now || 0) === r.value);
                  const names = rows.map(r => r.type === 'fiber' ? 'fibre' : r.type).join(', ').replace(/, ([^,]*)$/, ' and $1');
                  return (
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={async () => {
                          setApplying(true);
                          try {
                            await applyTargetValues(Object.fromEntries(rows.map(r => [r.type, r.value])));
                          } finally {
                            setApplying(false);
                          }
                        }}
                        disabled={applying || matches}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wider bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {applying ? <RefreshCw size={11} className="animate-spin" /> : matches ? <Check size={11} /> : null}
                        {applying ? 'Applying' : matches ? 'Applied' : 'Apply to targets'}
                      </button>
                      <span className="text-[11px] text-zinc-400">
                        {matches ? `Your ${names} targets match this suggestion.` : `Writes the ${names} targets. Nothing else changes.`}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
