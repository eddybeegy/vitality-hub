// What the Dashboard's "Refresh Data" button syncs.
//
// POST /api/data/refresh used to be `clearUserCache` + `res.json`: no sync, no log row,
// so the button re-read the same rows and nothing could tell a click had happened. It
// now runs a real sync of the user's enabled *pull* modules -- the ones that fetch from
// an upstream API on demand. Push-only modules are skipped by design: apple_health and
// apple_workouts are fed by Health Auto Export POSTing to /health-export, and
// myfitnesspal/nutracheck need an uploaded file, so calling their sync() with no body
// only logs "No data provided" errors (which then sit in syncIssues for 24 h).
// strava's sync() is still a placeholder, so it is left out too.
//
// Pure functions, unit-tested directly.

/** Modules whose sync() pulls from an upstream API with no request body. */
export const PULL_MODULE_IDS = ['withings', 'cronometer', 'hevy'] as const;

export interface RefreshPlan {
  sync: string[];
  skipped: { id: string; reason: 'disabled' | 'not-pull' }[];
}

/**
 * Which modules a refresh syncs, in registry order. `enabled` follows the scheduler and
 * GET /api/modules: a module is on unless its config says `enabled: false`.
 */
export function planRefresh(moduleIds: readonly string[], modulesConfig: Record<string, any> | null | undefined): RefreshPlan {
  const plan: RefreshPlan = { sync: [], skipped: [] };
  for (const id of moduleIds) {
    if (modulesConfig?.[id]?.enabled === false) plan.skipped.push({ id, reason: 'disabled' });
    else if (!(PULL_MODULE_IDS as readonly string[]).includes(id)) plan.skipped.push({ id, reason: 'not-pull' });
    else plan.sync.push(id);
  }
  return plan;
}

export interface RefreshModuleResult {
  id: string;
  ok: boolean;
  message?: string;
}

/** The `logs` row written when a refresh starts (source 'refresh'). */
export function refreshStartMessage(plan: RefreshPlan): string {
  const skipped = plan.skipped.length
    ? ` (skipped: ${plan.skipped.map(s => `${s.id} ${s.reason}`).join(', ')})`
    : '';
  return plan.sync.length
    ? `Refresh Data: sync started for ${plan.sync.join(', ')}${skipped}`
    : `Refresh Data: nothing to sync${skipped}`;
}

/** The `logs` row written when a refresh finishes (source 'refresh'). */
export function refreshFinishMessage(results: RefreshModuleResult[], elapsedMs: number): string {
  const ok = results.filter(r => r.ok).length;
  const parts = results.map(r => (r.ok ? `${r.id} ok` : `${r.id} failed${r.message ? `: ${r.message}` : ''}`));
  return `Refresh Data: finished ${ok}/${results.length} ok in ${Math.round(elapsedMs)} ms — ${parts.join('; ')}`;
}
