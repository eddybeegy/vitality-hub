# item 49 — drop the duplicate indexes on `metrics`, `meal_items` and `workouts`

Sweep item 49 said 3 identical unique indexes on `metrics` and 4 on `meal_items`.
builder's live survey (2026-10-21 13:30, `progress.md` row 49) found the scope is
wider: identical **non-unique** copies too, and `workouts` as well. For scale,
`metrics` is a 148 MB table carrying 600 MB of indexes; the duplicates are about
247 MB and three extra index writes per inserted `metrics` row.

## Why

Every index is maintained on every insert and on every update that touches one of
its columns, and every `ON CONFLICT` probes every unique index. A second copy of an
identical index costs a full write and its share of cache for nothing: the planner
uses one of them, and it can use the one that stays.

## Which copy is kept, and why

**Kept: the name `server.ts` creates on every boot.** For these three tables that
is:

| table | kept (server.ts creates it by name at boot) |
|---|---|
| `metrics` | `metrics_unique_idx`, `metrics_user_type_idx`, `metrics_user_timestamp_idx`, `metrics_user_source_idx`, `metrics_user_source_ts_idx`, `metrics_timestamp_idx` |
| `meal_items` | `meal_items_unique_idx`, `meal_items_user_ts_idx` |
| `workouts` | `workouts_user_ts_idx` |

The per-table block in `server.ts`'s `CREATE TABLE` loop creates each of these with
`CREATE [UNIQUE] INDEX IF NOT EXISTS <name>` on every boot, and the startup cleanup
creates the two unique ones again. Grep for the names, since line numbers shift.
After this PR's `server.ts` change (next section), nothing else at boot creates
these shapes. `IF NOT EXISTS` matches by **name only**, so dropping one of these
names would get it rebuilt at the next restart, as a plain non-concurrent build that
blocks writes for its whole duration (106 MB on `metrics`).

**Dropped: every other index on the same table with an identical definition.**
Two indexes match only when `pg_get_indexdef()` is the same once the name is taken
out: same uniqueness, columns in the same order, method, opclass, collation, sort
order, no partial predicate. The keepers are the only names written into the SQL.
The duplicates are found by comparison, so the drop list is whatever the database
actually holds, and preflight section 4 prints it. On a database in the state builder
surveyed (before any run), it comes out as the table below. The live database has
since lost the two `*_key` rows; see "Live state".

| table | dropped | kind | how |
|---|---|---|---|
| `metrics` | `metrics_user_id_type_timestamp_source_key` | UNIQUE constraint | `ALTER TABLE ... DROP CONSTRAINT` |
| `metrics` | `idx_metrics_unique` | plain unique index | `DROP INDEX CONCURRENTLY` |
| `metrics` | `idx_metrics_user_ts` (and `metrics_user_ts` if present) | plain index | `DROP INDEX CONCURRENTLY` |
| `meal_items` | `meal_items_user_id_timestamp_name_source_key` | UNIQUE constraint | `ALTER TABLE ... DROP CONSTRAINT` |
| `meal_items` | `idx_meal_items_unique` and any other identical unique copy | plain unique index | `DROP INDEX CONCURRENTLY` |
| `meal_items` | `idx_meal_items_user_ts` | plain index | `DROP INDEX CONCURRENTLY` |
| `workouts` | `idx_workouts_user_ts` | plain index | `DROP INDEX CONCURRENTLY` |

The `*_key` indexes back `contype='u'` constraints. `DROP INDEX` refuses them, which
is why `up.sql` removes them with `ALTER TABLE ... DROP CONSTRAINT` (a different
statement, see Locking). Preflight section 1 labels every index as `UNIQUE
constraint`, `plain unique index`, `plain index` or `PRIMARY KEY`, and section 4
says how each drop will be done.

**Nothing writes against a constraint name.** builder checked kb-health
(`/app/index.mjs:148` and `:261`) and the repo (`modules/apple_health.ts:45`,
the `metrics` upsert in `server.ts`, `modules/apple_workouts.ts:23`, the `src/lib/db.ts` translation).
They all use column-inference `ON CONFLICT (cols)`, or none at all, so any one
non-partial unique index on exactly those columns satisfies them. The keepers are
exactly those column lists.

