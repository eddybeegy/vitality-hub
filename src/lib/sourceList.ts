// Sweep item 68: `healthsync` writes to `metrics` but had no entry in
// `AVAILABLE_SOURCES`, so it could not be ranked from the UI at all. Adding it to the
// list is only half the fix -- the priority editor renders the STORED array for a
// metric, and an array saved before today does not contain the new id, so a source
// added to the constant stays invisible on every metric the user has already saved.
// `withAllSources` closes that: stored order is authoritative, anything missing is
// appended in catalogue order.

/** `stored` (order preserved) followed by every catalogue id it does not already
 *  contain, in catalogue order. Unknown ids in `stored` are kept -- a source that has
 *  been retired from the catalogue should not silently lose its rank. */
export function withAllSources(stored: readonly string[], catalogue: readonly string[]): string[] {
  const seen = new Set(stored);
  return [...stored, ...catalogue.filter(id => !seen.has(id))];
}
