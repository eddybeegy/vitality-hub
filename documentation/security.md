# Security

## Authentication
- Email + password login (`POST /api/auth/login`), rate-limited. The session is a JWT in
  an HTTP-only `auth_token` cookie signed with `JWT_SECRET`, which is required at startup.
- New accounts must be approved by an admin. Admin-only routes (`/api/admin/*`) check
  `role = 'admin'`.
- `ADMIN_PASSWORD` bootstraps the first admin's password.

## Service tokens
`COACH_SERVICE_TOKEN` + `COACH_SERVICE_USER_ID` let an agent call a fixed allowlist of
method + path pairs as one user. Anything outside the allowlist falls through to normal
cookie auth and gets a 401.

## Health Auto Export endpoint
`POST /health-export` is authenticated by a per-user token (see `GET /api/export-token`).
`HEALTH_EXPORT_ALLOW_LOCAL_FALLBACK=true` additionally accepts token-less posts from local
network addresses; leave it off unless you need it.

## Secrets
- Integration credentials (Hevy key, Withings secret and tokens, module config) are
  stored server-side and stripped from `GET /api/settings`. AI keys (`ai_api_key`,
  `ai_configs`) are returned to the logged-in user because the Settings form round-trips
  them.
- Secrets are stored in plain text in the database, including Cronometer credentials
  inside `users.modules_config`.
- AI base URLs are checked by `ai_providers/urlGuard.ts` to block requests to internal
  addresses.
- Database files are not encrypted at rest; protect the host and the `data/` volume.

## Input handling
Queries are parameterised. Query and body parameters are being validated route by route
(see `src/lib/queryParams.ts` and the remediation tracker) — not every route validates
its input yet.
