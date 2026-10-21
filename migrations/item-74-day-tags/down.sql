-- item 74 rollback. Drops the day tags table and every tag in it; nothing else
-- references it. Take a copy first if the tags should survive the rollback:
--   \copy day_tags TO 'day_tags-backup.csv' CSV HEADER
-- Roll the image back BEFORE running this: a server.ts that still has `day_tags` in
-- its schema map recreates the (empty) table on its next boot.

BEGIN;
DROP TABLE IF EXISTS day_tags;
COMMIT;
