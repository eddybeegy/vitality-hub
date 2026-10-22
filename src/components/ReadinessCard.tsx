import React, { useCallback, useEffect, useState } from 'react';
import { History, Info, TrendingDown, TrendingUp, Minus, Thermometer } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { calculateReadinessScore } from '../lib/readiness';
import { dayRange, explainChange, previousSnapshot, toSnapshot, type ReadinessSnapshot } from '../lib/readinessHistory';
import { addDays } from '../lib/dayTags';
import { checkIllnessWarning, describeSignals } from '../lib/illnessWarning';
import { fetchJson } from '../lib/apiFetch';
import { getLocalDateString } from '../lib/utils';
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus';
import { StandardizedMetric } from '../services/healthDataService';
import { cn } from '../lib/utils';
import { ProgressRing } from './ui/ProgressRing';

const getReadinessLabel = (score: number) => {
  if (score > 80) return 'Ready';
  if (score > 60) return 'Good to go';
  if (score > 40) return 'Train with care';
  return 'Prioritize rest';
};

interface ReadinessCardProps {
  metrics: StandardizedMetric[];
  targets: any[];
  timezone?: string;
  /** For the overreach-vs-illness call in the early warning; optional. */
  workouts?: { timestamp: string; duration: number }[];
}

const HISTORY_DAYS = 30;

// Item 76: the last 30 days of readiness from /api/readiness/history (finished
// days are stored snapshots, so they do not shift when settings change), and
// what moved today's live score against the previous scored day.
function useReadinessHistory(timezone?: string) {
  const [history, setHistory] = useState<ReadinessSnapshot[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetchJson<{ history: ReadinessSnapshot[] }>(`/api/readiness/history?days=${HISTORY_DAYS}`);
      setHistory(r.history);
    } catch (e) {
      // The card still shows today's score; only the trend line is missing.
      console.error('Failed to load readiness history', e);
    }
  }, []);
  useEffect(() => { void load(); }, [load, timezone]);
  useRefreshOnFocus(() => { void load(); });
  return history;
}

const formatDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export const ReadinessCard: React.FC<ReadinessCardProps> = ({ metrics, targets, timezone, workouts = [] }) => {
  const result = calculateReadinessScore(metrics, targets, timezone);
  const history = useReadinessHistory(timezone);

  if (!result) {
    return (
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm animate-pulse">
        <div className="h-4 w-24 bg-zinc-100 dark:bg-zinc-800 rounded mb-4" />
        <div className="h-8 w-16 bg-zinc-100 dark:bg-zinc-800 rounded mb-2" />
        <div className="h-4 w-full bg-zinc-100 dark:bg-zinc-800 rounded" />
      </div>
    );
  }

  const { score, components, recommendation } = result;

  // Today is the live score above; the server's history supplies the past days.
  const today = getLocalDateString(timezone);
  const todaySnap = toSnapshot(today, result);
  const past = (history || []).filter(s => s.date < today);
  const prev = previousSnapshot(past, today);
  const warning = checkIllnessWarning(metrics, workouts, today, timezone);
  const warningLines = describeSignals(warning);
  const change = prev ? explainChange(todaySnap, prev) : null;
  // One point per calendar day so a day with no readings shows as a gap.
  const byDay = new Map(past.map(s => [s.date, s.score]));
  byDay.set(today, todaySnap.score);
  const trend = dayRange(addDays(today, -(HISTORY_DAYS - 1)), today).map(date => ({ date, score: byDay.get(date) ?? null }));

  // Gauge colors
  const getScoreColor = (s: number) => {
    if (s > 80) return "text-emerald-500";
    if (s > 60) return "text-amber-500";
    return "text-rose-500";
  };

  const getScoreBg = (s: number) => {
    if (s > 80) return "bg-emerald-500";
    if (s > 60) return "bg-amber-500";
    return "bg-rose-500";
  };

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col h-full overflow-hidden relative group">
      {/* Background Accent */}
      <div className={cn(
        "absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-5 blur-3xl transition-all duration-1000 group-hover:scale-110",
        getScoreBg(score)
      )} />

      <div className="flex items-start gap-4 mb-6">
        <ProgressRing
          radius={40}
          stroke={7}
          progress={score}
          color={score > 80 ? '#10b981' : score > 60 ? '#f59e0b' : score > 40 ? '#f59e0b' : '#f43f5e'}
          value={`${score}%`}
          label="Ready"
        />
        <div className="pt-1">
          <h3 className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest italic font-serif mb-1">Today's Pulse</h3>
          <p className={cn("text-lg font-bold leading-tight", getScoreColor(score))}>{getReadinessLabel(score)}</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Readiness score, based on HRV, resting HR, sleep &amp; yesterday's strain</p>
        </div>
      </div>

      {warning.level !== 'none' && (
        <div
          role="status"
          className={cn(
            "mb-4 p-3 rounded-2xl border flex items-start gap-2.5",
            warning.level === 'alert'
              ? "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200"
              : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200"
          )}
        >
          <Thermometer size={16} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider">
              {warning.level === 'alert' ? 'Early warning' : 'Worth watching'}
              {' · '}
              {warning.cause === 'overreach' ? 'possible overreach' : 'possible illness'}
            </p>
            <p className="text-xs font-medium mt-0.5">{warning.message}</p>
            {warningLines.length > 0 && (
              <ul className="mt-1 text-[11px] opacity-80 space-y-0.5">
                {warningLines.map(line => <li key={line}>{line}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 flex-grow">
        <div className={cn("grid gap-3", components.length === 4 ? "grid-cols-2" : "grid-cols-3")}>
          {components.map((c, i) => (
            <div key={c.name} className="flex flex-col">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1">{c.name}</span>
              <div className="flex items-center gap-1.5">
                <div className={cn("w-1 h-3 rounded-full opacity-30", getScoreBg(c.score))} />
                <span className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-200">
                  {c.score.toFixed(0)}
                </span>
              </div>
              <span className="text-[8px] text-zinc-400 mt-0.5 truncate" title={c.label}>{c.label}</span>
            </div>
          ))}
        </div>

        {past.length > 0 && (
          <div className="pt-2">
            <div className="h-12 w-full" aria-label={`Readiness over the last ${HISTORY_DAYS} days`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                  <defs>
                    <linearGradient id="readinessTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ fontSize: 11, borderRadius: 8, padding: '4px 8px' }}
                    labelFormatter={(_, p: any) => (p?.[0]?.payload?.date ? formatDay(p[0].payload.date) : '')}
                    formatter={(v: any) => [`${v}`, 'Readiness']}
                  />
                  <Area type="monotone" dataKey="score" stroke="#10b981" strokeWidth={1.5} fill="url(#readinessTrendFill)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {change && (
              <div className="flex items-center gap-1.5 mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title={change.components.map(c => `${c.name} ${c.delta > 0 ? '+' : ''}${c.delta}`).join(' · ')}>
                {change.delta >= 2 ? <TrendingUp size={12} className="text-emerald-500 shrink-0" />
                  : change.delta <= -2 ? <TrendingDown size={12} className="text-rose-500 shrink-0" />
                  : <Minus size={12} className="shrink-0" />}
                <span>{change.summary}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-black/[0.02] dark:border-white/[0.02] flex items-start gap-3">
            <Info size={16} className={cn("shrink-0 mt-0.5", getScoreColor(score))} />
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 font-medium italic">
                {recommendation}
            </p>
        </div>
      </div>
      
      <div className="mt-6 flex items-center justify-between text-[9px] font-bold text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-800 pt-4">
        <div className="flex items-center gap-1.5">
          <History size={10} />
          <span>VS YOUR 28-DAY NORMAL</span>
        </div>
      </div>
    </div>
  );
};
