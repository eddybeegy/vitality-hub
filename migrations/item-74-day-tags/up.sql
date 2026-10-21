-- item 74: day tags (roadmap feature 4). Postgres.
--
-- server.ts creates this exact table at boot (CREATE TABLE IF NOT EXISTS, from the
-- `day_tags` entry in its schema map), so running this first is optional: it lets the
-- table exist, behind a backup, before the image that uses it is deployed. Running it
-- after the new image has booted is a no-op. Idempotent; safe to run twice.
--
-- `tag_date` is a bare YYYY-MM-DD calendar day in the user's zone, never a timestamp,
-- so no per-source zone convention applies and no AT TIME ZONE is involved. VARCHAR,
-- not TEXT, so the same definition is valid in a MySQL UNIQUE key.

BEGIN;

CREATE TABLE IF NOT EXISTS day_tags (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  tag_date VARCHAR(10),
  tag VARCHAR(32),
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, tag_date, tag)
);

COMMIT;
