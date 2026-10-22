import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Plus, Trash2, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useLabsStore } from '../store/useLabsStore';
import type { AnalyteSpec, LabTrend } from '../lib/labs';

// Blood test results: latest value per analyte with the reference range it was
// judged against, a sparkline of its history, and panel entry.
//
// Two rules this card exists to keep visible:
//  - The range shown is the one stored on the row when the user typed it off their
//    own report, and only otherwise a typical adult range. Which it is, is labelled
//    ("your report" vs "typical range"), because a lab's range is a fact about that
//    lab and a catalogue range is not a fact about the user at all.
//  - A value with no range anywhere is shown plainly with no verdict. "Unknown" is
//    an honest answer here; a reassuring green tick would not be.
//
// It formats only. Flags, movement and ordering all come from the server, which
// uses the same pure lib as the AI context.

const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const FLAG_STYLE: Record<string, string> = {
  low: 'text-sky-600 dark:text-sky-400',
  high: 'text-rose-600 dark:text-rose-400',
  in_range: 'text-emerald-600 dark:text-emerald-400',
  unknown: 'text-zinc-400',
};

const FLAG_LABEL: Record<string, string> = {
  low: 'below range',
  high: 'above range',
  in_range: 'in range',
  unknown: 'no range',
};

const fmt = (v: number, dp: number) => v.toFixed(dp);

const rangeText = (t: LabTrend) => {
  const { low, high, source } = t.range;
  if (source === 'none') return 'no reference range';
  const body = low !== null && high !== null ? `${low}–${high}` : low !== null ? `≥ ${low}` : `≤ ${high}`;
  return `${body} ${source === 'row' ? '(your report)' : '(typical range)'}`;
};

