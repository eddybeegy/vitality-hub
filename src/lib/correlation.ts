/**
 * Correlation explorer (roadmap: "Correlation explorer").
 *
 * Pairs two daily series, optionally with the second one shifted a day later
 * (caffeine today against sleep tonight, training today against HRV tomorrow),
 * and reports Pearson's r with a plain-English strength. Days missing from
 * either series are dropped from the pairs, never filled.
 *
 * Day keys are bare YYYY-MM-DD in the user's zone; the lag uses addDays().
 */
import { addDays } from './dayTags';

export const MIN_PAIRS = 10;

export interface DailyPoint { day: string; value: number }
export interface Pair { day: string; x: number; y: number }

export interface CorrelationResult {
  pairs: Pair[];
  r: number;
  n: number;
  /** Least-squares slope of y on x. */
  slope: number;
  strength: 'none' | 'weak' | 'moderate' | 'strong';
  direction: 'positive' | 'negative';
}

/** x on day d paired with y on day d + lag. */
export function pairSeries(xs: DailyPoint[], ys: DailyPoint[], lagDays = 0): Pair[] {
  const yByDay = new Map(ys.map(p => [p.day, p.value]));
  const out: Pair[] = [];
  for (const p of xs) {
    const y = yByDay.get(addDays(p.day, lagDays));
    if (y === undefined || !Number.isFinite(y) || !Number.isFinite(p.value)) continue;
    out.push({ day: p.day, x: p.value, y });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export function strengthOf(r: number): CorrelationResult['strength'] {
  const a = Math.abs(r);
  if (a < 0.1) return 'none';
  if (a < 0.3) return 'weak';
  if (a < 0.5) return 'moderate';
  return 'strong';
}

/** null with fewer than MIN_PAIRS pairs or no variation in either series. */
export function correlate(pairs: Pair[]): CorrelationResult | null {
  const n = pairs.length;
  if (n < MIN_PAIRS) return null;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pairs) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  return { pairs, r, n, slope: sxy / sxx, strength: strengthOf(r), direction: r >= 0 ? 'positive' : 'negative' };
}

/** One sentence for the result, e.g. "Moderate negative link (r = −0.42, 63 days)". */
export function describeCorrelation(c: CorrelationResult): string {
  const r = `${c.r < 0 ? '−' : ''}${Math.abs(c.r).toFixed(2)}`;
  if (c.strength === 'none') return `No clear link (r = ${r}, ${c.n} days)`;
  const s = c.strength[0].toUpperCase() + c.strength.slice(1);
  return `${s} ${c.direction} link (r = ${r}, ${c.n} days)`;
}
