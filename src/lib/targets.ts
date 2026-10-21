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

/** Wire form for POST /api/targets, which only accepts finite numbers. */
export function toApiTargetValue(value: TargetValue): number {
  return normaliseTargetValue(value) ?? 0;
}

/** "Steps" rather than "Steps ()" for unitless targets. */
export function formatTargetLabel(label: string, unit: string | null | undefined): string {
  return unit ? `${label} (${unit})` : label;
}
