/**
 * Turns the adaptive TDEE (item 73) into suggested daily targets, steered by the
 * user's **Focus** setting (item 98). This module only suggests; applying is
 * someone else's decision -- the Apply button on AdaptiveTdeeCard (#77), or, if the
 * user switches it on, the weekly sweep in src/lib/autoTargets.ts (item 97).
 *
 * Item 98, Kieron's call 2026-10-23: before this, the only driver was the **scale
 * weight** against the weight goal. His own data was the counter-example -- trend
 * weight 74.55 kg against a 74 kg goal is inside the maintain band, so the
 * suggestion collapsed to raw TDEE, while 21.5% body fat against a 20% target and a
 * muscle-mass target 3 kg away were invisible to it. Someone on Body Recomposition
 * got maintenance calories and a protein number derived from nothing they had asked
 * for. The Focus setting named the goal all along; it just drove two LLM prompt
 * strings and no arithmetic.
 *
 * So each focus picks its own driver:
 *
 * | Focus         | Calories                                   | Protein           | Extra     |
 * |---------------|--------------------------------------------|-------------------|-----------|
 * | General       | weight goal (as before)                    | 2.2 g/kg lean     | --        |
 * | Fat Loss      | the **fat-mass** gap, not the scale gap    | 2.2 g/kg lean     | --        |
 * | Muscle Gain   | the muscle-mass gap                        | 2.2 g/kg lean     | --        |
 * | Recomposition | never a surplus: -250 while fat is high    | 2.4 g/kg lean     | --        |
 * | Strength      | maintenance                                | 2.2 g/kg lean     | --        |
 * | Endurance     | maintenance                                | 1.8 g/kg weight   | carbs     |
 * | Maintain      | maintenance                                | 1.8 g/kg weight   | --        |
 * | Heart Health  | maintenance                                | 1.8 g/kg weight   | fibre     |
 * | Injury        | maintenance, never a deficit               | 2.2 g/kg lean     | --        |
 *
 * Three rules hold across all of them:
 *
 * - **A missing driver falls back to the weight goal and says so**, in `fallback`.
 *   Fat Loss with no body-fat reading cannot compute a fat gap; refusing outright
 *   would leave the card blank when the old scale rule would still have been
 *   useful, so it uses the scale rule and names the substitution. Nothing is ever
 *   guessed: the only numbers that appear are ones a stated rule produced.
 * - **Protein is a floor, never a cut, on the lean-mass focuses.** The first live
 *   rehearsal of the item-97 sweep wanted to move protein 160 g -> 130 g: the
 *   formula is generic, the stored 160 was deliberate. On a focus whose whole point
 *   is holding muscle, a formula that lowers protein is wrong on its face. Where the
 *   formula is below an existing target we keep the target and set `proteinFloored`.
 *   This also ends the permanent weekly protein refusal the cap was producing.
 *   Not applied to the body-weight focuses, where a lower protein number is the
 *   intended consequence of choosing that focus.
 * - **`carbs` and `fiber` are card-only.** The weekly sweep writes calories and
 *   protein, which are the two with movement caps; there is no cap for carbs or
 *   fibre and inventing one silently is worse than leaving them to the button.
 */
import { KCAL_PER_KG } from './tdee';

export const MAINTAIN_BAND_KG = 0.5;
export const MAX_DEFICIT = 1000;
export const MIN_CALORIES = 1500;

/**
 * Body-composition gaps use the same 0.5 kg band as the scale. Fat and lean
 * readings are noisier than a scale weight, but the band's job is to stop a target
 * flapping around the goal, and a wider one would park a real 1 kg gap at
 * maintenance -- the exact failure this item exists to fix.
 */
export const BODY_COMP_BAND_KG = 0.5;

export const LOSS_RATE_PCT = 0.005;
export const LOSS_RATE_MAX_KG = 0.5;
export const GAIN_RATE_PCT = 0.0025;
export const GAIN_RATE_MAX_KG = 0.25;
/** Recomposition's deficit: small enough to keep training quality and lean mass. */
export const RECOMP_DEFICIT_KCAL = 250;

export const PROTEIN_G_PER_KG_LEAN = 2.2;
export const PROTEIN_G_PER_KG_LEAN_RECOMP = 2.4;
export const PROTEIN_G_PER_KG_WEIGHT = 1.8;
export const ENDURANCE_CARB_G_PER_KG = 5;
export const HEART_FIBER_G = 30;

export type Focus =
  | 'general' | 'fat_loss' | 'muscle_gain' | 'recomp' | 'endurance'
  | 'strength' | 'maintain' | 'heart' | 'injury';

