import React from 'react';
import { Clock, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useHealthStore } from '../store/useHealthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { parseUTCDate } from '../lib/utils';
import { isIssueResolved } from '../lib/syncIssues';
import { freshnessStatus, stalenessThresholdHours } from '../lib/freshness';

// Duplicated from App.tsx's handleConnectWithings rather than threading a prop
// through Dashboard for one widget — same self-contained popup OAuth flow.
const handleReconnectWithings = async () => {
  const res = await fetch('/api/auth/withings/url');
  const { url } = await res.json();
  window.open(url, 'withings_oauth', 'width=600,height=700');
};

export const SyncHealthWidget = () => {
  const { modules, summaryData } = useHealthStore();
  const timezone = useSettingsStore((state) => state.settings.timezone);

  // Filter for enabled modules only
  const enabledModules = modules.filter(m => m.enabled);
  
  if (enabledModules.length === 0) return null;

  const formatSyncTime = (time: string) => {
    const date = parseUTCDate(time);
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(date);

      const day = parts.find(p => p.type === 'day')?.value || '';
      const month = parts.find(p => p.type === 'month')?.value || '';
      const hour = parts.find(p => p.type === 'hour')?.value || '';
      const minute = parts.find(p => p.type === 'minute')?.value || '';

      return `${day}/${month} ${hour}:${minute}`;
    } catch (error) {
      return `${date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  };

  // "Data Freshness" has to mean the newest READING. This used to read
  // summaryData.syncLogs, which the server builds as MAX(timestamp) FROM logs WHERE
  // level='info' GROUP BY source and hardcodes to status 'success' -- so a sync that ran
  // and imported nothing still showed as fresh, and every module read the same
  // minutes-ago timestamp regardless of whether any data had arrived.
  //
  // Item 34: the threshold is per module (24h for continuous feeds, 72h for manually
  // logged ones) and lives in lib/freshness.ts. A reading is either inside its own
  // threshold ('good') or past it ('error'); the old flat 24h/72h warning band is gone.
  const getDataStatus = (moduleId: string) => {
    const reading = summaryData.dataFreshness?.byModule?.[moduleId]?.lastReading;
    return { status: freshnessStatus(moduleId, reading), time: reading || 'Never' };
  };

  // Kept as a secondary line: "we tried, but nothing came back" is a different and still
  // useful signal from "the data is old".
  const getLastSync = (moduleId: string) => {
    const log = summaryData.syncLogs?.find(l => l.module === moduleId);
    return log?.timestamp ? formatSyncTime(log.timestamp) : null;
  };

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full flex flex-col">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <Clock size={16} className="text-zinc-400" />
        Data Freshness
      </h3>
      <div className="space-y-2 flex-grow">
        {enabledModules.map(module => {
          const { status: dataStatus, time } = getDataStatus(module.id);
          // Two separate bugs lived on this line (sweep item 11, fixed 2026-10-21):
          //
          // 1. `status !== 'good'` meant an issue was only ever shown for a module whose
          //    data was ALREADY stale. A module that is half-working -- metrics arriving
          //    but workouts failing, say -- is 'good' on freshness, so its errors were
          //    suppressed exactly when they were the only warning you would get. An
          //    error is now always rendered, and an error-level one pulls the tick off
          //    green: a module logging errors is not healthy, however fresh its data.
          //
          // 2. `syncIssues` is keyed by `logs.source`; this looked it up by `module.id`.
          //    Different namespaces -- `apple_workouts` logs under `apple_health`,
          //    Nutracheck is `nutrachek` here and `nutracheck` in some writers -- so
          //    those modules' errors were never displayed at all. The server now also
          //    returns `syncIssuesByModule`, resolved through the same MODULE_SOURCES
          //    map freshness uses. The flat lookup stays as a fallback so an older
          //    cached summary payload still renders something.
          //
          // 3. (sweep item 41) The server keeps an issue for a flat 24h, so an error that a
          //    later clean sync had already fixed stayed up next to Reconnect all day.
          //    Drop it once the same source has logged a success after it.
          const rawIssue = summaryData.syncIssuesByModule?.[module.id] ?? summaryData.syncIssues?.[module.id];
          const issue = rawIssue && !isIssueResolved(rawIssue, summaryData.syncLogs, module.id) ? rawIssue : undefined;
          const status = (issue?.level === 'error' && dataStatus === 'good') ? 'warning' : dataStatus;
          // Unknown (no reading ever) is grey rather than red: nothing has gone stale.
          const iconColor =
            status === 'good' ? 'text-emerald-500 dark:text-emerald-400'
            : status === 'warning' ? 'text-amber-500 dark:text-amber-400'
            : status === 'unknown' ? 'text-zinc-400 dark:text-zinc-500'
            : 'text-red-500 dark:text-red-400';
          const staleAfter = `stale after ${stalenessThresholdHours(module.id)}h`;
          const lastSync = getLastSync(module.id);
          const dataTime = time === 'Never' ? 'No data' : formatSyncTime(time);

          return (
            <div key={module.id} className="flex flex-col gap-0.5 p-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 capitalize">{module.id}</span>
                <div className="flex items-center gap-1.5">
                  {status === 'good' ? <CheckCircle size={12} className={iconColor} /> : <AlertCircle size={12} className={iconColor} />}
                  <span
                    title={`Newest reading ${dataTime} (${staleAfter})${lastSync ? ` \u2014 last sync attempt ${lastSync}` : ''}`}
                    className="text-[9px] text-zinc-500 dark:text-zinc-400 font-mono"
                  >
                    {dataTime}
                  </span>
                </div>
              </div>
              {lastSync && dataTime !== lastSync && (
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono">
                  sync {lastSync}
                </span>
              )}
              {issue && (
                <div className="flex items-center justify-between gap-2">
                  <span
                    title={`${issue.level}: ${issue.message}`}
                    className={`text-[9px] truncate ${issue.level === 'error' ? 'text-red-500 dark:text-red-400' : 'text-amber-600 dark:text-amber-500'}`}
                  >
                    {issue.message}
                  </span>
                  {module.id === 'withings' && (
                    <button
                      onClick={handleReconnectWithings}
                      className="shrink-0 flex items-center gap-1 text-[9px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <RefreshCw size={10} />
                      Reconnect
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
