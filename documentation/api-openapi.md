# API Reference for OpenAPI Tool Integration

This document lists the available `/api` endpoints exposed by Vitality Hub. It is intended as a reference for generating OpenAPI-compatible tooling, client code, or API automation.

## Authentication

### POST /api/auth/login
- Description: Authenticate or register a user by email and set the auth cookie.
- Request Body (JSON):
  - `email` (string, required)
- Response:
  - `user` object with `id` and `email`
- Notes: Sets `auth_token` cookie. No prior auth required.

### POST /api/auth/logout
- Description: Clear the authentication cookie.
- Response:
  - `success` (boolean)

### GET /api/auth/me
- Description: Return the authenticated user's profile.
- Response:
  - `user` object containing `id`, `email`, `name`, `display_mode`, `approved`, `role`, and other profile fields.

## User Settings

### GET /api/settings
- Description: Retrieve the current authenticated user's settings.
- Response:
  - User settings object including AI config, preferences, timezone, dashboard widgets, and `ai_configs`.

### POST /api/settings
- Description: Update user settings.
- Request Body (JSON):
  - `withings_client_id`, `withings_client_secret`, `hevy_api_key`, `email`, `name`
  - `sync_history_days`, `age`, `dob`, `gender`, `height`, `display_mode`
  - `ai_provider`, `ai_api_key`, `ai_base_url`, `ai_hints`, `ai_persona`, `ai_focus`
  - `meal_suggestion_breakfast`, `meal_suggestion_lunch`, `meal_suggestion_dinner`
  - `show_debug_logs`, `ai_model`, `medications`, `preferred_units`
  - `default_graph_range`, `default_graph_grouping`, `timezone`
  - `ai_generation_times`, `metric_priorities`, `font_size`, `dashboard_widgets`
- Response:
  - `success` (boolean)

## Admin Endpoints

> Requires authenticated user with `role: admin`.

### GET /api/admin/config
- Description: Read system-level configuration values.
- Response:
  - Object mapping config keys to values.

### POST /api/admin/config
- Description: Create or update a system config entry.
- Request Body (JSON):
  - `key` (string, required)
  - `value` (string, required)
- Response:
  - `success` (boolean)

### GET /api/admin/users
- Description: List all users.
- Response:
  - Array of users with `id`, `email`, `approved`, `role`, `show_debug_logs`, `enable_daily_briefing`.

### POST /api/admin/users/:id/approve
- Description: Approve a user account.
- Path Parameter:
  - `id` (integer)
- Response:
  - `success` (boolean)

### POST /api/admin/users/:id/reject
- Description: Reject and delete a user account.
- Path Parameter:
  - `id` (integer)
- Response:
  - `success` (boolean)

### POST /api/admin/users/:id/purge
- Description: Purge selected user data sets for the target user.
- Path Parameter:
  - `id` (integer)
- Request Body (JSON):
  - `metrics`, `workouts`, `routines`, `insights`, `logs`, `chat` (boolean flags)
- Response:
  - `success` (boolean)

### POST /api/admin/users/:id/toggle-debug
- Description: Toggle debug logging for a user.
- Path Parameter:
  - `id` (integer)
- Request Body (JSON):
  - `enabled` (boolean)
- Response:
  - `success` (boolean)

## Health & System

### GET /api/health
- Description: API health check.
- Response:
  - `status` and `message`

### POST /api/data/refresh
- Description: Clear cached summary data for the current user.
- Response:
  - `success` (boolean)

### GET /api/metrics/aggregated
- Description: Fetch aggregated health metrics.
- Query Parameters:
  - `type` (string, required) — comma-separated metric types
  - `startDate` (string, optional)
  - `endDate` (string, optional)
  - `granularity` (string, required) — `day`, `week`, or `month`
  - `aggregation` (string, optional) — `sum`, `max`, `min`, or `average`
- Response:
  - Array of objects keyed by date with metric values.

### GET /api/data/summary
- Description: Retrieve dashboard summary data for the current user.
- Query Parameters:
  - `startDate`, `endDate` (optional)
