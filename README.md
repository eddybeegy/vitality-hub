# Vitality Hub

A self-hosted health and fitness dashboard: multi-source health sync, workout tracking,
nutrition reporting and AI insights.

## Stack

- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Zustand, Recharts, `motion`, three.js
  (body diagram). Source in `src/`.
- **Backend**: one Express app in `server.ts`. In development it mounts Vite as
  middleware; in production it serves the built `dist/`.
- **Database**: SQLite by default (`better-sqlite3`), or Postgres / MariaDB-MySQL via
  `DATABASE_TYPE`. The adapter is `src/lib/db.ts`; the schema is created and migrated
  on boot from the table definitions in `server.ts`.
- **Data sources** (`modules/`): Apple Health and Apple Workouts (pushed from Health
  Auto Export to `/health-export`), Withings, Hevy, Cronometer, Strava, MyFitnessPal,
  Nutracheck (module id `nutrachek`).
- **AI providers** (`ai_providers/`): Claude, Gemini, Groq, and OpenAI-compatible
  endpoints (OpenAI, Mistral, OpenRouter, Ollama).
- **Cronometer** is read through a small Go program in `go-wrapper/`, run as a
  subprocess from `go-wrapper/gocronometer-wrapper`.

## Prerequisites

- Node.js 20+ and npm
- Go 1.24+ only if you sync Cronometer outside Docker (see below)
- Optional: Docker / docker compose

## Local setup

```bash
npm install
cp .env.example .env   # then set at least JWT_SECRET
npm run dev            # http://localhost:3000
```

`JWT_SECRET` is required — the server refuses to start without it. Set
`ADMIN_PASSWORD` for the first admin login. Every other variable is optional and
documented in `.env.example`.

The Go wrapper is **not** built by any npm script. Outside Docker, build it once:

```bash
cd go-wrapper && go build -o gocronometer-wrapper main.go
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | `tsx server.ts` with Vite middleware |
| `npm run build` | Vite build of the frontend, then esbuild bundle of the server to `dist/server.cjs` |
| `npm start` | `node dist/server.cjs` |
| `npm test` | Vitest, co-located `*.test.ts` |
| `npm run lint` / `npm run typecheck` | `tsc --noEmit` |
| `npm run lint:eslint` | ESLint (flat config in `eslint.config.js`) |

CI (`.github/workflows/ci.yml`) runs the type check and the test suite on every
pull request and on pushes to `main`.

## Docker

```bash
docker compose up --build
```

The Dockerfile builds the Go wrapper from source in its first stage, so the image
does not depend on a prebuilt binary in the repo. Data (`/app/data`) and logs
(`/app/logs`) are bind-mounted from `./data` and `./logs`.

## Documentation

- `documentation/` — architecture, database, API (including an OpenAPI 3 contract),
  deployment, security and settings.
- `docs/remediation/` — the live remediation tracker and the coordination protocol for
  changes. Read `docs/remediation/README.md` before opening a pull request.
- `migrations/` — one-off, hand-run database migrations, each with its own README.