/** The stored column value for each focus, and what Settings shows. */
export const FOCUS_LABELS: Record<Focus, string> = {
  general: 'General Health',
  fat_loss: 'Fat Loss',
  muscle_gain: 'Muscle Gain',
  recomp: 'Body Recomposition',
  strength: 'Strength',
  endurance: 'Endurance',
  maintain: 'Maintain Weight',
  heart: 'Heart Health',
  injury: 'Injury Recovery',
};

export const FOCUS_ORDER: Focus[] = [
  'general', 'fat_loss', 'muscle_gain', 'recomp', 'strength',
  'endurance', 'maintain', 'heart', 'injury',
];

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Words that mean one of the nine. `users.focus` is free text (settingsUpdate
 * validates it as `nonEmptyText(200)`, not an enum) and it is backfilled from the
 * old `ai_focus`, so a value that never came from the select has to land somewhere
 * deliberate. "Longevity" maps to Heart Health rather than becoming a tenth option:
 * it would have produced the same three numbers, and an option that changes nothing
 * reads as cover.
 */
const FOCUS_ALIASES: Record<string, Focus> = {
  general: 'general', health: 'general', wellbeing: 'general', balanced: 'general',
  fatloss: 'fat_loss', weightloss: 'fat_loss', loseweight: 'fat_loss', cut: 'fat_loss', cutting: 'fat_loss', leanout: 'fat_loss',
  musclegain: 'muscle_gain', buildmuscle: 'muscle_gain', hypertrophy: 'muscle_gain', bulk: 'muscle_gain', bulking: 'muscle_gain', gainweight: 'muscle_gain',
  recomp: 'recomp', recomposition: 'recomp', bodyrecomp: 'recomp', bodyrecomposition: 'recomp',
  strength: 'strength', powerlifting: 'strength', getstronger: 'strength', liftheavier: 'strength',
  endurance: 'endurance', cardio: 'endurance', running: 'endurance', marathon: 'endurance', cycling: 'endurance', triathlon: 'endurance',
  maintain: 'maintain', maintenance: 'maintain', maintainweight: 'maintain', holdweight: 'maintain',
  heart: 'heart', hearthealth: 'heart', cardiovascular: 'heart', cardiometabolic: 'heart', bloodpressure: 'heart', cholesterol: 'heart', longevity: 'heart', healthspan: 'heart',
  injury: 'injury', injuryrecovery: 'injury', rehab: 'injury', rehabilitation: 'injury', recovery: 'injury', returnfrominjury: 'injury',
};

/** Unrecognised text is General Health -- the rule that was in force before focus drove anything. */
export function normaliseFocus(raw?: string | null): Focus {
  if (!raw) return 'general';
  const k = key(raw);
  for (const f of FOCUS_ORDER) if (key(FOCUS_LABELS[f]) === k) return f;
  return FOCUS_ALIASES[k] ?? 'general';
}

/** Which rule sets protein, and therefore whether the floor applies. */
export const PROTEIN_RULE: Record<Focus, 'lean' | 'body_weight'> = {
  general: 'lean',
  fat_loss: 'lean',
  muscle_gain: 'lean',
  recomp: 'lean',
  strength: 'lean',
  injury: 'lean',
  endurance: 'body_weight',
  maintain: 'body_weight',
  heart: 'body_weight',
};

export type GoalDirection = 'lose' | 'gain' | 'maintain' | 'recomp';

export interface TargetSuggestion {
  focus: Focus;
  focusLabel: string;
  direction: GoalDirection;
  /** kg per week, negative when losing. */
  ratePerWeek: number;
  calories: number;
  protein: number;
  proteinBasis: 'lean_mass' | 'body_weight';
  /** The g/kg the formula used, against whichever basis `proteinBasis` names. */
  proteinPerKg: number;
  /** True when an existing, higher protein target was kept instead of cut. */
  proteinFloored: boolean;
  /** Focus-specific extras, card-only -- the weekly sweep never writes these. */
  carbs?: number;
  fiber?: number;
  /** One line: which focus, and what drove the calorie number. */
  why: string;
  /** Set when this focus's own driver was missing and the weight goal was used instead. */
  fallback?: string;
}

export interface SuggestTargetsInput {
  tdee: number;
  trendWeightKg: number;
  /** The raw `users.focus` value; anything unrecognised is General Health. */
  focus?: string | null;
  goalWeightKg?: number | null;
  /** Latest lean_body_mass reading, for protein. */
  leanMassKg?: number | null;
  /** Latest body-fat percentage and its target, for the fat-mass gap. */
  bodyFatPct?: number | null;
  bodyFatTargetPct?: number | null;
  /**
   * Latest muscle_mass reading and its target. Deliberately the muscle_mass pair
   * and not lean_body_mass: `muscle_mass` is the only one of the two that is a
   * settable target type, so this is the only comparison where the reading and the
   * target measure the same thing. Protein still uses lean body mass, which is what
   * 2.2 g/kg is defined against.
   */
  muscleMassKg?: number | null;
  muscleMassTargetKg?: number | null;
  /** The stored protein target, so the formula can floor rather than cut it. */
  currentProteinG?: number | null;
}

