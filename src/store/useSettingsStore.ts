import { create } from 'zustand';
import { useUIStore } from './useUIStore';
import { fetchJson } from '../lib/apiFetch';
import { normaliseTargetValue, toApiTargetValue, type TargetValue } from '../lib/targets';

interface Medication {
  name: string;
  dose: string;
  frequency: string;
}

interface Settings {
  email: string;
  name: string;
  sync_history_days: number;
  display_mode: string;
  age: number;
  dob: string;
  gender: string;
  preferred_units: string;
  default_graph_range: string;
  default_graph_grouping: string;
  timezone: string;
  height: number;
  show_debug_logs: boolean;
  ai_provider: string;
  ai_api_key: string;
  ai_base_url: string;
  ai_model: string;
  ai_configs?: { provider: string; api_key: string; model: string; base_url: string }[];
  meal_suggestion_breakfast: boolean;
  meal_suggestion_lunch: boolean;
  meal_suggestion_dinner: boolean;
  withings_connected?: boolean;
  hevy_api_key?: string;
  ai_hints?: string;
  ai_persona?: string;
  ai_focus?: string;
  enable_daily_briefing?: boolean;
  enable_correlations: boolean;
  medications: Medication[];
  ai_generation_times?: string;
  metric_priorities?: string;
  font_size: string;
  dashboard_widgets: string[];
  readiness_recovery_days?: number;
}

interface Target {
  type: string;
  label: string;
  unit: string;
  value: TargetValue;
}

