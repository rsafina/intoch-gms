-- Targeted, default-active upgrade. Review scripts/client-suspension-inventory.sql first.
-- Never run ALL_IN_ONE or roles_enforce on an already secured client.
begin;

do $$
declare item record;
begin
 if to_regprocedure('public.app_session_valid()') is null
    or to_regprocedure('app_private.require_access(text)') is null
    or to_regclass('auth.sessions') is null then
  raise exception 'Session/role migrations must be installed before client suspension';
 end if;
 if not exists(select 1 from pg_proc where oid='public.app_session_valid()'::regprocedure
   and prosecdef and prosrc like '%sessions_valid_after%' and prosrc like '%pin_reset_pending%') then
  raise exception 'Unexpected session implementation; inspect live inventory before upgrading';
 end if;
 if not exists(select 1 from pg_proc where oid='app_private.require_access(text)'::regprocedure
   and prosecdef and prosrc like '%finance%' and prosrc like '%public_write%') then
  raise exception 'Expected Finance-aware access guard; inspect live inventory';
 end if;
 for item in select signature from unnest(array['public.app_staff_role()',
   'public.app_staff_id()','public.app_can_waive_deposit()']) as required(signature)
 loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(item.signature)
    and prosecdef and prosrc like '%app_session_valid()%') then
   raise exception 'Expected session-aware helper: %',item.signature;
  end if;
 end loop;
 -- Unknown callable functions require review, rather than silently promising full coverage.
 -- This textual check is a drift alarm, not a substitute for reviewing the inventory.
 for item in
  select p.oid::regprocedure as signature from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
   and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
   and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
   and not coalesce(p.oid=any(array[
    to_regprocedure('public.app_session_valid()'),to_regprocedure('public.app_staff_role()'),
    to_regprocedure('public.app_staff_id()'),to_regprocedure('public.app_can_waive_deposit()'),
    to_regprocedure('public.app_client_access_allowed()'),to_regprocedure('public.default_reservation_duration()'),
    to_regprocedure('public.invoice_document_rupiah(jsonb)')]),false)
   and p.prosrc not like '%app_private.require_access(%'
   and not coalesce(p.oid=to_regprocedure('public.waive_deposit(uuid,text,uuid)')
    and p.prosrc like '%if not public.app_can_waive_deposit()%',false)
 loop
  raise exception 'Unreviewed callable function: %. Inventory/review required before suspension',item.signature;
 end loop;
 for item in select c.oid::regclass as relation from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 loop
  raise exception 'RLS must already be enabled on %',item.relation;
 end loop;
 for item in select c.oid::regclass as relation from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('v','m')
   and (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT'))
   and not coalesce(c.reloptions @> array['security_invoker=true'],false)
 loop
  raise exception 'Exposed view % must be reviewed for invoker security',item.relation;
 end loop;
end $$;

create table if not exists app_private.client_access (
 singleton boolean primary key default true check(singleton),
 suspended boolean not null default false,
 changed_at timestamptz not null default clock_timestamp(),
 reason text not null default ''
);
create table if not exists app_private.client_access_history (
 id bigint generated always as identity primary key,
 suspended boolean not null, reason text not null,
 changed_at timestamptz not null default clock_timestamp(),
 changed_by text not null default session_user
);
revoke all on app_private.client_access,app_private.client_access_history from public,anon,authenticated,service_role;
insert into app_private.client_access(singleton) values(true) on conflict do nothing;

-- Only a boolean is exposed. No reason, operator identity, or writable setting is public.
create or replace function public.app_client_access_allowed() returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce((select not suspended from app_private.client_access where singleton),false);
$$;
revoke all on function public.app_client_access_allowed() from public;
grant execute on function public.app_client_access_allowed() to anon,authenticated;

-- Deliberately private and not granted to the API's service role or restaurant Admin.
create or replace function app_private.set_client_suspended(p_suspended boolean,p_reason text)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_suspended is null or nullif(btrim(p_reason),'') is null then
  raise exception 'Suspension state and an operator reason are required';
 end if;
 update app_private.client_access set suspended=p_suspended,reason=p_reason,changed_at=clock_timestamp() where singleton;
 if not found then raise exception 'Client access control row missing'; end if;
 insert into app_private.client_access_history(suspended,reason) values(p_suspended,p_reason);
end $$;
revoke all on function app_private.set_client_suspended(boolean,text) from public,anon,authenticated,service_role;

-- Return false (not an exception): existing staff tabs reload when the monitor sees false.
create or replace function public.app_session_valid() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.app_client_access_allowed() and exists(
  select 1 from public.staff_users u join auth.sessions s
   on s.user_id=u.auth_user_id and s.id::text=auth.jwt()->>'session_id'
  where u.auth_user_id=auth.uid() and u.is_active and not u.pin_reset_pending
   and (u.sessions_valid_after is null or s.created_at>u.sessions_valid_after));
$$;
revoke all on function public.app_session_valid() from public,anon;
grant execute on function public.app_session_valid() to authenticated;

-- Keep the established role matrix and trusted service/database maintenance path.
create or replace function app_private.require_access(kind text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor text:=public.app_staff_role();
begin
 if auth.role()='service_role' or (coalesce(auth.role(),'')='' and session_user in ('postgres','supabase_admin')) then return; end if;
 if not public.app_client_access_allowed() then
  raise exception 'Access expired. Please contact Intoch PIC.' using errcode='42501';
 end if;
 if kind='public_read' then return; end if;
 if kind='public_write' and (auth.role()='anon' or actor in ('admin','manager','staff','finance')) then return; end if;
 if kind='read' and actor in ('owner','admin','manager','staff','finance') then return; end if;
 if kind='staff' and actor in ('admin','manager','staff','finance') then return; end if;
 if kind='manager' and actor in ('admin','manager') then return; end if;
 if kind='admin' and actor='admin' then return; end if;
 raise exception 'This account cannot perform this action' using errcode='42501';
end $$;

-- Restrictive policies AND with existing permissions; they never grant new access.
-- Include self-profile and anonymous configuration reads which bypass role helpers.
do $$ declare item record;
begin
 for item in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
   and c.relkind in ('r','p')
   and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
 loop
  if not (select relrowsecurity from pg_class where oid=format('%I.%I',item.nspname,item.relname)::regclass) then
   raise exception 'RLS must already be enabled on %.%',item.nspname,item.relname;
  end if;
  execute format('drop policy if exists client_access_guard on %I.%I',item.nspname,item.relname);
  execute format('create policy client_access_guard on %I.%I as restrictive for all to anon,authenticated using ((select public.app_client_access_allowed())) with check ((select public.app_client_access_allowed()))',item.nspname,item.relname);
 end loop;
end $$;
commit;
notify pgrst, 'reload schema';
