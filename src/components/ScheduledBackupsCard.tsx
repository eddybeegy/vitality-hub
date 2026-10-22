import React from 'react';
import { HardDriveDownload, Download, Trash2, Play, AlertTriangle } from 'lucide-react';
import { fetchJson } from '../lib/apiFetch';
import { cn } from '../lib/utils';
import { DEFAULT_BACKUP_HOUR, DEFAULT_BACKUP_KEEP, type BackupFile } from '../lib/backups';

// Scheduled backups: a nightly gzipped full export kept on disk, oldest pruned past
// the retention count.
//
// The config fields post through /api/settings like every other setting; the file
// list, the manual run and the deletes are their own endpoints because they are
// filesystem operations, not settings.
//
// What this card deliberately shows: the directory, and how old the newest backup
// is. A backup feature whose UI only says "enabled" is how you discover six months
// later that it stopped -- which is the same failure this app already hit with the
// Apple workouts feed.

interface BackupConfig {
  enabled: boolean;
  hour: number;
  keep: number;
  max_keep: number;
  directory: string;
  timezone: string;
}

interface BackupsResponse {
  config: BackupConfig;
  last_day: string | null;
  running: boolean;
  files: BackupFile[];
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// Whole days between a backup's day label and now. Compared at UTC midnight on both
// sides, so it is an integer count of calendar days and does not wobble across a DST
// change the way a local-midnight subtraction would.
const daysSince = (day: string) => Math.floor((Date.now() - Date.parse(`${day}T00:00:00Z`)) / 86400000);

export const ScheduledBackupsCard: React.FC = () => {
  const [data, setData] = React.useState<BackupsResponse | null>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await fetchJson<BackupsResponse>('/api/backups'));
      setStatus('ready');
    } catch (e: any) {
      setError(e?.message || 'Failed to load backups');
      setStatus('error');
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  // Config writes go straight through rather than waiting for the tab's Save button:
  // a half-saved backup schedule is worse than none, and the file list below has to
  // agree with what is actually stored.
  const saveConfig = async (patch: Partial<{ backup_enabled: boolean; backup_hour: number; backup_keep: number }>) => {
    setBusy('config');
    setError(null);
    try {
      await fetchJson('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "Couldn't save the backup schedule");
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    setError(null);
    try {
      await fetchJson('/api/backups/run', { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Backup failed');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await fetchJson(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete that backup");
    } finally {
      setBusy(null);
    }
  };

  if (status === 'loading') return <p className="text-xs text-zinc-400">Loading backups…</p>;

  const cfg = data?.config;
  const newest = data?.files[0];
  const stale = cfg?.enabled && (!newest || daysSince(newest.day) >= 2);

  return (
    <div className="space-y-4 pt-6 border-t border-black/5 dark:border-white/5">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
        <HardDriveDownload size={16} /> Scheduled Backups
      </h3>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      <div className="flex items-center justify-between p-4 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Nightly backup</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            Gzipped full export to <span className="font-mono">{cfg?.directory}</span>
          </p>
        </div>
        <button
          disabled={busy === 'config'}
          onClick={() => saveConfig({ backup_enabled: !cfg?.enabled })}
          className={cn(
            'w-12 h-6 rounded-full transition-colors relative shrink-0 ml-3 disabled:opacity-50',
            cfg?.enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700',
          )}
        >
          <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white transition-all', cfg?.enabled ? 'left-7' : 'left-1')} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Hour ({cfg?.timezone || 'local'})
          </span>
          <select
            value={cfg?.hour ?? DEFAULT_BACKUP_HOUR}
            disabled={busy === 'config'}
            onChange={e => saveConfig({ backup_hour: Number(e.target.value) })}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Keep</span>
          <input
            type="number"
            min={1}
            max={cfg?.max_keep ?? 60}
            defaultValue={cfg?.keep ?? DEFAULT_BACKUP_KEEP}
            disabled={busy === 'config'}
            // On blur, not on change: a keystroke mid-edit ("1" on the way to "14")
            // would be a valid retention and prune everything but one file.
            onBlur={e => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 1 && v <= (cfg?.max_keep ?? 60) && v !== cfg?.keep) void saveConfig({ backup_keep: v });
            }}
            className="mt-1 w-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className={cn('text-xs flex items-center gap-1 min-w-0', stale ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400')}>
          {stale && <AlertTriangle size={12} className="shrink-0" />}
          <span className="truncate">
            {newest
              ? `Newest: ${newest.day} (${fmtBytes(newest.bytes)}) · ${data!.files.length} kept`
              : 'No backups yet'}
          </span>
        </p>
        <button
          onClick={runNow}
          disabled={busy !== null || data?.running}
          className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 px-3 py-2 rounded-xl font-bold text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all disabled:opacity-50 shrink-0"
        >
          <Play size={12} /> {busy === 'run' ? 'Backing up…' : 'Back up now'}
        </button>
      </div>

      {data && data.files.length > 0 && (
        <div className="divide-y divide-black/5 dark:divide-white/5 rounded-xl border border-black/5 dark:border-white/5">
          {data.files.map(f => (
            <div key={f.name} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs font-mono truncate" title={f.name}>{f.name}</span>
              <span className="text-xs text-zinc-400 tabular-nums shrink-0">{fmtBytes(f.bytes)}</span>
              <a
                href={`/api/backups/${encodeURIComponent(f.name)}`}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 shrink-0"
                title="Download"
              >
                <Download size={14} />
              </a>
              <button
                onClick={() => remove(f.name)}
                disabled={busy !== null}
                className="text-zinc-400 hover:text-rose-500 disabled:opacity-50 shrink-0"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
