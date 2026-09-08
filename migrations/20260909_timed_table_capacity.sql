-- TIMED TABLE CAPACITY (2026-09-09)
-- Standalone upgrade: includes the area-hold columns if not yet applied.
-- Existing reservations retain the legacy 180-minute default. New bookings
-- snapshot the configured duration, so later settings edits do not move holds.
begin;
alter table public.reservations add column if not exists exclusive_area boolean not null default false;
alter table public.reservations add column if not exists block_buffer_minutes integer not null default 0;
alter table public.reservations add column if not exists booking_duration_minutes integer not null default 180;

create or replace function public.default_reservation_duration()
returns integer language sql stable security definer set search_path = public as $function$
  select greatest(15, least(1440, coalesce((get_setting('reservation_hours')->>'default_duration_minutes')::integer, 180)));
$function$;
alter table public.reservations alter column booking_duration_minutes set default public.default_reservation_duration();
alter table public.reservations drop constraint if exists reservations_area_block_valid;
alter table public.reservations add constraint reservations_area_block_valid check (
  booking_duration_minutes between 15 and 1440 and
  block_buffer_minutes >= 0 and block_buffer_minutes <= extract(epoch from reservation_time)::integer / 60 and
  (not exclusive_area or (assigned_area is not null and end_time is not null and end_time > reservation_time))
);

create index if not exists reservations_held_area_date_idx
  on public.reservations(assigned_area, reservation_date)
  where deleted_at is null and status in ('Reserved','Confirmed','Incoming','Arrived');

create or replace function public.reservation_hold_window(
  p_date date, p_time time, p_end time, p_duration integer, p_buffer integer)
returns tsrange language sql immutable as $function$
  select tsrange(p_date + p_time - make_interval(mins => coalesce(p_buffer, 0)),
    case when p_end > p_time then p_date + p_end
         else p_date + p_time + make_interval(mins => coalesce(p_duration, 180)) end, '[)');
$function$;

-- Private aggregate calculator. Tables must remain free throughout a visit;
-- unassigned pax and any pax beyond assigned seats consume capacity at their
-- peak concurrent count, not a whole-day sum. No guest records are returned.
create or replace function public.reservation_capacity(
  p_area_id uuid, p_start timestamp, p_end timestamp, p_exclude uuid default null)
returns table(total_capacity integer, available_capacity integer, exclusive_block boolean, held_count integer)
language sql stable security definer set search_path = public as $function$
  with active_tables as (
    select id, greatest(coalesce(capacity, 0), 0) as seats from tables
     where area_id = p_area_id and coalesce(is_active, true)
  ), totals as (
    select count(*) as n, count(*) filter (where seats = 0) as unknown_n,
           coalesce(sum(seats), 0)::integer as seats from active_tables
  ), area_total as (
    select case when coalesce(a.capacity, 0) > 0 then
             case when t.n > 0 and t.unknown_n = 0 then least(a.capacity, t.seats) else a.capacity end
           else nullif(t.seats, 0) end as seats, t.n as table_count
      from areas a cross join totals t where a.id = p_area_id
  ), held as (
    select r.*, public.reservation_hold_window(r.reservation_date, r.reservation_time,
             r.end_time, r.booking_duration_minutes, r.block_buffer_minutes) as win,
           greatest(r.pax - coalesce((select sum(t.seats) from active_tables t
               where t.id = any(r.table_ids)), 0), 0)::integer as extra_pax
      from reservations r
     where r.assigned_area = p_area_id and r.id is distinct from p_exclude
       and r.deleted_at is null and r.status in ('Reserved','Confirmed','Incoming','Arrived')
       and r.reservation_date between p_start::date - 1 and p_end::date
       and public.reservation_hold_window(r.reservation_date, r.reservation_time,
             r.end_time, r.booking_duration_minutes, r.block_buffer_minutes) && tsrange(p_start, p_end, '[)')
  ), held_tables as (
    select t.* from active_tables t where exists (select 1 from held h where t.id = any(h.table_ids))
  ), points as (
    select p_start as at union select lower(win) from held where lower(win) >= p_start
  ), peak as (
    select coalesce(max((select coalesce(sum(h.extra_pax), 0) from held h where h.win @> p.at)), 0)::integer as pax
      from points p
  ), summary as (
    select coalesce(bool_or(exclusive_area), false) as exclusive, count(*)::integer as n from held
  )
  select a.seats,
         case when s.exclusive then 0
              when a.table_count > 0 and (select count(*) from held_tables) = a.table_count then 0
              when a.seats is null then null
              else greatest(0, a.seats - (select coalesce(sum(seats),0)::integer from held_tables) - peak.pax) end,
         s.exclusive, s.n
    from area_total a cross join peak cross join summary s;
