-- Apply after prepare + account migration, alongside the new frontend.
-- Deliberately separate from ALL_IN_ONE: existing accounts must be linked first.
begin;
do $$ begin
 if to_regclass('app_private.role_audit') is not null then raise exception 'Role enforcement is already installed; do not rerun this one-time migration'; end if;
 if exists(select 1 from public.staff_users where auth_user_id is null) then
  raise exception 'Migrate all staff accounts before enforcing roles';
 end if;
 if not exists(select 1 from public.staff_users where role='admin' and is_active) then
  raise exception 'At least one active admin is required';
 end if;
end $$;
create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated;
create or replace function public.app_staff_role() returns text language sql stable security definer set search_path=public,pg_temp as $$
 select role from public.staff_users where auth_user_id=auth.uid() and is_active
$$;
create or replace function public.app_staff_id() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
 select id from public.staff_users where auth_user_id=auth.uid() and is_active
$$;
create or replace function app_private.require_access(kind text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor text:=public.app_staff_role();
begin
 if auth.role()='service_role' or (coalesce(auth.role(),'')='' and session_user in ('postgres','supabase_admin')) then return; end if;
 if kind='public_read' then return; end if;
 if kind='public_write' and (auth.role()='anon' or actor in ('admin','manager','staff')) then return; end if;
 if kind='read' and actor in ('owner','admin','manager','staff') then return; end if;
 if kind='staff' and actor in ('admin','manager','staff') then return; end if;
 if kind='manager' and actor in ('admin','manager') then return; end if;
 if kind='admin' and actor='admin' then return; end if;
 raise exception 'This account cannot perform this action' using errcode='42501';
end $$;
-- Replace permissive policies, including legacy anon ALL policies.
do $$ declare row record; tab record; write_roles text; begin
 for row in select schemaname,tablename,policyname from pg_policies where schemaname='public' loop
  execute format('drop policy %I on %I.%I',row.policyname,row.schemaname,row.tablename);
 end loop;
 for tab in select tablename from pg_tables where schemaname='public' loop
  execute format('alter table public.%I enable row level security',tab.tablename);
  execute format('revoke all on public.%I from public,anon,authenticated',tab.tablename);
  execute format('grant select,insert,update,delete on public.%I to authenticated',tab.tablename);
  if tab.tablename='staff_users' then
   execute 'create policy staff_read on public.staff_users for select to authenticated using (auth_user_id=auth.uid() or public.app_staff_role()=''admin'')';
   write_roles:='public.app_staff_role()=''admin''';
  else
   execute format('create policy staff_read on public.%I for select to authenticated using (public.app_staff_role() in (''owner'',''admin'',''manager'',''staff''))',tab.tablename);
   write_roles:=case when tab.tablename in ('guests','reservations','visits','members','invoices','wa_outreach_log','birthday_greetings') then 'public.app_staff_role() in (''admin'',''manager'',''staff'')'
    else 'public.app_staff_role() in (''admin'',''manager'')' end;
  end if;
  execute format('create policy staff_insert on public.%I for insert to authenticated with check (%s)',tab.tablename,write_roles);
  execute format('create policy staff_update on public.%I for update to authenticated using (%s) with check (%s)',tab.tablename,write_roles,write_roles);
  execute format('create policy staff_delete on public.%I for delete to authenticated using (%s)',tab.tablename,case when tab.tablename='staff_users' then 'false' else 'public.app_staff_role() in (''admin'',''manager'')' end);
 end loop;
end $$;
do $$ declare item record; begin
 for item in select viewname from pg_views where schemaname='public' loop
 execute format('revoke all on public.%I from public,anon,authenticated',item.viewname);
 execute format('alter view public.%I set (security_invoker=true)',item.viewname);
 execute format('grant select on public.%I to authenticated',item.viewname);
 end loop;
end $$;
grant usage,select on all sequences in schema public to authenticated;
-- Public pages only need these non-personal configuration tables.
do $$ declare name text; begin
 foreach name in array array['app_settings','areas','tables','featured_dishes','prizes','reservation_exceptions','wa_campaigns'] loop
  if to_regclass('public.'||name) is not null then
   execute format('grant select on public.%I to anon',name);
   execute format('create policy public_configuration on public.%I for select to anon using (true)',name);
  end if;
 end loop;
end $$;
-- Eliminate stored plaintext PINs. Auth now verifies them; no client can read them.
update public.staff_users set pin=null;
revoke select on public.staff_users from authenticated;
grant select(id,username,display_name,role,is_active,created_at,auth_user_id) on public.staff_users to authenticated;

create or replace function app_private.protect_changes() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare actor text:=public.app_staff_role(); oldrow jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 newrow jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end; configured text;
begin
 if auth.role()='service_role' or coalesce(auth.role(),'')='' then return coalesce(new,old); end if;
 if tg_table_name='staff_users' then
  perform app_private.require_access('admin');
  if newrow->>'pin' is not null then raise exception 'Use authenticated account management to change PINs'; end if;
 elsif tg_table_name='app_settings' then
  if tg_op='INSERT' then select coalesce(to_jsonb(existing),'{}'::jsonb) into oldrow from public.app_settings existing where key=newrow->>'key'; end if;
  perform app_private.require_access('manager');
  if actor<>'admin' and oldrow->>'key'='reservation_form' and newrow->>'key' is distinct from 'reservation_form' then raise exception 'Only admin can remove payment settings' using errcode='42501'; end if;
  if coalesce(newrow->>'key',oldrow->>'key')='reservation_form' and actor<>'admin' and
   (coalesce(oldrow->'value'->'bank_details','null') is distinct from coalesce(newrow->'value'->'bank_details','null') or
    coalesce(oldrow->'value'->'qris_url','null') is distinct from coalesce(newrow->'value'->'qris_url','null')) then
   raise exception 'Only admin can change bank details or QRIS' using errcode='42501';
  end if;
 elsif tg_table_name in ('invoice_payments','member_transactions') then
  perform app_private.require_access('staff');
  if tg_op<>'INSERT' or coalesce((newrow->>'amount')::numeric,0)<0 then perform app_private.require_access('manager'); end if;
 elsif tg_table_name='reservations' and actor='staff' then
  if newrow->>'status'='Deleted' or (oldrow->>'deposit_required'='true' and newrow->>'deposit_required'='false') then perform app_private.require_access('manager'); end if;
 elsif tg_table_name='visits' and actor='staff' then
  if newrow->>'status'='Voided' or newrow->>'voided_at' is distinct from oldrow->>'voided_at' then perform app_private.require_access('manager'); end if;
 elsif tg_table_name='invoices' then
  if actor='staff' and (coalesce(newrow->>'kind',oldrow->>'kind','')<>'deposit' or newrow->>'status' in ('void','voided','Deleted')) then perform app_private.require_access('manager'); end if;
  if actor<>'admin' and tg_op<>'DELETE' and (newrow->'doc') ? 'note' then
   select value->>'bank_details' into configured from public.app_settings where key='reservation_form';
   if tg_op='INSERT' then
    if coalesce(newrow->>'note','')<>coalesce(configured,'') or coalesce(newrow->'doc'->>'note','')<>coalesce(configured,'') then
     raise exception 'Use the configured payment instructions; only admin can change them' using errcode='42501';
    end if;
   elsif newrow->>'note' is distinct from oldrow->>'note' or newrow->'doc'->>'note' is distinct from oldrow->'doc'->>'note' then
    raise exception 'Only admin can change invoice payment instructions' using errcode='42501';
   end if;
  end if;
 end if;
 return coalesce(new,old);
end $$;
do $$ declare name text; begin
 foreach name in array array['staff_users','app_settings','invoice_payments','member_transactions','reservations','visits','invoices'] loop
  if to_regclass('public.'||name) is not null then
   execute format('drop trigger if exists enforce_staff_changes on public.%I',name);
   execute format('create trigger enforce_staff_changes before insert or update or delete on public.%I for each row execute function app_private.protect_changes()',name);
  end if;
 end loop;
end $$;

-- Immutable audit log: actor comes from auth.uid(), never a submitted staff ID.
create table if not exists app_private.role_audit (
 id bigint generated always as identity primary key, occurred_at timestamptz not null default now(),
 actor_id uuid, auth_user_id uuid, table_name text not null, action text not null, before_row jsonb, after_row jsonb
);
create or replace function app_private.audit_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into app_private.role_audit(actor_id,auth_user_id,table_name,action,before_row,after_row)
 values(public.app_staff_id(),auth.uid(),tg_table_name,tg_op,case when tg_op<>'INSERT' then to_jsonb(old)-'pin' end,case when tg_op<>'DELETE' then to_jsonb(new)-'pin' end);
 return coalesce(new,old);
end $$;
do $$ declare name text; begin
 foreach name in array array['staff_users','app_settings','invoice_payments','member_transactions','reservations','visits'] loop
  if to_regclass('public.'||name) is not null then
   execute format('drop trigger if exists audit_staff_changes on public.%I',name);
   execute format('create trigger audit_staff_changes after insert or update or delete on public.%I for each row execute function app_private.audit_change()',name);
  end if;
 end loop;
end $$;
-- SECURITY DEFINER RPCs bypass RLS. Move implementations to a non-exposed schema,
-- and expose only wrappers which authorize the verified actor first.
do $$ declare fn record; kind text; args text; body text; result_type text; begin
 for fn in select p.*,pg_get_function_arguments(p.oid) as arguments,pg_get_function_identity_arguments(p.oid) as identity_args,pg_get_function_result(p.oid) as result_type
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  execute format('revoke execute on function public.%I(%s) from public,anon,authenticated',fn.proname,fn.identity_args);
  kind:=case
   when fn.proname in ('app_staff_role','app_staff_id','get_setting','area_slot_availability','reservation_hours_for','area_availability','deposit_invoice_by_token','invoice_by_token','reservation_ticket_by_token') then 'public_read'
   when fn.proname in ('create_public_reservation','create_spin_session','confirm_spin_session') then 'public_write'
   when fn.proname in ('get_guest_visit_summary','get_guests_for_birthday_view','reservation_table_availability','list_member_backfill_visits') then 'read'
   when fn.proname in ('record_invoice_payment','record_deposit_payment','add_member_transaction','redeem_member_voucher','complete_billed_reservation','next_invoice_no','issue_reservation_ticket','expire_unpaid_deposits') then 'staff'
   when fn.proname in ('waive_deposit','void_standalone_voucher','redeem_standalone_voucher','convert_visits_to_stickers','recalc_all_tiers') then 'manager'
   else null end;
  if kind is null then continue; end if;
  if fn.proname in ('app_staff_role','app_staff_id') then
   execute format('grant execute on function public.%I(%s) to anon,authenticated',fn.proname,fn.identity_args); continue;
  end if;
  -- A second application must not wrap a wrapper. This migration is one-time.
  select string_agg(case when fn.proargnames[i] in ('p_staff_id','p_created_by','p_redeemed_by','p_voided_by') then 'public.app_staff_id()' else '$'||i end,',' order by i) into args from generate_series(1,fn.pronargs) i;
  args:=coalesce(args,'');
  execute format('alter function public.%I(%s) set schema app_private',fn.proname,fn.identity_args);
  body:=format('begin perform app_private.require_access(%L); ',kind);
  if fn.proretset then body:=body||format('return query select * from app_private.%I(%s);',fn.proname,args);
  elsif fn.result_type='void' then body:=body||format('perform app_private.%I(%s); return;',fn.proname,args);
  else body:=body||format('return app_private.%I(%s);',fn.proname,args); end if;
  body:=body||' end';
  execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path=public,pg_temp as %L',fn.proname,fn.arguments,fn.result_type,body);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',fn.proname,fn.identity_args);
  execute format('grant execute on function public.%I(%s) to authenticated',fn.proname,fn.identity_args);
  if kind like 'public_%%' then execute format('grant execute on function public.%I(%s) to anon',fn.proname,fn.identity_args); end if;
 end loop;