- Response:
  - Object containing `metrics`, `latestMetrics`, `workouts`, `routines`, `routineExercises`, `exercises`, `sets`, `mealItems`, `syncLogs`, and related summary data.

## Targets

### GET /api/targets
- Description: Retrieve saved user target values.
- Response:
  - Array of targets: `{ type, label, unit, value }`

### POST /api/targets
- Description: Create or update multiple target values.
- Request Body (JSON):
  - `targets` (array of objects)
    - Each item: `{ type, value, unit }`
- Response:
  - `success` (boolean)

## Modules & Sync

### GET /api/modules
- Description: List available sync modules and current user configuration.
- Response:
  - Array of module objects with `id`, `enabled`, and `userSettings`.

### POST /api/modules/:moduleId/toggle
- Description: Enable or disable a sync module.
- Path Parameter:
  - `moduleId` (string)
- Request Body (JSON):
  - `enabled` (boolean)
- Response:
  - `success` (boolean)

### POST /api/modules/:moduleId/settings
- Description: Update module-specific settings.
- Path Parameter:
  - `moduleId` (string)
- Request Body (JSON):
  - `settings` (object)
- Response:
  - `success` (boolean)

### POST /api/sync/:moduleId
- Description: Enqueue a sync for the specified module.
- Path Parameter:
  - `moduleId` (string)
- Request Body: module-specific payload passed through to sync.
- Response:
  - `message` (`Sync started`)

### GET /api/sync/status
- Description: Check whether sync is currently running.
- Response:
  - `{ isSyncing: boolean }`

### POST /api/purge/:moduleId
- Description: Purge the specified module's stored data for the current user.
- Path Parameter:
  - `moduleId` (string)
- Response:
  - Module-specific purge result object.

### POST /api/purge/apple-health-workouts
- Description: Purge all Apple Health workout data for the current user.
- Response:
  - `success` (boolean)

## Routines & Meal Data

### GET /api/meals/frequent
- Description: Get frequently logged meals and nutrition averages.
- Response:
  - Array of `{ name, log_count, calories, protein, carbs, fat }`

### POST /api/routines/apply-progression
- Description: Apply progression updates to an existing routine.
- Request Body (JSON):
  - `routineId` (string or number, required)
  - `progressions` (array, required)
    - Example item: `{ exercise_title, target_weight, target_reps, target_distance, target_time }`
- Response:
  - `success` (boolean)

## AI Data & Generation

### GET /api/ai/data
- Description: Retrieve collected AI training data, including meals, Withings metrics, workouts, routines, and Apple Health metrics.
- Response:
  - `{ mealItems, metrics, workouts, exercises, sets, routines, routineExercises }`

### GET /api/ai/models
- Description: List available AI model names by provider.
- Response:
  - Example: `{ gemini: ["gemini-flash-latest", ...] }`

### GET /api/ai/providers
- Description: List AI providers and available models for the user.
- Response:
  - `{ providers: [ { id, name, models, constraints } ] }`

### POST /api/ai/fetch-models
- Description: Fetch available models from a provider using an optional key.
- Request Body (JSON):
  - `providerId` (string, required)
  - `apiKey` (string, optional)
  - `baseUrl` (string, optional)
- Response:
  - `{ models: [...] }`

### POST /api/ai/generate
- Description: Generate AI text using the current provider/model.
- Request Body (JSON):
  - `prompt` (string, required)
  - `maxTokens` (number, optional)
  - `model` (string, optional)
  - `provider` (string, optional)
- Response:
  - `{ text, provider, model }`

### GET /api/ai/cache/:key
- Description: Read cached AI content for a key.
- Path Parameter:
  - `key` (string)
- Response:
  - `{ content, updated_at } | null`

### POST /api/ai/cache/:key
- Description: Save cached AI content.
- Path Parameter:
  - `key` (string)
- Request Body (JSON):
  - `content` (any)
- Response:
  - `success` (boolean)

### POST /api/ai/configs
- Description: Save AI provider configuration entries.
- Request Body (JSON):
  - `configs` (array of objects)
    - Each item: `{ provider, api_key, model, base_url }`
