import { AI_MODELS } from '../constants';

async function callBackendAI(prompt: string, model: string, provider: string = "gemini", maxTokens: number = 8192) {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, provider, maxTokens })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'AI generation failed');
  }
  
  const data = await response.json();
  return { text: data.text, provider: data.provider, model: data.model };
}

async function callAIWithFallback(prompt: string, preferredModel: string, provider: string = "gemini", maxTokens?: number) {
  const availableModels = AI_MODELS[provider] || [];
  
  // Use provider-specific maxTokens if not explicitly provided
  const providerConfig = (window as any).__AI_PROVIDERS?.[provider];
  const finalMaxTokens = maxTokens || providerConfig?.maxTokens || 8192;
  
  try {
    return await callBackendAI(prompt, preferredModel, provider, finalMaxTokens);
  } catch (error) {
    console.warn(`Primary model ${preferredModel} failed, attempting fallback for provider ${provider}:`, error);
    
    for (const fallbackModel of availableModels) {
      if (fallbackModel !== preferredModel) {
        console.warn(`Attempting fallback to ${fallbackModel}...`);
        try {
          return await callBackendAI(prompt, fallbackModel, provider, finalMaxTokens);
        } catch (fallbackError) {
          console.warn(`Fallback model ${fallbackModel} also failed.`);
          // Continue to next fallback
        }
      }
    }
    throw error;
  }
}