const round = (x: number, step: number) => Math.round(x / step) * step;
const pos = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
const kg = (v: number) => v.toFixed(1).replace(/\.0$/, '');

/**
 * Fat to lose, in kg, to reach a body-fat target **with lean mass held**: at a
 * constant lean mass L, a target of p% implies a weight of L / (1 - p), so the gap
 * is the scale distance to that weight -- and all of it is fat. Negative when
 * already at or below the target.
 *
 * This is the number the scale gap cannot see. Kieron at 74.55 kg and 21.53% has
 * 58.5 kg of lean mass, so 20% implies 73.1 kg: a 1.4 kg fat gap, where the scale
 * gap to his 74 kg goal is 0.55 kg and rounds into the maintain band.
 */
export function fatGapKg(weightKg: number, bodyFatPct: number, targetPct: number): number | null {
  if (!(weightKg > 0)) return null;
  if (!(bodyFatPct > 0 && bodyFatPct < 100)) return null;
  if (!(targetPct > 0 && targetPct < 100)) return null;
  const lean = weightKg * (1 - bodyFatPct / 100);
  return weightKg - lean / (1 - targetPct / 100);
}

interface CaloriePart {
  direction: GoalDirection;
  ratePerWeek: number;
  why: string;
  fallback?: string;
}

