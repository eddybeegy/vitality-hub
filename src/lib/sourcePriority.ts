// Source selection for one (local day, metric type): which ingest source's rows are
// shown when more than one source wrote that type that day. All three resolvers use
// it -- `filterMetricsByPriority` and the summary roll-up (`aggregateDailyMetrics`)
// in server.ts, and `aggregateMetricBuckets` here in src/lib -- so they cannot drift.
//
// The order for a plain type is unchanged from the three inline copies it replaces:
// the user's `metric_priorities` list for the type, then SOURCE_RANK, then row count
// (a more complete day wins), then name.
//
// Item 66: some types are halves of ONE reading. Blood pressure is stored as
// `blood_pressure_systolic` and `blood_pressure_diastolic`, and resolving each half on
// its own let a day pair a withings systolic with an apple_health diastolic (6 of 40
// live readings, 2025-12-09 to 2026-04-09) -- two plausible numbers from two devices
// shown as one reading. A paired type now resolves as a unit: one source for every
// member that day, preferring a source that has every half. When no source has the
// whole pair, the best source's halves are shown and the other device's are not --
// a half reading is honest, a mixed one is not.

/** Types that are halves of one reading, keyed by the group name. */
export const PAIRED_TYPES: Record<string, readonly string[]> = {
  blood_pressure: ['blood_pressure_systolic', 'blood_pressure_diastolic'],
};

const GROUP_OF: Record<string, string> = {};
for (const [group, members] of Object.entries(PAIRED_TYPES)) {
  for (const t of members) GROUP_OF[t] = group;
}

/** Rows per source for one type on one day. */
export type SourceCounts = Record<string, number>;

export interface SourcePolicy {
  /** users.metric_priorities, parsed. */
  priorities?: Record<string, string[]> | null;
  sourceRank: Record<string, number>;
  unknownSourceRank: number;
}

export interface SourceChoice {
  /** The source whose rows are kept, or null when this type has none to keep. */
  winner: string | null;
  /** Every source that had rows of this type, best first. */
  contenders: string[];
}

/**
 * The user's priority list for `type`. Item 67: Settings > Metric Source Priority
 * offers one entry per reading -- `blood_pressure` -- and writes the list under that
 * key, but the stored types are the halves, so an exact `priorities[type]` lookup
 * never found it and the setting had no effect. A paired type now reads its group's
 * key first (the one the UI writes), then a list stored under either half's own name,
 * so all halves of a reading always share one list. Unpaired types are an exact
 * lookup, as before.
 */
export function listFor(type: string, priorities: Record<string, string[]> | null | undefined): string[] | undefined {
  if (!priorities) return undefined;
  const group = GROUP_OF[type];
  const keys = group ? [group, ...PAIRED_TYPES[group]] : [type];
  return keys.map(k => priorities[k]).find(l => Array.isArray(l) && l.length > 0);
}

function userRanker(list: string[] | undefined) {
  return (src: string) => {
    if (!list || list.length === 0) return Infinity;
    const i = list.indexOf(src);
    return i === -1 ? Infinity : i;
  };
}

function rankSources(counts: SourceCounts, list: string[] | undefined, policy: SourcePolicy): string[] {
  const userRank = userRanker(list);
  return Object.keys(counts).sort((a, b) => {
    const ua = userRank(a), ub = userRank(b);
    if (ua !== ub) return ua - ub;
    const ra = policy.sourceRank[a] ?? policy.unknownSourceRank;
    const rb = policy.sourceRank[b] ?? policy.unknownSourceRank;
    if (ra !== rb) return ra - rb;
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return a.localeCompare(b);
  });
}

/**
 * Pick the source for `type` on one day. `countsFor(t)` returns that same day's
 * per-source row counts for any type `t` (undefined or empty when there are none); it
 * is only asked about `type` itself and, for a paired type, its sibling halves.
 */
export function chooseSource(
  type: string,
  countsFor: (t: string) => SourceCounts | undefined,
  policy: SourcePolicy
): SourceChoice {
  const own = countsFor(type) ?? {};
  const group = GROUP_OF[type];
  if (!group) {
    const contenders = rankSources(own, policy.priorities?.[type], policy);
    return { winner: contenders[0] ?? null, contenders };
  }

  const members = PAIRED_TYPES[group];
  const perMember = members.map(t => countsFor(t) ?? {});
  const combined: SourceCounts = {};
  for (const counts of perMember) {
    for (const [src, n] of Object.entries(counts)) combined[src] = (combined[src] ?? 0) + n;
  }
  const complete = (src: string) => perMember.every(counts => (counts[src] ?? 0) > 0);
  const list = listFor(type, policy.priorities);
  const byPolicy = rankSources(combined, list, policy);
  const joint = [...byPolicy.filter(complete), ...byPolicy.filter(s => !complete(s))];

  const contenders = joint.filter(src => (own[src] ?? 0) > 0);
  const winner = joint[0] !== undefined && (own[joint[0]] ?? 0) > 0 ? joint[0] : null;
  return { winner, contenders };
}
