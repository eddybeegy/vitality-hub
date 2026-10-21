# item 76 — `readiness_snapshots` table (roadmap feature 5, readiness history)

One new table. Nothing existing is altered, rewritten or deleted.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer | owner |
| `snapshot_date` | varchar(10) | the user's calendar day, `YYYY-MM-DD` |
| `score` | integer | readiness 0-100 as of that day |
| `components` | text | JSON array: `[{name, score, weight, label}]` (HRV, Resting HR, Sleep, Activity Burn) |
| `algo_version` | integer | `READINESS_ALGO_VERSION` in `src/lib/readinessHistory.ts` when the row was computed |
| `created_at` | timestamp | `CURRENT_TIMESTAMP`, informational only |

`UNIQUE (user_id, snapshot_date)`: one snapshot per day.

## What writes it

`GET /api/readiness/history` (and the AI context / `/api/ai/data`, which ask for 7
days). For every **finished** day in the requested range that has no row at the
current `algo_version`, the server scores the day as of that morning from `metrics`
and stores it. Today is never stored; it is always computed live. Days with no HRV,
resting-HR or sleep reading of their own are left out rather than stored.

## It is a cache

Every row can be rebuilt from `metrics`. That makes two things safe:

- **Clearing it.** `DELETE FROM readiness_snapshots` (all or one user) loses
  nothing; the next request rescores the days it covers. Worth doing if old
  metrics are corrected, for example after the item-75 energy double-count fix,
  since a stored day otherwise keeps the score it had when first computed.
- **Changing the score.** Bump `READINESS_ALGO_VERSION` and rows from the old
  version are recomputed (and updated in place) the next time they are read.

## Running it

**Optional.** `server.ts` creates the identical table at boot. `up.sql` is
idempotent; `down.sql` drops the table.

## Checked here (cloud session, no host access)

- On a local Postgres 16: `up` → `up` (no-op) → `down` → `up` all exit 0, and
  `\d readiness_snapshots` from `up.sql` is identical to the table `server.ts`
  creates at boot through `translateSql`.
- The history route run end to end on Postgres and SQLite with the same seeded
  metrics: identical scores on both, rows stored on first read and served from the
  table on the second, a row with a stale `algo_version` recomputed in place.
- **Not checked: MySQL/MariaDB.** No server available. Same definition choices as
  item 74 (`VARCHAR` in the unique key, update-then-insert writes).
