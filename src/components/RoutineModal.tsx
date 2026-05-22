import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Dumbbell } from 'lucide-react';
import { HealthChart } from './HealthChart';
import { formatWorkoutWeight, convertWeight, getWeightUnit } from '../lib/utils';

interface RoutineModalProps {
  selectedRoutine: any;
  setSelectedRoutine: (routine: any) => void;
  summaryData: any;
  settings: any;
}

export const RoutineModal = ({
  selectedRoutine,
  setSelectedRoutine,
  summaryData,
  settings
}: RoutineModalProps) => {
  return (
    <AnimatePresence>
      {selectedRoutine && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" 
          onClick={() => setSelectedRoutine(null)}
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-black/5 dark:border-white/5" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{selectedRoutine.name} Progressions</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Exercise history and trend analysis</p>
              </div>
              <button 
                onClick={() => setSelectedRoutine(null)} 
                className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(() => {
                const filtered = summaryData.routineExercises.filter((re: any) => {
                  return Number(re.routine_id) === Number(selectedRoutine.id);
                });
                return filtered.map((re: any) => {
                  const historicalExercises = summaryData.exercises.filter((e: any) => e.exercise_title === re.exercise_title);
                  const historicalExerciseIds = historicalExercises.map((e: any) => e.id);
                  const exerciseSets = summaryData.sets.filter((s: any) => historicalExerciseIds.includes(s.exercise_id));
                  
                  const setsByWorkout = exerciseSets.reduce((acc: any, s: any) => {
                    if (!acc[s.workout_id]) acc[s.workout_id] = [];
                    acc[s.workout_id].push(s);
                    return acc;
                  }, {} as Record<string, any[]>);

                  const maxSets = Math.max(...(Object.values(setsByWorkout) as any[][]).map(sets => sets.length), 0);
                  const sortedExerciseSets = [...exerciseSets].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                  const lastXSets = sortedExerciseSets.slice(-maxSets);
                  
                  return (
                    <div key={re.id} className="bg-zinc-50 dark:bg-zinc-800/50 p-6 rounded-2xl border border-black/5 dark:border-white/5">
                      <h4 className="font-bold text-sm mb-4 text-zinc-900 dark:text-zinc-100">{re.exercise_title}</h4>
                      <div className="flex flex-wrap gap-2 mb-6">
                        {lastXSets.length > 0 ? lastXSets.map((set: any, idx: number) => (
                          <div key={idx} className="text-[10px] font-bold bg-white dark:bg-zinc-900 px-3 py-1.5 rounded-lg border border-black/5 dark:border-white/5 text-zinc-600 dark:text-zinc-400">
                            {formatWorkoutWeight(set.weight, settings?.preferred_units)} x {set.reps}
                          </div>
                        )) : (
                          <span className="text-[10px] text-zinc-400 italic">No recent data recorded</span>
                        )}
                      </div>
                      {exerciseSets.length > 0 ? (
                        <HealthChart timezone={settings?.timezone} defaultPeriod={settings?.default_graph_range as any} defaultGranularity={settings?.default_graph_grouping as any} 
                          data={exerciseSets.map((s: any) => ({ date: s.created_at, weight: convertWeight(s.weight, settings?.preferred_units) }))}
                          title={`Weight Progression (${settings?.preferred_units === 'metric' ? 'kg' : 'lbs'})`}
                          dataKey="weight"
                          unit={settings?.preferred_units === 'metric' ? 'kg' : 'lbs'}
                          preferredUnits={settings?.preferred_units === 'metric' ? 'metric' : 'imperial'}
                          variant="mini"
                          color="#10b981"
                        />
                      ) : (
                        <div className="h-32 flex flex-col items-center justify-center border border-dashed border-zinc-200 dark:border-zinc-700 rounded-2xl bg-zinc-100/50 dark:bg-zinc-900/50">
                          <Dumbbell size={24} className="text-zinc-300 dark:text-zinc-600 mb-2" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">No progression data</span>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
