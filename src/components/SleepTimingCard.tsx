import React from 'react';
import { Night, Regularity, formatClock, summariseTiming } from '../lib/sleepTiming';
import { fetchJson } from '../lib/apiFetch';
import { getLocalDateString, cn } from '../lib/utils';
import { useSettingsStore } from '../store/useSettingsStore';

const DAYS = 28;

const TONE: Record<Regularity, string> = {
  steady: 'text-emerald-600 dark:text-emerald-400',
  variable: 'text-amber-600 dark:text-amber-400',
  irregular: 'text-rose-600 dark:text-rose-400',
};

const LABEL: Record<Regularity, string> = {
  steady: 'Steady schedule',
  variable: 'Variable schedule',
  irregular: 'Irregular schedule',
};

/** "1h 10m earlier" / "25m later" */
function formatJetLag(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  const span = m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
  return `${span} ${minutes >= 0 ? 'later' : 'earlier'}`;
}

/**
 * Item 90. Bedtime/wake-time consistency, appended to the sleep widget.
 *
 * The timing rows are offsets from their own metric timestamp (see
 * src/lib/sleepTiming.ts for why), so they can't be read off summaryData.metrics
 * like durations are -- pairing needs the row's timestamp as the anchor. Hence a
 * dedicated /api/sleep/timing fetch that returns already-paired nights.
 *
 * Renders an explicit "no bedtime data" line rather than nothing: the ingest only
 * writes these rows when the Apple export carries a sleep start/end pair, and a
 * silently empty card would read as a working feature with nothing to say.
 */
export const SleepTimingCard: React.FC = () => {
  const timezone = useSettingsStore((state) => state.settings.timezone);
  const [nights, setNights] = React.useState<Night[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    fetchJson<{ nights: Night[] }>(`/api/sleep/timing?days=${DAYS}`)
      .then(d => { if (live) setNights(d.nights || []); })
      .catch(e => { console.error('Sleep timing fetch failed', e); if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed || nights === null) return null;

  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const summary = summariseTiming(nights, getLocalDateString(timezone), tz, DAYS);

  return (
    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
      {summary === null ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Bedtime consistency needs a few more nights of sleep start/end data
        </p>
      ) : (
        <>
          <p className={cn('text-sm font-semibold', TONE[summary.regularity])}>
            {LABEL[summary.regularity]} &middot; {formatClock(summary.avgBed)}&ndash;{formatClock(summary.avgWake)}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            Last {summary.nights} nights &middot; bedtime varies &plusmn;{Math.round(summary.bedSd)} min, wake &plusmn;{Math.round(summary.wakeSd)} min
            {summary.socialJetLag !== null && Math.abs(summary.socialJetLag) >= 15 && (
              <> &middot; weekends {formatJetLag(summary.socialJetLag)}</>
            )}
          </p>
        </>
      )}
    </div>
  );
};
