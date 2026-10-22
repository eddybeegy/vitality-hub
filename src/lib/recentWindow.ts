// The seven-day cards read arrays produced by `standardizeMetrics`, which sorts
// OLDEST-first, while every "last N days" label means the NEWEST end. Taking the
// wrong end is silent -- the card still renders a plausible number -- so the window
// lives here with a test rather than as a `.slice()` at each call site.
export interface DatedRow { date: string; [k: string]: any }

/** The newest `n` rows by `date`, newest first. Input order is irrelevant; the
 *  input array is not mutated. */
export function takeRecent<T extends DatedRow>(rows: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  return [...rows]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, n);
}
