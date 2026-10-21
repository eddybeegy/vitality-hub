-- item 13: metrics.timestamp, workouts.timestamp, logs.timestamp -> timestamptz.
--
-- Run preflight.sql first. Stop the app AND pause the external healthsync writer
-- (item 19, Home Assistant) before running this, and keep both stopped until the new
-- app build is deployed: ALTER ... TYPE rewrites each table under an ACCESS EXCLUSIVE
-- lock, so any writer that is still connected will either queue behind it or, if it
-- holds a lock first, make this time out (lock_timeout below) and roll back.
--
--   psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f up.sql
--
-- The conversion is per table AND source, never one blanket AT TIME ZONE for metrics:
--   * metrics: the five in-app modules write `toISOString()`, so the naive value is
--     UTC -> `AT TIME ZONE 'UTC'`. `healthsync` (kb-health, item 19) stamps metrics via
--     `localNaive()`, Europe/London wall-clock -> `AT TIME ZONE 'Europe/London'`.
--   * workouts: every source is UTC, healthsync included (kb-health's workout INSERT
--     uses `utcNaive()`; preflight section 2b checks it against the UTC instant in
--     its `external_id`) -> `AT TIME ZONE 'UTC'`.
--   * logs: DEFAULT CURRENT_TIMESTAMP evaluated in the Europe/London session ->
--     `AT TIME ZONE 'Europe/London'`.
-- `naive AT TIME ZONE z` reads the naive value as wall-clock in z and returns the
-- instant, which is exactly what a timestamptz stores. The result does not depend on
-- this session's TimeZone.
--
-- Single transaction: either all three columns convert or none do. down.sql is the
-- exact inverse (bar the fall-back-hour rows preflight section 3 counts).

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '15s';

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(table_name || '=' || data_type, ', ') INTO bad
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('metrics', 'workouts', 'logs')
    AND column_name = 'timestamp'
    AND data_type <> 'timestamp without time zone';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'item 13 up.sql: already migrated or unexpected type (%). Nothing changed.', bad;
  END IF;
END $$;

ALTER TABLE metrics
  ALTER COLUMN timestamp TYPE timestamptz
  USING CASE WHEN source = 'healthsync' THEN timestamp AT TIME ZONE 'Europe/London'
             ELSE timestamp AT TIME ZONE 'UTC' END;

ALTER TABLE workouts
  ALTER COLUMN timestamp TYPE timestamptz
  USING timestamp AT TIME ZONE 'UTC';

ALTER TABLE logs
  ALTER COLUMN timestamp TYPE timestamptz
  USING timestamp AT TIME ZONE 'Europe/London';

COMMIT;

-- The type change rewrote the tables and rebuilt their indexes; refresh planner stats.
ANALYZE metrics;
ANALYZE workouts;
ANALYZE logs;
