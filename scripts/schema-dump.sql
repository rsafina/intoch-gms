-- Dump a Supabase project's public schema as JSON, for scripts/schema-check.js.
--
-- Paste this whole file into the Supabase SQL Editor for the project you want
-- to check and run it. It returns ONE row with ONE column of JSON. Save that
-- value to a file and run:
--
--   node scripts/schema-check.js catalog.json
--
-- Read-only. It touches no data and changes nothing.
--
-- For a NEW client, run migrations/ALL_IN_ONE.sql on the empty project FIRST,
-- then run this. The whole point is to catch an object the app uses that the
-- migration file never creates, which is the defect class that has bitten this
-- project eight times.

select json_build_object(

  -- Tables, views and materialised views in public, with their columns.
  'relations', (
    select coalesce(json_object_agg(rel, cols), '{}'::json)
    from (
      select c.relname as rel,
             json_agg(a.attname order by a.attname) as cols
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public'
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
      group by c.relname
    ) s
  ),

  -- Functions in public, with their full argument lists. Overloads are kept
  -- as separate entries because an RPC can be called with an argument that
  -- exists on only one of them.
  'functions', (
    select coalesce(json_object_agg(fname, args), '{}'::json)
    from (
      select p.proname as fname,
             json_agg(distinct coalesce(pg_get_function_arguments(p.oid), '')) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      group by p.proname
    ) s
  ),

  -- Storage buckets. A missing bucket is invisible until somebody uploads.
  'buckets', (select coalesce(json_agg(id order by id), '[]'::json) from storage.buckets)

) as catalog;
