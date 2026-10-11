-- Playground-only, additive isolation. Never run against a restaurant project.
-- Snapshot the installed operational rules into a separate schema. Public staff
-- tables, policies, functions and records are neither replaced nor backfilled.
begin;
do $$ begin
 if current_setting('intoch.demo_project_ref',true) is distinct from 'hkrhsubhfqrgqkuhpvql' then
  raise exception 'Set intoch.demo_project_ref to the verified playground ref before this migration';
 end if;
 if to_regclass('demo_private.sessions') is not null then
  raise exception 'Demo isolation is already installed; use a targeted upgrade';
 end if;
 if to_regprocedure('public.app_session_valid()') is null or
    to_regprocedure('public.record_reservation_arrival(uuid)') is null or
    to_regprocedure('public.finish_visit_without_spending(uuid,uuid,text)') is null then
  raise exception 'Install and verify current role, spending and arrival migrations first';
 end if;
 if exists(select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid
  join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=g.tgfoid
  join pg_namespace fn on fn.oid=p.pronamespace
  where n.nspname='public' and not g.tgisinternal and fn.nspname not in ('public','app_private')) or
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','app_private') and p.prokind='f'
    and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
    and pg_get_functiondef(p.oid) ~* '(\mnet\.|\mhttp_|\mdblink|\msupabase_functions\.|\mvault\.)') then
  raise exception 'External hooks/functions need review before copying demo rules';
 end if;
end $$;
create schema demo_private;
create schema intoch_demo;
revoke all on schema demo_private,intoch_demo from public,anon,authenticated;
create role intoch_demo_executor nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
-- Supabase's postgres role is not a superuser. Temporary membership is needed
-- to assign copied function ownership, then removed before commit.
grant intoch_demo_executor to postgres;
grant usage,create on schema intoch_demo,demo_private to intoch_demo_executor;
-- Narrow bridges avoid needing grants on the platform-owned Auth schema.
create function demo_private.demo_auth_uid() returns uuid language sql stable
security definer set search_path=pg_catalog as $$select auth.uid()$$;
create function demo_private.demo_auth_role() returns text language sql stable
security definer set search_path=pg_catalog as $$select auth.role()$$;
create function demo_private.demo_auth_jwt() returns jsonb language sql stable
security definer set search_path=pg_catalog as $$select auth.jwt()$$;

create table demo_private.sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 auth_session_id uuid not null,
 state text not null default 'preparing' check(state in ('preparing','active','ended','cleaning')),
 created_at timestamptz not null default clock_timestamp(),
 started_at timestamptz, expires_at timestamptz,
 seed_version integer not null default 1,
 ip_hash text not null,
 check ((started_at is null and expires_at is null) or expires_at=started_at+interval '60 minutes')
);
create index demo_sessions_expiry on demo_private.sessions(expires_at);
create index demo_sessions_rate on demo_private.sessions(ip_hash,created_at);
create table demo_private.audit (
 id bigint generated always as identity primary key, workspace_id uuid not null,
 user_id uuid, occurred_at timestamptz not null default clock_timestamp(),
 relation_name text not null, operation text not null
);
-- This helper is the ONLY privileged read needed by ordinary demo queries.
-- The provisioning override is accepted solely for a service-role request.
create function demo_private.workspace() returns uuid language plpgsql volatile
security definer set search_path=pg_catalog,demo_private as $$
declare workspace uuid;
begin
 if auth.role()='service_role' then
  workspace:=nullif(current_setting('intoch.demo_seed_workspace',true),'')::uuid;
  if workspace is not null then return workspace; end if;
 end if;
 if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) is not true then return null; end if;
 select s.id into workspace from demo_private.sessions s join auth.sessions a
  on a.id=s.auth_session_id and a.user_id=s.user_id
  where s.user_id=auth.uid() and s.auth_session_id::text=auth.jwt()->>'session_id'
   and s.state='active' and clock_timestamp()<s.expires_at;
 return workspace;