interface SettingsState {
  settings: Settings;
  targets: Target[];
  targetsLoaded: boolean;
  /** True once /api/settings has loaded; until then `settings` is defaultSettings. */
  settingsLoaded: boolean;
  showApiKey: boolean;
  showModulePasswords: Record<string, boolean>;
  setSettings: (settings: Partial<Settings> | ((prev: Settings) => Settings)) => void;
  setTargets: (targets: Target[] | ((prev: Target[]) => Target[])) => void;
  setShowApiKey: (show: boolean) => void;
  setShowModulePasswords: (passwords: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  fetchSettings: () => Promise<void>;
  fetchTargets: () => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  handleSaveTargets: () => Promise<void>;
  updateAISetting: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;
}

const defaultSettings: Settings = {
  email: '',
  name: '',
  sync_history_days: 90,
  display_mode: 'auto',
  age: 30,
  dob: '1996-01-01',
  gender: 'male',
  preferred_units: 'metric',
  default_graph_range: '90d',
  default_graph_grouping: 'day',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  height: 0,
  show_debug_logs: false,
  ai_provider: 'gemini',
  ai_api_key: '',
  ai_base_url: '',
  ai_model: '',
  ai_hints: '',
  ai_persona: 'Encouraging Coach',
  ai_focus: 'General Health',
  enable_daily_briefing: true,
  enable_correlations: true,
  medications: [],
  meal_suggestion_breakfast: true,
  meal_suggestion_lunch: true,
  meal_suggestion_dinner: true,
  withings_connected: false,
  hevy_api_key: '',
  font_size: 'medium',
  dashboard_widgets: ['readiness_card', 'stats', 'charts', 'nutrition', 'micronutrient_radar', 'macronutrient_radar', 'smart_adjustments', 'sleep_stages']
};

const defaultTargets: Target[] = [
  { type: 'weight', label: 'Weight', unit: 'kg', value: null },
  { type: 'body_fat', label: 'Body Fat', unit: '%' , value: null },
  { type: 'muscle_mass', label: 'Muscle Mass', unit: 'kg', value: null },
  { type: 'steps', label: 'Steps', unit: '', value: null },
  { type: 'vo2_max', label: 'VO2 Max', unit: 'ml/kg/min', value: null },
  { type: 'calories', label: 'Daily Calories', unit: 'kcal', value: null },
  { type: 'protein', label: 'Daily Protein', unit: 'g', value: null },
  { type: 'carbs', label: 'Daily Carbs', unit: 'g', value: null },
  { type: 'fat', label: 'Daily Fat', unit: 'g', value: null },
  { type: 'water', label: 'Daily Water', unit: 'ml', value: null },
  { type: 'sleep', label: 'Daily Sleep', unit: 'h', value: null },
  { type: 'resting_heart_rate', label: 'Resting Heart Rate', unit: 'bpm', value: null },
  { type: 'exercise_time', label: 'Daily Active Minutes', unit: 'min', value: null },
  { type: 'stand_time', label: 'Daily Stand Hours', unit: 'h', value: null },
  { type: 'fiber', label: 'Daily Fiber', unit: 'g', value: null },
  { type: 'sugar', label: 'Daily Sugar', unit: 'g', value: null },
  { type: 'unsaturated_fat', label: 'Daily Unsaturated Fat', unit: 'g', value: null },
  { type: 'active_energy', label: 'Daily Active Energy', unit: 'kcal', value: null },
  { type: 'blood_oxygen_saturation', label: 'Blood Oxygen', unit: '%', value: null },
];

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  targets: defaultTargets,
  targetsLoaded: false,
  settingsLoaded: false,
  showApiKey: false,
  showModulePasswords: {},
  setSettings: (updater) => set((state) => ({
    settings: typeof updater === 'function' ? updater(state.settings) : { ...state.settings, ...updater }
  })),
  setTargets: (updater) => set((state) => ({
    targets: typeof updater === 'function' ? updater(state.targets) : updater
  })),
  setShowApiKey: (showApiKey) => set({ showApiKey }),
  setShowModulePasswords: (updater) => set((state) => ({
    showModulePasswords: typeof updater === 'function' ? updater(state.showModulePasswords) : updater
  })),
  fetchSettings: async () => {
    try {
      // A failed fetch must not reach the merge below: a 500's {"error": ...} used to be
      // spread into settings and every boolean re-defaulted from it.
      const data = await fetchJson('/api/settings');
      let medications = [];
      if (data.medications) {
        try {
          medications = typeof data.medications === 'string' ? JSON.parse(data.medications) : data.medications;
          if (!Array.isArray(medications)) medications = [];
        } catch (e) {
          console.error("Failed to parse medications:", e);
          medications = [];
        }
      }

      let dashboard_widgets = data.dashboard_widgets;
      if (dashboard_widgets && typeof dashboard_widgets === 'string') {
        try {
          dashboard_widgets = JSON.parse(dashboard_widgets);
        } catch (e) {
          console.error("Failed to parse dashboard widgets", e);
          dashboard_widgets = null;
        }
      }

      set((state) => {
        const finalWidgets = Array.isArray(dashboard_widgets) ? dashboard_widgets : state.settings.dashboard_widgets;
        const newSettings = {
          ...state.settings,
          ...data,
          medications,
          dashboard_widgets: finalWidgets,
          enable_daily_briefing: data.enable_daily_briefing == null ? true : !!data.enable_daily_briefing,
          enable_correlations: data.enable_correlations == null ? true : !!data.enable_correlations,
          meal_suggestion_breakfast: data.meal_suggestion_breakfast == null ? true : !!data.meal_suggestion_breakfast,
          meal_suggestion_lunch: data.meal_suggestion_lunch == null ? true : !!data.meal_suggestion_lunch,
          meal_suggestion_dinner: data.meal_suggestion_dinner == null ? true : !!data.meal_suggestion_dinner,
          show_debug_logs: !!data.show_debug_logs
        };
        return { settings: newSettings, settingsLoaded: true };
      });
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  },
  fetchTargets: async () => {
    try {
      const data = await fetchJson('/api/targets');
      if (!Array.isArray(data)) throw new Error('/api/targets did not return a list');
      const targetTypes = [
        { type: 'weight', label: 'Weight', unit: 'kg' },
        { type: 'body_fat', label: 'Body Fat', unit: '%' },
        { type: 'muscle_mass', label: 'Muscle Mass', unit: 'kg' },
        { type: 'steps', label: 'Steps', unit: '' },
        { type: 'vo2_max', label: 'VO2 Max', unit: 'ml/kg/min' },
        { type: 'calories', label: 'Daily Calories', unit: 'kcal' },
        { type: 'protein', label: 'Daily Protein', unit: 'g' },
        { type: 'carbs', label: 'Daily Carbs', unit: 'g' },
        { type: 'fat', label: 'Daily Fat', unit: 'g' },
        { type: 'water', label: 'Daily Water', unit: 'ml' },
        { type: 'sleep', label: 'Daily Sleep', unit: 'h' },
        { type: 'resting_heart_rate', label: 'Resting Heart Rate', unit: 'bpm' },
        { type: 'exercise_time', label: 'Daily Active Minutes', unit: 'min' },
        { type: 'stand_time', label: 'Daily Stand Hours', unit: 'h' },
        { type: 'fiber', label: 'Daily Fiber', unit: 'g' },
        { type: 'active_energy', label: 'Daily Active Energy', unit: 'kcal' },
        { type: 'blood_oxygen_saturation', label: 'Blood Oxygen', unit: '%' },
      ];
      
      const mergedTargets = targetTypes.map(tt => {
        const existing = data.find((d: any) => d.type === tt.type);
        return {
          ...tt,
          value: existing ? normaliseTargetValue(existing.value) : null
        };
      });
      
      set({ targets: mergedTargets, targetsLoaded: true });
    } catch (err) {
      console.error("Failed to fetch targets:", err);
    }
  },
  handleSaveSettings: async () => {
    const { settings, settingsLoaded } = get();
    // Item 50 follow-up: if /api/settings never loaded, `settings` is still
    // defaultSettings, and saving would POST every default over the real row (the
    // client sends the whole object). Same guard as handleSaveTargets/targetsLoaded.
    // Every caller goes through here -- Settings, Profile, and the Dashboard's
    // auto-save on widget reorder -- so one check covers them all.
    if (!settingsLoaded) {
      console.warn("Attempted to save settings before they were loaded. Skipping.");
      useUIStore.getState().showToast("Your settings haven't loaded, so nothing was saved. Reload the page and try again.", "error");
      return;
    }
    try {
      const trimmedSettings = {
        ...settings,
        ai_api_key: settings.ai_api_key?.trim() || '',
        hevy_api_key: settings.hevy_api_key?.trim() || '',
        ai_configs: settings.ai_configs?.map(c => ({
          ...c,
          api_key: c.api_key?.trim() || ''
        }))
      };
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmedSettings)
      });
      if (res.ok) {
        set({ settings: trimmedSettings });
        useUIStore.getState().showToast("Settings saved successfully!", "success");
      } else if (res.status === 401) {
        useUIStore.getState().showToast("Your session has expired — please log in again.", "error");
      } else {
        let message = "Failed to save settings.";
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body, fall back to the default message
        }
        useUIStore.getState().showToast(message, "error");
      }
    } catch (err) {
      useUIStore.getState().showToast("Failed to save settings.", "error");
    }
  },
  handleSaveTargets: async () => {
    const { targets, targetsLoaded } = get();
    if (!targetsLoaded) {
      console.warn("Attempted to save targets before they were loaded. Skipping.");
      return;
    }
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: targets.map(t => ({ ...t, value: toApiTargetValue(t.value) }))
        })
      });
      if (res.ok) {
        useUIStore.getState().showToast("Targets saved successfully!", "success");
      } else if (res.status === 401) {
        useUIStore.getState().showToast("Your session has expired — please log in again.", "error");
      } else {
        let message = "Failed to save targets.";
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body, fall back to the default message
        }
        useUIStore.getState().showToast(message, "error");
      }
    } catch (err) {
      useUIStore.getState().showToast("Failed to save targets.", "error");
    }
  },
  updateAISetting: (updates) => {
    set((state) => {
      const newSettings = { ...state.settings, ...updates };
      const configs = [...(state.settings.ai_configs || [])];
      const idx = configs.findIndex(c => c.provider === state.settings.ai_provider);
      const currentConfig = {
        provider: state.settings.ai_provider,
        api_key: newSettings.ai_api_key,
        model: newSettings.ai_model,
        base_url: newSettings.ai_base_url
      };
      
      if (idx > -1) {
        configs[idx] = currentConfig;
      } else {
        configs.push(currentConfig);
      }
      return { settings: { ...newSettings, ai_configs: configs } };
    });
  },
  updateSettings: (updates) => {
    set((state) => ({ settings: { ...state.settings, ...updates } }));
  }
}));
