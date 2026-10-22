import { describe, it, expect } from 'vitest';
import {
  backupName, parseBackupName, sortBackups, expired, backupDue,
  DEFAULT_BACKUP_KEEP, MAX_BACKUP_KEEP,
} from './backups';

const f = (name: string, bytes = 100) => ({ name, day: parseBackupName(name)!.day, bytes });

describe('backupName / parseBackupName', () => {
  it('encodes the local day and the UTC time of writing', () => {
    expect(backupName('2026-10-22', new Date('2026-10-22T03:05:00Z')))
      .toBe('vitality-hub-backup-2026-10-22T0305Z.json.gz');
  });

  it('pads single-digit hours and minutes', () => {
    expect(backupName('2026-01-01', new Date('2026-01-01T04:07:00Z')))
      .toBe('vitality-hub-backup-2026-01-01T0407Z.json.gz');
  });

  it('keeps the local day even when the UTC time is the previous day', () => {
    // 03:00 Europe/London in summer is 02:00Z the same day, but in a +13 zone the
    // local day is ahead of UTC -- the day in the name is the local one regardless.
    expect(backupName('2026-10-23', new Date('2026-10-22T14:00:00Z')))
      .toBe('vitality-hub-backup-2026-10-23T1400Z.json.gz');
  });

  it('round-trips through the parser', () => {
    const n = backupName('2026-03-09', new Date('2026-03-09T03:00:00Z'));
    expect(parseBackupName(n)).toEqual({ day: '2026-03-09' });
  });

  it('refuses anything that is not a backup file', () => {
    expect(parseBackupName('health.db')).toBeNull();
    expect(parseBackupName('vitality-hub-backup-2026-10-22.json.gz')).toBeNull();
    expect(parseBackupName('vitality-hub-backup-2026-10-22T0300Z.json')).toBeNull();
    // No traversal or absolute path can ever look like a backup name.
    expect(parseBackupName('../vitality-hub-backup-2026-10-22T0300Z.json.gz')).toBeNull();
    expect(parseBackupName('/etc/passwd')).toBeNull();
  });
});

describe('sortBackups', () => {
  it('is newest first and lexical, so it does not depend on mtime', () => {
    const files = [
      f('vitality-hub-backup-2026-10-20T0300Z.json.gz'),
      f('vitality-hub-backup-2026-10-22T0300Z.json.gz'),
      f('vitality-hub-backup-2026-10-21T0300Z.json.gz'),
    ];
    expect(sortBackups(files).map(x => x.day)).toEqual(['2026-10-22', '2026-10-21', '2026-10-20']);
  });

  it('separates two runs on the same day by their time part', () => {
    const files = [
      f('vitality-hub-backup-2026-10-22T0300Z.json.gz'),
      f('vitality-hub-backup-2026-10-22T1915Z.json.gz'),
    ];
    expect(sortBackups(files)[0].name).toContain('1915Z');
  });

  it('does not mutate its input', () => {
    const files = [
      f('vitality-hub-backup-2026-10-20T0300Z.json.gz'),
      f('vitality-hub-backup-2026-10-22T0300Z.json.gz'),
    ];
    const before = files.map(x => x.name);
    sortBackups(files);
    expect(files.map(x => x.name)).toEqual(before);
  });
});

describe('expired', () => {
  const week = Array.from({ length: 9 }, (_, i) =>
    f(`vitality-hub-backup-2026-10-${String(10 + i).padStart(2, '0')}T0300Z.json.gz`));

  it('keeps the newest `keep` and names the rest', () => {
    const gone = expired(week, 7).map(x => x.day);
    expect(gone).toEqual(['2026-10-11', '2026-10-10']);
  });

  it('deletes nothing when there are fewer than `keep`', () => {
    expect(expired(week.slice(0, 3), DEFAULT_BACKUP_KEEP)).toEqual([]);
  });

  it('deletes nothing when the count is exactly `keep`', () => {
    expect(expired(week.slice(0, 7), 7)).toEqual([]);
  });

  it('clamps a retention of 0 to 1 rather than deleting the backup it just took', () => {
    expect(expired(week, 0).map(x => x.day)).not.toContain('2026-10-18');
    expect(expired(week, 0)).toHaveLength(week.length - 1);
  });

  it('clamps a negative retention the same way', () => {
    expect(expired(week, -5)).toHaveLength(week.length - 1);
  });

  it('accepts the documented maximum', () => {
    expect(expired(week, MAX_BACKUP_KEEP)).toEqual([]);
  });
});

describe('backupDue', () => {
  const base = { enabled: true, hour: 3, today: '2026-10-22', hourNow: 3, lastDay: '2026-10-21' };

  it('is due at the configured hour when today has no backup', () => {
    expect(backupDue(base)).toBe(true);
  });

  it('is not due before the hour', () => {
    expect(backupDue({ ...base, hourNow: 2 })).toBe(false);
  });

  it('is still due later the same day, so a restart at 03:00 does not skip a night', () => {
    expect(backupDue({ ...base, hourNow: 7 })).toBe(true);
  });

  it('is not due once today is done', () => {
    expect(backupDue({ ...base, lastDay: '2026-10-22', hourNow: 23 })).toBe(false);
  });

  it('is due when there has never been a backup', () => {
    expect(backupDue({ ...base, lastDay: null })).toBe(true);
  });

  it('takes one backup after a long outage, not one per missed day', () => {
    // The caller runs it once per tick; a week-old lastDay is still a single `true`,
    // and the run that follows sets lastDay to today.
    expect(backupDue({ ...base, lastDay: '2026-10-15' })).toBe(true);
  });

  it('is never due when disabled', () => {
    expect(backupDue({ ...base, enabled: false, lastDay: null, hourNow: 23 })).toBe(false);
  });

  it('treats a future lastDay as done rather than firing every tick', () => {
    expect(backupDue({ ...base, lastDay: '2026-10-23' })).toBe(false);
  });

  it('handles an hour of 0 (midnight)', () => {
    expect(backupDue({ ...base, hour: 0, hourNow: 0 })).toBe(true);
  });

  it('handles an hour of 23', () => {
    expect(backupDue({ ...base, hour: 23, hourNow: 22 })).toBe(false);
    expect(backupDue({ ...base, hour: 23, hourNow: 23 })).toBe(true);
  });
});
