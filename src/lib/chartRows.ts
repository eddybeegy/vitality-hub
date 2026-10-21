// Item 58: turn a chart endpoint's response into rows, or a reason it has none.
// A 5xx used to reach the chart as its `{"error": ...}` object, and HealthChart's
// `.filter` on it threw during render -- taking Dashboard/Activity down to the error
// boundary. Every deploy produces ~15 s of genuine 502s, so this path is routine.
// A 200 that is not JSON (the SPA catch-all's index.html, item 51) or not an array is
// also an error, not "no data": the user should be told the chart failed to load.

// One flat shape rather than a discriminated union: tsconfig is not `strict`, so
// narrowing on `ok` does not hold there.
export interface ChartRowsResult {
  rows: any[];
  /** null when the rows are good; otherwise why there are none. */
  error: string | null;
}

export async function readChartRows(response: Response): Promise<ChartRowsResult> {
  if (!response.ok) {
    return { rows: [], error: `HTTP ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { rows: [], error: 'response was not JSON' };
  }
  if (!Array.isArray(body)) {
    return { rows: [], error: 'response was not a list of rows' };
  }
  return { rows: body, error: null };
}

/** For data handed in by a parent: anything that is not an array is no rows. */
export function asRows(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}