function aggregateMetrics(metrics: any[], timezone: string = 'UTC') {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  const detailMetrics = metrics.filter(m => new Date(m.timestamp) >= thirtyDaysAgo);
  const dailyMetrics = metrics.filter(m => new Date(m.timestamp) >= ninetyDaysAgo && new Date(m.timestamp) < thirtyDaysAgo);
  const monthlyMetrics = metrics.filter(m => new Date(m.timestamp) >= sixMonthsAgo && new Date(m.timestamp) < ninetyDaysAgo);

  const SUMMED_METRICS = [
    'steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time', 
    'sleep', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 
    'time_in_daylight', 'walking_running_distance', 'calories_in', 'protein', 'carbs', 
    'fat', 'fiber', 'sugar', 'sodium', 'iron', 'calcium', 'vitamin_c', 'vitamin_a', 
    'vitamin_d', 'vitamin_e', 'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 
    'potassium', 'zinc', 'water', 'biotin', 'caffeine', 'cholesterol', 'copper', 
    'folate', 'niacin', 'iodine', 'fat_monounsaturated', 'fat_polyunsaturated', 
    'fat_saturated', 'riboflavin', 'phosphorus', 'manganese', 'thiamin', 'selenium', 
    'pantothenic_acid', 'vo2max'
  ];

  const getLocalDate = (ts: string) => {
    try {
      const d = new Date(ts);
      return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (e) {
      return ts.split('T')[0];
    }
  };

  // Aggregate detailMetrics by day to reduce token count
  const detailGrouped: Record<string, any> = {};
  detailMetrics.forEach(m => {
    const date = getLocalDate(m.timestamp);
    if (!detailGrouped[date]) detailGrouped[date] = {};
    if (!detailGrouped[date][m.type]) detailGrouped[date][m.type] = { sum: 0, count: 0 };
    detailGrouped[date][m.type].sum += Number(m.value);
    detailGrouped[date][m.type].count += 1;
  });

  const recentAggregated = Object.entries(detailGrouped).map(([date, types]) => {
    const aggregated: any = { date };
    Object.entries(types as any).forEach(([type, val]: [string, any]) => {
      const value = SUMMED_METRICS.includes(type) ? val.sum : val.sum / val.count;
      if (value !== 0) aggregated[type] = Number(value.toFixed(2));
    });
    return aggregated;
  }).sort((a, b) => b.date.localeCompare(a.date));

  // Aggregate dailyMetrics by day
  const historicalGrouped: Record<string, any> = {};
  dailyMetrics.forEach(m => {
    const date = getLocalDate(m.timestamp);
    if (!historicalGrouped[date]) historicalGrouped[date] = {};
    if (!historicalGrouped[date][m.type]) historicalGrouped[date][m.type] = { sum: 0, count: 0 };
    historicalGrouped[date][m.type].sum += Number(m.value);
    historicalGrouped[date][m.type].count += 1;
  });

  const historicalAggregated = Object.entries(historicalGrouped).map(([date, types]) => {
    const aggregated: any = { date };
    Object.entries(types as any).forEach(([type, val]: [string, any]) => {
      const value = SUMMED_METRICS.includes(type) ? val.sum : val.sum / val.count;
      if (value !== 0) aggregated[type] = Number(value.toFixed(2));
    });
    return aggregated;
  }).sort((a, b) => b.date.localeCompare(a.date));

  // Aggregate monthlyMetrics by month
  const monthlyGrouped: Record<string, any> = {};
  monthlyMetrics.forEach(m => {
    const month = m.timestamp.substring(0, 7);
    if (!monthlyGrouped[month]) monthlyGrouped[month] = {};
    if (!monthlyGrouped[month][m.type]) monthlyGrouped[month][m.type] = { sum: 0, count: 0 };
    monthlyGrouped[month][m.type].sum += Number(m.value);
    monthlyGrouped[month][m.type].count += 1;
  });

  const monthlyAggregated = Object.entries(monthlyGrouped).map(([month, types]) => {
    const aggregated: any = { month };
    Object.entries(types as any).forEach(([type, val]: [string, any]) => {
      const value = SUMMED_METRICS.includes(type) ? val.sum : val.sum / val.count;
      if (value !== 0) aggregated[type] = Number(value.toFixed(2));
    });
    return aggregated;
  }).sort((a, b) => b.month.localeCompare(a.month));

  return { recent: recentAggregated, historical: historicalAggregated, monthly: monthlyAggregated };
}

export async function getSmartTargetAdjustments(data: CombinedReviewData & { readiness: any }, model: string = "gemini-3-pro-preview", provider: string = "gemini") {
  const aggregatedMetrics = aggregateMetrics(data.metrics, data.timezone);
  const sortedTargets = sortTargets(data.targets || []);
  const readiness = data.readiness;
  
  const prompt = `
    Expert high-performance coach: Suggest "Smart Target Adjustments" for today based on readiness and recent performance.

    READINESS SCORE: ${readiness.score}/100
    RECOVERY COMPONENTS: ${readiness.components.map((c: any) => `${c.name}: ${c.score.toFixed(0)} (${c.label})`).join(', ')}
    COACH RECOMMENDATION: ${readiness.recommendation}

    USER PROFILE: ${data.age}y ${data.gender}. Focus: ${data.ai_focus || 'Health'}. Meds: ${Array.isArray(data.medications) && data.medications.length ? data.medications.map(m => m.name).join(', ') : 'None'}
    
    CURRENT TARGETS:
    ${sortedTargets.filter(t => t.value > 0).map(t => `- ${t.label} (${t.type}): ${t.value} ${t.unit}`).join('\n')}

    RECENT PERFORMANCE (Last 7 days):
    - Metrics: ${JSON.stringify(aggregatedMetrics.recent.slice(0, 7))}
    - Workouts: ${JSON.stringify(formatWorkouts(data.workouts.slice(0, 5), data.exercises, data.sets))}

    GOAL: Provide 2-3 temporary "Smart Adjustments" for TODAY ONLY to optimize recovery or capitalize on high readiness.
    If readiness is LOW (<50), prioritize rest: decrease calories (if cut), increase protein, decrease workout volume/intensity.
    If readiness is HIGH (>80), suggest pushing harder: increase volume, extra protein, ensure caloric surplus/maintenance.

    FORMAT:
    Return a concise markdown list of suggestions with specific reasoning and the EXACT values to adjust to.
    
    Then, end with a JSON block explicitly defining the temporary targets:
    ${'```'}json
    {
      "type": "target_adjustments",
      "adjustments": [
        { "type": "protein", "current": 150, "suggested": 170, "unit": "g", "reason": "Boost recovery" },
        { "type": "calories_in", "current": 2500, "suggested": 2700, "unit": "kcal", "reason": "Extra fuel for peak performance" }
      ]
    }
    ${'```'}

    Be punchy, scientific, and authoritative.
  `;

  try {
    const result = await callAIWithFallback(prompt, model, provider);
    return {
      text: result.text,
      provider: result.provider,
      model: result.model
    };
  } catch (error) {
    console.error("AI API Error in getSmartTargetAdjustments:", error);
    throw new Error(`AI API Error in getSmartTargetAdjustments: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  }
}

