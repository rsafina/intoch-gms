-- Reservation editing and payment status repair. Run ALL_IN_ONE.sql for a database
-- missing earlier upgrades; this incremental file expects timed capacity + deposit flow.
begin;
create or replace function public.record_deposit_payment(
  p_reservation_id uuid, p_amount numeric, p_paid_on date,
  p_method text default null, p_reference text default null,
  p_note text default null, p_staff_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
  declare
    v_res      record;
    v_paid     numeric;
    v_expected numeric;
  begin
    if p_amount is null or p_amount = 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity') then
      return jsonb_build_object('ok', false, 'code', 'invalid_amount',
        'message', 'A payment cannot be zero');
    end if;

    select id, status, deposit_expected into v_res
      from reservations where id = p_reservation_id and deleted_at is null for update;
    if v_res.id is null then
      return jsonb_build_object('ok', false, 'code', 'not_found',
        'message', 'That booking no longer exists');
    end if;

    insert into invoice_payments
      (reservation_id, amount, paid_on, method, reference, note, recorded_by)
    values
      (p_reservation_id, p_amount, coalesce(p_paid_on, current_date),
       p_method, p_reference, p_note, p_staff_id);

    select coalesce(sum(amount), 0) into v_paid
      from invoice_payments where reservation_id = p_reservation_id;
    v_expected := coalesce(v_res.deposit_expected, 0);

    -- Clearing the balance locks the booking, in this same transaction, so it
    -- cannot be a forgotten second click. A PARTIAL payment leaves it Incoming
    -- and does NOT move the deadline: otherwise a guest holds a table forever
    -- by sending Rp 1.000 a day.
    -- 'Waitlist' joins 'Incoming' here (2026-09-07). A large party agrees a
    -- figure with staff over WhatsApp and pays it; the money arriving is the
    -- same event in both flows, so it ends the same way. The difference is
    -- only how the booking got here: Incoming was auto-quoted at booking,
    -- Waitlist was negotiated. Nothing else about Waitlist changes — no
    -- deadline, no sweep, and staff can still cancel it by hand.
    if v_res.status in ('Incoming', 'Waitlist')
       and v_paid >= v_expected and v_expected > 0 then
      update reservations
         set status = 'Reserved', updated_at = now()
       where id = p_reservation_id;
      return jsonb_build_object('ok', true, 'status', 'Reserved',
        'paid', v_paid, 'outstanding', 0, 'locked', true);
    end if;

    return jsonb_build_object('ok', true, 'status', v_res.status,
      'paid', v_paid, 'outstanding', greatest(v_expected - v_paid, 0),
      'locked', false);
  end;
  $function$;

-- An Incoming deposit is due at the agreed visit time, including staff reschedules.
create or replace function public.sync_reservation_deposit_deadline()
returns trigger language plpgsql set search_path = public as $function$
begin
  if new.status = 'Incoming' and new.deposit_required and
     (new.reservation_date is distinct from old.reservation_date or new.reservation_time is distinct from old.reservation_time) then
    new.deposit_due_at := (new.reservation_date + new.reservation_time) at time zone 'Asia/Jakarta';
  end if;
  return new;
end;
$function$;
drop trigger if exists reservations_sync_deposit_deadline on public.reservations;
create trigger reservations_sync_deposit_deadline before update of reservation_date, reservation_time
on public.reservations for each row execute function public.sync_reservation_deposit_deadline();

-- Reconcile payments recorded by an older function that promoted only Incoming.
-- A capacity conflict leaves the request waiting for staff; it must not prevent
-- the schema upgrade or remove the payment that was already recorded.
do $repair$
declare booking record;
begin
  for booking in select r.id from public.reservations r
    where r.status = 'Waitlist' and r.deleted_at is null and r.deposit_required
      and r.deposit_expected > 0
      and (select coalesce(sum(p.amount), 0) from public.invoice_payments p
           where p.reservation_id = r.id) >= r.deposit_expected
    for update of r
  loop
    begin
      update public.reservations set status = 'Reserved', updated_at = now() where id = booking.id;
    exception when raise_exception or check_violation or exclusion_violation then
      raise warning 'Paid reservation % remains waitlisted: %', booking.id, SQLERRM;
    end;
  end loop;
end;
$repair$;
notify pgrst, 'reload schema';
commit;
