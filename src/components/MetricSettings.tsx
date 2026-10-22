import React, { useState, useEffect } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { 
  ArrowUp, 
  ArrowDown, 
  GripVertical,
  Check,
  AlertCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { withAllSources } from '../lib/sourceList';

interface MetricSource {
  id: string;
  name: string;
}

const AVAILABLE_SOURCES: MetricSource[] = [
  { id: 'apple_health', name: 'Apple Health' },
  { id: 'cronometer', name: 'Cronometer' },
  { id: 'nutrachek', name: 'Nutrachek' },
  { id: 'myfitnesspal', name: 'MyFitnessPal' },
  { id: 'withings', name: 'Withings' },
  { id: 'hevy', name: 'Hevy' },
  { id: 'strava', name: 'Strava' },
  // Sweep item 68: healthsync writes to `metrics` from outside this codebase (it has no
  // ingest module here) and was missing from this list entirely, so its rows could not
  // be ranked from the UI. Listed below the dedicated modules because it relays the same
  // Apple Health readings -- same intent as SOURCE_RANK, where healthsync is 4 against
  // apple_health's 3.
  { id: 'healthsync', name: 'HealthSync' },
  { id: 'manual', name: 'Manual Entry' }
];

const ALL_SOURCE_IDS = AVAILABLE_SOURCES.map(s => s.id);

const COMMON_METRICS = [
  { id: 'steps', name: 'Steps' },
  { id: 'weight', name: 'Weight' },
  { id: 'body_fat', name: 'Body Fat %' },
  { id: 'muscle_mass', name: 'Muscle Mass' },
  { id: 'lean_body_mass', name: 'Lean Body Mass' },
  { id: 'active_energy', name: 'Active Energy' },
  { id: 'basal_energy', name: 'Basal Energy' },
  { id: 'calories_in', name: 'Calories Intake' },
  { id: 'protein', name: 'Protein' },
  { id: 'carbs', name: 'Carbs' },
  { id: 'fat', name: 'Fat' },
  { id: 'sleep', name: 'Sleep' },
  { id: 'heart_rate', name: 'Heart Rate' },
  { id: 'hrv', name: 'HRV' },
  { id: 'vo2max', name: 'VO2 Max' },
  { id: 'blood_pressure', name: 'Blood Pressure' },
  { id: 'pulse_wave_velocity', name: 'Pulse Wave Velocity' },
  { id: 'visceral_fat', name: 'Visceral Fat' },
  { id: 'metabolic_age', name: 'Metabolic Age' }
];

export const MetricSettings = () => {
  const { settings, updateSettings } = useSettingsStore();
  const [priorities, setPriorities] = useState<Record<string, string[]>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (settings?.metric_priorities) {
      try {
        setPriorities(JSON.parse(settings.metric_priorities));
      } catch (e) {
        setPriorities({});
      }
    }
  }, [settings?.metric_priorities]);

  const handleMove = (metricId: string, sourceId: string, direction: 'up' | 'down') => {
    const currentPriorities = withAllSources(priorities[metricId] || [], ALL_SOURCE_IDS);
    const index = currentPriorities.indexOf(sourceId);
    if (index === -1) return;

    const newPriorities = [...currentPriorities];
    if (direction === 'up' && index > 0) {
      [newPriorities[index], newPriorities[index - 1]] = [newPriorities[index - 1], newPriorities[index]];
    } else if (direction === 'down' && index < newPriorities.length - 1) {
      [newPriorities[index], newPriorities[index + 1]] = [newPriorities[index + 1], newPriorities[index]];
    }

    setPriorities(prev => ({
      ...prev,
      [metricId]: newPriorities
    }));
  };

  const savePriorities = async () => {
    setSaveStatus('saving');
    try {
      await updateSettings({
        metric_priorities: JSON.stringify(priorities)
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      setSaveStatus('error');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Metric Source Priority</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Define which data source should take precedence when multiple sources provide the same metric.
            The source at the top will be used.
          </p>
        </div>
        <button
          onClick={savePriorities}
          disabled={saveStatus === 'saving'}
          className={cn(
            "px-6 py-2.5 rounded-xl font-semibold transition-all shadow-lg active:scale-95 disabled:opacity-50",
            saveStatus === 'success' ? "bg-emerald-500 text-white" : 
            saveStatus === 'error' ? "bg-rose-500 text-white" :
            "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90"
          )}
        >
          {saveStatus === 'saving' ? 'Saving...' : 
           saveStatus === 'success' ? <span className="flex items-center gap-2"><Check size={18} /> Saved</span> :
           saveStatus === 'error' ? 'Error' : 'Save Priorities'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {COMMON_METRICS.map((metric) => {
          const currentPriorities = withAllSources(priorities[metric.id] || [], ALL_SOURCE_IDS);
          
          return (
            <div key={metric.id} className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-zinc-900 dark:text-white">{metric.name}</h3>
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
                  Priority List
                </span>
              </div>
              <div className="space-y-2">
                {currentPriorities.map((sourceId, index) => {
                  const source = AVAILABLE_SOURCES.find(s => s.id === sourceId) || { id: sourceId, name: sourceId };
                  return (
                    <div 
                      key={sourceId}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-2xl border transition-all",
                        index === 0 
                          ? "bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20" 
                          : "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-100 dark:border-zinc-800"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold",
                          index === 0 ? "bg-emerald-500 text-white" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                        )}>
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {source.name}
                        </span>
                        {index === 0 && (
                          <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMove(metric.id, sourceId, 'up')}
                          disabled={index === 0}
                          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 disabled:opacity-20"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          onClick={() => handleMove(metric.id, sourceId, 'down')}
                          disabled={index === currentPriorities.length - 1}
                          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 disabled:opacity-20"
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
