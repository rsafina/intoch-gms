-- Targeted follow-up to Phase 1. Do not rerun roles_enforce or ALL_IN_ONE.
begin;
alter table public.staff_users add column if not exists sessions_valid_after timestamptz;
alter table public.staff_users add column if not exists pin_reset_pending boolean not null default false;
alter table public.staff_users add column if not exists pin_reset_actor uuid;

-- Session creation time, NOT token iat: refreshing an old session must not
-- defeat PIN-reset invalidation. Auth owns auth.sessions; this is read-only.
create or replace function public.app_session_valid() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff_users u join auth.sessions s
  on s.user_id=u.auth_user_id and s.id::text=auth.jwt()->>'session_id'
  where u.auth_user_id=auth.uid() and u.is_active and not u.pin_reset_pending
    and (u.sessions_valid_after is null or s.created_at>u.sessions_valid_after));
$$;
revoke all on function public.app_session_valid() from public,anon;
grant execute on function public.app_session_valid() to authenticated;
create or replace function public.app_staff_role() returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select role from public.staff_users where auth_user_id=auth.uid() and is_active and public.app_session_valid();
$$;
create or replace function public.app_staff_id() returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
 select id from public.staff_users where auth_user_id=auth.uid() and is_active and public.app_session_valid();
$$;
create or replace function public.app_can_waive_deposit() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff_users where auth_user_id=auth.uid()
  and is_active and public.app_session_valid()
  and (role in ('admin','manager') or (role in ('staff','finance') and can_waive_deposit)));
$$;

create or replace function public.begin_staff_pin_reset(p_staff_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.app_staff_id();
begin
 perform app_private.require_access('admin');
 update public.staff_users set sessions_valid_after=clock_timestamp(),
  pin_reset_pending=true,pin_reset_actor=actor where id=p_staff_id and auth_user_id is not null and not pin_reset_pending;
 if not found then raise exception 'Account not found or PIN reset already in progress'; end if;
end $$;
-- Called only by the verified staff-account function's service client.
-- A failed password update also invalidates old sessions, but permits a new
-- login with the unchanged PIN. A failed finalization leaves the account locked.
create or replace function public.finish_staff_pin_reset(p_staff_id uuid,p_succeeded boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 select pin_reset_actor into actor from public.staff_users where id=p_staff_id and pin_reset_pending for update;
 if not found then raise exception 'No PIN reset in progress'; end if;
 insert into app_private.role_audit(actor_id,table_name,action,after_row)
 values(actor,'staff_users',case when p_succeeded then 'PIN_CHANGED' else 'PIN_RESET_FAILED' end,jsonb_build_object('id',p_staff_id));
 update public.staff_users set sessions_valid_after=clock_timestamp(),pin_reset_pending=false,pin_reset_actor=null where id=p_staff_id;
end $$;
revoke all on function public.begin_staff_pin_reset(uuid) from public,anon;
grant execute on function public.begin_staff_pin_reset(uuid) to authenticated;
revoke all on function public.finish_staff_pin_reset(uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_staff_pin_reset(uuid,boolean) to service_role;

create or replace function public.set_reservation_followup(
 p_reservation_id uuid,p_action text,p_done boolean default true,p_slot text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare booking public.reservations%rowtype; actor uuid:=public.app_staff_id(); stamp timestamptz:=now();
begin
 perform app_private.require_access('staff');
 if p_done is null or p_action not in ('followup','reminder') or p_action is null
  or (p_slot is not null and p_slot not in ('d1','dday')) then raise exception 'Invalid checklist action'; end if;
 select * into booking from public.reservations where id=p_reservation_id and deleted_at is null for update;
 if not found then raise exception 'Reservation no longer available'; end if;
 if booking.reservation_source is distinct from 'Online Form' then raise exception 'Not an online reservation'; end if;
 if booking.status in ('Cancelled','Cancelled (No Show)','Deleted') then raise exception 'Reservation is cancelled'; end if;
 if p_action='reminder' and (p_slot is null or not p_done) then raise exception 'Invalid reminder'; end if;
 update public.reservations set
  follow_up_done=case when p_action='followup' then p_done else follow_up_done end,
  follow_up_done_at=case when p_action='followup' then case when p_done then stamp end else follow_up_done_at end,
  follow_up_done_by=case when p_action='followup' then case when p_done then actor end else follow_up_done_by end,
  reminder_d1_ack_at=case when p_done and p_slot='d1' then stamp else reminder_d1_ack_at end,
  reminder_d1_ack_by=case when p_done and p_slot='d1' then actor else reminder_d1_ack_by end,
  reminder_dday_ack_at=case when p_done and p_slot='dday' then stamp else reminder_dday_ack_at end,
  reminder_dday_ack_by=case when p_done and p_slot='dday' then actor else reminder_dday_ack_by end
 where id=p_reservation_id;
 return jsonb_build_object('ok',true,'id',p_reservation_id);
end $$;
revoke all on function public.set_reservation_followup(uuid,text,boolean,text) from public,anon;
grant execute on function public.set_reservation_followup(uuid,text,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