export interface HealthData {
  metrics: any[];
  workouts: any[];
  routines?: any[];
  routineExercises?: any[];
  exercises?: any[];
  sets?: any[];
  mealItems?: any[];
  nextWorkoutDay?: string;
  targets?: { type: string; label: string; unit: string; value: number }[];
  medications?: { name: string; dose: string; frequency: string }[];
  timezone?: string;
  aiHints?: any;
  meal_suggestion_breakfast?: boolean;
  meal_suggestion_lunch?: boolean;
  meal_suggestion_dinner?: boolean;
  ai_persona?: string;
  ai_focus?: string;
}

export interface CombinedReviewData extends HealthData {
  age: number;
  gender: string;
  height?: number;
  nextWorkoutDay?: string;
  aiInsightsForDate?: {
    nutrition: string | null;
    workout: string | null;
  };
  chatDate?: string;
  aiHints?: any;
}

function sortTargets(targets: any[]) {
  const priority = ['body_fat', 'muscle_mass', 'weight'];
  return [...targets].sort((a, b) => {
    const aIdx = priority.indexOf(a.type);
    const bIdx = priority.indexOf(b.type);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return 0;
  });
}

function formatWorkouts(workouts: any[], exercises: any[] = [], sets: any[] = []) {
  return workouts.map(w => {
    const wExercises = exercises.filter(ex => ex.workout_id === w.id);
    return {
      name: w.name,
      timestamp: w.timestamp,
      duration: w.duration,
      volume: w.volume > 0 ? w.volume : undefined,
      source: w.source,
      exercises: wExercises.map(ex => {
        const exSets = sets.filter(s => s.exercise_id === ex.id);
        const isCardio = ex.exercise_type === 'cardio';
        return {
          title: ex.exercise_title,
          type: ex.exercise_type,
          sets: exSets.map(s => {
            const set: any = {};
            if (s.weight > 0) set.weight_kg = s.weight;
            if (s.reps > 0) set.reps = s.reps;
            if (s.distance > 0) set.distance_meters = s.distance;
            if (s.time > 0) set.time_seconds = s.time;
            if (s.steps > 0) set.steps = s.steps;
            if (s.calories > 0) set.calories = s.calories;
            if (s.avg_hr > 0) set.avg_hr_bpm = s.avg_hr;
            if (s.max_hr > 0) set.max_hr_bpm = s.max_hr;
            return set;
          })
        };
      })
    };
  });
}

