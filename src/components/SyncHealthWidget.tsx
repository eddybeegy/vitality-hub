import React from 'react';
import { Clock, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useHealthStore } from '../store/useHealthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { parseUTCDate } from '../lib/utils';

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

  const getSyncStatus = (moduleId: string) => {
    const log = summaryData.syncLogs?.find(l => l.module === moduleId);
    if (!log) return { status: 'unknown', time: 'Never' };
    
    const timestamp = parseUTCDate(log.timestamp).getTime();
    const now = Date.now();
    const diffHours = (now - timestamp) / (1000 * 60 * 60);
    
    if (diffHours < 4) return { status: 'good', time: log.timestamp };
    if (diffHours < 12) return { status: 'warning', time: log.timestamp };
    return { status: 'error', time: log.timestamp };
  };

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm h-full flex flex-col">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
        <Clock size={16} className="text-zinc-400" />
        Data Freshness
      </h3>
      <div className="space-y-2 flex-grow">
        {enabledModules.map(module => {
          const { status, time } = getSyncStatus(module.id);
          const iconColor = status === 'good' ? 'text-emerald-500' : status === 'warning' ? 'text-amber-500' : 'text-red-500';
          
          return (
            <div key={module.id} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
              <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 capitalize">{module.id}</span>
              <div className="flex items-center gap-1.5">
                {status === 'good' ? <CheckCircle size={12} className={iconColor} /> : <AlertCircle size={12} className={iconColor} />}
                <span className="text-[9px] text-zinc-500 dark:text-zinc-400 font-mono">
                  {time === 'Never' ? 'Never' : formatSyncTime(time)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
