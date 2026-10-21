#!/usr/bin/env bash
# item 13 self-test: builds a THROWAWAY database, loads fixtures that straddle both
# BST boundaries (2026-10-25 and 2027-03-28) in the shape the live tables have, runs
# preflight -> up -> assertions -> down -> assertions, then drops the database.
#
#   PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
#
# Needs a role that can CREATE DATABASE. Never touches any existing database. Every
# expected value is written with an explicit offset, so the result does not depend on
# today's date or on the server's own clock (BST ends 2026-10-25; a test that compared
# against the current offset would silently pass for four months).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="item13_selftest_$$"
psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null' EXIT
# The live database runs its sessions in Europe/London; so does this one.
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE $db SET timezone = 'Europe/London'"

psql_db <<'SQL'
-- Same DDL the app creates on Postgres today (server.ts schema, DATETIME -> TIMESTAMP).
CREATE TABLE metrics (id SERIAL PRIMARY KEY, user_id INTEGER, type TEXT, value REAL, unit TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, source TEXT, UNIQUE(user_id, type, timestamp, source));
CREATE INDEX metrics_user_source_ts_idx ON metrics (user_id, source, timestamp);
CREATE TABLE workouts (id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, duration INTEGER, volume REAL,
  timestamp TIMESTAMP, source TEXT, external_id TEXT UNIQUE, routine_external_id TEXT);
