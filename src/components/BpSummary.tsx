import React from 'react';
import { cn } from '../lib/utils';
import { BAND_LABEL, homeAverage, latestReading, AVG_DAYS, MIN_AVG_DAYS, type BpBand, type BpDay } from '../lib/bpCategories';

// Item 89: NICE home-reading band for the latest reading and the 7-day average.
const BAND_STYLE: Record<BpBand, string> = {
  low: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  normal: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  stage1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  stage2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  severe: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

const Badge = ({ band }: { band: BpBand }) => (
  <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide', BAND_STYLE[band])}>
    {BAND_LABEL[band]}
  </span>
);

const fmt = (s: number, d: number) => `${Math.round(s)}/${Math.round(d)}`;

export const BpSummary = ({ rows, today }: { rows: BpDay[]; today: string }) => {
  const latest = latestReading(rows);
  if (!latest) return null;
  const avg = homeAverage(rows, today);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm p-4 text-xs text-zinc-500 dark:text-zinc-400 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span>Latest ({latest.date})</span>
        <span className="font-bold text-zinc-900 dark:text-zinc-100">{fmt(latest.systolic, latest.diastolic)} mmHg</span>
        <Badge band={latest.band} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>{AVG_DAYS}-day average</span>
        {avg ? (
          <>
            <span className="font-bold text-zinc-900 dark:text-zinc-100">{fmt(avg.systolic, avg.diastolic)} mmHg</span>
            <Badge band={avg.band} />
            <span className="text-[10px] text-zinc-400">{avg.days} days</span>
          </>
        ) : (
          <span className="text-[10px] text-zinc-400">needs readings on {MIN_AVG_DAYS} of the last {AVG_DAYS} days</span>
        )}
      </div>
      {(latest.band === 'severe' || avg?.band === 'severe') && (
        <p role="alert" className="text-rose-600 dark:text-rose-400 font-medium">
          A reading this high is worth re-checking after five minutes seated. If it stays this high, contact your GP or NHS 111 today.
        </p>
      )}
      <p className="text-[10px] text-zinc-400">
        Bands use NICE home-reading thresholds (135/85 stage 1, 150/95 stage 2). One reading per day; the full home protocol is two seated readings morning and evening for a week. Not a diagnosis.
      </p>
    </div>
  );
};
