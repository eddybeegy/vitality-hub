import React from 'react';
import { motion } from 'motion/react';
import { Terminal, RefreshCw, FileSearch, Search } from 'lucide-react';
import { cn, formatDateWithTimezone } from '../lib/utils';
import { EmptyState } from './ui/EmptyState';
import { METRIC_MAP, NUTRITION_METRICS } from '../constants';
import type { AppleHealthSyncSummary } from '../store/useHealthStore';

export type LogLevelFilter = 'all' | 'debug' | 'info' | 'warn' | 'error';

// The level <select> below has always offered "Debug Only", so 'debug' belongs in
// the union; it was only absent because setLogFilter is called through an `as any`.
interface LogsTabProps {
  logFilter: LogLevelFilter;
  setLogFilter: (filter: LogLevelFilter) => void;
  logs: any[];
  fetchLogs: () => Promise<void>;
  settings: any;
  lastAppleHealthSync: AppleHealthSyncSummary | null;
}

export const LogsTab = React.memo(({
  logFilter,
  setLogFilter,
  logs,
  fetchLogs,
  settings,
  lastAppleHealthSync
}: LogsTabProps) => {
  const [logSearch, setLogSearch] = React.useState('');

  // Item 47: prefer the per-name resolution the sync itself recorded. Re-deriving it
  // here (the old behaviour) duplicated the module's mapping logic and only tried two
  // of its five name candidates, so a mapped name could be labelled "Unmapped".
  const rawNameRows = React.useMemo(() => {
    const recorded = lastAppleHealthSync?.names;
    if (recorded?.length) {
      return recorded.map(n => ({
        raw: n.raw,
        mappedTo: n.mappedTo,
        // apple_health nutrition is stored but deliberately not surfaced on a day a
        // food log covers (Kieron, 2026-10-21), so it is neither "Recorded" nor dropped.
        status: !n.mappedTo
          ? 'Unmapped'
          : n.noValue && n.points === 0
            ? 'No value key'
            : n.points === 0
              ? 'Nothing stored'
              : NUTRITION_METRICS.includes(n.mappedTo)
                ? 'Stored (not surfaced)'
                : 'Recorded',
        points: n.points,
      }));
    }
    // Fallback for a summary written before item 47 (rawNames only).
    return (lastAppleHealthSync?.rawNames || []).map((name: string) => {
      const normalizedName = name.toLowerCase().replace(/\s+/g, '_');
      const cleanName = METRIC_MAP[normalizedName] || METRIC_MAP[name];
      return {
        raw: name,
        mappedTo: cleanName || null,
        status: !cleanName ? 'Unmapped' : NUTRITION_METRICS.includes(cleanName) ? 'Stored (not surfaced)' : 'Recorded',
        points: null as number | null,
      };
    });
  }, [lastAppleHealthSync]);

  const levelFilteredLogs = React.useMemo(
    () => logs.filter(l => logFilter === 'all' || l.level === logFilter),
    [logs, logFilter]
  );

  const filteredLogs = React.useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return levelFilteredLogs;
    return levelFilteredLogs.filter(l =>
      String(l.message ?? '').toLowerCase().includes(q) ||
      String(l.source ?? '').toLowerCase().includes(q)
    );
  }, [levelFilteredLogs, logSearch]);

  return (
    <motion.div
      key="logs"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-900 dark:text-zinc-100">
              <Terminal size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">System Logs</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">View recent background sync events and errors</p>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter by source or message..."
                className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-xl pl-8 pr-3 py-2 outline-none w-56"
              />
            </div>
            <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 shrink-0">
              {filteredLogs.length} / {levelFilteredLogs.length}
            </span>
            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value as LogLevelFilter)}
              className="text-xs font-bold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-xl px-3 py-2 outline-none"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug Only</option>
              <option value="info">Info Only</option>
              <option value="warn">Warnings Only</option>
              <option value="error">Errors Only</option>
            </select>
            <button
              onClick={fetchLogs}
              className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            >
              <RefreshCw size={16} />
              Refresh Logs
            </button>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-2xl p-4 overflow-x-auto min-h-[200px] flex flex-col">
          <div className="space-y-2 font-mono text-xs flex-1">
            {filteredLogs.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  icon={FileSearch}
                  title={logs.length === 0 ? "No logs found" : "No matches"}
                  description={logs.length === 0
                    ? "There are no system logs matching your current filter. Try refreshing or changing the filter level."
                    : "No logs match your current search and filter. Try a different search term."}
                  className="bg-transparent border-none p-0"
                  action={{
                    label: "Refresh Logs",
                    onClick: fetchLogs
                  }}
                />
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="flex gap-4">
                  <span className="text-zinc-500 shrink-0">{formatDateWithTimezone(log.timestamp, settings?.timezone)}</span>
                  <span className={cn(
                    "shrink-0 w-12 font-bold",
                    log.level === 'error' ? "text-red-400" : log.level === 'warn' ? "text-yellow-400" : log.level === 'debug' ? "text-blue-400" : "text-emerald-400"
                  )}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-zinc-400 shrink-0 w-24">[{log.source}]</span>
                  <span className="text-zinc-300">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/5">
          <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Raw Metrics Received</h3>
            {lastAppleHealthSync?.lastSync && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                Last Apple Health push: {formatDateWithTimezone(lastAppleHealthSync.lastSync, settings?.timezone)}
                {typeof lastAppleHealthSync.count === 'number' ? ` \u00b7 ${lastAppleHealthSync.count} values stored` : ''}
              </span>
            )}
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 overflow-x-auto">
            {rawNameRows.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No Apple Health push has been recorded yet. This table fills in after the next
                Health Auto Export delivery.
              </p>
            ) : (
            <table className="w-full text-left text-[10px] font-mono">
              <thead>
                <tr className="text-zinc-400 dark:text-zinc-500 border-b border-black/5 dark:border-white/5">
                  <th className="pb-2">Raw Name</th>
                  <th className="pb-2">Mapped To</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Values</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {rawNameRows.map((row, i) => (
                  <tr key={i} className="text-zinc-600 dark:text-zinc-400">
                    <td className="py-1 font-bold">{row.raw}</td>
                    <td className="py-1">{row.mappedTo || '\u2014'}</td>
                    <td className={cn("py-1", row.status === 'Recorded'
                      ? "text-emerald-600 dark:text-emerald-400"
                      : row.status === 'Unmapped' || row.status === 'No value key'
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-500 dark:text-zinc-400")}>
                      {row.status}
                    </td>
                    <td className="py-1">{row.points === null ? '\u2014' : row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});
