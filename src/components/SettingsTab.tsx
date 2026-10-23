import React from 'react';
import { motion } from 'motion/react';
import { useAIStore } from '../store/useAIStore';
import { 
  Settings, 
  Database, 
  Dumbbell, 
  Scale, 
  Utensils, 
  Activity, 
  HeartPulse,
  TrendingUp, 
  RefreshCw, 
  Trash2, 
  Eye, 
  EyeOff, 
  Pill, 
  Plus,
  Target,
  ChevronDown,
  LayoutDashboard,
  Download
} from 'lucide-react';
import { cn } from '../lib/utils';
import { signOut } from '../lib/apiFetch';
import { metricsCsvHref, isWindowed, rangeOrderError } from '../lib/exportHref';
import { ScheduledBackupsCard } from './ScheduledBackupsCard';
import { PhoneAlertsCard } from './PhoneAlertsCard';
import { AutoTargetsCard } from './AutoTargetsCard';
import { useUIStore } from '../store/useUIStore';

interface SettingsTabProps {
  settings: any;
  setSettings: (settings: any) => void;
  modules: any[];
  toggleModule: (moduleId: string, enabled: boolean) => void;
  updateModuleSettings: (moduleId: string, newSettings: any) => void;
  handleConnectWithings: () => void;
  syncModule: (moduleId: string) => void;
  purgeModuleData: (moduleId: string) => void;
  isSyncing: boolean;
  showModulePasswords: Record<string, boolean>;
  setShowModulePasswords: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setActiveTab: (tab: any) => void;
  updateAISetting: (setting: any) => void;
  showApiKey: boolean;
  setShowApiKey: (show: boolean) => void;
  handleSaveSettings: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = React.memo(({
  settings,
  setSettings,
  modules,
  toggleModule,
  updateModuleSettings,
  handleConnectWithings,
  syncModule,
  purgeModuleData,
  isSyncing,
  showModulePasswords,
  setShowModulePasswords,
  setActiveTab,
  updateAISetting,
  showApiKey,
  setShowApiKey,
  handleSaveSettings,
}) => {
  const { aiProviders, fetchAIProviders, setAIProviders } = useAIStore();
  const currentProvider = aiProviders.find(p => p.id === settings.ai_provider);
  const [isFetchingModels, setIsFetchingModels] = React.useState(false);
  
  // Update provider models in the store by fetching from backend
  const refreshModels = React.useCallback(async (providerId: string, apiKey: string, baseUrl: string) => {
    if (!providerId) return;
    
    setIsFetchingModels(true);
    try {
      const res = await fetch('/api/ai/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, apiKey, baseUrl })
      });
      
      if (res.ok) {
        const { models } = await res.json();
        // Update the aiProviders in the store locally so the dropdown reflects it immediately
        setAIProviders((prev: any[]) => 
          prev.map(p => p.id === providerId ? { ...p, models } : p)
        );
        
        // If current model is not in the new list, pick the first one
        if (models.length > 0 && !models.includes(settings.ai_model)) {
          updateAISetting({ ai_model: models[0] });
        }
      }
    } catch (e) {
      console.error("Failed to refresh models", e);
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings.ai_model, setAIProviders, updateAISetting]);

  // Trigger model refresh when provider or base URL changes
  React.useEffect(() => {
    const currentProvModels = aiProviders.find(p => p.id === settings.ai_provider)?.models || [];
    
    // Only auto-refresh if we have no models for the selected provider
    if (currentProvModels.length === 0 || settings.ai_provider === 'ollama') {
      const timer = setTimeout(() => {
        refreshModels(settings.ai_provider, settings.ai_api_key, settings.ai_base_url);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settings.ai_provider, settings.ai_base_url, settings.ai_api_key, refreshModels]);

  const availableModels = currentProvider?.models || [];
  const [exportUrl, setExportUrl] = React.useState<string | null>(null);
  // Export range (metrics CSV only). Empty = the full export, which stays the default:
  // a backup button that silently drops history is worse than a big download.
  const [exportStart, setExportStart] = React.useState('');
  const [exportEnd, setExportEnd] = React.useState('');
  const [exportLoading, setExportLoading] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  // Module credential fields are write-only: GET /api/modules sends a
  // `configuredSettings` boolean instead of the stored secret, so the inputs
  // can no longer be bound to module.userSettings. Keep what the user types
  // locally and commit on blur (the old code POSTed on every keystroke, which
  // wrote a partial credential to the DB once per character).
  const [moduleDrafts, setModuleDrafts] = React.useState<Record<string, string>>({});

  const draftKey = (moduleId: string, key: string) => `${moduleId}_${key}`;

  const commitModuleDraft = (moduleId: string, key: string) => {
    const k = draftKey(moduleId, key);
    const draft = moduleDrafts[k];
    if (draft === undefined) return;
    updateModuleSettings(moduleId, { [key]: draft });
    setModuleDrafts(prev => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const fetchExportUrl = React.useCallback(async () => {
    setExportLoading(true);
    setExportError(null);
    try {
      const res = await fetch('/api/export-token');
      if (!res.ok) throw new Error('Unable to fetch export URL');
      const data = await res.json();
      setExportUrl(data.url || null);
    } catch (err: any) {
      setExportError(err?.message || 'Failed to load export URL');
      setExportUrl(null);
    } finally {
      setExportLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (modules.some(m => m.id === 'apple_health' || m.id === 'apple_workouts')) {
      fetchExportUrl();
    }
  }, [modules, fetchExportUrl]);

  return (
    <motion.div 
      key="settings"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-900 dark:text-zinc-100">
            <Settings size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Settings</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage your API keys and integrations</p>
          </div>
        </div>
        <div className="space-y-8">
            <button 
              onClick={() => setActiveTab('targets')}
              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all"
            >
              <div className="flex items-center gap-3">
                <Target className="text-emerald-500" size={20} />
                <span className="font-bold text-zinc-900 dark:text-zinc-100">Health Targets</span>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-400" size={20} />
            </button>

            <button 
              onClick={() => setActiveTab('metric-priority')}
              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all"
            >
              <div className="flex items-center gap-3">
                <TrendingUp className="text-blue-500" size={20} />
                <span className="font-bold text-zinc-900 dark:text-zinc-100">Metric Source Priority</span>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-400" size={20} />
            </button>

            <button 
              onClick={() => setActiveTab('dashboard-layout')}
              className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all"
            >
              <div className="flex items-center gap-3">
                <LayoutDashboard className="text-emerald-500" size={20} />
                <span className="font-bold text-zinc-900 dark:text-zinc-100">Dashboard Layout</span>
              </div>
              <ChevronDown className="rotate-[-90deg] text-zinc-400" size={20} />
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Sync History (Days)</label>
                <input 
                  type="number" 
                  min="1"
                  max="365"
                  value={settings.sync_history_days}
                  onChange={(e) => setSettings({ ...settings, sync_history_days: parseInt(e.target.value) || 90 })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  placeholder="90"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Muscle Readiness Window (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.readiness_recovery_days ?? 3}
                  onChange={(e) => setSettings({ ...settings, readiness_recovery_days: parseInt(e.target.value) || 3 })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  placeholder="3"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Preferred Units</label>
                <select 
                  value={settings.preferred_units || 'metric'}
                  onChange={(e) => setSettings({ ...settings, preferred_units: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                >
                  <option value="metric">Metric (kg, cm, km)</option>
                  <option value="imperial">Imperial (lbs, in, mi)</option>
                  <option value="stone">Stone (st/lb, in, mi)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Timezone</label>
                <select 
                  value={settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                >
                  {Intl.supportedValuesOf('timeZone').map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Default Graph Range</label>
                <select 
                  value={settings?.default_graph_range || '30d'}
                  onChange={(e) => setSettings({ ...settings, default_graph_range: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                >
                  <option value="1d">1 Day</option>
                  <option value="7d">7 Days</option>
                  <option value="30d">30 Days</option>
                  <option value="90d">90 Days</option>
                  <option value="1y">1 Year</option>
                  <option value="all">All Time</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Default Graph Grouping</label>
                <select 
                  value={settings?.default_graph_grouping || 'day'}
                  onChange={(e) => setSettings({ ...settings, default_graph_grouping: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Display Mode</label>
                <select 
                  value={settings.display_mode}
                  onChange={(e) => setSettings({ ...settings, display_mode: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                >
                  <option value="day">Day</option>
                  <option value="night">Night</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Font Size</label>
                <select 
                  value={settings.font_size || 'medium'}
                  onChange={(e) => setSettings({ ...settings, font_size: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Database size={16} /> Data Source Modules
              </h3>
              <div className="grid grid-cols-1 gap-4">
                {modules.map(module => (
                  <div key={module.id} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-black/5 dark:border-white/5 overflow-hidden">
                    <div className="p-4 flex items-center justify-between border-b border-black/5 dark:border-white/5">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center",
                          module.enabled ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                        )}>
                          {module.id === 'hevy' && <Dumbbell size={20} />}
                          {module.id === 'withings' && <Scale size={20} />}
                          {module.id === 'cronometer' && <Utensils size={20} />}
                          {module.id === 'apple_health' && <HeartPulse size={20} />}
                          {module.id === 'apple_workouts' && <TrendingUp size={20} />}
                        </div>
                        <div>
                          <h4 className="font-bold text-zinc-900 dark:text-zinc-100">{module.name}</h4>
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">{module.metricsProvided.join(' • ')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => toggleModule(module.id, !module.enabled)}
                          className={cn(
                            "w-12 h-6 rounded-full transition-colors relative",
                            module.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
                          )}
                        >
                          <div className={cn(
                            "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                            module.enabled ? "left-7" : "left-1"
                          )} />
                        </button>
                      </div>
                    </div>
                    
                    {module.enabled && (
                      <div className="p-4 space-y-4">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{module.description}</p>
                        
                        {module.settings && module.settings.length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {module.settings.map((s: any) => (
                              <div key={s.key} className="space-y-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{s.label}</label>
                                {s.type === 'file' ? (
                                  <div className="space-y-2">
                                    <input 
                                      type="file"
                                      accept=".csv"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          const reader = new FileReader();
                                          reader.onload = (event) => {
                                            updateModuleSettings(module.id, { [s.key]: event.target?.result });
                                          };
                                          reader.readAsText(file);
                                        }
                                      }}
                                      className="w-full px-3 py-2 rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-xs text-zinc-900 dark:text-zinc-100"
                                    />
                                    {(module.configuredSettings?.[s.key] || module.userSettings[s.key]) && (
                                      <p className="text-[10px] text-emerald-500 font-medium">✓ File uploaded and ready to sync</p>
                                    )}
                                  </div>
                                ) : (
                                <div className="relative">
                                  <input 
                                    type={s.type === 'password' ? (showModulePasswords[`${module.id}_${s.key}`] ? 'text' : 'password') : 'text'}
                                    value={
                                      moduleDrafts[draftKey(module.id, s.key)] ??
                                      (s.type === 'password' ? '' : (module.userSettings[s.key] || ''))
                                    }
                                    onChange={(e) => setModuleDrafts(prev => ({
                                      ...prev,
                                      [draftKey(module.id, s.key)]: e.target.value
                                    }))}
                                    onBlur={() => commitModuleDraft(module.id, s.key)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitModuleDraft(module.id, s.key);
                                    }}
                                    className="w-full px-3 py-2 pr-10 rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-xs text-zinc-900 dark:text-zinc-100"
                                    placeholder={
                                      s.type === 'password' && module.configuredSettings?.[s.key]
                                        ? '•••••••• stored — type to replace'
                                        : s.placeholder
                                    }
                                  />
                                  {s.type === 'password' && (
                                    <button
                                      type="button"
                                      onClick={() => setShowModulePasswords(prev => ({
                                        ...prev,
                                        [`${module.id}_${s.key}`]: !prev[`${module.id}_${s.key}`]
                                      }))}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                                    >
                                      {showModulePasswords[`${module.id}_${s.key}`] ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                  )}
                                </div>
                                )}
                                {s.type === 'password' && module.configuredSettings?.[s.key] && moduleDrafts[draftKey(module.id, s.key)] === undefined && (
                                  <p className="text-[10px] text-emerald-500 font-medium">✓ Stored</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {module.id === 'withings' && (
                          <div className="pt-2">
                            <button 
                              onClick={handleConnectWithings}
                              className="w-full bg-blue-500 text-white py-2 rounded-lg font-bold text-xs hover:bg-blue-600 transition-all flex items-center justify-center gap-2"
                            >
                              {settings.withings_connected ? "Reconnect Withings" : "Connect Withings"}
                            </button>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button 
                            onClick={() => syncModule(module.id)}
                            disabled={isSyncing}
                            className="flex-1 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 py-2 rounded-lg font-bold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
                          >
                            <RefreshCw className={isSyncing ? "animate-spin" : ""} size={14} />
                            Sync
                          </button>
                          <button 
                            onClick={() => purgeModuleData(module.id)}
                            className="bg-rose-50 dark:bg-rose-900/10 text-rose-600 dark:text-rose-400 p-2 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-all"
                            title="Purge Data"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {(module.id === 'apple_health' || module.id === 'apple_workouts') && (
                          <div className="rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Apple Health Auto Export URL</p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">Paste this URL into the Apple Health Auto Export app so Vitality Hub can receive your data.</p>
                              </div>
                              <button
                                type="button"
                                onClick={fetchExportUrl}
                                disabled={exportLoading}
                                className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                              >
                                Refresh
                              </button>
                            </div>
                            {exportLoading ? (
                              <p className="text-xs text-zinc-500">Loading export URL…</p>
                            ) : exportError ? (
                              <p className="text-xs text-rose-600">{exportError}</p>
                            ) : exportUrl ? (
                              <>
                                <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-zinc-950 p-3 text-xs font-mono text-zinc-800 dark:text-zinc-100 overflow-x-auto">
                                  {exportUrl}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await navigator.clipboard.writeText(exportUrl);
                                      } catch (err) {
                                        console.error('Copy failed', err);
                                      }
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 transition-all"
                                  >
                                    Copy URL
                                  </button>
                                </div>
                                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  Use the full URL in the Apple Health Auto Export app. If the URL includes <span className="font-mono">?token=...</span>, keep it exactly as shown for authenticated uploads.
                                </p>
                                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  If your iPhone is on the same local network, local uploads may still work without a token, but remote or cloud sync requires the token parameter.
                                </p>
                              </>
                            ) : (
                              <p className="text-xs text-zinc-500">Unable to load export URL. Try refreshing or check your login status.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-black/5 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Download size={16} /> Data Export &amp; Backup
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Download your own data at any time. CSV files cover a single dataset; the JSON backup includes everything (metrics, workouts with exercises/sets, targets, meals, routines).</p>
              <div className="rounded-xl border border-black/5 dark:border-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Metrics CSV date range <span className="font-normal text-zinc-500">(optional)</span></p>
                  {isWindowed(exportStart, exportEnd) && (
                    <button
                      type="button"
                      onClick={() => { setExportStart(''); setExportEnd(''); }}
                      className="text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
                    <span>From</span>
                    <input
                      type="date"
                      value={exportStart}
                      onChange={e => setExportStart(e.target.value)}
                      className="w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
                    />
                  </label>
                  <label className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
                    <span>To</span>
                    <input
                      type="date"
                      value={exportEnd}
                      onChange={e => setExportEnd(e.target.value)}
                      className="w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
                    />
                  </label>
                </div>
                {rangeOrderError(exportStart, exportEnd) ? (
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{rangeOrderError(exportStart, exportEnd)}</p>
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {isWindowed(exportStart, exportEnd)
                      ? 'Applies to Metrics (CSV) only. Both dates are inclusive; leave one blank for an open end.'
                      : 'Leave blank to export every metric you have \u2014 the complete history, and a large download.'}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <a
                  href={metricsCsvHref(exportStart, exportEnd)}
                  className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 py-3 rounded-xl font-bold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                >
                  <Download size={14} /> Metrics (CSV){isWindowed(exportStart, exportEnd) ? ' \u00b7 range' : ''}
                </a>
                <a
                  href="/api/export/workouts.csv"
                  className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 py-3 rounded-xl font-bold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                >
                  <Download size={14} /> Workouts (CSV)
                </a>
                <a
                  href="/api/export/all.json"
                  className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 py-3 rounded-xl font-bold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                >
                  <Download size={14} /> Full Backup (JSON)
                </a>
              </div>
            </div>

            <ScheduledBackupsCard />

            <PhoneAlertsCard settings={settings} setSettings={setSettings} />
            <AutoTargetsCard settings={settings} setSettings={setSettings} />

            <div className="flex items-center justify-between p-4 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50">
              <div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Correlation Explorer</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Show the correlation panel on the Activity tab</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSettings({ ...settings, enable_correlations: !settings.enable_correlations })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    settings.enable_correlations ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                    settings.enable_correlations ? "left-7" : "left-1"
                  )} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50">
              <div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Debug Mode</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Show system logs and detailed sync information</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setSettings({ ...settings, show_debug_logs: !settings.show_debug_logs })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    settings.show_debug_logs ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                    settings.show_debug_logs ? "left-7" : "left-1"
                  )} />
                </button>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-black/5 dark:border-white/5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Pill size={16} /> Medications
                </h3>
                <button 
                  onClick={() => setSettings({
                    ...settings,
                    medications: [...settings.medications, { name: '', dose: '', frequency: '' }]
                  })}
                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors"
                >
                  <Plus size={14} /> Add Medication
                </button>
              </div>
              
              <div className="space-y-3">
                {(!Array.isArray(settings.medications) || settings.medications.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-black/10 dark:border-white/10 text-center">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">No medications added. These help AI provide better health insights.</p>
                  </div>
                ) : (
                  settings.medications.map((med: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Medication Name</label>
                          <input 
                            type="text"
                            value={med.name}
                            onChange={(e) => {
                              const newMeds = [...settings.medications];
                              newMeds[idx].name = e.target.value;
                              setSettings({ ...settings, medications: newMeds });
                            }}
                            placeholder="e.g. Vitamin D3"
                            className="w-full px-3 py-2 rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-xs text-zinc-900 dark:text-zinc-100"
                          />
                        </div>
                        <button 
                          onClick={() => {
                            const newMeds = settings.medications.filter((_: any, i: number) => i !== idx);
                            setSettings({ ...settings, medications: newMeds });
                          }}
                          className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all self-end"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Dose</label>
                          <input 
                            type="text"
                            value={med.dose}
                            onChange={(e) => {
                              const newMeds = [...settings.medications];
                              newMeds[idx].dose = e.target.value;
                              setSettings({ ...settings, medications: newMeds });
                            }}
                            placeholder="e.g. 2000 IU"
                            className="w-full px-3 py-2 rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-xs text-zinc-900 dark:text-zinc-100"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Frequency</label>
                          <input 
                            type="text"
                            value={med.frequency}
                            onChange={(e) => {
                              const newMeds = [...settings.medications];
                              newMeds[idx].frequency = e.target.value;
                              setSettings({ ...settings, medications: newMeds });
                            }}
                            placeholder="e.g. Once daily"
                            className="w-full px-3 py-2 rounded-lg border border-black/5 dark:border-white/5 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-xs text-zinc-900 dark:text-zinc-100"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">AI Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">AI Provider</label>
                  <select 
                    value={settings.ai_provider || 'gemini'}
                    onChange={(e) => {
                      const newProviderId = e.target.value;
                      const newProvider = aiProviders.find(p => p.id === newProviderId);
                      
                      setSettings((prev: any) => {
                        // 1. Save current provider's state to ai_configs
                        const configs = [...(prev.ai_configs || [])];
                        const currentIdx = configs.findIndex((c: any) => c.provider === prev.ai_provider);
                        const currentConfig = {
                          provider: prev.ai_provider,
                          api_key: prev.ai_api_key,
                          model: prev.ai_model,
                          base_url: prev.ai_base_url
                        };
                        
                        if (currentIdx > -1) {
                          configs[currentIdx] = currentConfig;
                        } else {
                          configs.push(currentConfig);
                        }
                        
                        // 2. Load new provider's state from ai_configs
                        const savedConfig = configs.find((c: any) => c.provider === newProviderId);
                        const defaultModel = savedConfig?.model || (newProvider?.models?.[0] || '');

                        return { 
                          ...prev, 
                          ai_provider: newProviderId,
                          ai_api_key: savedConfig?.api_key || '',
                          ai_model: defaultModel,
                          ai_base_url: savedConfig?.base_url || '',
                          ai_configs: configs
                        };
                      });
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  >
                    {aiProviders.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Model</label>
                    {isFetchingModels && <RefreshCw size={12} className="animate-spin text-emerald-500" />}
                  </div>
                  <select 
                    value={settings.ai_model || ''}
                    onChange={(e) => updateAISetting({ ai_model: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  >
                    {availableModels.map((model: string) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">AI API Key</label>
                  <div className="relative">
                    <input 
                      type={showApiKey ? "text" : "password"} 
                      value={settings.ai_api_key || ''}
                      onChange={(e) => updateAISetting({ ai_api_key: e.target.value })}
                      className="w-full px-4 py-3 pr-12 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                    >
                      {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">AI Base URL (for self-hosted)</label>
                <input 
                  type="text" 
                  value={settings.ai_base_url || ''}
                  onChange={(e) => updateAISetting({ ai_base_url: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  placeholder="http://localhost:11434"
                />
              </div>
            </div>

            <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">AI Persona & Focus</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">AI Persona</label>
                  <select 
                    value={settings.ai_persona || 'Encouraging Coach'}
                    onChange={(e) => setSettings({ ...settings, ai_persona: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="Encouraging Coach">Encouraging Coach</option>
                    <option value="Strict Analyst">Strict Analyst</option>
                    <option value="Data-Driven Scientist">Data-Driven Scientist</option>
                    <option value="Casual Friend">Casual Friend</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">AI Focus</label>
                  <select 
                    value={settings.ai_focus || 'General Health'}
                    onChange={(e) => setSettings({ ...settings, ai_focus: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="General Health">General Health</option>
                    <option value="Fat Loss">Fat Loss</option>
                    <option value="Muscle Gain">Muscle Gain</option>
                    <option value="Body Recomposition">Body Recomposition</option>
                    <option value="Endurance">Endurance</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Automatic AI Generation</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Specify up to 3 times per day when the AI should automatically reconcile your data and generate insights.</p>
              
              <div className="flex flex-wrap gap-4">
                {[0, 1, 2].map((idx) => {
                  let times: string[] = [];
                  try {
                    times = settings.ai_generation_times ? JSON.parse(settings.ai_generation_times) : ['off', 'off', 'off'];
                  } catch (e) {
                    times = ['off', 'off', 'off'];
                  }
                  
                  const isOff = times[idx] === 'off' || !times[idx];

                  return (
                    <div key={idx} className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-zinc-400">Slot {idx + 1}</label>
                      <div className="flex items-center gap-2">
                        <select 
                          value={isOff ? 'off' : 'on'}
                          onChange={(e) => {
                            const newTimes = [...times];
                            if (e.target.value === 'off') {
                              newTimes[idx] = 'off';
                            } else {
                              newTimes[idx] = idx === 0 ? '08:00' : idx === 1 ? '13:00' : '20:00';
                            }
                            // Pad array if it was missing elements to ensure correct indexes
                            for (let i = 0; i < 3; i++) {
                              if (!newTimes[i]) newTimes[i] = 'off';
                            }
                            setSettings({ ...settings, ai_generation_times: JSON.stringify(newTimes) });
                          }}
                          className="px-3 py-2 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-zinc-900 dark:text-zinc-100 font-medium"
                        >
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                        {!isOff && (
                          <input 
                            type="time" 
                            value={times[idx] && times[idx] !== 'off' ? times[idx] : ''}
                            onChange={(e) => {
                              const newTimes = [...times];
                              newTimes[idx] = e.target.value || 'off';
                              setSettings({ ...settings, ai_generation_times: JSON.stringify(newTimes) });
                            }}
                            className="flex-1 w-[120px] px-3 py-2 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100 text-sm"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">AI Hints</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Enter any specific hints or instructions to guide the AI generation.</p>
              <textarea 
                value={settings.ai_hints || ''}
                onChange={(e) => setSettings({ ...settings, ai_hints: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                placeholder="e.g., Focus on high protein, prioritize strength training, etc."
                rows={4}
              />
            </div>


            <div className="space-y-6 pt-6 border-t border-black/5 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Meal Suggestions</h3>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input 
                    type="checkbox" 
                    checked={!!settings.meal_suggestion_breakfast}
                    onChange={(e) => setSettings({ ...settings, meal_suggestion_breakfast: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Breakfast
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input 
                    type="checkbox" 
                    checked={!!settings.meal_suggestion_lunch}
                    onChange={(e) => setSettings({ ...settings, meal_suggestion_lunch: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Lunch
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input 
                    type="checkbox" 
                    checked={!!settings.meal_suggestion_dinner}
                    onChange={(e) => setSettings({ ...settings, meal_suggestion_dinner: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Dinner
                </label>
              </div>
            </div>

            <div className="pt-4 flex flex-wrap gap-4">
              <button 
                onClick={handleSaveSettings}
                className="flex-1 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-4 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-lg shadow-zinc-200 dark:shadow-none"
              >
                Save Configuration
              </button>
              <button 
                onClick={() => signOut(message => useUIStore.getState().showToast(message, 'error'))}
                className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 py-4 rounded-xl font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-all flex items-center justify-center gap-2"
              >
                Sign Out
              </button>
            </div>
        </div>
      </div>
    </motion.div>
  );
});