export async function getCombinedAIReview(data: CombinedReviewData, model: string = "gemini-3-pro-preview", provider: string = "gemini") {
  const aggregatedMetrics = aggregateMetrics(data.metrics, data.timezone);
  
  // Use provider-specific constraints for token optimization
  const providerConfig = (window as any).__AI_PROVIDERS?.[provider] || {
    suggestedRecentDays: 14,
    suggestedWorkoutLimit: 10
  };
  
  const recentDays = providerConfig.suggestedRecentDays;
  const workoutLimit = providerConfig.suggestedWorkoutLimit;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - recentDays);
  const recentWorkouts = data.workouts.filter(w => new Date(w.timestamp) >= thirtyDaysAgo);

  const nextWorkout = data.routines?.find(r => 
    r.folder_name === 'Current' && 
    r.name.toLowerCase().includes(data.nextWorkoutDay?.toLowerCase() || '')
  );

  const sortedTargets = sortTargets(data.targets || []);

  // Pre-calculate daily totals for today to help the AI
  const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayMeals = data.mealItems?.filter(m => {
    try {
      const d = new Date(m.timestamp);
      const mDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      return mDate === todayDate;
    } catch (e) {
      return m.timestamp.split('T')[0] === todayDate;
    }
  }) || [];

  const todayNutrition = todayMeals.reduce((acc, m) => {
    acc.calories += Number(m.calories || 0);
    acc.protein += Number(m.protein || 0);
    acc.carbs += Number(m.carbs || 0);
    acc.fat += Number(m.fat || 0);
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const todayWorkouts = data.workouts.filter(w => {
    try {
      const d = new Date(w.timestamp);
      const wDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      return wDate === todayDate;
    } catch (e) {
      return w.timestamp.split('T')[0] === todayDate;
    }
  });

  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: data.timezone || 'UTC', hour: 'numeric', hour12: false });
  const currentHour = parseInt(timeFormatter.format(now), 10);
  let timeOfDay = "Morning";
  if (currentHour >= 12 && currentHour < 17) timeOfDay = "Afternoon";
  else if (currentHour >= 17) timeOfDay = "Evening";

    const prompt = `
    Expert trainer: Provide a brief "Micro Health & Training Review". Use previous week's routines as baseline.

    CURRENT TIME: ${timeOfDay} (${currentHour}:00)
    TODAY's DATE: ${todayDate}

    TODAY'S ACTIVITY SO FAR:
    Workouts: ${todayWorkouts.length > 0 ? todayWorkouts.map(w => w.name).join(', ') : 'None yet'}
    Meals Logged: ${todayMeals.length > 0 ? todayMeals.map(m => m.name + ' (' + m.calories + ')').join(', ') : 'None yet'}
    Cals: ${todayNutrition.calories.toFixed(0)} | P: ${todayNutrition.protein.toFixed(0)}g | C: ${todayNutrition.carbs.toFixed(0)}g | F: ${todayNutrition.fat.toFixed(0)}g

    Profile: ${data.age}y ${data.gender}. Meds: ${Array.isArray(data.medications) && data.medications.length ? data.medications.map(m => m.name).join(', ') : 'None'}
    Targets: ${sortedTargets.filter(t => t.value > 0).map(t => t.label + ': ' + t.value + t.unit).join(', ')}
    Persona: ${data.ai_persona || 'Coach'}. Focus: ${data.ai_focus || 'Health'}. Hints: ${data.aiHints || 'None'}
    
    Data: ${JSON.stringify({
      metrics: {
        recent: aggregatedMetrics.recent.slice(0, recentDays),
        monthly: aggregatedMetrics.monthly.slice(0, 3)
      },
      recentWorkouts: formatWorkouts(recentWorkouts.slice(0, workoutLimit), data.exercises, data.sets),
      nextWorkout: nextWorkout?.name,
    })}

    Structure (KEEP IT CONCISE AND PUNCHY):
    1. Greeting & Context: Quick 1-2 sentences acknowledging the time of day (${timeOfDay}) and what I've accomplished today so far.
    2. Vitals Snapshot: A very compact bulleted list of 2-3 key vital anomalies or trends vs avg (skip the big table).
    3. Action Plan: 1-2 specific suggestions for the rest of the day based on the current time and what I've eaten/done so far.
    4. 🔍 Proactive Alert: 1 specific "Root Cause" insight about hidden correlations (e.g., how my sleep or HRV drops when sodium is high). If nothing major, skip.

    Be insightful, conversational, bold, and strictly markdown. Do not be overly verbose.
  `;

  try {
    const result = await callAIWithFallback(prompt, model, provider);
    return result.text;
  } catch (error) {
    console.error("AI API Error in generateReview:", error);
    throw new Error(`AI API Error in generateReview: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  }
}

export async function getNutritionVitalsInsights(data: CombinedReviewData, model: string = "gemini-3-pro-preview", provider: string = "gemini") {
  // Filter metrics to only include nutrition and vitals related ones to reduce payload size
  const relevantMetrics = ['weight', 'body_fat', 'muscle_mass', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'resting_heart_rate', 'sleep', 'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'water', 'caffeine', 'cholesterol'];
  const filteredMetrics = data.metrics.filter(m => relevantMetrics.includes(m.type));
  
  const aggregatedMetrics = aggregateMetrics(filteredMetrics, data.timezone);
  const sortedTargets = sortTargets(data.targets || []);

  // Use provider-specific constraints for token optimization
  const providerConfig = (window as any).__AI_PROVIDERS?.[provider] || {
    suggestedRecentDays: 14,
    suggestedMealDays: 7
  };
  
  const recentDays = providerConfig.suggestedRecentDays;
  const mealDays = providerConfig.suggestedMealDays;

  // Group meal items by day for the last X days to help the AI
  const lastXDays = Array.from({ length: mealDays }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  });

  const recentMealsSummary = lastXDays.map(date => {
    const dayMeals = data.mealItems?.filter(m => {
      try {
        const d = new Date(m.timestamp);
        const mDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        return mDate === date;
      } catch (e) {
        return m.timestamp.split('T')[0] === date;
      }
    }) || [];

    if (dayMeals.length === 0) return null;

    const totals = dayMeals.reduce((acc, m) => {
      acc.calories += Number(m.calories || 0);
      acc.protein += Number(m.protein || 0);
      acc.carbs += Number(m.carbs || 0);
      acc.fat += Number(m.fat || 0);
      return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    return {
      date,
      totals,
      items: dayMeals.map(m => `${m.name} (${m.calories} kcal)`)
    };
  }).filter(Boolean);

  const prompt = `
    Analyze "Nutrition & Vitals".
    
    Meals (7d):
    ${recentMealsSummary.length > 0 ? recentMealsSummary.map(day => `${day?.date}: ${day?.totals.calories.toFixed(0)}kcal, P:${day?.totals.protein.toFixed(0)}g, C:${day?.totals.carbs.toFixed(0)}g, F:${day?.totals.fat.toFixed(0)}g. Items: ${day?.items.join(', ')}`).join('\n') : 'None'}

    Profile: ${data.age}y ${data.gender}. Meds: ${Array.isArray(data.medications) && data.medications.length ? data.medications.map(m => m.name).join(', ') : 'None'}
    Targets: ${sortedTargets.filter(t => t.value > 0).map(t => `${t.label}: ${t.value}${t.unit}`).join(', ')}
    Persona: ${data.ai_persona || 'Coach'}. Focus: ${data.ai_focus || 'Health'}. Hints: ${data.aiHints || 'None'}
    
    ${(data.meal_suggestion_breakfast || data.meal_suggestion_lunch || data.meal_suggestion_dinner) ? `Suggestions: ${data.meal_suggestion_breakfast ? 'Breakfast ' : ''}${data.meal_suggestion_lunch ? 'Lunch ' : ''}${data.meal_suggestion_dinner ? 'Dinner' : ''}` : ''}
    
    Data: ${JSON.stringify({
      metrics: {
        recent: aggregatedMetrics.recent.slice(0, recentDays),
        monthly: aggregatedMetrics.monthly.slice(0, 3)
      },
    })}

    Structure:
    1. Table: Target | Current | Trend | Progress
    2. Analysis: Brief review of vitals/nutrition (7d).
    3. Actions: 3-4 data-driven steps.

    Strictly use Markdown. Be conversational, detailed, and insightful.
  `;

  try {
    const result = await callAIWithFallback(prompt, model, provider);
    return {
      text: result.text,
      provider: result.provider,
      model: result.model
    };
  } catch (error) {
    console.error("AI API Error in getNutritionVitalsInsights:", error);
    throw new Error(`AI API Error in getNutritionVitalsInsights: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  }
}

