-- item 76: readiness history (roadmap feature 5). Postgres.
--
-- server.ts creates this exact table at boot (CREATE TABLE IF NOT EXISTS, from the
-- `readiness_snapshots` entry in its schema map), so running this first is optional:
-- it lets the table exist, behind a backup, before the image that uses it is
-- deployed. Running it after the new image has booted is a no-op. Idempotent.
--
-- `snapshot_date` is a bare YYYY-MM-DD calendar day in the user's zone, never a
-- timestamp, so no per-source zone convention applies and no AT TIME ZONE is
-- involved. VARCHAR, not TEXT, so the same definition is valid in a MySQL UNIQUE key.

BEGIN;

CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  snapshot_date VARCHAR(10),
  score INTEGER,
  components TEXT,
  algo_version INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, snapshot_date)
);

COMMIT;
