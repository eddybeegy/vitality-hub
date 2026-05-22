import React from 'react';
import { motion } from 'motion/react';
import { Target } from 'lucide-react';
import { getWeightUnit, convertWeight } from '../lib/utils';

interface TargetsTabProps {
  targets: any[];
  setTargets: (targets: any[]) => void;
  settings: any;
  handleSaveTargets: () => Promise<void>;
}

export const TargetsTab = React.memo(({
  targets,
  setTargets,
  settings,
  handleSaveTargets
}: TargetsTabProps) => {
  return (
    <motion.div 
      key="targets"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm mt-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Target size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Health Targets</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Set your goals for weight, body composition, and nutrition</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {targets.map((target, idx) => {
            const isWeight = target.type === 'weight' || target.type === 'muscle_mass';
            const expectsLbs = settings?.preferred_units === 'imperial' || settings?.preferred_units === 'stone';
            
            let displayUnit = target.unit;
            let displayValue = target.value;

            if (isWeight) {
              displayUnit = expectsLbs ? 'lbs' : 'kg';
              displayValue = convertWeight(target.value, settings?.preferred_units);
            }
            
            return (
              <div key={idx} className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{target.label} ({displayUnit})</label>
                <input 
                  type="number" 
                  step="0.1"
                  value={displayValue}
                  onChange={(e) => {
                    const newTargets = [...targets];
                    let val = parseFloat(e.target.value) || 0;
                    if (isWeight && expectsLbs) {
                      val = val / 2.20462;
                    }
                    newTargets[idx].value = val;
                    setTargets(newTargets);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                />
              </div>
            );
          })}
        </div>

        <div className="pt-8">
          <button 
            onClick={handleSaveTargets}
            className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
          >
            Update Health Targets
          </button>
        </div>
      </div>
    </motion.div>
  );
});