export async function getWorkoutProgressionInsights(data: CombinedReviewData, model: string = "gemini-3-pro-preview", provider: string = "gemini") {
  // Use provider-specific constraints for token optimization
  const providerConfig = (window as any).__AI_PROVIDERS?.[provider] || {
    suggestedWorkoutLimit: 10
  };
  
  const workoutLimit = providerConfig.suggestedWorkoutLimit;
  
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const recentWorkouts = data.workouts.filter(w => new Date(w.timestamp) >= sixtyDaysAgo);

  // 1. Try to find the routine from the most recent workout (if it was within the last 24 hours)
  // This handles the case where a user just finished a workout and wants to update that routine for next time.
  let nextWorkout = null;
  const lastWorkout = recentWorkouts[0];
  if (lastWorkout) {
    const lastWorkoutDate = new Date(lastWorkout.timestamp);
    const now = new Date();
    const diffHours = (now.getTime() - lastWorkoutDate.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 24) {
      nextWorkout = data.routines?.find(r => 
        (r.external_id && lastWorkout.routine_external_id && r.external_id === lastWorkout.routine_external_id) ||
        (r.name && lastWorkout.name && r.name.toLowerCase().trim() === lastWorkout.name.toLowerCase().trim())
      );
      if (nextWorkout) {

      }
    }
  }

  // 2. Fallback to the "next workout day" logic if no recent workout found or matched
  if (!nextWorkout) {
    nextWorkout = data.routines?.find(r => 
      r.name.toLowerCase().includes(data.nextWorkoutDay?.toLowerCase() || '')
    );
  }

  const nextWorkoutExercises = nextWorkout 
    ? data.routineExercises?.filter(re => Number(re.routine_id) === Number(nextWorkout.id))
    : [];

  const sortedTargets = sortTargets(data.targets || []);

  const prompt = `
    Analyze "Workout Progression". Use previous week as baseline.

    Profile: ${data.age}y ${data.gender}. Meds: ${Array.isArray(data.medications) && data.medications.length ? data.medications.map(m => m.name).join(', ') : 'None'}
    Targets: ${sortedTargets.filter(t => t.value > 0).map(t => `${t.label}: ${t.value}${t.unit}`).join(', ')}
    Persona: ${data.ai_persona || 'Coach'}. Focus: ${data.ai_focus || 'Health'}. Hints: ${data.aiHints || 'None'}
    
    Data: ${JSON.stringify({
      recentWorkouts: formatWorkouts(recentWorkouts.slice(0, workoutLimit), data.exercises, data.sets),
      nextWorkout: nextWorkout ? {
        name: nextWorkout.name,
        routine_external_id: nextWorkout.external_id,
        exercises: nextWorkoutExercises.map(ex => ({
          title: ex.exercise_title,
          sets_count: ex.sets_count
        }))
      } : null
    })}

    Structure:
    1. Table: Exercise Target | Current | Trend | Progress
    2. Analysis: Review of volume/intensity/frequency.
    3. Roadmap: Roadmap for next session.
    4. Tips: 2-3 actionable tips.

    If suggesting Hevy progressions, end with JSON:
    ${'```'}json
    {
      "type": "hevy_progression",
      "routine_external_id": "UUID",
      "routine_title": "Name",
      "progressions": [{"exercise_title": "Name", "sets": [{"weight_kg": 0, "reps": 0}]}]
    }
    ${'```'}
    Use exact routine_external_id UUID. Use distance_meters/duration_seconds for cardio. Be conversational, detailed, and insightful.
  `;

  try {
    const result = await callAIWithFallback(prompt, model, provider);
    return {
      text: result.text,
      provider: result.provider,
      model: result.model
    };
  } catch (error) {
    console.error("AI API Error in getWorkoutProgressionInsights:", error);
    throw new Error(`AI API Error in getWorkoutProgressionInsights: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  }
}

