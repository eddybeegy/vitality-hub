-- item 13 preflight. Read-only: run it first, against the backup and then against
-- the live database, and read every section before running up.sql.
--
--   psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f preflight.sql
--
-- What up.sql assumes, and what each section below checks:
--   * all three columns are still `timestamp without time zone` (section 1);
--   * metrics hold UTC for every source except `healthsync`, which holds Europe/London
--     wall-clock; workouts hold UTC for every source, healthsync included (section
--     2b checks that against the UTC instant in healthsync's `external_id`). Section 2
--     lists every source with its newest row so a source nobody has accounted for is
--     visible BEFORE it is converted under the UTC rule;
--   * logs holds Europe/London wall-clock (DEFAULT CURRENT_TIMESTAMP in a London
--     session) — section 1 prints the session zone, which must be Europe/London;
--   * the per-source conversion cannot make two metrics rows collide on
--     (user_id, type, timestamp, source) (section 4 must return 0).

\echo '== 1. column types and session zone (expect 3 x "timestamp without time zone", Europe/London)'
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('metrics', 'workouts', 'logs')
  AND column_name = 'timestamp'
ORDER BY table_name;
SHOW timezone;

\echo '== 2. sources: anything here other than apple_health, cronometer, withings, nutrachek/nutracheck, hevy, healthsync is converted as UTC — confirm that is right before running up.sql'
SELECT 'metrics' AS tbl, source, count(*) AS rows, min(timestamp) AS oldest, max(timestamp) AS newest
FROM metrics GROUP BY source
UNION ALL
SELECT 'workouts', source, count(*), min(timestamp), max(timestamp)
FROM workouts GROUP BY source
UNION ALL
SELECT 'logs', '(all)', count(*), min(timestamp), max(timestamp)
FROM logs
ORDER BY 1, 2;

\echo '== 2b. healthsync workouts: naive timestamp vs the UTC instant in external_id (expect utc_match = t on every row)'
-- external_id looks like healthsync_2026-10-20T09:25:32.887Z_<name>; the naive column
-- holds that instant to the second. A London wall-clock row would be off by 3600 s.
SELECT id, timestamp AS naive_ts, external_id,
  abs(extract(epoch FROM (timestamp AT TIME ZONE 'UTC')
      - substring(external_id FROM '^healthsync_([0-9T:.-]+Z)')::timestamptz)) < 1 AS utc_match
FROM workouts
WHERE source = 'healthsync'
ORDER BY timestamp DESC;

\echo '== 3. London wall-clock values that do not map to exactly one instant'
-- nonexistent: inside the spring-forward gap (e.g. 2027-03-28 01:30). Postgres maps
--   these forward an hour, so 01:30 and 02:30 become the same instant.
-- ambiguous: inside the fall-back hour (e.g. 2026-10-25 01:30). Postgres picks the
--   later (GMT) reading; the BST one moves an hour later than it really happened.
-- Both are a property of storing wall-clock without an offset; up.sql cannot recover
-- the lost information, it can only tell you how many rows are affected.
WITH london AS (
  SELECT 'metrics' AS tbl, timestamp AS ts FROM metrics WHERE source = 'healthsync'
  UNION ALL SELECT 'logs', timestamp FROM logs
)
SELECT tbl,
  count(*) FILTER (WHERE (ts AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' <> ts) AS nonexistent,
  count(*) FILTER (WHERE ((ts AT TIME ZONE 'Europe/London') - interval '1 hour') AT TIME ZONE 'Europe/London' = ts) AS ambiguous
FROM london
GROUP BY tbl
ORDER BY tbl;

\echo '== 4. metrics rows that would collide on the unique index after conversion (must be 0)'
SELECT count(*) AS colliding_groups FROM (
  SELECT user_id, type, source,
    CASE WHEN source = 'healthsync' THEN timestamp AT TIME ZONE 'Europe/London'
         ELSE timestamp AT TIME ZONE 'UTC' END AS ts
  FROM metrics
  GROUP BY 1, 2, 3, 4
  HAVING count(*) > 1
) c;

\echo '== 5. NULL timestamps (carried over as NULL; informational)'
SELECT 'metrics' AS tbl, count(*) FROM metrics WHERE timestamp IS NULL
UNION ALL SELECT 'workouts', count(*) FROM workouts WHERE timestamp IS NULL
UNION ALL SELECT 'logs', count(*) FROM logs WHERE timestamp IS NULL;
