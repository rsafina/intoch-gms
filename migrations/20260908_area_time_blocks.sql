-- WHOLE-AREA TIME BLOCKS (2026-09-08)
-- Apply this file once before deploying the updated staff/public forms.
-- Arrival slots use [start minus buffer, end); the end slot is available.
-- A buffer is explicit: we do not invent a duration for ordinary bookings.
begin;
alter table public.reservations add column if not exists exclusive_area boolean not null default false;
alter table public.reservations add column if not exists block_buffer_minutes integer not null default 0;
alter table public.reservations drop constraint if exists reservations_area_block_valid;
alter table public.reservations add constraint reservations_area_block_valid check (
  block_buffer_minutes >= 0 and block_buffer_minutes <= 1439 and
  (not exclusive_area or (assigned_area is not null and reservation_time is not null
    and end_time is not null and end_time > reservation_time
    and block_buffer_minutes <= extract(epoch from reservation_time)::integer / 60))
);

-- Only public time windows are exposed, never guest names or booking IDs.
create or replace function public.area_booking_blocks(p_date date)
returns table(area_id uuid, block_start time without time zone, block_end time without time zone)
language sql stable security definer set search_path = public as $function$
  select r.assigned_area,
         (r.reservation_time - make_interval(mins => r.block_buffer_minutes))::time,
         r.end_time
    from reservations r join areas a on a.id = r.assigned_area
   where r.reservation_date = p_date and r.exclusive_area
     and r.deleted_at is null and r.status in ('Reserved','Confirmed','Incoming','Arrived')
     and coalesce(a.is_bookable_online, false);
$function$;
grant execute on function public.area_booking_blocks(date) to anon, authenticated;

create or replace function public.guard_reservation_area_block()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  block_start time;
begin
  if new.deleted_at is not null or new.status not in ('Reserved','Confirmed','Incoming','Arrived') then
    return new;
  end if;
  if new.assigned_area is null then return new; end if;
  perform pg_advisory_xact_lock(82519, new.reservation_date - date '2000-01-01');
  block_start := (new.reservation_time - make_interval(mins => new.block_buffer_minutes))::time;
  if exists (
    select 1 from reservations r
     where r.id is distinct from new.id and r.assigned_area = new.assigned_area
       and r.reservation_date = new.reservation_date and r.deleted_at is null
       and r.status in ('Reserved','Confirmed','Incoming','Arrived')
       and (
         -- A new exclusive hold must not displace existing bookings.
         (new.exclusive_area and
           (case when r.exclusive_area then r.reservation_time - make_interval(mins => r.block_buffer_minutes)
                 else r.reservation_time end) < new.end_time and
           (case when r.end_time > r.reservation_time then r.end_time > block_start
                 else r.reservation_time >= block_start end))
         or
         -- Ordinary staff bookings and edits also respect existing holds.
         (r.exclusive_area and new.reservation_time < r.end_time and
           (case when new.end_time > new.reservation_time
                 then new.end_time > r.reservation_time - make_interval(mins => r.block_buffer_minutes)
                 else new.reservation_time >= r.reservation_time - make_interval(mins => r.block_buffer_minutes) end))
       )
  ) then
    raise exception 'This area has a conflicting reservation during the blocked hours. Move or cancel the conflicting booking first.';
  end if;
  return new;
end;
$function$;
drop trigger if exists reservations_z_guard_area_block on public.reservations;
-- Run after reservations_normalize_tables, which resolves the assigned area.
create trigger reservations_z_guard_area_block before insert or update of
  assigned_area, table_id, table_ids, reservation_date, reservation_time, end_time,
  exclusive_area, block_buffer_minutes, status, deleted_at
on public.reservations for each row execute function public.guard_reservation_area_block();

