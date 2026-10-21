# API overview

All routes are under `/api` and need the `auth_token` cookie unless noted. The full
reference is [api-openapi.md](api-openapi.md) and the OpenAPI 3 contract in
[openapi.yaml](openapi.yaml).

## Auth
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` (no auth)
- `GET /api/auth/me`

## Settings and modules
- `GET /api/settings`, `POST /api/settings`
- `GET /api/modules`, `POST /api/modules/:moduleId/settings`,
  `POST /api/modules/:moduleId/toggle`, `POST /api/sync/:moduleId`,
  `GET /api/sync/status`, `POST /api/data/refresh`

## Health data
- `GET /api/data/summary`, `GET /api/metrics/aggregated`, workouts, nutrition and targets
- Exports: `GET /api/export/metrics.csv`, `GET /api/export/workouts.csv`,
  `GET /api/export/all.json`
- Health Auto Export: `GET /api/export-token`, `POST /health-export` (token auth)

## AI
- `GET /api/ai/data`, `GET|POST /api/ai/insights`, `GET /api/ai/insights/freshness`
- `POST /api/ai/regenerate`, `POST /api/ai/chat`

## Admin (`role = admin`)
- `GET /api/admin/users`, `POST /api/admin/users/:id/{approve,reject,purge,toggle-debug}`
- `GET|POST /api/admin/config`

## Logs
- `GET /api/logs`
