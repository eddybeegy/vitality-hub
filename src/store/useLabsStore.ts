import { create } from 'zustand';
import { fetchJson } from '../lib/apiFetch';
import type { AnalyteSpec, LabInput, LabRow, LabTrend, PanelDate, OutOfRangeRow } from '../lib/labs';

// Blood test results. Entered by hand a panel at a time, so the whole set is
// small enough to fetch in one go; the server returns the rows plus the trends,
// panel list and out-of-range exceptions it computed from them. The card never
// recomputes any of that: the range a value was judged against has to be the
// same one the AI context used, or the two will quietly disagree about whether
// a number is high.
interface LabsState {
  results: LabRow[];
  trends: LabTrend[];
  panels: PanelDate[];
  outOfRange: OutOfRangeRow[];
  catalogue: AnalyteSpec[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  ensureLoaded: () => void;
  reload: () => Promise<void>;
  savePanel: (taken_on: string, lab: string | null, results: Partial<LabInput>[]) => Promise<number>;
  remove: (id: number) => Promise<void>;
  removePanel: (taken_on: string) => Promise<void>;
}

export const useLabsStore = create<LabsState>((set, get) => ({
  results: [],
  trends: [],
  panels: [],
  outOfRange: [],
  catalogue: [],
  status: 'idle',

  ensureLoaded: () => {
    if (get().status === 'idle') void get().reload();
  },

  reload: async () => {
    set({ status: 'loading' });
    try {
      // The catalogue is static, so it is only fetched the first time.
      const needCatalogue = get().catalogue.length === 0;
      const [data, cat] = await Promise.all([
        fetchJson<{ results: LabRow[]; panels: PanelDate[]; trends: LabTrend[]; out_of_range: OutOfRangeRow[] }>('/api/labs'),
        needCatalogue ? fetchJson<{ analytes: AnalyteSpec[] }>('/api/labs/catalogue') : Promise.resolve(null),
      ]);
      set({
        results: Array.isArray(data?.results) ? data.results : [],
        trends: Array.isArray(data?.trends) ? data.trends : [],
        panels: Array.isArray(data?.panels) ? data.panels : [],
        outOfRange: Array.isArray(data?.out_of_range) ? data.out_of_range : [],
        catalogue: cat?.analytes ?? get().catalogue,
        status: 'ready',
      });
    } catch (e) {
      console.error('Failed to load lab results', e);
      set({ status: 'error' });
    }
  },

  // Every write refetches: one new panel changes every trend, every movement
  // arrow and the out-of-range list, and the server owns that arithmetic.
  savePanel: async (taken_on, lab, results) => {
    const res = await fetchJson<{ saved: number }>('/api/labs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taken_on, lab, results }),
    });
    await get().reload();
    return res?.saved ?? 0;
  },

  remove: async (id) => {
    await fetchJson(`/api/labs/${id}`, { method: 'DELETE' });
    await get().reload();
  },

  removePanel: async (taken_on) => {
    await fetchJson(`/api/labs?taken_on=${encodeURIComponent(taken_on)}`, { method: 'DELETE' });
    await get().reload();
  },
}));
