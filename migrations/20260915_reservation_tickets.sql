-- Guest confirmation tickets use an unguessable link and current booking details.
-- No payment, guest contact number, or staff notes are exposed by the public lookup.
begin;
alter table public.reservations add column if not exists ticket_token uuid;
alter table public.reservations add column if not exists ticket_issued_at timestamptz;
create unique index if not exists reservations_ticket_token_key on public.reservations(ticket_token);

create or replace function public.issue_reservation_ticket(p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare booking record;
begin
  update public.reservations set ticket_token=coalesce(ticket_token,gen_random_uuid()),
    ticket_issued_at=coalesce(ticket_issued_at,now())
    where id=p_reservation_id and status='Reserved' and deleted_at is null
    returning ticket_token,ticket_issued_at into booking;
  if not found then
    return jsonb_build_object('ok',false,'message','Only Reserved bookings can receive a ticket.');
  end if;
  return jsonb_build_object('ok',true,'token',booking.ticket_token,'issued_at',booking.ticket_issued_at);
end $$;

create or replace function public.reservation_ticket_by_token(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reference','RSV-'||upper(left(replace(r.ticket_token::text,'-',''),12)),
    'name',coalesce(nullif(r.booking_name,''),g.name,'Guest'),
    'date',r.reservation_date,'time',r.reservation_time,'end_time',r.end_time,
    'pax',r.pax,'area',a.name,'status',r.status,'issued_at',r.ticket_issued_at,
    'restaurant',public.get_setting('restaurant_name'),
    'address',public.get_setting('invoice_style')->>'address',
    'phone',public.get_setting('invoice_style')->>'phone'
  ) from public.reservations r
    left join public.guests g on g.id=r.guest_id
    left join public.areas a on a.id=r.assigned_area
    where r.ticket_token=p_token and r.deleted_at is null and r.status<>'Deleted';
$$;
revoke all on function public.issue_reservation_ticket(uuid) from public;
revoke all on function public.reservation_ticket_by_token(uuid) from public;
-- Matches the app's existing staff RPC access (staff sessions use the anon client).
grant execute on function public.issue_reservation_ticket(uuid) to anon,authenticated;
grant execute on function public.reservation_ticket_by_token(uuid) to anon,authenticated;
commit;
