
-- ## 20260902_reservation_availability.sql
-- ============================================================
-- RESERVATION AVAILABILITY: weekly hours, dated closures, a minimum
-- booking lead time, and a switch to stop taking bookings entirely.
-- Ported from and extending the Blue Heron weekly-hours work of 2026-08-23.
--
-- Before this, the only gates on an online booking were one global open/close
-- pair, a hardcoded 30-minute same-day notice and a hardcoded 90-day cap.
-- There was no way to say "closed on 17 August", "closed Mondays", or "stop
-- taking bookings" — the form kept accepting reservations for a day the
-- restaurant was shut.
--
-- Idempotent, like the rest of this file. Safe to run twice.
--
-- ── Four independent controls ─────────────────────────────────────────
--
--   online_paused   one switch, stops the public form dead. For the closure
--                   nobody planned. Staff can still book in the app.
--   min_lead_days   0 means same-day booking is allowed, which is today's
--                   behaviour and stays the default. 1 means "not today",
--                   2 means "not today or tomorrow".
--   weekly          per-weekday open/close, with a closed flag. For "we are
--                   always shut on Mondays".
--   exceptions      per-DATE closure or different hours. For Idul Fitri and
--                   private buyouts. This is the one that beats everything.
--
-- ── Precedence, most specific wins ────────────────────────────────────
--
--   1. paused              stops everything on the online form
--   2. date in the past
--   3. inside min_lead_days
--   4. beyond the 90-day cap
--   5. a dated EXCEPTION for that date   <- beats the weekly grid, so
--                                           "closed Mondays, but open this
--                                           Monday" is expressible
--   6. the WEEKLY entry for that weekday
--   7. the flat open/close pair          <- only if no weekly entry exists
--   8. the 30-minute same-day notice
--
-- Rule 5 beating rule 6 is the point of exceptions. An exception row with
-- closed_all_day = false and hours set REOPENS a normally closed day.
--
-- ── Two rules inherited from Blue Heron, do not undo them ─────────────
--
-- 1. THE FLAT open/close PAIR MUST STAY, and is derived on save as the
--    WIDEST window across the open days. js/notify.js reads it to decide
--    when the D-1 reminder starts, and a guest page built before this
--    change reads it to build the time dropdown. Neither knows about
--    `weekly`. Widest-window means the dropdown is a superset, so no
--    genuinely bookable slot is ever hidden from a guest; the narrower rule
--    is enforced here, which is the real gate.
--
-- 2. A MISSING WEEKDAY ENTRY FALLS BACK TO THE FLAT PAIR AND IS NEVER
--    TREATED AS CLOSED. A silent "no bookings accepted" is far worse than a
--    wrong-but-visible window, because nobody notices it until a week of
--    covers has gone.
-- ============================================================

-- ---------- 1. Settings ----------
-- Merged into the existing key, not replacing it, so a database that already
-- has open/close keeps them. Every new field defaults to today's behaviour:
-- not paused, no lead time, and a weekly grid seeded from whatever the flat
-- pair currently says. So running this changes nothing until someone edits
-- the settings, which is the only safe way to land it on a working client.
insert into app_settings (key, value)
values ('reservation_hours', '{"open":"10:00","close":"21:30"}'::jsonb)
on conflict (key) do nothing;

update app_settings
set value = value
  || jsonb_build_object(
       'min_lead_days', coalesce(value->'min_lead_days', '0'::jsonb),
       'online_paused', coalesce(value->'online_paused', 'false'::jsonb),
       'pause_message', coalesce(value->'pause_message', 'null'::jsonb),
       'weekly', coalesce(
         value->'weekly',
         -- Seed all seven days from the pair already in force, so landing
         -- this migration is behaviour-neutral.
         (select jsonb_object_agg(
                   d::text,
                   jsonb_build_object(
                     'closed', false,
                     'open',  coalesce(value->>'open',  '10:00'),
                     'close', coalesce(value->>'close', '21:30')))
            from generate_series(0, 6) as d)
       ))