end $$;
revoke all on function demo_private.workspace() from public,anon;
grant execute on function demo_private.workspace() to authenticated,intoch_demo_executor;

-- Clone tables without data; INCLUDING ALL copies checks/defaults/identity/indexes,
-- but not FKs or triggers. Each identity has a new sequence in the demo schema.
do $$ declare item record; definition text; idx record; key_columns text; begin
 for item in select tablename from pg_tables where schemaname='public' order by tablename loop
  execute format('create table intoch_demo.%I (like public.%I including all)',item.tablename,item.tablename);
  execute format('alter table intoch_demo.%I add column workspace_id uuid not null default demo_private.workspace() references demo_private.sessions(id) on delete cascade',item.tablename);
  -- Global settings/date keys cannot be reused by two visitors.
  if item.tablename in ('app_settings','wa_templates','reservation_exceptions') then
   for idx in select conname,pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid=('intoch_demo.'||item.tablename)::regclass and contype='p' loop
    execute format('alter table intoch_demo.%I drop constraint %I',item.tablename,idx.conname);
    definition:=replace(idx.def,'PRIMARY KEY (','PRIMARY KEY (workspace_id, ');
    execute format('alter table intoch_demo.%I add %s',item.tablename,definition);
   end loop;
  end if;
  -- Keep globally unique row IDs, but scope other uniqueness (phones/codes/etc).
  for idx in select c.relname as name,pg_get_indexdef(i.indexrelid) as def from pg_index i
    join pg_class c on c.oid=i.indexrelid
    where i.indrelid=('intoch_demo.'||item.tablename)::regclass and i.indisunique and not i.indisprimary loop
   definition:=replace(idx.def,'USING btree (','USING btree (workspace_id, ');
   if position('workspace_id' in idx.def)>0 then continue; end if;
   -- LIKE copies UNIQUE constraints as indexes. Remove a constraint if present.
   if exists(select 1 from pg_constraint where conindid=('intoch_demo.'||idx.name)::regclass) then
    select conname into key_columns from pg_constraint where conindid=('intoch_demo.'||idx.name)::regclass;
    execute format('alter table intoch_demo.%I drop constraint %I',item.tablename,key_columns);
   else execute format('drop index intoch_demo.%I',idx.name); end if;
   execute definition;
  end loop;
  if exists(select 1 from pg_attribute where attrelid=('intoch_demo.'||item.tablename)::regclass and attname='id' and not attisdropped) then
   execute format('create unique index on intoch_demo.%I(workspace_id,id)',item.tablename);
  end if;
  execute format('alter table intoch_demo.%I enable row level security',item.tablename);
  execute format('create policy demo_executor_scope on intoch_demo.%I for all to intoch_demo_executor using(workspace_id=demo_private.workspace()) with check(workspace_id=demo_private.workspace())',item.tablename);
  execute format('create policy demo_visitor_scope on intoch_demo.%I for all to authenticated using(workspace_id=demo_private.workspace()) with check(workspace_id=demo_private.workspace())',item.tablename);
  execute format('create index on intoch_demo.%I(workspace_id)',item.tablename);
 end loop;
end $$;