end $$;
create or replace function public.record_staff_pin_change(p_staff_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform app_private.require_access('admin');
 insert into app_private.role_audit(actor_id,auth_user_id,table_name,action,after_row)
 values(public.app_staff_id(),auth.uid(),'staff_users','PIN_CHANGED',jsonb_build_object('id',p_staff_id));
end $$;
revoke all on function public.record_staff_pin_change(uuid) from public,anon;
grant execute on function public.record_staff_pin_change(uuid) to authenticated;
-- Storage policies also use the verified staff row. The restrictive policy
-- prevents old permissive policies from authorizing writes by owner or anon.
create policy staff_storage_write_guard on storage.objects as restrictive for all to anon,authenticated
 using (public.app_staff_role() in ('admin','manager') and (name !~ '(^|/)deposit-qris-' and not exists (select 1 from public.app_settings cfg where cfg.key='reservation_form' and split_part(cfg.value->>'qris_url','/object/public/'||bucket_id||'/',2)=name) or public.app_staff_role()='admin'))
 with check (public.app_staff_role() in ('admin','manager') and (name !~ '(^|/)deposit-qris-' and not exists (select 1 from public.app_settings cfg where cfg.key='reservation_form' and split_part(cfg.value->>'qris_url','/object/public/'||bucket_id||'/',2)=name) or public.app_staff_role()='admin'));
create policy staff_storage_operations on storage.objects for all to authenticated using (public.app_staff_role() in ('admin','manager')) with check (public.app_staff_role() in ('admin','manager'));
-- Public bucket URLs remain readable via Storage's public download endpoint.
notify pgrst,'reload schema';
commit;
