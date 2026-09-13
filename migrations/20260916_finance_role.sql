-- After Phase 1, role save-path fixes and 20260912_staff_deposit_waiver.sql.
-- Deploy updated staff-account and frontend after this migration.
begin;
do $$ begin
 if to_regprocedure('public.app_can_waive_deposit()') is null then
  raise exception 'Apply the staff deposit waiver migration first';
 end if;
end $$;
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
 check (role in ('owner','admin','manager','staff','finance'));

create or replace function app_private.require_access(kind text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor text:=public.app_staff_role();
begin
 if auth.role()='service_role' or (coalesce(auth.role(),'')='' and session_user in ('postgres','supabase_admin')) then return; end if;
 if kind='public_read' then return; end if;
 if kind='public_write' and (auth.role()='anon' or actor in ('admin','manager','staff','finance')) then return; end if;
 if kind='read' and actor in ('owner','admin','manager','staff','finance') then return; end if;
 if kind='staff' and actor in ('admin','manager','staff','finance') then return; end if;
 if kind='manager' and actor in ('admin','manager') then return; end if;
 if kind='admin' and actor='admin' then return; end if;
 raise exception 'This account cannot perform this action' using errcode='42501';
end $$;

-- Add narrow policies without rewriting the existing role policies.
-- Visits are read-only for guest history and membership; no direct Walk-In writes.
do $$ declare tab text; begin
 foreach tab in array array['app_settings','areas','tables','reservation_exceptions',
  'guests','reservations','visits','members','member_transactions','member_vouchers',
  'invoices','invoice_payments','standalone_vouchers','wa_outreach_log','birthday_greetings'] loop
  if to_regclass('public.'||tab) is not null then
   execute format('drop policy if exists finance_read on public.%I',tab);
   execute format('create policy finance_read on public.%I for select to authenticated using (public.app_staff_role()=''finance'')',tab);
  end if;
 end loop;
 foreach tab in array array['guests','reservations','members','invoices','wa_outreach_log','birthday_greetings'] loop
  if to_regclass('public.'||tab) is not null then
   execute format('drop policy if exists finance_insert on public.%I',tab);
   execute format('drop policy if exists finance_update on public.%I',tab);
   execute format('create policy finance_insert on public.%I for insert to authenticated with check (public.app_staff_role()=''finance'')',tab);
   execute format('create policy finance_update on public.%I for update to authenticated using (public.app_staff_role()=''finance'') with check (public.app_staff_role()=''finance'')',tab);
  end if;
 end loop;
 if to_regclass('public.standalone_vouchers') is not null then
  drop policy if exists finance_issue on public.standalone_vouchers;
  create policy finance_issue on public.standalone_vouchers for insert to authenticated
   with check (public.app_staff_role()='finance' and not redeemed and not voided
    and redeemed_at is null and voided_at is null and issued_by=public.app_staff_id());
 end if;
end $$;

create or replace function public.app_can_waive_deposit()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff_users where auth_user_id=auth.uid() and is_active
  and (role in ('admin','manager') or (role in ('staff','finance') and can_waive_deposit)));
$$;

-- Extend the existing reservation guard, preserving prior waiver patches.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('app_private.protect_changes()'::regprocedure);
 definition:=replace(definition, 'tg_table_name=''reservations'' and actor=''staff''',
  'tg_table_name=''reservations'' and actor in (''staff'',''finance'')');
 execute definition;
end $$;

create or replace function app_private.protect_finance_changes() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.app_staff_role() is distinct from 'finance' then return coalesce(new,old); end if;
 if tg_op='DELETE' then raise exception 'Finance cannot delete records' using errcode='42501'; end if;
 if tg_table_name='invoices' and new.status in ('void','voided','Deleted') then
  raise exception 'Only managers can void invoices' using errcode='42501';
 end if;
 if tg_table_name='invoices' and tg_op='UPDATE' and old.status in ('void','voided','Deleted') then
  raise exception 'Only managers can change voided invoices' using errcode='42501';
 end if;
 if tg_table_name='visits' and (to_jsonb(new)->>'visit_type'='Walk-In' or new.status='Voided') then
  raise exception 'Finance cannot manage walk-ins' using errcode='42501';
 end if;
 return new;
end $$;
do $$ declare tab text; begin
 foreach tab in array array['invoices','visits'] loop
  if to_regclass('public.'||tab) is not null then
   execute format('drop trigger if exists enforce_finance_changes on public.%I',tab);
   execute format('create trigger enforce_finance_changes before insert or update or delete on public.%I for each row execute function app_private.protect_finance_changes()',tab);
  end if;
 end loop;
end $$;
revoke all on function app_private.protect_finance_changes() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