Settled by Kieron on 2026-10-21, from the boot code and the live catalog: the
`*_idx` family is the server's own set and stays; the `idx_*` family are strays from
an older sweep that nothing recreates, and they go.

## Why a migration alone could not stick: two creators at boot

`server.ts` created these indexes from **two** places, and both run on **every** boot:

- the per-table block inside the `CREATE TABLE IF NOT EXISTS` loop, which creates the
  `*_idx` names, and
- the declarative `indexes` array further down, which created the `idx_*` names.

Both use `IF NOT EXISTS`, which matches by name only, and five array entries had
the same shape as a per-table index: `idx_metrics_unique`, `idx_metrics_user_ts`,
`idx_workouts_user_ts`, `idx_meal_items_user_ts` and `idx_meal_items_unique`. So
whichever copy a migration dropped, the next boot rebuilt it, non-concurrently and
blocking writes for the build. That is also how the duplicates arose in the first
place.

This is exactly what happened to PR #16's run. `up.sql` **completed** at 13:27: both
`*_key` constraints and `idx_metrics_unique` / `idx_meal_items_unique` were dropped.
A later restart then rebuilt the two `idx_*` uniques. Their oids, 122453 and 122454,
are the highest on these tables, which is how builder established it. (This README
previously called the run "half applied". That was wrong.) The only part of the
saving that stuck was the constraint index, which nothing at boot recreates.

**This PR therefore changes `server.ts` first.** It deletes those five entries from
the `indexes` array, leaving the per-table block as the single creator of the
keepers. `server.indexes.test.ts` reads `server.ts` and fails if any shape is
created under two names, if a keeper loses its creator, or if a dropped name comes
back.

**Order on the host: merge, deploy, and only then run `up.sql`.** Run it before
the new `server.ts` is live and the next restart undoes the drops again.

Two `workout_*` pairs have the same problem and are left alone here, because the
item covers `metrics`, `meal_items` and `workouts` only. They are
`workout_ex_workout_idx` vs `idx_workout_exercises_workout_id`, and
`workout_sets_ex_idx` vs `idx_workout_sets_exercise_id`. Both are real
duplicates and both are tiny. The test lists them as known exceptions, so they
are visible and a new duplicate still fails.

## Re-running on the live database

The manifest from the 13:27 run has no `dropped_at` column, and it lists two rows
whose index exists again. This version handles that:

- The manifest gains a `dropped_at` column, stamped by the statement **after** each
  drop commits, so an interrupted drop is never marked as done. For an old
  manifest, `up.sql` backfills `dropped_at` from the catalog: an index that is gone
  counts as dropped, and one that exists, including one a boot rebuilt, is left to
  do.
- Every drop is generated only while **another valid index of exactly the same
  shape, not itself on the drop list,** is still there. That is checked against the
  live catalog at the moment of generation. So no re-run, whatever the manifest
  says, can leave `metrics` without a unique index on
  `(user_id, type, timestamp, source)`. The self-test feeds it a manifest that lists
  `metrics_unique_idx` itself, and checks that it refuses.
- `up.sql` ends by listing manifest rows that are still not dropped. Expect 0.
- `down.sql` lists manifest rows whose index exists again (nothing to restore),
  then restores only what is really missing.

Once the new `server.ts` is deployed, re-running `up.sql` should:

1. Backfill `dropped_at` on the two `*_key` rows.
2. Add `idx_metrics_user_ts`, `idx_meal_items_user_ts` and `idx_workouts_user_ts`
   to the manifest.
3. Skip the constraint step, because there are no constraints left.
4. Run `DROP INDEX CONCURRENTLY` on five indexes: `idx_metrics_unique` (105 MB),
   `idx_metrics_user_ts` (35 MB), `idx_meal_items_unique`, `idx_meal_items_user_ts`
   and `idx_workouts_user_ts`. That frees about 141 MB, and this time it survives
   a restart.

