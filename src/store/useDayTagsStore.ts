import { create } from 'zustand';
import { fetchJson } from '../lib/apiFetch';
import type { DayTag } from '../lib/dayTags';

// Item 74: the user's day tags, shared by the Day tags card and every HealthChart.
// The table is small (a handful of rows a week), so the whole list is fetched once
// on first use and then kept in step by the card's own add/remove calls.
interface DayTagsState {
  tags: DayTag[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  ensureLoaded: () => void;
  reload: () => Promise<void>;
  addTag: (date: string, tag: string, note?: string | null) => Promise<void>;
  removeTag: (date: string, tag: string) => Promise<void>;
}

const sameTag = (a: DayTag, date: string, tag: string) => a.date === date && a.tag === tag;

export const useDayTagsStore = create<DayTagsState>((set, get) => ({
  tags: [],
  status: 'idle',

  ensureLoaded: () => {
    if (get().status === 'idle') void get().reload();
  },

  reload: async () => {
    set({ status: 'loading' });
    try {
      const tags = await fetchJson<DayTag[]>('/api/day-tags');
      set({ tags: Array.isArray(tags) ? tags : [], status: 'ready' });
    } catch (e) {
      console.error('Failed to load day tags', e);
      set({ status: 'error' });
    }
  },

  // Throws on failure so the card can tell the user; the list only changes once the
  // server has accepted the write, and then holds the server's normalised tag.
  addTag: async (date, tag, note = null) => {
    const saved = await fetchJson<DayTag>('/api/day-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, tag, note }),
    });
    set(state => ({
      tags: [...state.tags.filter(t => !sameTag(t, saved.date, saved.tag)), saved]
        .sort((a, b) => a.date.localeCompare(b.date) || a.tag.localeCompare(b.tag)),
    }));
  },

  removeTag: async (date, tag) => {
    await fetchJson(`/api/day-tags?date=${encodeURIComponent(date)}&tag=${encodeURIComponent(tag)}`, { method: 'DELETE' });
    set(state => ({ tags: state.tags.filter(t => !sameTag(t, date, tag)) }));
  },
}));
