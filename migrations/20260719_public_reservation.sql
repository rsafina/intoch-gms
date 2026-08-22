-- ============================================================
-- BLUE HERON — PUBLIC (GUEST-FACING) RESERVATION
-- Prod: YOUR_SUPABASE_PROJECT_REF. Applied via MCP 2026-07-19.
-- Purely additive: new app_settings table + get_setting helper
-- (Blue Heron prod had neither — they existed only in gms-proto),
-- reservation_hours seed, and the create_public_reservation RPC.
-- Nothing existing is modified.
-- ============================================================

-- ---------- 1. SETTINGS TABLE + HELPER (new in this project) ----------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.get_setting(p_key text)
returns jsonb
language sql
stable
as $$
  select value from app_settings where key = p_key;
$$;

-- Blue Heron hours per Rere 2026-07-19. To change later:
-- update app_settings set value = '{"open":"10:00","close":"21:30"}'
--   where key = 'reservation_hours';
insert into app_settings (key, value) values
  ('reservation_hours', '{"open": "10:00", "close": "21:30"}')
on conflict (key) do nothing;

-- ---------- 2. PUBLIC RESERVATION RPC ----------
-- Same contract as gms-proto: {ok:true, reservation_id} or {ok:false, code}.
create or replace function public.create_public_reservation(
  p_name  text,
  p_phone text,
  p_pax   integer,
  p_date  date,
  p_time  time,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name     text := trim(coalesce(p_name, ''));
  v_phone    text;
  v_notes    text := nullif(left(trim(coalesce(p_notes, '')), 500), '');
  v_hours    jsonb;
  v_open     time;
  v_close    time;
  v_now_jkt  timestamp := (now() at time zone 'Asia/Jakarta');
  v_guest_id uuid;
  v_res_id   uuid;
  v_dup      integer;
begin
  -- phone normalization (mirrors normalizePhone in app.js)
  v_phone := regexp_replace(coalesce(p_phone, ''), '[\s\-\(\)\.]', '', 'g');
  if v_phone like '+62%' then
    v_phone := '0' || substr(v_phone, 4);
  elsif v_phone like '62%' and length(v_phone) >= 10 then
    v_phone := '0' || substr(v_phone, 3);
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
  if p_date > v_now_jkt::date + 90 then
    return jsonb_build_object('ok', false, 'code', 'too_far',
      'message', 'Bookings open up to 90 days ahead');
  end if;

  v_hours := coalesce(get_setting('reservation_hours'),
                      '{"open":"10:00","close":"21:30"}'::jsonb);
  v_open  := (v_hours->>'open')::time;
  v_close := (v_hours->>'close')::time;
  if p_time < v_open or p_time > v_close then
    return jsonb_build_object('ok', false, 'code', 'outside_hours',
      'message', 'Outside opening hours', 'open', v_hours->>'open',
      'close', v_hours->>'close');
  end if;

  if p_date = v_now_jkt::date
     and p_time < (v_now_jkt + interval '30 minutes')::time then
    return jsonb_build_object('ok', false, 'code', 'too_soon',
      'message', 'Same-day bookings need 30 minutes notice');
  end if;

  -- guest match: EXACT phone match reuses guest, never renames
  select id into v_guest_id from guests where phone = v_phone limit 1;
  if v_guest_id is null then
    -- phone is UNIQUE: on_conflict guards against two simultaneous submits
    insert into guests (name, phone)
    values (v_name, v_phone)
    on conflict (phone) do nothing
    returning id into v_guest_id;
    if v_guest_id is null then
      select id into v_guest_id from guests where phone = v_phone limit 1;
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

  insert into reservations
    (guest_id, reservation_date, reservation_time, pax, status,
     reservation_source, notes)
  values
    (v_guest_id, p_date, p_time, p_pax, 'Reserved', 'Online Form', v_notes)
  returning id into v_res_id;

  return jsonb_build_object('ok', true, 'reservation_id', v_res_id);
end;
$$;

grant execute on function public.create_public_reservation(text, text, integer, date, time, text) to anon;
