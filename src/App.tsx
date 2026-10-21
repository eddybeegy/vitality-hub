import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import { 
  Activity, 
  TrendingUp, 
  LayoutDashboard,
  Scale, 
  Utensils, 
  Dumbbell, 
  Settings,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2,
  BarChart3,
  Terminal,
  Target,
  Moon,
  Bug,
  X,
  Power,
  Key,
  Database,
  Shield,
  Info,
  CheckCircle2,
  AlertCircle,
  Users,
  ShieldCheck,
  Pill,
  Plus,
  Eye,
  EyeOff,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Dashboard } from './components/Dashboard';
const ActivityTab = lazy(() => import('./components/ActivityTab').then(m => ({ default: m.ActivityTab })));
const NutritionTab = lazy(() => import('./components/NutritionTab').then(m => ({ default: m.NutritionTab })));
const WorkoutsTab = lazy(() => import('./components/WorkoutsTab').then(m => ({ default: m.WorkoutsTab })));
const AIInsightsTab = lazy(() => import('./components/AIInsightsTab').then(m => ({ default: m.AIInsightsTab })));
const ProfileTab = lazy(() => import('./components/ProfileTab').then(m => ({ default: m.ProfileTab })));
const SettingsTab = lazy(() => import('./components/SettingsTab').then(m => ({ default: m.SettingsTab })));
const TargetsTab = lazy(() => import('./components/TargetsTab').then(m => ({ default: m.TargetsTab })));
const MetricSettings = lazy(() => import('./components/MetricSettings').then(m => ({ default: m.MetricSettings })));
const DashboardLayoutSettings = lazy(() => import('./components/DashboardLayoutSettings').then(m => ({ default: m.DashboardLayoutSettings })));
const LogsTab = lazy(() => import('./components/LogsTab').then(m => ({ default: m.LogsTab })));
const DebugTab = lazy(() => import('./components/DebugTab').then(m => ({ default: m.DebugTab })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));

import { RoutineModal } from './components/RoutineModal';
import { NavIcon } from './components/NavIcon';
import { Toast } from './components/ui/Toast';
import { useAuthStore } from './store/useAuthStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useHealthStore } from './store/useHealthStore';
import { useAIStore } from './store/useAIStore';
import { useUIStore } from './store/useUIStore';
import { getLocalDateString, formatDateWithTimezone, parseUTCDate, cn } from './lib/utils';
import { isTargetSet } from './lib/targets';

