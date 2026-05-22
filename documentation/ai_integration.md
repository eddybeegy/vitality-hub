# AI Integration

The application leverages the Gemini API to provide intelligent health insights and chat capabilities.

## AI Configuration
Users can configure the AI experience in the Settings tab:
- **AI Provider**: Select between Gemini, OpenAI, Groq, Mistral, OpenRouter, or Ollama.
- **AI Model**: Choose from available models (e.g., `gemini-flash-latest`, `gemini-pro-latest`).
- **AI Persona**: Defines the tone and style of AI responses (e.g., "Encouraging Coach", "Strict Analyst").
- **AI Focus**: Defines the goal of the AI's advice (e.g., "Fat Loss", "Muscle Gain", "Body Recomposition").
- **AI Hints**: Custom instructions to further guide the AI.

## Prompt Engineering
The application dynamically constructs prompts for the Gemini API by injecting:
- User profile data (age, gender, medications).
- Health targets.
- Recent health metrics and meal data.
- User-defined AI Persona, Focus, and Hints.

This ensures that all AI-generated content is highly personalized and relevant to the user's current health status and goals.
