import React from 'react';
import { Newspaper, Loader2, ArrowUpRight, ArrowDownRight, Minus, Copy, Check } from 'lucide-react';
import { fetchJson } from '../lib/apiFetch';
import { cn } from '../lib/utils';
import type { Digest, DigestLine, DigestPeriod } from '../lib/digest';

/**
 * Weekly / monthly digest card (roadmap: "A Sunday summary of training, sleep,
 * intake and weight against the previous week, delivered by the same channel as
 * alerts").
 *
 * Phone alerts are the last roadmap item, so there is no delivery channel yet.
 * This is the digest itself, on the dashboard, plus a copy button for the plain
 * text the server already renders -- so the text a push notification will carry
 * is the text on screen, not a second rendering that can drift from it.
 *
 * All the arithmetic is server-side (src/lib/digest.ts, shared with the
 * get_digest MCP tool). This component formats; it does not compute.
 */

const PERIODS: Array<{ id: DigestPeriod; label: string }> = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/** Up is not automatically good, so the arrow is neutral-coloured by default. */
const TrendIcon: React.FC<{ line: DigestLine }> = ({ line }) => {
  if (line.direction === null) return null;
  if (line.direction === 'flat') return <Minus size={12} className="text-zinc-400" />;
  const Icon = line.direction === 'up' ? ArrowUpRight : ArrowDownRight;
  return <Icon size={12} className="text-zinc-400 dark:text-zinc-500" />;
};

const fmtNumber = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-GB') : String(n);

const fmtValue = (line: DigestLine): string => {
  if (line.current === null) return '—';
  const text = fmtNumber(line.current);
  return line.unit ? `${text} ${line.unit}` : text;
};

/**
 * The target the value is measured against, when one is set. The unit is already
 * on the value, so it is not repeated. A 0 target means "unset" in this schema
 * and `src/lib/digest.ts` already resolves it to null, so nothing is shown for
 * one rather than a goal of zero.
 */
const TargetHint: React.FC<{ line: DigestLine }> = ({ line }) =>
  line.target === null ? null : (
    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
      / {fmtNumber(line.target)}
    </span>
  );

const LineRow: React.FC<{ line: DigestLine }> = ({ line }) => (
  <div className="flex items-baseline justify-between gap-2 py-0.5">
    <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{line.label}</span>
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={cn('text-sm font-mono font-semibold', line.current === null ? 'text-zinc-400' : 'text-zinc-900 dark:text-zinc-100')}>
        {fmtValue(line)}
      </span>
      <TargetHint line={line} />
      {line.changePct !== null && (
        <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 flex items-center gap-0.5 w-12 justify-end">
          <TrendIcon line={line} />
          {Math.abs(line.changePct) < 1 ? '—' : `${Math.abs(line.changePct).toFixed(0)}%`}
        </span>
      )}
      {line.changePct === null && <span className="w-12" />}
    </span>
  </div>
);

export const DigestCard: React.FC = () => {
  const [period, setPeriod] = React.useState<DigestPeriod>('week');
  const [digest, setDigest] = React.useState<(Digest & { text: string }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchJson<Digest & { text: string }>(`/api/digest?period=${period}`)
      .then(d => { if (live) { setDigest(d); setLoading(false); } })
      .catch(e => {
        console.error('Digest fetch failed', e);
        if (live) { setError('Could not load the digest'); setLoading(false); }
      });
    return () => { live = false; };
  }, [period]);

  const copy = async () => {
    if (!digest?.text) return;
    try {
      await navigator.clipboard.writeText(digest.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('Digest copy failed', e);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col h-full">
      <div className="flex justify-between items-start mb-3">
        <div className="p-2 bg-sky-50 dark:bg-sky-900/20 rounded-xl">
          <Newspaper className="text-sky-500" size={20} />
        </div>
        <div className="flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                'text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg transition-colors',
                period === p.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={copy}
            disabled={!digest}
            title="Copy the digest as text"
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1 italic font-serif">
        {period === 'week' ? 'Weekly Digest' : 'Monthly Digest'}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400 py-6">
          <Loader2 size={14} className="animate-spin" /> Building digest…
        </div>
      )}

      {!loading && error && <p className="text-xs text-rose-500 py-6">{error}</p>}

      {!loading && !error && digest && (
        <>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
            {digest.current.from} → {digest.current.to} vs {digest.previous.from} → {digest.previous.to}
          </p>

          <ul className="mb-4 space-y-1">
            {digest.headlines.map((h, i) => (
              <li key={i} className="text-xs text-zinc-700 dark:text-zinc-300 flex gap-1.5">
                <span className="text-sky-500">•</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-3">
            {digest.sections.map(section => (
              <div key={section.key}>
                <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1">
                  {section.label}
                </p>
                {section.lines.map(line => <LineRow key={line.key} line={line} />)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
