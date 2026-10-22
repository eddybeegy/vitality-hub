# item 71 — remove the duplicate HealthSync blood-pressure readings

Kieron's call, 2026-10-21 20:51: **remove the duplicates.**

## What is wrong

`kb-health` (the healthsync writer, a container on the deploy host, not in this repo)
writes straight into `metrics` and stamps each row with the **sync time**, not the
time the reading was taken. Every re-sync of the same cuff reading therefore arrives
with a new timestamp, passes `metrics_unique_idx (user_id, type, timestamp, source)`,
and is stored again. builder's survey (tracker row 71): healthsync holds only two
distinct BP values in the whole table, 103/68 (37 copies, 2026-08-24..09-13) and
99/65 (29 copies, 09-17..10-19). 2026-09-09 alone has eight identical 103/68 rows,
stamped 08:26:47 through 11:03:35.

The copies are load-bearing in two places: `chooseSource` breaks rank ties on row
count (healthsync and withings are both rank 4), and item 69's "latest reading of
the day" resolves to the last *sync* on a healthsync day.

## What the scripts do

| file | what | writes? |
|---|---|---|
| `preflight.sql` | survey + exactly what `up.sql` would delete | no (rolled back) |
| `up.sql` | copies the duplicates into `item71_removed_metrics`, then deletes them from `metrics` | yes, one transaction |
| `guard.sql` | **optional** trigger that removes new copies as kb-health writes them | yes |
| `down.sql` | drops the guard, restores every removed row with its original id | yes |
| `selftest.sh` | all of the above against a throwaway database | throwaway only |

**Rule.** Only `source = 'healthsync'`, only the types in the `scope` block:
`blood_pressure_systolic` and `blood_pressure_diastolic` (kind `bp`), and, since the
follow-up PR, `body_fat`, `bmi`, `lean_body_mass`, `height`, `respiratory_rate` and
`heart_rate_recovery` (kind `single`; see "Other healthsync types"). A blood-pressure *reading*
is a systolic and a diastolic stamped within 2 s of each other (healthsync writes
them 1-8 ms apart; same window as `src/lib/bpLatest.ts`). Two readings are copies
when both numbers and units match on the same London day (healthsync metrics are
London wall-clock, so the stored date is the London date). The **earliest** copy of
each reading is kept, because it is the closest to when the cuff was used. Both
halves of a copy go together, so no half is ever orphaned. A half with no partner,
or with two partners inside the window, is left alone.

Never touched: any other source (apple_health's two 99/65 on 09-17 and withings'
are shown in preflight section 5 for information only), any type outside the scope,
any summed or nutrition type (`up.sql` and `guard.sql` refuse to run if one is ever
put in the scope).

**Accepted trade-off.** Two genuinely separate readings with the same value(s) on the
same London day count as one. Kieron's decision accepts that. It is weakest for two of
the single types: `heart_rate_recovery` is per workout, so two workouts on one day
with the same recovery value collapse to one, and `respiratory_rate` the same if it is
ever written per sleep session rather than per night. Both are in scope on the live
evidence (below), and every row either script removes is kept in
`item71_removed_metrics`, so a misjudged one can be found and put back.

## Other healthsync types

