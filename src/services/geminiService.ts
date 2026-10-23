
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
  focus?: string;
}

export interface CombinedReviewData extends HealthData {
  age: number;
  gender: string;
  height?: number;
  nextWorkoutDay?: string;
  combinedInsightForDate?: string | null;
  chatDate?: string;
  aiHints?: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 2026-10-18 (Option E): chat no longer assembles its prompt in the browser.
 * It used to build the whole thing here and POST it to /api/ai/generate along
 * with the provider and model of its choosing — i.e. the client chose the
 * instructions, the data slice and the engine. Now it posts the turn and the
 * server does all of that.
 *
 * `model` and `provider` are kept in the signature so callers don't have to
 * change, but they are ignored: the server uses the user's configured engine.
 */
export async function chatWithData(
  data: CombinedReviewData,
  message: string,
  history: ChatMessage[],
  _model?: string,
  _provider?: string
) {
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: history.map(h => ({ role: h.role, content: h.content })),
        date: data.chatDate,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Chat request failed (${res.status})`);
    }
    const { text } = await res.json();
    return text as string;
  } catch (error) {
    console.error("AI API Error in chatWithData:", error);
    throw new Error(`AI API Error in chatWithData: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
  }
}