export default function App() {
  const { user, isAuthChecking, setUser, setIsAuthChecking } = useAuthStore();
  const { 
    settings, targets, showApiKey, showModulePasswords,
    setSettings, setTargets, setShowApiKey, setShowModulePasswords,
    fetchSettings, fetchTargets, handleSaveSettings, handleSaveTargets, updateAISetting
  } = useSettingsStore();
  const { 
    summaryData, isSyncing, lastAppleHealthSync, logs, logFilter, debugMetrics, lastMetrics, expandedWorkouts,
    modules, setSummaryData, setIsSyncing, setLastAppleHealthSync, setLogs, setLogFilter, setDebugMetrics, setLastMetrics, setExpandedWorkouts,
    fetchSummary, fetchLogs, fetchLastAppleHealthSync, syncModule, fetchModules, toggleModule, updateModuleSettings, purgeModuleData, syncAllModules, refreshSummary
  } = useHealthStore();
  const {
    combinedReview, insightsLastUpdated, isReviewLoading,
    setCombinedReview, setInsightsLastUpdated,
    fetchAIInsights, checkAndRegenerateAI, fetchAIProviders,
    chatHistory, setChatHistory, isChatLoading, handleChatSubmit, allAIInsights,
    selectedBatchId, setSelectedBatchId, fetchChatHistory
  } = useAIStore();
  const { activeTab, selectedRoutine, toast, setActiveTab, setSelectedRoutine, hideToast, showToast } = useUIStore();

  const lastSynced = lastAppleHealthSync;

  const [recentSessionsCount, setRecentSessionsCount] = useState(10);
  const [workoutTypeFilter, setWorkoutTypeFilter] = useState<'all' | 'strength' | 'cardio'>('all');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedRoutine) {

      (window as any).selectedRoutine = selectedRoutine;
    }
  }, [selectedRoutine]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const applyTheme = () => {
      const mode = settings.display_mode;
      const html = document.documentElement;
      
      if (mode === 'night') {
        html.classList.add('dark');
      } else if (mode === 'day') {
        html.classList.remove('dark');
      } else {
        if (mediaQuery.matches) {
          html.classList.add('dark');
        } else {
          html.classList.remove('dark');
        }
      }
    };

    applyTheme();

    const listener = () => {
      if (settings.display_mode === 'auto') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, [settings.display_mode]);

  useEffect(() => {
    const init = async () => {
      try {
        const authRes = await fetch('/api/auth/me');
        if (authRes.ok) {
          const authData = await authRes.json();
          setUser(authData.user);
          
          // Parallelize initial data fetches
          await Promise.all([
            fetchSettings(),
            fetchModules(),
            fetchSummary(),
            fetchTargets(),
            fetchAIInsights(),
            fetchAIProviders()
          ]);
        }
      } catch (e) {
        console.error("Auth check failed", e);
      } finally {
        setIsAuthChecking(false);
      }
    };
    init();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        showToast(`${event.data.provider} connected successfully!`, 'success');
        fetchSummary();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user && (activeTab === 'dashboard' || activeTab === 'activity' || activeTab === 'workouts')) {
      fetchSummary();
    }
  }, [activeTab, user]);

  const groupedMetrics = useMemo(() => {
    const map: Record<string, any[]> = {};
    (summaryData.metrics || []).forEach(m => {
      if (!map[m.type]) map[m.type] = [];
      map[m.type].push(m);
    });
    return map;
  }, [summaryData.metrics]);

  const getChartData = useCallback((type: string, dataKey: string) => {
    const filtered = groupedMetrics[type] || [];
    return filtered.map(m => ({ 
      date: m.timestamp, 
      [dataKey]: m.value !== null && m.value !== undefined ? Number(m.value) : 0 
    }));
  }, [groupedMetrics]);

  const getTodayTotal = useCallback((type: string) => {
    const today = getLocalDateString(settings?.timezone);
    const metrics = groupedMetrics[type] || [];
    return metrics
      .filter(m => {
        // If it's already a date-only string from the server summary, compare directly
        if (/^\d{4}-\d{2}-\d{2}$/.test(m.timestamp)) {
          return m.timestamp === today;
        }

        let d = new Date(m.timestamp);
        if (m.timestamp.indexOf('Z') === -1 && m.timestamp.indexOf('+') === -1 && m.timestamp.indexOf('-') === -1 && m.timestamp.length > 10) {
          d = new Date(m.timestamp + 'Z');
        }
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return formatter.format(d) === today;
      })
      .reduce((sum, m) => sum + (Number(m.value) || 0), 0);
  }, [groupedMetrics, settings?.timezone]);

  const handleConnectWithings = async () => {
    const res = await fetch('/api/auth/withings/url');
    const { url } = await res.json();
    window.open(url, 'withings_oauth', 'width=600,height=700');
  };

  const getTargetValue = (type: string) => {
    if (!targets) return undefined;
    const target = targets.find((t: any) => t.type === type);
    return target && isTargetSet(target.value) ? Number(target.value) : undefined;
  };

  // Callers pass metrics `source` values, not module ids. `healthsync` must be listed
  // alongside `apple_health` wherever Apple Health data is meant: it is HealthSync's
  // HASS-routed copy of the same data, it has no module of its own, and it is routinely
  // the freshest source in the DB -- omitting it made the badge read older than the Data
  // Freshness panel, which groups the two (see MODULE_SOURCES in server.ts).
  const getLatestMetricTime = useCallback((sources: string | string[]) => {
    let maxTimestamp: string | null = null;
    const sourceList = Array.isArray(sources) ? sources : [sources];
    
    // Check metrics
    if (summaryData?.metrics) {
      for (const m of summaryData.metrics) {
        if (sourceList.includes(m.source)) {
          if (!maxTimestamp || parseUTCDate(m.timestamp).getTime() > parseUTCDate(maxTimestamp).getTime()) {
            maxTimestamp = m.timestamp;
          }
        }
      }
    }
    
    // Check workouts
    if (summaryData?.workouts) {
      for (const w of summaryData.workouts) {
        if (sourceList.includes(w.source)) {
          if (!maxTimestamp || parseUTCDate(w.timestamp).getTime() > parseUTCDate(maxTimestamp).getTime()) {
            maxTimestamp = w.timestamp;
          }
        }
      }
    }
    
    // Server-computed newest READING per source. This replaces a leg that took the max
    // over summaryData.syncLogs -- which is MAX(timestamp) FROM logs WHERE level='info',
    // i.e. "this module last logged something", relabelled 'success'. A sync that ran and
    // imported nothing bumped it, so the badge claimed the data was minutes old when the
    // newest reading was days old. The metrics scan above also can't be trusted on its
    // own: aggregateDailyMetrics stamps rolled-up rows with `timestamp: day` (midnight),
    // so today's aggregate reads 00:00. dataFreshness comes from the raw tables.
    if (summaryData?.dataFreshness?.bySource) {
      for (const source of sourceList) {
        const t = summaryData.dataFreshness.bySource[source];
        if (!t) continue;
        if (!maxTimestamp || parseUTCDate(t).getTime() > parseUTCDate(maxTimestamp).getTime()) {
          maxTimestamp = t;
        }
      }
    }

    if (!maxTimestamp) return null;
    
    const date = parseUTCDate(maxTimestamp);
    if (isNaN(date.getTime())) return null;

    const tz = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Check if it's "today" in the TARGET timezone
    const now = new Date();
    const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const targetDateStr = dayFormatter.format(date);
    const todayTargetStr = dayFormatter.format(now);
    
    const isToday = targetDateStr === todayTargetStr;
    
    if (isToday) {
      try {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(date);
      } catch (e) {
        return formatDateWithTimezone(maxTimestamp, tz);
      }
    }
    
    return formatDateWithTimezone(maxTimestamp, tz);
  }, [summaryData.metrics, summaryData.workouts, summaryData.dataFreshness, settings?.timezone]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-xl border border-black/5 dark:border-white/5 p-8">
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20 mx-auto mb-6">
            <Activity size={32} />
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 text-zinc-900 dark:text-zinc-100">Welcome to Vitality Hub</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-center mb-8">{authMode === 'login' ? 'Sign in to access your health dashboard' : 'Create your account to get started'}</p>

          <form onSubmit={async (e) => {
            e.preventDefault();
            const email = (e.target as any).email.value;
            const password = (e.target as any).password.value;
            setAuthError(null);
            try {
              const res = await fetch(`/api/auth/${authMode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok) {
                setUser(data.user);
                window.location.reload();
              } else {
                setAuthError(data.error || (authMode === 'login' ? 'Login failed' : 'Registration failed'));
              }
            } catch (err) {
              console.error(err);
              setAuthError('Something went wrong. Please try again.');
            }
          }} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email Address</label>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-zinc-900 dark:text-zinc-100"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Password</label>
              <input
                type="password"
                name="password"
                required
                minLength={authMode === 'register' ? 8 : undefined}
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-zinc-900 dark:text-zinc-100"
                placeholder={authMode === 'register' ? 'At least 8 characters' : '••••••••'}
              />
            </div>
            {authError && (
              <p className="text-sm text-red-500 dark:text-red-400 text-center">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl transition-colors shadow-md shadow-emerald-500/20"
            >
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mt-6">
            {authMode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(null); }}
              className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
            >
              {authMode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (user && !user.approved) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-xl border border-black/5 dark:border-white/5 p-8 text-center">
          <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-amber-200 dark:shadow-amber-900/20 mx-auto mb-6">
            <Shield size={32} />
          </div>
          <h1 className="text-2xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">Account Pending</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mb-8">Your account has been created but is currently pending approval from an administrator.</p>
          <button 
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.reload();
            }}
            className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-semibold rounded-xl transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-300",
      settings.font_size === 'small' ? 'text-xs' : settings.font_size === 'large' ? 'text-lg' : 'text-sm'
    )}>
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex fixed left-0 top-0 h-full w-20 bg-white dark:bg-zinc-900 border-r border-black/5 dark:border-white/5 flex-col items-center py-8 gap-8 z-50">
        <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20">
          <Activity size={24} />
        </div>
        
        <div className="flex flex-col gap-4">
          <NavIcon icon={<LayoutDashboard size={20} />} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavIcon icon={<Activity size={20} />} active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} />
          <NavIcon icon={<Dumbbell size={20} />} active={activeTab === 'workouts'} onClick={() => setActiveTab('workouts')} />
          <NavIcon icon={<Sparkles size={20} />} active={activeTab === 'ai-insights'} onClick={() => setActiveTab('ai-insights')} title="AI Insights" />
          <NavIcon icon={<Utensils size={20} />} active={activeTab === 'nutrition'} onClick={() => setActiveTab('nutrition')} />
          {user?.role === 'admin' && (
            <NavIcon icon={<Users size={20} />} active={activeTab === 'admin'} onClick={() => setActiveTab('admin')} />
          )}
          {settings.show_debug_logs && (
            <>
              <NavIcon icon={<Terminal size={20} />} active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
              <NavIcon icon={<Bug size={20} />} active={activeTab === 'debug'} onClick={() => setActiveTab('debug')} />
            </>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-4 items-center">
          <NavIcon icon={<Settings size={20} />} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </div>
      </nav>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-lg border-t border-black/5 dark:border-white/5 flex items-center justify-around px-4 py-3 z-50 overflow-x-auto">
        <NavIcon icon={<LayoutDashboard size={20} />} active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} className="w-10 h-10 rounded-xl" />
        <NavIcon icon={<Dumbbell size={20} />} active={activeTab === 'workouts'} onClick={() => setActiveTab('workouts')} className="w-10 h-10 rounded-xl" />
        <NavIcon icon={<Sparkles size={20} />} active={activeTab === 'ai-insights'} onClick={() => setActiveTab('ai-insights')} className="w-10 h-10 rounded-xl" />
        <NavIcon icon={<Utensils size={20} />} active={activeTab === 'nutrition'} onClick={() => setActiveTab('nutrition')} className="w-10 h-10 rounded-xl" />
        <NavIcon icon={<Settings size={20} />} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} className="w-10 h-10 rounded-xl" />
      </nav>

      {/* Main Content */}
      <main className="md:pl-20 pb-24 md:pb-0 min-h-screen">
        <header className="h-20 border-b border-black/5 dark:border-white/5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-40 px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="md:hidden w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white shadow-md">
              <Activity size={18} />
            </div>
            <h1 className="text-lg md:text-xl font-semibold tracking-tight">Vitality Hub</h1>
          </div>
          <div className="flex items-center gap-4">
            {user?.name && (
              <span className="hidden md:block text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Welcome, {user.name}
              </span>
            )}
            <button 
              onClick={() => setActiveTab('profile')}
              className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-black/5 dark:border-white/5 overflow-hidden hover:opacity-80 transition-opacity"
            >
              <img src="https://picsum.photos/seed/user/100/100" alt="Avatar" referrerPolicy="no-referrer" />
            </button>
          </div>
        </header>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          <Suspense fallback={
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            </div>
          }>
            <AnimatePresence mode="wait">
              {activeTab === 'admin' && (
                <motion.div 
                  key="admin"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-4xl mx-auto"
                >
                  <AdminPanel />
                </motion.div>
              )}

              {activeTab === 'dashboard' && (
                <div id="dashboard-container" className="max-w-4xl mx-auto">
                  <Dashboard lastSynced={getLatestMetricTime(['apple_health', 'healthsync', 'withings'])} />
                </div>
              )}

              {activeTab === 'activity' && (
                <ActivityTab 
                  settings={settings}
                  getChartData={getChartData}
                  summaryData={summaryData}
                  lastSynced={getLatestMetricTime(['apple_health', 'healthsync', 'withings'])}
                  syncAllModules={syncAllModules}
                  isSyncing={isSyncing}
                  getTargetValue={getTargetValue}
                />
              )}


              {activeTab === 'workouts' && (
                <WorkoutsTab 
                  summaryData={summaryData}
                  workoutTypeFilter={workoutTypeFilter}
                  setWorkoutTypeFilter={setWorkoutTypeFilter}
                  recentSessionsCount={recentSessionsCount}
                  setRecentSessionsCount={setRecentSessionsCount}
                  expandedWorkouts={expandedWorkouts}
                  setExpandedWorkouts={setExpandedWorkouts}
                  settings={settings}
                  lastSynced={getLatestMetricTime(['apple_health', 'healthsync', 'hevy'])}
                  syncAllModules={syncAllModules}
                  isSyncing={isSyncing}
                />
              )}


              {activeTab === 'ai-insights' && (
                <AIInsightsTab
                  combinedReview={combinedReview}
                  insightsLastUpdated={insightsLastUpdated}
                  isReviewLoading={isReviewLoading}
                  checkAndRegenerateAI={(force, _, __, specificType) => checkAndRegenerateAI(force, targets, settings, specificType)}
                  chatHistory={chatHistory}
                  setChatHistory={setChatHistory}
                  isChatLoading={isChatLoading}
                  handleChatSubmit={(msg, date, history) => handleChatSubmit(msg, date, history, settings, targets)}
                  allAIInsights={allAIInsights}
                  timezone={settings.timezone}
                  selectedBatchId={selectedBatchId}
                  setSelectedBatchId={setSelectedBatchId}
                  fetchChatHistory={fetchChatHistory}
                />
              )}

              {activeTab === 'nutrition' && (
                <NutritionTab 
                  settings={settings}
                  lastSynced={getLatestMetricTime('cronometer')}
                  syncAllModules={syncAllModules}
                  isSyncing={isSyncing}
                  getTodayTotal={getTodayTotal}
                  getTargetValue={getTargetValue}
                  getChartData={getChartData}
                />
              )}

              {activeTab === 'profile' && (
                <ProfileTab 
                  user={user}
                  settings={settings}
                  setSettings={setSettings}
                  handleSaveSettings={handleSaveSettings}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsTab 
                  settings={settings}
                  setSettings={setSettings}
                  modules={modules}
                  toggleModule={toggleModule}
                  updateModuleSettings={updateModuleSettings}
                  handleConnectWithings={handleConnectWithings}
                  syncModule={syncModule}
                  purgeModuleData={purgeModuleData}
                  isSyncing={isSyncing}
                  showModulePasswords={showModulePasswords}
                  setShowModulePasswords={setShowModulePasswords}
                  setActiveTab={setActiveTab}
                  updateAISetting={updateAISetting}
                  showApiKey={showApiKey}
                  setShowApiKey={setShowApiKey}
                  handleSaveSettings={handleSaveSettings}
                />
              )}

              {activeTab === 'targets' && (
                <TargetsTab 
                  targets={targets}
                  setTargets={setTargets}
                  settings={settings}
                  handleSaveTargets={handleSaveTargets}
                />
              )}

              {activeTab === 'metric-priority' && (
                <MetricSettings />
              )}

              {activeTab === 'dashboard-layout' && (
                <DashboardLayoutSettings 
                  settings={settings}
                  setSettings={setSettings}
                  setActiveTab={setActiveTab}
                  handleSaveSettings={handleSaveSettings}
                />
              )}

              {activeTab === 'logs' && (
                <LogsTab 
                  logFilter={logFilter}
                  setLogFilter={setLogFilter}
                  logs={logs}
                  fetchLogs={fetchLogs}
                  settings={settings}
                  lastAppleHealthSync={lastAppleHealthSync}
                />
              )}

              {activeTab === 'debug' && (
                <DebugTab 
                  lastAppleHealthSync={lastAppleHealthSync}
                  settings={settings}
                  fetchLastAppleHealthSync={fetchLastAppleHealthSync}
                  debugMetrics={debugMetrics}
                  lastMetrics={lastMetrics}
                />
              )}
            </AnimatePresence>
          </Suspense>
          {/* END of tab AnimatePresence */}
        </div>
      </main>

      <RoutineModal 
        selectedRoutine={selectedRoutine}
        setSelectedRoutine={setSelectedRoutine}
        summaryData={summaryData}
        settings={settings}
      />

      <AnimatePresence>
        {toast.visible && (
          <Toast 
            message={toast.message} 
            type={toast.type} 
            onClose={hideToast} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
