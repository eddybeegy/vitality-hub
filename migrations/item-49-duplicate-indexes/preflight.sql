-- item 49 preflight: READ THIS OUTPUT BEFORE RUNNING up.sql. Read-only.
--
-- It proves which indexes on `metrics`, `meal_items` and `workouts` are exact
-- duplicates of an index the app maintains, says for each whether it is a UNIQUE
-- constraint or a plain index (they are dropped differently), and lists precisely
-- what up.sql will drop. Only the app's own index names are written down here; the
-- duplicates are found by comparing definitions, so the result is whatever this
-- database actually holds. Check section 4 against section 1 by eye.
--
-- Two indexes are "identical" when pg_get_indexdef() is the same once the index
-- name is taken out: same table, uniqueness, columns in the same order, access
-- method, opclasses, collations, sort order, NULLS [NOT] DISTINCT, and no partial
-- predicate or expression difference. A PREFIX is not a duplicate and is never
-- touched - see README.md.

\echo '== 1. every index on metrics, meal_items, workouts =='
SELECT c.relname AS table_name, i.relname AS index_name,
       CASE WHEN con.contype = 'p' THEN 'PRIMARY KEY'
            WHEN con.contype = 'u' THEN 'UNIQUE constraint'
            WHEN ix.indisunique    THEN 'plain unique index'
            ELSE 'plain index' END AS kind,
       ix.indisvalid AS valid,
       pg_size_pretty(pg_relation_size(ix.indexrelid)) AS size,
       s.idx_scan,
       pg_get_indexdef(ix.indexrelid) AS indexdef
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class c ON c.oid = ix.indrelid
  LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.conrelid = ix.indrelid AND con.contype IN ('p', 'u', 'x')
  LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = ix.indexrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items', 'workouts')
 ORDER BY 1, 2;

\echo '== 2. duplicate groups: every index shape held more than once =='
SELECT c.relname AS table_name, count(*) AS n,
       string_agg(i.relname, ', ' ORDER BY i.relname) AS index_names,
       regexp_replace(pg_get_indexdef(ix.indexrelid), '^(CREATE (UNIQUE )?INDEX )("[^"]+"|\S+) ON ', '\1ON ') AS shape
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class c ON c.oid = ix.indrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('metrics', 'meal_items', 'workouts')
 GROUP BY 1, 4
HAVING count(*) > 1
 ORDER BY 1, 2 DESC;

\echo '== 3. the two unique keepers: both rows must read exists, uniq, valid, ready = t (up.sql refuses otherwise) =='
SELECT k.name AS keeper,
       ix.indexrelid IS NOT NULL AS exists,
       coalesce(ix.indisunique, false) AS uniq,
       coalesce(ix.indisvalid, false)  AS valid,
       coalesce(ix.indisready, false)  AS ready
  FROM (VALUES ('metrics', 'metrics_unique_idx'), ('meal_items', 'meal_items_unique_idx')) AS k(tbl, name)
  LEFT JOIN pg_class i ON i.relname = k.name AND i.relnamespace = 'public'::regnamespace
  LEFT JOIN pg_index ix ON ix.indexrelid = i.oid AND ix.indrelid = ('public.' || k.tbl)::regclass
 ORDER BY 1;

\echo '== 4. EXACTLY what up.sql will drop, and how =='
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
SELECT d.table_name, d.index_name, d.duplicate_of,
       CASE WHEN d.constraint_name IS NOT NULL
            THEN 'UNIQUE constraint -> ALTER TABLE DROP CONSTRAINT (brief ACCESS EXCLUSIVE)'
            ELSE 'plain index -> DROP INDEX CONCURRENTLY' END AS how,
       pg_size_pretty(pg_relation_size(d.indexrelid)) AS frees,
       s.idx_scan,
       pg_size_pretty(sum(pg_relation_size(d.indexrelid)) OVER ()) AS total_freed,
       (SELECT count(*) FROM pg_constraint f WHERE f.contype = 'f' AND f.conindid = d.indexrelid) AS fk_dependents
  FROM drops d LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = d.indexrelid
 ORDER BY 1, 2;
\echo '   fk_dependents must be 0 on every row (a foreign key needing the index would make the drop fail)'

\echo '== 5. sessions holding locks on these tables right now (the constraint drop waits behind these) =='
SELECT a.pid, a.application_name, a.state, now() - a.xact_start AS xact_age, l.mode,
       l.relation::regclass AS rel, left(a.query, 80) AS query
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
 WHERE l.relation IN ('public.metrics'::regclass, 'public.meal_items'::regclass, 'public.workouts'::regclass)
   AND a.pid <> pg_backend_pid()
 ORDER BY xact_age DESC NULLS LAST;

\echo '== 6. a previous run left a manifest? (absent is normal for a first run) =='
SELECT to_regclass('public.item49_dropped_indexes') AS manifest_table;
