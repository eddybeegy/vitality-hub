import React from 'react';
import { Gauge } from 'lucide-react';
import { cn } from '../lib/utils';
import { DEFAULT_MAX_CHANGE_KCAL, MIN_MAX_CHANGE_KCAL, MAX_MAX_CHANGE_KCAL } from '../lib/autoTargets';

// Targets that adjust themselves (item 97). A weekly server-side sweep writes the
// suggested calorie and protein targets from the Adaptive TDEE card into Targets.
//
// Off by default, deliberately: it rewrites a number the user set by hand. The
// movement limit is the other half of that -- a bad week of logging can move the
// estimate hundreds of kcal, and past the limit the sweep refuses and logs why
// rather than applying it. Both guards, and every refusal reason, are in
// src/lib/autoTargets.ts.

interface Props {
  settings: any;
  setSettings: (settings: any) => void;
}

const Toggle: React.FC<{ on: boolean; onClick: () => void; disabled?: boolean }> = ({ on, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'w-12 h-6 rounded-full transition-colors relative shrink-0',
      disabled && 'opacity-40',
      on ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700',
    )}
  >
    <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-7' : 'left-1')} />
  </button>
);

export const AutoTargetsCard: React.FC<Props> = ({ settings, setSettings }) => {
  const on = !!settings.auto_targets_enabled;
  const set = (patch: Record<string, unknown>) => setSettings({ ...settings, ...patch });
  const cap = typeof settings.auto_targets_max_change_kcal === 'number'
    && Number.isFinite(settings.auto_targets_max_change_kcal)
    ? settings.auto_targets_max_change_kcal
    : DEFAULT_MAX_CHANGE_KCAL;

  return (
    <div className="p-4 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-zinc-500 dark:text-zinc-400" />
          <div>
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Self-adjusting targets</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Applies the suggested calorie and protein targets every Monday
            </p>
          </div>
        </div>
        <Toggle on={on} onClick={() => set({ auto_targets_enabled: !on })} />
      </div>

      <div className={cn('space-y-2', !on && 'opacity-60')}>
        <label className="block max-w-[12rem]">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
            Movement limit (kcal)
          </span>
          <input
            type="number"
            min={MIN_MAX_CHANGE_KCAL}
            max={MAX_MAX_CHANGE_KCAL}
            value={cap}
            disabled={!on}
            // Clamped here rather than letting the server 400: the number input lets you
            // type 9999 and the failure would land on an unrelated Save.
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (Number.isInteger(v)) {
                set({ auto_targets_max_change_kcal: Math.min(MAX_MAX_CHANGE_KCAL, Math.max(MIN_MAX_CHANGE_KCAL, v)) });
              }
            }}
            className="w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-40"
          />
        </label>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          A suggestion more than {cap.toLocaleString()} kcal from your current target is refused rather
          than applied, and the reason is written to the logs. Nothing is applied while the TDEE
          estimate is low confidence. You can still apply any suggestion yourself on the Adaptive
          TDEE card.
        </p>
      </div>
    </div>
  );
};
