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
import { Activity, Moon, Scale, Zap, Utensils, TrendingUp, Target, GripVertical, HeartPulse, Flame, Droplet, Award, X, Gauge, Footprints } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, AreaChart, Area } from 'recharts';
import { HealthChart } from './HealthChart';
import { SortableWidget } from './SortableWidget';
import { computeSleepDebt, formatHours, sleepTargetHours } from '../lib/sleepDebt';
import { SyncButton } from './SyncButton';
import { SyncStatus } from './SyncStatus';
import { SyncHealthWidget } from './SyncHealthWidget';
import { DayTagsCard } from './DayTagsCard';
import { ProgressRing } from './ui/ProgressRing';
import { CardSkeleton, ChartSkeleton } from './ui/Skeleton';
import { ReadinessCard } from './ReadinessCard';
import { SmartAdjustments } from './SmartAdjustments';
import { formatWeight, convertWeight, getWeightUnit, getLocalDateString, formatDateWithTimezone, cn } from '../lib/utils';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { getSleepStagesData, getBloodPressureData, getSleepDurationData } from '../services/healthDataService';
import { BodyDiagram } from './BodyDiagram';
import { computeReadiness } from '../lib/bodyDiagram';
import { isTargetSet } from '../lib/targets';

const BodyDiagramWidget: React.FC<{ workouts: any[]; recoveryDays: number }> = ({ workouts, recoveryDays }) => {
  const regionScores = computeReadiness(workouts, recoveryDays);

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col h-full">
      <div className="mb-2">
        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl inline-flex mb-2">
          <HeartPulse className="text-emerald-500" size={20} />
        </div>
        <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest italic font-serif">
          Muscle Readiness
        </p>
      </div>
      <div className="flex-1 min-h-[360px]">
        <BodyDiagram regionScores={regionScores} />
      </div>
    </div>
  );
};

