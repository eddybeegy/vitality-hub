# Database

Engine is chosen by `DATABASE_TYPE`:

| Value | Driver | Connection |
| --- | --- | --- |
| `sqlite` (default) | `better-sqlite3` | `SQLITE_PATH` (default `health.db`) |
| `postgres` | `pg` | `POSTGRES_URL` |
| `mariadb` | `mysql2` | `MARIADB_URL` (or `MYSQL_URL`) |

SQL in the app must stay portable across all three.

The schema is defined in `server.ts` (the per-table column map near the top of the
startup code). Tables are created if missing and new columns are added on boot.
Structural changes that boot cannot make safely (type changes, dropping indexes) go in
`migrations/` and are run by hand.

## Tables

| Table | Holds |
| --- | --- |
| `users` | Profile, preferences, AI settings, integration credentials and tokens |
| `ai_configs` | Per-user, per-provider AI key / model / base URL |
| `metrics` | Time-series health metrics (weight, steps, heart rate, sleep, …), one row per type/source/timestamp |
| `workouts`, `workout_exercises`, `workout_sets` | Workouts and their exercises and sets |
| `routines`, `routine_exercises` | Hevy routines |
| `meal_items` | Nutrition entries from Cronometer, Apple Health, Nutracheck, MyFitnessPal |
| `targets` | User health targets |
| `ai_insights`, `chat_history` | Generated insights and AI chat |
| `logs` | Application log rows (also written to daily files in `logs/`) |
| `user_cache` | Per-user cached payloads |
| `system_config` | Admin key/value config |

## Timestamps

Stored timestamps are not all in one zone. Before writing any date logic, read
`docs/remediation/handoff.md`; in short, `metrics` is UTC for in-app modules but
London wall-clock for the HealthSync writer, `workouts` is UTC for all sources, and
`logs` is London time. Never apply a blanket `AT TIME ZONE` to these columns.
