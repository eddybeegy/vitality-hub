import { useEffect, useState } from 'react';
import { CalendarCheck, AlertTriangle } from 'lucide-react';
import { fetchJson } from '../lib/apiFetch';
import { DEFAULT_DAYS, type CoverageBand, type CoverageSeries } from '../lib/coverage';

// Data coverage calendar: one row per source, one cell per day, shaded by how many
// rows that source wrote relative to its OWN typical day.
//
// `metrics` and `workouts` are separate grids on purpose. A source's two feeds fail
// independently -- apple_health has kept writing metrics the whole time its workouts
// feed has been dead -- and a single combined row would show a healthy green streak
// for a source that is half broken. That failure mode is the reason this card exists,
// so it is the one thing the layout must not be able to hide.
//
// Bands are per-source, never cross-source: a scale that works for healthsync's
// thousands of metric rows a day would paint every hevy workout day as "low".

interface CoverageResponse {
  from: string;
  to: string;
  days: number;
  metrics: CoverageSeries[];
  workouts: CoverageSeries[];
}

const BAND_STYLE: Record<CoverageBand, string> = {
  none: 'bg-zinc-200 dark:bg-zinc-800',
  low: 'bg-amber-300 dark:bg-amber-700',
  normal: 'bg-emerald-400 dark:bg-emerald-600',
  high: 'bg-emerald-600 dark:bg-emerald-400',
};

const BAND_LABEL: Record<CoverageBand, string> = {
  none: 'nothing',
  low: 'below usual',
  normal: 'usual',
  high: 'well above usual',
};

const WINDOWS = [7, 30, 90];

const shortDay = (day: string) => day.slice(5);

const gapNote = (s: CoverageSeries) => {
  if (s.last_day === null) return 'nothing all window';
  if (s.gap_days === 0) return 'delivered today';
  return `${s.gap_days} day${s.gap_days === 1 ? '' : 's'} since ${shortDay(s.last_day)}`;
};

// Only a gap long enough to be a stopped feed rather than a quiet weekend.
const STALE_AFTER_DAYS = 3;

const Grid: React.FC<{ title: string; series: CoverageSeries[] }> = ({ title, series }) => (
  <div>
    <h4 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">{title}</h4>
    {series.length === 0 ? (
      <p className="text-sm text-zinc-400">No rows in this window.</p>
    ) : (
      <div className="space-y-2">
        {series.map(s => {
          const stale = s.last_day === null || s.gap_days >= STALE_AFTER_DAYS;
          return (
            <div key={s.source} className="flex items-center gap-3">
              <div className="w-28 shrink-0 min-w-0">
                <div className="text-sm truncate" title={s.source}>{s.source}</div>
                <div className={`text-xs flex items-center gap-1 ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}>
                  {stale && <AlertTriangle className="w-3 h-3 shrink-0" />}
                  <span className="truncate">{gapNote(s)}</span>
                </div>
              </div>
              <div className="flex gap-px flex-1 min-w-0">
                {s.days.map(c => (
                  <div
                    key={c.day}
                    // The cell count and the band are both in the tooltip: the colour is
                    // relative to this source's typical day, so the raw number is the only
                    // way to compare two sources at all.
                    title={`${c.day} — ${c.rows} row${c.rows === 1 ? '' : 's'} (${BAND_LABEL[c.band]}; typical ${s.typical})`}
                    className={`h-6 flex-1 min-w-[3px] rounded-sm ${BAND_STYLE[c.band]}`}
                  />
                ))}
              </div>
              <div className="w-20 shrink-0 text-right text-xs text-zinc-400 tabular-nums">
                {s.total.toLocaleString()} rows
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

export const CoverageCalendarCard: React.FC = () => {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setStatus('loading');
    fetchJson<CoverageResponse>(`/api/coverage?days=${days}`)
      .then(d => { if (live) { setData(d); setStatus('ready'); } })
      .catch(e => { console.error('Failed to load coverage', e); if (live) setStatus('error'); });
    return () => { live = false; };
  }, [days]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-zinc-400" />
          Data coverage
        </h3>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`px-2 py-1 text-xs rounded ${days === w
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' && <p className="text-sm text-zinc-400">Loading…</p>}
      {status === 'error' && <p className="text-sm text-rose-500">Couldn't load coverage.</p>}
      {status === 'ready' && data && (
        <div className="space-y-5">
          <Grid title="Metrics" series={data.metrics} />
          <Grid title="Workouts" series={data.workouts} />
          <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
            <span>{shortDay(data.from)} → {shortDay(data.to)}</span>
            <span className="flex items-center gap-2">
              shading is each source vs its own typical day
              <span className="flex gap-px">
                {(['none', 'low', 'normal', 'high'] as CoverageBand[]).map(b => (
                  <span key={b} title={BAND_LABEL[b]} className={`w-3 h-3 rounded-sm ${BAND_STYLE[b]}`} />
                ))}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
