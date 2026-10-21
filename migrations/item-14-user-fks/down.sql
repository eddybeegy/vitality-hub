-- item 14 down: drop the constraints. Safe to run at any time; dropping a foreign
-- key never touches data. It does NOT restore the orphan rows that were dumped and
-- deleted on 2026-10-21 - those are CSVs under /opt/vitality/item14-orphan-dump-*.
ALTER TABLE ai_configs   DROP CONSTRAINT IF EXISTS ai_configs_user_id_fkey;
ALTER TABLE ai_insights  DROP CONSTRAINT IF EXISTS ai_insights_user_id_fkey;
ALTER TABLE chat_history DROP CONSTRAINT IF EXISTS chat_history_user_id_fkey;
ALTER TABLE logs         DROP CONSTRAINT IF EXISTS logs_user_id_fkey;
ALTER TABLE meal_items   DROP CONSTRAINT IF EXISTS meal_items_user_id_fkey;
ALTER TABLE metrics      DROP CONSTRAINT IF EXISTS metrics_user_id_fkey;
ALTER TABLE routines     DROP CONSTRAINT IF EXISTS routines_user_id_fkey;
ALTER TABLE targets      DROP CONSTRAINT IF EXISTS targets_user_id_fkey;
ALTER TABLE user_cache   DROP CONSTRAINT IF EXISTS user_cache_user_id_fkey;
ALTER TABLE workouts     DROP CONSTRAINT IF EXISTS workouts_user_id_fkey;
DROP INDEX IF EXISTS routines_user_id_idx;
