import { GoogleGenAI } from "@google/genai";
import { AIProvider, AIConstraints, GenerateParams, GenerateResult } from "./types";

// Google's live models.list() can keep listing a model (e.g. gemini-2.5-pro)
// after it's been retired for new API keys — calling it then returns a
// permanent 404 "no longer available to new users", not a transient error.
// Track those in-memory per process so the fallback chain in server.ts's
// callAI() stops wasting an attempt on them after the first failure, same
// rationale as the media-type name filter below.
const permanentlyUnavailableModels = new Set<string>();

export const GeminiProvider: AIProvider = {
  id: 'gemini',
  name: 'Google Gemini',
  
  async getModels(apiKey: string): Promise<string[]> {
    const defaultModels = [
      "gemini-2.0-flash", 
      "gemini-flash-latest", 
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-1.5-pro", 
      "gemini-1.5-flash-8b"
    ];
    if (!apiKey) return defaultModels;
    try {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.list();
      let models: string[] = [];
      for await (const model of result) {
        if (model.name.startsWith('models/gemini-')) {
          const simpleName = model.name.replace('models/', '');
          // Filter out explicitly prohibited models from being prioritized
          if (simpleName === 'gemini-1.5-flash') continue;
          // Exclude non-text-generation variants (image/audio/video/embedding) so the
          // fallback chain in server.ts's callAI() never wastes a retry on a model
          // that can't return text.
          if (/image|imagen|tts|audio|video|embed|aqa|live/i.test(simpleName)) continue;
          if (permanentlyUnavailableModels.has(simpleName)) continue;
          models.push(simpleName);
        }
      }
      
      if (models.length === 0) return defaultModels;

      // Sort models according to user preference: Pro > Flash > Flash Lite
      const getPriority = (m: string) => {
        if (m.includes('pro')) return 1;
        if (m.includes('flash') && !m.includes('8b') && !m.includes('lite')) return 2;
        if (m.includes('lite') || m.includes('8b')) return 3;
        return 4;
      };

      return models.sort((a, b) => {
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;
        // Within same priority, newer versions first
        return b.localeCompare(a, undefined, { numeric: true });
      });
    } catch (e) {
      return defaultModels;
    }
  },

  getConstraints(model?: string): AIConstraints {
    const isFlash = model?.includes('flash');
    const isPro = model?.includes('pro');
    const hasLargeContext = isFlash || isPro;

    return {
      maxTokens: 8192,
      contextWindow: isFlash ? 1000000 : (isPro ? 2000000 : 32768),
      suggestedRecentDays: hasLargeContext ? 30 : 14,
      suggestedMealDays: hasLargeContext ? 14 : 7,
      suggestedWorkoutLimit: hasLargeContext ? 30 : 10,
      suggestedHistoryLimit: hasLargeContext ? 20 : 10
    };
  },

  async generate({ model, prompt, maxTokens, apiKey, logEvent }: GenerateParams): Promise<GenerateResult> {
    const ai = new GoogleGenAI({ apiKey });
    const targetModel = model || "gemini-flash-latest";
    try {
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: { maxOutputTokens: maxTokens }
      });

      return { text: response.text || "", provider: 'gemini', model: targetModel };
    } catch (e: any) {
      const msg = e?.message || '';
      if (/"code":404/.test(msg) && /no longer available/i.test(msg)) {
        permanentlyUnavailableModels.add(targetModel);
      }
      // A 429 whose quota violations report "limit: 0" means this project/key
      // has zero free-tier allowance for the model — a permanent exclusion,
      // not a transient rate limit (those report a nonzero limit and a retry
      // delay). Match on "limit: 0" alone rather than pairing it with the
      // model name in the message text: Google's quota-error text sometimes
      // reports a normalized/aliased name (e.g. "gemini-3.1-pro" for a call to
      // "gemini-3.1-pro-preview"), but the response is always about the one
      // targetModel just requested, so no name match is needed. Same self-heal
      // rationale as the 404 case above: stop the fallback chain from wasting
      // an attempt on it.
      if (/"code":429/.test(msg) && /limit:\s*0\b/.test(msg)) {
        permanentlyUnavailableModels.add(targetModel);
      }
      throw e;
    }
  }
};
