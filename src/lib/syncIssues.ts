import { parseUTCDate } from './utils';

export interface SyncIssue {
  message: string;
  level: string;
  timestamp: string;
  source?: string;
}

export interface SyncLogEntry {
  module: string;
  timestamp: string;
}

/**
 * An issue is only worth showing if nothing has gone right since (sweep item 41).
 *
 * The server keeps a warn/error in `syncIssues` for a flat 24h, so a Withings error at
 * 07:12 sat next to the Reconnect button all day even after clean syncs at 09:32 and
 * 10:00. `syncLogs` carries the newest `info` line per `logs.source`, and a sync run's
 * last line is its verdict -- `info` on success, `error` on failure (see the
 * /api/sync/:moduleId handler) -- so an `info` strictly after the issue, from the SAME
 * source the issue was logged under, means a later run finished cleanly.
 *
 * Both timestamps come out of the same `timestamp AT TIME ZONE 'Europe/London'`
 * conversion server-side, so they are comparable instants; compare with getTime(),
 * never by formatting to a local string.
 */
export function isIssueResolved(
  issue: SyncIssue,
  syncLogs: SyncLogEntry[] | undefined,
  moduleId: string,
): boolean {
  const source = issue.source || moduleId;
  const lastInfo = syncLogs?.find(l => l.module === source)?.timestamp;
  if (!lastInfo || !issue.timestamp) return false;
  const issueAt = parseUTCDate(issue.timestamp).getTime();
  const infoAt = parseUTCDate(lastInfo).getTime();
  if (isNaN(issueAt) || isNaN(infoAt)) return false;
  return infoAt > issueAt;
}
