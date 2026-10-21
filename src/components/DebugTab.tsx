import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bug, RefreshCw } from 'lucide-react';
import { formatDateWithTimezone } from '../lib/utils';
import { useHealthStore } from '../store/useHealthStore';

interface DebugTabProps {
  settings: any;
}

// Newest "Background sync completed: N metrics, M workouts" line that /health-export
// writes after every Apple Health push. This replaces the old /api/debug/apple-health-last-sync
// and /api/debug/apple-health-full-body reads: both serve files that nothing in the repo
// ever writes, so the panel always showed "Never" / 0 (sweep item 27).
interface AppleHealthImport {
  timestamp: string;
  metrics: number;
  workouts: number;
}

const IMPORT_LINE = /Background sync completed: (\d+) metrics, (\d+) workouts/;

const findLastAppleHealthImport = (logs: any[]): AppleHealthImport | null => {
  for (const log of logs) {
    if (log?.source !== 'apple_health') continue;
    const match = String(log.message || '').match(IMPORT_LINE);
    if (match) return { timestamp: log.timestamp, metrics: Number(match[1]), workouts: Number(match[2]) };
  }
  return null;
};

export const DebugTab = ({ settings }: DebugTabProps) => {
  const { summaryData, debugMetrics, lastMetrics, setDebugMetrics, setLastMetrics } = useHealthStore();
  const [lastImport, setLastImport] = useState<AppleHealthImport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [typesRes, lastRes, logsRes] = await Promise.all([
        fetch('/api/debug/metrics'),
        fetch('/api/debug/last-metrics'),
        fetch('/api/logs?source=apple_health&limit=200'),
      ]);
      if (typesRes.ok) {
        const types = await typesRes.json();
        setDebugMetrics([...types].sort((a: any, b: any) => String(a.type).localeCompare(String(b.type))));
      }
      if (lastRes.ok) setLastMetrics(await lastRes.json());
      // Asked for apple_health rows only (item 53), newest first, so other sources' chatter
      // can no longer push the last import out of the window. Older than the newest 200
      // apple_health entries is still shown as "not in recent logs".
      if (logsRes.ok) setLastImport(findLastAppleHealthImport(await logsRes.json()));
      if (!typesRes.ok || !lastRes.ok || !logsRes.ok) setError('Some debug endpoints failed to respond');
    } catch (e) {
      console.error('Debug refresh failed', e);
      setError('Failed to load debug data');
    } finally {
      setIsLoading(false);
    }
  }, [setDebugMetrics, setLastMetrics]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Same value as the Dashboard's Data Freshness row for apple_health: the MODULE's
  // newest reading, which counts healthsync (HealthSync's HASS-routed copy of the same
  // Apple Health data) as well as the direct Health Auto Export push. This used to read
  // bySource.apple_health -- the direct push alone -- so at 12:05 on 2026-10-21 the two
  // panels showed 09:48 (apple_health) and 10:40 (healthsync) for one module, both
  // correct, under one label. The per-source line underneath keeps the push's own time
  // visible, which is the one worth having next to "Last Import".
  const appleModule = summaryData.dataFreshness?.byModule?.apple_health;
  const newestReading = appleModule?.lastReading ?? null;
  const moduleTables = appleModule?.tables ?? ['metrics'];
  const newestBySource = (appleModule?.sources ?? []).map(source => {
    let t: string | null = null;
    for (const table of moduleTables) {
      const c = summaryData.dataFreshness?.byTable?.[table]?.[source];
      if (c && (!t || new Date(c).getTime() > new Date(t).getTime())) t = c;
    }
    return { source, timestamp: t };
  });

  return (
    <motion.div 
      key="debug"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <Bug size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Debug Tools</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Inspect raw data and sync status</p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 px-4 py-2 rounded-xl text-xs font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <p className="mb-6 text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Apple Health Sync</h3>
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-6 border border-black/5 dark:border-white/5">
              <div className="flex justify-between items-center gap-4 mb-4">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Last Import</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 text-right">
                  {lastImport ? formatDateWithTimezone(lastImport.timestamp, settings?.timezone) : 'Not in recent logs'}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4 mb-4">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Metrics Imported</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{lastImport ? lastImport.metrics : '—'}</span>
              </div>
              <div className="flex justify-between items-center gap-4 mb-4">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Workouts Imported</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{lastImport ? lastImport.workouts : '—'}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Newest Reading</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 text-right">
                  {newestReading ? formatDateWithTimezone(newestReading, settings?.timezone) : 'None'}
                </span>
              </div>
              {newestBySource.length > 1 && (
                <div className="mt-2 space-y-1">
                  {newestBySource.map(({ source, timestamp }) => (
                    <div key={source} className="flex justify-between items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono">{source}</span>
                      <span className="text-right">{timestamp ? formatDateWithTimezone(timestamp, settings?.timezone) : 'None'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Database Metrics</h3>
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-6 border border-black/5 dark:border-white/5 max-h-[300px] overflow-y-auto">
              {debugMetrics.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{isLoading ? 'Loading…' : 'No metric types stored'}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {debugMetrics.map((m) => (
                    <button 
                      key={m.type} 
                      onClick={() => window.open(`/api/debug/metrics/${encodeURIComponent(m.type)}`, '_blank')}
                      className="px-2 py-1 bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 text-zinc-600 dark:text-zinc-300 rounded-lg text-[10px] font-medium font-mono hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all"
                    >
                      {m.type}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">Last 50 Raw Metrics</h3>
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 overflow-x-auto">
            <table className="w-full text-left text-[10px] font-mono">
              <thead>
                <tr className="text-zinc-500 dark:text-zinc-400 border-b border-black/5 dark:border-white/10">
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Value</th>
                  <th className="pb-2">Unit</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Timestamp (UTC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {lastMetrics.map((m, i) => (
                  <tr key={m.id ?? i} className="text-zinc-600 dark:text-zinc-300">
                    <td className="py-1 pr-2 font-bold">{m.type}</td>
                    <td className="py-1 pr-2">{m.value}</td>
                    <td className="py-1 pr-2">{m.unit}</td>
                    <td className="py-1 pr-2">{m.source}</td>
                    <td className="py-1 whitespace-nowrap">{String(m.timestamp)}</td>
                  </tr>
                ))}
                {lastMetrics.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-2 text-zinc-500 dark:text-zinc-400">{isLoading ? 'Loading…' : 'No metrics stored'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
