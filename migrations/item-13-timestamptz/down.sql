-- item 13 rollback: timestamptz -> timestamp without time zone, restoring the
-- conventions the writers used before it: UTC for in-app sources and for every
-- workout, Europe/London wall-clock for healthsync metrics and for logs.
--
-- Roll back the APP first (deploy the pre-item-13 build), then run this. Rows written
-- after up.sql are true instants, so they come back in the right convention too.
--
--   psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f down.sql

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
    AND data_type <> 'timestamp with time zone';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'item 13 down.sql: not migrated or unexpected type (%). Nothing changed.', bad;
  END IF;
END $$;

ALTER TABLE metrics
  ALTER COLUMN timestamp TYPE timestamp
  USING CASE WHEN source = 'healthsync' THEN timestamp AT TIME ZONE 'Europe/London'
             ELSE timestamp AT TIME ZONE 'UTC' END;

ALTER TABLE workouts
  ALTER COLUMN timestamp TYPE timestamp
  USING timestamp AT TIME ZONE 'UTC';

ALTER TABLE logs
  ALTER COLUMN timestamp TYPE timestamp
  USING timestamp AT TIME ZONE 'Europe/London';

COMMIT;

ANALYZE metrics;
ANALYZE workouts;
ANALYZE logs;
