// Client-side href builder for the Settings export buttons (residual of sweep item 54).
//
// `/api/export/metrics.csv` has accepted optional `startDate`/`endDate` since item 54,
// but nothing in the UI ever sent them, so the only reachable behaviour was the full
// export: 1.69M rows, ~110 MB, on every click. This exposes the range the server
// already understands.
//
// Deliberately NOT a default window. exportWindow.ts makes the argument and it still
// holds: these are backup buttons, and a silent default would hand the user a backup
// quietly missing their history. The range is opt-in and the empty state is "everything".
//
// Only metrics.csv is windowed — workouts.csv and all.json take no range server-side,
// so the control must not appear to apply to them.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A date input's value, normalised: '' and malformed both mean "no bound". */
const day = (v: string | null | undefined): string | null =>
  typeof v === 'string' && DAY.test(v) ? v : null;

/**
 * `/api/export/metrics.csv` with whichever of the two bounds are set. Both are whole
 * calendar days in the user's timezone and inclusive, which is the server's reading.
 * Out-of-order bounds are passed through unchanged — the server already rejects them
 * with a specific message, and duplicating that check here would let the two drift.
 */
export function metricsCsvHref(startDate?: string | null, endDate?: string | null): string {
  const qs = new URLSearchParams();
  const s = day(startDate);
  const e = day(endDate);
  if (s) qs.set('startDate', s);
  if (e) qs.set('endDate', e);
  const q = qs.toString();
  return q ? `/api/export/metrics.csv?${q}` : '/api/export/metrics.csv';
}

/** True when the user has narrowed the export, i.e. the button is no longer a full backup. */
export function isWindowed(startDate?: string | null, endDate?: string | null): boolean {
  return day(startDate) !== null || day(endDate) !== null;
}

/** Client-side mirror of the server's ordering rule, for an inline hint before the click. */
export function rangeOrderError(startDate?: string | null, endDate?: string | null): string | null {
  const s = day(startDate);
  const e = day(endDate);
  if (s && e && s > e) return `Start date ${s} is after end date ${e}.`;
  return null;
}
