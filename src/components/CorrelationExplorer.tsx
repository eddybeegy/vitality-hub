import React, { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { dailySeries } from '../lib/baselines';
import { correlate, describeCorrelation, pairSeries, MIN_PAIRS, type DailyPoint } from '../lib/correlation';
import { getSleepDurationData } from '../services/healthDataService';

interface CorrelationExplorerProps {
  metrics: any[];
  timezone?: string;
}

// The metrics on offer. Sleep comes from getSleepDurationData (hours, the same
// numbers as the sleep chart); everything else is the summary's daily value.
const OPTIONS: { key: string; label: string; unit: string }[] = [
  { key: 'hrv', label: 'HRV', unit: 'ms' },
  { key: 'resting_heart_rate', label: 'Resting HR', unit: 'bpm' },
  { key: 'sleep_hours', label: 'Sleep', unit: 'h' },
  { key: 'steps', label: 'Steps', unit: '' },
  { key: 'active_energy', label: 'Active energy', unit: 'kcal' },
  { key: 'calories_in', label: 'Calories eaten', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'caffeine', label: 'Caffeine', unit: 'mg' },
  { key: 'water', label: 'Water', unit: 'ml' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'respiratory_rate', label: 'Breathing rate', unit: 'br/min' },
];

// Item 86: pick two daily metrics and an optional one-day lag, see the scatter
// and Pearson's r. The maths lives in src/lib/correlation.ts.
export const CorrelationExplorer: React.FC<CorrelationExplorerProps> = ({ metrics, timezone }) => {
  const seriesByKey = useMemo(() => {
    const out: Record<string, DailyPoint[]> = {};
    for (const o of OPTIONS) {
      out[o.key] = o.key === 'sleep_hours'
        ? getSleepDurationData(metrics || [], timezone).map((d: any) => ({ day: d.date, value: d.hours }))
        : dailySeries(metrics || [], o.key, timezone);
    }
    return out;
  }, [metrics, timezone]);

  const available = OPTIONS.filter(o => (seriesByKey[o.key]?.length ?? 0) >= MIN_PAIRS);
  const pick = (preferred: string, fallback: number) =>
    available.find(o => o.key === preferred)?.key ?? available[fallback]?.key ?? '';

  const [xKey, setXKey] = useState(() => pick('active_energy', 0));
  const [yKey, setYKey] = useState(() => pick('hrv', 1));
  const [lag, setLag] = useState(1);

  if (available.length < 2) return null;

  const x = OPTIONS.find(o => o.key === xKey) ?? available[0];
  const y = OPTIONS.find(o => o.key === yKey) ?? available[1];
  const result = correlate(pairSeries(seriesByKey[x.key] || [], seriesByKey[y.key] || [], lag));
  const select = "text-xs font-semibold bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-lg px-2 py-1 text-zinc-700 dark:text-zinc-200";

  return (
    <div className="bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 rounded-3xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} className="text-zinc-400" />
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Correlation Explorer</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        <label htmlFor="corr-x">Does</label>
        <select id="corr-x" className={select} value={x.key} onChange={e => setXKey(e.target.value)}>
          {available.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <label htmlFor="corr-y">relate to</label>
        <select id="corr-y" className={select} value={y.key} onChange={e => setYKey(e.target.value)}>
          {available.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select id="corr-lag" aria-label="When" className={select} value={lag} onChange={e => setLag(Number(e.target.value))}>
          <option value={0}>the same day</option>
          <option value={1}>the next day</option>
        </select>
      </div>

      {!result ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Fewer than {MIN_PAIRS} days have both {x.label.toLowerCase()} and {y.label.toLowerCase()}{lag ? ' the day after' : ''}, or one of them never changes.
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{describeCorrelation(result)}</p>
          <p className="text-[11px] text-zinc-400 mb-3">
            Each dot is a day: {x.label} on the x axis, {y.label}{lag ? ' the next day' : ''} on the y axis. A link here is a pattern in your data, not proof that one causes the other.
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" strokeOpacity={0.25} />
                <XAxis type="number" dataKey="x" name={x.label} unit={x.unit ? ` ${x.unit}` : ''} tick={{ fontSize: 10, fill: '#71717a' }} domain={['auto', 'auto']} />
                <YAxis type="number" dataKey="y" name={y.label} unit={y.unit ? ` ${y.unit}` : ''} tick={{ fontSize: 10, fill: '#71717a' }} domain={['auto', 'auto']} width={60} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(v: any, name: any) => [Number(v).toFixed(1), name]}
                  labelFormatter={() => ''}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Scatter data={result.pairs} fill="#6366f1" fillOpacity={0.6} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
};