`idx_meal_items_user_ts` (244 scans) and `idx_workouts_user_ts` (125) are the
copies the planner happened to use, with their twins on 0 scans. That is fine:
the definitions are identical, so the planner moves to the twin.

## Uniqueness: index only, no constraint (a decision, not a side effect)

On the live database `metrics` and `meal_items` no longer carry a UNIQUE
*constraint*, only a unique *index* (`metrics_unique_idx`, `meal_items_unique_idx`).
That is deliberate, and it is kept:

- A unique index enforces exactly the same rule. Every writer uses column-inference
  `ON CONFLICT (cols)`, which binds to a unique index and never needs a constraint.
  builder's duplicate-insert check passed after the drop for that reason.
- Restoring a constraint (`ADD CONSTRAINT ... UNIQUE USING INDEX metrics_unique_idx`)
  would rename the index to the constraint name. Boot would then rebuild
  `metrics_unique_idx` alongside it, which recreates the duplicate. A constraint
  could only come back under the index's own name, and it would buy nothing a
  writer uses.

Fresh installs are different: the inline `UNIQUE(...)` in `server.ts`'s
`CREATE TABLE` still adds a `*_key` constraint next to `metrics_unique_idx`, so a new
deployment starts with that pair again. That is harmless here and out of scope. A
fresh database can run this migration too.

## Bloat, separately from duplication

On the live database the boot-rebuilt `idx_meal_items_unique` is 256 kB, against
1072 kB for `meal_items_unique_idx`, with the same definition. The rebuilt copy is
fresh and the long-lived one has accumulated bloat. Part of what looks like
duplicate cost on long-lived indexes is therefore bloat, which a
`REINDEX INDEX CONCURRENTLY` would reclaim independently of this item. That is not
done here.

## Do NOT drop the prefix indexes

A duplicate sweep walks straight into this, so it is stated here to stop anyone
raising it again. **Prefix redundancy is not duplication.**

- `metrics_user_type_idx (user_id, type)`, 12 MB, is a strict prefix of
  `idx_metrics_user_type_ts (user_id, type, timestamp)`, 77 MB. It has **45,186
  scans** against its parent's 2,424.
- `metrics_user_source_idx (user_id, source)`, 12 MB with 9,915 scans, is a prefix
  of `metrics_user_source_ts_idx`, 49 MB with 61 scans.

The planner is correctly picking the small index. Drop it and those scans move to
one four to six times the size. This migration only ever drops an exact duplicate
of a keeper, so neither of these is touched; the self-test includes the live prefix
pair and checks that it survives.

## Running it

```sh
cd /opt/build/vitality-hub/migrations/item-49-duplicate-indexes
PW=$(grep -E '^(DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_PASSWORD)=' ../../.env | head -1 | cut -d= -f2-)
PSQL="docker exec -i postgres env PGPASSWORD=$PW psql -h localhost -U vitality -d health -v ON_ERROR_STOP=1"

$PSQL -f - < preflight.sql   # READ IT first
$PSQL -f - < up.sql
```

Run `up.sql` **without a client-side timeout** around the `docker exec`.
`DROP INDEX CONCURRENTLY` waits for every transaction already open on the table,
so it can legitimately sit for a while. If the session does get cut off, the fix is to re-run,
nothing else.

What to check in the preflight before going on:

1. **Section 2** lists every index shape held more than once.
2. **Section 3**: both unique keepers read `t` for `exists`, `uniq`, `valid` and
   `ready`. `up.sql` refuses to run otherwise, because dropping the copies while the
   keeper is missing or INVALID would leave the table with no uniqueness at all.
   A missing *non-unique* keeper is not fatal: its duplicates are simply left alone.
3. **Section 4** is exactly what `up.sql` will drop, with the kept index each one
   duplicates, how it will be dropped, its size and scan count, the total freed,
   and `fk_dependents` (must be 0). If a name there surprises you, stop.
4. **Section 5** lists sessions holding locks on the tables right now. A long
   transaction here will make step 3 of `up.sql` time out. That is harmless; re-run.

