# item 13: `metrics` / `workouts` / `logs` `.timestamp` → `timestamptz`

Postgres only. SQLite stores ISO text and is unaffected; MySQL keeps `DATETIME`.

| file | what it does |
|---|---|
| `preflight.sql` | read-only checks; run first and read every section |
| `up.sql` | the migration, one transaction, refuses to run twice |
| `down.sql` | exact inverse, refuses to run on an unmigrated database |
| `selftest.sh` | builds a throwaway database with fixtures across both BST boundaries, runs preflight → up → assertions → down → assertions → up, drops it |

## Why per source

The naive columns hold a different zone per source (handoff fact 1), so there is no
single correct `AT TIME ZONE` for a table:

| column | source | stored as | converted with |
|---|---|---|---|
| `metrics`, `workouts` | apple_health, cronometer, withings, nutrachek, hevy (in-app modules, `toISOString()`) | UTC | `AT TIME ZONE 'UTC'` |
| `metrics`, `workouts` | `healthsync` (external, item 19) | Europe/London wall-clock | `AT TIME ZONE 'Europe/London'` |
| `logs` | `DEFAULT CURRENT_TIMESTAMP` in the London session | Europe/London wall-clock | `AT TIME ZONE 'Europe/London'` |

Any other source in `metrics`/`workouts` is converted as UTC. Preflight section 2 lists
every source so one nobody has accounted for shows up before it is converted.

## Running it

1. `./selftest.sh` against a scratch Postgres (`PGHOST`/`PGPORT`/`PGUSER`; needs
   CREATE DATABASE). It never touches an existing database.
2. Restore a backup to a scratch database and run `preflight.sql`, then `up.sql`,
   against it. Boot the app against it and check the points under "What to check".
3. Live:
   1. Stop the app **and pause the healthsync writer** on Home Assistant (item 19).
      `ALTER ... TYPE` rewrites each table under an ACCESS EXCLUSIVE lock;
      `lock_timeout` is 15 s, so a writer still holding a lock makes it roll back
      cleanly rather than hang.
   2. `psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f preflight.sql` and read it.
   3. `psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f up.sql`.
   4. Start the app. The boot log prints
      `[schema] timestamptz columns: metrics=true workouts=true logs=true`.
   5. Pin the healthsync writer (below), then resume it.

The app build from this PR is safe on either schema: it reads the column types at
boot and keeps the per-source `CASE` while they are still naive, so it can be deployed
before or after `up.sql`. The pre-item-13 build is **not** safe on the migrated
schema (its `CASE` would shift in-app rows by the London offset), so roll back with
the app first, then `down.sql`.

## The healthsync writer has to be pinned at the same time

After `up.sql`, Postgres interprets whatever healthsync sends in the **writer's own
session zone** unless the value carries an offset. Today it sends London wall-clock
and the database default zone is Europe/London, so its rows will land correctly, but
only by accident: a connection with a different `TimeZone`, or a change of the
database default, would silently shift every new row by the offset. And a naive value
inside the fall-back hour (01:00–02:00 on the last Sunday of October) cannot be
placed at all.

Pin it to one convention: send an explicit offset (`2026-10-21T10:40:08+01:00`) or
UTC with `Z`. Either is unambiguous under `timestamptz`. Do not switch it to naive UTC
without an offset; that would be read as London and land an hour late under BST.

## What `up.sql` cannot recover

Preflight section 3 counts the London wall-clock rows (healthsync and logs) that never
named a single instant:

- **ambiguous** (fall-back hour, e.g. 2026-10-25 01:30): Postgres picks the later,
  GMT, reading, so a reading taken in the BST pass lands an hour late;
- **nonexistent** (spring-forward gap, e.g. 2027-03-28 01:30): mapped an hour forward.
  If that makes two metrics rows collide on the unique index, `up.sql` fails and
  changes nothing; preflight section 4 tells you beforehand.

## What to check after `up.sql`

- `\d metrics`, `\d workouts`, `\d logs`: `timestamp` is `timestamp with time zone`,
  `logs` and `metrics` still default to `CURRENT_TIMESTAMP`.
- `SELECT source, max(timestamp) FROM metrics GROUP BY source`: every source's newest
  row reads as a plausible time against `now()` (healthsync was 59 minutes in the
  future when read as UTC before; it must not be now).
- `/api/data/summary`: `dataFreshness`, `syncLogs`, `syncIssues` and the daily
  buckets are unchanged from before the migration (they were already converted per
  source in SQL). What changes is every place that returned the raw column:
  healthsync workouts and System Logs times are an hour earlier under BST, which is
  the correct time (they were an hour in the future).
