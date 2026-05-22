import React from 'react';
import { motion } from 'motion/react';
import { Bug } from 'lucide-react';
import { formatDateWithTimezone } from '../lib/utils';

interface DebugTabProps {
  lastAppleHealthSync: any;
  settings: any;
  fetchLastAppleHealthSync: () => Promise<void>;
  debugMetrics: any[];
  lastMetrics: any[];
}

export const DebugTab = ({
  lastAppleHealthSync,
  settings,
  fetchLastAppleHealthSync,
  debugMetrics,
  lastMetrics
}: DebugTabProps) => {
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Apple Health Sync</h3>
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-6 border border-black/5 dark:border-white/5">
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Last Sync</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{lastAppleHealthSync?.timestamp ? formatDateWithTimezone(lastAppleHealthSync.timestamp, settings?.timezone) : 'Never'}</span>
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Metrics Count</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{lastAppleHealthSync?.count || 0}</span>
              </div>
              <div className="flex justify-between items-center mb-6">
                <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Workouts Count</span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{lastAppleHealthSync?.workoutsCount || 0}</span>
              </div>
              
              <div className="space-y-3">
                <a 
                  href="/api/debug/apple-health-full-body" 
                  target="_blank" 
                  className="block w-full text-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-3 rounded-xl text-xs font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all"
                >
                  View Full JSON Body
                </a>
                <button 
                  onClick={fetchLastAppleHealthSync}
                  className="block w-full text-center bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 py-3 rounded-xl text-xs font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Database Metrics</h3>
            <div className="bg-zinc-50 rounded-2xl p-6 border border-black/5 max-h-[300px] overflow-y-auto">
              <div className="flex flex-wrap gap-2">
                {debugMetrics.map((m, i) => (
                  <button 
                    key={i} 
                    onClick={() => window.open(`/api/debug/metrics/${m.type}`, '_blank')}
                    className="px-2 py-1 bg-white border border-black/5 text-zinc-600 rounded-lg text-[10px] font-medium font-mono hover:border-emerald-500 hover:text-emerald-600 transition-all"
                  >
                    {m.type}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-black/5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 mb-4">Last 50 Raw Metrics</h3>
          <div className="bg-zinc-50 rounded-2xl p-4 overflow-x-auto">
            <table className="w-full text-left text-[10px] font-mono">
              <thead>
                <tr className="text-zinc-400 border-b border-black/5">
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Value</th>
                  <th className="pb-2">Unit</th>
                  <th className="pb-2">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {lastMetrics.map((m, i) => (
                  <tr key={i} className="text-zinc-600">
                    <td className="py-1 font-bold">{m.type}</td>
                    <td className="py-1">{m.value}</td>
                    <td className="py-1">{m.unit}</td>
                    <td className="py-1">{m.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
