import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { OpenAICompatibleProvider } from './openai_compatible';

vi.mock('axios');

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to Ollama /api/tags when the base URL includes a trailing slash', async () => {
    const provider = OpenAICompatibleProvider('ollama', 'Ollama (Local)', 'http://localhost:11434/v1');

    vi.mocked(axios.get)
      .mockRejectedValueOnce(new Error('models endpoint unavailable'))
      .mockResolvedValueOnce({
        data: {
          models: [
            { name: 'llama3.2' },
            { name: 'phi4' },
          ],
        },
      });

    const models = await provider.getModels('', 'http://localhost:11434/v1/');

    expect(models).toEqual(['llama3.2', 'phi4']);
    expect(axios.get).toHaveBeenNthCalledWith(1, 'http://localhost:11434/v1/models', expect.objectContaining({ timeout: 5000 }));
    expect(axios.get).toHaveBeenNthCalledWith(2, 'http://localhost:11434/api/tags', expect.objectContaining({ timeout: 5000 }));
  });
});
