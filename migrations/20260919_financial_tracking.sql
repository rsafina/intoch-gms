begin;

insert into public.app_settings(key,value)
values ('financial_tracking','{"deposit_enabled":true,"spending_enabled":true}'::jsonb)
on conflict (key) do nothing;

alter table public.visits add column if not exists spend_recording_status text;
alter table public.visits drop constraint if exists visits_spend_recording_status_check;
alter table public.visits add constraint visits_spend_recording_status_check
 check (spend_recording_status in ('recorded','skipped'));
update public.visits set spend_recording_status='recorded'
where spend_amount is not null and spend_recording_status is null;

create or replace function app_private.financial_tracking_enabled(p_feature text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select (value->>(p_feature||'_enabled'))::boolean from public.app_settings where key='financial_tracking'),true);
$$;
revoke all on function app_private.financial_tracking_enabled(text) from public,anon,authenticated;

-- Preserve historical deposit state, but suppress newly-created requirements while disabled.
create or replace function app_private.guard_financial_tracking_deposit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not app_private.financial_tracking_enabled('deposit')
    and (tg_op='INSERT' or not coalesce(old.deposit_required,false))
    and coalesce(new.deposit_required,false) then
  new.deposit_required:=false;
  new.deposit_expected:=null;
  new.deposit_due_at:=null;
  if new.status='Incoming' then new.status:='Reserved'; end if;
 end if;
 return new;
end $$;
drop trigger if exists zz_guard_financial_tracking_deposit on public.reservations;
create trigger zz_guard_financial_tracking_deposit before insert or update on public.reservations
for each row execute function app_private.guard_financial_tracking_deposit();
revoke all on function app_private.guard_financial_tracking_deposit() from public,anon,authenticated;

