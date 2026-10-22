import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Utensils, PieChart as PieChartIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { HealthChart } from './HealthChart';
import { SyncButton } from './SyncButton';
import { FrequentMealsModal } from './FrequentMealsModal';
import { AdaptiveTdeeCard } from './AdaptiveTdeeCard';
import type { DayTypeOverride, DayTypeResult } from '../lib/dayTargets';
import { takeRecent } from '../lib/recentWindow';

interface NutritionTabProps {
  settings: any;
  lastSynced: string | null;
  syncAllModules: () => Promise<void>;
  isSyncing: boolean;
  getTodayTotal: (type: string) => number;
  getTargetValue: (type: string) => number | undefined;
  getChartData: (type: string, dataKey: string) => any[];
  /** Item 88: today's training/rest day, when the user has rest-day targets set. */
  dayType?: DayTypeResult | null;
  onDayTypeChange?: (override: DayTypeOverride) => void;
}

export const NutritionTab = React.memo(({
  settings,
  lastSynced,
  syncAllModules,
  isSyncing,
  getTodayTotal,
  getTargetValue,
  getChartData,
  dayType,
  onDayTypeChange
}: NutritionTabProps) => {
  const [isFrequentMealsOpen, setIsFrequentMealsOpen] = useState(false);

  const weeklyAverages = React.useMemo(() => {
    const avgOf = (type: string, dataKey: string) => {
      // `getChartData` reads the store's standardized metrics, and `standardizeMetrics`
      // (src/services/healthDataService.ts) returns them sorted OLDEST-first. `.slice(0, 7)`
      // therefore averaged the seven oldest logged days -- 2026-01-20..30, 1,495 kcal /
      // 74 g protein -- and labelled it "7d avg", against a real last-seven of 2,632 / 218.
      // `takeRecent` picks the newest end whatever order the caller hands us.
      const days = takeRecent(getChartData(type, dataKey), 7);
      if (days.length === 0) return null;
      const sum = days.reduce((s: number, d: any) => s + (Number(d[dataKey]) || 0), 0);
      return sum / days.length;
    };
    return {
      calories_in: avgOf('calories_in', 'calories'),
      protein: avgOf('protein', 'protein'),
      carbs: avgOf('carbs', 'carbs'),
      fat: avgOf('fat', 'fat'),
    };
  }, [getChartData]);

  const remaining = React.useMemo(() => {
    const calc = (targetType: string, totalType: string) => {
      const target = getTargetValue(targetType);
      if (target === undefined) return null;
      return target - getTodayTotal(totalType);
    };
    return {
      calories_in: calc('calories', 'calories_in'),
      protein: calc('protein', 'protein'),
      carbs: calc('carbs', 'carbs'),
      fat: calc('fat', 'fat'),
    };
  }, [getTargetValue, getTodayTotal]);

  const remainingLabel = (value: number | null, unit: string) => {
    if (value === null) return null;
    const over = value < 0;
    return (
      <span className={`text-[11px] font-semibold mt-0.5 ${over ? 'text-amber-500 dark:text-amber-400' : 'text-emerald-500 dark:text-emerald-400'}`}>
        {Math.round(Math.abs(value))}{unit} {over ? 'over' : 'left'}
      </span>
    );
  };

  const weeklyAvgLabel = (avg: number | null, target: number | undefined, unit: string) => {
    if (avg === null) return null;
    const onTarget = target !== undefined && target > 0 && Math.abs(avg - target) / target <= 0.15;
    const colorClass = target === undefined
      ? 'text-zinc-400 dark:text-zinc-500'
      : onTarget
        ? 'text-emerald-500 dark:text-emerald-400'
        : 'text-amber-500 dark:text-amber-400';
    return (
      <span className={`text-[11px] font-medium mt-1 ${colorClass}`}>7d avg: {Math.round(avg)}{unit}</span>
    );
  };

  const macroSplit = React.useMemo(() => {
    const proteinCals = (weeklyAverages.protein || 0) * 4;
    const carbsCals = (weeklyAverages.carbs || 0) * 4;
    const fatCals = (weeklyAverages.fat || 0) * 9;
    const total = proteinCals + carbsCals + fatCals;
    if (total <= 0) return null;
    return [
      { name: 'Protein', calories: proteinCals, pct: (proteinCals / total) * 100, color: '#10b981' },
      { name: 'Carbs', calories: carbsCals, pct: (carbsCals / total) * 100, color: '#3b82f6' },
      { name: 'Fat', calories: fatCals, pct: (fatCals / total) * 100, color: '#eab308' },
    ];
  }, [weeklyAverages]);

  const targetMacroSplit = React.useMemo(() => {
    const proteinCals = (getTargetValue('protein') || 0) * 4;
    const carbsCals = (getTargetValue('carbs') || 0) * 4;
    const fatCals = (getTargetValue('fat') || 0) * 9;
    const total = proteinCals + carbsCals + fatCals;
    if (total <= 0) return null;
    return {
      protein: (proteinCals / total) * 100,
      carbs: (carbsCals / total) * 100,
      fat: (fatCals / total) * 100,
    };
  }, [getTargetValue]);

  return (
    <motion.div 
      key="nutrition"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <FrequentMealsModal 
        isOpen={isFrequentMealsOpen} 
        onClose={() => setIsFrequentMealsOpen(false)} 
      />

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center text-orange-600 dark:text-orange-400">
            <Utensils size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">Nutrition Insights</h2>
            <p className="text-zinc-500 dark:text-zinc-400">Track your calories and macronutrients</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <button
              onClick={() => setIsFrequentMealsOpen(true)}
              className="px-4 py-2 bg-white dark:bg-zinc-800 text-sm font-bold text-zinc-700 dark:text-zinc-300 rounded-xl border border-black/5 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-sm"
            >
              Top Meals
            </button>
            {lastSynced && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">Last sync: {lastSynced}</span>
            )}
            <SyncButton 
              onClick={syncAllModules} 
              isSyncing={isSyncing} 
              label="Sync All" 
            />
        </div>
      </div>

      {dayType && onDayTypeChange && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Today's targets:</span>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg" role="group" aria-label="Training or rest day">
            {(['training', 'rest'] as const).map(t => (
              <button
                key={t}
                onClick={() => onDayTypeChange(dayType.source === 'manual' && dayType.type === t ? null : t)}
                aria-pressed={dayType.type === t}
                className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${dayType.type === t ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300'}`}
              >
                {t} day
              </button>
            ))}
          </div>
          <span className="text-[10px] text-zinc-400">
            {dayType.source === 'manual'
              ? 'set by you (tap again to go back to automatic)'
              : dayType.type === 'training' ? 'workout logged today' : 'no workout logged yet today'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-4 sm:p-6 shadow-sm flex flex-col items-center justify-center text-center min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Calories</span>
          <div className="flex flex-wrap items-baseline justify-center gap-x-1">
            <span className="text-2xl sm:text-3xl font-bold text-orange-500">{Math.round(getTodayTotal('calories_in'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('calories') || '-'} kcal</span>
          </div>
          {remainingLabel(remaining.calories_in, ' kcal')}
          {weeklyAvgLabel(weeklyAverages.calories_in, getTargetValue('calories'), ' kcal')}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-4 sm:p-6 shadow-sm flex flex-col items-center justify-center text-center min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Protein</span>
          <div className="flex flex-wrap items-baseline justify-center gap-x-1">
            <span className="text-2xl sm:text-3xl font-bold text-emerald-500">{Math.round(getTodayTotal('protein'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('protein') || '-'} g</span>
          </div>
          {remainingLabel(remaining.protein, 'g')}
          {weeklyAvgLabel(weeklyAverages.protein, getTargetValue('protein'), ' g')}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-4 sm:p-6 shadow-sm flex flex-col items-center justify-center text-center min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Carbs</span>
          <div className="flex flex-wrap items-baseline justify-center gap-x-1">
            <span className="text-2xl sm:text-3xl font-bold text-blue-500">{Math.round(getTodayTotal('carbs'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('carbs') || '-'} g</span>
          </div>
          {remainingLabel(remaining.carbs, 'g')}
          {weeklyAvgLabel(weeklyAverages.carbs, getTargetValue('carbs'), ' g')}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-4 sm:p-6 shadow-sm flex flex-col items-center justify-center text-center min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Fat</span>
          <div className="flex flex-wrap items-baseline justify-center gap-x-1">
            <span className="text-2xl sm:text-3xl font-bold text-yellow-500">{Math.round(getTodayTotal('fat'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('fat') || '-'} g</span>
          </div>
          {remainingLabel(remaining.fat, 'g')}
          {weeklyAvgLabel(weeklyAverages.fat, getTargetValue('fat'), ' g')}
        </div>
      </div>

      <AdaptiveTdeeCard
        timezone={settings?.timezone}
        preferredUnits={settings?.preferred_units}
        weightGoalKg={getTargetValue('weight')}
        calorieTarget={getTargetValue('calories')}
        proteinTarget={getTargetValue('protein')}
      />

      {macroSplit && (
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon size={16} className="text-zinc-400" />
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Macro Balance (7-Day Avg)</p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div style={{ width: 140, height: 140 }} className="shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={macroSplit} dataKey="calories" nameKey="name" innerRadius={45} outerRadius={65} paddingAngle={2} stroke="none">
                    {macroSplit.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [`${Math.round(value)} kcal`, name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 flex-1 w-full">
              {macroSplit.map((m) => (
                <div key={m.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                    {m.name}
                  </span>
                  <span className="font-mono text-zinc-500 dark:text-zinc-400 text-right">
                    {Math.round(m.pct)}%
                    {targetMacroSplit && (
                      <span className="text-zinc-400 dark:text-zinc-600"> (target {Math.round((targetMacroSplit as any)[m.name.toLowerCase()])}%)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any}
          data={getChartData('calories_in', 'calories')}
          title="Calorie Intake" 
          dataKey="calories" 
          color="#f97316" 
          type="bar" 
          unit=" kcal"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          referenceLines={getTargetValue('calories') ? [{ value: getTargetValue('calories'), label: 'Target', color: '#ef4444' }] : undefined}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('protein', 'protein')} 
          title="Protein Intake" 
          dataKey="protein" 
          color="#10b981" 
          type="area"
          unit=" g"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          referenceLines={getTargetValue('protein') ? [{ value: getTargetValue('protein'), label: 'Target', color: '#ef4444' }] : undefined}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('carbs', 'carbs')} 
          title="Carbohydrates" 
          dataKey="carbs" 
          color="#3b82f6" 
          type="area"
          unit=" g"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          referenceLines={getTargetValue('carbs') ? [{ value: getTargetValue('carbs'), label: 'Target', color: '#ef4444' }] : undefined}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('fat', 'fat')} 
          title="Fat" 
          dataKey="fat" 
          color="#eab308" 
          type="area"
          unit=" g"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          referenceLines={getTargetValue('fat') ? [{ value: getTargetValue('fat'), label: 'Target', color: '#ef4444' }] : undefined}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('fiber', 'fiber')} 
          title="Fiber" 
          dataKey="fiber" 
          color="#8b5cf6" 
          type="area"
          unit=" g"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('sugar', 'sugar')} 
          title="Sugar" 
          dataKey="sugar" 
          color="#ec4899" 
          type="area"
          unit=" g"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('sodium', 'sodium')} 
          title="Sodium" 
          dataKey="sodium" 
          color="#64748b" 
          type="area"
          unit=" mg"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('iron', 'iron')} 
          title="Iron" 
          dataKey="iron" 
          color="#ef4444" 
          type="area"
          unit=" mg"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          sourceName="Cronometer"
          lastSyncStr={lastSynced}
        />
      </div>
    </motion.div>
  );
});