builder ran preflight on live (2026-10-21, PR #44) and Kieron said to widen it. Six
types showed the BP shape:

| type | rows | days | copies | values/day | worst group |
|---|---|---|---|---|---|
| respiratory_rate | 117 | 57 | 54 | 1.1 | 8 |
| body_fat | 80 | 39 | 39 | 1.1 | 8 |
| bmi | 78 | 38 | 38 | 1.1 | 8 |
| lean_body_mass | 78 | 38 | 38 | 1.1 | 8 |
| heart_rate_recovery | 65 | 31 | 34 | 1.0 | 8 |
| height | 65 | 31 | 34 | 1.0 | 8 |

The worst group is 8 for every one of them and for BP: one sync event (2026-09-09)
re-stamped every type eight times. That makes the copies sync artefacts, not data,
and `height` (which does not change) carrying the same 34 copies over 31 days as
`heart_rate_recovery` is the cleanest proof of it. `heart_rate_recovery` at exactly 1.0
values a day has never held two different values on one day, so there is no sign of
two workouts a day being recorded; `respiratory_rate`'s 1.1 means a few days do hold a
second, different value, which the rule keeps (only an equal value is a copy). Both
go in, with the trade-off above.

Preflight section 1 lists every healthsync type with its copy count, the number of
distinct values on an average day, and a verdict:

- `IN SCOPE` — handled.
- `looks like re-sync copies - candidate` — about one value a day and copies > 0;
  the spot-measurement shape (weight, body fat, a daily resting HR). To include one,
  add `('<type>', 'single')` to the `scope` block in **all three** files (selftest
  checks they match) and re-run preflight.
- `natural repeats - leave` — many values a day (heart_rate); equal values are real
  readings and must not be deduplicated by value.
- `summed type - never by value` — steps and friends; equal increments are real.

## Order on the host (builder)

1. `psql -X -v ON_ERROR_STOP=1 -f preflight.sql` and read it. Section 3 is the
   delete list; `not_healthsync_must_be_0` must be 0. Section 4 shows, per BP day,
   what remains. Expected from row 71's numbers (a prediction, not measured): about
   50 pairs (≈100 rows) removed, one reading left per healthsync BP day.
2. `psql -X -v ON_ERROR_STOP=1 -f up.sql`. It holds `SHARE ROW EXCLUSIVE` on
   `metrics` for its transaction, which blocks writes (not reads) for well under a
   second, so kb-health cannot slip a copy in mid-run. It refuses and rolls back if
   the backup count and the delete count disagree. Running it twice is a no-op.
3. Optional, and only if Kieron wants it before kb-health is fixed: `guard.sql`.
4. Check the BP widget and `/api/ai/data`: the displayed values should not change
   (every removed row repeats a kept one); the `rows` counts for healthsync BP days
   drop to 1.
5. Keep `item71_removed_metrics` until satisfied, then `DROP TABLE` it. `down.sql`
   is the undo while it exists.

## The guard, and what cannot be fixed from here

The real fix is in kb-health, which this repo cannot change: stamp each row with the
HealthKit sample's own date instead of the sync time. Then the existing unique index
and kb-health's `ON CONFLICT` turn every re-sync into a no-op, and item 69's
"latest" orders by measurement time. That is builder's, alongside item 19.

`guard.sql` is the in-database stopgap. An `AFTER INSERT` row trigger, `WHEN
(NEW.source = 'healthsync')`, so the apple_health bulk pushes never call it. For a
BP half it waits until the partner half is stored, then removes the new pair if an
earlier pair that day has the same two numbers. It reads its scope from the small
table `item71_dedupe_scope`, so a type can be added without redeploying. Every row it
removes is first copied into `item71_removed_metrics` (the table `up.sql` fills,
created by `guard.sql` if it is missing) and logged at `LOG` level, so nothing the
trigger removes goes unrecorded, and `down.sql` restores those rows too. Re-running
`guard.sql` picks up a changed scope block. Two things to know: kb-health's `INSERT ... RETURNING` (if it uses one) still gets an id back
for a row the trigger then removes, and a copy is removed rather than refused, so
kb-health sees success either way.

## Time zone

On live, `metrics.timestamp` is `timestamptz` (item 13). The day rule is the London
date: `preflight.sql` and `up.sql` `SET LOCAL TIME ZONE 'Europe/London'` before
`CAST(... AS date)`, and the guard function carries `SET timezone = 'Europe/London'`,
so a writer session in UTC still gets London days. On a naive `timestamp` column
(the app's own DDL) the stored value already is London wall-clock for healthsync.

## Self-test

```
PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
```

Runs twice, with `metrics.timestamp` as `timestamp` and as `timestamptz`. Seeds the
live 09-09 case (8 copies), a day with two real readings sharing a
diastolic, the same reading on the next day, a second user, apple_health and
withings copies, a half with no partner, an ambiguous half, single-type copies (height re-synced,
respiratory_rate with a second real value, body_fat on two days, bmi either side of
London midnight), heart-rate repeats,
summed steps and apple_health nutrition. Checks preflight writes nothing; `up`
removes exactly the 22 copy rows, keeps the earliest, orphans nothing and touches
nothing else; `up` again is a no-op; `down` restores the table byte for byte;
`up` refuses a summed or nutrition type in scope; the guard removes copies written
as one or two statements, keeps a new reading that shares one number, a new day,
other sources and out-of-scope types, respects London midnight for a UTC writer
session, and copies every row it removes into `item71_removed_metrics`; `down`
restores those too and removes the guard.
