// Scheduled backups (roadmap item: "scheduled backups").
//
// The scheduling decision, the filename convention and the retention choice are all
// pure functions here so they can be tested without a disk or a clock. The server
// side only does the IO: stream the export into a gzip file, then delete what
// `expired()` names.
//
// Why a "last run day" and not a cron: the container restarts whenever it is
// redeployed, which on this install is several times a day. A timer armed for
// 03:00 is lost on every restart and a backup silently never happens -- the exact
// failure mode this feature exists to prevent. Instead the ticker asks a cheap
// question every few minutes ("is today's backup still missing, and is it past the
// hour?") against a day string persisted in the DB, so a restart at 02:59 or at
// 03:01 both still produce today's backup.

export interface BackupFile {
  /** File name on disk, e.g. `vitality-hub-backup-2026-10-22T0300Z.json.gz`. */
  name: string;
  /** The `YYYY-MM-DD` the name encodes, in the user's zone at the time of writing. */
  day: string;
  bytes: number;
}

/** Default nightly hour, in the user's own timezone. */
export const DEFAULT_BACKUP_HOUR = 3;
/** Default number of backups kept. */
export const DEFAULT_BACKUP_KEEP = 7;
export const MAX_BACKUP_KEEP = 60;
/** How often the ticker asks whether a backup is due. */
export const BACKUP_TICK_MINUTES = 10;

const NAME_RE = /^vitality-hub-backup-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})Z\.json\.gz$/;

/**
 * Backup file name for a day. The day is the user's local day (so "last night's
 * backup" is named the night it covers), while the time part is UTC and only there
 * to keep two runs on the same local day distinguishable and sortable.
 *
 * Lexical order of these names is chronological order, which is what `expired()`
 * relies on instead of stat times -- an rsync or a restore can rewrite mtimes, and
 * then retention would start deleting the wrong files.
 */
export function backupName(day: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `vitality-hub-backup-${day}T${p(at.getUTCHours())}${p(at.getUTCMinutes())}Z.json.gz`;
}

/** Parses a backup file name, or null for anything that is not one. */
export function parseBackupName(name: string): { day: string } | null {
  const m = NAME_RE.exec(name);
  return m ? { day: m[1] } : null;
}

/** Newest first. Sorted by the name, not by mtime -- see `backupName`. */
export function sortBackups(files: BackupFile[]): BackupFile[] {
  return [...files].sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * The files to delete to keep at most `keep` of them, newest kept.
 *
 * `keep` is clamped to at least 1: a retention of 0 would mean "take a backup and
 * immediately delete it", which is worse than not running at all because the UI
 * would still say a backup had been taken.
 */
export function expired(files: BackupFile[], keep: number): BackupFile[] {
  const limit = Math.max(1, Math.floor(keep) || 1);
  return sortBackups(files).slice(limit);
}

/**
 * Is a backup due? `today`/`hourNow` are the user's local day and hour; `lastDay` is
 * the local day of the last successful backup (null = never).
 *
 * A missed day is not made up for: if the host was off for a week, one backup is
 * taken now, not seven. The window is also deliberately open-ended rather than
 * "only at 03:xx" -- a container that was down at 03:00 should back up at 07:00
 * rather than skip a day.
 */
export function backupDue(opts: {
  enabled: boolean;
  hour: number;
  today: string;
  hourNow: number;
  lastDay: string | null;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.lastDay === opts.today) return false;
  // A lastDay in the future means the clock or the timezone moved backwards; treat it
  // as "already done" rather than backing up on every tick until the day catches up.
  if (opts.lastDay !== null && opts.lastDay > opts.today) return false;
  return opts.hourNow >= opts.hour;
}
