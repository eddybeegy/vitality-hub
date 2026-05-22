import axios from "axios";
import { AIProvider, AIConstraints, GenerateParams, GenerateResult } from "./types";

// Simple in-memory health cache for provider base URLs
const providerHealth = new Map<string, { ok: boolean; checked: number }>();
export const HEALTH_TTL_MS = 5 * 60 * 1000; // 5 minutes for successful checks
export const UNHEALTHY_TTL_MS = 15 * 1000;  // 15 seconds for failed checks

export async function probeProvider(rawUrl: string, id?: string, apiKey?: string): Promise<boolean> {
  const url = rawUrl.endsWith('/v1') ? rawUrl : (rawUrl.endsWith('/') ? `${rawUrl}v1` : `${rawUrl}/v1`);
  try {
    const headers: any = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    // Try OpenAI-compatible /v1/models
    await axios.get(`${url}/models`.replace(/\/v1\/models\/v1/, '/v1/models'), { headers, timeout: 3000 });
    providerHealth.set(rawUrl, { ok: true, checked: Date.now() });
    return true;
  } catch (e) {
    // If Ollama, try native /api/tags
    try {
      if (id === 'ollama') {
        const nativeUrl = rawUrl.endsWith('/v1') ? rawUrl.replace(/\/v1$/, '') : rawUrl;
        await axios.get(`${nativeUrl}/api/tags`, { timeout: 3000 });
        providerHealth.set(rawUrl, { ok: true, checked: Date.now() });
        return true;
      }
    } catch (e2) {}
    providerHealth.set(rawUrl, { ok: false, checked: Date.now() });
    return false;
  }
}

