-- item 49 preflight: READ THIS OUTPUT BEFORE RUNNING up.sql. Read-only.
--
-- It proves which unique indexes on `metrics` and `meal_items` are exact duplicates
-- of the one being kept, and lists precisely what up.sql will drop. Index names
-- other than the two keepers are NOT hard-coded anywhere in this migration: the
-- duplicates are found by comparing index definitions, so the result is whatever
-- this database actually holds. Check section 4 against section 1 by eye.
--
-- Two indexes are "identical" when pg_get_indexdef() is the same once the index
-- name is taken out: same table, same columns in the same order, same access
-- method, opclasses, collations, sort order, NULLS [NOT] DISTINCT and no partial
-- predicate or expression difference. Anything that differs in any of those is
-- left alone.

\echo '== 1. every index on metrics and meal_items =='
SELECT c.relname AS table_name, i.relname AS index_name,
       ix.indisunique AS uniq, ix.indisvalid AS valid,
       con.conname AS backs_constraint,
       pg_size_pretty(pg_relation_size(ix.indexrelid)) AS size,
       s.idx_scan,
       pg_get_indexdef(ix.indexrelid) AS indexdef
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class c ON c.oid = ix.indrelid
  LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.conrelid = ix.indrelid AND con.contype IN ('p', 'u', 'x')
  LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = ix.indexrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items')
 ORDER BY 1, 2;

\echo '== 2. unique-index shapes per table (n > 1 is a duplicate group; expected: metrics 3, meal_items 4) =='
SELECT c.relname AS table_name, count(*) AS n,
       string_agg(i.relname, ', ' ORDER BY i.relname) AS index_names,
       regexp_replace(pg_get_indexdef(ix.indexrelid), '^CREATE UNIQUE INDEX ("[^"]+"|\S+) ON ', 'CREATE UNIQUE INDEX ON ') AS shape
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class c ON c.oid = ix.indrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items') AND ix.indisunique
 GROUP BY 1, 4
 ORDER BY 1, 2 DESC;

\echo '== 3. the keepers: both rows must read exists=t, uniq=t, valid=t, ready=t (up.sql refuses otherwise) =='
SELECT k.name AS keeper,
       ix.indexrelid IS NOT NULL AS exists,
       coalesce(ix.indisunique, false) AS uniq,
       coalesce(ix.indisvalid, false)  AS valid,
       coalesce(ix.indisready, false)  AS ready
  FROM (VALUES ('metrics', 'metrics_unique_idx'), ('meal_items', 'meal_items_unique_idx')) AS k(tbl, name)
  LEFT JOIN pg_class i ON i.relname = k.name AND i.relnamespace = 'public'::regnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = i.oid AND ix.indrelid = ('public.' || k.tbl)::regclass
 ORDER BY 1;

\echo '== 4. EXACTLY what up.sql will drop (expected: 2 for metrics, 3 for meal_items) =='
-- Same selection as up.sql step 2. Keep the two in step.
WITH idx AS (
  SELECT c.relname AS table_name, i.relname AS index_name, ix.indexrelid,
         con.conname AS constraint_name,
         regexp_replace(pg_get_indexdef(ix.indexrelid), '^CREATE UNIQUE INDEX ("[^"]+"|\S+) ON ', 'CREATE UNIQUE INDEX ON ') AS shape
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class c ON c.oid = ix.indrelid
    LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.conrelid = ix.indrelid AND con.contype IN ('p', 'u', 'x')
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items') AND ix.indisunique
), keep AS (
  SELECT * FROM idx WHERE index_name IN ('metrics_unique_idx', 'meal_items_unique_idx')
)
SELECT d.table_name, d.index_name,
       CASE WHEN d.constraint_name IS NULL THEN 'DROP INDEX CONCURRENTLY'
            ELSE 'ALTER TABLE DROP CONSTRAINT ' || d.constraint_name END AS how,
       pg_size_pretty(pg_relation_size(d.indexrelid)) AS frees
  FROM idx d JOIN keep k ON k.table_name = d.table_name AND k.shape = d.shape AND k.index_name <> d.index_name
 ORDER BY 1, 2;

\echo '== 5. foreign keys that depend on an index to be dropped (must be 0 rows; DROP would fail) =='
SELECT f.conrelid::regclass AS referencing_table, f.conname, i.relname AS depends_on_index
  FROM pg_constraint f
  JOIN pg_class i ON i.oid = f.conindid
 WHERE f.contype = 'f' AND f.confrelid IN ('public.metrics'::regclass, 'public.meal_items'::regclass)
   AND i.relname NOT IN ('metrics_pkey', 'meal_items_pkey');

\echo '== 6. sessions holding locks on either table right now (the constraint drop waits behind these) =='
SELECT a.pid, a.application_name, a.state, now() - a.xact_start AS xact_age, l.mode,
       l.relation::regclass AS rel, left(a.query, 80) AS query
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
 WHERE l.relation IN ('public.metrics'::regclass, 'public.meal_items'::regclass)
   AND a.pid <> pg_backend_pid()
 ORDER BY xact_age DESC NULLS LAST;

\echo '== 7. a previous run left a manifest? (absent is normal for a first run) =='
SELECT to_regclass('public.item49_dropped_indexes') AS manifest_table;
