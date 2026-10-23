// A target is either a positive goal or unset (null). The API still stores and
// returns 0 for "unset" (server.ts validates value as a finite number, and new
// users are seeded with 0 rows), so every value crossing the wire goes through
// these helpers: 0 / null / garbage in → null in the client, null out → 0.
export type TargetValue = number | null;

/** Normalise an API or input value to the client's nullable form. */
export function normaliseTargetValue(value: unknown): TargetValue {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True when the target holds a real goal that progress can be measured against. */
export function isTargetSet(value: unknown): value is number {
  return normaliseTargetValue(value) !== null;
}

/**
 * The rows that hold a real goal, for anything that reads a target *as* a goal.
 *
 * A 0 row is not a goal of zero, it is the UI's "no target set" placeholder:
 * new users are seeded with `steps`/`vo2_max` at 0, and clearing the input in
 * TargetsTab writes 0 back over the wire. The client has gone through
 * `isTargetSet` since those helpers were written; the server had not, so a
 * `water 0` or `sleep 0` row reached the AI prompt and the MCP tools as a
 * target the model could report progress against (Kieron, 2026-10-23: "Should
 * be no target if set to 0").
 *
 * The rows deliberately stay in the database. TargetsTab renders one editable
 * field per existing row, so deleting them would remove the user's only way to
 * set that target.
 */
export function onlySetTargets<T extends { value?: unknown }>(rows: readonly T[] | null | undefined): T[] {
  return (rows ?? []).filter((r) => isTargetSet(r?.value));
}

/** Wire form for POST /api/targets, which only accepts finite numbers. */
export function toApiTargetValue(value: TargetValue): number {
  return normaliseTargetValue(value) ?? 0;
}

/** "Steps" rather than "Steps ()" for unitless targets. */
export function formatTargetLabel(label: string, unit: string | null | undefined): string {
  return unit ? `${label} (${unit})` : label;
}