-- Native composite FKs prohibit cross-workspace references, including for
-- service provisioning. SET NULL only clears the original nullable FK columns.
do $$ declare item record; local_cols text; remote_cols text; removal text; begin
 for item in select c.*,local_rel.relname as local_name,remote_rel.relname as remote_name
  from pg_constraint c join pg_class local_rel on local_rel.oid=c.conrelid
  join pg_namespace n on n.oid=local_rel.relnamespace
  join pg_class remote_rel on remote_rel.oid=c.confrelid
  join pg_namespace rn on rn.oid=remote_rel.relnamespace
  where n.nspname='public' and rn.nspname='public' and c.contype='f' loop
  select string_agg(quote_ident(a.attname),',' order by ord) into local_cols
   from unnest(item.conkey) with ordinality keys(num,ord)
   join pg_attribute a on a.attrelid=item.conrelid and a.attnum=keys.num;
  select string_agg(quote_ident(a.attname),',' order by ord) into remote_cols
   from unnest(item.confkey) with ordinality keys(num,ord)
   join pg_attribute a on a.attrelid=item.confrelid and a.attnum=keys.num;
  removal:=case item.confdeltype when 'c' then 'cascade' when 'r' then 'restrict'
   when 'n' then 'set null ('||local_cols||')' else 'no action' end;
  execute format('alter table intoch_demo.%I add constraint %I foreign key(workspace_id,%s) references intoch_demo.%I(workspace_id,%s) on delete %s',
   item.local_name,item.conname,local_cols,item.remote_name,remote_cols,removal);
 end loop;
end $$;

-- Copy the INSTALLED rule definitions, not historical ALL_IN_ONE definitions.
-- A non-owner, NO BYPASSRLS executor runs even SECURITY DEFINER copies: every
-- nested read/write is scoped by RLS. Original public functions remain untouched.
set local check_function_bodies=off;
do $$ declare item record; definition text; target_schema text; begin
 for item in select p.oid,p.proname,n.nspname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind='f'
   and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  target_schema:=case item.nspname when 'public' then 'intoch_demo' else 'demo_private' end;
  definition:=pg_get_functiondef(item.oid);
  definition:=replace(replace(definition,'public.','intoch_demo.'),'app_private.','demo_private.');
  definition:=replace(replace(replace(definition,'auth.uid()','demo_private.demo_auth_uid()'),'auth.role()','demo_private.demo_auth_role()'),'auth.jwt()','demo_private.demo_auth_jwt()');
  definition:=replace(definition,'ON CONFLICT (phone)','ON CONFLICT (workspace_id, phone)');
  definition:=replace(definition,'on conflict (phone)','on conflict (workspace_id, phone)');
  definition:=replace(definition,'on conflict (key)','on conflict (workspace_id, key)');
  definition:=replace(definition,'on conflict(key)','on conflict(workspace_id,key)');
  execute definition;
  item.args:=replace(replace(item.args,'public.','intoch_demo.'),'app_private.','demo_private.');
  execute format('alter function %I.%I(%s) set search_path=intoch_demo,demo_private,pg_catalog,pg_temp',target_schema,item.proname,item.args);
  execute format('alter function %I.%I(%s) set lock_timeout=''2s''',target_schema,item.proname,item.args);
  execute format('alter function %I.%I(%s) owner to intoch_demo_executor',target_schema,item.proname,item.args);
 end loop;
end $$;

create or replace function intoch_demo.app_session_valid() returns boolean language sql volatile
set search_path=pg_catalog as $$select demo_private.workspace() is not null$$;
create or replace function intoch_demo.app_staff_role() returns text language sql volatile
set search_path=pg_catalog as $$select case when demo_private.workspace() is not null then 'staff'::text end$$;
create or replace function intoch_demo.app_staff_id() returns uuid language sql
set search_path=pg_catalog as $$select null::uuid$$;
create or replace function intoch_demo.app_can_waive_deposit() returns boolean language sql
set search_path=pg_catalog as $$select false$$;
create or replace function demo_private.require_access(kind text) returns void language plpgsql
set search_path=pg_catalog as $$begin
 if demo_private.demo_auth_role()='service_role' and demo_private.workspace() is not null then return; end if;
 if demo_private.workspace() is not null and kind in ('read','staff','public_read','public_write') then return; end if;
 raise exception 'Demo access expired or action unavailable' using errcode='42501';