The last block of `up.sql` lists any index shape still held more than once. It
should return 0 rows.

`up.sql` writes what it drops, with the full definition, to a small manifest table
`item49_dropped_indexes` **before** dropping anything. That is what `down.sql`
replays, so leave the table in place until you are sure you will not roll back.
Then drop it by hand (`DROP TABLE item49_dropped_indexes;`), or let a successful
`down.sql` drop it. `dropped_at` is set only after a drop commits, so a row with it
empty was not dropped.

`down.sql` rebuilds each dropped index concurrently, unique or not, under its
original name, and re-attaches the constraint ones with `ADD CONSTRAINT ... UNIQUE
USING INDEX`. On `metrics` each rebuild is a full index build of a minute or so, and
reads and writes carry on throughout.

## Locking

**`CONCURRENTLY` cannot run inside a transaction block.** Both `up.sql` and
`down.sql` must run in psql's default autocommit mode: do not pass `-1` /
`--single-transaction`, and do not wrap either file in `BEGIN` / `COMMIT`. Each
generated statement is executed by `\gexec` and autocommits on its own. Unlike item
14 this cannot be atomic, so instead every step is re-runnable and skips what is
already done.

- **Plain indexes**: `DROP INDEX CONCURRENTLY`, one per statement. This takes
  `SHARE UPDATE EXCLUSIVE`, so reads and writes carry on. It waits for every
  transaction already using the table to finish, so a long transaction makes it slow
  but does not block anyone. If interrupted it can leave the index INVALID (still
  there, unused); re-running `up.sql` drops it.
- **UNIQUE constraints**: there is no `DROP CONSTRAINT CONCURRENTLY`.
  `ALTER TABLE ... DROP CONSTRAINT` takes `ACCESS EXCLUSIVE`. The drop itself is
  catalog-only and instant, but the lock request queues behind any open transaction
  on the table, and everyone behind it stalls while it waits. `up.sql` sets
  `lock_timeout = '5s'` for those statements only. If it trips, nothing has changed;
  re-run. Pausing `kb-health` for those few seconds is not required, but it removes
  the only regular writer it can collide with.
- `down.sql` mirrors this: `CREATE INDEX CONCURRENTLY` (no write blocking), then a
  brief `ACCESS EXCLUSIVE` under the same 5 s `lock_timeout` to re-attach each
  constraint.

## Self-test

```sh
PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
```

Builds a throwaway database with the app's DDL, its boot-time indexes and the live
extra copies builder found: constraint-backed, `idx_*`, a third `metrics_user_ts`,
and one quoted name. It also adds things that must survive: the live prefix pair,
a reordered unique index, a partial one, and a non-unique twin of a unique shape.

It then checks, in order:

1. `preflight.sql` and `up.sql` select the same drop list (identical text between
   the `drop-selection` markers).
2. Preflight labels constraints and plain indexes correctly.
3. `up.sql` drops exactly the 9 duplicates with row counts unchanged.
4. Uniqueness is still enforced, and the app's `ON CONFLICT (cols) DO UPDATE`,
   `ON CONFLICT DO NOTHING` and `ON CONFLICT (external_id)` forms still resolve.
5. Running `up.sql` again changes nothing.
6. `down.sql` restores every name, uniqueness flag and both constraints, and drops
   the manifest.
7. `up.sql` works again after a down.
8. **The live state after the 13:27 run and a restart**: a first-version manifest
   with no `dropped_at`, both constraints gone and the `idx_*` uniques rebuilt. A plain re-run
   finishes the job and leaves all 9 manifest rows stamped.
9. A manifest that lists `metrics_unique_idx` itself is refused: the last unique
   index is never dropped, and the row stays unstamped.
10. `down.sql` works from that state.
11. `up.sql` refuses to run without its unique keeper.

It needs a role that can `CREATE DATABASE` and never touches an existing database.

## Not covered

A fresh install still creates two copies of each unique shape (the inline
`UNIQUE(...)` in `server.ts`'s `CREATE TABLE` plus the named index). Fixing that is
application code and out of scope here; it only matters for new databases.