const PRBanner: React.FC<{ workouts: any[]; unit?: string }> = ({ workouts, unit }) => {
  const [dismissed, setDismissed] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('vh_pr_banner_dismissed') || '[]');
    } catch {
      return [];
    }
  });

  const prs = React.useMemo(() => {
    const sorted = [...(workouts || [])].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const bestByExercise: Record<string, number> = {};
    const found: { key: string; exercise: string; weight: number; date: string }[] = [];
    const cutoff = Date.now() - 7 * 86400000;

    sorted.forEach((w: any) => {
      (w.exercises || []).forEach((ex: any) => {
        if (ex.type !== 'strength' && ex.type !== 'weightlifting') return;
        const name = ex.name || ex.title;
        if (!name) return;
        const maxSetWeight = (ex.sets || []).reduce((m: number, set: any) => {
          const wt = Number(set.weight_kg || set.weight || 0);
          const reps = Number(set.reps || 0);
          return wt > 0 && reps > 0 ? Math.max(m, wt) : m;
        }, 0);
        if (maxSetWeight <= 0) return;

        const prevBest = bestByExercise[name] || 0;
        if (maxSetWeight > prevBest) {
          if (new Date(w.timestamp).getTime() >= cutoff && prevBest > 0) {
            found.push({ key: `${name}_${w.timestamp}`, exercise: name, weight: maxSetWeight, date: w.timestamp });
          }
          bestByExercise[name] = maxSetWeight;
        }
      });
    });

    return found.filter(f => !dismissed.includes(f.key));
  }, [workouts, dismissed]);

  if (prs.length === 0) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    try { localStorage.setItem('vh_pr_banner_dismissed', JSON.stringify(next)); } catch {}
  };

  return (
    <div className="mb-6 space-y-2">
      {prs.map(pr => (
        <div key={pr.key} className="flex items-center justify-between gap-3 bg-gradient-to-r from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-900/5 border border-amber-200/60 dark:border-amber-800/40 rounded-2xl px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-400/20 rounded-xl">
              <Award className="text-amber-500" size={18} />
            </div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              New PR: <span className="font-bold">{pr.exercise}</span> at {formatWeight(pr.weight, unit)}
            </p>
          </div>
          <button onClick={() => dismiss(pr.key)} className="p-1 hover:bg-amber-200/40 dark:hover:bg-amber-800/30 rounded-lg transition-colors">
            <X size={14} className="text-amber-600 dark:text-amber-400" />
          </button>
        </div>
      ))}
    </div>
  );
};

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
    return target && isTargetSet(target.value) ? Number(target.value) : undefined;
  };

  const getTodayTotal = (type: string) => {
    const today = getLocalDateString(settings.timezone);
    const metrics = summaryData.metrics || [];
    const metric = metrics.find((m: any) => m.type === type && m.timestamp === today);
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
      <PRBanner workouts={summaryData.workouts || []} unit={settings?.preferred_units} />
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
            <div className="col-span-1">
              <DayTagsCard />
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
                                        const total = metrics.find((m: any) => m.type === 'sleep_total') ||
                                                     metrics.find((m: any) => m.type === 'sleep') ||
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
                                {(() => {
                                    const stages = getSleepStagesData(summaryData.metrics || [], settings?.timezone);
                                    const latest: any = stages[stages.length - 1];
                                    if (!latest) return null;
                                    const segments = [
                                        { key: 'awake', label: 'Awake', color: '#f43f5e' },
                                        { key: 'deep', label: 'Deep', color: '#4338ca' },
                                        { key: 'core', label: 'Light', color: '#10b981' },
                                        { key: 'rem', label: 'REM', color: '#818cf8' },
                                    ].map(s => ({ ...s, hours: Number(latest[s.key] || 0) }));
                                    const total = segments.reduce((sum, s) => sum + s.hours, 0);
                                    if (total <= 0) return null;
                                    return (
                                        <div className="mt-4">
                                            <div className="flex w-full h-2 rounded-full overflow-hidden">
                                                {segments.filter(s => s.hours > 0).map(s => (
                                                    <div
                                                        key={s.key}
                                                        style={{ width: `${(s.hours / total) * 100}%`, backgroundColor: s.color }}
                                                    />
                                                ))}
                                            </div>
                                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                                                {segments.filter(s => s.hours > 0).map(s => (
                                                    <span key={s.key} className="text-[10px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
                                                        {s.label} {(s.hours * 60).toFixed(0)}m
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
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
                                {(() => {
                                    const weightEntries = (summaryData.metrics || [])
                                        .filter((m: any) => m.type === 'weight' && m.value != null)
                                        .slice()
                                        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                                    if (weightEntries.length < 2) return null;

                                    const latest = weightEntries[weightEntries.length - 1];
                                    const sevenDaysAgo = new Date(latest.timestamp).getTime() - 7 * 24 * 60 * 60 * 1000;
                                    const priorEntries = weightEntries.slice(0, -1).filter((m: any) => new Date(m.timestamp).getTime() <= sevenDaysAgo);
                                    const baseline = priorEntries.length > 0
                                        ? priorEntries[priorEntries.length - 1]
                                        : weightEntries[0];
                                    if (!baseline || baseline === latest) return null;

                                    const deltaKg = Number(latest.value) - Number(baseline.value);
                                    if (Math.abs(deltaKg) < 0.05) {
                                        return <p className="text-xs text-zinc-400 mt-1">No change this week</p>;
                                    }
                                    const deltaDisplay = formatWeight(Math.abs(deltaKg), settings?.preferred_units);
                                    const isUp = deltaKg > 0;
                                    return (
                                        <p className={cn("text-xs mt-1 font-medium", isUp ? "text-amber-500" : "text-emerald-500")}>
                                            {isUp ? '▲' : '▼'} {deltaDisplay} this week
                                        </p>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                    {widgetId === 'weight_goal_progress' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col items-center justify-center h-full">
                            {(() => {
                                const weightTarget = (targets || []).find((t: any) => t.type === 'weight' && isTargetSet(t.value));
                                const weightEntries = (summaryData.metrics || [])
                                    .filter((m: any) => m.type === 'weight' && m.value != null)
                                    .slice()
                                    .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                                if (!weightTarget || weightEntries.length === 0) {
                                    return (
                                        <>
                                            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-xl mb-4 self-start">
                                                <Target className="text-purple-500" size={20} />
                                            </div>
                                            <p className="text-xs text-zinc-400 text-center">Set a weight target and log weight to see progress</p>
                                        </>
                                    );
                                }

                                const start = Number(weightEntries[0].value);
                                const current = Number(weightEntries[weightEntries.length - 1].value);
                                const goal = Number(weightTarget.value);

                                const totalDelta = start - goal;
                                let progress = totalDelta === 0 ? 100 : ((start - current) / totalDelta) * 100;
                                progress = Math.max(0, Math.min(100, progress));

                                const remaining = current - goal;

                                const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
                                const recentEntries = weightEntries.filter((m: any) => new Date(m.timestamp).getTime() >= thirtyDaysAgo);
                                let etaLabel: string | null = null;
                                if (recentEntries.length >= 2) {
                                    const first = recentEntries[0];
                                    const last = recentEntries[recentEntries.length - 1];
                                    const days = (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / (1000 * 60 * 60 * 24);
                                    const dailyRate = days > 0 ? (Number(last.value) - Number(first.value)) / days : 0;
                                    const movingTowardGoal = (goal < current && dailyRate < 0) || (goal > current && dailyRate > 0);
                                    if (movingTowardGoal && dailyRate !== 0) {
                                        const daysToGoal = Math.abs(remaining / dailyRate);
                                        const weeks = Math.round(daysToGoal / 7);
                                        etaLabel = weeks <= 1 ? '~1 week left' : `~${weeks} weeks left`;
                                    }
                                }

                                return (
                                    <>
                                        <ProgressRing
                                            progress={progress}
                                            color="#a855f7"
                                            value={`${Math.round(progress)}%`}
                                            label="To Goal"
                                        />
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3 text-center">
                                            {formatWeight(current, settings?.preferred_units)} &rarr; {formatWeight(goal, settings?.preferred_units)}
                                        </p>
                                        {etaLabel && (
                                            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">{etaLabel} at current rate</p>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'weekly_trends' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-cyan-50 dark:bg-cyan-900/20 rounded-xl">
                                    <TrendingUp className="text-cyan-500" size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-3 italic font-serif">This Week vs Last Week</p>
                            {(() => {
                                const metrics = summaryData.metrics || [];
                                const now = Date.now();
                                const weekAvg = (type: string, startDaysAgo: number, endDaysAgo: number) => {
                                    const inWindow = metrics.filter((m: any) => {
                                        if (m.type !== type || m.value == null) return false;
                                        const daysAgo = (now - new Date(m.timestamp).getTime()) / 86400000;
                                        return daysAgo >= startDaysAgo && daysAgo < endDaysAgo;
                                    });
                                    if (inWindow.length === 0) return null;
                                    return inWindow.reduce((s: number, m: any) => s + Number(m.value), 0) / inWindow.length;
                                };

                                const rows = [
                                    { type: 'steps', label: 'Steps', fmt: (v: number) => Math.round(v).toLocaleString() },
                                    { type: 'active_energy', label: 'Active Energy', fmt: (v: number) => `${Math.round(v)} kcal` },
                                    { type: 'resting_heart_rate', label: 'Resting HR', fmt: (v: number) => `${Math.round(v)} bpm` },
                                    { type: 'weight', label: 'Weight', fmt: (v: number) => formatWeight(v, settings?.preferred_units) },
                                ];

                                const computed = rows
                                    .map(row => ({ ...row, thisWeek: weekAvg(row.type, 0, 7), lastWeek: weekAvg(row.type, 7, 14) }))
                                    .filter(r => r.thisWeek !== null);

                                if (computed.length === 0) {
                                    return <p className="text-xs text-zinc-400">Not enough data yet to compare weeks</p>;
                                }

                                return (
                                    <div className="space-y-3">
                                        {computed.map(r => {
                                            const delta = r.lastWeek !== null ? (r.thisWeek as number) - r.lastWeek : null;
                                            const pct = (r.lastWeek !== null && r.lastWeek !== 0) ? ((delta as number) / r.lastWeek) * 100 : null;
                                            return (
                                                <div key={r.type} className="flex items-center justify-between">
                                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{r.label}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-mono">{r.fmt(r.thisWeek as number)}</span>
                                                        {delta !== null && Math.abs(delta) > 0.01 && (
                                                            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 flex items-center gap-0.5">
                                                                {delta > 0 ? '▲' : '▼'}{pct !== null ? ` ${Math.abs(pct).toFixed(0)}%` : ''}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'sleep_consistency' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                                    <Moon className="text-indigo-500" size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Sleep Trend & Consistency</p>
                            {(() => {
                                const nightly = getSleepDurationData(summaryData.metrics || [], settings?.timezone);
                                const now = Date.now();
                                const windowAvg = (startDaysAgo: number, endDaysAgo: number) => {
                                    const inWindow = nightly.filter((d: any) => {
                                        const daysAgo = (now - new Date(d.date).getTime()) / 86400000;
                                        return daysAgo >= startDaysAgo && daysAgo < endDaysAgo;
                                    });
                                    return { entries: inWindow, avg: inWindow.length ? inWindow.reduce((s: number, d: any) => s + d.hours, 0) / inWindow.length : null };
                                };

                                const thisWeek = windowAvg(0, 7);
                                const lastWeek = windowAvg(7, 14);

                                if (thisWeek.avg === null) {
                                    return <p className="text-xs text-zinc-400">Not enough sleep data yet</p>;
                                }

                                const inRange = thisWeek.entries.filter((d: any) => d.hours >= 7 && d.hours <= 9).length;
                                const delta = lastWeek.avg !== null ? thisWeek.avg - lastWeek.avg : null;

                                return (
                                    <div>
                                        <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                            {thisWeek.avg.toFixed(1)}h
                                            {delta !== null && Math.abs(delta) > 0.05 && (
                                                <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500 ml-2">
                                                    {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}h
                                                </span>
                                            )}
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                                            7-day average &middot; {inRange}/{thisWeek.entries.length} nights in 7-9h range
                                        </p>
                                        {(() => {
                                            const debt = computeSleepDebt(nightly, sleepTargetHours(targets || []), getLocalDateString(settings?.timezone));
                                            if (!debt) return null;
                                            return (
                                                <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                                    <p className={cn(
                                                        "text-sm font-semibold",
                                                        debt.level === 'high' ? "text-rose-600 dark:text-rose-400"
                                                            : debt.level === 'some' ? "text-amber-600 dark:text-amber-400"
                                                            : "text-emerald-600 dark:text-emerald-400"
                                                    )}>
                                                        {debt.debtHours > 0 ? `Sleep debt ${formatHours(debt.debtHours)}` : 'No sleep debt'}
                                                    </p>
                                                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                        Last {debt.windowNights} days vs your {formatHours(debt.targetHours)} target &middot; {debt.shortNights}/{debt.nights} nights short
                                                        {debt.level !== 'ok' && <> &middot; about {debt.paybackMinutesPerNight} min extra a night for a week clears it</>}
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'water_intake' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-sky-50 dark:bg-sky-900/20 rounded-xl">
                                    <Droplet className="text-sky-500" size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Water Intake</p>
                            {(() => {
                                const waterEntries = (summaryData.metrics || []).filter((m: any) => m.type === 'water');
                                if (waterEntries.length === 0) {
                                    return <p className="text-xs text-zinc-400">No water intake logged yet</p>;
                                }

                                const today = getLocalDateString(settings?.timezone);
                                const todayEntry = waterEntries.find((m: any) => m.timestamp === today);
                                const todayMl = todayEntry ? Number(todayEntry.value) : 0;
                                const last7 = waterEntries.slice(0, 7);
                                const avg7 = last7.reduce((s: number, m: any) => s + Number(m.value), 0) / last7.length;
                                const target = (targets || []).find((t: any) => t.type === 'water' && isTargetSet(t.value));
                                const pct = target ? Math.min((todayMl / Number(target.value)) * 100, 100) : null;

                                return (
                                    <div>
                                        <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                            {Math.round(todayMl)}<span className="text-base font-semibold text-zinc-400 dark:text-zinc-500 ml-1">ml</span>
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                                            {pct !== null && `${pct.toFixed(0)}% of ${Math.round(Number(target.value))}ml target · `}
                                            7d avg: {Math.round(avg7)}ml
                                        </p>
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'todays_targets' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                                    <Target className="text-indigo-500" size={20} />
                                </div>
                                <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest italic font-serif">Today's Targets</p>
                            </div>
                            {(() => {
                                // Mirrors TargetsTab.tsx's verified TARGET_METRIC_MAP (2026-09-14): metric
                                // type names and units don't always match the target's own type/unit.
                                const TARGET_META: Record<string, { metricType: string; convert?: (v: number) => number; label: string; unit?: string; decimals?: number; isWeight?: boolean }> = {
                                    weight: { metricType: 'weight', label: 'Weight', isWeight: true },
                                    steps: { metricType: 'steps', label: 'Steps', decimals: 0 },
                                    calories: { metricType: 'calories_in', label: 'Calories', unit: 'kcal', decimals: 0 },
                                    protein: { metricType: 'protein', label: 'Protein', unit: 'g', decimals: 0 },
                                    carbs: { metricType: 'carbs', label: 'Carbs', unit: 'g', decimals: 0 },
                                    fat: { metricType: 'fat', label: 'Fat', unit: 'g', decimals: 0 },
                                    fiber: { metricType: 'fiber', label: 'Fiber', unit: 'g', decimals: 0 },
                                    water: { metricType: 'water', label: 'Water', unit: 'ml', decimals: 0 },
                                    active_energy: { metricType: 'active_energy', label: 'Active Energy', convert: (v: number) => v / 4.184, unit: 'kcal', decimals: 0 },
                                    sleep: { metricType: 'sleep', label: 'Sleep', convert: (v: number) => v / 3600, unit: 'h', decimals: 1 },
                                    exercise_time: { metricType: 'exercise_time', label: 'Exercise Time', unit: 'min', decimals: 0 },
                                    stand_time: { metricType: 'stand_time', label: 'Stand Time', convert: (v: number) => v / 60, unit: 'h', decimals: 1 },
                                    resting_heart_rate: { metricType: 'resting_heart_rate', label: 'Resting HR', unit: 'bpm', decimals: 0 },
                                    body_fat: { metricType: 'body_fat', label: 'Body Fat', unit: '%', decimals: 1 },
                                    muscle_mass: { metricType: 'muscle_mass', label: 'Muscle Mass', isWeight: true },
                                    vo2_max: { metricType: 'vo2max', label: 'VO2 Max', unit: 'ml/kg/min', decimals: 1 },
                                    blood_oxygen_saturation: { metricType: 'oxygen_saturation', label: 'Oxygen Sat', unit: '%', decimals: 0 },
                                };
                                const ORDER = ['weight', 'steps', 'calories', 'protein', 'carbs', 'fat', 'water', 'active_energy', 'sleep', 'fiber', 'exercise_time', 'stand_time', 'resting_heart_rate', 'body_fat', 'muscle_mass', 'vo2_max', 'blood_oxygen_saturation'];

                                const rows = ORDER.map(type => {
                                    // Unset targets are null in the store (the API still stores 0); never treat either as a real goal.
                                    const target = (targets || []).find((t: any) => t.type === type && isTargetSet(t.value));
                                    const meta = TARGET_META[type];
                                    if (!target || !meta) return null;
                                    const latest = (summaryData.latestMetrics || []).find((m: any) => m.type === meta.metricType);
                                    if (!latest || latest.value == null) return null;
                                    const rawCurrent = Number(latest.value);
                                    const current = meta.convert ? meta.convert(rawCurrent) : rawCurrent;
                                    const goal = Number(target.value);
                                    const pct = (current / goal) * 100;
                                    const fmt = (v: number) => meta.isWeight ? formatWeight(v, settings?.preferred_units) : `${v.toFixed(meta.decimals ?? 0)}${meta.unit ? ' ' + meta.unit : ''}`;
                                    return { type, label: meta.label, pct, currentLabel: fmt(current), goalLabel: fmt(goal) };
                                }).filter((r): r is { type: string; label: string; pct: number; currentLabel: string; goalLabel: string } => r !== null);

                                if (rows.length === 0) {
                                    return <p className="text-xs text-zinc-400 text-center py-4">Set targets and log data to see progress here</p>;
                                }

                                return (
                                    <div className="space-y-3">
                                        {rows.map(row => (
                                            <div key={row.type}>
                                                <div className="flex justify-between items-baseline mb-1">
                                                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{row.label}</span>
                                                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{row.currentLabel} / {row.goalLabel} &middot; {Math.round(row.pct)}%</span>
                                                </div>
                                                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-indigo-500 rounded-full"
                                                        style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
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
                              const todayMetrics = metrics.filter((m: any) => m.timestamp === today);

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
                              const todayMetrics = metrics.filter((m: any) => m.timestamp === today);

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
                    {widgetId === 'workout_streak' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                          <div>
                            <div className="flex justify-between items-start mb-4">
                              <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                                <Flame className="text-orange-500" size={20} />
                              </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Workout Streak</p>
                            {(() => {
                              const workoutDates = new Set(
                                (summaryData.workouts || []).map((w: any) => w.timestamp.split('T')[0])
                              );

                              const toDateStr = (d: Date) => d.toISOString().split('T')[0];
                              const addDays = (d: Date, n: number) => {
                                const nd = new Date(d);
                                nd.setDate(nd.getDate() + n);
                                return nd;
                              };

                              const today = new Date(getLocalDateString(settings?.timezone));
                              let cursor = workoutDates.has(toDateStr(today)) ? today : addDays(today, -1);
                              let currentStreak = 0;
                              while (workoutDates.has(toDateStr(cursor))) {
                                currentStreak++;
                                cursor = addDays(cursor, -1);
                              }

                              const sortedDates = Array.from(workoutDates).sort() as string[];
                              let longestStreak = 0;
                              let run = 0;
                              let prevDateStr: string | null = null;
                              sortedDates.forEach((dateStr) => {
                                if (prevDateStr && toDateStr(addDays(new Date(prevDateStr), 1)) === dateStr) {
                                  run++;
                                } else {
                                  run = 1;
                                }
                                longestStreak = Math.max(longestStreak, run);
                                prevDateStr = dateStr;
                              });

                              const gridDays = Array.from({ length: 84 }, (_, i) => addDays(today, i - 83));
                              const countsByDate: Record<string, number> = {};
                              (summaryData.workouts || []).forEach((w: any) => {
                                const d = w.timestamp.split('T')[0];
                                countsByDate[d] = (countsByDate[d] || 0) + 1;
                              });

                              return (
                                <>
                                  <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                    {currentStreak} <span className="text-sm text-zinc-400">day{currentStreak === 1 ? '' : 's'}</span>
                                  </p>
                                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">Longest: {longestStreak} day{longestStreak === 1 ? '' : 's'}</p>
                                  <div className="grid grid-flow-col grid-rows-7 gap-1">
                                    {gridDays.map((d, i) => {
                                      const dateStr = toDateStr(d);
                                      const count = countsByDate[dateStr] || 0;
                                      const colorClass = count === 0
                                        ? 'bg-zinc-100 dark:bg-zinc-800'
                                        : count === 1
                                        ? 'bg-emerald-200 dark:bg-emerald-900/50'
                                        : 'bg-emerald-500 dark:bg-emerald-500';
                                      return (
                                        <div
                                          key={i}
                                          title={`${dateStr}: ${count} workout${count === 1 ? '' : 's'}`}
                                          className={`w-2.5 h-2.5 rounded-sm ${colorClass}`}
                                        />
                                      );
                                    })}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                    )}
                    {widgetId === 'nutrition_streak' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                          <div>
                            <div className="flex justify-between items-start mb-4">
                              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                                <Utensils className="text-amber-500" size={20} />
                              </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Nutrition Logging Streak</p>
                            {(() => {
                              const loggedDates = new Set(
                                (summaryData.metrics || [])
                                  .filter((m: any) => m.type === 'calories_in' && Number(m.value) > 0)
                                  .map((m: any) => m.timestamp)
                              );

                              const toDateStr = (d: Date) => d.toISOString().split('T')[0];
                              const addDays = (d: Date, n: number) => {
                                const nd = new Date(d);
                                nd.setDate(nd.getDate() + n);
                                return nd;
                              };

                              const today = new Date(getLocalDateString(settings?.timezone));
                              let cursor = loggedDates.has(toDateStr(today)) ? today : addDays(today, -1);
                              let currentStreak = 0;
                              while (loggedDates.has(toDateStr(cursor))) {
                                currentStreak++;
                                cursor = addDays(cursor, -1);
                              }

                              const sortedDates = Array.from(loggedDates).sort() as string[];
                              let longestStreak = 0;
                              let run = 0;
                              let prevDateStr: string | null = null;
                              sortedDates.forEach((dateStr) => {
                                if (prevDateStr && toDateStr(addDays(new Date(prevDateStr), 1)) === dateStr) {
                                  run++;
                                } else {
                                  run = 1;
                                }
                                longestStreak = Math.max(longestStreak, run);
                                prevDateStr = dateStr;
                              });

                              const gridDays = Array.from({ length: 84 }, (_, i) => addDays(today, i - 83));

                              return (
                                <>
                                  <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                    {currentStreak} <span className="text-sm text-zinc-400">day{currentStreak === 1 ? '' : 's'}</span>
                                  </p>
                                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">Longest: {longestStreak} day{longestStreak === 1 ? '' : 's'}</p>
                                  <div className="grid grid-flow-col grid-rows-7 gap-1">
                                    {gridDays.map((d, i) => {
                                      const dateStr = toDateStr(d);
                                      const logged = loggedDates.has(dateStr);
                                      return (
                                        <div
                                          key={i}
                                          title={`${dateStr}: ${logged ? 'logged' : 'no log'}`}
                                          className={`w-2.5 h-2.5 rounded-sm ${logged ? 'bg-amber-500 dark:bg-amber-500' : 'bg-zinc-100 dark:bg-zinc-800'}`}
                                        />
                                      );
                                    })}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                    )}
                    {widgetId === 'step_streak' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                          <div>
                            <div className="flex justify-between items-start mb-4">
                              <div className="p-2 bg-sky-50 dark:bg-sky-900/20 rounded-xl">
                                <Footprints className="text-sky-500" size={20} />
                              </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Step Goal Streak</p>
                            {(() => {
                              const stepTarget = getTargetValue('steps');
                              if (!stepTarget) {
                                return <p className="text-xs text-zinc-400 dark:text-zinc-500">Set a steps target to track your streak</p>;
                              }

                              const metThreshold = (summaryData.metrics || [])
                                .filter((m: any) => m.type === 'steps' && Number(m.value) >= stepTarget)
                                .map((m: any) => m.timestamp);
                              const metDates = new Set(metThreshold);

                              const toDateStr = (d: Date) => d.toISOString().split('T')[0];
                              const addDays = (d: Date, n: number) => {
                                const nd = new Date(d);
                                nd.setDate(nd.getDate() + n);
                                return nd;
                              };

                              const today = new Date(getLocalDateString(settings?.timezone));
                              let cursor = metDates.has(toDateStr(today)) ? today : addDays(today, -1);
                              let currentStreak = 0;
                              while (metDates.has(toDateStr(cursor))) {
                                currentStreak++;
                                cursor = addDays(cursor, -1);
                              }

                              const sortedDates = Array.from(metDates).sort() as string[];
                              let longestStreak = 0;
                              let run = 0;
                              let prevDateStr: string | null = null;
                              sortedDates.forEach((dateStr) => {
                                if (prevDateStr && toDateStr(addDays(new Date(prevDateStr), 1)) === dateStr) {
                                  run++;
                                } else {
                                  run = 1;
                                }
                                longestStreak = Math.max(longestStreak, run);
                                prevDateStr = dateStr;
                              });

                              const gridDays = Array.from({ length: 84 }, (_, i) => addDays(today, i - 83));

                              return (
                                <>
                                  <p className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">
                                    {currentStreak} <span className="text-sm text-zinc-400">day{currentStreak === 1 ? '' : 's'}</span>
                                  </p>
                                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">Longest: {longestStreak} day{longestStreak === 1 ? '' : 's'} &middot; Target: {Math.round(stepTarget).toLocaleString()} steps/day</p>
                                  <div className="grid grid-flow-col grid-rows-7 gap-1">
                                    {gridDays.map((d, i) => {
                                      const dateStr = toDateStr(d);
                                      const met = metDates.has(dateStr);
                                      return (
                                        <div
                                          key={i}
                                          title={`${dateStr}: ${met ? 'goal met' : 'goal not met'}`}
                                          className={`w-2.5 h-2.5 rounded-sm ${met ? 'bg-sky-500 dark:bg-sky-500' : 'bg-zinc-100 dark:bg-zinc-800'}`}
                                        />
                                      );
                                    })}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                    )}
                    {widgetId === 'workout_stats' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-teal-50 dark:bg-teal-900/20 rounded-xl">
                                    <Activity className="text-teal-500" size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-3 italic font-serif">Workout Stats</p>
                            {(() => {
                                const now = Date.now();
                                const inWindow = (startDaysAgo: number, endDaysAgo: number) =>
                                    (summaryData.workouts || []).filter((w: any) => {
                                        const daysAgo = (now - new Date(w.timestamp).getTime()) / 86400000;
                                        return daysAgo >= startDaysAgo && daysAgo < endDaysAgo;
                                    });

                                const sessionVolume = (w: any) => (w.exercises || []).reduce((sum: number, ex: any) => {
                                    if (ex.type !== 'strength' && ex.type !== 'weightlifting') return sum;
                                    return sum + (ex.sets || []).reduce((s: number, set: any) => {
                                        const weight = set.weight_kg || set.weight || 0;
                                        const reps = set.reps || 0;
                                        return s + (weight > 0 && reps > 0 ? weight * reps : 0);
                                    }, 0);
                                }, 0);

                                const summarize = (workouts: any[]) => ({
                                    sessions: workouts.length,
                                    volume: workouts.reduce((s: number, w: any) => s + sessionVolume(w), 0),
                                    minutes: workouts.reduce((s: number, w: any) => s + (Number(w.duration) || 0), 0),
                                });

                                const thisWeek = summarize(inWindow(0, 7));
                                const lastWeek = summarize(inWindow(7, 14));

                                const pctDelta = (cur: number, prev: number) => {
                                    if (prev === 0) return cur > 0 ? null : 0;
                                    return ((cur - prev) / prev) * 100;
                                };

                                const tiles = [
                                    { label: 'Sessions', value: `${thisWeek.sessions}`, pct: pctDelta(thisWeek.sessions, lastWeek.sessions) },
                                    { label: 'Volume', value: formatWeight(thisWeek.volume, settings?.preferred_units), pct: pctDelta(thisWeek.volume, lastWeek.volume) },
                                    { label: 'Time', value: `${Math.round(thisWeek.minutes / 60)}h ${Math.round(thisWeek.minutes % 60)}m`, pct: pctDelta(thisWeek.minutes, lastWeek.minutes) },
                                ];

                                return (
                                    <div className="grid grid-cols-3 gap-3">
                                        {tiles.map(t => (
                                            <div key={t.label} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3">
                                                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1">{t.label}</p>
                                                <p className="text-lg font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">{t.value}</p>
                                                {t.pct !== null && (
                                                    <p className={cn(
                                                        "text-[10px] font-mono mt-0.5",
                                                        t.pct > 0 ? "text-emerald-500" : t.pct < 0 ? "text-rose-500" : "text-zinc-400"
                                                    )}>
                                                        {t.pct === 0 ? '—' : `${t.pct > 0 ? '▲' : '▼'} ${Math.abs(t.pct).toFixed(0)}% vs last wk`}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'training_status' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-violet-50 dark:bg-violet-900/20 rounded-xl">
                                    <Gauge className="text-violet-500" size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-3 italic font-serif">Training Status</p>
                            {(() => {
                                const now = Date.now();
                                const sessionVolume = (w: any) => (w.exercises || []).reduce((sum: number, ex: any) => {
                                    if (ex.type !== 'strength' && ex.type !== 'weightlifting') return sum;
                                    return sum + (ex.sets || []).reduce((s: number, set: any) => {
                                        const weight = set.weight_kg || set.weight || 0;
                                        const reps = set.reps || 0;
                                        return s + (weight > 0 && reps > 0 ? weight * reps : 0);
                                    }, 0);
                                }, 0);

                                const loadInWindow = (days: number) => (summaryData.workouts || [])
                                    .filter((w: any) => (now - new Date(w.timestamp).getTime()) / 86400000 < days)
                                    .reduce((s: number, w: any) => s + sessionVolume(w), 0);

                                const acute = loadInWindow(7) / 7;
                                const chronic = loadInWindow(28) / 28;

                                if (chronic === 0 && acute === 0) {
                                    return <p className="text-xs text-zinc-400">Not enough workout history yet</p>;
                                }

                                const ratio = chronic > 0 ? acute / chronic : (acute > 0 ? 2 : 0);

                                let zone = { label: 'Detraining', color: 'text-sky-500', bg: 'bg-sky-500', note: 'Load is well below your usual — room to build back up.' };
                                if (ratio >= 0.8 && ratio < 1.3) zone = { label: 'Optimal', color: 'text-emerald-500', bg: 'bg-emerald-500', note: "You're training in a sustainable, well-balanced zone." };
                                else if (ratio >= 1.3 && ratio < 1.5) zone = { label: 'Building', color: 'text-amber-500', bg: 'bg-amber-500', note: 'Load is ramping up — keep an eye on recovery.' };
                                else if (ratio >= 1.5) zone = { label: 'High Risk', color: 'text-rose-500', bg: 'bg-rose-500', note: 'Load has spiked sharply versus your recent average — elevated injury risk.' };

                                const pct = Math.min(100, (ratio / 2) * 100);

                                return (
                                    <div>
                                        <div className="flex items-baseline gap-2 mb-2">
                                            <span className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-100 font-mono">{ratio.toFixed(2)}</span>
                                            <span className={cn("text-sm font-bold", zone.color)}>{zone.label}</span>
                                        </div>
                                        <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
                                            <div className={cn("h-full rounded-full", zone.bg)} style={{ width: `${pct}%` }} />
                                        </div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{zone.note}</p>
                                        <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-3 uppercase tracking-wide">7-day load ÷ 28-day load</p>
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'training_trends' && (
                        <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-fuchsia-50 dark:bg-fuchsia-900/20 rounded-xl">
                                    <TrendingUp className="text-fuchsia-500" size={20} />
                                </div>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-3 italic font-serif">Training Trends</p>
                            {(() => {
                                const sessionVolume = (w: any) => (w.exercises || []).reduce((sum: number, ex: any) => {
                                    if (ex.type !== 'strength' && ex.type !== 'weightlifting') return sum;
                                    return sum + (ex.sets || []).reduce((s: number, set: any) => {
                                        const weight = set.weight_kg || set.weight || 0;
                                        const reps = set.reps || 0;
                                        return s + (weight > 0 && reps > 0 ? weight * reps : 0);
                                    }, 0);
                                }, 0);

                                const months: Record<string, { volume: number; calories: number; minutes: number }> = {};
                                (summaryData.workouts || []).forEach((w: any) => {
                                    const key = (w.timestamp || '').slice(0, 7);
                                    if (key.length < 7) return;
                                    if (!months[key]) months[key] = { volume: 0, calories: 0, minutes: 0 };
                                    months[key].volume += sessionVolume(w);
                                    months[key].calories += Number(w.calories) || 0;
                                    months[key].minutes += Number(w.duration) || 0;
                                });

                                const sortedKeys = Object.keys(months).sort().slice(-6);
                                if (sortedKeys.length < 2) {
                                    return <p className="text-xs text-zinc-400">Not enough monthly history yet</p>;
                                }

                                const series = sortedKeys.map(k => ({ month: k, ...months[k] }));
                                const last: any = series[series.length - 1];
                                const prev: any = series[series.length - 2];
                                const pctDelta = (cur: number, p: number) => p === 0 ? null : ((cur - p) / p) * 100;

                                const cards = [
                                    { key: 'volume', label: 'Volume', color: '#0d9488', fmt: (v: number) => formatWeight(v, settings?.preferred_units) },
                                    { key: 'calories', label: 'Calories', color: '#ea580c', fmt: (v: number) => `${Math.round(v)} kcal` },
                                    { key: 'minutes', label: 'Time', color: '#7c3aed', fmt: (v: number) => `${Math.round(v / 60)}h` },
                                ];

                                return (
                                    <div className="grid grid-cols-1 gap-4">
                                        {cards.map(c => {
                                            const pct = pctDelta(last[c.key], prev[c.key]);
                                            return (
                                                <div key={c.key} className="flex items-center gap-3">
                                                    <div className="flex-1">
                                                        <div className="flex items-baseline justify-between mb-1">
                                                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">{c.label}</span>
                                                            {pct !== null && (
                                                                <span className={cn("text-[10px] font-mono", pct > 0 ? "text-emerald-500" : pct < 0 ? "text-rose-500" : "text-zinc-400")}>
                                                                    {pct === 0 ? '—' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="h-10 w-full">
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <AreaChart data={series}>
                                                                    <defs>
                                                                        <linearGradient id={`grad-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                                                                            <stop offset="5%" stopColor={c.color} stopOpacity={0.3} />
                                                                            <stop offset="95%" stopColor={c.color} stopOpacity={0} />
                                                                        </linearGradient>
                                                                    </defs>
                                                                    <Area type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={2} fill={`url(#grad-${c.key})`} />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        </div>
                                                        <span className="text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-300">{c.fmt(last[c.key])}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {widgetId === 'muscle_heatmap' && (
                      <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col justify-between h-full">
                        <div>
                          <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-rose-50 dark:bg-rose-900/20 rounded-xl">
                              <Flame className="text-rose-500" size={20} />
                            </div>
                          </div>
                          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">Muscle Group Load (7d)</p>
                          <div className="h-56 w-full relative">
                            {(() => {
                              const now = Date.now();
                              const cutoff = now - 7 * 86400000;
                              const loadByGroup: Record<string, number> = {};

                              (summaryData.workouts || []).forEach((w: any) => {
                                if (new Date(w.timestamp).getTime() < cutoff) return;
                                (w.exercises || []).forEach((ex: any) => {
                                  const setCount = (ex.sets || []).length;
                                  if (!setCount) return;
                                  if (ex.primaryMuscleGroup) {
                                    loadByGroup[ex.primaryMuscleGroup] = (loadByGroup[ex.primaryMuscleGroup] || 0) + setCount;
                                  }
                                  (ex.secondaryMuscleGroups || []).forEach((g: string) => {
                                    loadByGroup[g] = (loadByGroup[g] || 0) + setCount * 0.5;
                                  });
                                });
                              });

                              const entries = Object.entries(loadByGroup).sort((a, b) => b[1] - a[1]);
                              if (entries.length === 0) {
                                return <p className="text-xs text-zinc-400">No muscle group data yet — sync Hevy to populate.</p>;
                              }

                              const max = Math.max(...entries.map(([, v]) => v));
                              const data = entries.slice(0, 8).map(([group, v]) => ({
                                subject: group.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                A: Math.round(v * 10) / 10,
                                fullMark: max
                              }));

                              return (
                                <ResponsiveContainer width="100%" height="100%">
                                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                                    <PolarGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 9, fontWeight: 600 }} />
                                    <PolarRadiusAxis domain={[0, max]} tick={false} axisLine={false} />
                                    <Radar name="Sets" dataKey="A" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.5} />
                                    <Tooltip
                                      formatter={(value: any) => [`${Number(value).toFixed(1)} sets`, 'Load']}
                                      contentStyle={{ borderRadius: '12px', border: '1px solid rgba(0,0,0,0.05)', fontSize: '12px', fontWeight: 'bold' }}
                                    />
                                  </RadarChart>
                                </ResponsiveContainer>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                    {widgetId === 'body_diagram' && (
                      <BodyDiagramWidget workouts={summaryData.workouts} recoveryDays={settings?.readiness_recovery_days ?? 3} />
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
