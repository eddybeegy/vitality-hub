# item 14 — `ON DELETE CASCADE` foreign keys from every user-scoped table to `users`

Sweep item 14: *deleting a user orphans their health data.*

## Why

Before this migration the schema had **not one** foreign key to `users`. The only
FKs in the database were `workout_exercises → workouts`, `workout_sets →
workout_exercises`, `routine_exercises → routines` (all already `ON DELETE
CASCADE`) and the unrelated `webui.*` ones belonging to Open WebUI, which shares
this database.

So `DELETE FROM users WHERE id = ?` left every one of that user's rows behind, and
because every query in the app is scoped by `user_id`, the leftovers were invisible.
User 3 was deleted months ago and left **11,945 `metrics` rows** (cronometer,
2026-02-20 → 2026-05-21), **1,012 `meal_items`** and 2 `logs` rows. Nobody noticed
for five months.

`server.ts` already centralises the delete (`purgeAllUserData` over
`USER_SCOPED_TABLES`, called inside the same transaction as the `DELETE FROM
users`). That is correct but forgettable: the next table someone adds with a
`user_id` has to be remembered by hand. These constraints make it unforgettable.

## Ordering: the orphans must go first

`ALTER TABLE ... VALIDATE CONSTRAINT` fails while a violating row exists. The user-3
rows were dumped to CSV and removed on 2026-10-21 on Kieron's explicit instruction
(Telegram, Tier 1, 12:07 — "delete them, after a dump of just those rows").

Dump location: `/opt/vitality/item14-orphan-dump-20261021-130103/`
(`metrics.csv` 11,945 rows, `meal_items.csv` 1,012, `logs.csv` 2, each with a header).
`down.sql` drops the constraints but does **not** put those rows back — restoring
them means `\copy` from those CSVs.

## `logs` is `SET NULL`, not `CASCADE`

Deliberate. `logs` is an audit trail, and the record of what an account did is
exactly what you want to keep after deleting the account. The column is already
nullable — 282 system rows are `NULL` today — so `ON DELETE SET NULL` costs nothing
and loses nothing.

One consequence worth knowing: `logs.user_id` is now constrained, so **logging a
user id that does not exist fails**. `/health-export` is not cookie-authenticated
and used to log `req.query.userId` verbatim when it rejected a bad token — a
claimed, unvalidated id. `logEvent` catches and swallows its own errors, so that
would have silently dropped the one row you most want to keep: the rejected export
attempt. That call site now puts the claimed id in the message text and passes no
`user_id`. The two historical rows (claimed ids `2` and `-1`, both from a
2026-10-19 token probe) were migrated the same way rather than deleted.

## `*_bak_*` tables get no constraint

`information_schema` also reports `ai_configs_bak_20261019` as carrying a `user_id`.
Manual backup tables are deliberately left unconstrained — surviving a purge is the
whole point of them.

## Running it

```sh
cd /opt/build/vitality-hub/migrations/item-14-user-fks
PW=$(grep -E '^(DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_PASSWORD)=' ../../.env | head -1 | cut -d= -f2-)
PSQL="docker exec -i postgres env PGPASSWORD=$PW psql -h localhost -U vitality -d health -v ON_ERROR_STOP=1"

$PSQL -f - < preflight.sql   # every orphan count must read 0
$PSQL -f - < up.sql
./selftest.sh                # proves the cascade, the SET NULL and the reject
```

`up.sql` runs **without** an explicit transaction, on purpose. Each `ADD CONSTRAINT
... NOT VALID` takes a brief `ACCESS EXCLUSIVE` lock and does not scan the table;
the separate `VALIDATE CONSTRAINT` scans under `SHARE UPDATE EXCLUSIVE`, which
blocks neither reads nor writes. On `metrics` (1.69M rows) that is the difference
between a multi-second write stall and none. Wrapping the whole file in one
transaction would hold the exclusive locks for the duration of every validation and
defeat the point.

## Cascade performance

Every constrained table already had an index with `user_id` as its leading column,
so a cascade uses an index rather than a sequential scan — except `routines`, which
did not. `up.sql` adds `routines_user_id_idx`. 80 rows today, but it keeps the set
uniform and costs nothing.
