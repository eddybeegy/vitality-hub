import { create } from 'zustand';
import { standardizeMetrics, groupMetricsByType, standardizeWorkouts, StandardizedMetric, StandardizedWorkout } from '../services/healthDataService';
import { useUIStore } from './useUIStore';
import { parseUTCDate } from '../lib/utils';

interface SummaryData {
  metrics: StandardizedMetric[];
  latestMetrics: StandardizedMetric[];
  workouts: StandardizedWorkout[];
  routines: any[];
  routineExercises: any[];
  exercises: any[];
  sets: any[];
  syncLogs: any[];
  syncIssues: Record<string, { message: string; level: string; timestamp: string }>;
  // Same issues, re-keyed by module id via the server's MODULE_SOURCES map, because
  // logs.source and module.id are not the same namespace. See SyncHealthWidget.
  syncIssuesByModule?: Record<string, { message: string; level: string; timestamp: string; source: string }>;
  // Newest actual reading per source / per module, computed server-side from the raw
  // tables. Optional because a cached payload from before this shipped will not have it.
  dataFreshness?: {
    bySource: Record<string, string>;
    byTable?: Record<string, Record<string, string>>;
    byModule: Record<string, { lastReading: string | null; sources: string[]; tables?: string[] }>;
  };
}

export interface AppleHealthSyncSummary {
  lastSync?: string;
  count?: number;
  rawNames?: string[];
  names?: { raw: string; mappedTo: string | null; points: number; noValue: boolean }[];
  message?: string;
}

