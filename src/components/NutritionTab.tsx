import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Utensils } from 'lucide-react';
import { HealthChart } from './HealthChart';
import { SyncButton } from './SyncButton';
import { FrequentMealsModal } from './FrequentMealsModal';

interface NutritionTabProps {
  settings: any;
  lastSynced: string | null;
  syncAllModules: () => Promise<void>;
  isSyncing: boolean;
  getTodayTotal: (type: string) => number;
  getTargetValue: (type: string) => number | undefined;
  getChartData: (type: string, dataKey: string) => any[];
}

export const NutritionTab = React.memo(({
  settings,
  lastSynced,
  syncAllModules,
  isSyncing,
  getTodayTotal,
  getTargetValue,
  getChartData
}: NutritionTabProps) => {
  const [isFrequentMealsOpen, setIsFrequentMealsOpen] = useState(false);

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

      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center text-orange-600 dark:text-orange-400">
            <Utensils size={20} />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Nutrition Insights</h2>
            <p className="text-zinc-500 dark:text-zinc-400">Track your calories and macronutrients</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Calories</span>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-orange-500">{Math.round(getTodayTotal('calories_in'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('calories') || '-'} kcal</span>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Protein</span>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-emerald-500">{Math.round(getTodayTotal('protein'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('protein') || '-'} g</span>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Carbs</span>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-blue-500">{Math.round(getTodayTotal('carbs'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('carbs') || '-'} g</span>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">Fat</span>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-yellow-500">{Math.round(getTodayTotal('fat'))}</span>
            <span className="text-sm font-medium text-zinc-500">/ {getTargetValue('fat') || '-'} g</span>
          </div>
        </div>
      </div>

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
