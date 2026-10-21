import React from 'react';
import { motion } from 'motion/react';
import { Target } from 'lucide-react';
import { getWeightUnit, convertWeight } from '../lib/utils';
import { useHealthStore } from '../store/useHealthStore';

interface TargetsTabProps {
  targets: any[];
  setTargets: (targets: any[]) => void;
  settings: any;
  handleSaveTargets: () => Promise<void>;
}

// Maps a target's type to the metric type + unit conversion needed to compare
// it against the latest logged reading. Verified against real production data
// (2026-09-14): active_energy is logged in kJ but targeted in kcal, stand_time
// is logged in minutes but targeted in hours, sleep is logged in seconds, and
// 'hydration' (kg) is an unrelated metric distinct from 'water' (ml).
const TARGET_METRIC_MAP: Record<string, { metricType: string; convert?: (v: number) => number }> = {
  weight: { metricType: 'weight' },
  body_fat: { metricType: 'body_fat' },
  muscle_mass: { metricType: 'muscle_mass' },
  steps: { metricType: 'steps' },
  vo2_max: { metricType: 'vo2max' },
  calories: { metricType: 'calories_in' },
  protein: { metricType: 'protein' },
  carbs: { metricType: 'carbs' },
  fat: { metricType: 'fat' },
  water: { metricType: 'water' },
  sleep: { metricType: 'sleep', convert: (v: number) => v / 3600 },
  resting_heart_rate: { metricType: 'resting_heart_rate' },
  exercise_time: { metricType: 'exercise_time' },
  stand_time: { metricType: 'stand_time', convert: (v: number) => v / 60 },
  fiber: { metricType: 'fiber' },
  active_energy: { metricType: 'active_energy', convert: (v: number) => v / 4.184 },
  blood_oxygen_saturation: { metricType: 'oxygen_saturation' },
};

// Target types where being *under* target is the good direction (the
// "% of target" progress bar needs to know this to color near-100% green
// rather than red) — e.g. body fat and resting heart rate are goals you
// want to come in under, unlike steps/protein/water where more is better.
const LOWER_IS_BETTER = new Set(['body_fat', 'resting_heart_rate']);

function progressBarColor(pct: number, lowerIsBetter: boolean): string {
  const distance = lowerIsBetter ? pct - 100 : 100 - pct;
  if (distance <= 0) return 'bg-emerald-500';
  if (distance <= 15) return 'bg-amber-500';
  return 'bg-rose-500';
}

export const TargetsTab = React.memo(({
  targets,
  setTargets,
  settings,
  handleSaveTargets
}: TargetsTabProps) => {
  const { summaryData } = useHealthStore();

  const getCurrentValue = (targetType: string): number | null => {
    const mapping = TARGET_METRIC_MAP[targetType];
    if (!mapping) return null;
    const latest = (summaryData.latestMetrics || []).find((m: any) => m.type === mapping.metricType);
    if (!latest || latest.value == null) return null;
    const raw = Number(latest.value);
    return mapping.convert ? mapping.convert(raw) : raw;
  };

  return (
    <motion.div
      key="targets"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm mt-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Target size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Health Targets</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Set your goals for weight, body composition, and nutrition</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {targets.map((target, idx) => {
            const isWeight = target.type === 'weight' || target.type === 'muscle_mass';
            const expectsLbs = settings?.preferred_units === 'imperial' || settings?.preferred_units === 'stone';

            let displayUnit = target.unit;
            let displayValue = target.value;

            if (isWeight) {
              displayUnit = expectsLbs ? 'lbs' : 'kg';
              displayValue = convertWeight(target.value, settings?.preferred_units);
            }

            const hasTarget = Number(target.value) > 0;
            const currentRaw = hasTarget ? getCurrentValue(target.type) : null;
            const currentDisplay = currentRaw != null ? (isWeight ? convertWeight(currentRaw, settings?.preferred_units) : currentRaw) : null;
            const pctOfTarget = currentDisplay != null ? (currentDisplay / displayValue) * 100 : null;
            const lowerIsBetter = LOWER_IS_BETTER.has(target.type);

            return (
              <div key={idx} className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{target.label} ({displayUnit})</label>
                <input
                  type="number"
                  step="0.1"
                  value={displayValue}
                  onChange={(e) => {
                    const newTargets = [...targets];
                    let val = parseFloat(e.target.value) || 0;
                    if (isWeight && expectsLbs) {
                      val = val / 2.20462;
                    }
                    newTargets[idx].value = val;
                    setTargets(newTargets);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                />
                {currentDisplay != null && (
                  <>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                      Current: {currentDisplay.toFixed(1)} {displayUnit} &middot; {pctOfTarget!.toFixed(0)}% of target
                    </p>
                    <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${progressBarColor(pctOfTarget!, lowerIsBetter)}`}
                        style={{ width: `${Math.min(100, Math.max(0, pctOfTarget!))}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-8">
          <button
            onClick={handleSaveTargets}
            className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
          >
            Update Health Targets
          </button>
        </div>
      </div>
    </motion.div>
  );
});