end $$;
-- Avoid copying full row payloads into the staff audit table (or a cloned one).
create or replace function demo_private.audit_change() returns trigger language plpgsql
security definer set search_path=pg_catalog,demo_private as $$begin
 insert into demo_private.audit(workspace_id,user_id,relation_name,operation)
 values(coalesce(new.workspace_id,old.workspace_id),auth.uid(),tg_table_name,tg_op);
 return coalesce(new,old);
end $$;
alter function demo_private.audit_change() owner to postgres;

-- LIKE retains bound default function OIDs. Rebind operational defaults to
-- their demo copies; extension UUID defaults remain in their original schema.
do $$ declare item record; definition text; extension_fn record; begin
 for item in select c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) as def
  from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
  join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and a.attidentity='' loop
  definition:=replace(replace(item.def,'public.','intoch_demo.'),'app_private.','demo_private.');
  definition:=regexp_replace(definition,'(intoch_demo\.|public\.)?uuid_generate_v4\(\)','gen_random_uuid()','g');
  for extension_fn in select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
   definition:=replace(definition,'intoch_demo.'||extension_fn.proname||'(','public.'||extension_fn.proname||'(');
  end loop;
  perform set_config('search_path','intoch_demo,demo_private,pg_catalog,public',true);
  execute format('alter table intoch_demo.%I alter column %I set default %s',item.relname,item.attname,definition);
 end loop;
end $$;

-- Rebind views and triggers exclusively to the isolated copies.
do $$ declare item record; definition text; begin
 for item in select c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='v' order by c.oid loop
  definition:=replace(replace(pg_get_viewdef(item.oid,true),'public.','intoch_demo.'),'app_private.','demo_private.');
  -- pg_get_viewdef can emit unqualified relations; resolve only demo copies.
  perform set_config('search_path','intoch_demo,demo_private,pg_catalog',true);
  execute format('create view intoch_demo.%I with(security_invoker=true) as %s',item.relname,definition);
 end loop;
 for item in select pg_get_triggerdef(g.oid,true) as def from pg_trigger g
  join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not g.tgisinternal loop
  definition:=replace(replace(item.def,'public.','intoch_demo.'),'app_private.','demo_private.');
  execute definition;
 end loop;
end $$;
set local search_path=public,pg_catalog;

-- Arrays and attribution are not covered by scalar foreign keys. Freeze tenant
-- ownership, reject staff impersonation, and require attendance for completion.
create function demo_private.guard_row() returns trigger language plpgsql
set search_path=pg_catalog as $$
declare row_data jsonb:=to_jsonb(new); field text; table_uuid uuid;
begin
 if octet_length(row_data::text)>8192 then raise exception 'Demo record is too large'; end if;
 if demo_private.demo_auth_role()<>'service_role' then
  -- Serialize per-workspace quotas; expiry is checked again after lock waits.
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,20261011));
 end if;
 if tg_op='UPDATE' and new.workspace_id is distinct from old.workspace_id then
  raise exception 'Workspace ownership cannot change' using errcode='42501';
 end if;
 if demo_private.demo_auth_role()<>'service_role' then
  if new.workspace_id is distinct from demo_private.workspace() then
   raise exception 'Demo access expired' using errcode='42501';
  end if;
  foreach field in array array['created_by','issued_by','deleted_by','voided_by','follow_up_done_by','reminder_d1_ack_by','reminder_dday_ack_by'] loop
   if row_data->>field is not null then raise exception 'Demo cannot impersonate staff' using errcode='42501'; end if;
  end loop;
  if tg_op='INSERT' then
   if tg_table_name='guests' and (select count(*) from intoch_demo.guests)>=500 or
      tg_table_name='reservations' and (select count(*) from intoch_demo.reservations)>=1000 or
      tg_table_name='visits' and (select count(*) from intoch_demo.visits)>=2000 then
    raise exception 'Demo record limit reached';
   end if;
  end if;
 end if;
 if row_data ? 'table_ids' then
  for table_uuid in select jsonb_array_elements_text(row_data->'table_ids')::uuid loop
   if not exists(select 1 from intoch_demo.tables where id=table_uuid and workspace_id=new.workspace_id) then
    raise exception 'Table belongs to another workspace' using errcode='42501';
   end if;
  end loop;
 end if;
 if tg_table_name='reservations' and row_data->>'status'='Completed' and
  not exists(select 1 from intoch_demo.visits where reservation_id=new.id and voided_at is null) then
  raise exception 'A completed reservation requires a real visit';
 end if;
 return new;