where key = 'reservation_hours';

-- ---------- 2. Dated exceptions ----------
-- One row per date. The primary key IS the date, so "closed on 17 August"
-- can only be said once and re-stating it is an upsert rather than a second
-- contradictory row.
create table if not exists reservation_exceptions (
  exception_date date primary key,
  -- true  = shut all day.
  -- false = open, but with the hours below instead of the weekday's. This is
  --         how a normally closed day gets reopened for one date.
  closed_all_day boolean not null default true,
  open_time  time,
  close_time time,
  -- Shown to the guest on the booking form, so write it for them, not for
  -- staff: "Tutup untuk Idul Fitri" rather than "buyout - see WA".
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

comment on table reservation_exceptions is
  'One-off closures and hour overrides for a specific date. Beats the weekly grid in app_settings.reservation_hours. Resolved by reservation_hours_for(date).';

-- An open exception with no hours is meaningless and would resolve to a NULL
-- window, which compares false against every time and silently refuses the
-- whole day. Refuse it at write time instead.
alter table reservation_exceptions
  drop constraint if exists reservation_exceptions_open_needs_hours;
alter table reservation_exceptions
  add constraint reservation_exceptions_open_needs_hours
  check (closed_all_day or (open_time is not null and close_time is not null and open_time < close_time));

create index if not exists idx_reservation_exceptions_date
  on reservation_exceptions (exception_date);

drop trigger if exists reservation_exceptions_updated_at on reservation_exceptions;
create trigger reservation_exceptions_updated_at
  before update on reservation_exceptions
  for each row execute function update_updated_at();

alter table reservation_exceptions enable row level security;

-- The guest booking page must be able to READ these to grey out closed dates,
-- and it is anonymous. Writing stays with the staff app.
drop policy if exists "Public read - reservation_exceptions" on reservation_exceptions;
create policy "Public read - reservation_exceptions"
  on reservation_exceptions for select using (true);

drop policy if exists "Public write - reservation_exceptions" on reservation_exceptions;
create policy "Public write - reservation_exceptions"
  on reservation_exceptions for all using (true) with check (true);

-- ---------- 3. The single resolver ----------
-- Anything that needs to know a date's hours calls this rather than
-- re-deriving the rule. Two copies of this logic drifting apart is exactly
-- how the spending-tier showstopper happened.
--
-- Returns, always: { closed, open, close, source, reason }
--   source is 'exception' | 'weekly' | 'flat', which is what makes a
--   surprising answer debuggable without reading this function again.
drop function if exists reservation_hours_for(date);
create or replace function public.reservation_hours_for(p_date date)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_cfg   jsonb := coalesce(get_setting('reservation_hours'), '{}'::jsonb);
  v_flat_open  time := coalesce(nullif(v_cfg->>'open','')::time,  '10:00'::time);
  v_flat_close time := coalesce(nullif(v_cfg->>'close','')::time, '21:30'::time);
  v_exc   reservation_exceptions%rowtype;
  v_day   jsonb;
begin
  if p_date is null then
    return jsonb_build_object('closed', false, 'open', v_flat_open,
                              'close', v_flat_close, 'source', 'flat', 'reason', null);
  end if;

  -- 1. A dated exception beats everything below it.
  select * into v_exc from reservation_exceptions where exception_date = p_date;
  if found then
    if v_exc.closed_all_day then
      return jsonb_build_object('closed', true, 'open', null, 'close', null,
                                'source', 'exception', 'reason', v_exc.reason);
    end if;
    return jsonb_build_object('closed', false,
                              'open', v_exc.open_time, 'close', v_exc.close_time,
                              'source', 'exception', 'reason', v_exc.reason);
  end if;

  -- 2. The weekly grid. Keys "0".."6" are Sunday..Saturday, which is BOTH
  --    JavaScript getDay() and Postgres extract(dow), so one key set is
  --    correct on both sides.
  v_day := v_cfg -> 'weekly' -> (extract(dow from p_date)::int)::text;

  -- 3. No weekly entry: fall back to the flat pair, and NEVER to closed.
  --    See the header. A silent "no bookings accepted" is the worse failure.
  if v_day is null then
    return jsonb_build_object('closed', false, 'open', v_flat_open,
                              'close', v_flat_close, 'source', 'flat', 'reason', null);
  end if;

  if coalesce((v_day->>'closed')::boolean, false) then
    return jsonb_build_object('closed', true, 'open', null, 'close', null,
                              'source', 'weekly', 'reason', null);
  end if;

  return jsonb_build_object(
    'closed', false,
    -- A weekday entry missing its times is a half-written setting, not a
    -- closure. Same reasoning as a missing entry.
    'open',  coalesce(nullif(v_day->>'open','')::time,  v_flat_open),
    'close', coalesce(nullif(v_day->>'close','')::time, v_flat_close),
    'source', 'weekly', 'reason', null);
end;
$fn$;

comment on function public.reservation_hours_for(date) is
  'The one place a date''s opening hours are decided. Exception beats weekly beats the flat pair. Never returns closed for a missing entry.';

-- ---------- 4. The booking gate ----------
-- Rewritten to consult all of the above. Everything not about availability is
-- unchanged from the previous version: phone normalisation, the name/pax
-- checks, guest matching by exact phone, the one-open-booking-per-phone-per-day
-- duplicate guard, and the two-step booking_alias handling.
create or replace function public.create_public_reservation(
  p_name text, p_phone text, p_pax integer, p_date date,
  p_time time without time zone, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
  declare
    v_name     text := trim(coalesce(p_name, ''));
    v_phone    text;
    v_notes    text := nullif(left(trim(coalesce(p_notes, '')), 500), '');
    v_cfg      jsonb := coalesce(get_setting('reservation_hours'), '{}'::jsonb);
    v_lead     integer := greatest(coalesce((v_cfg->>'min_lead_days')::integer, 0), 0);
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
    if p_pax is null or p_pax < 1 or p_pax > 20 then
      return jsonb_build_object('ok', false, 'code', 'invalid_pax',
        'message', 'Pax must be 1-20 (larger groups: contact us on WhatsApp)');
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

    if p_date > v_now_jkt::date + 90 then
      return jsonb_build_object('ok', false, 'code', 'too_far',
        'message', 'Bookings open up to 90 days ahead');
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

    insert into reservations
      (guest_id, reservation_date, reservation_time, pax, status,
      reservation_source, notes, booking_name)
    values
      (v_guest_id, p_date, p_time, p_pax, 'Reserved',
      'Online Form', v_notes, v_name)
    returning id into v_res_id;

    -- ===== ALIAS 2/2: refresh the denormalised latest alias =====
    -- Unconditional assignment (including back to NULL) is intentional:
    -- the alias must follow the most recent booking, not accumulate.
    update guests
      set booking_alias = v_alias,
          updated_at    = now()
    where id = v_guest_id
      and booking_alias is distinct from v_alias;

    return jsonb_build_object('ok', true, 'reservation_id', v_res_id);
  end;
  $function$;

-- ---------- Confirm ----------
select 'reservation_exceptions table' as checked, count(*) as found
from information_schema.tables
where table_schema = 'public' and table_name = 'reservation_exceptions'
union all
select 'reservation_hours_for()', count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'reservation_hours_for'
union all
select 'weekly grid seeded (7 days)',
       coalesce(jsonb_array_length(jsonb_path_query_array(value, '$.weekly.*')), 0)
from app_settings where key = 'reservation_hours'
union all
select 'min_lead_days defaults to 0',
       case when value->>'min_lead_days' = '0' then 1 else 0 end
from app_settings where key = 'reservation_hours'
union all
select 'online_paused defaults to false',
       case when value->>'online_paused' = 'false' then 1 else 0 end
from app_settings where key = 'reservation_hours';
-- expect: 1, 1, 7, 1, 1
