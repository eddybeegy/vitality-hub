# item 49 — drop the duplicate unique indexes on `metrics` and `meal_items`

Sweep item 49: *`metrics` carries 3 identical unique indexes and `meal_items` carries 4.*

## Why

Every unique index is maintained on every insert and on every update that touches
one of its columns, and every `ON CONFLICT` probes all of them. Three copies of
`(user_id, type, timestamp, source)` on a 1.69M-row table is three B-trees to write
and to keep in cache for the work of one, and `meal_items` pays four times over.
Nothing reads the extras: the planner picks one of them, and it can pick the one
that stays.

## Which index is kept, and why

| table | kept | columns |
|---|---|---|
| `metrics` | `metrics_unique_idx` | `(user_id, type, timestamp, source)` |
| `meal_items` | `meal_items_unique_idx` | `(user_id, timestamp, name, source)` |

These are the two the application itself owns. `server.ts` runs
`CREATE UNIQUE INDEX IF NOT EXISTS metrics_unique_idx` and `... meal_items_unique_idx`
on **every boot** (in `initDb`, and again in the startup cleanup). `IF NOT EXISTS`
matches by name only, so dropping either one would bring it straight back at the
next restart, as a plain non-concurrent build that blocks writes for the length of
the build, and the migration would have undone itself. Keeping them is the only
choice that sticks.

Everything else goes. One of the copies per table is normally the index behind the
inline `UNIQUE(...)` in the `CREATE TABLE` (Postgres names it
`metrics_user_id_type_timestamp_source_key` / `meal_items_user_id_timestamp_name_source_key`);
that one has to be dropped as a constraint, not an index. That is safe: every
`ON CONFLICT` in the app (`src/lib/db.ts` translation, `modules/apple_health.ts`,
`server.ts`) names a column list or none at all, never `ON CONSTRAINT <name>`, and
Postgres resolves a column list against any matching unique index.

The other names are **not hard-coded**. This repo never creates them, so they came
from somewhere outside it, and a cloud session cannot see the live catalog.
`up.sql` finds the duplicates by comparing definitions: two indexes match only when
`pg_get_indexdef()` is identical once the name is removed, i.e. same table, same
columns in the same order, same method, opclass, collation, sort order and no
partial predicate. A unique index on the same columns in a different order, or a
partial one, is left alone (the self-test proves both).

`metrics_user_type_idx (user_id, type)` is a prefix of the kept index and is
arguably redundant as well. It is not identical, the planner costs the two
differently, and it is out of scope here.

## Before running: one thing only the host can check

`kb-health` (the healthsync writer, not in this repo) writes `metrics` directly.
If its upsert says `ON CONFLICT ON CONSTRAINT metrics_user_id_type_timestamp_source_key`
rather than `ON CONFLICT (user_id, type, timestamp, source)`, dropping that
constraint breaks every healthsync write. Grep its source for `ON CONSTRAINT` first.
A column-list `ON CONFLICT` (or none) is fine.

## Running it

```sh
cd /opt/build/vitality-hub/migrations/item-49-duplicate-indexes
PW=$(grep -E '^(DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_PASSWORD)=' ../../.env | head -1 | cut -d= -f2-)
PSQL="docker exec -i postgres env PGPASSWORD=$PW psql -h localhost -U vitality -d health -v ON_ERROR_STOP=1"

$PSQL -f - < preflight.sql   # READ IT: section 3 all t, section 4 is the drop list, section 5 empty
$PSQL -f - < up.sql
```

What to check in the preflight before going on:

1. **Section 2** shows the duplicate groups. Expected from the sweep: `metrics` n = 3,
   `meal_items` n = 4.
2. **Section 3**: both keepers `exists`, `uniq`, `valid`, `ready` all `t`. `up.sql`
   refuses to run otherwise, because dropping the copies while the keeper is missing
   or INVALID would leave the table with no uniqueness at all.
3. **Section 4** is exactly what `up.sql` will drop: expected 2 rows for `metrics`
   and 3 for `meal_items`. If a name there surprises you, stop.
4. **Section 5** must be empty: no foreign key may depend on an index being dropped.
5. **Section 6** lists sessions holding locks on either table right now. A long
   transaction here will make step 3 of `up.sql` time out (harmless, re-run).

`up.sql` writes what it drops, with the full definition, to a small manifest table
`item49_dropped_indexes` **before** dropping anything. That is what `down.sql`
replays, so leave the table in place until you are sure you will not roll back.
Drop it by hand afterwards (`DROP TABLE item49_dropped_indexes;`), or let a
successful `down.sql` drop it.

`down.sql` rebuilds each dropped index concurrently under its original name and
re-attaches the constraint ones with `ADD CONSTRAINT ... UNIQUE USING INDEX`, so it
needs no scan beyond the index builds themselves. On `metrics` that is a full index
build per index, a minute or so each; reads and writes carry on throughout.

## Locking

**`CONCURRENTLY` cannot run inside a transaction block.** Both `up.sql` and
`down.sql` must run in psql's default autocommit mode: do not pass `-1` /
`--single-transaction`, and do not wrap either file in `BEGIN` / `COMMIT`. Each
generated statement is executed by `\gexec` and autocommits on its own. Unlike item
14, there is no way to make this atomic; instead every step is re-runnable and
skips what is already done.

- **Plain duplicate indexes**: `DROP INDEX CONCURRENTLY`, one per statement. Takes
  `SHARE UPDATE EXCLUSIVE`, so reads and writes carry on. It waits for every
  transaction already using the table to finish, so a long transaction makes it slow,
  not blocking. If it is interrupted the index can be left INVALID (still there,
  unused); re-running `up.sql` drops it.
- **The constraint-backed duplicate**: there is no `DROP CONSTRAINT CONCURRENTLY`.
  `ALTER TABLE ... DROP CONSTRAINT` takes `ACCESS EXCLUSIVE`. The drop itself is
  catalog-only and instant, but the lock request queues behind any open transaction
  on the table and stalls everyone behind it while it waits. `up.sql` sets
  `lock_timeout = '5s'` for that statement only; if it trips, nothing has changed and
  you re-run. Pausing `kb-health` for the few seconds this takes is not required,
  but removes the only regular writer it can collide with.
- `down.sql` mirrors this: `CREATE UNIQUE INDEX CONCURRENTLY` (no write blocking),
  then a brief `ACCESS EXCLUSIVE` under the same 5 s `lock_timeout` to re-attach the
  constraint.

## Self-test

```sh
PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
```

Builds a throwaway database with the app's DDL plus extra copies under arbitrary
names (one quoted), and two near misses that must survive (different column order,
partial). Then preflight, up, checks that exactly the duplicates went and the
keepers, near misses and row counts did not, checks uniqueness is still enforced and
the app's `ON CONFLICT (cols) DO UPDATE` and `ON CONFLICT DO NOTHING` forms still
resolve, up again (no-op), down (every name and both constraints back, manifest
gone), up after down, and finally that `up.sql` refuses without its keeper. Needs a
role that can `CREATE DATABASE`; never touches an existing database.

## Not covered

A fresh install still creates two copies per table (the inline `UNIQUE(...)` in
`server.ts`'s `CREATE TABLE` plus the named index). Fixing that is application code
and out of scope for this PR; it only matters for new databases.