- Response:
  - `success` (boolean)

## AI Insights & Chat

### GET /api/ai/insights
- Description: Fetch AI insights for the current user.
- Query Parameters:
  - `force` (boolean, optional) — regenerate insights when `true`
  - `days` (number, optional)
- Response:
  - Array of AI insights records.

### POST /api/ai-insights
### POST /api/ai/insights
- Description: Save an AI insight record.
- Request Body (JSON):
  - `type` (string)
  - `content` (string)
  - `date` (string, optional)
  - `provider` (string, optional)
  - `model` (string, optional)
  - `batch_id` (string, optional)
  - `updated_at` (string, optional)
- Response:
  - `success` (boolean)

### GET /api/chat-history
- Description: Fetch saved chat history for a date and optional batch.
- Query Parameters:
  - `date` (string, required)
  - `batch_id` (string, optional)
- Response:
  - Array of chat history objects `{ role, content, batch_id }`

### POST /api/chat-history
- Description: Save a chat message.
- Request Body (JSON):
  - `role` (string, required)
  - `content` (string, required)
  - `date` (string, required)
  - `batch_id` (string, optional)
- Response:
  - `success` (boolean)

## Logs

### GET /api/logs
- Description: Retrieve recent logs for the current user plus system logs.
- Response:
  - Array of log records.

### POST /api/logs
- Description: Write a new log entry.
- Request Body (JSON):
  - `level` (string, required)
  - `message` (string, required)
  - `source` (string, required)
- Response:
  - `status` (string)

## Postgres / Hevy Integration

### POST /api/hevy/update-routine
- Description: Update a Hevy routine with suggested progressions.
- Request Body (JSON):
  - `routine_external_id` (string, required)
  - `routine_title` (string, optional)
  - `progressions` (array, required)
- Response:
  - `success` (boolean)
  - `message` (string)

## Debug & Diagnostics

### GET /api/debug/logs
- Description: Fetch recent logs for the authenticated user.
- Response:
  - Array of logs.

### GET /api/debug/metrics/:type
- Description: Fetch metric rows for a specific metric type.
- Path Parameter:
  - `type` (string)
- Response:
  - Array of metric records.

### GET /api/debug/metrics
- Description: List all distinct metric types.
- Response:
  - Array of metric type strings.

### GET /api/debug/last-metrics
- Description: Get the latest 50 metric rows.
- Response:
  - Array of metric records.

### GET /api/debug/apple-health-last-sync
- Description: Get the latest recorded Apple Health sync metadata for the user.
- Response:
  - Sync metadata or informational message.

### GET /api/debug/apple-health-full-body
- Description: Return the latest Apple Health full body record file if available.
- Response:
  - JSON file or status object.

### POST /api/debug/deduplicate
- Description: Run a manual deduplication process for Hevy/Apple Health workouts.
- Response:
  - `{ status, removed }`

### GET /api/debug/workouts
- Description: Retrieve all workouts from the database.
- Response:
  - Array of workout objects.

## Notes

- Most endpoints require authentication via the `auth_token` cookie.
- Admin-only endpoints require the authenticated user to have `role: admin`.
- `POST /api/auth/login` issues the cookie; the frontend uses this cookie for authenticated requests.
- The API is primarily JSON-based and follows REST-style resource naming.

## OpenAPI Tooling

The OpenAPI contract is available in both JSON and YAML formats:
- `documentation/openapi.json`
- `documentation/openapi.yaml`

### Validate the contract

```bash
npm install -g @apidevtools/swagger-cli
swagger-cli validate documentation/openapi.yaml
```

### Use with Swagger Editor or Swagger UI

Open `documentation/openapi.yaml` in Swagger Editor or point Swagger UI at the file to browse the API interactively.

### Generate a client SDK

```bash
npm install -g @openapitools/openapi-generator-cli
openapi-generator-cli generate -i documentation/openapi.yaml -g typescript-axios -o generated/api-client
```

This makes it easy to consume the Vitality Hub API from tooling, client code, or automation workflows.
