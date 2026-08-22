-- ============================================================
-- GAPS FOUND BY COMPARING AGAINST THE LIVE BLUE HERON DATABASE
-- Date: 2026-08-23
--
-- HOW THIS WAS FOUND
-- Rere's idea, and a good one: instead of trusting the migration history,
-- read the database that actually runs a restaurant and diff it against
-- what the migrations produce. Everything below exists in production but
-- was never written into any migration file. It was applied by hand and
-- forgotten, which is the same root cause as the four failures on
-- 2026-08-22 (missing files, wrong order, missing 'admin' role, no
-- idempotency).
--
-- Nothing in production was modified to produce this. Read-only queries
-- against information_schema, pg_proc and pg_get_viewdef only.
--
-- Everything here is additive and safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns present in production, absent from the migrations
-- ------------------------------------------------------------

-- VIP hour-range bookings. Without this the VIP timeline on the
-- Reservations page has no end time to draw and the overlap check on
-- save cannot work.
alter table public.reservations
  add column if not exists end_time time without time zone;

-- Spin wheel session handshake. create_spin_session writes it, and the
-- function below will fail without it.
alter table public.spin_submissions
  add column if not exists session_token text;

-- Audit trail for edits to a visit's spend amount.
alter table public.visits
  add column if not exists spend_updated_at timestamptz,
  add column if not exists spend_updated_by uuid;

-- The campaign workspace rework (2026-08-01). The migration file in the
-- repo only covers the first version of the broadcast schema; the rework
-- went straight to production.
alter table public.wa_campaign_audience
  add column if not exists send_count   integer not null default 0,
  add column if not exists last_sent_at timestamptz,
  add column if not exists skip_reason  text;

alter table public.wa_campaigns
  add column if not exists promo_url         text,
  add column if not exists promo_image_path  text,
  add column if not exists promo_title       text,
  add column if not exists promo_description text,
  add column if not exists promo_destination text,
  add column if not exists message_version   integer not null default 1;

alter table public.wa_outreach_log
  add column if not exists message_version integer;

-- ------------------------------------------------------------
-- 2. Views present in production, absent from the migrations
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW public.guest_last_visit AS
  SELECT guest_id, max(visit_date) AS last_visit_date
  FROM visits
  WHERE guest_id IS NOT NULL
  GROUP BY guest_id;

CREATE OR REPLACE VIEW public.table_details AS
  SELECT t.id,
         t.name AS table_name,
         t.capacity,
         a.name AS area_name,
         a.id   AS area_id,
         t.is_active
  FROM tables t
  JOIN areas a ON a.id = t.area_id;

-- ------------------------------------------------------------
-- 3. Functions present in production, absent from the migrations
-- ------------------------------------------------------------

