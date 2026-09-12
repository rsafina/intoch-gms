-- Optional per-staff deposit waiver permission. Admin manages staff_users;
-- existing RLS, account management and audit triggers remain in force.
begin;
do $$ begin
 if to_regprocedure('public.app_staff_role()') is null then
  raise exception 'Apply Phase 1 role enforcement first';
 end if;
end $$;
alter table public.staff_users add column if not exists can_waive_deposit boolean not null default false;
grant select(can_waive_deposit) on public.staff_users to authenticated;

create or replace function public.app_can_waive_deposit()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff_users
  where auth_user_id=auth.uid() and is_active
   and (role in ('admin','manager') or (role='staff' and can_waive_deposit)));
$$;
revoke all on function public.app_can_waive_deposit() from public,anon,authenticated;
grant execute on function public.app_can_waive_deposit() to authenticated;

-- Change only the staff deposit-removal check, keeping every other guard.
do $migration$
declare definition text; old_check text :=
 $old$if newrow->>'status'='Deleted' or (oldrow->>'deposit_required'='true' and newrow->>'deposit_required'='false') then perform app_private.require_access('manager'); end if;$old$;
 new_check text :=
 $new$if newrow->>'status'='Deleted' then perform app_private.require_access('manager'); end if;
  if oldrow->>'deposit_required'='true' and newrow->>'deposit_required'='false' and not public.app_can_waive_deposit() then
   raise exception 'This account cannot waive deposits' using errcode='42501';
  end if;$new$;
begin
 definition := pg_get_functiondef('app_private.protect_changes()'::regprocedure);
 if position(old_check in definition)>0 then
  execute replace(definition,old_check,new_check);
 elsif position(new_check in definition)=0 then
  raise exception 'Unexpected staff protection function; review before applying waiver permission';
 end if;
end $migration$;

-- Preserve the original waiver's reason, history, capacity and status logic.
create or replace function public.waive_deposit(
 p_reservation_id uuid,p_reason text,p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.app_can_waive_deposit() then
  raise exception 'This account cannot waive deposits' using errcode='42501';
 end if;
 return app_private.waive_deposit(p_reservation_id,p_reason,public.app_staff_id());
end $$;
revoke all on function public.waive_deposit(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.waive_deposit(uuid,text,uuid) to authenticated;
commit;
notify pgrst, 'reload schema';
