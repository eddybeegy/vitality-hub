import React from 'react';
import { HeartPulse, Activity } from 'lucide-react';
import { motion } from 'motion/react';
import { HealthChart } from './HealthChart';
import { SyncButton } from './SyncButton';
import { formatDateWithTimezone, getWeightUnit } from '../lib/utils';

import { getBloodPressureData, getSleepDurationData } from '../services/healthDataService';

interface ActivityTabProps {
  settings: any;
  getChartData: (type: string, dataKey: string) => any[];
  summaryData: any;
  lastSynced: string | null;
  syncAllModules: () => Promise<void>;
  isSyncing: boolean;
  getTargetValue: (type: string) => number | undefined;
}

export const ActivityTab = React.memo(({
  settings,
  getChartData,
  summaryData,
  lastSynced,
  syncAllModules,
  isSyncing,
  getTargetValue
}: ActivityTabProps) => {
  return (
    <motion.div 
      key="activity"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <HeartPulse size={20} />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Activity & Health</h2>
            <p className="text-zinc-500 dark:text-zinc-400">Apple Health and daily activity metrics</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
            {lastSynced && (
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">Last sync: {lastSynced}</span>
            )}
            <SyncButton 
              onClick={syncAllModules} 
              isSyncing={isSyncing} 
              label="Sync All" 
            />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getSleepDurationData(summaryData.metrics, settings?.timezone)} 
          title="Sleep Duration" 
          dataKey="hours" 
          color="#6366f1" 
          type="bar" 
          unit=" hrs"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          referenceLines={[
            { value: 7, label: 'Min', color: '#3b82f6' },
            { value: 9, label: 'Max', color: '#ef4444' }
          ]}
          sourceName="Apple Health"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('resting_heart_rate', 'bpm')} 
          title="Resting Heart Rate" 
          dataKey="bpm" 
          color="#ec4899" 
          type="line" 
          unit=" bpm"
          preferredUnits={settings?.preferred_units}
          referenceLines={[
            { value: 60, label: 'Low', color: '#3b82f6' },
            { value: 100, label: 'High', color: '#ef4444' },
            ...(getTargetValue('resting_heart_rate') ? [{ value: getTargetValue('resting_heart_rate'), label: 'Target', color: '#10b981' }] : [])
          ]}
          sourceName="Apple Health"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any}
          data={getChartData('hrv', 'ms')}
          title="Heart Rate Variability (HRV)"
          dataKey="ms" 
          color="#10b981" 
          type="line" 
          unit=" ms"
          preferredUnits={settings?.preferred_units}
          sourceName="Apple Health"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getChartData('active_energy', 'energy')} 
          title="Active Energy" 
          dataKey="energy" 
          color="#ef4444" 
          type="bar" 
          unit=" kcal"
          aggregation="sum"
          preferredUnits={settings?.preferred_units}
          sourceName="Apple Health"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          url="/api/metrics/aggregated?type=vo2max" 
          title="VO2 Max" 
          dataKey="vo2max" 
          color="#3b82f6" 
          type="line" 
          unit=" ml/kg/min"
          aggregation="max"
          preferredUnits={settings?.preferred_units}
          referenceLines={getTargetValue('vo2_max') ? [{ value: getTargetValue('vo2_max'), label: 'Target', color: '#ef4444' }] : undefined}
          sourceName="Apple Health"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          data={getBloodPressureData(summaryData.metrics)} 
          title="Blood Pressure" 
          name="Systolic/Diastolic"
          dataKey="bp_range" 
          rangeKeys={['diastolic', 'systolic']}
          color="#8b5cf6"
          type="rangeBar"
          unit=" mmHg"
          barSize={8}
          preferredUnits={settings?.preferred_units}
          referenceLines={[
            { value: 120, label: 'Sys High', color: '#ef4444' },
            { value: 80, label: 'Dia High', color: '#ef4444' }
          ]}
          sourceName="Apple Health"
          lastSyncStr={lastSynced}
        />
        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
          url="/api/metrics/aggregated?type=lean_body_mass" 
          title="Lean Body Mass" 
          dataKey="lean_body_mass" 
          color="#8b5cf6" 
          type="line" 
          unit={` ${getWeightUnit(settings?.preferred_units)}`}
          preferredUnits={settings?.preferred_units}
          sourceName="Withings"
          lastSyncStr={lastSynced}
        />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Secondary Health Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            data={getChartData('sleep_core', 'seconds').map(d => ({ ...d, hours: d.seconds / 3600 }))} 
            title="Core Sleep" 
            dataKey="hours" 
            color="#10b981" 
            type="bar" 
            unit=" hrs"
            variant="mini"
            aggregation="sum"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            data={getChartData('sleep_deep', 'seconds').map(d => ({ ...d, hours: d.seconds / 3600 }))} 
            title="Deep Sleep" 
            dataKey="hours" 
            color="#4338ca" 
            type="bar" 
            unit=" hrs"
            variant="mini"
            aggregation="sum"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            data={getChartData('sleep_rem', 'seconds').map(d => ({ ...d, hours: d.seconds / 3600 }))} 
            title="REM Sleep" 
            dataKey="hours" 
            color="#818cf8" 
            type="bar" 
            unit=" hrs"
            variant="mini"
            aggregation="sum"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            data={getChartData('sleep_awake', 'seconds').map(d => ({ ...d, hours: d.seconds / 3600 }))} 
            title="Awake time" 
            dataKey="hours" 
            color="#f43f5e" 
            type="bar" 
            unit=" hrs"
            variant="mini"
            aggregation="sum"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=steps" 
            title="Daily Steps" 
            dataKey="steps" 
            color="#3b82f6" 
            type="bar" 
            unit=" steps"
            variant="mini"
            aggregation="sum"
            preferredUnits={settings?.preferred_units}
            referenceLines={getTargetValue('steps') ? [{ value: getTargetValue('steps'), label: 'Target', color: '#ef4444' }] : undefined}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=walking_heart_rate" 
            title="Walking HR" 
            dataKey="walking_heart_rate" 
            color="#f59e0b" 
            type="line" 
            unit=" bpm"
            variant="mini"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=oxygen_saturation" 
            title="Blood Oxygen"
            dataKey="oxygen_saturation"
            color="#3b82f6"
            type="line"
            unit="%"
            variant="mini"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
            referenceLines={getTargetValue('blood_oxygen_saturation') ? [{ value: getTargetValue('blood_oxygen_saturation'), label: 'Target', color: '#ef4444' }] : undefined}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=respiratory_rate" 
            title="Resp Rate" 
            dataKey="respiratory_rate" 
            color="#10b981" 
            type="line" 
            unit=" brpm"
            variant="mini"
            preferredUnits={settings?.preferred_units}
            sourceName="Apple Health"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=pulse_wave_velocity" 
            title="Pulse Wave Velocity" 
            dataKey="pulse_wave_velocity" 
            color="#0ea5e9" 
            type="line" 
            unit=" m/s"
            variant="mini"
            preferredUnits={settings?.preferred_units}
            sourceName="Withings"
            lastSyncStr={lastSynced}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=visceral_fat" 
            title="Visceral Fat" 
            dataKey="visceral_fat" 
            color="#f97316" 
            type="line" 
            unit=" index"
            variant="mini"
            preferredUnits={settings?.preferred_units}
            sourceName="Withings"
            lastSyncStr={lastSynced}
            referenceLines={getTargetValue('visceral_fat') ? [{ value: getTargetValue('visceral_fat'), label: 'Target', color: '#ef4444' }] : undefined}
          />
          <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
            url="/api/metrics/aggregated?type=metabolic_age" 
            title="Metabolic Age" 
            dataKey="metabolic_age" 
            color="#a855f7" 
            type="line" 
            unit=" yrs"
            variant="mini"
            preferredUnits={settings?.preferred_units}
            sourceName="Withings"
            lastSyncStr={lastSynced}
            referenceLines={getTargetValue('metabolic_age') ? [{ value: getTargetValue('metabolic_age'), label: 'Target', color: '#ef4444' }] : undefined}
          />
        </div>
      </div>
    </motion.div>
  );
});
