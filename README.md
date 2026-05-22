# Vitality Hub

A self-hosted health and fitness dashboard with AI insights, multi-source health sync, workout tracking, and nutrition reporting.

## Features

- React + Vite frontend with lazy-loaded admin and analytics screens
- Express backend with SQLite/Postgres/MySQL support
- AI integration via Gemini-compatible providers
- Cronometer sync using the included Go wrapper
- Container-ready with Docker and docker-compose

## Prerequisites

- Node.js 20+
- npm
- Go 1.24+ (for the Cronometer wrapper build step)
- Optional: Docker / docker-compose for container deployment

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment template:

   ```bash
   cp .env.example .env
   ```

3. Set required environment variables in `.env`:

   - `JWT_SECRET`
   - `PORT` (optional, defaults to `3000`)
   - `DATABASE_TYPE` (optional, defaults to `sqlite`)
   - `SQLITE_PATH` (optional, defaults to `health.db`)

4. If using AI or external integrations, configure:

   - `GEMINI_API_KEY`
   - `WITHINGS_CLIENT_ID`
   - `WITHINGS_CLIENT_SECRET`
   - `HEVY_API_KEY`
   - `CRONOMETER_USERNAME`
   - `CRONOMETER_PASSWORD`

5. Start the app locally:

   ```bash
   npm run dev
   ```

## Build

```bash
npm run build
```

## Production

```bash
npm start
```

## Docker

```bash
docker-compose up --build
```

## Notes

- The project currently supports SQLite by default, with optional Postgres or MariaDB/MySQL via `DATABASE_TYPE`.
- The Go wrapper is built automatically during `npm run dev` and `npm run build`.
- Runtime SQLite artifacts such as `.db`, `.db-shm`, and `.db-wal` are excluded from source control by `.gitignore`.