end $$;
do $$ declare name text; begin
 foreach name in array array['guests','reservations','visits'] loop
  execute format('create trigger z_demo_guard before insert or update on intoch_demo.%I for each row execute function demo_private.guard_row()',name);
 end loop;
end $$;

-- Revoke copied defaults: no public APIs for accounts, payments, messaging,
-- vouchers, storage or token document lookups. Only the four-page surface is exposed.
revoke all on all functions in schema intoch_demo,demo_private from public,anon,authenticated;
grant usage on schema intoch_demo,demo_private to authenticated;
grant all on all tables in schema intoch_demo to intoch_demo_executor;
grant usage,select on all sequences in schema intoch_demo to intoch_demo_executor;
grant execute on all functions in schema intoch_demo,demo_private to intoch_demo_executor;
grant execute on function demo_private.workspace() to authenticated;
grant execute on function demo_private.demo_auth_role() to authenticated;
grant select on intoch_demo.guests,intoch_demo.reservations,intoch_demo.visits,
 intoch_demo.areas,intoch_demo.tables,intoch_demo.app_settings,intoch_demo.reservation_exceptions,
 intoch_demo.members,intoch_demo.member_transactions,intoch_demo.member_vouchers,
 intoch_demo.invoices,intoch_demo.invoice_payments,intoch_demo.prizes,intoch_demo.spin_submissions,
 intoch_demo.birthday_greetings to authenticated;
grant insert,update,delete on intoch_demo.guests,intoch_demo.reservations,intoch_demo.visits to authenticated;
do $$ declare item record; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='intoch_demo' and c.relkind='v' loop
  execute format('grant select on intoch_demo.%I to authenticated',item.relname);
 end loop;
 for item in select p.proname,pg_get_function_identity_arguments(p.oid) as args from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='intoch_demo' and p.proname in
  ('default_reservation_duration','get_guest_visit_summary','get_guests_for_birthday_view',
   'reservation_table_availability','area_availability','area_slot_availability','reservation_hours_for',
   'record_reservation_arrival','reservation_spending_context','save_visit_spending',
   'finish_visit_without_spending','set_reservation_followup','create_public_reservation') loop
  execute format('grant execute on function intoch_demo.%I(%s) to authenticated',item.proname,item.args);
 end loop;
end $$;
revoke create on schema intoch_demo,demo_private from intoch_demo_executor;

create function public.demo_session_status() returns jsonb language sql volatile
security definer set search_path=pg_catalog,demo_private as $$
 select jsonb_build_object('id',s.id,'user_id',s.user_id,'state',s.state,
 'started_at',s.started_at,'expires_at',s.expires_at,'server_now',clock_timestamp(),
 'active',coalesce(demo_private.workspace()=s.id,false))
 from demo_private.sessions s where s.user_id=auth.uid()
 and coalesce((auth.jwt()->>'is_anonymous')::boolean,false);
$$;
create function public.demo_end_session() returns jsonb language plpgsql
security definer set search_path=pg_catalog,demo_private as $$begin
 update demo_private.sessions set state='ended' where user_id=auth.uid()
  and auth_session_id::text=auth.jwt()->>'session_id' and state='active';
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.demo_session_status(),public.demo_end_session() from public,anon;
grant execute on function public.demo_session_status(),public.demo_end_session() to authenticated;
notify pgrst,'reload schema';
revoke intoch_demo_executor from postgres;
commit;