$function$;
revoke all on function public.reservation_capacity(uuid,timestamp,timestamp,uuid) from public, anon, authenticated;

-- Public slots expose capacity only. All hours are returned so opening-hours
-- overrides remain the form's existing responsibility; submission checks both.
create or replace function public.area_slot_availability(p_date date)
returns table(area_id uuid, slot_time time, total_capacity integer, available_pax integer, exclusive_block boolean, duration_minutes integer)
language sql stable security definer set search_path = public as $function$
  select a.id, make_time(h, 0, 0), c.total_capacity, c.available_capacity,
         c.exclusive_block, d.minutes
    from areas a cross join generate_series(0,23) h
    cross join (select public.default_reservation_duration() as minutes) d
    cross join lateral public.reservation_capacity(a.id, p_date + make_time(h,0,0),
       p_date + make_time(h,0,0) + make_interval(mins => d.minutes)) c
   where coalesce(a.is_bookable_online, false);
$function$;
grant execute on function public.area_slot_availability(date) to anon, authenticated;

create or replace function public.guard_reservation_area_block()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  new_window tsrange;
  capacity_row record;
  needed integer;
begin
  if new.deleted_at is not null or new.status not in ('Reserved','Confirmed','Incoming','Arrived') then return new; end if;
  if new.assigned_area is null then return new; end if;
  perform pg_advisory_xact_lock(82519, 0);
  new_window := public.reservation_hold_window(new.reservation_date, new.reservation_time,
       new.end_time, new.booking_duration_minutes, new.block_buffer_minutes);
  if exists (select 1 from reservations r
       where r.id is distinct from new.id and r.assigned_area = new.assigned_area
         and r.deleted_at is null and r.status in ('Reserved','Confirmed','Incoming','Arrived')
         and r.reservation_date between lower(new_window)::date - 1 and upper(new_window)::date
         and (new.exclusive_area or r.exclusive_area or r.table_ids && new.table_ids)
         and public.reservation_hold_window(r.reservation_date, r.reservation_time,
             r.end_time, r.booking_duration_minutes, r.block_buffer_minutes) && new_window) then
    raise exception 'The selected tables or area are already reserved during this visit. Choose different tables or hours.';
  end if;
  select * into capacity_row from public.reservation_capacity(new.assigned_area,
      lower(new_window), upper(new_window), new.id);
  select greatest(new.pax, coalesce(sum(greatest(coalesce(t.capacity,0),0)),0))::integer into needed
    from tables t where t.id = any(new.table_ids) and coalesce(t.is_active,true);
  if capacity_row.available_capacity is not null and
     least(needed, capacity_row.total_capacity) > capacity_row.available_capacity then
    raise exception 'Not enough remaining capacity during this visit, including bookings awaiting table assignment.';
  end if;
  return new;
end;
$function$;
drop trigger if exists reservations_z_guard_area_block on public.reservations;
create trigger reservations_z_guard_area_block before insert or update of
  assigned_area, table_id, table_ids, pax, reservation_date, reservation_time, end_time,
  booking_duration_minutes, exclusive_area, block_buffer_minutes, status, deleted_at
on public.reservations for each row execute function public.guard_reservation_area_block();