-- Birthday widget. Feb 29 is clamped to Feb 28 in non-leap years so that
-- date construction never throws.
CREATE OR REPLACE FUNCTION public.is_leap_year(y integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (y % 4 = 0 AND y % 100 <> 0) OR y % 400 = 0;
$function$;

CREATE OR REPLACE FUNCTION public.next_birthday_occurrence(p_birthday date, p_from date DEFAULT CURRENT_DATE)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_month int := EXTRACT(MONTH FROM p_birthday)::int;
  v_day int := EXTRACT(DAY FROM p_birthday)::int;
  v_year int := EXTRACT(YEAR FROM p_from)::int;
  v_candidate date;
BEGIN
  -- Clamp Feb 29 to Feb 28 in non-leap years so date construction never errors.
  IF v_month = 2 AND v_day = 29 AND NOT public.is_leap_year(v_year) THEN
    v_day := 28;
  END IF;
  v_candidate := make_date(v_year, v_month, v_day);
  IF v_candidate < p_from THEN
    v_year := v_year + 1;
    IF v_month = 2 AND v_day = 29 AND NOT public.is_leap_year(v_year) THEN
      v_day := 28;
    ELSIF v_month = 2 AND v_day = 28 AND EXTRACT(DAY FROM p_birthday)::int = 29 AND public.is_leap_year(v_year) THEN
      v_day := 29;
    END IF;
    v_candidate := make_date(v_year, v_month, v_day);
  END IF;
  RETURN v_candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_guests_for_birthday_view(p_month integer)
 RETURNS TABLE(id uuid, name text, birthday date, phone text, spending_tier text, days_until integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT id, name, birthday, phone, spending_tier,
    (public.next_birthday_occurrence(birthday) - CURRENT_DATE)::int AS days_until
  FROM guests
  WHERE birthday IS NOT NULL
    AND (
      EXTRACT(MONTH FROM birthday) = p_month
      OR (public.next_birthday_occurrence(birthday) - CURRENT_DATE) BETWEEN 0 AND 7
    )
  ORDER BY name ASC;
$function$;

-- Spin wheel. The prize draw happens SERVER side on purpose: the weights
-- decide what a guest wins, and a client-side draw would let anyone pick
-- their own prize.
CREATE OR REPLACE FUNCTION public.create_spin_session(p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_prizes         JSONB;
  v_total_weight   INT;
  v_rand           FLOAT;
  v_cumulative     INT := 0;
  v_selected_id    UUID;
  v_selected_name  TEXT;
  v_selected_emoji TEXT;
  v_token          TEXT;
  v_ref_code       TEXT;
  v_date_str       TEXT;
  v_seq            TEXT;
  v_new_id         UUID;
  rec              RECORD;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'emoji', emoji, 'weight', weight))
  INTO v_prizes FROM prizes WHERE is_active = true;

  IF v_prizes IS NULL OR jsonb_array_length(v_prizes) = 0 THEN
    RETURN jsonb_build_object('error', 'No active prizes');
  END IF;

  SELECT COALESCE(SUM((p->>'weight')::INT), 0) INTO v_total_weight
  FROM jsonb_array_elements(v_prizes) AS p;

  v_rand := random() * v_total_weight;

  FOR rec IN
    SELECT (p->>'id')::UUID AS id, (p->>'name') AS name, (p->>'emoji') AS emoji, (p->>'weight')::INT AS weight
    FROM jsonb_array_elements(v_prizes) AS p
  LOOP
    v_cumulative := v_cumulative + rec.weight;
    IF v_rand <= v_cumulative THEN
      v_selected_id    := rec.id;
      v_selected_name  := rec.name;
      v_selected_emoji := rec.emoji;
      EXIT;
    END IF;
  END LOOP;

  IF v_selected_id IS NULL THEN
    SELECT (p->>'id')::UUID, (p->>'name'), (p->>'emoji')
    INTO v_selected_id, v_selected_name, v_selected_emoji
    FROM jsonb_array_elements(v_prizes) AS p LIMIT 1;
  END IF;

  v_token := 'spin-' || encode(gen_random_bytes(12), 'hex');
  v_date_str := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD');
  v_seq      := LPAD((FLOOR(RANDOM() * 9000) + 1000)::TEXT, 4, '0');
  -- NOTE: reference codes are prefixed 'BH-' here, carried over from Blue
  -- Heron. Make this per-client before selling: two restaurants both
  -- handing out BH- codes is confusing at the till.
  v_ref_code := 'BH-' || v_date_str || '-' || v_seq;

  INSERT INTO spin_submissions (
    name, prize_id, prize_name, reference_code, claim_code,
    session_token, status, review_confirmed, review_url
  ) VALUES (
    p_name, v_selected_id, v_selected_name, v_ref_code, v_ref_code,
    v_token, 'reserved', false, null
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'submission_id',  v_new_id,
    'session_token',  v_token,
    'prize_id',       v_selected_id,
    'prize_name',     v_selected_name,
    'prize_emoji',    v_selected_emoji,
    'reference_code', v_ref_code
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_spin_session(p_session_token text, p_review_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id UUID;
BEGIN
  UPDATE spin_submissions
  SET status = 'pending', review_confirmed = true, review_url = p_review_url
  WHERE session_token = p_session_token AND status = 'reserved'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Session not found or already confirmed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_id);
END;
$function$;

-- ------------------------------------------------------------
-- 4. Confirm
-- ------------------------------------------------------------
select 'columns' as checked, count(*) as found from information_schema.columns
where table_schema='public' and (
  (table_name='reservations' and column_name='end_time') or
  (table_name='spin_submissions' and column_name='session_token') or
  (table_name='visits' and column_name in ('spend_updated_at','spend_updated_by')) or
  (table_name='wa_campaign_audience' and column_name in ('send_count','last_sent_at','skip_reason')) or
  (table_name='wa_campaigns' and column_name in ('promo_url','promo_image_path','promo_title','promo_description','promo_destination','message_version')) or
  (table_name='wa_outreach_log' and column_name='message_version'))
union all
select 'views', count(*) from information_schema.views
where table_schema='public' and table_name in ('guest_last_visit','table_details')
union all
select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('is_leap_year','next_birthday_occurrence','get_guests_for_birthday_view','create_spin_session','confirm_spin_session');
-- expect: columns 14, views 2, functions 5