CREATE TABLE logs (id SERIAL PRIMARY KEY, user_id INTEGER, level TEXT, message TEXT, source TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

-- Fixtures. `expect` is the real instant, always with an explicit offset.
CREATE TABLE expect (tbl text, id int, instant timestamptz);

-- in-app sources hold UTC (toISOString with the Z dropped by the naive column)
INSERT INTO metrics (id, user_id, type, value, unit, timestamp, source) VALUES
  (1, 1, 'hrv', 48, 'ms', '2026-10-21 08:48:00', 'apple_health'),   -- BST day
  (2, 1, 'hrv', 47, 'ms', '2026-10-24 23:30:00', 'apple_health'),   -- 00:30 BST on the 25th
  (3, 1, 'hrv', 46, 'ms', '2026-10-25 00:30:00', 'apple_health'),   -- 01:30 BST, first pass of the repeated hour
  (4, 1, 'hrv', 45, 'ms', '2026-10-25 01:30:00', 'apple_health'),   -- 01:30 GMT, second pass
  (5, 1, 'weight', 80, 'kg', '2027-03-28 00:30:00', 'withings'),    -- 00:30 GMT, before spring-forward
  (6, 1, 'weight', 81, 'kg', '2027-03-28 01:30:00', 'withings'),    -- 02:30 BST, after
  (7, 1, 'calories_in', 500, 'kcal', '2026-12-01 12:00:00.123', 'cronometer'),
  (8, 1, 'calories_in', 400, 'kcal', '2026-10-21 11:00:00', 'nutrachek'),
-- healthsync holds Europe/London wall-clock
  (20, 1, 'hrv', 62, 'ms', '2026-10-21 10:40:08', 'healthsync'),    -- measured live row: 09:40:08Z
  (21, 1, 'hrv', 61, 'ms', '2026-10-25 00:30:00', 'healthsync'),    -- BST, before the repeated hour
  (22, 1, 'hrv', 60, 'ms', '2026-10-25 03:00:00', 'healthsync'),    -- GMT, after it
  (23, 1, 'hrv', 59, 'ms', '2027-03-28 00:30:00', 'healthsync'),    -- GMT, before the gap
  (24, 1, 'hrv', 58, 'ms', '2027-03-28 03:00:00', 'healthsync'),    -- BST, after the gap
  (25, 1, 'hrv', 57, 'ms', '2027-01-15 07:00:00', 'healthsync');    -- deep winter, offset 0
INSERT INTO expect VALUES
  ('metrics', 1, '2026-10-21 08:48:00+00'), ('metrics', 2, '2026-10-24 23:30:00+00'),
  ('metrics', 3, '2026-10-25 00:30:00+00'), ('metrics', 4, '2026-10-25 01:30:00+00'),
  ('metrics', 5, '2027-03-28 00:30:00+00'), ('metrics', 6, '2027-03-28 01:30:00+00'),
  ('metrics', 7, '2026-12-01 12:00:00.123+00'), ('metrics', 8, '2026-10-21 11:00:00+00'),
  ('metrics', 20, '2026-10-21 10:40:08+01'), ('metrics', 21, '2026-10-25 00:30:00+01'),
  ('metrics', 22, '2026-10-25 03:00:00+00'), ('metrics', 23, '2027-03-28 00:30:00+00'),
  ('metrics', 24, '2027-03-28 03:00:00+01'), ('metrics', 25, '2027-01-15 07:00:00+00');

INSERT INTO workouts (id, user_id, name, duration, volume, timestamp, source, external_id) VALUES
  (1, 1, 'Push', 60, 1000, '2026-10-20 22:30:00', 'hevy', 'h1'),           -- 23:30 BST on the 20th
  (2, 1, 'Walk', 30, 0, '2026-10-26 07:00:00', 'apple_health', 'a1'),     -- GMT
  (3, 1, 'Run', 40, 0, '2026-10-21 07:15:00', 'healthsync', 'hs1'),       -- London 07:15 BST
  (4, 1, 'Run', 40, 0, '2026-11-02 07:15:00', 'healthsync', 'hs2');       -- London 07:15 GMT
INSERT INTO expect VALUES
  ('workouts', 1, '2026-10-20 22:30:00+00'), ('workouts', 2, '2026-10-26 07:00:00+00'),
  ('workouts', 3, '2026-10-21 07:15:00+01'), ('workouts', 4, '2026-11-02 07:15:00+00');

-- logs: explicit London wall-clock, plus one taking the DEFAULT in this London session
INSERT INTO logs (id, user_id, level, message, source, timestamp) VALUES
  (1, 1, 'info', 'sync ok', 'withings', '2026-10-21 10:41:41'),
  (2, 1, 'error', 'sync failed', 'withings', '2026-10-25 01:15:00'),   -- ambiguous hour: PG picks GMT
  (3, 1, 'info', 'sync ok', 'hevy', '2026-12-01 09:00:00');
INSERT INTO logs (id, user_id, level, message, source) VALUES (4, 1, 'info', 'default ts', 'system');
INSERT INTO expect VALUES
  ('logs', 1, '2026-10-21 10:41:41+01'), ('logs', 2, '2026-10-25 01:15:00+00'),
  ('logs', 3, '2026-12-01 09:00:00+00');
INSERT INTO expect SELECT 'logs', 4, now();   -- default row: within a second of now()

SELECT setval('metrics_id_seq', 100), setval('workouts_id_seq', 100), setval('logs_id_seq', 100);

-- Keep the pre-migration raw values to prove down.sql restores them exactly.
CREATE TABLE before_raw AS
  SELECT 'metrics' AS tbl, id, timestamp::text AS raw FROM metrics
  UNION ALL SELECT 'workouts', id, timestamp::text FROM workouts
  UNION ALL SELECT 'logs', id, timestamp::text FROM logs;

-- Capture what the CURRENT (pre-item-13) read paths return on the naive columns, so
-- the simplified read paths can be checked against them after the migration.
CREATE TABLE before_buckets AS
  SELECT to_char(((CASE WHEN source = 'healthsync' THEN adj_ts AT TIME ZONE 'Europe/London'
                        ELSE adj_ts AT TIME ZONE 'UTC' END) AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS day,
         type, source, SUM(value::float8) AS total, COUNT(*)::int AS cnt
  FROM (SELECT DISTINCT type, source, value,
          (CASE WHEN type LIKE 'sleep%' THEN timestamp - interval '12 hours' ELSE timestamp END) AS adj_ts
        FROM metrics WHERE user_id = 1) d
  GROUP BY 1, 2, 3;
CREATE TABLE before_fresh AS
  SELECT 'metrics' AS tbl, source, MAX(CASE WHEN source = 'healthsync' THEN timestamp AT TIME ZONE 'Europe/London'
                                     ELSE timestamp AT TIME ZONE 'UTC' END) AS ts
  FROM metrics WHERE user_id = 1 GROUP BY source
  UNION ALL
  SELECT 'workouts', source, MAX(CASE WHEN source = 'healthsync' THEN timestamp AT TIME ZONE 'Europe/London'
                                ELSE timestamp AT TIME ZONE 'UTC' END)
  FROM workouts WHERE user_id = 1 GROUP BY source
  UNION ALL
  SELECT 'logs', source, MAX(timestamp AT TIME ZONE 'Europe/London') FROM logs WHERE level = 'info' GROUP BY source;
SQL

echo "--- preflight"
psql_db -f "$here/preflight.sql"

echo "--- up"
psql_db -f "$here/up.sql"

psql_db <<'SQL'
DO $$
DECLARE r record; n int := 0;
BEGIN
  -- every column is now timestamptz
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name IN ('metrics', 'workouts', 'logs') AND column_name = 'timestamp'
    AND data_type = 'timestamp with time zone';
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 timestamptz columns, got %', n; END IF;

  -- every fixture is the expected instant
  FOR r IN
    SELECT e.tbl, e.id, e.instant, coalesce(m.timestamp, w.timestamp, l.timestamp) AS got
    FROM expect e
    LEFT JOIN metrics m ON e.tbl = 'metrics' AND m.id = e.id
    LEFT JOIN workouts w ON e.tbl = 'workouts' AND w.id = e.id
    LEFT JOIN logs l ON e.tbl = 'logs' AND l.id = e.id
  LOOP
    IF r.got IS NULL OR abs(extract(epoch FROM r.got - r.instant)) > (CASE WHEN r.tbl = 'logs' AND r.id = 4 THEN 2 ELSE 0 END) THEN
      RAISE EXCEPTION '%.% expected % got %', r.tbl, r.id, r.instant, r.got;
    END IF;
  END LOOP;

  -- the simplified read paths (no per-source CASE) give the same buckets as before
  SELECT count(*) INTO n FROM (
    (SELECT * FROM before_buckets
     EXCEPT
     SELECT to_char((adj_ts AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD'), type, source, SUM(value::float8), COUNT(*)::int
     FROM (SELECT DISTINCT type, source, value,
             (CASE WHEN type LIKE 'sleep%' THEN timestamp - interval '12 hours' ELSE timestamp END) AS adj_ts
           FROM metrics WHERE user_id = 1) d
     GROUP BY 1, 2, 3)
  ) x;
  IF n <> 0 THEN RAISE EXCEPTION 'summary buckets differ after migration (% rows)', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT * FROM before_fresh
    EXCEPT (
      SELECT 'metrics', source, MAX(timestamp) FROM metrics WHERE user_id = 1 GROUP BY source
      UNION ALL SELECT 'workouts', source, MAX(timestamp) FROM workouts WHERE user_id = 1 GROUP BY source
      UNION ALL SELECT 'logs', source, MAX(timestamp) FROM logs WHERE level = 'info' GROUP BY source)
  ) x;
  IF n <> 0 THEN RAISE EXCEPTION 'freshness differs after migration (% rows)', n; END IF;

  -- new writes: an ISO string with Z is stored as that instant; DEFAULT still works
  INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
    VALUES (1, 'hrv', 1, 'ms', '2026-10-25T00:30:00.000Z', 'apple_health') ON CONFLICT DO NOTHING;
  INSERT INTO logs (user_id, level, message, source) VALUES (1, 'info', 'post-migration default', 'system');
  IF NOT EXISTS (SELECT 1 FROM metrics WHERE id = 3 AND timestamp = '2026-10-25 01:30:00+01') THEN
    RAISE EXCEPTION 'ISO-Z write did not hit the existing row via the unique key';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM logs WHERE message = 'post-migration default' AND abs(extract(epoch FROM now() - timestamp)) < 2) THEN
    RAISE EXCEPTION 'logs DEFAULT is not now() after migration';
  END IF;
  DELETE FROM logs WHERE message = 'post-migration default';

  -- UTC-day range (what the modules now delete by) selects the same rows as the old
  -- UTC-text prefix did: 2026-10-24 UTC day = ids 2 only (id 3 is 2026-10-25 00:30Z)
  SELECT count(*) INTO n FROM metrics
  WHERE source = 'apple_health' AND timestamp >= '2026-10-24T00:00:00.000Z' AND timestamp < '2026-10-25T00:00:00.000Z';
  IF n <> 1 THEN RAISE EXCEPTION 'UTC day range for 2026-10-24 matched % rows, expected 1', n; END IF;
  RAISE NOTICE 'up.sql assertions passed';
END $$;
SQL

echo "--- up again (must refuse)"
if psql_db -f "$here/up.sql" 2>/dev/null; then echo "FAIL: up.sql ran twice"; exit 1; fi

echo "--- down"
psql_db -f "$here/down.sql"
psql_db <<'SQL'
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT tbl, id, raw FROM before_raw
    EXCEPT (
      SELECT 'metrics', id, timestamp::text FROM metrics
      UNION ALL SELECT 'workouts', id, timestamp::text FROM workouts
      UNION ALL SELECT 'logs', id, timestamp::text FROM logs)
  ) x;
  -- logs id 2 sits in the fall-back hour: it was already read as GMT, so it round-trips.
  IF n <> 0 THEN RAISE EXCEPTION 'down.sql did not restore % raw values', n; END IF;
  RAISE NOTICE 'down.sql assertions passed';
END $$;
SQL

echo "--- up after down"
psql_db -f "$here/up.sql"
echo "selftest: all assertions passed"