create or replace function public.create_public_reservation(
  p_name text, p_phone text, p_pax integer, p_date date,
  p_time time without time zone, p_notes text default null,
  p_area_id uuid default null, p_company text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
  declare
    v_name     text := trim(coalesce(p_name, ''));
    v_phone    text;
    v_notes    text := nullif(left(trim(coalesce(p_notes, '')), 500), '');
    v_company  text := nullif(left(trim(coalesce(p_company, '')), 120), '');
    v_cfg      jsonb := coalesce(get_setting('reservation_hours'), '{}'::jsonb);
    v_lead     integer := greatest(coalesce((v_cfg->>'min_lead_days')::integer, 0), 0);
    -- Both ceilings used to be hardcoded here (20 and 90). They default to
    -- exactly those numbers so this migration changes no behaviour on its
    -- own; the restaurant raises them in Settings when it wants to.
    v_max_pax  integer := greatest(coalesce((v_cfg->>'max_pax')::integer, 20), 1);
    v_max_days integer := greatest(coalesce((v_cfg->>'max_days_ahead')::integer, 90), 0);
    v_area     record;
    v_avail    record;
    v_duration integer := public.default_reservation_duration();
    v_status   text := 'Reserved';
    v_wl_why   text;
    v_seats    integer;
    v_taken    integer;
    v_due_at   timestamptz;
    v_dep_req  boolean := false;
    v_dep_amt  numeric;
    v_dep_note text;
    v_hours    jsonb;
    v_open     time;
    v_close    time;
    v_now_jkt  timestamp := (now() at time zone 'Asia/Jakarta');
    v_guest_id uuid;
    v_res_id   uuid;
    v_dup      integer;
    v_existing_name text;
    v_alias    text;
  begin
    -- phone normalization (mirrors normalizePhone in app.js)
    v_phone := regexp_replace(coalesce(p_phone, ''), '[\s\-\(\)\.]', '', 'g');
    if v_phone like '+62%' then
      v_phone := '0' || substr(v_phone, 4);
    elsif v_phone like '62%' and length(v_phone) >= 10 then
      v_phone := '0' || substr(v_phone, 3);
    end if;

    -- ===== Availability, before anything else =====
    -- Checked first so a paused restaurant does not create a guest record for
    -- a booking it is about to refuse.
    if coalesce((v_cfg->>'online_paused')::boolean, false) then
      return jsonb_build_object('ok', false, 'code', 'paused',
        'message', coalesce(nullif(v_cfg->>'pause_message', ''),
                            'Kami sedang tidak menerima reservasi online.'));
    end if;

    if length(v_name) < 2 or length(v_name) > 80 then
      return jsonb_build_object('ok', false, 'code', 'invalid_name',
        'message', 'Name must be 2-80 characters');
    end if;
    if v_phone !~ '^\+?[0-9]{9,15}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_phone',
        'message', 'Phone must be 9-15 digits');
    end if;
    -- Bad input still refuses. A large party does NOT: since 2026-09-05
    -- `max_pax` is the size above which a human decides, not a wall. That
    -- decision happens further down, after the area is known.
    if p_pax is null or p_pax < 1 then
      return jsonb_build_object('ok', false, 'code', 'invalid_pax',
        'message', 'Pax must be 1 or more');
    end if;

    -- The ONE hard size refusal, and it is arithmetic rather than judgement: a
    -- party larger than every area combined cannot be seated by any decision a
    -- human could make, so a waitlist entry would promise a review that can only
    -- end one way. It also stops the public form creating a booking for 99,999
    -- people. Skipped entirely when no capacity is recorded anywhere.
    select coalesce(sum(capacity), 0) into v_seats from areas;
    if v_seats > 0 and p_pax > v_seats then
      return jsonb_build_object('ok', false, 'code', 'pax_impossible',
        'message', format('We can seat at most %s people in total', v_seats),
        'total_seats', v_seats);
    end if;
    if p_date is null or p_time is null then
      return jsonb_build_object('ok', false, 'code', 'missing_datetime',
        'message', 'Date and time are required');
    end if;
    if p_date < v_now_jkt::date then
      return jsonb_build_object('ok', false, 'code', 'past_date',
        'message', 'Date is in the past');
    end if;

    -- Minimum lead time. 0 is the default and means same-day is fine, which
    -- is the behaviour every existing client has. Reported as its own code so
    -- the form can say how many days rather than "in the past".
    if v_lead > 0 and p_date < (v_now_jkt::date + v_lead) then
      return jsonb_build_object('ok', false, 'code', 'lead_time',
        'message', format('Bookings must be made at least %s day(s) ahead', v_lead),
        'min_lead_days', v_lead,
        'earliest_date', (v_now_jkt::date + v_lead));
    end if;

    if p_date > v_now_jkt::date + v_max_days then
      return jsonb_build_object('ok', false, 'code', 'too_far',
        'message', format('Bookings open up to %s days ahead', v_max_days),
        'max_days_ahead', v_max_days);
    end if;

    -- One resolver, not a second copy of the rule.
    v_hours := reservation_hours_for(p_date);

    -- A closed day deliberately returns code `outside_hours`, NOT a new code.
    -- The guest page maps an unrecognised code to "connection problem, try
    -- again", which would have a guest retrying forever against a day that
    -- will never open. The detail rides in closed_all_day and reason, which
    -- an older page simply ignores.
    if coalesce((v_hours->>'closed')::boolean, false) then
      return jsonb_build_object('ok', false, 'code', 'outside_hours',
        'message', coalesce(nullif(v_hours->>'reason', ''), 'Closed on this date'),
        'closed_all_day', true,
        'reason', v_hours->>'reason',
        'source', v_hours->>'source');
    end if;

    v_open  := (v_hours->>'open')::time;
    v_close := (v_hours->>'close')::time;
    if p_time < v_open or p_time > v_close then
      return jsonb_build_object('ok', false, 'code', 'outside_hours',
        'message', 'Outside opening hours',
        'closed_all_day', false,
        'open', to_char(v_open, 'HH24:MI'), 'close', to_char(v_close, 'HH24:MI'));
    end if;

    if p_date = v_now_jkt::date
      and p_time < (v_now_jkt + interval '30 minutes')::time then
      return jsonb_build_object('ok', false, 'code', 'too_soon',
        'message', 'Same-day bookings need 30 minutes notice');
    end if;

    -- One lock for every writer: arrivals may extend into the next date.
    perform pg_advisory_xact_lock(82519, 0);
    if p_area_id is null and exists (select 1 from areas where is_bookable_online) then
      return jsonb_build_object('ok', false, 'code', 'area_unavailable');
    end if;

    -- ===== Area, and the deposit it implies =====
    -- Placed after the availability and time checks and before the guest
    -- record, for the same reason `paused` is checked first: a booking this
    -- function is about to refuse must not leave a guest row behind.
    --
    -- A null p_area_id is always allowed. That is not laxity: it is what an
    -- older deployed reserve.html sends, and what every booking sends when
    -- the restaurant has no area marked bookable online. Refusing it would
    -- take the form offline the moment this file is applied.
    if p_area_id is not null then
      select a.id, a.name, a.capacity, a.min_pax, a.min_spend,
             a.deposit_amount, a.is_bookable_online
        into v_area
        from areas a
       where a.id = p_area_id;

      if v_area.id is null
         or coalesce(v_area.is_bookable_online, false) = false then
        return jsonb_build_object('ok', false, 'code', 'area_unavailable',
          'message', 'That area cannot be booked online');
      end if;

      select * into v_avail from public.reservation_capacity(
        p_area_id, p_date + p_time,
        p_date + p_time + make_interval(mins => v_duration));
      -- Oversized requests still go to staff when the room is empty; they
      -- cannot claim capacity already promised to another booking.
      if v_avail.exclusive_block or v_avail.available_capacity <= 0 or
         (v_avail.available_capacity is not null and
          least(p_pax, v_avail.total_capacity) > v_avail.available_capacity) then
        return jsonb_build_object('ok', false, 'code', 'time_full',
          'message', 'Not enough room for this party during the selected visit.',
          'available_pax', v_avail.available_capacity);
      end if;

      -- ===== Party rules: these WAITLIST, they do not refuse =====
      -- Decided 2026-09-05. A party of 25 asking for a 20-seat room is a
      -- booking worth having, not an error.
      if v_area.min_pax is not null and p_pax < v_area.min_pax then
        v_status := 'Waitlist'; v_wl_why := 'below_min_pax';
      elsif coalesce(v_avail.total_capacity, v_area.capacity, 0) > 0
        and p_pax > coalesce(v_avail.total_capacity, v_area.capacity) then
        -- capacity 0 means "not recorded", not "seats nobody".
        v_status := 'Waitlist'; v_wl_why := 'over_capacity';
      end if;

      -- SNAPSHOT, not a live rule. Editing the minimum spend in Settings
      -- next month must not silently rewrite what this guest was told they
      -- owed. Same reasoning as copying guest details onto an invoice.
      -- A flat rupiah figure since 2026-09-05, not a percentage of min_spend.
      -- It no longer depends on min_spend at all, so an area may ask for a
      -- deposit with no minimum spend set.
      --
      -- `> 0` is deliberate. A stored 0 would mark the booking as owing money
      -- and put "DP Rp 0" in front of the guest, which is worse than silent.
      if v_area.deposit_amount is not null and v_area.deposit_amount > 0 then
        v_dep_req  := true;
        v_dep_amt  := round(v_area.deposit_amount);
        v_dep_note := format('Area rule: Rp %s deposit for %s',
                             round(v_area.deposit_amount), v_area.name);
      end if;
    end if;

    -- guest match: EXACT phone match reuses guest, never renames
    select id, name into v_guest_id, v_existing_name
      from guests where phone = v_phone limit 1;
    if v_guest_id is null then
      -- phone is UNIQUE: on_conflict guards against two simultaneous submits
      insert into guests (name, phone)
      values (v_name, v_phone)
      on conflict (phone) do nothing
      returning id into v_guest_id;
      if v_guest_id is null then
        select id, name into v_guest_id, v_existing_name
          from guests where phone = v_phone limit 1;
      else
        v_existing_name := v_name;  -- brand new guest: canonical == typed
      end if;
    end if;

    -- Company is filled only when the guest has none. A returning guest who
    -- leaves the field blank, or types their personal booking, must not wipe
    -- the company already on their record. Same principle as the name rule
    -- directly above: a public form may add, never overwrite.
    if v_company is not null then
      update guests
         set company    = v_company,
             updated_at = now()
       where id = v_guest_id
         and (company is null or btrim(company) = '');
    end if;

    -- duplicate guard: one open booking per phone per day
    select count(*) into v_dup
    from reservations
    where guest_id = v_guest_id
      and reservation_date = p_date
      and status in ('Reserved', 'Confirmed');
    if v_dup > 0 then
      return jsonb_build_object('ok', false, 'code', 'duplicate',
        'message', 'A reservation for this phone already exists on that date');
    end if;

    -- ===== ALIAS 1/2: derive alias from the typed name =====
    -- Case- and whitespace-insensitive compare, so "  rere " booking
    -- against guest "Rere" produces NO alias (not a real difference).
    if lower(regexp_replace(v_name, '\s+', ' ', 'g'))
      = lower(regexp_replace(coalesce(v_existing_name, ''), '\s+', ' ', 'g'))
    then
      v_alias := null;
    else
      v_alias := v_name;
    end if;

    -- The global ceiling, applied whether or not an area was chosen, and only if
    -- an area rule has not already claimed the booking. Checked last so the more
    -- specific reason wins: "too big for the VIP room" tells staff more than
    -- "over the house limit".
    if v_status = 'Reserved' and p_pax > v_max_pax then
      v_status := 'Waitlist'; v_wl_why := 'over_max_pax';
    end if;

    -- ===== Incoming: a deposit booking is not secure until money arrives =====
    -- WAITLIST WINS OVER INCOMING. A booking nobody has agreed to yet must not
    -- start a deposit clock, or a guest is auto-cancelled for failing to pay for
    -- a table they were never offered. The clock starts when staff accept it.
    if v_status = 'Reserved' and v_dep_req then
      v_status := 'Incoming';
      -- The deadline IS the booking. No grace period, by decision: it needed a
      -- setting, a min(), and a special case for imminent bookings, all to say
      -- something less obvious than "pay before you eat".
      v_due_at := (p_date + p_time) at time zone 'Asia/Jakarta';
    end if;

    -- A waitlisted booking KEEPS the deposit figure so staff can see what would
    -- be owed if they accept it, but `deposit_required` stays FALSE until it is
    -- accepted. The guest was told no payment is due; a row saying otherwise
    -- would put them on a chase-for-money worklist for a booking nobody has
    -- agreed to yet, which is the exact surprise this design exists to avoid.
    -- Accepting the booking is what makes the deposit real.

    insert into reservations
      (guest_id, reservation_date, reservation_time, pax, status,
      reservation_source, notes, booking_name, assigned_area,
      deposit_required, deposit_expected, deposit_rule_note, waitlist_reason,
      deposit_due_at, booking_duration_minutes)
    values
      (v_guest_id, p_date, p_time, p_pax, v_status,
      'Online Form', v_notes, v_name, p_area_id,
      (v_dep_req and v_status <> 'Waitlist'), v_dep_amt, v_dep_note, v_wl_why,
      v_due_at, v_duration)
    returning id into v_res_id;

    -- ===== ALIAS 2/2: refresh the denormalised latest alias =====
    -- Unconditional assignment (including back to NULL) is intentional:
    -- the alias must follow the most recent booking, not accumulate.
    update guests
      set booking_alias = v_alias,
          updated_at    = now()
    where id = v_guest_id
      and booking_alias is distinct from v_alias;

    -- `waitlisted` is a boolean beside the status so the guest page can branch
    -- without knowing the status vocabulary. A waitlisted booking must NOT be
    -- told it is confirmed, and must not be shown a deposit to pay.
    return jsonb_build_object('ok', true, 'reservation_id', v_res_id,
      'status', v_status,
      'waitlisted', (v_status = 'Waitlist'),
      'awaiting_deposit', (v_status = 'Incoming'),
      'deposit_due_at', v_due_at,
      'waitlist_reason', v_wl_why,
      'deposit_required', (v_dep_req and v_status <> 'Waitlist'),
      'deposit_expected', v_dep_amt);
  end;
  $function$;

notify pgrst, 'reload schema';
commit;
