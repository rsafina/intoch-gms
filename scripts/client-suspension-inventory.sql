-- READ ONLY. Run in the intended client's Supabase SQL editor as database admin.
-- Returns one JSON cell so the SQL editor does not hide earlier result sets.
-- No customer/staff rows are selected. Review custom function literals before sharing.
with relations as (

select n.nspname as schema_name,c.relname,c.relkind,c.relrowsecurity,c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','app_private','storage') and c.relkind in ('r','p','v','m')
order by 1,2
), policies as (

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by 1,2,3
), functions as (

select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as staff_execute,
 pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','app_private') and p.prokind='f'
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
order by 1
), grants as (

select table_schema,table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema in ('public','app_private','storage') and grantee in ('anon','authenticated','service_role')
order by 1,2,3,4
), realtime as (

select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime'
), buckets as (
select id,public from storage.buckets order by id
)
select jsonb_pretty(jsonb_build_object(
 'database_name',current_database(),
 'database_role',current_user,
 'relations',coalesce((select jsonb_agg(to_jsonb(r)) from relations r),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(to_jsonb(p)) from policies p),'[]'::jsonb),
 'functions',coalesce((select jsonb_agg(to_jsonb(f)) from functions f),'[]'::jsonb),
 'grants',coalesce((select jsonb_agg(to_jsonb(g)) from grants g),'[]'::jsonb),
 'realtime',coalesce((select jsonb_agg(to_jsonb(r)) from realtime r),'[]'::jsonb),
 'buckets',coalesce((select jsonb_agg(to_jsonb(b)) from buckets b),'[]'::jsonb)
)) as suspension_inventory;
