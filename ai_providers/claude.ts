import axios from "axios";
import { AIProvider, AIConstraints, GenerateParams, GenerateResult } from "./types";

const ANTHROPIC_VERSION = "2023-06-01";

export const ClaudeProvider: AIProvider = {
  id: 'claude',
  name: 'Anthropic Claude',
  baseUrl: 'https://api.anthropic.com/v1',

  async getModels(apiKey: string): Promise<string[]> {
    const defaultModels = [
      "claude-sonnet-4-5-20250929",
      "claude-opus-4-1-20250805",
      "claude-3-5-haiku-20241022"
    ];
    if (!apiKey) return defaultModels;
    try {
      const response = await axios.get(`${this.baseUrl}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        }
      });
      const models = (response.data.data || []).map((m: any) => m.id);
      return models.length > 0 ? models : defaultModels;
    } catch (e) {
      return defaultModels;
    }
  },

  getConstraints(model?: string): AIConstraints {
    const isOpus = model?.includes('opus');
    return {
      maxTokens: 8192,
      contextWindow: 200000,
      tpmLimit: isOpus ? 20000 : 40000,
      rpmLimit: 50,
      suggestedRecentDays: 14,
      suggestedMealDays: 7,
      suggestedWorkoutLimit: 14,
      suggestedHistoryLimit: 14
    };
  },

  async generate({ model, prompt, maxTokens, apiKey, logEvent }: GenerateParams): Promise<GenerateResult> {
    const url = `${this.baseUrl}/messages`;
    const response = await axios.post(url, {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json'
      }
    });
    const text = response.data.content?.[0]?.text ?? "";
    return { text, provider: 'claude', model };
  }
};
