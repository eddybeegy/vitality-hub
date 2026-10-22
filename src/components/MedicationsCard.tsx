import { useEffect, useState } from 'react';
import { Pill, Plus, Trash2, Check, X, RotateCcw } from 'lucide-react';
import { useMedicationsStore } from '../store/useMedicationsStore';
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  KINDS,
  type MedicationFrequency,
  type MedicationInput,
  type MedicationKind,
} from '../lib/medications';

// Medication and supplement log: today's checklist, adherence over the window, and
// the item list. Every number shown here comes from the server (which uses the same
// pure lib as the AI context), so this component formats and does not compute.
//
// Taken / skipped / unlogged are three states, not two: a blank is "nothing said",
// which adherence does not count against the user. That is why clearing a day is a
// first-class action rather than something only a reload can undo.

const emptyDraft = (): MedicationInput => ({
  name: '',
  kind: 'medication',
  dose: null,
  frequency: 'daily',
  start_date: null,
  end_date: null,
  notes: null,
});

const percentText = (p: number | null) => (p === null ? '—' : `${p}%`);

const percentColour = (p: number | null) => {
  if (p === null) return 'text-zinc-400';
  if (p >= 90) return 'text-emerald-600 dark:text-emerald-400';
  if (p >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
};

export function MedicationsCard() {
  const { items, due, adherence, date, status, adherenceDays } = useMedicationsStore();
  const { ensureLoaded, setAdherenceDays, save, remove, setDose, clearDose } = useMedicationsStore();
  const [draft, setDraft] = useState<MedicationInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError('Name is required'); return; }
    await run(async () => {
      await save({ ...draft, name: draft.name.trim() });
      setDraft(null);
    });
  };

  const byId = new Map(adherence.map(a => [a.medication_id, a]));

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
          <Pill size={16} /> Medications &amp; Supplements
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={adherenceDays}
            onChange={(e) => void run(() => setAdherenceDays(Number(e.target.value)))}
            className="text-xs bg-transparent border border-black/10 dark:border-white/10 rounded-lg px-2 py-1 text-zinc-600 dark:text-zinc-300"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            onClick={() => { setDraft(draft ? null : emptyDraft()); setError(null); }}
            className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {status === 'loading' && <p className="text-xs text-zinc-400">Loading…</p>}
      {status === 'error' && <p className="text-xs text-rose-600 dark:text-rose-400">Could not load the log.</p>}

      {draft && (
        <div className="p-3 rounded-xl border border-black/10 dark:border-white/10 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name"
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
            />
            <input
              value={draft.dose ?? ''}
              onChange={(e) => setDraft({ ...draft, dose: e.target.value || null })}
              placeholder="Dose (e.g. 5 mg)"
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
            />
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as MedicationKind })}
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
            >
              {KINDS.map(k => <option key={k} value={k}>{k === 'medication' ? 'Medication' : 'Supplement'}</option>)}
            </select>
            <select
              value={draft.frequency}
              onChange={(e) => setDraft({ ...draft, frequency: e.target.value as MedicationFrequency })}
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
            >
              {(Object.keys(FREQUENCIES) as MedicationFrequency[]).map(f => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Started
              <input
                type="date"
                value={draft.start_date ?? ''}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })}
                className="w-full text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
              />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Stopped
              <input
                type="date"
                value={draft.end_date ?? ''}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value || null })}
                className="w-full text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
              />
            </label>
          </div>
          <input
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
            placeholder="Notes (optional)"
            className="w-full text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={() => { setDraft(null); setError(null); }} className="text-xs text-zinc-500">Cancel</button>
            <span className="text-[10px] text-zinc-400">Saving an existing name updates that item.</span>
          </div>
        </div>
      )}

      {status === 'ready' && items.length === 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
          Nothing logged yet. Add a medication or supplement to track adherence and see start and stop dates on charts.
        </p>
      )}

      {due.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Today{date ? ` · ${date}` : ''}
          </p>
          {due.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                  {d.name}
                  {d.dose ? <span className="font-normal text-zinc-500"> · {d.dose}</span> : null}
                </p>
                <p className="text-[10px] text-zinc-400">{FREQUENCY_LABELS[d.frequency] ?? d.frequency}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  title="Taken"
                  disabled={busy}
                  onClick={() => void run(() => setDose(d.id, date!, true))}
                  className={`p-1.5 rounded-lg border ${d.taken === true ? 'bg-emerald-600 text-white border-emerald-600' : 'border-black/10 dark:border-white/10 text-zinc-400'}`}
                >
                  <Check size={13} />
                </button>
                <button
                  title="Skipped"
                  disabled={busy}
                  onClick={() => void run(() => setDose(d.id, date!, false))}
                  className={`p-1.5 rounded-lg border ${d.taken === false ? 'bg-rose-600 text-white border-rose-600' : 'border-black/10 dark:border-white/10 text-zinc-400'}`}
                >
                  <X size={13} />
                </button>
                <button
                  title="Clear today's entry"
                  disabled={busy || d.taken === null}
                  onClick={() => void run(() => clearDose(d.id, date!))}
                  className="p-1.5 rounded-lg border border-black/10 dark:border-white/10 text-zinc-400 disabled:opacity-30"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Adherence · last {adherenceDays} days
          </p>
          {items.map(m => {
            const a = byId.get(m.id);
            return (
              <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-black/5 dark:border-white/5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{m.name}</p>
                  <p className="text-[10px] text-zinc-400">
                    {a
                      ? m.frequency === 'as_needed'
                        ? `As needed · ${a.taken_days} logged`
                        : `${a.taken_days}/${a.scheduled_days} days · ${a.unlogged_days} unlogged · streak ${a.current_streak}`
                      : FREQUENCY_LABELS[m.frequency] ?? m.frequency}
                    {m.end_date ? ` · stopped ${m.end_date}` : m.start_date ? ` · since ${m.start_date}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold ${percentColour(a?.percent ?? null)}`}>
                    {percentText(a?.percent ?? null)}
                  </span>
                  <button
                    title="Delete item and its log"
                    disabled={busy}
                    onClick={() => void run(() => remove(m.id))}
                    className="p-1.5 rounded-lg text-zinc-300 hover:text-rose-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
