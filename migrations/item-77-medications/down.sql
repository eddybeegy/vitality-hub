-- item 77 rollback. Drops the medication log and every logged dose; nothing else
-- references either table. The medication LIST also survives in users.medications
-- (the import never cleared it), but the per-day taken/skipped history does not.
-- Take a copy first if it should:
--   \copy medications TO 'medications-backup.csv' CSV HEADER
--   \copy medication_doses TO 'medication_doses-backup.csv' CSV HEADER
-- Roll the image back BEFORE running this: a server.ts that still has these tables
-- in its schema map recreates them (empty) on its next boot.

BEGIN;
DROP TABLE IF EXISTS medication_doses;
DROP TABLE IF EXISTS medications;
COMMIT;
