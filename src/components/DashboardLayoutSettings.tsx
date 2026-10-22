import React from 'react';
import { motion } from 'motion/react';
import { LayoutDashboard, ChevronLeft, GripVertical, Search } from 'lucide-react';
import { cn } from '../lib/utils';

export const DashboardLayoutSettings = React.memo(({
  settings,
  setSettings,
  setActiveTab,
  handleSaveSettings
}: {
  settings: any;
  setSettings: (settings: any) => void;
  setActiveTab: (tab: string) => void;
  handleSaveSettings?: () => Promise<void>;
}) => {
  const allWidgets = [
    { id: 'macronutrient_radar', label: 'Macronutrient Density Radar' },
    { id: 'micronutrient_radar', label: 'Micronutrient Density Radar' },
    { id: 'smart_adjustments', label: 'Smart Target Adjustments' },
    { id: 'hrv_chart', label: 'HRV Chart' },
    { id: 'vo2max_chart', label: 'VO2 Max Chart' },
    { id: 'resting_hr_chart', label: 'Resting Heart Rate Chart' },
    { id: 'blood_pressure_chart', label: 'Blood Pressure Chart' },
    { id: 'calories_chart', label: 'Daily Calories (Chart)' },
    { id: 'active_energy_chart', label: 'Active Energy (Chart)' },
    { id: 'carbs_chart', label: 'Carbs Chart' },
    { id: 'protein_chart', label: 'Protein Chart' },
    { id: 'fat_chart', label: 'Fat Chart' },
    { id: 'body_fat_chart', label: 'Body Fat % Trend' },
    { id: 'muscle_mass_chart', label: 'Muscle Mass Trend (Generic)' },
    { id: 'lean_body_mass_chart', label: 'Lean Body Mass Trend (Apple Health)' },
    { id: 'charts', label: 'Body Composition Trends (All-in-One)' },
    { id: 'latest_workout', label: 'Latest Workout Card' },
    { id: 'sleep_stages', label: 'Sleep Stages Chart' },
    { id: 'sleep_quality', label: 'Sleep Quality Card' },
    { id: 'weight_card', label: 'Weight Card' },
    { id: 'weight_goal_progress', label: 'Weight Goal Progress' },
    { id: 'readiness_card', label: 'Daily Readiness Score' },
    { id: 'workout_streak', label: 'Workout Streak & Consistency' },
    { id: 'workout_stats', label: 'Workout Stats (Sessions/Volume/Time)' },
    { id: 'training_status', label: 'Training Status (Load Balance)' },
    { id: 'training_trends', label: 'Training Trends (Monthly Sparklines)' },
    { id: 'muscle_heatmap', label: 'Muscle Group Load (Heatmap)' },
    { id: 'body_diagram', label: 'Body Diagram (Muscle Readiness)' },
    { id: 'weekly_trends', label: 'This Week vs Last Week' },
    { id: 'digest', label: 'Weekly / Monthly Digest' },
    { id: 'medications', label: 'Medications & Supplements' },
    { id: 'labs', label: 'Blood tests' },
    { id: 'coverage_calendar', label: 'Data Coverage Calendar' },
    { id: 'sleep_consistency', label: 'Sleep Trend & Consistency' },
    { id: 'water_intake', label: 'Water Intake' },
    { id: 'todays_targets', label: "Today's Targets Overview" },
    { id: 'nutrition_streak', label: 'Nutrition Logging Streak' },
    { id: 'step_streak', label: 'Step Goal Streak' }
  ];

  const [localSettings, setLocalSettings] = React.useState(settings);
  const [filter, setFilter] = React.useState('');

  const visibleWidgets = allWidgets.filter(w =>
    w.label.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const selectAllVisible = () => {
    const ids = new Set([...(localSettings.dashboard_widgets || []), ...visibleWidgets.map(w => w.id)]);
    setLocalSettings({ ...localSettings, dashboard_widgets: Array.from(ids) });
  };

  const clearAllVisible = () => {
    const visibleIds = new Set(visibleWidgets.map(w => w.id));
    const newWidgets = (localSettings.dashboard_widgets || []).filter((id: string) => !visibleIds.has(id));
    setLocalSettings({ ...localSettings, dashboard_widgets: newWidgets });
  };

  return (
    <motion.div 
      key="dashboard-layout-settings"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <button 
            onClick={() => setActiveTab('settings')}
            className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-bold text-sm transition-colors"
          >
            <ChevronLeft size={20} /> Back
          </button>
          <button
            onClick={async () => {
              // Ensure we merge with latest settings in case they changed
              const finalSettings = { ...settings, dashboard_widgets: localSettings.dashboard_widgets };
              setSettings(finalSettings);
              if (handleSaveSettings) {
                // handleSaveSettings in store will read the updated state
                // but calling it after setSettings should be safe.
                await handleSaveSettings();
              }
              setActiveTab('settings');
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors"
          >
            Save Changes
          </button>
        </div>
        
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <LayoutDashboard size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Dashboard Layout</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Select which cards show on your dashboard.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter widgets..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-black/5 dark:border-white/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            onClick={selectAllVisible}
            className="px-3 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl border border-black/5 dark:border-white/5 transition-colors whitespace-nowrap"
          >
            Select All
          </button>
          <button
            onClick={clearAllVisible}
            className="px-3 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-xl border border-black/5 dark:border-white/5 transition-colors whitespace-nowrap"
          >
            Clear All
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleWidgets.length === 0 && (
            <p className="col-span-2 text-sm text-zinc-400 text-center py-6">No widgets match "{filter}"</p>
          )}
          {visibleWidgets.map(widget => (
            <label key={widget.id} className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800 p-4 rounded-xl border border-black/5 dark:border-white/5 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all">
              <input 
                type="checkbox"
                checked={localSettings.dashboard_widgets?.includes(widget.id)}
                onChange={(e) => {
                  const newWidgets = e.target.checked
                    ? [...(localSettings.dashboard_widgets || []), widget.id]
                    : (localSettings.dashboard_widgets?.filter(w => w !== widget.id) || []);
                  setLocalSettings({ ...localSettings, dashboard_widgets: newWidgets });
                }}
                className="w-5 h-5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{widget.label}</span>
            </label>
          ))}
        </div>
      </div>
    </motion.div>
  );
});
