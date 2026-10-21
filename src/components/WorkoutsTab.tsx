import React from 'react';
import { motion } from 'motion/react';
import { Dumbbell, Activity, ChevronUp, ChevronDown, SearchX, Search, Trophy } from 'lucide-react';
import { SyncButton } from './SyncButton';
import { SyncStatus } from './SyncStatus';
import { EmptyState } from './ui/EmptyState';
import { HealthChart } from './HealthChart';
import { formatWorkoutWeight, formatWeight, convertWeight, getWeightUnit, convertDistance, getDistanceUnit, formatPaceAndSpeed, formatDateWithTimezone } from '../lib/utils';

interface WorkoutsTabProps {
  summaryData: any;
  workoutTypeFilter: 'all' | 'strength' | 'cardio';
  setWorkoutTypeFilter: (filter: 'all' | 'strength' | 'cardio') => void;
  recentSessionsCount: number;
  setRecentSessionsCount: (count: number) => void;
  expandedWorkouts: Record<number, boolean>;
  setExpandedWorkouts: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  settings: any;
  lastSynced: string | null;
  syncAllModules: () => Promise<void>;
  isSyncing: boolean;
}

export const WorkoutsTab = React.memo(({
  summaryData,
  workoutTypeFilter,
  setWorkoutTypeFilter,
  recentSessionsCount,
  setRecentSessionsCount,
  expandedWorkouts,
  setExpandedWorkouts,
  settings,
  lastSynced,
  syncAllModules,
  isSyncing
}: WorkoutsTabProps) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [dateRangeFilter, setDateRangeFilter] = React.useState<'all' | '7d' | '30d' | '90d'>('all');

  const filteredWorkouts = React.useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const dateRangeDays = dateRangeFilter === '7d' ? 7 : dateRangeFilter === '30d' ? 30 : dateRangeFilter === '90d' ? 90 : null;
    const dateRangeCutoff = dateRangeDays != null ? Date.now() - dateRangeDays * 24 * 60 * 60 * 1000 : null;
    return summaryData.workouts.filter((workout: any) => {
      // Type filter
      let matchesType = true;
      if (workoutTypeFilter === 'cardio') {
        matchesType = workout.exercises.some((ex: any) => ex.type === 'cardio') || workout.source === 'apple_health';
      } else if (workoutTypeFilter === 'strength') {
        matchesType = workout.exercises.some((ex: any) => ex.type === 'strength' || ex.type === 'bodyweight') || workout.source === 'hevy';
      }

      if (!matchesType) return false;

      // Date range filter
      if (dateRangeCutoff != null && new Date(workout.timestamp).getTime() < dateRangeCutoff) return false;

      // Search query filter
      if (!query) return true;

      const matchesName = workout.name.toLowerCase().includes(query);
      const matchesExercise = workout.exercises.some((ex: any) =>
        ex.title.toLowerCase().includes(query)
      );

      return matchesName || matchesExercise;
    });
  }, [summaryData.workouts, workoutTypeFilter, dateRangeFilter, searchQuery]);

  const exportFilteredWorkoutsCsv = () => {
    const csvCell = (value: unknown) => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Name', 'Source', 'Duration (min)', 'Volume', 'Exercises'];
    const rows = filteredWorkouts.map((workout: any) => [
      formatDateWithTimezone(workout.timestamp, settings?.timezone),
      workout.name,
      workout.source,
      workout.duration,
      workout.volume || 0,
      workout.exercises.map((ex: any) => ex.title).join('; '),
    ]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workouts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prData = React.useMemo(() => {
    // Walk workouts oldest-first so we can detect the set where each exercise's
    // all-time-best weight was first reached (a "new PR" at the time it happened).
    const sorted = [...summaryData.workouts].sort(
      (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const bestByExercise: Record<string, number> = {};
    const prSets: Record<string, boolean> = {};
    const recentPRs: Array<{ title: string; weight: number; reps: number; date: string }> = [];

    sorted.forEach((workout: any) => {
      workout.exercises.forEach((ex: any, exIdx: number) => {
        if (ex.type === 'cardio' || ex.type === 'bodyweight') return;
        ex.sets.forEach((set: any, setIdx: number) => {
          const weight = set.weight || 0;
          if (weight <= 0) return;
          const prevBest = bestByExercise[ex.title] || 0;
          if (weight > prevBest) {
            bestByExercise[ex.title] = weight;
            prSets[`${workout.id}-${exIdx}-${setIdx}`] = true;
            recentPRs.push({ title: ex.title, weight, reps: set.reps || 0, date: workout.timestamp });
          }
        });
      });
    });

    return { prSets, recentPRs: recentPRs.reverse().slice(0, 5) };
  }, [summaryData.workouts]);

  const weekVolumeComparison = React.useMemo(() => {
    // Strength-set volume (weight x reps) summed over two trailing 7-day
    // windows, same "strength"/"weightlifting" + weight>0/reps>0 filter as
    // the Progressive Overload Visualizer chart below, so the badge and the
    // chart always agree on what counts as volume.
    const volumeBetween = (startDaysAgo: number, endDaysAgo: number) => {
      const windowStart = Date.now() - endDaysAgo * 24 * 60 * 60 * 1000;
      const windowEnd = Date.now() - startDaysAgo * 24 * 60 * 60 * 1000;
      let total = 0;
      summaryData.workouts.forEach((workout: any) => {
        const t = new Date(workout.timestamp).getTime();
        if (t < windowStart || t >= windowEnd) return;
        workout.exercises.forEach((ex: any) => {
          if (ex.type !== 'strength' && ex.type !== 'weightlifting') return;
          ex.sets.forEach((set: any) => {
            const weight = set.weight_kg || set.weight || 0;
            const reps = set.reps || 0;
            if (weight > 0 && reps > 0) total += weight * reps;
          });
        });
      });
      return total;
    };

    const thisWeek = volumeBetween(0, 7);
    const lastWeek = volumeBetween(7, 14);
    const pctChange = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;
    return { thisWeek, pctChange };
  }, [summaryData.workouts]);

  return (
    <motion.div 
      key="workouts"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Dumbbell size={20} />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Workout History</h2>
            <p className="text-zinc-500 dark:text-zinc-400">Detailed view of your recent sessions and routines</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Workouts */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex flex-wrap justify-between items-center gap-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Recent Sessions</h3>
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input 
                  type="text"
                  placeholder="Search exercises..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-xl outline-none focus:ring-1 focus:ring-emerald-500/50 w-48 transition-all"
                />
              </div>
              <div className="flex bg-zinc-50 dark:bg-zinc-800 p-1 rounded-xl border border-black/5 dark:border-white/5">
                {(['all', 'strength', 'cardio'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setWorkoutTypeFilter(type)}
                    className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      workoutTypeFilter === type
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <div className="flex bg-zinc-50 dark:bg-zinc-800 p-1 rounded-xl border border-black/5 dark:border-white/5">
                {([
                  { key: 'all', label: 'All' },
                  { key: '7d', label: '7d' },
                  { key: '30d', label: '30d' },
                  { key: '90d', label: '90d' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setDateRangeFilter(key)}
                    className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                      dateRangeFilter === key
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={recentSessionsCount}
                onChange={(e) => setRecentSessionsCount(Number(e.target.value))}
                className="text-xs font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-lg px-2 py-1 outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <button
                onClick={exportFilteredWorkoutsCsv}
                disabled={filteredWorkouts.length === 0}
                title="Export the currently filtered sessions as CSV"
                className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-lg px-3 py-1.5 outline-none hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Export CSV
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {(() => {
              const dateRangeDays = dateRangeFilter === '7d' ? 7 : dateRangeFilter === '30d' ? 30 : dateRangeFilter === '90d' ? 90 : null;
              const dateRangeCutoff = dateRangeDays != null ? Date.now() - dateRangeDays * 24 * 60 * 60 * 1000 : null;

              if (filteredWorkouts.length === 0) {
                return (
                  <EmptyState 
                    icon={SearchX}
                    title={searchQuery ? "No matching workouts" : `No ${workoutTypeFilter} sessions`}
                    description={searchQuery ? `We couldn't find any workouts matching "${searchQuery}".` : dateRangeCutoff != null ? "No sessions in this date range. Try widening it to All." : "We couldn't find any workouts matching your filter. Sync your data from Apple Health or Hevy to see them here."}
                    action={!searchQuery && dateRangeCutoff == null ? {
                      label: "Sync Now",
                      onClick: syncAllModules
                    } : undefined}
                  />
                );
              }

              return filteredWorkouts
                .slice(0, recentSessionsCount)
                .map((workout: any) => {
                  const hasExercises = workout.exercises.length > 0;
                  return (
                  <div key={workout.id} className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm hover:border-emerald-500/10 transition-all relative pt-12">
                    <SyncStatus lastSyncStr={workout.timestamp ? formatDateWithTimezone(workout.timestamp, settings?.timezone).split(',')[0] : undefined} sourceName={workout.source} />
                <div 
                  className={`flex justify-between items-start mb-4 ${hasExercises ? 'cursor-pointer' : ''}`}
                  onClick={() => hasExercises && setExpandedWorkouts(prev => ({ ...prev, [workout.id]: !prev[workout.id] }))}
                >
                  <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">{workout.name}</h4>
                        <div className="flex gap-2 flex-wrap">
                          {workout.source === 'apple_health' && (
                            <span className="text-[10px] bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded-full uppercase font-bold flex items-center gap-1">
                              <Activity size={10} /> Apple Health
                            </span>
                          )}
                          {workout.source === 'hevy' && (
                            <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full uppercase font-bold flex items-center gap-1">
                              <Dumbbell size={10} /> Hevy
                            </span>
                          )}
                          {workout.routine_folder && (
                            <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded-full uppercase font-bold">
                              {workout.routine_folder}
                            </span>
                          )}
                        </div>
                      </div>
                      {hasExercises && (
                        expandedWorkouts[workout.id] ? <ChevronUp size={16} className="text-zinc-400 flex-shrink-0" /> : <ChevronDown size={16} className="text-zinc-400 flex-shrink-0" />
                      )}
                    <p className="text-xs text-zinc-400">{formatDateWithTimezone(workout.timestamp, settings?.timezone).split(',')[0]} • {workout.duration} min</p>
                  </div>
                  {!(workout.source === 'apple_health' && (!workout.volume || workout.volume === 0)) && (
                    <span className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-full mt-2 inline-block">
                      {formatWorkoutWeight(workout.volume || 0, settings?.preferred_units)} volume
                    </span>
                  )}
                </div>
                
                {hasExercises && (
                  <div className="space-y-4 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                    {workout.exercises.map((ex: any, idx: number) => (
                      <div key={idx} className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-bold text-zinc-700 dark:text-zinc-300">{ex.title}</span>
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {ex.type === 'cardio' ? 'Cardio' : ex.type === 'bodyweight' ? 'Bodyweight' : `${ex.sets.length} sets`}
                          </span>
                        </div>
                      
                      {expandedWorkouts[workout.id] && (
                        <div className="pl-4 border-l-2 border-zinc-100 dark:border-zinc-800 space-y-1">
                          {(() => {
                            const exSets = ex.sets;
                            const isCardio = ex.type === 'cardio';
                            
                            return (
                              <>
                                {exSets.map((set: any, sIdx: number) => (
                                  <div key={sIdx} className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                                    <span>{isCardio ? (exSets.length > 1 ? `Split ${set.index + 1}` : 'Summary') : `Set ${set.index + 1}`}</span>
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                      {isCardio ? (
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end">
                                          {(set.distance || 0) > 0 && <span>{convertDistance(set.distance / 1000, settings?.preferred_units)}{getDistanceUnit(settings?.preferred_units)}</span>}
                                          {(set.time || 0) > 0 && <span>{Math.floor(set.time / 60)}m {Math.round(set.time % 60)}s</span>}
                                          {(set.steps || 0) > 0 && <span>{set.steps} steps</span>}
                                          {(set.calories || 0) > 0 && <span>{Math.round(set.calories)} kcal</span>}
                                          {(set.heartRate || 0) > 0 && <span>{Math.round(set.heartRate)} bpm avg</span>}
                                          {(set.distance || 0) > 0 && (set.time || 0) > 0 && (
                                            <div className="w-full text-[9px] text-zinc-400 mt-0.5 text-right">
                                              {formatPaceAndSpeed(set.distance, set.time, settings?.preferred_units)}
                                            </div>
                                          )}
                                          {!(set.distance || 0) && !(set.time || 0) && !(set.steps || 0) && !(set.calories || 0) && <span>No data</span>}
                                        </div>
                                      ) : (
                                        <div className="flex flex-col items-end">
                                          <div className="flex gap-1.5 flex-wrap justify-end">
                                            {ex.type === 'bodyweight' ? (
                                              <span>{set.reps} reps</span>
                                            ) : (
                                              <span>{formatWorkoutWeight(set.weight, settings?.preferred_units)} x {set.reps}</span>
                                            )}
                                            {prData.prSets[`${workout.id}-${idx}-${sIdx}`] && (
                                              <span className="text-amber-500" title="New personal record">
                                                <Trophy size={11} />
                                              </span>
                                            )}
                                            {(set.time || 0) > 0 && (
                                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                                • {Math.floor(set.time / 60)}:{(set.time % 60).toString().padStart(2, '0')}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </span>
                                  </div>
                                ))}
                                {isCardio && exSets.length > 1 && (
                                  <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/5 flex justify-between text-[11px] font-bold text-zinc-900 dark:text-zinc-100">
                                    <span>Total</span>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end">
                                      {(() => {
                                        const totalDist = exSets.reduce((acc: number, s: any) => acc + (s.distance || 0), 0);
                                        const totalTime = exSets.reduce((acc: number, s: any) => acc + (s.time || 0), 0);
                                        const totalSteps = exSets.reduce((acc: number, s: any) => acc + (s.steps || 0), 0);
                                        const totalCals = exSets.reduce((acc: number, s: any) => acc + (s.calories || 0), 0);
                                        const avgHr = exSets.filter((s: any) => (s.heartRate || 0) > 0).reduce((acc: number, s: any, _: any, arr: any[]) => acc + (s.heartRate || 0) / arr.length, 0);
                                        
                                        return (
                                          <>
                                            {totalDist > 0 && <span>{convertDistance(totalDist / 1000, settings?.preferred_units)}{getDistanceUnit(settings?.preferred_units)}</span>}
                                            {totalTime > 0 && <span>{Math.floor(totalTime / 60)}m {Math.round(totalTime % 60)}s</span>}
                                            {totalSteps > 0 && <span>{totalSteps} steps</span>}
                                            {totalCals > 0 && <span>{Math.round(totalCals)} kcal</span>}
                                            {avgHr > 0 && <span>{Math.round(avgHr)} bpm avg</span>}
                                            {totalDist > 0 && totalTime > 0 && (
                                              <div className="w-full text-[9px] text-zinc-400 mt-0.5 text-right">
                                                {formatPaceAndSpeed(totalDist, totalTime, settings?.preferred_units)}
                                              </div>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      
                      {!expandedWorkouts[workout.id] && (
                        <div className="flex justify-between items-center text-xs text-zinc-500">
                          <span className="italic">Best set</span>
                          <span className="font-medium">
                            {(() => {
                              // Calculate best set from standardized sets
                              const bestSet = ex.sets.reduce((best: any, current: any) => {
                                if (!best) return current;
                                if (ex.type === 'cardio') {
                                  return (current.distance || 0) > (best.distance || 0) ? current : best;
                                }
                                const currentVol = (current.weight || 0) * (current.reps || 0);
                                const bestVol = (best.weight || 0) * (best.reps || 0);
                                return currentVol > bestVol ? current : best;
                              }, null);

                              if (!bestSet) return "No data";

                              if (ex.type === 'cardio') {
                                return (
                                  <div className="flex flex-col items-end">
                                    <div className="flex gap-2">
                                      {(bestSet.distance || 0) > 0 && <span>{convertDistance(bestSet.distance / 1000, settings?.preferred_units)}{getDistanceUnit(settings?.preferred_units)}</span>}
                                      {(bestSet.time || 0) > 0 && <span>{Math.floor(bestSet.time / 60)}m</span>}
                                      {(bestSet.heartRate || 0) > 0 && <span>{Math.round(bestSet.heartRate)} bpm avg</span>}
                                    </div>
                                  </div>
                                );
                              }

                              return ex.type === 'bodyweight' 
                                ? `${bestSet.reps} reps`
                                : `${formatWorkoutWeight(bestSet.weight || 0, settings?.preferred_units)} x ${bestSet.reps}`;
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
              );
            })
          })()}
        </div>
      </div>

        {/* Volume Overload Visualizer */}
        <div className="space-y-6 mt-8">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Progressive Overload Visualizer</h3>
            <div className="flex items-center gap-2">
              {weekVolumeComparison.thisWeek > 0 && (
                <span
                  title="Strength-set volume (weight x reps), this week vs the trailing 7 days before it"
                  className={`text-xs font-bold px-2 py-1 rounded-lg ${
                    weekVolumeComparison.pctChange == null
                      ? 'text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800'
                      : weekVolumeComparison.pctChange >= 0
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                  }`}
                >
                  {formatWorkoutWeight(weekVolumeComparison.thisWeek, settings?.preferred_units)} this week
                  {weekVolumeComparison.pctChange != null &&
                    ` (${weekVolumeComparison.pctChange >= 0 ? '+' : ''}${weekVolumeComparison.pctChange.toFixed(0)}% vs last wk)`}
                </span>
              )}
              <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-lg">Last 90 Days</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {(() => {
              // Calculate daily total volume for strength workouts over last 90 days
              const ninetyDaysAgo = new Date();
              ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
              
              const volumeData: Record<string, number> = {};
              
              summaryData.workouts.forEach((workout: any) => {
                const wDate = new Date(workout.timestamp);
                if (wDate < ninetyDaysAgo) return;
                
                const day = workout.timestamp.split('T')[0];
                if (!volumeData[day]) volumeData[day] = 0;
                
                let sessionVolume = 0;
                workout.exercises.forEach((ex: any) => {
                  if (ex.type === 'strength' || ex.type === 'weightlifting') {
                    ex.sets.forEach((set: any) => {
                       const weight = set.weight_kg || set.weight || 0;
                       const reps = set.reps || 0;
                       if (weight > 0 && reps > 0) {
                         sessionVolume += (weight * reps);
                       }
                    });
                  }
                });
                volumeData[day] += sessionVolume;
              });

              // Convert to chart array
              const chartData = Object.entries(volumeData)
                 .map(([date, vol]) => {
                   const converted = convertWeight(vol, settings?.preferred_units);
                   // For charts, we definitely want a number.
                   // If it's a stone string, we should probably just use lbs for the chart value.
                   let numericVolume: number;
                   if (typeof converted === 'string') {
                     // For stone, convertWeight returns "Xst Ylb". 
                     // But for chart visualization, we need a single number.
                     // Let's use lbs (kg * 2.20462) for the chart data point.
                     numericVolume = Number((vol * 2.20462).toFixed(0));
                   } else {
                     numericVolume = Number(converted.toFixed(0));
                   }
                   return { date, volume: numericVolume };
                 })
                 .filter(d => d.volume > 0)
                 .sort((a, b) => a.date.localeCompare(b.date));

              if (chartData.length === 0) {
                return (
                  <div className="w-full text-center py-8 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-2xl">
                    <p className="text-zinc-400 dark:text-zinc-500 text-sm italic">Not enough weighted data for volume trend</p>
                  </div>
                );
              }

              return (
                <HealthChart 
                   timezone={settings?.timezone}
                   data={chartData}
                   title="Total Volume Trend"
                   dataKey="volume"
                   color="#10b981"
                   type="bar" // Bar is good for workouts since they aren't everyday
                   unit={settings?.preferred_units === 'metric' ? 'kg' : 'lbs'}
                   preferredUnits={settings?.preferred_units === 'metric' ? 'metric' : 'imperial'}
                   defaultGranularity="day"
                   defaultPeriod="30d"
                />
              );
            })()}
          </div>
        </div>

        {/* Top Exercises View */}
        <div className="space-y-6 mt-8">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Top Exercises</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(() => {
              const exerciseStats: Record<string, { count: number, bestWeight: number, bestReps: number, best1RM: number, type: string }> = {};
              summaryData.workouts.forEach((workout: any) => {
                workout.exercises.forEach((ex: any) => {
                  const title = ex.title;
                  if (!exerciseStats[title]) {
                    exerciseStats[title] = { count: 0, bestWeight: 0, bestReps: 0, best1RM: 0, type: ex.type };
                  }
                  exerciseStats[title].count += 1;

                  ex.sets.forEach((set: any) => {
                    if ((set.weight || 0) > exerciseStats[title].bestWeight) {
                      exerciseStats[title].bestWeight = set.weight;
                    }
                    if ((set.reps || 0) > exerciseStats[title].bestReps) {
                      exerciseStats[title].bestReps = set.reps;
                    }
                    // Epley formula: estimates the 1-rep max implied by a weight x reps set,
                    // so sets at different rep ranges can be compared on the same scale
                    // (a plain "best weight" alone favours low-rep sets).
                    if ((set.weight || 0) > 0 && (set.reps || 0) > 1) {
                      const estimated1RM = set.weight * (1 + set.reps / 30);
                      if (estimated1RM > exerciseStats[title].best1RM) {
                        exerciseStats[title].best1RM = estimated1RM;
                      }
                    }
                  });
                });
              });

              const sortedExercises = Object.entries(exerciseStats)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 10);

              if (sortedExercises.length === 0) {
                return (
                  <div className="col-span-full text-center py-8 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-2xl">
                    <p className="text-zinc-400 dark:text-zinc-500 text-sm italic">No exercises found</p>
                  </div>
                );
              }

              const activeExercise = searchQuery.trim().toLowerCase();

              return sortedExercises.map(([title, stats], idx) => {
                const isActive = activeExercise.length > 0 && title.toLowerCase() === activeExercise;
                return (
                <div
                  key={idx}
                  onClick={() => setSearchQuery(isActive ? '' : title)}
                  title={isActive ? 'Click to clear filter' : `Filter Recent Sessions to ${title}`}
                  className={`bg-white dark:bg-zinc-900 p-4 rounded-2xl border shadow-sm flex items-center justify-between cursor-pointer transition-all ${
                    isActive
                      ? 'border-emerald-500/40 ring-1 ring-emerald-500/30'
                      : 'border-black/5 dark:border-white/5 hover:border-emerald-500/20'
                  }`}
                >
                  <div>
                    <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{title}</h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{stats.count} sessions</p>
                  </div>
                  <div className="text-right">
                    {stats.bestWeight > 0 && (
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatWorkoutWeight(stats.bestWeight, settings?.preferred_units)}</p>
                    )}
                    {stats.bestReps > 0 && stats.bestWeight === 0 && (
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{stats.bestReps} reps</p>
                    )}
                    {stats.best1RM > 0 && (
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500">Est. 1RM {formatWorkoutWeight(stats.best1RM, settings?.preferred_units)}</p>
                    )}
                  </div>
                </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Recent Personal Records */}
        <div className="space-y-6 mt-8">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Recent Personal Records</h3>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {prData.recentPRs.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-2xl">
                <p className="text-zinc-400 dark:text-zinc-500 text-sm italic">No personal records tracked yet</p>
              </div>
            ) : (
              prData.recentPRs.map((pr, idx) => (
                <div key={idx} className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center text-amber-500">
                      <Trophy size={14} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{pr.title}</h4>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatDateWithTimezone(pr.date, settings?.timezone).split(',')[0]}</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-amber-500">{formatWorkoutWeight(pr.weight, settings?.preferred_units)}{pr.reps > 0 ? ` x ${pr.reps}` : ''}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
