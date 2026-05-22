export interface AIProvider {
  id: string;
  name: string;
  baseUrl?: string;
  getModels(apiKey: string, baseUrl?: string): Promise<string[]>;
  getConstraints(model?: string): AIConstraints;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

export interface AIConstraints {
  maxTokens: number;
  contextWindow: number;
  tpmLimit?: number; // Tokens Per Minute
  rpmLimit?: number; // Requests Per Minute
  suggestedRecentDays: number;
  suggestedMealDays: number;
  suggestedWorkoutLimit: number;
  suggestedHistoryLimit: number;
}

export interface GenerateParams {
  model: string;
  prompt: string;
  maxTokens: number;
  apiKey: string;
  baseUrl?: string;
  logEvent: (level: 'debug' | 'info' | 'warn' | 'error', message: string, source: string) => void;
}

export interface GenerateResult {
  text: string;
  provider: string;
  model: string;
}
