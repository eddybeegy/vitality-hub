// Resolving "09:30 on 2026-10-25 in Europe/London" to an instant. The server.ts
// implementation this replaces took the wall-clock string, rendered it with
// `toLocaleString` for the target zone and for UTC, and re-parsed BOTH with
// `new Date(...)` -- which parses a bare local string in the PROCESS zone. The process
// offset cancels in the subtraction for ordinary times, so it mostly worked, but it is
// not sound: on a DST transition day the two re-parsed strings can land on opposite
// sides of the process zone's own transition, and the untried fallback path
// (`new Date(parts)`, no suffix) was plainly process-local. The container runs
// Europe/London today, so the bug was latent, not visible -- exactly the kind that
// surfaces when someone changes TZ in the compose file.
//
// `tzOffsetMs` reads the offset out of Intl instead, so nothing depends on the process
// zone. `zonedTimeToInstant` then does the standard two-pass correction: the offset at
// the naive instant may not be the offset that actually applies at the resolved one.

/** Offset of `timeZone` from UTC at instant `at`, in ms (positive east of UTC). */
export function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
  // Some ICU versions render midnight as hour '24'.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second)
  );
  return asIfUtc - at.getTime();
}

/**
 * The instant at which the wall clock in `timeZone` reads `dateStr` `timeStr`
 * ('YYYY-MM-DD', 'HH:MM'). Spring-forward times that do not exist resolve to the
 * instant the clock jumps to; autumn times that occur twice resolve to the first.
 * Throws nothing -- an unusable `timeZone` falls back to treating the input as UTC,
 * which is at least deterministic.
 */
export function zonedTimeToInstant(timeZone: string, dateStr: string, timeStr: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  if (isNaN(naive.getTime())) return naive;
  try {
    const firstPass = new Date(naive.getTime() - tzOffsetMs(timeZone, naive));
    const settled = tzOffsetMs(timeZone, firstPass);
    const secondPass = new Date(naive.getTime() - settled);
    return secondPass;
  } catch {
    return naive;
  }
}