// A plain polyline, not a chart library: eight points in 120×28 px needs no axes,
// and the real numbers are listed next to it anyway.
function Sparkline({ history, dp }: { history: Array<{ taken_on: string; value: number }>; dp: number }) {
  if (history.length < 2) return <div className="w-[120px] text-[10px] text-zinc-400">one result</div>;
  const vals = history.map(h => h.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = history.map((h, i) => {
    const x = (i / (history.length - 1)) * 118 + 1;
    const y = 27 - ((h.value - min) / span) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={120} height={28} className="shrink-0" role="img"
      aria-label={`${history.length} results, ${fmt(min, dp)} to ${fmt(max, dp)}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-indigo-500" />
    </svg>
  );
}

function Movement({ t }: { t: LabTrend }) {
  if (!t.previous || t.movement === null) return null;
  const delta = t.change === null ? '' : `${t.change > 0 ? '+' : ''}${fmt(t.change, t.dp)}`;
  const cls = t.movement === 'better' ? 'text-emerald-600 dark:text-emerald-400'
    : t.movement === 'worse' ? 'text-rose-600 dark:text-rose-400'
    : 'text-zinc-400';
  const Icon = t.change === null || t.change === 0 ? Minus : t.change > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${cls}`} title={`vs ${t.previous.taken_on}`}>
      <Icon size={11} /> {delta}
    </span>
  );
}

interface DraftRow { analyte: string; value: string; unit: string; ref_low: string; ref_high: string }

const emptyRow = (): DraftRow => ({ analyte: '', value: '', unit: '', ref_low: '', ref_high: '' });

export function LabResultsCard() {
  const { trends, panels, outOfRange, catalogue, status, ensureLoaded, savePanel, remove, removePanel } = useLabsStore();
  const [open, setOpen] = useState(false);
  const [takenOn, setTakenOn] = useState(todayLocal());
  const [lab, setLab] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const byGroup = useMemo(() => {
    const groups: Array<{ group: string; items: LabTrend[] }> = [];
    for (const t of trends) {
      const last = groups[groups.length - 1];
      if (last && last.group === t.group) last.items.push(t);
      else groups.push({ group: t.group, items: [t] });
    }
    return groups;
  }, [trends]);

  const specByKey = useMemo(() => new Map(catalogue.map(a => [a.key, a])), [catalogue]);

  const setRow = (i: number, patch: Partial<DraftRow>) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Picking an analyte prefills its unit, so a value is never stored unitless just
  // because the user did not retype something the catalogue already knows.
  const pickAnalyte = (i: number, key: string) => {
    const spec = specByKey.get(key);
    setRow(i, { analyte: key, unit: rows[i].unit || (spec?.unit ?? '') });
  };

  const submit = async () => {
    const filled = rows.filter(r => r.analyte && r.value.trim() !== '');
    if (!filled.length) { setError('Add at least one result'); return; }
    setBusy(true);
    setError(null);
    try {
      await savePanel(takenOn, lab.trim() || null, filled.map(r => ({
        analyte: r.analyte,
        value: Number(r.value),
        unit: r.unit.trim() || null,
        ref_low: r.ref_low.trim() === '' ? null : Number(r.ref_low),
        ref_high: r.ref_high.trim() === '' ? null : Number(r.ref_high),
      })));
      setRows([emptyRow()]);
      setLab('');
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Could not save the panel');
    } finally {
      setBusy(false);
    }
  };

  const drop = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message || 'Could not delete'); } finally { setBusy(false); }
  };

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
          <FlaskConical size={16} /> Blood tests
        </h3>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 inline-flex items-center gap-1"
        >
          <Plus size={12} /> Add panel
        </button>
      </div>

      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}

      {open && (
        <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex flex-wrap gap-2">
            <label className="text-[11px] text-zinc-500">
              Date drawn
              <input type="date" value={takenOn} onChange={e => setTakenOn(e.target.value)}
                className="block mt-0.5 px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10" />
            </label>
            <label className="text-[11px] text-zinc-500 flex-1 min-w-[140px]">
              Lab (optional)
              <input value={lab} onChange={e => setLab(e.target.value)} placeholder="e.g. GP surgery, Medichecks"
                className="block mt-0.5 w-full px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10" />
            </label>
          </div>

          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-1.5">
              <select value={r.analyte} onChange={e => pickAnalyte(i, e.target.value)}
                className="px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 min-w-[150px]">
                <option value="">Select…</option>
                {catalogue.map((a: AnalyteSpec) => (
                  <option key={a.key} value={a.key}>{a.group} · {a.label}</option>
                ))}
              </select>
              <input value={r.value} onChange={e => setRow(i, { value: e.target.value })} placeholder="value" inputMode="decimal"
                className="w-20 px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10" />
              <input value={r.unit} onChange={e => setRow(i, { unit: e.target.value })} placeholder="unit"
                className="w-24 px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10" />
              <input value={r.ref_low} onChange={e => setRow(i, { ref_low: e.target.value })} placeholder="ref low" inputMode="decimal"
                className="w-20 px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10" />
              <input value={r.ref_high} onChange={e => setRow(i, { ref_high: e.target.value })} placeholder="ref high" inputMode="decimal"
                className="w-20 px-2 py-1 text-xs rounded-lg bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10" />
            </div>
          ))}

          <div className="flex items-center gap-2">
            <button onClick={() => setRows(rs => [...rs, emptyRow()])}
              className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
              Another result
            </button>
            <button onClick={submit} disabled={busy}
              className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50">
              Save panel
            </button>
          </div>
          <p className="text-[10px] text-zinc-400">
            Reference low/high are optional — copy them off your own report if it prints them. Left blank,
            a typical adult range is used and labelled as such.
          </p>
        </div>
      )}

      {status === 'loading' && <div className="text-xs text-zinc-400">Loading…</div>}
      {status === 'error' && <div className="text-xs text-rose-500">Could not load results.</div>}

      {status === 'ready' && trends.length === 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No results yet. Add a panel and each analyte gets a trend line.
        </p>
      )}

      {outOfRange.length > 0 && (
        <div className="text-xs p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
          Outside range: {outOfRange.map(o => {
            // The date is shown only when this is not the newest panel's own reading:
            // an analyte nothing has retested since stays an exception, but it should
            // not look fresher than it is.
            const stale = panels.length > 0 && o.taken_on !== panels[0].taken_on;
            return `${o.label} ${o.value}${o.unit ? ' ' + o.unit : ''} (${FLAG_LABEL[o.flag]}${stale ? `, as of ${o.taken_on}` : ''})`;
          }).join(', ')}.
        </div>
      )}

      {byGroup.map(g => (
        <div key={g.group} className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">{g.group}</div>
          {g.items.map(t => (
            <div key={t.analyte} className="flex items-center gap-2 py-1 border-b border-black/5 dark:border-white/5 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{t.label}</div>
                <div className="text-[10px] text-zinc-400">{rangeText(t)} · {t.latest.taken_on}</div>
              </div>
              <Sparkline history={t.history} dp={t.dp} />
              <div className="text-right w-28">
                <div className={`text-xs font-semibold ${FLAG_STYLE[t.flag]}`}>
                  {fmt(t.latest.value, t.dp)} {t.unit || ''}
                </div>
                <div className="text-[10px] text-zinc-400 flex items-center justify-end gap-1">
                  {FLAG_LABEL[t.flag]} <Movement t={t} />
                </div>
              </div>
              <button onClick={() => drop(() => remove(t.latest.id))} disabled={busy}
                title="Delete this result" className="text-zinc-300 hover:text-rose-500 disabled:opacity-40">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ))}

      {panels.length > 0 && (
        <div className="text-[10px] text-zinc-400 space-y-0.5">
          <div className="uppercase tracking-wide">Panels</div>
          {panels.map(p => (
            <div key={p.taken_on} className="flex items-center gap-2">
              <span>{p.taken_on} · {p.count} result{p.count === 1 ? '' : 's'}{p.lab ? ` · ${p.lab}` : ''}</span>
              <button onClick={() => drop(() => removePanel(p.taken_on))} disabled={busy}
                className="hover:text-rose-500 disabled:opacity-40" title="Delete this whole panel">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
