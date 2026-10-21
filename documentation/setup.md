# Setup

## Prerequisites
- Node.js 20+ (the Docker image uses Node 20) and npm
- Go 1.24+ if you want Cronometer sync outside Docker

## Steps
1. `npm install`
2. `cp .env.example .env` and set `JWT_SECRET` (required; the server will not start
   without it) and `ADMIN_PASSWORD` for the first admin login.
3. Optional: build the Cronometer wrapper —
   `cd go-wrapper && go build -o gocronometer-wrapper main.go`.
4. `npm run dev`, then open http://localhost:3000.

## Checks
- `npm test` — Vitest unit tests.
- `npm run lint` — TypeScript type check.
- `npm run lint:eslint` — ESLint.

## Environment variables
All variables, with defaults and notes, are listed in `.env.example`.
