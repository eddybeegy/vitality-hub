-- item 49 down: put back every index and constraint up.sql dropped, under its
-- original name and with its original definition, from the manifest table
-- `item49_dropped_indexes` that up.sql wrote. Nothing here is guessed.
--
-- MUST run in psql's default autocommit mode: CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction block. No -1 / --single-transaction, no BEGIN/COMMIT.
--
-- Cost: this is a full index build per row of the manifest - on `metrics` (1.69M
-- rows) roughly a minute each, under SHARE UPDATE EXCLUSIVE, so reads and writes
-- carry on throughout. Reinstating a table constraint (step 2) is catalog-only but
-- takes ACCESS EXCLUSIVE briefly, hence the lock_timeout.
--
-- Re-runnable: every step skips what already exists.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.item49_dropped_indexes') IS NULL THEN
    RAISE EXCEPTION 'item 49 down: no item49_dropped_indexes manifest - up.sql never ran here, nothing to restore';
  END IF;
END $$;

-- An index left INVALID by an interrupted CONCURRENTLY build would satisfy IF NOT
-- EXISTS below and never be rebuilt, so clear any such leftover first.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', d.index_name)
  FROM item49_dropped_indexes d
  JOIN pg_class i ON i.relname = d.index_name AND i.relnamespace = 'public'::regnamespace
  JOIN pg_index ix ON ix.indexrelid = i.oid
 WHERE NOT ix.indisvalid
\gexec

-- 1. Rebuild each index concurrently, from its recorded definition (unique or not).
SELECT regexp_replace(d.indexdef, '^CREATE (UNIQUE )?INDEX ', 'CREATE \1INDEX CONCURRENTLY IF NOT EXISTS ')
  FROM item49_dropped_indexes d
 ORDER BY d.table_name, d.index_name
\gexec

-- 2. Re-attach the ones that backed a table constraint. USING INDEX adopts the
--    index just built, so this does not scan or rebuild anything.
SET lock_timeout = '5s';
SELECT format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE USING INDEX %I', d.table_name, d.constraint_name, d.index_name)
  FROM item49_dropped_indexes d
 WHERE d.constraint_name IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM pg_constraint c
                    WHERE c.conname = d.constraint_name AND c.conrelid = ('public.' || d.table_name)::regclass)
 ORDER BY d.table_name, d.index_name
\gexec
RESET lock_timeout;

-- 3. Only once every recorded index is back and valid, drop the manifest.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(d.index_name, ', ') INTO missing
    FROM item49_dropped_indexes d
   WHERE NOT EXISTS (SELECT 1 FROM pg_class i JOIN pg_index ix ON ix.indexrelid = i.oid
                      WHERE i.relname = d.index_name AND i.relnamespace = 'public'::regnamespace AND ix.indisvalid)
      OR (d.constraint_name IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pg_constraint c WHERE c.conname = d.constraint_name AND c.conrelid = ('public.' || d.table_name)::regclass));
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'item 49 down: not restored yet: % - manifest kept, re-run down.sql', missing;
  END IF;
END $$;
DROP TABLE item49_dropped_indexes;

\echo '== indexes now on metrics, meal_items, workouts =='
SELECT c.relname AS table_name, i.relname AS index_name, ix.indisunique AS uniq, ix.indisvalid AS valid
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class c ON c.oid = ix.indrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items', 'workouts')
 ORDER BY 1, 2;