export async function getDailyBriefing(data: HealthData, model: string = "gemini-3-pro-preview", provider: string = "gemini") {
  
  const aggregatedMetrics = aggregateMetrics(data.metrics, data.timezone);

  // Use provider-specific constraints for token optimization
  const providerConfig = (window as any).__AI_PROVIDERS?.[provider] || {
    suggestedRecentDays: 7
  };
  
  const recentDays = providerConfig.suggestedRecentDays;

  // Pre-calculate daily totals for today to help the AI
  const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayMeals = data.mealItems?.filter(m => {
    try {
      const d = new Date(m.timestamp);
      const mDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      return mDate === todayDate;
    } catch (e) {
      return m.timestamp.split('T')[0] === todayDate;
    }
  }) || [];

  const todayNutrition = todayMeals.reduce((acc, m) => {
    acc.calories += Number(m.calories || 0);
    acc.protein += Number(m.protein || 0);
    acc.carbs += Number(m.carbs || 0);
    acc.fat += Number(m.fat || 0);
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  
  const prompt = `
    Expert trainer: Provide "Daily Briefing". Use previous week's routines as baseline.

    TODAY (${todayDate}):
    Cals: ${todayNutrition.calories.toFixed(1)} | P: ${todayNutrition.protein.toFixed(1)}g | C: ${todayNutrition.carbs.toFixed(1)}g | F: ${todayNutrition.fat.toFixed(1)}g
    Meals: ${todayMeals.length > 0 ? todayMeals.map(m => `${m.name} (${m.calories})`).join(', ') : 'None'}

    Data: ${JSON.stringify({ 
      metrics: { recent: aggregatedMetrics.recent.slice(0, recentDays) }, 
      workouts: formatWorkouts(data.workouts.slice(0, 7), data.exercises, data.sets),
      targets: data.targets?.filter(t => t.value > 0),
      persona: data.ai_persona || 'Coach',
      focus: data.ai_focus || 'Health',
      hints: data.aiHints || 'None'
    })}
    
    Structure:
    1. Recovery: Analyze sleep/HRV.
    2. Today: Focus (Workout/Rest)?
    3. Nutrition: Evaluate today vs targets.
    4. Tip: 1 specific tip.
    
    Tone: Conversational, encouraging, and detailed. Feel free to provide more context and reasoning for your tips.
  `;

  try {
    const result = await callAIWithFallback(prompt, model, provider);
    return result.text;
  } catch (error) {
    console.error("AI API Error:", error);
    return "Ready to crush it today? Let's get after those goals!";
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function chatWithData(
  data: CombinedReviewData,
  message: string,
  history: ChatMessage[],
  model: string = "gemini-3-pro-preview",
  provider: string = "gemini"
) {
  const aggregatedMetrics = aggregateMetrics(data.metrics, data.timezone);
  const sortedTargets = sortTargets(data.targets || []);
  
  // Use provider-specific constraints for token optimization
  const providerConfig = (window as any).__AI_PROVIDERS?.[provider] || {
    suggestedRecentDays: 14,
    suggestedWorkoutLimit: 10,
    suggestedHistoryLimit: 10
  };
  
  const recentDays = providerConfig.suggestedRecentDays;
  const workoutLimit = providerConfig.suggestedWorkoutLimit;
  const historyLimit = providerConfig.suggestedHistoryLimit;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentWorkouts = data.workouts.filter(w => new Date(w.timestamp) >= thirtyDaysAgo);

  // Pre-calculate daily totals for the chat date to help the AI
  const chatDateMeals = data.mealItems?.filter(m => {
    try {
      const d = new Date(m.timestamp);
      const mDate = new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      return mDate === data.chatDate;
    } catch (e) {
      return m.timestamp.split('T')[0] === data.chatDate;
    }
  }) || [];

  const chatDateNutrition = chatDateMeals.reduce((acc, m) => {
    acc.calories += Number(m.calories || 0);
    acc.protein += Number(m.protein || 0);
    acc.carbs += Number(m.carbs || 0);
    acc.fat += Number(m.fat || 0);
    acc.fiber += Number(m.fiber || 0);
    acc.sodium += Number(m.sodium || 0);
    acc.iron += Number(m.iron || 0);
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, iron: 0 });

  const weightHistory90Days = data.metrics
    .filter(m => m.type === 'weight')
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 90)
    .map(m => ({ date: m.timestamp, weight:  typeof m.value === 'number' ? Number((m.value).toFixed(2)) : m.value }));

  const prompt = `
    Expert trainer: Answer question based on data for ${data.chatDate}. Use previous week's routines as baseline.
    
    NUTRITION (${data.chatDate}):
    Cals: ${chatDateNutrition.calories.toFixed(1)} | P: ${chatDateNutrition.protein.toFixed(1)}g | C: ${chatDateNutrition.carbs.toFixed(1)}g | F: ${chatDateNutrition.fat.toFixed(1)}g
    Meals: ${chatDateMeals.length > 0 ? chatDateMeals.map(m => `${m.name} (${m.calories})`).join(', ') : 'None'}

    Profile: ${data.age}y ${data.gender}. Meds: ${Array.isArray(data.medications) && data.medications.length ? data.medications.map(m => m.name).join(', ') : 'None'}
    Targets: ${sortedTargets.filter(t => t.value > 0).map(t => `${t.label}: ${t.value}${t.unit}`).join(', ')}
    Persona: ${data.ai_persona || 'Coach'}. Focus: ${data.ai_focus || 'Health'}. Hints: ${data.aiHints || 'None'}
    
    ${data.aiInsightsForDate ? `Insights: Nut: ${typeof data.aiInsightsForDate.nutrition === 'string' ? data.aiInsightsForDate.nutrition.substring(0,100) : ''}... Work: ${typeof data.aiInsightsForDate.workout === 'string' ? data.aiInsightsForDate.workout.substring(0,100) : ''}...` : ''}
    
    Data: ${JSON.stringify({
      weight_90_days: weightHistory90Days,
      metrics: { recent: aggregatedMetrics.recent.slice(0, recentDays) },
      workouts: formatWorkouts(recentWorkouts.slice(0, workoutLimit), data.exercises, data.sets),
    })}
    
    Chat History:
    ${history.slice(-historyLimit).map(h => `${h.role}: ${h.content}`).join('\n')}
    
    User Question: ${message}
  `;

  try {
    const result = await callAIWithFallback(prompt, model, provider);
    return result.text;
  } catch (error) {
    console.error("AI API Error in chatWithData:", error);
    throw new Error(`AI API Error in chatWithData: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  }
}
