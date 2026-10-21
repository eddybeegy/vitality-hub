-- item 49 up: drop every index on `metrics`, `meal_items` and `workouts` that is an
-- exact duplicate of one the app maintains. Run preflight.sql first and read it.
--
-- Kept: the indexes server.ts creates by name on every boot (the `keepers` list in
-- step 2), e.g. metrics_unique_idx, meal_items_unique_idx, metrics_user_timestamp_idx,
-- meal_items_user_ts_idx, workouts_user_ts_idx.
-- Dropped: every OTHER index on the same table whose definition is identical once the
-- name is removed - found by comparison, not by name (preflight section 4 lists
-- them). For the unique sets that includes the index behind the inline UNIQUE(...)
-- table constraint (metrics_user_id_type_timestamp_source_key,
-- meal_items_user_id_timestamp_name_source_key), removed with ALTER TABLE ... DROP
-- CONSTRAINT because DROP INDEX refuses it, and the bare idx_* copies, removed with
-- DROP INDEX CONCURRENTLY. Prefix indexes are never touched (README.md).
--
-- Why the app's names are the keepers: server.ts runs CREATE [UNIQUE] INDEX IF NOT
-- EXISTS on each of them at every boot (initDb, and the two unique ones again in the
-- startup cleanup). IF NOT EXISTS matches by name only, so dropping one of them would
-- bring it straight back at the next restart - as a plain, non-concurrent build that
-- blocks writes for the whole build - and the duplicate would be back. Every writer
-- (app and kb-health) uses column-inference ON CONFLICT, never ON CONSTRAINT, so any
-- one matching non-partial unique index satisfies it.
--
-- MUST run in psql's default autocommit mode: DROP INDEX CONCURRENTLY cannot run
-- inside a transaction block. Do NOT pass -1 / --single-transaction and do not wrap
-- this file in BEGIN/COMMIT. Each \gexec statement below autocommits on its own.
--
-- Re-runnable: the manifest insert is ON CONFLICT DO NOTHING and every drop is
-- IF EXISTS / existence-checked, so a run interrupted half way can simply be re-run.

\set ON_ERROR_STOP on

-- 1. Refuse unless both unique keepers exist and are usable. Dropping the duplicates
--    while the keeper is missing or INVALID would leave the table with no uniqueness.
--    (A missing or invalid NON-unique keeper is not fatal: it matches nothing in
--    step 2, so its duplicates are simply left alone.)
DO $$
DECLARE k record;
BEGIN
  FOR k IN SELECT * FROM (VALUES ('metrics', 'metrics_unique_idx'), ('meal_items', 'meal_items_unique_idx')) AS v(tbl, name) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
       WHERE i.relname = k.name AND i.relnamespace = 'public'::regnamespace
         AND ix.indrelid = ('public.' || k.tbl)::regclass
         AND ix.indisunique AND ix.indisvalid AND ix.indisready
         AND ix.indpred IS NULL AND ix.indexprs IS NULL
    ) THEN
      RAISE EXCEPTION 'item 49: keeper %.% is missing, not unique, invalid or partial - nothing dropped', k.tbl, k.name;
    END IF;
  END LOOP;
END $$;

