import { describe, it, expect } from 'vitest';
import { isIssueResolved } from './syncIssues';

// Explicit offsets throughout: BST ends 2026-10-25, so a test that leaned on the
// runner's clock or zone would pass today and mean nothing.
describe('isIssueResolved', () => {
  const withingsError = { message: 'token invalid', level: 'error', timestamp: '2026-10-21T06:12:00.000Z', source: 'withings' };

  it('hides an error once the same source has a later clean sync (the 07:12 vs 10:00 London case)', () => {
    const logs = [{ module: 'withings', timestamp: '2026-10-21T09:00:00.000Z' }];
    expect(isIssueResolved(withingsError, logs, 'withings')).toBe(true);
  });

  it('keeps an error when the last clean sync was before it', () => {
    const logs = [{ module: 'withings', timestamp: '2026-10-21T05:00:00.000Z' }];
    expect(isIssueResolved(withingsError, logs, 'withings')).toBe(false);
  });

  it('keeps an error with no clean sync on record', () => {
    expect(isIssueResolved(withingsError, [], 'withings')).toBe(false);
    expect(isIssueResolved(withingsError, undefined, 'withings')).toBe(false);
  });

  it('compares instants, not wall-clock strings, across differing offsets', () => {
    // 07:30+01:00 is 06:30Z: after the 06:12Z error.
    expect(isIssueResolved(withingsError, [{ module: 'withings', timestamp: '2026-10-21T07:30:00+01:00' }], 'withings')).toBe(true);
    // 07:05+01:00 is 06:05Z: before the error, even though 07:05 reads later than 06:12.
    expect(isIssueResolved(withingsError, [{ module: 'withings', timestamp: '2026-10-21T07:05:00+01:00' }], 'withings')).toBe(false);
  });

  it('holds across the 2026-10-25 BST->GMT change', () => {
    const issue = { message: 'x', level: 'error', timestamp: '2026-10-25T01:30:00+01:00' }; // 00:30Z
    expect(isIssueResolved(issue, [{ module: 'withings', timestamp: '2026-10-25T01:10:00+00:00' }], 'withings')).toBe(true);
    expect(isIssueResolved(issue, [{ module: 'withings', timestamp: '2026-10-25T00:20:00+00:00' }], 'withings')).toBe(false);
  });

  it('only counts a success from the source the issue was logged under', () => {
    // apple_workouts' issue came from its own log source; an apple_health success says
    // nothing about it.
    const issue = { message: 'x', level: 'error', timestamp: '2026-10-21T06:00:00.000Z', source: 'apple_workouts' };
    const logs = [{ module: 'apple_health', timestamp: '2026-10-21T09:00:00.000Z' }];
    expect(isIssueResolved(issue, logs, 'apple_workouts')).toBe(false);
  });

  it('falls back to the module id when the issue has no source (old cached payload)', () => {
    const { source, ...flat } = withingsError;
    const logs = [{ module: 'withings', timestamp: '2026-10-21T09:00:00.000Z' }];
    expect(isIssueResolved(flat, logs, 'withings')).toBe(true);
  });

  it('treats an info line at the same instant as not resolving the issue', () => {
    const logs = [{ module: 'withings', timestamp: withingsError.timestamp }];
    expect(isIssueResolved(withingsError, logs, 'withings')).toBe(false);
  });
});
