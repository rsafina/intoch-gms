  -- ============================================================
  -- BLUE HERON — OWNER DASHBOARD + OPS CHANNEL/REPEAT REPORTING
  -- Prod: YOUR_SUPABASE_PROJECT_REF
  -- Date: 2026-07-26
  --
  -- Purely additive. Nothing existing is dropped or renamed.
  --
  -- WHY (Ops Manager request 2026-07-26):
  --   1. Measure online-form effectiveness (bookings + spend).
  --   2. Show a booking alias when a returning guest books under a
  --      different name than the one we hold: "Rere (Retno)".
  --   3. Show repeat-guest visit count + total spend in reports.
  --
  -- DESIGN NOTE on the alias:
  --   create_public_reservation deliberately NEVER renames a guest
  --   (a guest's canonical name is staff-owned data). So the name
  --   typed into the public form used to be discarded entirely.
  --   We now keep it in two places:
  --     - reservations.booking_name  → source of truth, per booking,
  --       immutable audit trail of exactly what the guest typed.
  --     - guests.booking_alias       → denormalised "latest alias",
  --       so every list/table in the app can render the alias with
  --       no extra join. Recomputed on every online booking.
  --   booking_alias is NULL when the typed name matches the guest's
  --   canonical name (case/whitespace-insensitive), so a guest who
  --   goes back to using their real name loses the stale alias.
  -- ============================================================

  -- ---------- 1. COLUMNS ----------
  alter table public.reservations
    add column if not exists booking_name text;

  comment on column public.reservations.booking_name is
    'Name exactly as typed by the guest in the public reservation form. '
    'NULL for staff-entered bookings. Never overwrites guests.name.';

  alter table public.guests
    add column if not exists booking_alias text;

  comment on column public.guests.booking_alias is
    'Latest online-form booking name that differs from guests.name. '
    'Rendered as "Name (Alias)". NULL when the guest books under their '
    'canonical name. Set only by create_public_reservation.';


  -- ---------- 2. AGGREGATE VIEW: per-guest visit + spend stats ----------
  -- Used by the owner dashboard (repeat rate) and Report > Operations
  -- (repeat guest table). One row per guest instead of pulling the whole
  -- visits table into the browser.
  --
  -- Excludes voided visits (mis-entered walk-ins) so they never inflate
  -- visit counts or spend — same rule as calculate_guest_spending_tier.
  -- visit_count includes still-Active (seated) visits, because "how many
  -- times has this guest come" is true the moment they sit down. Spend is
  -- coalesced to 0 since it is only filled in at checkout.
  create or replace view public.guest_visit_stats
  with (security_invoker = true) as
  select
    v.guest_id,
    count(*)::int                                as visit_count,
    sum(coalesce(v.spend_amount, 0))::numeric    as total_spend,
    sum(coalesce(v.pax, 0))::int                 as total_pax,
    count(*) filter (where v.spend_amount > 0)::int as visits_with_spend,
    min(v.visit_date)                            as first_visit_date,
    max(v.visit_date)                            as last_visit_date
  from public.visits v
  where v.voided_at is null
  group by v.guest_id;

  comment on view public.guest_visit_stats is
    'Per-guest lifetime visit + spend aggregate, excluding voided visits. '
    'Read-only reporting helper.';


  -- ---------- 3. ONLINE-FORM PERFORMANCE VIEW ----------
  -- One row per online-form booking, with the spend actually recorded
  -- against it. LEFT JOIN on visits: a booking with no visit row simply
  -- has arrived = false, which is exactly the no-show/cancel signal Ops
  -- wants. Deleted bookings (staff data-entry mistakes) are excluded —
  -- Cancelled bookings are NOT, because a real guest cancelling is a
  -- genuine channel-quality signal.
  create or replace view public.online_reservation_performance
  with (security_invoker = true) as
  select
    r.id                                as reservation_id,
    r.guest_id,
    r.reservation_date,
    r.reservation_time,
    r.pax                               as booked_pax,
    r.status,
    r.booking_name,
    r.created_at,
    g.name                              as guest_name,
    g.phone                             as guest_phone,
    g.booking_alias,
    (v.id is not null)                  as arrived,
    v.visit_date,
    v.pax                               as actual_pax,
    coalesce(v.spend_amount, 0)::numeric as spend_amount
  from public.reservations r
  join public.guests g on g.id = r.guest_id
  left join public.visits v
        on v.reservation_id = r.id
        and v.voided_at is null
  where r.reservation_source = 'Online Form'
    and r.deleted_at is null;

  comment on view public.online_reservation_performance is
    'Online-form bookings joined to the visit (if any) they produced, for '
    'channel-effectiveness reporting. Excludes staff-deleted bookings; '
    'includes guest cancellations on purpose.';


  -- ---------- 4. RPC: record booking_name + refresh booking_alias ----------
  -- Identical to the 2026-07-19 version except for the two clearly
  -- marked ALIAS blocks near the end. Re-stated in full because
  -- create or replace function needs the whole body.
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
  $$;

  grant execute on function public.create_public_reservation(
    text, text, integer, date, time, text) to anon;


  -- ---------- 5. BACKFILL ----------
  -- The 4 online bookings that already exist (form launched 2026-07-19)
  -- predate booking_name, so their typed name is unrecoverable. We seed
  -- booking_name from the guest's canonical name to keep the column
  -- non-null for online rows, and leave booking_alias NULL — we have no
  -- evidence any of them used a different name.
  update public.reservations r
    set booking_name = g.name
    from public.guests g
  where g.id = r.guest_id
    and r.reservation_source = 'Online Form'
    and r.booking_name is null;
