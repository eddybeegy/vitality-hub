-- item 71 down: remove the guard trigger (if installed) and put back every row
-- up.sql removed. Rows come back with their original ids. A row whose
-- (user_id, type, timestamp, source) has since been written again is skipped, and
-- the count says so.
--
--   psql -X -v ON_ERROR_STOP=1 -f down.sql
\set ON_ERROR_STOP on
BEGIN;
DROP TRIGGER IF EXISTS item71_healthsync_copy_guard ON metrics;
DROP FUNCTION IF EXISTS item71_skip_healthsync_copy();
DROP TABLE IF EXISTS item71_dedupe_scope;

DO $$
DECLARE cols text; n_backup bigint; n_back bigint;
BEGIN
  IF to_regclass('public.item71_removed_metrics') IS NULL THEN
    RAISE NOTICE 'item 71: no item71_removed_metrics table, nothing to restore';
    RETURN;
  END IF;
  -- every metrics column, in metrics' own order, so a column added since up.sql
  -- ran (and absent from the backup) makes this fail loudly instead of misaligning
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'metrics';
  SELECT count(*) INTO n_backup FROM item71_removed_metrics;
  EXECUTE format('INSERT INTO metrics (%1$s) SELECT %1$s FROM item71_removed_metrics ON CONFLICT DO NOTHING', cols);
  GET DIAGNOSTICS n_back = ROW_COUNT;
  RAISE NOTICE 'item 71: restored % of % rows (% skipped as already present)', n_back, n_backup, n_backup - n_back;
  DROP TABLE item71_removed_metrics;
END $$;
COMMIT;