-- 2. Record what is about to go, with its full definition, so down.sql can put back
--    exactly these names. Same selection as preflight.sql section 4.
CREATE TABLE IF NOT EXISTS item49_dropped_indexes (
  index_name      text PRIMARY KEY,
  table_name      text NOT NULL,
  constraint_name text,
  indexdef        text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO item49_dropped_indexes (index_name, table_name, constraint_name, indexdef)
-- BEGIN drop-selection (identical text in preflight.sql and up.sql; selftest.sh checks)
WITH keepers (table_name, index_name) AS (
  -- Every index server.ts creates by name at boot on these tables. These are never
  -- dropped, and any index identical to one of them is.
  VALUES ('metrics',    'metrics_unique_idx'),
         ('metrics',    'metrics_user_type_idx'),
         ('metrics',    'metrics_user_timestamp_idx'),
         ('metrics',    'metrics_user_source_idx'),
         ('metrics',    'metrics_user_source_ts_idx'),
         ('metrics',    'metrics_timestamp_idx'),
         ('meal_items', 'meal_items_unique_idx'),
         ('meal_items', 'meal_items_user_ts_idx'),
         ('workouts',   'workouts_user_ts_idx')
), idx AS (
  SELECT c.relname AS table_name, i.relname AS index_name, ix.indexrelid, ix.indisvalid,
         con.conname AS constraint_name, con.contype,
         pg_get_indexdef(ix.indexrelid) AS indexdef,
         regexp_replace(pg_get_indexdef(ix.indexrelid), '^(CREATE (UNIQUE )?INDEX )("[^"]+"|\S+) ON ', '\1ON ') AS shape
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class c ON c.oid = ix.indrelid
    LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.conrelid = ix.indrelid AND con.contype IN ('p', 'u', 'x')
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items', 'workouts')
), keep AS (
  SELECT idx.* FROM idx JOIN keepers USING (table_name, index_name) WHERE idx.indisvalid
), drops AS (
  SELECT DISTINCT ON (d.index_name)
         d.table_name, d.index_name, d.indexrelid, d.constraint_name, d.indexdef, k.index_name AS duplicate_of
    FROM idx d JOIN keep k ON k.table_name = d.table_name AND k.shape = d.shape AND k.index_name <> d.index_name
   WHERE NOT EXISTS (SELECT 1 FROM keepers kp WHERE kp.table_name = d.table_name AND kp.index_name = d.index_name)
     AND coalesce(d.contype, 'u') = 'u'
   ORDER BY d.index_name, k.index_name
)
-- END drop-selection
SELECT index_name, table_name, constraint_name, indexdef FROM drops
ON CONFLICT (index_name) DO NOTHING;

\echo '== recorded for dropping =='
SELECT table_name, index_name, coalesce(constraint_name, '-') AS constraint_name FROM item49_dropped_indexes ORDER BY 1, 2;

-- 3. Constraint-backed duplicates. A constraint's index cannot be dropped with
--    DROP INDEX, and there is no DROP CONSTRAINT CONCURRENTLY: this takes ACCESS
--    EXCLUSIVE on the table. The drop itself is catalog-only and instant, but the
--    lock request queues behind any open transaction on the table and blocks every
--    later reader/writer while it waits. lock_timeout caps that wait at 5 s; if it
--    trips, nothing has changed - re-run this file.
SET lock_timeout = '5s';
SELECT format('ALTER TABLE public.%I DROP CONSTRAINT %I', d.table_name, d.constraint_name)
  FROM item49_dropped_indexes d
 WHERE d.constraint_name IS NOT NULL
   AND EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conname = d.constraint_name AND c.conrelid = ('public.' || d.table_name)::regclass)
 ORDER BY d.table_name, d.index_name
\gexec
RESET lock_timeout;

-- 4. Plain duplicates: DROP INDEX CONCURRENTLY, one statement per index (it accepts
--    only one name). SHARE UPDATE EXCLUSIVE - reads and writes carry on - but it
--    waits for every transaction already touching the table to finish, so a long
--    one makes this slow, not blocking. lock_timeout is deliberately NOT set here:
--    a concurrent drop interrupted part way can leave the index INVALID (still
--    present, no longer used) - harmless, and a re-run of this file drops it.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', d.index_name)
  FROM item49_dropped_indexes d
 WHERE d.constraint_name IS NULL
 ORDER BY d.table_name, d.index_name
\gexec

-- 5. Result: no index shape should now be held twice.
\echo '== shapes still held more than once (expect 0 rows) =='
SELECT c.relname AS table_name, string_agg(i.relname, ', ' ORDER BY i.relname) AS index_names
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class c ON c.oid = ix.indrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items', 'workouts')
 GROUP BY c.relname, regexp_replace(pg_get_indexdef(ix.indexrelid), '^(CREATE (UNIQUE )?INDEX )("[^"]+"|\S+) ON ', '\1ON ')
HAVING count(*) > 1;
