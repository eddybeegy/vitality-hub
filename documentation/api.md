# API Documentation

The application exposes a RESTful API for frontend-backend communication.

## Authentication
- `POST /api/auth/login`: Authenticates the user and sets a JWT cookie.
- `POST /api/auth/logout`: Clears the authentication cookie.
- `GET /api/auth/me`: Returns the current authenticated user's profile.

## Settings
- `GET /api/settings`: Retrieves user settings.
- `POST /api/settings`: Updates user settings, including AI configuration.

## Health Data
- `GET /api/metrics/aggregated`: Retrieves aggregated health metrics (e.g., weight, body fat).
- `GET /api/ai/data`: Retrieves comprehensive health data for AI insights.

## AI Insights
- `GET /api/ai-insights`: Retrieves historical AI insights.
- `POST /api/ai-insights`: Saves new AI-generated insights.
- `POST /api/chat-history`: Saves chat messages.
