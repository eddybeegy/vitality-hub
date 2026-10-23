import React from 'react';
import { Gauge } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  DEFAULT_MAX_CHANGE_KCAL, MIN_MAX_CHANGE_KCAL, MAX_MAX_CHANGE_KCAL,
  DEFAULT_MAX_CHANGE_G, MIN_MAX_CHANGE_G, MAX_MAX_CHANGE_G,
} from '../lib/autoTargets';

// Targets that adjust themselves (item 97). A weekly server-side sweep writes the
// suggested calorie and protein targets from the Adaptive TDEE card into Targets.
//
// Off by default, deliberately: it rewrites numbers the user set by hand. The two
// movement limits are the other half of that -- a bad week of logging can move the
// calorie estimate by hundreds, and the first live rehearsal of the sweep moved
// protein 160 g -> 130 g in one run off a formula. Past either limit the sweep
// refuses and logs why. Every guard is in src/lib/autoTargets.ts.

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

const Num: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, disabled, onChange }) => (
  <label className="flex-1 min-w-[7rem]">
    <span className="block text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      // Clamped here rather than letting the server 400: the number input lets you
      // type 9999 and the failure would land on an unrelated Save.
      onChange={e => {
        const v = parseInt(e.target.value, 10);
        if (Number.isInteger(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      className="w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-40"
    />
  </label>
);

export const AutoTargetsCard: React.FC<Props> = ({ settings, setSettings }) => {
  const on = !!settings.auto_targets_enabled;
  const set = (patch: Record<string, unknown>) => setSettings({ ...settings, ...patch });
  const n = (key: string, fallback: number) => {
    const v = settings[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const kcalCap = n('auto_targets_max_change_kcal', DEFAULT_MAX_CHANGE_KCAL);
  const gCap = n('auto_targets_max_change_g', DEFAULT_MAX_CHANGE_G);

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
        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Movement limits per run</p>
        <div className="flex gap-2">
          <Num label="Calories (kcal)" value={kcalCap} min={MIN_MAX_CHANGE_KCAL} max={MAX_MAX_CHANGE_KCAL}
            disabled={!on} onChange={v => set({ auto_targets_max_change_kcal: v })} />
          <Num label="Protein (g)" value={gCap} min={MIN_MAX_CHANGE_G} max={MAX_MAX_CHANGE_G}
            disabled={!on} onChange={v => set({ auto_targets_max_change_g: v })} />
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          A suggestion more than {kcalCap.toLocaleString()} kcal or {gCap} g from your current target is
          refused rather than applied, and the reason is written to the logs. Nothing is applied while
          the TDEE estimate is low confidence. You can still apply any suggestion yourself on the
          Adaptive TDEE card.
        </p>
      </div>
    </div>
  );
};
