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

**Rule.** Only `source = 'healthsync'`, only the types in the `scope` block (today:
`blood_pressure_systolic` and `blood_pressure_diastolic`). A blood-pressure *reading*
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

**Accepted trade-off.** Two genuinely separate cuff readings with the same two
numbers on the same day count as one. Kieron's decision accepts that.

## Other healthsync types

From the repo alone I cannot tell whether other healthsync types carry copies.
Preflight section 1 lists every healthsync type with its copy count, the number of
distinct values on an average day, and a verdict:

- `IN SCOPE` — handled by this run.
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
table `item71_dedupe_scope`, so a type can be added without redeploying. Two things
to know: kb-health's `INSERT ... RETURNING` (if it uses one) still gets an id back
for a row the trigger then removes, and a copy is removed rather than refused, so
kb-health sees success either way.

## Self-test

```
PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
```

Seeds the live 09-09 case (8 copies), a day with two real readings sharing a
diastolic, the same reading on the next day, a second user, apple_health and
withings copies, a half with no partner, an ambiguous half, heart-rate repeats,
summed steps and apple_health nutrition. Checks preflight writes nothing; `up`
removes exactly the 22 copy rows, keeps the earliest, orphans nothing and touches
nothing else; `up` again is a no-op; `down` restores the table byte for byte;
`up` refuses a summed or nutrition type in scope; the guard removes copies written
as one or two statements, keeps a new reading that shares one number, a new day,
other sources and out-of-scope types; `down` removes the guard.
