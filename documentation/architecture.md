# Architecture

## Frontend (`src/`)
- **Framework**: React 19 with Vite 6. Heavy screens (admin, logs, debug, analytics) are
  lazy-loaded; `src/lib/chunkReload.ts` reloads once if a lazy chunk is missing after a
  deploy.
- **State**: Zustand stores in `src/store/` (`useAuthStore`, `useSettingsStore`,
  `useHealthStore`, `useAIStore`, `useUIStore`).
- **Styling**: Tailwind CSS 4.
- **Charts**: Recharts. **Animation**: `motion`. **Body diagram**: three.js loading
  `public/body-diagram.glb`.
- **Pure logic** lives in `src/lib/` (date ranges, aggregation, freshness, targets,
  refresh planning, query-param validation) and is unit-tested there.
- **PWA**: `public/manifest.json` and a minimal service worker `public/sw.js`.

## Backend (`server.ts`)
- **Framework**: Express 4, a single file. In development it mounts Vite as middleware;
  in production it is bundled by esbuild to `dist/server.cjs` and serves `dist/`.
- **Database**: `src/lib/db.ts` wraps SQLite (`better-sqlite3`), Postgres (`pg`) and
  MariaDB/MySQL (`mysql2`) behind one `prepare().get/all/run` interface. Tables are
  created and columns added on boot. See [database.md](database.md).
- **Data-source modules** (`modules/`): each exports a `DataSourceModule`. Withings, Hevy
  and Cronometer pull from upstream APIs and are what Refresh Data runs
  (`src/lib/refreshPlan.ts`); Strava syncs from its own module settings; Apple Health and
  Apple Workouts are push-only via `POST /health-export`; MyFitnessPal and Nutracheck take
  uploaded export files.
- **Background work**: `src/lib/taskQueue.ts` is an in-memory FIFO (`syncQueue`). Sync and
  Refresh Data requests enqueue work and return `202` immediately.
- **Caching**: `node-cache` with a 5-minute TTL for aggregated metrics and summaries,
  cleared per user on writes.
- **AI** (`ai_providers/`): see [ai_integration.md](ai_integration.md).
- **Logging**: daily files under `logs/` plus the `logs` table, filtered by `LOG_LEVEL`
  and `LOG_DEBUG_SOURCES`.

## Tooling
- `src/lib/migrateDb.ts` copies all tables between two engines (`SOURCE_DATABASE_TYPE` →
  `DEST_DATABASE_TYPE`). Run it with `npx tsx src/lib/migrateDb.ts`.
- `migrations/` holds one-off, hand-run SQL migrations, each with a README, preflight and
  self-test.
