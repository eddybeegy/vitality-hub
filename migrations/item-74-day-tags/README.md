# item 74 — `day_tags` table (roadmap feature 4, day tags)

One new table. Nothing existing is altered, rewritten or deleted.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer | owner |
| `tag_date` | varchar(10) | the user's calendar day, `YYYY-MM-DD`, stored as given |
| `tag` | varchar(32) | slug: `ill`, `travel`, `alcohol`, `late_meal`, `poor_sleep_env`, or a custom one |
| `note` | text | optional, at most 200 characters, control characters stripped |
| `created_at` | timestamp | `CURRENT_TIMESTAMP`, informational only |

`UNIQUE (user_id, tag_date, tag)`: one row per tag per day. Saving the same tag again
updates its note in place.

## Why the day is a string

A tag belongs to a calendar day as the user lived it, not to an instant. Storing the
bare day means none of the per-source zone rules in `handoff.md` apply (metrics
London-for-healthsync, workouts UTC, logs London) and no read or write ever converts
it. Range reads compare strings, which sort correctly for `YYYY-MM-DD`.

## Running it

**Optional.** `server.ts` creates the identical table at boot from the `day_tags`
entry in its schema map, the same way it creates every other table. `up.sql` exists
so the table can be created behind a backup ahead of the deploy if preferred.

- `up.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`). Running it after the new
  image has booted is a no-op.
- `down.sql` drops the table and every tag in it. Roll the image back first, or the
  old-new `server.ts` recreates an empty table at its next boot.

## Checked here (cloud session, no host access)

- On a local Postgres 16: `up` → `up` (no-op with a NOTICE) → `down` → `up` all exit 0,
  and `\d day_tags` from `up.sql` is **identical** to the table `server.ts` creates at
  boot through `translateSql` (same columns, types, defaults, PK and unique constraint).
- The app's routes were exercised end to end against that boot-created Postgres table
  and against SQLite (save, re-save with a changed note, range read, delete, AI data).
- **Not checked: MySQL/MariaDB.** No server available. The definition was chosen for
  it (`VARCHAR` rather than `TEXT` in the unique key, which MySQL would reject), and
  writes avoid `INSERT OR REPLACE` because `translateSql` maps that to `REPLACE INTO`
  on MySQL.