export function suggestTargets(input: SuggestTargetsInput): TargetSuggestion {
  const { tdee, trendWeightKg: w } = input;
  const focus = normaliseFocus(input.focus);
  const goal = pos(input.goalWeightKg);
  const bodyFat = pos(input.bodyFatPct);
  const bodyFatTarget = pos(input.bodyFatTargetPct);

  const lossRate = () => -Math.min(LOSS_RATE_MAX_KG, LOSS_RATE_PCT * w);
  const gainRate = () => Math.min(GAIN_RATE_MAX_KG, GAIN_RATE_PCT * w);

  /** The original rule: chase the scale weight. General Health, and every fallback. */
  const scaleRule = (): CaloriePart => {
    if (goal == null) return { direction: 'maintain', ratePerWeek: 0, why: 'no weight goal set, so this maintains' };
    const gap = w - goal;
    if (Math.abs(gap) < MAINTAIN_BAND_KG) {
      return { direction: 'maintain', ratePerWeek: 0, why: `you are at your ${kg(goal)} kg weight goal, so this maintains` };
    }
    const rate = gap > 0 ? lossRate() : gainRate();
    return {
      direction: gap > 0 ? 'lose' : 'gain',
      ratePerWeek: rate,
      why: `${gap > 0 ? 'losing' : 'gaining'} ${Math.abs(rate).toFixed(2)} kg/wk towards your ${kg(goal)} kg weight goal`,
    };
  };

  /** Why the scale rule is standing in. Named so the card can say it out loud. */
  const noFatData = (): string =>
    bodyFat == null ? 'no body-fat reading, so this follows your weight goal instead' : 'no body-fat target set, so this follows your weight goal instead';

  const fatLossRule = (): CaloriePart => {
    const gap = bodyFat != null && bodyFatTarget != null ? fatGapKg(w, bodyFat, bodyFatTarget) : null;
    if (gap == null) return { ...scaleRule(), fallback: noFatData() };
    if (gap <= BODY_COMP_BAND_KG) {
      return { direction: 'maintain', ratePerWeek: 0, why: `body fat is at your ${kg(bodyFatTarget!)}% target, so this maintains` };
    }
    const rate = lossRate();
    return {
      direction: 'lose',
      ratePerWeek: rate,
      why: `${kg(gap)} kg of fat above your ${kg(bodyFatTarget!)}% target, losing ${Math.abs(rate).toFixed(2)} kg/wk`,
    };
  };

  const muscleGap = (): number | null => {
    const now = pos(input.muscleMassKg);
    const target = pos(input.muscleMassTargetKg);
    return now != null && target != null ? target - now : null;
  };

  const muscleGainRule = (): CaloriePart => {
    const gap = muscleGap();
    if (gap == null) {
      const why = pos(input.muscleMassKg) == null
        ? 'no muscle-mass reading, so this follows your weight goal instead'
        : 'no muscle-mass target set, so this follows your weight goal instead';
      return { ...scaleRule(), fallback: why };
    }
    const target = pos(input.muscleMassTargetKg)!;
    if (gap <= BODY_COMP_BAND_KG) {
      return { direction: 'maintain', ratePerWeek: 0, why: `muscle mass is at your ${kg(target)} kg target, so this maintains` };
    }
    const rate = gainRate();
    return {
      direction: 'gain',
      ratePerWeek: rate,
      why: `${kg(gap)} kg under your ${kg(target)} kg muscle-mass target, gaining ${rate.toFixed(2)} kg/wk`,
    };
  };

  /**
   * Recomposition: lose the fat, keep (or build) the muscle. Never a surplus --
   * that is Muscle Gain, and choosing Recomposition is choosing not to do it.
   */
  const recompRule = (): CaloriePart => {
    const gap = bodyFat != null && bodyFatTarget != null ? fatGapKg(w, bodyFat, bodyFatTarget) : null;
    if (gap == null) {
      const scale = scaleRule();
      const safe: CaloriePart = scale.direction === 'gain'
        ? { direction: 'maintain', ratePerWeek: 0, why: 'recomposition never eats in a surplus, so this maintains' }
        : scale;
      return { ...safe, fallback: noFatData() };
    }
    if (gap > BODY_COMP_BAND_KG) {
      return {
        direction: 'recomp',
        ratePerWeek: -(RECOMP_DEFICIT_KCAL * 7) / KCAL_PER_KG,
        why: `${kg(gap)} kg of fat above your ${kg(bodyFatTarget!)}% target: a ${RECOMP_DEFICIT_KCAL} kcal deficit, kept small to protect muscle`,
      };
    }
    const mGap = muscleGap();
    if (mGap != null && mGap > BODY_COMP_BAND_KG) {
      return {
        direction: 'recomp',
        ratePerWeek: 0,
        why: `body fat is at your ${kg(bodyFatTarget!)}% target but muscle mass is ${kg(mGap)} kg short: maintenance calories, to build without regaining fat`,
      };
    }
    return { direction: 'maintain', ratePerWeek: 0, why: `body fat is at your ${kg(bodyFatTarget!)}% target, so this maintains` };
  };

  const flat = (why: string): CaloriePart => ({ direction: 'maintain', ratePerWeek: 0, why });

  const part: CaloriePart =
      focus === 'fat_loss' ? fatLossRule()
    : focus === 'muscle_gain' ? muscleGainRule()
    : focus === 'recomp' ? recompRule()
    : focus === 'strength' ? flat('fuelling a strength block: calories at maintenance, no deficit')
    : focus === 'endurance' ? flat('fuelling endurance training: calories at maintenance, no deficit')
    : focus === 'maintain' ? flat('holding your current weight')
    : focus === 'heart' ? flat('calories at maintenance; this focus moves fibre, not energy')
    : focus === 'injury' ? flat('healing is not the time for a deficit: calories at maintenance')
    : scaleRule();

  const delta = Math.max(-MAX_DEFICIT, (part.ratePerWeek * KCAL_PER_KG) / 7);
  const calories = Math.max(MIN_CALORIES, round(tdee + delta, 50));

  // A lean reading at or above the scale weight is not a lean reading.
  const lean = input.leanMassKg && input.leanMassKg > 0 && input.leanMassKg < w ? input.leanMassKg : null;
  const useLean = PROTEIN_RULE[focus] === 'lean' && lean != null;
  const perKg = useLean
    ? (focus === 'recomp' ? PROTEIN_G_PER_KG_LEAN_RECOMP : PROTEIN_G_PER_KG_LEAN)
    : PROTEIN_G_PER_KG_WEIGHT;
  const formula = round(perKg * (useLean ? lean! : w), 5);

  const currentProtein = pos(input.currentProteinG);
  const floorApplies = PROTEIN_RULE[focus] === 'lean' && currentProtein != null && currentProtein > formula;
  const protein = floorApplies ? Math.round(currentProtein!) : formula;

  return {
    focus,
    focusLabel: FOCUS_LABELS[focus],
    direction: part.direction,
    ratePerWeek: part.ratePerWeek,
    calories,
    protein,
    proteinBasis: useLean ? 'lean_mass' : 'body_weight',
    proteinPerKg: perKg,
    proteinFloored: floorApplies,
    ...(focus === 'endurance' ? { carbs: round(ENDURANCE_CARB_G_PER_KG * w, 5) } : {}),
    ...(focus === 'heart' ? { fiber: HEART_FIBER_G } : {}),
    why: part.why,
    ...(part.fallback ? { fallback: part.fallback } : {}),
  };
}
