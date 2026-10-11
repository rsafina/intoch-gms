-- Targeted upgrade: only copied executor functions; original rules untouched.
begin;
do $$begin
 if current_setting('intoch.demo_project_ref',true) is distinct from 'hkrhsubhfqrgqkuhpvql' or
    to_regclass('demo_private.sessions') is null then raise exception 'Verify installed playground demo first';end if;
end $$;
create or replace function demo_private.demo_auth_uid() returns uuid language sql stable
security definer set search_path=pg_catalog as $$select auth.uid()$$;
create or replace function demo_private.demo_auth_role() returns text language sql stable
security definer set search_path=pg_catalog as $$select auth.role()$$;
create or replace function demo_private.demo_auth_jwt() returns jsonb language sql stable
security definer set search_path=pg_catalog as $$select auth.jwt()$$;
revoke all on function demo_private.demo_auth_uid(),demo_private.demo_auth_role(),demo_private.demo_auth_jwt() from public,anon,authenticated;
grant execute on function demo_private.demo_auth_uid(),demo_private.demo_auth_role(),demo_private.demo_auth_jwt() to intoch_demo_executor;
grant execute on function demo_private.demo_auth_role() to authenticated;
do $$declare definition text;begin
 definition:=pg_get_functiondef('demo_private.guard_row()'::regprocedure);
 execute replace(definition,'auth.role()','demo_private.demo_auth_role()');
end $$;
grant create on schema intoch_demo,demo_private to intoch_demo_executor;
grant intoch_demo_executor to postgres;
set local role intoch_demo_executor;
do $$declare item record; definition text;begin
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join pg_roles r on r.oid=p.proowner where n.nspname in ('intoch_demo','demo_private') and r.rolname='intoch_demo_executor' and p.prokind='f' loop
  definition:=pg_get_functiondef(item.oid);
  definition:=replace(replace(replace(definition,'auth.uid()','demo_private.demo_auth_uid()'),'auth.role()','demo_private.demo_auth_role()'),'auth.jwt()','demo_private.demo_auth_jwt()');
  execute definition;
 end loop;
end $$;
reset role;
revoke create on schema intoch_demo,demo_private from intoch_demo_executor;
revoke intoch_demo_executor from postgres;
notify pgrst,'reload schema';
commit;
