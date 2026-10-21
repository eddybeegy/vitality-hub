import React, { useEffect, useMemo, useState } from 'react';
import { Tag, X, Plus } from 'lucide-react';
import { useDayTagsStore } from '../store/useDayTagsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { getLocalDateString, cn } from '../lib/utils';
import { PRESET_TAGS, MAX_NOTE_LENGTH, MAX_TAG_LENGTH, normaliseTag, tagLabel, addDays } from '../lib/dayTags';

// Item 74 (roadmap feature 4): mark what happened on a day. Tags show as markers on
// every HealthChart and go into the AI context; this card is where they are made.
export const DayTagsCard: React.FC = () => {
  const timezone = useSettingsStore(state => state.settings.timezone);
  const { tags, status, ensureLoaded, addTag, removeTag } = useDayTagsStore();
  const showToast = useUIStore(state => state.showToast);

  const today = getLocalDateString(timezone);
  const [date, setDate] = useState(today);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const onDay = useMemo(() => tags.filter(t => t.date === date), [tags, date]);
  const has = (tag: string) => onDay.some(t => t.tag === tag);

  // The week before the selected day, newest first, so a run of "ill" days is visible.
  const recent = useMemo(() => {
    const from = addDays(date, -6);
    return tags
      .filter(t => t.date >= from && t.date < date)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [tags, date]);

  const run = async (key: string, fn: () => Promise<void>, failure: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      console.error(failure, e);
      showToast(failure, 'error');
    } finally {
      setBusy(null);
    }
  };

  // Adding a quick tag takes the note field with it, so "Alcohol" + "wedding" is one tap.
  const toggle = (tag: string) => {
    const active = has(tag);
    return run(tag, async () => {
      if (active) {
        await removeTag(date, tag);
      } else {
        await addTag(date, tag, note.trim() || null);
        setNote('');
      }
    }, "Couldn't update the tag. Try again.");
  };

  const customSlug = normaliseTag(custom);
  const addCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSlug) return;
    void run('custom', async () => {
      await addTag(date, customSlug, note.trim() || null);
      setCustom('');
      setNote('');
    }, "Couldn't add the tag. Try again.");
  };

  const shortDay = (d: string) =>
    new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm p-6 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tag size={16} className="text-zinc-400" />
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Day tags</h3>
        </div>
        <input
          type="date"
          aria-label="Day to tag"
          value={date}
          max={today}
          onChange={e => e.target.value && setDate(e.target.value)}
          className="text-xs bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/10 rounded-lg px-2 py-1 text-zinc-700 dark:text-zinc-200"
        />
      </div>

      {status === 'error' && (
        <p role="alert" className="text-xs text-rose-500">{"Couldn't load your tags."}</p>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick tags">
        {PRESET_TAGS.map(p => {
          const active = has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              disabled={busy !== null}
              onClick={() => void toggle(p.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50",
                active
                  ? "bg-violet-600 border-violet-600 text-white"
                  : "bg-zinc-50 dark:bg-zinc-800 border-black/5 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {onDay.filter(t => !PRESET_TAGS.some(p => p.id === t.tag) || t.note).length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {onDay.filter(t => !PRESET_TAGS.some(p => p.id === t.tag) || t.note).map(t => (
            <li key={t.tag} className="flex items-start justify-between gap-2 text-sm">
              <span className="text-zinc-700 dark:text-zinc-200 min-w-0">
                <span className="font-semibold">{tagLabel(t.tag)}</span>
                {t.note && <span className="text-zinc-500 dark:text-zinc-400"> · {t.note}</span>}
              </span>
              <button
                type="button"
                aria-label={`Remove ${tagLabel(t.tag)}`}
                disabled={busy !== null}
                onClick={() => void run(t.tag, () => removeTag(date, t.tag), "Couldn't remove the tag. Try again.")}
                className="p-1 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addCustom} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          maxLength={MAX_TAG_LENGTH + 8}
          placeholder="Other tag, e.g. sauna"
          aria-label="Custom tag"
          className="flex-1 min-w-0 text-sm bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/10 rounded-lg px-3 py-1.5 text-zinc-700 dark:text-zinc-200"
        />
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Note (optional)"
          aria-label="Note for the next tag"
          className="flex-1 min-w-0 text-sm bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/10 rounded-lg px-3 py-1.5 text-zinc-700 dark:text-zinc-200"
        />
        <button
          type="submit"
          disabled={!customSlug || busy !== null}
          className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 disabled:opacity-40"
        >
          <Plus size={14} /> Add
        </button>
      </form>

      {recent.length > 0 && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Previous 6 days: {recent.map(t => `${shortDay(t.date)} ${tagLabel(t.tag).toLowerCase()}`).join(' · ')}
        </p>
      )}
    </div>
  );
};
