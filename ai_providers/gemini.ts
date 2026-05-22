import { GoogleGenAI } from "@google/genai";
import { AIProvider, AIConstraints, GenerateParams, GenerateResult } from "./types";

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
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: { maxOutputTokens: maxTokens }
    });
    
    return { text: response.text || "", provider: 'gemini', model: targetModel };
  }
};
