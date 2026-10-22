# item 77 — `medications` / `medication_doses` tables (medication and supplement log)

Two new tables. Nothing existing is altered, rewritten or deleted — in particular the
old `users.medications` JSON column is **left exactly as it is**. The app imports it
into `medications` once, the first time a user has no rows, and never writes it again,
so rolling the image back restores the old Settings-tab behaviour with its data intact.

## `medications`

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer | owner |
| `name` | varchar(80) | control characters stripped, whitespace collapsed |
| `kind` | varchar(16) | `medication` or `supplement` |
| `dose` | varchar(40) | free text, e.g. `5 mg`, `2 caps` |
| `frequency` | varchar(24) | `daily`, `twice_daily`, `three_times_daily`, `weekly`, `as_needed` |
| `start_date` | varchar(10) | user's calendar day, `YYYY-MM-DD`, NULL = unknown |
| `end_date` | varchar(10) | NULL = still being taken |
| `notes` | text | at most 200 characters |
| `created_at` | timestamp | informational only |

`UNIQUE (user_id, name)`: one row per named item. Saving the same name again updates
that item rather than adding a second one.

## `medication_doses`

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer | owner (denormalised so every read filters on it directly) |
| `medication_id` | integer | the item |
| `dose_date` | varchar(10) | user's calendar day |
| `taken` | integer | `1` taken, `0` deliberately skipped |
| `created_at` | timestamp | informational only |

`UNIQUE (user_id, medication_id, dose_date)`: one entry per item per day.

**No row means nothing was said about that day.** `adherence()` counts it as
*unlogged*, not missed — an empty log is not a failed course, and a card that showed
0% for a user who simply has not started ticking would be worse than showing nothing.
That is why clearing a day deletes the row instead of writing `taken = 0`.

## Why the days are strings

A course starts on a calendar day as the user lived it, not at an instant, and a
"taken today" tick means today where they are. Storing the bare `YYYY-MM-DD` means
none of the per-source zone rules in `handoff.md` apply and no read or write ever
converts it; range reads compare strings, which sort correctly for this format.
`VARCHAR` rather than `TEXT` because MySQL cannot put an unprefixed `TEXT` column in
a UNIQUE key.

## The legacy import

`users.medications` held `[{name, dose, frequency}]` of entirely free text. An
unrecognised frequency string becomes `as_needed` — which scores **no** adherence
percentage — and the original text is kept in `notes` as `Imported frequency: …`.
Guessing `daily` instead would invent a denominator and then report a confident,
false adherence number against it. Common abbreviations (`od`, `bd`, `tds`, `prn`,
"once daily", "twice a day", …) are mapped rather than guessed.

## Running it

**Optional.** `server.ts` creates both tables at boot from its schema map, the same
way it creates every other table. `up.sql` exists so they can be created behind a
backup ahead of the deploy if preferred.

- `up.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`). Running it after the new
  image has booted is a no-op.
- `down.sql` drops both tables and every logged dose. Roll the image back first, or
  the new `server.ts` recreates empty tables at its next boot. The old JSON column
  still holds the pre-import list, so a rollback loses the per-day log but not the
  medication list itself.

## Checked here

- `up` → `up` (no-op) → `down` → `up` against the live Postgres `health` database on
  ser5, all exit 0, and the resulting definition matches what `server.ts` creates at
  boot through `translateSql`.
- Routes exercised end to end against that database: create, update by same name,
  tick/skip/clear a day, adherence window, delete, legacy import, AI context.
- **Not checked: MySQL/MariaDB.** No server available. The definitions were chosen
  for it (`VARCHAR` in the unique keys) and the writes avoid `INSERT OR REPLACE`,
  which `translateSql` maps to `REPLACE INTO` on MySQL and `DO NOTHING` on Postgres.
