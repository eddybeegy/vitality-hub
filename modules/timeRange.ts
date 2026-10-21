// Bounds of one UTC calendar day, as ISO strings with an explicit `Z`.
//
// The sync modules used to replace a day's rows with
// `CAST(timestamp AS TEXT) LIKE 'YYYY-MM-DD%'`. That only selects the UTC day while
// the column is naive and holds UTC; once metrics/workouts.timestamp are timestamptz
// (sweep item 13) the text renders in the Postgres session zone (Europe/London), the
// prefix selects the London day instead, and a re-sync stops deleting the rows it is
// about to re-insert. A `>= start AND < end` range on these bounds selects the same
// UTC day on the naive column, on timestamptz, and on SQLite's ISO text.
//
// Returns null for anything that is not a plain YYYY-MM-DD, so a caller skips it (the
// old LIKE simply matched nothing).
export function utcDayRange(day: string): [string, string] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  return [new Date(start).toISOString(), new Date(start + 86400000).toISOString()];
}
