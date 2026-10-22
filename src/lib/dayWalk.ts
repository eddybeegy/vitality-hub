// Calendar-day arithmetic for the streak widgets. The three inline copies this
// replaces anchored the cursor at UTC midnight (`new Date('2026-10-26')`) and read it
// back with `toISOString()`, but stepped it with the LOCAL-time `setDate`. In a zone
// with DST that combination loses or repeats a day at each transition: stepping back
// from 2026-10-26 in Europe/London produced local 2026-10-25 00:00 BST = 23:00Z on the
// 24th, so `toDateStr` returned '2026-10-24' and Sunday 25 October could never be part
// of a streak. Spring is the mirror image -- 2027-03-28 + 1 day came back as
// '2027-03-28' -- which broke contiguity in the longest-streak walk.
//
// Everything here is UTC-only, so a 'YYYY-MM-DD' in and a 'YYYY-MM-DD' out are the same
// calendar day the user sees. The day STRINGS are already resolved in the user's zone
// by `getLocalDateString`; this module must not reinterpret them.

/** The UTC calendar day of `d`, as 'YYYY-MM-DD'. */
export const toDateStr = (d: Date): string => d.toISOString().split('T')[0];

/** `d` shifted by `n` calendar days, stepping in UTC so DST cannot absorb the step. */
export const addDays = (d: Date, n: number): Date => {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + n);
  return nd;
};
