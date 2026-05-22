import React from 'react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { motion } from 'motion/react';
import { Activity, Moon, Scale, Zap, Utensils, TrendingUp, Target, GripVertical, HeartPulse } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { HealthChart } from './HealthChart';
import { SortableWidget } from './SortableWidget';
import { SyncButton } from './SyncButton';
import { SyncStatus } from './SyncStatus';
import { SyncHealthWidget } from './SyncHealthWidget';
import { ProgressRing } from './ui/ProgressRing';
import { CardSkeleton, ChartSkeleton } from './ui/Skeleton';
import { ReadinessCard } from './ReadinessCard';
import { SmartAdjustments } from './SmartAdjustments';
import { formatWeight, convertWeight, getWeightUnit, getLocalDateString, formatDateWithTimezone, cn } from '../lib/utils';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { getSleepStagesData, getBloodPressureData } from '../services/healthDataService';

export const Dashboard = React.memo(({ lastSynced }: { lastSynced?: string | null }) => {
  const { settings, targets, setSettings, handleSaveSettings } = useSettingsStore();
  const { summaryData, isSyncing, isInitialLoading, refreshSummary, lastAppleHealthSync } = useHealthStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const items = settings.dashboard_widgets || [];
      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);
      const newItems = [...items];
      const [removed] = newItems.splice(oldIndex, 1);
      newItems.splice(newIndex, 0, removed);
      
      // Update local state first
      setSettings({ ...settings, dashboard_widgets: newItems });
      
      // Persist to backend. Note that handleSaveSettings reads from the zustand store directly.
      // So setSettings updates the store synchronously, handleSaveSettings will persist it.
      if (handleSaveSettings) {
        await handleSaveSettings();
      }
    }
  };

  const getTargetValue = (type: string) => {
    if (!targets) return undefined;
    const target = targets.find((t: any) => t.type === type);
    return target && target.value > 0 ? target.value : undefined;
  };

  const getTodayTotal = (type: string) => {
    const today = getLocalDateString(settings.timezone);
    const metrics = summaryData.metrics || [];
    const metric = metrics.find((m: any) => m.type === type && m.date === today);
    return metric ? Number(metric.value) : 0;
  };

  return (
    <div id="dashboard-container">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h2>
          {lastSynced && (
            <SyncStatus lastSyncStr={lastSynced} className="static" />
          )}
        </div>
        <SyncButton 
          onClick={refreshSummary} 
          isSyncing={isSyncing} 
          label="Refresh Data" 
        />
      </div>
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >

        <SortableContext 
          items={(settings.dashboard_widgets || []).filter(w => !['progress_rings', 'stats', 'nutrition'].includes(w))}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
            <div className="col-span-1">
              <SyncHealthWidget />
            </div>
            {isInitialLoading ? (
              <>
                <CardSkeleton className="col-span-1" />
                <CardSkeleton className="col-span-1" />
                <ChartSkeleton className="col-span-2" />
                <ChartSkeleton className="col-span-2" />
              </>
            ) : (settings.dashboard_widgets || [])
                .filter(w => !['progress_rings', 'stats', 'nutrition', 'active_calories_chart'].includes(w))
                .map((widgetId: string) => (
              <SortableWidget 
                key={widgetId} 
                id={widgetId}
                className="w-full"
              >
                {({ listeners, attributes }) => (
                  <div className="relative group h-full">
                    <div 
                      className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab z-10 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
                      {...attributes}
                      {...listeners}
                    >
                      <GripVertical size={16} className="text-zinc-400" />
                    </div>

                    {widgetId === 'sleep_quality' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                            <div>
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                                        <Moon className="text-indigo-500" size={20} />
                                    </div>
                                </div>
                                <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Sleep Quality</p>
                                <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                    {(() => {
                                        const metrics = (summaryData.latestMetrics || []);
                                        const total = metrics.find((m: any) => m.type === 'sleep') || 
                                                     metrics.find((m: any) => m.type === 'sleep_total') ||
                                                     metrics.find((m: any) => m.type === 'sleep_analysis');
                                        const getVal = (m: any) => {
                                            if (!m || m.value == null) return 0;
                                            const v = Number(m.value);
                                            // Handle seconds/minutes units or large values that are likely seconds
                                            if (m.unit === 's' || m.unit === 'sec' || m.unit === 'seconds' || v > 100) return v / 3600;
                                            if (m.unit === 'min' || m.unit === 'minutes') return v / 60;
                                            return v;
                                        };
                                        return total ? `${getVal(total).toFixed(1)}h` : "--h";
                                    })()}
                                </p>
                            </div>
                        </div>
                    )}
                    {widgetId === 'weight_card' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                            <div>
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                                        <Scale className="text-blue-500" size={20} />
                                    </div>
                                </div>
                                <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Body Composition</p>
                                <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                    {(() => {
                                        const weightMetric = (summaryData.latestMetrics || []).find((m: any) => m.type === 'weight');
                                        if (!weightMetric || weightMetric.value == null) return "--";
                                        return formatWeight(Number(weightMetric.value), settings?.preferred_units);
                                    })()}
                                </p>
                            </div>
                        </div>
                    )}
                    {widgetId === 'readiness_card' && (
                      <ReadinessCard 
                        metrics={summaryData.metrics || []} 
                        targets={targets || []} 
                        timezone={settings?.timezone}
                      />
                    )}
                    {widgetId === 'micronutrient_radar' && (
                      <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                        <div>
                          <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                              <Target className="text-emerald-500" size={20} />
                            </div>
                          </div>
                          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Micronutrient & Density</p>
                          <div className="h-56 w-full relative">
                            {(() => {
                              // Define standard targets for micronutrients if not explicitly provided
                              const microTargets: Record<string, number> = {
                                vitamin_d: 20, // mcg
                                magnesium: 400, // mg
                                zinc: 11, // mg
                                vitamin_c: 90, // mg
                                iron: 14, // mg
                                calcium: 1000, // mg
                                fiber: 30, // g
                              };
                              
                              const today = getLocalDateString(settings.timezone);
                              const metrics = summaryData.metrics || [];
                              const todayMetrics = metrics.filter((m: any) => m.date === today);

                              const getVal = (type: string) => {
                                const m = todayMetrics.find((m: any) => m.type === type);
                                return m ? Number(m.value) : 0;
                              };

                              let totalPercentage = 0;
                              const keysCount = Object.keys(microTargets).length;

                              const data = Object.entries(microTargets).map(([key, target]) => {
                                const val = getVal(key);
                                // Calculate % of target. Cap at 100% for radar shape.
                                const percentage = Math.min((val / target) * 100, 100);
                                totalPercentage += percentage;
                                return {
                                  subject: key.replace('vitamin_', 'Vit ').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                  A: percentage,
                                  fullMark: 100,
                                  val: val
                                };
                              });

                              const densityScore = Math.round(totalPercentage / keysCount);

                              return (
                                <>
                                  <div className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono mb-2">
                                    {densityScore} <span className="text-sm text-zinc-400">/ 100</span>
                                  </div>
                                  <div className="absolute inset-0 top-12">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                                          <PolarGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                                          <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 9, fontWeight: 600 }} />
                                          <Radar name="Intake %" dataKey="A" stroke="#10b981" fill="#10b981" fillOpacity={0.5} />
                                          <Tooltip 
                                            formatter={(value: any) => [`${Number(value).toFixed(0)}%`, 'Target Hit']}
                                            contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.05)', fontSize: '12px', fontWeight: 'bold' }}
                                          />
                                        </RadarChart>
                                      </ResponsiveContainer>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                    {widgetId === 'macronutrient_radar' && (
                      <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                        <div>
                          <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                              <Zap className="text-indigo-500" size={20} />
                            </div>
                          </div>
                          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Macronutrient Target Adherence</p>
                          <div className="h-56 w-full relative">
                            {(() => {
                              const macroTargets: Record<string, number> = {
                                protein: getTargetValue('protein') || 150,
                                carbs: getTargetValue('carbs') || 250,
                                fat: getTargetValue('fat') || 70,
                                fiber: getTargetValue('fiber') || 30,
                                unsaturated_fat: getTargetValue('unsaturated_fat') || 25,
                                sugar: getTargetValue('sugar') || 50,
                              };
                              
                              const today = getLocalDateString(settings.timezone);
                              const metrics = summaryData.metrics || [];
                              const todayMetrics = metrics.filter((m: any) => m.date === today);

                              const getVal = (type: string) => {
                                if (type === 'unsaturated_fat') {
                                  const mono = todayMetrics.find((m: any) => m.type === 'fat_monounsaturated');
                                  const poly = todayMetrics.find((m: any) => m.type === 'fat_polyunsaturated');
                                  const monoVal = mono ? Number(mono.value) : 0;
                                  const polyVal = poly ? Number(poly.value) : 0;
                                  const direct = todayMetrics.find((m: any) => m.type === 'unsaturated_fat');
                                  if (direct && Number(direct.value) > 0) return Number(direct.value);
                                  return monoVal + polyVal;
                                }
                                const m = todayMetrics.find((m: any) => m.type === type);
                                return m ? Number(m.value) : 0;
                              };

                              let totalPercentage = 0;
                              const keysCount = Object.keys(macroTargets).length;

                              const data = Object.entries(macroTargets).map(([key, target]) => {
                                const val = getVal(key);
                                // For things like sugar, we might want a different logic, but here we just show percentage of target hit
                                // Usually macros are "aim for" or "limit to".
                                const percentage = Math.min((val / target) * 100, 100);
                                totalPercentage += percentage;
                                return {
                                  subject: key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                  A: percentage,
                                  fullMark: 100,
                                  val: val
                                };
                              });

                              const driftScore = Math.round(totalPercentage / keysCount);

                              return (
                                <>
                                  <div className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono mb-2">
                                    {driftScore} <span className="text-sm text-zinc-400">/ 100</span>
                                  </div>
                                  <div className="absolute inset-0 top-12">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                                          <PolarGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                                          <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 9, fontWeight: 600 }} />
                                          <Radar name="Target %" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} />
                                          <Tooltip 
                                            formatter={(value: any) => [`${Number(value).toFixed(0)}%`, 'Target Adherence']}
                                            contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.05)', fontSize: '12px', fontWeight: 'bold' }}
                                          />
                                        </RadarChart>
                                      </ResponsiveContainer>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                    {widgetId === 'smart_adjustments' && (
                      <SmartAdjustments />
                    )}
                    {widgetId === 'hrv_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=hrv" title="HRV" dataKey="hrv" color="#8b5cf6" unit="ms"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'vo2max_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=vo2max" title="VO2 Max" dataKey="vo2max" color="#3b82f6" unit="ml/kg/min"
                           aggregation="max"
                           preferredUnits={settings?.preferred_units}
                           referenceLines={getTargetValue('vo2_max') ? [{ value: getTargetValue('vo2_max'), label: 'Target', color: '#ef4444' }] : undefined}
                        />
                      </div>
                    )}
                    {widgetId === 'calories_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=calories_in" title="Calorie Intake" dataKey="calories_in" color="#f97316" unit="kcal"
                           aggregation="sum"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'active_energy_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=active_energy" title="Active Energy" dataKey="active_energy" color="#ef4444" unit="kcal"
                           aggregation="sum"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'charts' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=weight,body_fat,muscle_mass,lean_body_mass,fat_mass" 
                           title="Body Composition Trends" 
                           dataKey="weight" 
                           color="#3b82f6" 
                           unit={getWeightUnit(settings?.preferred_units)}
                           preferredUnits={settings?.preferred_units}
                           sumStackInLatest={false}
                           stackKeys={[
                             { key: 'muscle_mass', color: '#a855f7', name: 'Muscle Mass' },
                             { key: 'lean_body_mass', color: '#8b5cf6', name: 'Lean Body Mass' },
                             { key: 'fat_mass', color: '#ec4899', name: 'Fat Mass (kg)' }
                           ]}
                        />
                      </div>
                    )}
                    {widgetId === 'body_fat_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=body_fat" title="Body Fat %" dataKey="body_fat" color="#ec4899" unit="%"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'muscle_mass_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=muscle_mass" title="Muscle Mass" dataKey="muscle_mass" color="#c084fc" unit={getWeightUnit(settings?.preferred_units)}
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'lean_body_mass_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=lean_body_mass" title="Lean Body Mass" dataKey="lean_body_mass" color="#8b5cf6" unit={getWeightUnit(settings?.preferred_units)}
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'resting_hr_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=resting_heart_rate" title="Resting Heart Rate" dataKey="resting_heart_rate" color="#10b981" unit="bpm"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'blood_pressure_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           data={getBloodPressureData(summaryData.metrics || [])} 
                           title="Blood Pressure" name="Systolic/Diastolic" dataKey="bp_range" 
                           rangeKeys={['diastolic', 'systolic']} color="#8b5cf6" type="rangeBar" unit=" mmHg" barSize={8}
                           preferredUnits={settings?.preferred_units}
                           referenceLines={[
                             { value: 120, label: 'Sys High', color: '#ef4444' },
                             { value: 80, label: 'Dia High', color: '#ef4444' }
                           ]}
                        />
                      </div>
                    )}
                    {widgetId === 'carbs_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=carbs" title="Carbs" dataKey="carbs" color="#f59e0b" unit="g"
                           aggregation="sum"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'protein_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=protein" title="Protein" dataKey="protein" color="#8b5cf6" unit="g"
                           aggregation="sum"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'fat_chart' && (
                      <div className="space-y-4">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                           url="/api/metrics/aggregated?type=fat" title="Fat" dataKey="fat" color="#f97316" unit="g"
                           aggregation="sum"
                           preferredUnits={settings?.preferred_units}
                        />
                      </div>
                    )}
                    {widgetId === 'nutrition_macros' && (
                      <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full flex flex-col justify-between">
                        <p className="font-bold text-zinc-900">Nutrition Macros (Today)</p>
                        <div className="flex justify-between gap-4 mt-4">
                          <div className="text-center">
                            <p className="text-sm text-zinc-500">Carbs</p>
                            <p className="font-bold text-lg">{getTodayTotal('carbs').toFixed(0)}g</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm text-zinc-500">Protein</p>
                            <p className="font-bold text-lg">{getTodayTotal('protein').toFixed(0)}g</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm text-zinc-500">Fat</p>
                            <p className="font-bold text-lg">{getTodayTotal('fat').toFixed(0)}g</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {widgetId === 'latest_workout' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full flex flex-col gap-4">
                          <p className="font-bold text-zinc-900">Latest Workout</p>
                          {summaryData?.workouts && summaryData.workouts.length > 0 ? (
                            <div className="space-y-4">
                              <div>
                                <p className="text-sm font-semibold text-zinc-900">{summaryData.workouts[0].name}</p>
                                <p className="text-xs text-zinc-500">{formatDateWithTimezone(summaryData.workouts[0].timestamp, settings?.timezone)}</p>
                              </div>
                              <div className="space-y-2">
                                {(summaryData.workouts[0].exercises || []).map((ex: any, i: number) => (
                                <div key={i} className="text-sm border-b border-zinc-100 dark:border-zinc-800 pb-2">
                                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">{ex.title || ex.name || 'Unknown Exercise'}</p>
                                  <p className="text-xs text-zinc-500">
                                    {ex.sets.map((s: any, si: number) => `${s.reps} reps @ ${s.weight}kg`).join(', ')}
                                  </p>
                                </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-zinc-500">No recent workouts...</p>
                          )}
                        </div>
                    )}
                    {widgetId === 'sleep_stages' && (
                      <div className="h-full">
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                          data={getSleepStagesData(summaryData.metrics, settings?.timezone)}
                          title="Sleep Stages"
                          dataKey="core"
                          type="bar"
                          unit="h"
                          stackKeys={[
                            { key: 'core', color: '#10b981', name: 'Core' },
                            { key: 'deep', color: '#4338ca', name: 'Deep' },
                            { key: 'rem', color: '#818cf8', name: 'REM' },
                            { key: 'awake', color: '#f43f5e', name: 'Awake' }
                          ]}
                        />
                      </div>
                    )}
                  </div>
                )}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
});
