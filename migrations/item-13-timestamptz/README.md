# item 13: `metrics` / `workouts` / `logs` `.timestamp` → `timestamptz`

Postgres only. SQLite stores ISO text and is unaffected; MySQL keeps `DATETIME`.

| file | what it does |
|---|---|
| `preflight.sql` | read-only checks; run first and read every section |
| `up.sql` | the migration, one transaction, refuses to run twice |
| `down.sql` | exact inverse, refuses to run on an unmigrated database |
| `selftest.sh` | builds a throwaway database with fixtures across both BST boundaries, runs preflight → up → assertions → down → assertions → up, drops it |

## Why per table and source

The naive columns do not hold one zone, and healthsync's writer (`kb-health`, a
container on the host) is not even consistent with itself across tables, so there is
no single correct `AT TIME ZONE` for `metrics`:

| column | source | stored as | converted with |
|---|---|---|---|
| `metrics` | apple_health, cronometer, withings, nutrachek, hevy (in-app modules, `toISOString()`) | UTC | `AT TIME ZONE 'UTC'` |
| `metrics` | `healthsync` (kb-health `upsertMetric` → `localNaive()`) | Europe/London wall-clock | `AT TIME ZONE 'Europe/London'` |
| `workouts` | every source, healthsync included (kb-health workout INSERT → `utcNaive()`) | UTC | `AT TIME ZONE 'UTC'` |
| `logs` | `DEFAULT CURRENT_TIMESTAMP` in the London session | Europe/London wall-clock | `AT TIME ZONE 'Europe/London'` |

Any other source in `metrics` is converted as UTC. Preflight section 2 lists every
source so one nobody has accounted for shows up before it is converted; section 2b
checks each healthsync workout against the UTC instant embedded in its `external_id`.

## Running it

1. `./selftest.sh` against a scratch Postgres (`PGHOST`/`PGPORT`/`PGUSER`; needs
   CREATE DATABASE). It never touches an existing database.
2. Restore a backup to a scratch database and run `preflight.sql`, then `up.sql`,
   against it. Boot the app against it and check the points under "What to check".
3. Live:
   1. Stop the app **and pause the healthsync writer** (`kb-health`, item 19).
      `ALTER ... TYPE` rewrites each table under an ACCESS EXCLUSIVE lock;
      `lock_timeout` is 15 s, so a writer still holding a lock makes it roll back
      cleanly rather than hang.
   2. `psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f preflight.sql` and read it.
   3. `psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f up.sql`.
   4. Start the app. The boot log prints
      `[schema] timestamptz columns: metrics=true workouts=true logs=true`.
   5. Switch `kb-health` to explicit offsets (below), then resume it.

The app build from this PR is safe on either schema: it reads the column types at
boot and keeps the per-source `CASE` while they are still naive, so it can be deployed
before or after `up.sql`. The pre-item-13 build is **not** safe on the migrated
schema (it would reinterpret the stored instants as naive again and shift rows by
the London offset), so roll back with the app first, then `down.sql`.

## The healthsync writer has to be pinned at the same time

After `up.sql`, Postgres reads a value without an offset in the **writer's own
session zone**. kb-health runs with `TZ=Europe/London` and the database default is
Europe/London, so its naive London metrics would happen to land correctly, but its
naive **UTC workouts would land an hour early under BST**, and a naive value in the
fall-back hour cannot be placed at all.

So both kb-health insert paths have to send an explicit offset
(`2026-10-21T10:40:08+01:00`) or UTC with `Z`, switched in the same window as
`up.sql`: writer paused, migrate, switch the writer, unpause. Builder owns this.

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
  source in SQL). What changes is the System Logs / `/api/debug/logs` times, which are
  an hour earlier under BST: the correct time (they were an hour in the future).
- healthsync workouts read the same before and after (`2026-10-20 09:25:32` naive =
  `09:25:32Z`, matching its `external_id`).
