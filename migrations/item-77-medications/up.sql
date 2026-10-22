-- item 77: medication and supplement log. Postgres.
--
-- server.ts creates both of these tables at boot (CREATE TABLE IF NOT EXISTS, from
-- its schema map), so running this first is optional: it lets them exist, behind a
-- backup, before the image that uses them is deployed. Running it afterwards is a
-- no-op. Idempotent; safe to run twice.
--
-- `start_date`, `end_date` and `dose_date` are bare YYYY-MM-DD calendar days in the
-- user's zone, never timestamps, so no per-source zone convention applies and no
-- AT TIME ZONE is involved. VARCHAR, not TEXT, so the same definitions are valid in
-- a MySQL UNIQUE key.
--
-- Nothing here touches users.medications: the old JSON list stays where it is and is
-- only ever read, once, by the app's one-time import.

BEGIN;

CREATE TABLE IF NOT EXISTS medications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  name VARCHAR(80),
  kind VARCHAR(16),
  dose VARCHAR(40),
  frequency VARCHAR(24),
  start_date VARCHAR(10),
  end_date VARCHAR(10),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name)
);

-- One row per item per day the user said something: taken = 1, skipped = 0.
-- A missing row means nothing was said, which is not a missed dose.
CREATE TABLE IF NOT EXISTS medication_doses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  medication_id INTEGER,
  dose_date VARCHAR(10),
  taken INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, medication_id, dose_date)
);

COMMIT;
