-- item 76: undo up.sql. Postgres.
--
-- Drops every stored readiness snapshot. Nothing is lost that cannot be rebuilt:
-- the table is a cache derived from `metrics`, and the next history request
-- rescores and restores every finished day it covers. Roll the image back first,
-- or the new server.ts recreates an empty table at its next boot.

BEGIN;

DROP TABLE IF EXISTS readiness_snapshots;

COMMIT;
