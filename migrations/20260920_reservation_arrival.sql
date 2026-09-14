-- After Phase 1 and its role save-path fixes. Does not replace spending/deposit RPCs.
-- Resolve existing duplicate non-voided visits before applying this migration.
begin;
lock table public.visits in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.visits where reservation_id is not null and voided_at is null
  group by reservation_id having count(*)>1) then
  raise exception 'Duplicate reservation visits need review before installing the arrival guard';
 end if;
end $$;
create unique index if not exists visits_one_live_reservation
 on public.visits(reservation_id) where reservation_id is not null and voided_at is null;

create or replace function public.record_reservation_arrival(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare booking public.reservations%rowtype; visit public.visits%rowtype;
begin
 perform app_private.require_access('staff');
 -- Completion also locks the reservation. Serialize status and visit creation together.
 select * into booking from public.reservations where id=p_reservation_id and deleted_at is null for update;
 if not found then raise exception 'Reservation no longer available'; end if;
 if booking.status not in ('Reserved','Confirmed','Incoming','Waitlist','Arrived') then
  raise exception 'This reservation cannot be marked Arrived';
 end if;
 select * into visit from public.visits where reservation_id=booking.id and voided_at is null for update;
 if visit.id is not null and visit.status is distinct from 'Active' then
  raise exception 'This visit is already completed; review it before changing arrival';
 end if;
 update public.reservations set status='Arrived',updated_at=now() where id=booking.id;
 if visit.id is null then
  insert into public.visits(guest_id,reservation_id,visit_type,visit_date,visit_time,pax,
   assigned_area,table_id,table_ids,status,created_by)
  values(booking.guest_id,booking.id,'Reservation',booking.reservation_date,
   (now() at time zone 'Asia/Jakarta')::time,booking.pax,booking.assigned_area,
   booking.table_id,booking.table_ids,'Active',public.app_staff_id()) returning * into visit;
 end if;
 return jsonb_build_object('ok',true,'visit_id',visit.id,'guest_id',visit.guest_id);
end $$;
revoke all on function public.record_reservation_arrival(uuid) from public,anon;
grant execute on function public.record_reservation_arrival(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
