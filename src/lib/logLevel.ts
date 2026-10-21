// Level gate for logEvent (sweep item 29).
//
// Every logEvent call used to be appended to the log file and inserted into `logs`
// regardless of level, so per-row ingest chatter (withings per measurement, hevy per
// routine, cronometer per sync step) and per-request API debug lines made up most of
// the volume. The statements are kept -- they are the ingest trail and are wanted when
// diagnosing a sync -- but `debug` is no longer recorded unless asked for:
//
//   LOG_LEVEL=debug|info|warn|error   minimum level recorded (default: info)
//   LOG_DEBUG_SOURCES=withings,hevy   also record `debug` from just these sources
//
// Pure functions, no env or fs access, so they are unit-tested directly.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

const rank = (level: string): number => {
  const i = (LOG_LEVELS as readonly string[]).indexOf(level);
  // An unrecognised level (POST /api/logs takes the level from the request body) ranks
  // as info: never silently dropped at the default, never mistaken for an error.
  return i === -1 ? 1 : i;
};

/**
 * LOG_LEVEL as given, case-insensitive. Unset or blank is the default; an unknown
 * value is the default too, but flagged `invalid` so startup can say so instead of
 * silently ignoring a typo.
 */
export function parseLogLevel(raw: string | undefined): { level: LogLevel; invalid: boolean } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return { level: DEFAULT_LOG_LEVEL, invalid: false };
  if ((LOG_LEVELS as readonly string[]).includes(v)) return { level: v as LogLevel, invalid: false };
  return { level: DEFAULT_LOG_LEVEL, invalid: true };
}

/** LOG_DEBUG_SOURCES: comma-separated source names, trimmed, lower-cased, blanks dropped. */
export function parseSourceList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Returns the predicate logEvent asks before writing anything. A message is recorded
 * when its level is at or above `level`, or when it is `debug` and its source is in
 * `debugSources`.
 */
export function createLogFilter({
  level,
  debugSources = new Set<string>(),
}: {
  level: LogLevel;
  debugSources?: Set<string>;
}): (messageLevel: string, source: string) => boolean {
  const threshold = rank(level);
  return (messageLevel, source) => {
    if (rank(messageLevel) >= threshold) return true;
    return messageLevel === 'debug' && debugSources.has(String(source ?? '').toLowerCase());
  };
}