export const OpenAICompatibleProvider = (id: string, name: string, defaultBaseUrl: string): AIProvider => ({
  id,
  name,
  baseUrl: defaultBaseUrl,

  async getModels(apiKey: string, baseUrl?: string): Promise<string[]> {
    const url = baseUrl || this.baseUrl;
    // Short-circuit if provider was recently probed and marked unhealthy
    const health = providerHealth.get(url);
    const unhealthyTtl = id === 'ollama' ? 10000 : UNHEALTHY_TTL_MS;
    if (health && health.ok === false && (Date.now() - health.checked) < unhealthyTtl) {
      if (id === 'mistral') return ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mixtral-8x22b", "open-mixtral-8x7b"];
      if (id === 'openai') return ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
      if (id === 'openrouter') return ["anthropic/claude-3-opus", "anthropic/claude-3-sonnet", "anthropic/claude-3-haiku", "google/gemini-pro", "mistralai/mistral-large"];
      return [];
    }
    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      
      try {
        const response = await axios.get(`${url}/models`, { headers, timeout: 5000 });
        if (response.data && response.data.data) {
          const models = response.data.data.map((m: any) => m.id);
          return models.sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));
        }
      } catch (innerError) {
        // If /v1/models fails and it's ollama, try native /api/tags
        if (id === 'ollama') {
          const nativeUrl = url.endsWith('/v1') ? url.replace(/\/v1$/, '') : url;
          const nativeResponse = await axios.get(`${nativeUrl}/api/tags`, { timeout: 5000 });
          if (nativeResponse.data && nativeResponse.data.models) {
            return nativeResponse.data.models.map((m: any) => m.name).sort();
          }
        }
        throw innerError;
      }
      return [];
    } catch (e) {
      if (id === 'mistral') return ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mixtral-8x22b", "open-mixtral-8x7b"];
      if (id === 'openai') return ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
      if (id === 'openrouter') return ["anthropic/claude-3-opus", "anthropic/claude-3-sonnet", "anthropic/claude-3-haiku", "google/gemini-pro", "mistralai/mistral-large"];
      return [];
    }
  },

  getConstraints(model?: string): AIConstraints {
    const isGpt4 = model?.includes('gpt-4') || model?.includes('o1');
    const isMini = model?.includes('mini');
    
    return {
      maxTokens: isMini ? 4096 : 8192,
      contextWindow: isGpt4 ? 128000 : 32768,
      suggestedRecentDays: isGpt4 ? 21 : 14,
      suggestedMealDays: isGpt4 ? 10 : 7,
      suggestedWorkoutLimit: isGpt4 ? 15 : 10,
      suggestedHistoryLimit: isGpt4 ? 15 : 10
    };
  },

  async generate({ model, prompt, maxTokens, apiKey, baseUrl, logEvent }: GenerateParams): Promise<GenerateResult> {
    const rawUrl = baseUrl || this.baseUrl;
    // Prefer the /v1 OpenAI-compatible prefix for Ollama when it's not already present
     let openAIUrl = rawUrl;
     if (id === 'ollama' && !rawUrl.includes('/v1')) {
       openAIUrl = rawUrl.endsWith('/') ? `${rawUrl}v1` : `${rawUrl}/v1`;
     }
    const headers: any = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const tryOpenAI = async (effectiveUrl: string) => {
      const fullUrl = effectiveUrl.endsWith('/chat/completions') ? effectiveUrl : `${effectiveUrl}/chat/completions`;
      return await axios.post(fullUrl, {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens
      }, { headers, timeout: 600000 });
    };

    const tryOllamaNative = async (effectiveUrl: string) => {
      const nativeUrl = effectiveUrl.endsWith('/v1') ? effectiveUrl.replace(/\/v1$/, '') : effectiveUrl;
      const fullUrl = nativeUrl.endsWith('/api/chat') ? nativeUrl : `${nativeUrl}/api/chat`;
      return await axios.post(fullUrl, {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: {
          num_ctx: 32768,
          temperature: 0.7
        }
      }, { headers, timeout: 300000 });
    };

    try {
      // Try standard OpenAI first
      const response = await tryOpenAI(openAIUrl);
      providerHealth.set(rawUrl, { ok: true, checked: Date.now() });
      return { text: response.data.choices?.[0]?.message?.content || response.data.choices?.[0]?.text || String(response.data), provider: id, model };
    } catch (err: any) {
      // On network errors or server errors, mark provider unhealthy to avoid repeated long fallbacks
      if (!err.response || (err.response && err.response.status >= 500) || err.code === 'ECONNABORTED') {
        providerHealth.set(rawUrl, { ok: false, checked: Date.now() });
      }

      if (id === 'ollama' && err.response?.status === 404) {
        logEvent?.('warn', `Ollama OpenAI endpoint 404, trying native /api/chat at ${rawUrl}`, 'ai');
        try {
          const nativeRes = await tryOllamaNative(rawUrl);
          // Try to extract text from several possible Ollama response shapes
          const d = nativeRes.data || {};
          let extracted: string | undefined;

          // Common shapes:
          // { message: { content: '...' } }
          if (d.message && (d.message.content || d.message?.content?.text)) {
            extracted = d.message.content?.text || d.message.content;
          }

          // { responses: [ { content: [ { type: 'message', text: '...' } ] } ] }
          if (!extracted && Array.isArray(d.responses) && d.responses[0]) {
            const resp = d.responses[0];
            if (Array.isArray(resp.content) && resp.content[0]) {
              extracted = resp.content[0].text || resp.content[0].message || undefined;
            }
            if (!extracted && resp.message) extracted = resp.message.content || resp.message?.content?.text;
          }

          // { output: [ { content: [ { type: 'message', text: '...' } ] } ] }
          if (!extracted && Array.isArray(d.output) && d.output[0] && Array.isArray(d.output[0].content)) {
            extracted = d.output[0].content[0]?.text || d.output[0].content[0]?.message;
          }

          // Fallback: choices-like
          if (!extracted && d.choices && d.choices[0]) {
            extracted = d.choices[0].message?.content || d.choices[0].text;
          }

          if (extracted) return { text: String(extracted), provider: id, model };
        } catch (nativeErr: any) {
          logEvent?.('error', `Ollama native fallback failed: ${nativeErr.message}`, 'ai');
        }
      }
      
      // Also check if rawUrl was missing /v1 and it's ollama
      if (id === 'ollama' && !rawUrl.includes('/v1') && err.response?.status === 404) {
        logEvent?.('warn', `Ollama 404 at ${rawUrl}, trying with /v1 suffix`, 'ai');
        try {
          const v1Res = await tryOpenAI(`${rawUrl}/v1`);
          return { text: v1Res.data.choices?.[0]?.message?.content || v1Res.data.choices?.[0]?.text || String(v1Res.data), provider: id, model };
        } catch (v1Err: any) {
          logEvent?.('error', `Ollama /v1 fallback failed: ${v1Err.message}`, 'ai');
        }
      }

      throw err;
    }
  }
});
