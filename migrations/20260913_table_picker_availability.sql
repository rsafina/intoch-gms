-- Table picker availability uses the same windows as the save-time guard.
begin;
create or replace function public.reservation_table_availability(
 p_date date, p_time time, p_end time, p_duration integer,
 p_buffer integer, p_exclusive boolean, p_exclude uuid)
returns table(table_id uuid, occupied boolean)
language plpgsql stable security definer set search_path = public as $function$
declare visit_window tsrange;
begin
 if p_date is null or p_time is null or p_duration is null or p_duration not between 15 and 1440
    or p_buffer is null or p_buffer < 0 or p_buffer > extract(epoch from p_time)::integer/60
    or (p_end is not null and p_end <= p_time) then
   raise exception 'Choose valid visit hours, duration and preparation buffer.';
 end if;
 visit_window := public.reservation_hold_window(p_date,p_time,p_end,p_duration,p_buffer);
 return query select t.id, exists (
   select 1 from public.reservations r
   where r.id is distinct from p_exclude and r.deleted_at is null
     and r.status in ('Reserved','Confirmed','Incoming','Arrived')
     and r.assigned_area=t.area_id
     and r.reservation_date between lower(visit_window)::date-1 and upper(visit_window)::date
     and (r.exclusive_area or p_exclusive or t.id=any(r.table_ids))
     and public.reservation_hold_window(r.reservation_date,r.reservation_time,r.end_time,
       r.booking_duration_minutes,r.block_buffer_minutes) && visit_window
 ) or exists (
   -- Preserve current walk-in occupancy when the proposed visit includes now.
   select 1 from public.visits v
   where visit_window @> (now() at time zone 'Asia/Jakarta')
     and v.visit_date=(now() at time zone 'Asia/Jakarta')::date
     and v.status='Active' and v.voided_at is null
     and (p_exclude is null or v.reservation_id is distinct from p_exclude)
     and (t.id=any(v.table_ids) or t.id=v.table_id)
 ) from public.tables t;
end;
$function$;
revoke all on function public.reservation_table_availability(date,time,time,integer,integer,boolean,uuid) from public;
grant execute on function public.reservation_table_availability(date,time,time,integer,integer,boolean,uuid) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
