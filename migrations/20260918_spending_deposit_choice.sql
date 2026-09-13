begin;
alter table public.visits add column if not exists spend_input_amount numeric;
alter table public.visits add column if not exists spend_includes_deposit boolean;
alter table public.visits add column if not exists spend_deposit_snapshot numeric;

create or replace function app_private.net_reservation_deposit(p_id uuid) returns numeric
language sql stable security definer set search_path=public,pg_temp as $$
 select case when r.deposit_required then greatest(0,coalesce((
  select sum(p.amount) from public.invoice_payments p left join public.invoices i on i.id=p.invoice_id
  where p.reservation_id=r.id or (i.reservation_id=r.id and i.kind='deposit')
 ),0)) else 0 end from public.reservations r where r.id=p_id;
$$;
revoke all on function app_private.net_reservation_deposit(uuid) from public,anon,authenticated;

create or replace function public.reservation_spending_context(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare amount numeric;
begin
 perform app_private.require_access('read');
 select app_private.net_reservation_deposit(id) into amount from public.reservations
  where id=p_reservation_id and deleted_at is null;
 if not found then raise exception 'Reservation not found'; end if;
 return jsonb_build_object('deposit',coalesce(amount,0));
end $$;

-- One save path for new completion and explicit edits. Historical rows are
-- untouched until edited. Deposit snapshots survive reopening and later refunds.
create or replace function public.save_visit_spending(
 p_amount numeric,p_includes_deposit boolean,p_expected_deposit numeric,
 p_reservation_id uuid default null,p_visit_id uuid default null,
 p_complete boolean default true,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare booking public.reservations%rowtype; visit public.visits%rowtype;
 rid uuid:=p_reservation_id; applied numeric:=0; total numeric; actor uuid:=public.app_staff_id();
begin
 perform app_private.require_access('staff');
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
   spend_amount,spend_input_amount,spend_includes_deposit,spend_deposit_snapshot,billing_base_amount,extra_spend_amount,
   status,completed_at,notes,created_by)
  values(booking.guest_id,rid,'Reservation',booking.reservation_date,(now() at time zone 'Asia/Jakarta')::time,
   booking.pax,booking.assigned_area,booking.table_id,booking.table_ids,total,p_amount,p_includes_deposit,applied,
   case when p_includes_deposit then 0 else applied end,p_amount,'Done',now(),p_notes,actor) returning * into visit;
 else
  update public.visits set spend_amount=total,spend_input_amount=p_amount,spend_includes_deposit=p_includes_deposit,
   spend_deposit_snapshot=applied,billing_base_amount=case when p_includes_deposit then 0 else applied end,extra_spend_amount=p_amount,
   status=case when p_complete then 'Done' else status end,
   completed_at=case when p_complete then coalesce(completed_at,now()) else completed_at end,
   notes=coalesce(p_notes,notes),spend_updated_at=now(),spend_updated_by=actor,updated_at=now()
  where id=visit.id returning * into visit;
 end if;
 if p_complete and rid is not null then update public.reservations set status='Completed',updated_at=now() where id=rid; end if;
 return jsonb_build_object('ok',true,'visit_id',visit.id,'guest_id',visit.guest_id,'spend_amount',total);
end $$;
revoke all on function public.reservation_spending_context(uuid) from public,anon;
grant execute on function public.reservation_spending_context(uuid) to authenticated;
revoke all on function public.save_visit_spending(numeric,boolean,numeric,uuid,uuid,boolean,text) from public,anon;
grant execute on function public.save_visit_spending(numeric,boolean,numeric,uuid,uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
