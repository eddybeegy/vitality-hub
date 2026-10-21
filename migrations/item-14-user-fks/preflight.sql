-- item 14 preflight: adding the constraints FAILS while any orphan row exists, so
-- check first. Every row below must read 0. If one does not, dump those rows and
-- clear them (see README.md) before running up.sql.
\echo '== orphan rows per user-scoped table (every count must be 0) =='
SELECT 'ai_configs'   AS table_name, count(*) FROM ai_configs   x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'ai_insights',  count(*) FROM ai_insights  x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'chat_history', count(*) FROM chat_history x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'logs',         count(*) FROM logs         x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'meal_items',   count(*) FROM meal_items   x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'metrics',      count(*) FROM metrics      x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'routines',     count(*) FROM routines     x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'targets',      count(*) FROM targets      x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'user_cache',   count(*) FROM user_cache   x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
UNION ALL SELECT 'workouts',     count(*) FROM workouts     x WHERE x.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
ORDER BY 1;

\echo '== existing FKs to users (expected: none before up.sql) =='
SELECT conrelid::regclass AS child, conname, confdeltype
  FROM pg_constraint WHERE contype = 'f' AND confrelid = 'users'::regclass ORDER BY 1;

\echo '== every table carrying a user_id, so the list below can be checked for drift =='
SELECT table_name, is_nullable FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY 1;

\echo '== leading-user_id index per table (needed so ON DELETE CASCADE is not a seq scan) =='
SELECT t.relname AS table_name, i.relname AS index_name
  FROM pg_class t
  JOIN pg_index ix ON ix.indrelid = t.oid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
 WHERE a.attname = 'user_id' AND t.relkind = 'r' AND t.relnamespace = 'public'::regnamespace
 ORDER BY 1, 2;
