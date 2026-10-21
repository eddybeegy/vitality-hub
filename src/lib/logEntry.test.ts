import { describe, expect, it } from 'vitest';
import { escapeLogFields, formatLogLine, validateClientLog, MAX_CLIENT_LOG_MESSAGE } from './logEntry';

// The regex GET /api/logs uses to parse each file line.
const LINE_RE = /^\[(.*?)\] \[(.*?)\] (?:\[User (\d+)\] )?(.*?): (.*)/;

describe('formatLogLine', () => {
  it('formats a plain entry as before', () => {
    expect(formatLogLine('2026-10-21T15:00:00.000Z', 'info', 'synced', 'hevy', 3))
      .toBe('[2026-10-21T15:00:00.000Z] [hevy] [User 3] INFO: synced\n');
    expect(formatLogLine('t', 'warn', 'boot', 'system')).toBe('[t] [system] WARN: boot\n');
  });

  it('cannot be split into a second, forged entry (the item-59 repro)', () => {
    const forged = 'ok\n[2026-10-21T15:20:00.000Z] [security] WARN: unauthorised admin login from 10.0.0.1';
    const line = formatLogLine('2026-10-21T15:21:00.000Z', 'info', forged, 'client', 7);
    expect(line.split('\n')).toEqual([expect.any(String), '']);
    const m = line.trimEnd().match(LINE_RE)!;
    expect(m[2]).toBe('client');
    expect(m[3]).toBe('7');
    expect(m[4]).toBe('INFO');
    expect(m[5]).toContain('\\n[2026-10-21T15:20:00.000Z] [security]');
  });

  it.each(['\r', '\r\n', '\u2028', '\u2029', '\u0000', '\u001b'])('escapes %j', (c) => {
    const line = formatLogLine('t', 'info', `a${c}b`, 's');
    // eslint-disable-next-line no-control-regex
    expect(line.slice(0, -1)).not.toMatch(/[\r\n\u0000-\u001f\u2028\u2029]/);
  });

  it('escapes control characters in the source too', () => {
    expect(formatLogLine('t', 'info', 'm', 'a\nb').split('\n')).toHaveLength(2);
  });

  it('writes a non-string message as JSON rather than [object Object]', () => {
    expect(formatLogLine('t', 'info', { a: 1 }, 's')).toBe('[t] [s] INFO: {"a":1}\n');
  });
});

describe('validateClientLog', () => {
  it('accepts a normal entry and canonicalises the level', () => {
    expect(validateClientLog({ level: ' DEBUG ', message: 'hi', source: 'dashboard' }).entry)
      .toEqual({ level: 'debug', message: 'hi', source: 'dashboard' });
  });

  it.each([
    ['an array', [1]],
    ['null', null],
    ['a string', 'x'],
  ])('rejects %s body', (_l, body) => {
    expect(validateClientLog(body).error).toBeDefined();
  });

  it.each([
    [{ level: 123, message: 'm', source: 's' }, /level/],
    [{ level: 'totally-made-up-level', message: 'm', source: 's' }, /level/],
    [{ level: 'info', message: { a: 1 }, source: 's' }, /message/],
    [{ level: 'info', message: '   ', source: 's' }, /message/],
    [{ level: 'info', message: 'x'.repeat(MAX_CLIENT_LOG_MESSAGE + 1), source: 's' }, /message/],
    [{ level: 'info', message: 'm', source: 'security] [User 1' }, /source/],
    [{ level: 'info', message: 'm', source: 'a b' }, /source/],
    [{ level: 'info', message: 'm', source: '' }, /source/],
    [{ level: 'info', message: 'm' }, /source/],
  ])('rejects %j', (body, re) => {
    expect(validateClientLog(body).error).toMatch(re);
  });
});

describe('validateClientLog — item 60', () => {
  it.each([
    ['DEBUG', 'debug'],
    ['debug ', 'debug'],
    ['\tWarn\n', 'warn'],
  ])('stores %j as the canonical %s, so the LOG_LEVEL gate and LogsTab filter both match it', (raw, canonical) => {
    expect(validateClientLog({ level: raw, message: 'm', source: 's' }).entry?.level).toBe(canonical);
  });

  it.each(['totally-made-up-level', 'information', 'warning', ''])('rejects the invented level %j', (raw) => {
    expect(validateClientLog({ level: raw, message: 'm', source: 's' }).error).toMatch(/level/);
  });
});

describe('escapeLogFields — item 64', () => {
  it('gives the table the same single-line text the file line carries', () => {
    const forged = 'ok\r\n[2026-10-21T15:20:00.000Z] [security] WARN: x';
    const row = escapeLogFields(forged, 'ui');
    expect(row.message).toBe('ok\\r\\n[2026-10-21T15:20:00.000Z] [security] WARN: x');
    // eslint-disable-next-line no-control-regex
    expect(row.message).not.toMatch(/[\r\n\u0000-\u001f\u2028\u2029]/);
    expect(formatLogLine('t', 'info', forged, 'ui', 1)).toBe(`[t] [ui] [User 1] INFO: ${row.message}\n`);
  });

  it('leaves an ordinary message untouched', () => {
    expect(escapeLogFields('Synced 12 workouts', 'hevy')).toEqual({ message: 'Synced 12 workouts', source: 'hevy' });
  });

  it('escapes the source and stringifies a non-string message', () => {
    expect(escapeLogFields({ a: 1 }, 'a\nb')).toEqual({ message: '{"a":1}', source: 'a\\nb' });
  });
});
