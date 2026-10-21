-- item 14 up: ON DELETE CASCADE foreign keys from every user-scoped table to users.
--
-- Before this, the schema had NOT ONE foreign key to `users`: `DELETE FROM users`
-- left the rows behind, invisible to an app that scopes every query by user_id.
-- Live evidence was user 3, deleted months ago, who left 11,945 metrics rows and
-- 1,012 meal_items behind (dumped and cleared 2026-10-21 before this ran).
--
-- `logs` is deliberately SET NULL, not CASCADE: it is an audit trail, and the one
-- thing you most want to keep after deleting an account is the record of what that
-- account did. The column is already nullable and 282 system rows are NULL today.
--
-- `*_bak_*` tables are deliberate manual backups and get no constraint - the point
-- of them is to survive.
--
-- NO explicit transaction: each statement autocommits. ADD CONSTRAINT ... NOT VALID
-- takes a brief ACCESS EXCLUSIVE lock and does NOT scan the table; the separate
-- VALIDATE CONSTRAINT scans under a SHARE UPDATE EXCLUSIVE lock, which does not
-- block reads or writes. On `metrics` (1.69M rows) that is the difference between a
-- multi-second write stall and none.

ALTER TABLE ai_configs   ADD CONSTRAINT ai_configs_user_id_fkey   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE ai_insights  ADD CONSTRAINT ai_insights_user_id_fkey  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE chat_history ADD CONSTRAINT chat_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE meal_items   ADD CONSTRAINT meal_items_user_id_fkey   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE metrics      ADD CONSTRAINT metrics_user_id_fkey      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE routines     ADD CONSTRAINT routines_user_id_fkey     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE targets      ADD CONSTRAINT targets_user_id_fkey      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE user_cache   ADD CONSTRAINT user_cache_user_id_fkey   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE workouts     ADD CONSTRAINT workouts_user_id_fkey     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE  NOT VALID;
ALTER TABLE logs         ADD CONSTRAINT logs_user_id_fkey         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE ai_configs   VALIDATE CONSTRAINT ai_configs_user_id_fkey;
ALTER TABLE ai_insights  VALIDATE CONSTRAINT ai_insights_user_id_fkey;
ALTER TABLE chat_history VALIDATE CONSTRAINT chat_history_user_id_fkey;
ALTER TABLE meal_items   VALIDATE CONSTRAINT meal_items_user_id_fkey;
ALTER TABLE metrics      VALIDATE CONSTRAINT metrics_user_id_fkey;
ALTER TABLE routines     VALIDATE CONSTRAINT routines_user_id_fkey;
ALTER TABLE targets      VALIDATE CONSTRAINT targets_user_id_fkey;
ALTER TABLE user_cache   VALIDATE CONSTRAINT user_cache_user_id_fkey;
ALTER TABLE workouts     VALIDATE CONSTRAINT workouts_user_id_fkey;
ALTER TABLE logs         VALIDATE CONSTRAINT logs_user_id_fkey;

-- `routines` has no leading-user_id index, so a cascade from users would seq-scan it.
-- 80 rows today, but the index is free insurance and makes the set uniform.
CREATE INDEX IF NOT EXISTS routines_user_id_idx ON routines (user_id);