interface HealthState {
  summaryData: SummaryData;
  isSyncing: boolean;
  // Item 47: this used to be `string | null` and was set to `data.lastSync`, while
  // the only consumer (LogsTab's "Raw Metrics Received") read `.rawNames` off it --
  // a string never has that. The whole summary object is kept now.
  lastAppleHealthSync: AppleHealthSyncSummary | null;
  logs: any[];
  logFilter: 'all' | 'debug' | 'info' | 'warn' | 'error';
  debugMetrics: any[];
  lastMetrics: any[];
  expandedWorkouts: Record<number, boolean>;
  // Bumped when a long-lived tab regains focus (item 26). Components that fetch
  // their own data (url-backed charts, the insights freshness badge) watch it.
  focusRefreshNonce: number;
  bumpFocusRefresh: () => void;
  setSummaryData: (data: Partial<SummaryData> | ((prev: SummaryData) => SummaryData)) => void;
  setIsSyncing: (isSyncing: boolean) => void;
  setLastAppleHealthSync: (sync: AppleHealthSyncSummary | null) => void;
  setLogs: (logs: any[] | ((prev: any[]) => any[])) => void;
  setLogFilter: (filter: 'all' | 'debug' | 'info' | 'warn' | 'error') => void;
  setDebugMetrics: (metrics: any[]) => void;
  setLastMetrics: (metrics: any[]) => void;
  setExpandedWorkouts: (expanded: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => void;
  fetchSummary: () => Promise<void>;
  fetchLogs: () => Promise<void>;
  fetchLastAppleHealthSync: () => Promise<void>;
  syncModule: (moduleId: string) => Promise<void>;
  modules: any[];
  setModules: (modules: any[]) => void;
  fetchModules: () => Promise<void>;
  toggleModule: (moduleId: string, enabled: boolean) => Promise<void>;
  updateModuleSettings: (moduleId: string, moduleSettings: any) => Promise<void>;
  purgeModuleData: (moduleId: string) => Promise<void>;
  syncAllModules: () => Promise<void>;
  refreshSummary: () => Promise<void>;
  getChartData: (type: string, dataKey: string) => any[];
  isInitialLoading: boolean;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  summaryData: { metrics: [], latestMetrics: [], workouts: [], routines: [], routineExercises: [], exercises: [], sets: [], syncLogs: [], syncIssues: {}, syncIssuesByModule: {} },
  isSyncing: false,
  isInitialLoading: true,
  lastAppleHealthSync: null,
  logs: [],
  logFilter: 'all',
  debugMetrics: [],
  lastMetrics: [],
  expandedWorkouts: {},
  focusRefreshNonce: 0,
  bumpFocusRefresh: () => set((state) => ({ focusRefreshNonce: state.focusRefreshNonce + 1 })),
  modules: [],
  setSummaryData: (updater) => set((state) => ({
    summaryData: typeof updater === 'function' ? updater(state.summaryData) : { ...state.summaryData, ...updater }
  })),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  setLastAppleHealthSync: (lastAppleHealthSync) => set({ lastAppleHealthSync }),
  setLogs: (updater) => set((state) => ({
    logs: typeof updater === 'function' ? updater(state.logs) : updater
  })),
  setLogFilter: (logFilter) => set({ logFilter }),
  setDebugMetrics: (debugMetrics) => set({ debugMetrics }),
  setLastMetrics: (lastMetrics) => set({ lastMetrics }),
  setExpandedWorkouts: (updater) => set((state) => ({
    expandedWorkouts: typeof updater === 'function' ? updater(state.expandedWorkouts) : updater
  })),
  setModules: (modules) => set({ modules }),
  fetchSummary: async () => {
    try {
      const res = await fetch('/api/data/summary');
      if (res.ok) {
        const data = await res.json();
        
        // Standardize data before storing
        const standardizedMetrics = standardizeMetrics(data.metrics || []);
        const standardizedLatest = standardizeMetrics(data.latestMetrics || []);
        const standardizedWorkouts = standardizeWorkouts(
          data.workouts || [], 
          data.exercises || [], 
          data.sets || []
        );

        set({ 
          summaryData: {
            ...data,
            metrics: standardizedMetrics,
            latestMetrics: standardizedLatest,
            workouts: standardizedWorkouts
          },
          isInitialLoading: false
        });
      } else {
        set({ isInitialLoading: false });
      }
    } catch (e) {
      console.error("Fetch summary failed", e);
      set({ isInitialLoading: false });
    }
  },
  fetchLogs: async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        set({ logs: data });
      }
    } catch (e) {
      console.error("Fetch logs failed", e);
    }
  },
  fetchLastAppleHealthSync: async () => {
    try {
      const res = await fetch('/api/debug/apple-health-last-sync');
      if (res.ok) {
        const data = await res.json();
        set({ lastAppleHealthSync: data });
      }
    } catch (e) {
      console.error("Fetch last sync failed", e);
    }
  },
  syncModule: async (moduleId: string) => {
    set({ isSyncing: true });
    try {
      const res = await fetch(`/api/sync/${moduleId}`, { method: 'POST' });
      if (res.ok) {
        if (res.status === 202) {
          useUIStore.getState().showToast(`${moduleId} sync started in background`, 'info');
          
          // Poll for completion
          const pollStatus = async () => {
            try {
              const statusRes = await fetch('/api/sync/status');
              if (statusRes.ok) {
                const status = await statusRes.json();
                if (!status.isSyncing) {
                  useUIStore.getState().showToast(`${moduleId} sync completed`, 'success');
                  await get().fetchSummary();
                  set({ isSyncing: false });
                } else {
                  setTimeout(pollStatus, 2000);
                }
              } else {
                set({ isSyncing: false });
                await get().fetchSummary();
              }
            } catch (e) {
              set({ isSyncing: false });
              await get().fetchSummary();
            }
          };
          // Start polling after a short delay
          setTimeout(pollStatus, 2000);
        } else {
          useUIStore.getState().showToast(`${moduleId} sync completed`, 'success');
          await get().fetchSummary();
          set({ isSyncing: false });
        }
      } else {
        const data = await res.json();
        useUIStore.getState().showToast(`Sync failed: ${data.error || 'Unknown error'}`, 'error');
        set({ isSyncing: false });
      }
    } catch (e) {
      console.error("Sync module failed", e);
      set({ isSyncing: false });
    }
  },
  fetchModules: async () => {
    try {
      const res = await fetch('/api/modules');
      if (res.ok) {
        const data = await res.json();
        set({ modules: data });
      }
    } catch (e) {
      console.error("Fetch modules failed", e);
    }
  },
  toggleModule: async (moduleId, enabled) => {
    try {
      const res = await fetch(`/api/modules/${moduleId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (res.ok) {
        get().fetchModules();
      }
    } catch (e) {
      console.error("Toggle module failed", e);
    }
  },
  updateModuleSettings: async (moduleId, moduleSettings) => {
    try {
      const trimmedSettings: any = {};
      Object.keys(moduleSettings).forEach(key => {
        const val = moduleSettings[key];
        trimmedSettings[key] = typeof val === 'string' ? val.trim() : val;
      });

      const res = await fetch(`/api/modules/${moduleId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: trimmedSettings })
      });
      if (res.ok) {
        get().fetchModules();
      }
    } catch (e) {
      console.error("Update module settings failed", e);
    }
  },
  purgeModuleData: async (moduleId) => {
    if (!confirm(`Are you sure you want to purge all data for ${moduleId}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/purge/${moduleId}`, { method: 'POST' });
      if (res.ok) {
        useUIStore.getState().showToast(`${moduleId} data purged successfully`, 'success');
        get().fetchSummary();
      }
    } catch (e) {
      console.error("Purge module data failed", e);
    }
  },
  syncAllModules: async () => {
    set({ isSyncing: true });
    try {
      const { modules } = get();
      const enabledModules = modules.filter(m => m.enabled);
      
      if (enabledModules.length === 0) {
        useUIStore.getState().showToast("No active modules to sync", "info");
        set({ isSyncing: false });
        return;
      }

      useUIStore.getState().showToast(`Syncing ${enabledModules.length} modules...`, "info");

      for (const module of enabledModules) {
        const response = await fetch(`/api/sync/${module.id}`, { method: 'POST' });
        if (!response.ok) {
          console.error(`Failed to start sync for module ${module.id}`);
        }
      }
      
      // Poll for overall completion
      const pollStatus = async () => {
        try {
          const statusRes = await fetch('/api/sync/status');
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.isSyncing) {
              useUIStore.getState().showToast("All modules synced", "success");
              await get().fetchSummary();
              set({ isSyncing: false });
            } else {
              setTimeout(pollStatus, 2000);
            }
          } else {
            set({ isSyncing: false });
            await get().fetchSummary();
          }
        } catch (e) {
          set({ isSyncing: false });
          await get().fetchSummary();
        }
      };
      
      // Start polling
      setTimeout(pollStatus, 2000);
    } catch (error) {
      console.error("Global sync failed", error);
      set({ isSyncing: false });
    }
  },
  refreshSummary: async () => {
    // POST /api/data/refresh now starts a real sync of the pull modules (202) and
    // returns before it finishes, so keep the spinner up and poll /api/sync/status the
    // same way syncAllModules does, then refetch once. 409 means a sync is already
    // running: wait for that one instead. Capped so a hung upstream can't spin forever.
    set({ isSyncing: true });
    try {
      const res = await fetch('/api/data/refresh', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 202 || res.status === 409) {
        const names = Array.isArray(body?.modules) && body.modules.length ? body.modules.join(', ') : 'modules';
        useUIStore.getState().showToast(res.status === 409 ? 'A sync is already running…' : `Syncing ${names}…`, 'info');
        const deadline = Date.now() + 5 * 60_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          const statusRes = await fetch('/api/sync/status');
          if (!statusRes.ok) break;
          const status = await statusRes.json();
          if (!status.isSyncing) break;
        }
      } else if (!res.ok) {
        console.error(`Refresh Data failed: HTTP ${res.status}`);
      }
      await get().fetchSummary();
    } catch (err) {
      console.error("Failed to refresh summary:", err);
    } finally {
      set({ isSyncing: false });
    }
  },
  getChartData: (type: string, dataKey: string) => {
    const { summaryData } = get();
    // Data is already standardized in fetchSummary
    const grouped = groupMetricsByType(summaryData.metrics || []);
    const filtered = grouped[type] || [];
    
    return filtered.map(m => ({ 
      date: m.timestamp, 
      [dataKey]: m.value
    }));
  }
}));
