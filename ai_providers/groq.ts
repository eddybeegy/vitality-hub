import axios from "axios";
import { AIProvider, AIConstraints, GenerateParams, GenerateResult } from "./types";

export const GroqProvider: AIProvider = {
  id: 'groq',
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',

  async getModels(apiKey: string): Promise<string[]> {
    const defaultModels = [
      "deepseek-r1-distill-llama-70b",
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768"
    ];
    if (!apiKey) return defaultModels;
    try {
      const response = await axios.get(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const models = response.data.data
        .filter((m: any) => !m.id.includes('whisper') && !m.id.includes('preview'))
        .map((m: any) => m.id);
      
      return models.length > 0 
        ? models.sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }))
        : defaultModels;
    } catch (e) {
      return defaultModels;
    }
  },

  getConstraints(model?: string): AIConstraints {
    const isLarge = model?.includes('70b') || model?.includes('llama-3.3');
    return {
      maxTokens: 4096,
      contextWindow: 128000,
      tpmLimit: isLarge ? 12000 : 6000,
      suggestedRecentDays: 10,
      suggestedMealDays: 5,
      suggestedWorkoutLimit: 10,
      suggestedHistoryLimit: 10
    };
  },

  async generate({ model, prompt, maxTokens, apiKey, logEvent }: GenerateParams): Promise<GenerateResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const response = await axios.post(url, {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    return { text: response.data.choices[0].message.content, provider: 'groq', model };
  }
};
