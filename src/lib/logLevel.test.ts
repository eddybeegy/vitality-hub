import { describe, it, expect } from 'vitest';
import { parseLogLevel, parseSourceList, createLogFilter, DEFAULT_LOG_LEVEL } from './logLevel';

describe('parseLogLevel', () => {
  it('defaults to info when unset or blank', () => {
    expect(DEFAULT_LOG_LEVEL).toBe('info');
    expect(parseLogLevel(undefined)).toEqual({ level: 'info', invalid: false });
    expect(parseLogLevel('  ')).toEqual({ level: 'info', invalid: false });
  });

  it('accepts each level, case-insensitively', () => {
    expect(parseLogLevel('debug').level).toBe('debug');
    expect(parseLogLevel('WARN').level).toBe('warn');
    expect(parseLogLevel(' Error ').level).toBe('error');
  });

  it('falls back to info on a typo but flags it', () => {
    expect(parseLogLevel('verbose')).toEqual({ level: 'info', invalid: true });
    expect(parseLogLevel('dbug')).toEqual({ level: 'info', invalid: true });
  });
});

describe('parseSourceList', () => {
  it('splits, trims, lower-cases and drops blanks', () => {
    expect([...parseSourceList(' Withings, hevy,,cronometer ')]).toEqual(['withings', 'hevy', 'cronometer']);
    expect(parseSourceList(undefined).size).toBe(0);
    expect(parseSourceList('').size).toBe(0);
  });
});

describe('createLogFilter', () => {
  it('at the default level drops debug and keeps everything else', () => {
    const f = createLogFilter({ level: 'info' });
    expect(f('debug', 'withings')).toBe(false);
    expect(f('debug', 'cleanup')).toBe(false);
    expect(f('info', 'withings')).toBe(true);
    expect(f('warn', 'apple_health')).toBe(true);
    expect(f('error', 'hevy')).toBe(true);
  });

  it('at debug records the full ingest trail', () => {
    const f = createLogFilter({ level: 'debug' });
    expect(f('debug', 'withings')).toBe(true);
    expect(f('info', 'withings')).toBe(true);
  });

  it('at warn drops info too', () => {
    const f = createLogFilter({ level: 'warn' });
    expect(f('info', 'cronometer')).toBe(false);
    expect(f('warn', 'cronometer')).toBe(true);
    expect(f('error', 'cronometer')).toBe(true);
  });

  it('LOG_DEBUG_SOURCES keeps debug for just the named sources', () => {
    const f = createLogFilter({ level: 'info', debugSources: parseSourceList('withings') });
    expect(f('debug', 'withings')).toBe(true);
    expect(f('debug', 'Withings')).toBe(true);
    expect(f('debug', 'hevy')).toBe(false);
  });

  it('a debug source does not lower other levels below the threshold', () => {
    const f = createLogFilter({ level: 'error', debugSources: parseSourceList('withings') });
    expect(f('debug', 'withings')).toBe(true);
    expect(f('info', 'withings')).toBe(false); // only debug is opted in, as documented
  });

  it('never drops an unrecognised level at the default (POST /api/logs takes level from the body)', () => {
    const f = createLogFilter({ level: 'info' });
    expect(f('trace', 'client')).toBe(true);
    expect(createLogFilter({ level: 'warn' })('trace', 'client')).toBe(false);
  });
});
