-- item 75 down: put every row up.sql removed back, exactly as it was.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO metrics (id, user_id, type, value, unit, timestamp, source)
  SELECT id, user_id, type, value, unit, timestamp, source FROM item75_removed_metrics
  ON CONFLICT DO NOTHING;
DO $$
DECLARE missing bigint;
BEGIN
  SELECT count(*) INTO missing FROM item75_removed_metrics r
   WHERE NOT EXISTS (SELECT 1 FROM metrics m WHERE m.id = r.id);
  IF missing <> 0 THEN
    RAISE EXCEPTION 'item 75 down: % rows did not come back - rolled back', missing;
  END IF;
  RAISE NOTICE 'item 75 down: restored % rows', (SELECT count(*) FROM item75_removed_metrics);
END $$;
COMMIT;
