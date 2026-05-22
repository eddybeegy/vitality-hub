import React from 'react';
import { motion } from 'motion/react';
import { Activity, Zap, History, Info } from 'lucide-react';
import { calculateReadinessScore } from '../lib/readiness';
import { StandardizedMetric } from '../services/healthDataService';
import { cn } from '../lib/utils';

interface ReadinessCardProps {
  metrics: StandardizedMetric[];
  targets: any[];
  timezone?: string;
}

export const ReadinessCard: React.FC<ReadinessCardProps> = ({ metrics, targets, timezone }) => {
  const result = calculateReadinessScore(metrics, targets, timezone);

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

      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-2xl">
            <Zap className={cn("transition-transform duration-500 group-hover:scale-110", getScoreColor(score))} size={20} fill="currentColor" fillOpacity={0.2} />
          </div>
          <div>
            <h3 className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest italic font-serif">Today's Pulse</h3>
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Readiness Score</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
            <span className={cn("text-4xl font-black tracking-tighter font-mono leading-none", getScoreColor(score))}>
                {score}
            </span>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter mt-1">/ 100</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full mb-6 overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 1.5, ease: "circOut" }}
          className={cn("h-full rounded-full shadow-[0_0_12px_rgba(16,185,129,0.3)]", getScoreBg(score))}
        />
      </div>

      <div className="space-y-4 flex-grow">
        <div className="grid grid-cols-3 gap-3">
          {components.map((c, i) => (
            <div key={c.name} className="flex flex-col">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1">{c.name}</span>
              <div className="flex items-center gap-1.5">
                <div className={cn("w-1 h-3 rounded-full opacity-30", getScoreBg(c.score))} />
                <span className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-200">
                  {c.score.toFixed(0)}
                </span>
              </div>
              <span className="text-[8px] text-zinc-400 mt-0.5 truncate">{c.label}</span>
            </div>
          ))}
        </div>

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
          <span>BASED ON LAST 7 DAYS</span>
        </div>
      </div>
    </div>
  );
};
