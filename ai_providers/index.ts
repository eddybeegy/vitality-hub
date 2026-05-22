import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { OpenAICompatibleProvider } from "./openai_compatible";
import { AIProvider } from "./types";

export const AI_PROVIDERS: Record<string, AIProvider> = {
  gemini: GeminiProvider,
  groq: GroqProvider,
  mistral: OpenAICompatibleProvider('mistral', 'Mistral AI', 'https://api.mistral.ai/v1'),
  openrouter: OpenAICompatibleProvider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'),
  openai: OpenAICompatibleProvider('openai', 'OpenAI', 'https://api.openai.com/v1'),
  ollama: OpenAICompatibleProvider('ollama', 'Ollama (Local)', 'http://localhost:11434/v1'),
};

export * from "./types";
