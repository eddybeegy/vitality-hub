// Log-line safety (sweep item 59).
//
// POST /api/logs only checked that level/message/source were truthy, and logEvent
// interpolated the message straight into a line of `logs/system-<date>.log`. A message
// carrying a newline plus a crafted `[<ts>] [<source>] <LEVEL>: ...` prefix became a
// second, independent line, and GET /api/logs -- which regex-parses the file line by
// line -- returned it as a genuine entry with the attacker's timestamp, source and
// level. Leaving out the `[User N]` segment made it a *system* entry, shown to every
// user. Two layers here:
//
//   - validateClientLog: what the route accepts from a client at all.
//   - formatLogLine / escapeLogFields: how any entry (client or server-side) is stored,
//     with CR/LF and other control characters escaped so an entry is always exactly one
//     line -- in the file and, since item 64, in the `logs` table too.
//
// Pure functions, no fs or Express, so they are unit-tested directly.

import { LOG_LEVELS, normaliseLogLevel, type LogLevel } from './logLevel';

export const MAX_CLIENT_LOG_MESSAGE = 2000;

// Client-supplied sources are plain identifiers. `]`, spaces and brackets are what the
// line format uses as delimiters, so they can never appear in one.
const SOURCE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export type ClientLogResult =
  | { entry: { level: LogLevel; message: string; source: string }; error?: undefined }
  | { entry?: undefined; error: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateClientLog(body: unknown): ClientLogResult {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const { level, message, source } = body;

  // Item 60: the same normalisation the LOG_LEVEL gate ranks by, so what the route stores
  // and what the gate compares can never disagree. Case and surrounding space are not a
  // different level; anything else is unknown.
  if (typeof level !== 'string') return { error: `level must be one of ${LOG_LEVELS.join(', ')}` };
  const lvl = normaliseLogLevel(level);
  if (lvl === null) {
    return { error: `Invalid level '${level}': expected one of ${LOG_LEVELS.join(', ')}` };
  }

  if (typeof message !== 'string' || message.trim() === '') return { error: 'message must be a non-empty string' };
  if (message.length > MAX_CLIENT_LOG_MESSAGE) {
    return { error: `message must be at most ${MAX_CLIENT_LOG_MESSAGE} characters` };
  }

  if (typeof source !== 'string' || !SOURCE_RE.test(source)) {
    return { error: 'source must be 1-64 characters of letters, digits, _ . -' };
  }

  return { entry: { level: lvl, message, source } };
}

// \r and \n would start a new line; the rest of C0 (and DEL) has no business in a log
// file. Escaped as visible \n / \r / \xNN / \uNNNN rather than removed, so the entry still shows
// what was sent.
const escapeControl = (s: string): string =>
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (c) => {
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    const code = c.charCodeAt(0);
    return code > 0xff ? `\\u${code.toString(16)}` : `\\x${code.toString(16).padStart(2, '0')}`;
  });

/**
 * The message and source exactly as every log sink stores them (item 64): the file line
 * and the `logs` table row hold the same single-line text, so neither a whitespace-pre
 * render nor a raw export of either can turn one entry back into two.
 */
export function escapeLogFields(message: unknown, source: unknown): { message: string; source: string } {
  const msg = typeof message === 'string' ? message : JSON.stringify(message) ?? String(message);
  return { message: escapeControl(msg), source: escapeControl(String(source ?? '')) };
}

/**
 * One line of the system log file, newline-terminated. Whatever `message` and `source`
 * contain, the result holds exactly one '\n', at the end.
 */
export function formatLogLine(
  timestamp: string,
  level: string,
  message: unknown,
  source: unknown,
  userId?: number | null,
): string {
  const f = escapeLogFields(message, source);
  return `[${timestamp}] [${f.source}] ${userId ? `[User ${userId}] ` : ''}${escapeControl(String(level).toUpperCase())}: ${f.message}\n`;
}
