import React from 'react';
import { BellRing } from 'lucide-react';
import { cn } from '../lib/utils';

// Phone alerts (item 95). A 15-minute server-side sweep posts to NanoClaw, which
// delivers the text to the coach Telegram line. Everything here is one of the
// alert_* columns on the users row, saved by the tab's own Save button.
//
// The defaults are derived from his own readings rather than from clinical
// guidance -- 140/90 would never have fired once in his history, and an alert that
// cannot fire is worse than none because it reads as cover. That makes the numbers
// a judgement call, which is exactly why they are editable here. See
// src/lib/alerts.ts for the derivation.

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
      // Clamp here rather than letting the server 400 on save: the number input lets
      // you type 9999 and the failure would otherwise land on an unrelated Save.
      onChange={e => {
        const v = parseInt(e.target.value, 10);
        if (Number.isInteger(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
      className="w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-40"
    />
  </label>
);

export const PhoneAlertsCard: React.FC<Props> = ({ settings, setSettings }) => {
  const on = !!settings.alerts_enabled;
  const set = (patch: Record<string, unknown>) => setSettings({ ...settings, ...patch });
  const n = (key: string, fallback: number) => {
    const v = settings[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const quietStart = n('alert_quiet_start_hour', 22);
  const quietEnd = n('alert_quiet_end_hour', 7);

  return (
    <div className="p-4 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BellRing size={16} className="text-zinc-500 dark:text-zinc-400" />
          <div>
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Phone Alerts</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Telegram messages for stale feeds, high BP and low readiness</p>
          </div>
        </div>
        <Toggle on={on} onClick={() => set({ alerts_enabled: !on })} />
      </div>

      <div className={cn('space-y-3', !on && 'opacity-60')}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Stale feeds</p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Uses each module's existing 24h / 72h / 7d threshold</p>
          </div>
          <Toggle
            on={settings.alert_stale_enabled !== 0 && settings.alert_stale_enabled !== false}
            disabled={!on}
            onClick={() => set({ alert_stale_enabled: settings.alert_stale_enabled === 0 || settings.alert_stale_enabled === false })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">High blood pressure</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Fires at or above either number. Not silenced by quiet hours.</p>
            </div>
            <Toggle
              on={settings.alert_bp_enabled !== 0 && settings.alert_bp_enabled !== false}
              disabled={!on}
              onClick={() => set({ alert_bp_enabled: settings.alert_bp_enabled === 0 || settings.alert_bp_enabled === false })}
            />
          </div>
          <div className="flex gap-2">
            <Num label="Systolic" value={n('alert_bp_systolic', 130)} min={80} max={220} disabled={!on}
              onChange={v => set({ alert_bp_systolic: v })} />
            <Num label="Diastolic" value={n('alert_bp_diastolic', 82)} min={40} max={140} disabled={!on}
              onChange={v => set({ alert_bp_diastolic: v })} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Low readiness</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Morning only, before noon</p>
            </div>
            <Toggle
              on={settings.alert_readiness_enabled !== 0 && settings.alert_readiness_enabled !== false}
              disabled={!on}
              onClick={() => set({ alert_readiness_enabled: settings.alert_readiness_enabled === 0 || settings.alert_readiness_enabled === false })}
            />
          </div>
          <div className="flex gap-2">
            <Num label="Readiness floor" value={n('alert_readiness_floor', 60)} min={0} max={100} disabled={!on}
              onChange={v => set({ alert_readiness_floor: v })} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Quiet hours</p>
          <div className="flex gap-2">
            <Num label="From (hour)" value={quietStart} min={0} max={23} disabled={!on}
              onChange={v => set({ alert_quiet_start_hour: v })} />
            <Num label="To (hour)" value={quietEnd} min={0} max={23} disabled={!on}
              onChange={v => set({ alert_quiet_end_hour: v })} />
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {quietStart === quietEnd
              ? 'Equal start and end means no quiet window.'
              : `Silent ${String(quietStart).padStart(2, '0')}:00–${String(quietEnd).padStart(2, '0')}:00 in your timezone. High BP still comes through.`}
          </p>
        </div>
      </div>
    </div>
  );
};