create or replace function public.save_visit_spending(
 p_amount numeric,p_includes_deposit boolean,p_expected_deposit numeric,
 p_reservation_id uuid default null,p_visit_id uuid default null,
 p_complete boolean default true,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare booking public.reservations%rowtype; visit public.visits%rowtype;
 rid uuid:=p_reservation_id; applied numeric:=0; total numeric; actor uuid:=public.app_staff_id();
begin
 perform app_private.require_access('staff');
 if not app_private.financial_tracking_enabled('spending') then raise exception 'Spending Tracking is disabled'; end if;
 if p_amount is null or p_amount<0 or p_amount::text in ('NaN','Infinity','-Infinity')
  or p_includes_deposit is null or p_complete is null then raise exception 'Invalid spending amount'; end if;
 if p_visit_id is not null then
  select * into visit from public.visits where id=p_visit_id and voided_at is null;
  if not found then raise exception 'Visit no longer available'; end if;
  if rid is not null and rid is distinct from visit.reservation_id then raise exception 'Reservation mismatch'; end if;
  rid:=visit.reservation_id;
 end if;
 if rid is not null then
  select * into booking from public.reservations where id=rid and deleted_at is null for update;
  if not found or booking.status in ('Cancelled','Cancelled (No Show)','Deleted','No Show') then raise exception 'Reservation cannot be completed or edited'; end if;
  if (select count(*) from public.visits where reservation_id=rid and voided_at is null)>1 then raise exception 'Multiple visits require review'; end if;
  select * into visit from public.visits where reservation_id=rid and voided_at is null for update;
  if p_visit_id is not null and visit.id is distinct from p_visit_id then raise exception 'Visit changed. Reopen spending to review it.'; end if;
  applied:=coalesce(visit.spend_deposit_snapshot,app_private.net_reservation_deposit(rid),0);
 else
  if p_visit_id is null then raise exception 'Visit or reservation required'; end if;
  select * into visit from public.visits where id=p_visit_id and voided_at is null for update;
  if not found then raise exception 'Visit no longer available'; end if;
  if public.app_staff_role()='finance' then raise exception 'Finance cannot manage walk-ins' using errcode='42501'; end if;
 end if;
 if applied is distinct from p_expected_deposit then raise exception 'Deposit changed. Reopen spending to review it.'; end if;
 if visit.id is null and not p_complete then raise exception 'Visit not found'; end if;
 total:=p_amount+case when p_includes_deposit then 0 else applied end;
 if visit.id is null then
  insert into public.visits(guest_id,reservation_id,visit_type,visit_date,visit_time,pax,assigned_area,table_id,table_ids,
   spend_amount,spend_input_amount,spend_includes_deposit,spend_deposit_snapshot,spend_recording_status,billing_base_amount,extra_spend_amount,
   status,completed_at,notes,created_by)
  values(booking.guest_id,rid,'Reservation',booking.reservation_date,(now() at time zone 'Asia/Jakarta')::time,
   booking.pax,booking.assigned_area,booking.table_id,booking.table_ids,total,p_amount,p_includes_deposit,applied,'recorded',
   case when p_includes_deposit then 0 else applied end,p_amount,'Done',now(),p_notes,actor) returning * into visit;
 else
  update public.visits set spend_amount=total,spend_input_amount=p_amount,spend_includes_deposit=p_includes_deposit,
   spend_deposit_snapshot=applied,spend_recording_status='recorded',billing_base_amount=case when p_includes_deposit then 0 else applied end,
   extra_spend_amount=p_amount,status=case when p_complete then 'Done' else status end,
   completed_at=case when p_complete then coalesce(completed_at,now()) else completed_at end,
   notes=coalesce(p_notes,notes),spend_updated_at=now(),spend_updated_by=actor,updated_at=now()
  where id=visit.id returning * into visit;
 end if;
 if p_complete and rid is not null then update public.reservations set status='Completed',updated_at=now() where id=rid; end if;
 return jsonb_build_object('ok',true,'visit_id',visit.id,'guest_id',visit.guest_id,'spend_amount',total,'spend_recording_status','recorded');
end $$;

create or replace function public.finish_visit_without_spending(
 p_reservation_id uuid default null,p_visit_id uuid default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare booking public.reservations%rowtype; visit public.visits%rowtype; rid uuid:=p_reservation_id; actor uuid:=public.app_staff_id();
begin
 perform app_private.require_access('staff');
 if p_visit_id is not null then
  select * into visit from public.visits where id=p_visit_id and voided_at is null for update;
  if not found then raise exception 'Visit no longer available'; end if;
  if visit.spend_amount is not null then raise exception 'Recorded spending cannot be replaced by a skipped value'; end if;
  if public.app_staff_role()='finance' and visit.reservation_id is null then raise exception 'Finance cannot manage walk-ins' using errcode='42501'; end if;
  rid:=visit.reservation_id;
 end if;
 if rid is not null then
  select * into booking from public.reservations where id=rid and deleted_at is null for update;
  if not found or booking.status in ('Cancelled','Cancelled (No Show)','Deleted','No Show') then raise exception 'Reservation cannot be completed'; end if;
  if (select count(*) from public.visits where reservation_id=rid and voided_at is null)>1 then raise exception 'Multiple visits require review'; end if;
  select * into visit from public.visits where reservation_id=rid and voided_at is null for update;
 end if;
 if visit.id is null then
  insert into public.visits(guest_id,reservation_id,visit_type,visit_date,visit_time,pax,assigned_area,table_id,table_ids,
   spend_amount,spend_input_amount,spend_includes_deposit,spend_deposit_snapshot,spend_recording_status,status,completed_at,notes,created_by)
  values(booking.guest_id,rid,'Reservation',booking.reservation_date,(now() at time zone 'Asia/Jakarta')::time,
   booking.pax,booking.assigned_area,booking.table_id,booking.table_ids,null,null,null,null,'skipped','Done',now(),p_notes,actor)
  returning * into visit;
 else
  update public.visits set spend_amount=null,spend_input_amount=null,spend_includes_deposit=null,spend_deposit_snapshot=null,
   spend_recording_status='skipped',billing_base_amount=null,extra_spend_amount=null,status='Done',completed_at=coalesce(completed_at,now()),
   notes=coalesce(p_notes,notes),spend_updated_at=now(),spend_updated_by=actor,updated_at=now()
  where id=visit.id returning * into visit;
 end if;
 if rid is not null then update public.reservations set status='Completed',updated_at=now() where id=rid; end if;
 return jsonb_build_object('ok',true,'visit_id',visit.id,'guest_id',visit.guest_id,'spend_recording_status','skipped');
end $$;

revoke all on function public.finish_visit_without_spending(uuid,uuid,text) from public,anon;
grant execute on function public.finish_visit_without_spending(uuid,uuid,text) to authenticated;
revoke all on function public.save_visit_spending(numeric,boolean,numeric,uuid,uuid,boolean,text) from public,anon;
grant execute on function public.save_visit_spending(numeric,boolean,numeric,uuid,uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