create or replace function public.area_availability(p_date date)
returns table (
  area_id      uuid,
  area_name    text,
  capacity     integer,
  reserved_pax integer,
  pct_full     integer,
  est_tables   integer
)
language sql
security definer
set search_path = public
as $function$
  with held as (
    select r.assigned_area as aid, sum(r.pax)::integer as pax
      from reservations r
     where r.reservation_date = p_date
       -- Incoming holds a seat (see DEPOSIT_FLOW_SPEC.md D2). Waitlist does not.
       and r.status in ('Reserved','Confirmed','Incoming','Arrived')
       and r.deleted_at is null
       and not r.exclusive_area
     group by r.assigned_area
  ),
  tbl as (
    select t.area_id as aid, count(*)::integer as n,
           avg(nullif(t.capacity, 0))::numeric as avg_seats
      from tables t
     where coalesce(t.is_active, true)
     group by t.area_id
  )
  select a.id, a.name, coalesce(a.capacity, 0),
         coalesce(h.pax, 0),
         case when coalesce(a.capacity, 0) > 0
              then least(100, round(coalesce(h.pax, 0) * 100.0 / a.capacity))::integer
              else 0 end,
         -- An ESTIMATE, and the guest-facing copy must say so. Online bookings
         -- never get a table assigned, so a literal count of free tables would
         -- keep reporting the same number while the area filled up.
         case when tbl.avg_seats is null or tbl.avg_seats <= 0 then null
              else greatest(0, floor((coalesce(a.capacity,0) - coalesce(h.pax,0)) / tbl.avg_seats))::integer
         end
    from areas a
    left join held h on h.aid = a.id
    left join tbl on tbl.aid = a.id
   -- NOTE: `areas` has no is_active column. `tables` does; `areas` does not.
   -- Bookability is the only gate here.
   where coalesce(a.is_bookable_online, false) = true
   order by a.name;
$function$;

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

    -- Serialize with staff area holds before checking or creating guest data.
    perform pg_advisory_xact_lock(82519, p_date - date '2000-01-01');
    if exists (select 1 from public.area_booking_blocks(p_date) b
                where (p_area_id is null or b.area_id = p_area_id)
                  and p_time >= b.block_start and p_time < b.block_end) then
      return jsonb_build_object('ok', false, 'code', 'time_full',
        'message', 'That area is full at this time. Please choose another time or area.');
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

      -- ===== Is the DATE already full for this area? =====
      -- This one still REFUSES. A full night is a no whatever the party size,
      -- and telling a guest they are on a waitlist for a night that cannot take
      -- them is worse than a clean refusal. Checked BEFORE the party rules for
      -- exactly that reason.
      --
      -- Waitlist rows are excluded on purpose: they hold no seat.
      if coalesce(v_area.capacity, 0) > 0 then
        select coalesce(sum(r.pax), 0) into v_taken
          from reservations r
         where r.assigned_area = v_area.id
           and r.reservation_date = p_date
           -- Incoming holds a seat: the table is held while the guest pays.
           -- Waitlist deliberately does not.
           and r.status in ('Reserved','Confirmed','Incoming','Arrived')
           and r.deleted_at is null
           and not r.exclusive_area;
        if v_taken >= v_area.capacity then
          return jsonb_build_object('ok', false, 'code', 'date_full',
            'message', format('%s is fully booked on that date', v_area.name),
            'area_name', v_area.name);
        end if;
      end if;

      -- ===== Party rules: these WAITLIST, they do not refuse =====
      -- Decided 2026-09-05. A party of 25 asking for a 20-seat room is a
      -- booking worth having, not an error.
      if v_area.min_pax is not null and p_pax < v_area.min_pax then
        v_status := 'Waitlist'; v_wl_why := 'below_min_pax';
      elsif coalesce(v_area.capacity, 0) > 0 and p_pax > v_area.capacity then
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
      deposit_due_at)
    values
      (v_guest_id, p_date, p_time, p_pax, v_status,
      'Online Form', v_notes, v_name, p_area_id,
      (v_dep_req and v_status <> 'Waitlist'), v_dep_amt, v_dep_note, v_wl_why,
      v_due_at)
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
