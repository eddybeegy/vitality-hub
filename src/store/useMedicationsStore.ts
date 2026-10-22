import { create } from 'zustand';
import { fetchJson } from '../lib/apiFetch';
import type { Adherence, Medication, MedicationInput } from '../lib/medications';

// The medication and supplement log, shared by the Medications card and every
// HealthChart (which draws start/stop markers). Small table - a handful of items -
// so the whole list is fetched once on first use and kept in step by the card's
// own writes. Adherence is computed server-side and refetched with the list,
// because the card and the AI context must not disagree about a percentage.
export interface DueItem extends Medication {
  taken: boolean | null;
}

interface MedicationsState {
  items: Medication[];
  due: DueItem[];
  adherence: Adherence[];
  date: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  adherenceDays: number;
  ensureLoaded: () => void;
  reload: () => Promise<void>;
  setAdherenceDays: (days: number) => Promise<void>;
  save: (input: MedicationInput) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setDose: (id: number, date: string, taken: boolean) => Promise<void>;
  clearDose: (id: number, date: string) => Promise<void>;
}

export const useMedicationsStore = create<MedicationsState>((set, get) => ({
  items: [],
  due: [],
  adherence: [],
  date: null,
  status: 'idle',
  adherenceDays: 30,

  ensureLoaded: () => {
    if (get().status === 'idle') void get().reload();
  },

  reload: async () => {
    set({ status: 'loading' });
    try {
      const days = get().adherenceDays;
      const [list, scores] = await Promise.all([
        fetchJson<{ date: string; items: Medication[]; due: DueItem[] }>('/api/medications'),
        fetchJson<{ items: Adherence[] }>(`/api/medications/adherence?days=${days}`),
      ]);
      set({
        items: Array.isArray(list?.items) ? list.items : [],
        due: Array.isArray(list?.due) ? list.due : [],
        date: list?.date ?? null,
        adherence: Array.isArray(scores?.items) ? scores.items : [],
        status: 'ready',
      });
    } catch (e) {
      console.error('Failed to load medications', e);
      set({ status: 'error' });
    }
  },

  setAdherenceDays: async (days) => {
    set({ adherenceDays: days });
    await get().reload();
  },

  // Writes throw on failure so the card can tell the user, and each one refetches
  // rather than patching local state: a dose changes a streak and a percentage
  // that only the server knows how to recompute.
  save: async (input) => {
    await fetchJson('/api/medications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    await get().reload();
  },

  remove: async (id) => {
    await fetchJson(`/api/medications/${id}`, { method: 'DELETE' });
    await get().reload();
  },

  setDose: async (id, date, taken) => {
    await fetchJson(`/api/medications/${id}/doses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, taken }),
    });
    await get().reload();
  },

  clearDose: async (id, date) => {
    await fetchJson(`/api/medications/${id}/doses?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
    await get().reload();
  },
}));
