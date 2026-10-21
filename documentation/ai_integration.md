# AI integration

## Providers
Defined in `ai_providers/index.ts`:

| Id | Provider |
| --- | --- |
| `claude` | Anthropic Claude (`ANTHROPIC_API_KEY` or a per-user key) |
| `gemini` | Google Gemini (`GEMINI_API_KEY` or a per-user key) |
| `groq` | Groq |
| `openai`, `mistral`, `openrouter`, `ollama` | OpenAI-compatible endpoints |

Users pick a provider, model, persona, focus and free-text hints in Settings; per-provider
keys are stored in `ai_configs`.

## Insights and chat
- Daily insights are generated off-box by the **coach** agent, which reads
  `GET /api/ai/data` and writes back through `POST /api/ai/insights` using a scoped service
  token. `POST /api/ai/regenerate` asks coach to regenerate (signed with
  `VITALITY_CHAT_SHARED_SECRET`, target `COACH_REGEN_URL`).
- `GET /api/ai/insights/freshness` drives the stale-insight banner; a watchdog re-triggers
  generation when insights are older than `INSIGHT_STALE_HOURS`.
- `POST /api/ai/chat` forwards chat to coach (`COACH_CHAT_URL`).
- `POST /api/ai/generate` (on-demand in-app generation) currently returns an error: that
  feature moved to coach.
