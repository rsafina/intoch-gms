-- ============================================================
-- INTOCH: ROUND 5, complete schema for a Supabase project
-- Round 5, 2026-08-23. Now also includes everything found by diffing
-- against the LIVE Blue Heron database: 14 columns, 2 views and 5
-- functions that exist in production but were never in any migration.
--
-- Every CREATE is IF NOT EXISTS, every trigger and policy drops
-- itself first, and every seed insert is guarded. Re-running this
-- on a database that is already partly built will not error and
-- will not duplicate rows.
--
-- Blue Heron's demo guests are COMMENTED OUT. See the note in the
-- base schema section if you want fake data for a throwaway demo.
-- ============================================================

-- ============================================================
-- PREAMBLE: clear functions this script is about to redefine
--
-- WHY THIS IS HERE
-- `CREATE OR REPLACE FUNCTION` cannot change a function's return type or
-- its argument list. Several functions in this set are legitimately
-- redefined by a later migration with a different shape:
--
--   calculate_guest_spending_tier  RETURNS TABLE(...)  ->  RETURNS TEXT  ->  RETURNS TABLE(...)
--   add_member_transaction         gained a p_visit_id argument
--   create_public_reservation      gained booking_name handling
--
-- On a fresh database that is fine, because each definition simply replaces
-- the previous one in order. On a database where an earlier run already
-- created them, Postgres refuses with 42P13 "cannot change return type of
-- existing function".
--
-- So: drop every overload of every function this script defines, before
-- defining any of them. CASCADE is safe HERE and only here, because this
-- block runs before anything else is created; the only things it can take
-- with it are triggers from a previous partial run, which the rest of this
-- script recreates.
--
-- Do not move this block. Do not add CASCADE anywhere further down.
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'add_member_transaction',
        'build_voucher_code',
        'calculate_guest_spending_tier',
        'convert_visits_to_stickers',
        'create_public_reservation',
        'get_guest_visit_summary',
        'get_setting',
        'list_member_backfill_visits',
        'recalc_all_tiers',
        'recalculate_guest_spending_tier',
        'redeem_member_voucher',
        'redeem_standalone_voucher',
        'set_member_voucher_defaults',
        'set_standalone_voucher_defaults',
        'standalone_voucher_validity_days',
        'trigger_recalculate_guest_spending_tier',
        'update_updated_at',
        'void_standalone_voucher',
        'voucher_validity_days'
      )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;


-- ################################################################
-- ## 00_schema_from_blueheron.sql
-- ################################################################

-- ============================================================
-- BLUE HERON GUEST BOOK — SUPABASE SQL SCHEMA
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: areas
-- ============================================================
CREATE TABLE IF NOT EXISTS areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: tables
-- ============================================================
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tables_area_id ON tables(area_id);
CREATE INDEX IF NOT EXISTS idx_tables_name ON tables(LOWER(name));

-- ============================================================
-- TABLE: staff_users
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pin TEXT NOT NULL CHECK (pin ~ '^[0-9]{4}$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_users_username ON staff_users(LOWER(username));

-- ============================================================
-- TABLE: guests
-- ============================================================
CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
  birthday DATE,
  company TEXT,
  food_allergy TEXT,
  preference TEXT,
  notes TEXT,
  created_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  spending_tier TEXT CHECK (spending_tier IS NULL OR spending_tier IN ('high_spender', 'medium_spender')),
  tier_source TEXT NOT NULL DEFAULT 'auto' CHECK (tier_source IN ('auto', 'manual')),
  tier_last_calculated_at TIMESTAMPTZ,
  -- Sticky 90-day high-spender window: the most recent date a visit qualified
  -- as "high spend" (>= 1,000,000 total or >= 300,000/pax). High Spender
  -- status is retained for 90 days after this date even if a later visit
  -- doesn't qualify, so a guest isn't bumped down after one modest visit.
  high_spender_qualified_at TIMESTAMPTZ,
  tag VARCHAR,
  favorite_menu TEXT
);

CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone);
CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_guests_company ON guests(LOWER(company));
CREATE INDEX IF NOT EXISTS idx_guests_spending_tier ON guests(spending_tier);
CREATE INDEX IF NOT EXISTS idx_guests_tier_source ON guests(tier_source);

-- ============================================================
-- TABLE: reservations
-- ============================================================
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  pax INTEGER NOT NULL DEFAULT 1,
  occasion TEXT,
  reservation_source TEXT,
  assigned_area UUID REFERENCES areas(id),
  table_id UUID REFERENCES tables(id),
  status TEXT NOT NULL DEFAULT 'Reserved'
    CHECK (status IN ('Reserved','Confirmed','Arrived','Cancelled','Cancelled (No Show)','No Show','Completed','Deleted')),
  notes TEXT,
  created_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- 'Deleted' is distinct from 'Cancelled': Cancelled means the guest backed
  -- out (reporting signal); Deleted means staff mis-entered it (data-entry
  -- mistake, e.g. duplicate reservation+walk-in). Never a hard delete —
  -- reservation row and any linked guest/visit history are preserved.
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES staff_users(id),
  delete_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);

-- ============================================================
-- TABLE: visits
-- ============================================================
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  visit_type TEXT NOT NULL CHECK (visit_type IN ('Walk-In', 'Reservation')),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visit_time TIME NOT NULL DEFAULT CURRENT_TIME,
  pax INTEGER NOT NULL DEFAULT 1,
  assigned_area UUID REFERENCES areas(id),
  table_id UUID REFERENCES tables(id),
  spend_amount NUMERIC(12,2),
  notes TEXT,
  created_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Active = currently seated; Done = completed/closed out.
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Done')),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  -- Soft-delete for mis-entered walk-ins / arrival visits. Never a hard
  -- DELETE: the row stays for audit + so guest visit history is never lost.
  -- Excluded from spending-tier calc (see calculate_guest_spending_tier)
  -- and from the default walk-in list/report views.
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES staff_users(id),
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_visits_guest ON visits(guest_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_voided_at ON visits(voided_at) WHERE voided_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_deleted_at ON reservations(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================
-- TABLE: prizes
-- ============================================================
CREATE TABLE IF NOT EXISTS prizes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  weight INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#2F4A63',
  emoji TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: spin_submissions
-- ============================================================
CREATE TABLE IF NOT EXISTS spin_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  prize_id UUID REFERENCES prizes(id),
  prize_name TEXT NOT NULL,
  review_confirmed BOOLEAN NOT NULL DEFAULT false,
  reference_code TEXT NOT NULL UNIQUE,
  claim_code TEXT,
  review_url TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spin_submissions_phone ON spin_submissions(phone);
CREATE INDEX IF NOT EXISTS idx_spin_submissions_guest_id ON spin_submissions(guest_id);
CREATE INDEX IF NOT EXISTS idx_spin_submissions_reference_code ON spin_submissions(reference_code);
CREATE INDEX IF NOT EXISTS idx_spin_submissions_created_at ON spin_submissions(created_at);

-- ============================================================
-- TABLE: saved_segments (reusable report filter combinations)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT 'spending_insights',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_segments_page ON saved_segments(page);

-- ============================================================
-- FUNCTION: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guests_updated_at ON guests;

CREATE TRIGGER guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS reservations_updated_at ON reservations;

CREATE TRIGGER reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: customer spending tier calculation
-- Sticky 90-day High Spender window: a guest keeps High Spender status for
-- 90 days after their most recent qualifying visit (>= 1,000,000 total
-- spend, or >= 300,000 spend/pax), even if later visits don't qualify.
-- Excludes voided visits (manager-removed duplicate/mistake walk-ins).
-- ============================================================
-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'calculate_guest_spending_tier'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION calculate_guest_spending_tier(p_guest_id UUID)
 RETURNS TABLE(tier text, qualified_at timestamptz) AS $$
DECLARE
  v_latest_qualifying_date  TIMESTAMPTZ := NULL;
  v_stored_qualified_at     TIMESTAMPTZ := NULL;
  v_effective_qualified_at  TIMESTAMPTZ := NULL;
  v_has_any_spend           BOOLEAN     := FALSE;
  v_sticky_cutoff           TIMESTAMPTZ := NOW() - INTERVAL '90 days';
BEGIN
  SELECT high_spender_qualified_at INTO v_stored_qualified_at
  FROM guests WHERE id = p_guest_id;

  SELECT
    COALESCE(BOOL_OR(spend_amount > 0), FALSE),
    MAX(CASE
      WHEN spend_amount >= 1000000
        OR (spend_amount / NULLIF(pax, 0)) >= 300000
      THEN visit_date::TIMESTAMPTZ
      ELSE NULL
    END)
  INTO v_has_any_spend, v_latest_qualifying_date
  FROM visits
  WHERE guest_id = p_guest_id
    AND spend_amount IS NOT NULL AND spend_amount > 0
    AND pax IS NOT NULL AND pax > 0
    AND voided_at IS NULL;

  IF NOT v_has_any_spend THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_effective_qualified_at := GREATEST(v_latest_qualifying_date, v_stored_qualified_at);

  IF v_effective_qualified_at IS NOT NULL AND v_effective_qualified_at >= v_sticky_cutoff THEN
    RETURN QUERY SELECT 'high_spender'::TEXT, v_effective_qualified_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'medium_spender'::TEXT, v_effective_qualified_at;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recalculate_guest_spending_tier(p_guest_id UUID)
RETURNS VOID AS $$
DECLARE
  v_tier TEXT;
  v_qualified_at TIMESTAMPTZ;
BEGIN
  IF p_guest_id IS NULL THEN
    RETURN;
  END IF;

  SELECT t.tier, t.qualified_at INTO v_tier, v_qualified_at
  FROM calculate_guest_spending_tier(p_guest_id) AS t;

  UPDATE guests
  SET
    spending_tier = v_tier,
    tier_source = 'auto',
    tier_last_calculated_at = NOW(),
    high_spender_qualified_at = v_qualified_at
  WHERE id = p_guest_id
    AND tier_source = 'auto';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_recalculate_guest_spending_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM recalculate_guest_spending_tier(NEW.guest_id);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM recalculate_guest_spending_tier(OLD.guest_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS visits_recalculate_guest_spending_tier ON visits;

CREATE TRIGGER visits_recalculate_guest_spending_tier
  AFTER INSERT OR UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_guest_spending_tier();

DROP TRIGGER IF EXISTS reservations_recalculate_guest_spending_tier ON reservations;

CREATE TRIGGER reservations_recalculate_guest_spending_tier
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_guest_spending_tier();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE spin_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_segments ENABLE ROW LEVEL SECURITY;

-- For MVP: allow all authenticated users full access
-- In production, scope by role using auth.jwt() claims

DROP POLICY IF EXISTS "Authenticated full access - guests" ON guests;

CREATE POLICY "Authenticated full access - guests" ON guests FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated full access - reservations" ON reservations;

CREATE POLICY "Authenticated full access - reservations" ON reservations FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated full access - visits" ON visits;

CREATE POLICY "Authenticated full access - visits" ON visits FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated full access - areas" ON areas;

CREATE POLICY "Authenticated full access - areas" ON areas FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Anon read for areas (host stand doesn't need login for areas)
DROP POLICY IF EXISTS "Public read - areas" ON areas;
CREATE POLICY "Public read - areas" ON areas FOR SELECT
  USING (true);

-- Public browser access for the guest book MVP.
DROP POLICY IF EXISTS "Public full access - guests" ON guests;
CREATE POLICY "Public full access - guests" ON guests FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public full access - reservations" ON reservations;

CREATE POLICY "Public full access - reservations" ON reservations FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public full access - visits" ON visits;

CREATE POLICY "Public full access - visits" ON visits FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public full access - prizes" ON prizes;

CREATE POLICY "Public full access - prizes" ON prizes FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public full access - spin_submissions" ON spin_submissions;

CREATE POLICY "Public full access - spin_submissions" ON spin_submissions FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public full access - saved_segments" ON saved_segments;

CREATE POLICY "Public full access - saved_segments" ON saved_segments FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- SEED DATA: Areas
-- ============================================================
INSERT INTO areas (name, capacity)
SELECT * FROM (VALUES
  ('Indoor Dining', 80),
  ('Outdoor Dining', 60),
  ('VIP Room A', 20),
  ('VIP Room B', 16)
) AS v(name, capacity)
WHERE NOT EXISTS (SELECT 1 FROM areas);

-- ============================================================
-- SEED DATA: Sample Guests
-- ============================================================
-- ============================================================
-- DEMO DATA: DISABLED 2026-08-22
--
-- These are Blue Heron's original test fixtures: three invented
-- guests and their reservations. Running them on a real client
-- puts fake people called "Andika Pratama" and "Sari Dewi" into
-- their guest book on day one, which front desk will treat as real.
--
-- Left in place, commented, because they are useful for a throwaway
-- demo project. Uncomment deliberately, never by default.
-- ============================================================
-- INSERT INTO guests (name, phone, gender, company, preference, notes) VALUES
--   ('Andika Pratama', '081234567890', 'Male', 'PT Astra International', 'Window seat, no spicy food', 'Prefers quiet areas'),
--   ('Sari Dewi', '082345678901', 'Female', NULL, 'Outdoor seating', 'Regular Friday diner'),
--   ('Budi Santoso', '083456789012', 'Male', 'Bank Mandiri', 'VIP Room', 'Corporate events only'),
--   ('Ratna Kusuma', '084567890123', 'Female', NULL, NULL, 'Celebrates birthday in July'),
--   ('Hendra Wijaya', '085678901234', 'Male', 'Gojek Indonesia', 'Indoor, near bar', 'Tech company team lunches');
--
-- -- ============================================================
-- -- SEED DATA: Sample Reservations (today + upcoming)
-- -- ============================================================
-- -- Note: run after guests are inserted; use subquery for guest_id
-- INSERT INTO reservations (guest_id, reservation_date, reservation_time, pax, occasion, status, notes)
-- SELECT id, CURRENT_DATE, '19:00', 4, 'Anniversary', 'Confirmed', 'Flower arrangement requested'
-- FROM guests WHERE phone = '081234567890';
--
-- INSERT INTO reservations (guest_id, reservation_date, reservation_time, pax, status)
-- SELECT id, CURRENT_DATE, '20:30', 2, 'Reserved'
-- FROM guests WHERE phone = '082345678901';
--
-- INSERT INTO reservations (guest_id, reservation_date, reservation_time, pax, occasion, status, notes)
-- SELECT id, CURRENT_DATE, '12:00', 10, 'Business Lunch', 'Confirmed', 'Corporate billing to Bank Mandiri'
-- FROM guests WHERE phone = '083456789012';

-- Existing databases: run once if the column is not present yet
-- ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reservation_source TEXT;


-- ################################################################
-- ## 20260602_customer_spending_tiers.sql
-- ################################################################

-- Customer spending tier segmentation for Walk-In Insight.

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS spending_tier TEXT,
  ADD COLUMN IF NOT EXISTS tier_source TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS tier_last_calculated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guests_spending_tier_check'
  ) THEN
    ALTER TABLE guests
      ADD CONSTRAINT guests_spending_tier_check
      CHECK (spending_tier IS NULL OR spending_tier IN ('high_spender', 'medium_spender'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guests_tier_source_check'
  ) THEN
    ALTER TABLE guests
      ADD CONSTRAINT guests_tier_source_check
      CHECK (tier_source IN ('auto', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guests_spending_tier ON guests(spending_tier);
CREATE INDEX IF NOT EXISTS idx_guests_tier_source ON guests(tier_source);

-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'calculate_guest_spending_tier'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION calculate_guest_spending_tier(p_guest_id UUID)
RETURNS TEXT AS $$
DECLARE
  lifetime_spend NUMERIC := 0;
  total_pax NUMERIC := 0;
  avg_spend_per_pax NUMERIC := 0;
  min_group_spend_per_pax NUMERIC := NULL;
  valid_visit_count INTEGER := 0;
BEGIN
  SELECT
    COALESCE(SUM(spend_amount), 0),
    COALESCE(SUM(pax), 0),
    MIN(spend_amount / NULLIF(pax, 0)),
    COUNT(*)
  INTO lifetime_spend, total_pax, min_group_spend_per_pax, valid_visit_count
  FROM visits
  WHERE guest_id = p_guest_id
    AND spend_amount IS NOT NULL
    AND spend_amount > 0
    AND pax IS NOT NULL
    AND pax > 0;

  IF valid_visit_count = 0 OR total_pax = 0 THEN
    RETURN NULL;
  END IF;

  avg_spend_per_pax := lifetime_spend / total_pax;

  IF lifetime_spend >= 1000000 OR avg_spend_per_pax >= 300000 THEN
    RETURN 'high_spender';
  END IF;

  IF avg_spend_per_pax < 300000 OR min_group_spend_per_pax < 250000 THEN
    RETURN 'medium_spender';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION recalculate_guest_spending_tier(p_guest_id UUID)
RETURNS VOID AS $$
DECLARE
  new_tier TEXT;
BEGIN
  IF p_guest_id IS NULL THEN
    RETURN;
  END IF;

  SELECT calculate_guest_spending_tier(p_guest_id) INTO new_tier;

  UPDATE guests
  SET
    spending_tier = new_tier,
    tier_source = 'auto',
    tier_last_calculated_at = NOW()
  WHERE id = p_guest_id
    AND tier_source = 'auto';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_recalculate_guest_spending_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM recalculate_guest_spending_tier(NEW.guest_id);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM recalculate_guest_spending_tier(OLD.guest_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS visits_recalculate_guest_spending_tier ON visits;
DROP TRIGGER IF EXISTS visits_recalculate_guest_spending_tier ON visits;
CREATE TRIGGER visits_recalculate_guest_spending_tier
  AFTER INSERT OR UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_guest_spending_tier();

DROP TRIGGER IF EXISTS reservations_recalculate_guest_spending_tier ON reservations;
DROP TRIGGER IF EXISTS reservations_recalculate_guest_spending_tier ON reservations;
CREATE TRIGGER reservations_recalculate_guest_spending_tier
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_guest_spending_tier();

UPDATE guests
SET tier_source = 'auto'
WHERE tier_source IS NULL;

UPDATE guests
SET
  spending_tier = calculate_guest_spending_tier(id),
  tier_source = 'auto',
  tier_last_calculated_at = NOW()
WHERE tier_source = 'auto';


-- ################################################################
-- ## 20260602_saved_segments.sql
-- ################################################################

-- Saved filter segments for the Spending Insights report.
-- Stores reusable filter combinations (spending tier, tags, tag mode, date range).

CREATE TABLE IF NOT EXISTS saved_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT 'spending_insights',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_segments_page ON saved_segments(page);

ALTER TABLE saved_segments ENABLE ROW LEVEL SECURITY;

-- Public browser access for the guest book MVP (mirrors existing tables).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'saved_segments'
      AND policyname = 'Public full access - saved_segments'
  ) THEN
    DROP POLICY IF EXISTS "Public full access - saved_segments" ON saved_segments;
    CREATE POLICY "Public full access - saved_segments" ON saved_segments FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;


-- ################################################################
-- ## 20260705_01_membership_tables.sql
-- ################################################################

-- ============================================================
-- Membership merge: tables + business-rule functions
-- Applied to staging 2026-07-05 (verified). Run on prod at cutover.
-- ============================================================

CREATE TABLE IF NOT EXISTS members (
  id BIGINT PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  member_number VARCHAR NOT NULL UNIQUE,
  member_type VARCHAR NOT NULL CHECK (member_type IN ('Company','Family')),
  full_name VARCHAR NOT NULL,
  phone_number VARCHAR NOT NULL,
  guest_id UUID UNIQUE REFERENCES guests(id) ON DELETE SET NULL,
  total_stickers INTEGER NOT NULL DEFAULT 0 CHECK (total_stickers >= 0),
  available_vouchers INTEGER NOT NULL DEFAULT 0 CHECK (available_vouchers >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_transactions (
  id BIGINT PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  member_id BIGINT NOT NULL REFERENCES members(id),
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cashier_name VARCHAR,
  created_by UUID REFERENCES staff_users(id),
  transaction_amount NUMERIC NOT NULL CHECK (transaction_amount > 0),
  qualified_sticker BOOLEAN NOT NULL DEFAULT false,
  sticker_round INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_vouchers (
  id BIGINT PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  member_id BIGINT NOT NULL REFERENCES members(id),
  voucher_type VARCHAR NOT NULL,
  voucher_amount NUMERIC NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed BOOLEAN NOT NULL DEFAULT false,
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES staff_users(id)
);

CREATE INDEX IF NOT EXISTS idx_member_txn_member ON member_transactions (member_id);
CREATE INDEX IF NOT EXISTS idx_member_txn_date ON member_transactions (transaction_date);
CREATE INDEX IF NOT EXISTS idx_member_vouchers_member ON member_vouchers (member_id);
CREATE INDEX IF NOT EXISTS idx_member_vouchers_open ON member_vouchers (member_id) WHERE NOT redeemed;
CREATE INDEX IF NOT EXISTS idx_members_guest ON members (guest_id);

DROP TRIGGER IF EXISTS members_updated_at ON members;

CREATE TRIGGER members_updated_at BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- One visit can award at most one membership transaction (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS ux_member_txn_visit ON member_transactions (visit_id) WHERE visit_id IS NOT NULL;

-- Family : min 300k/visit = 1 sticker, 5 stickers = 100k voucher, max 15 stickers
-- Company: min 2M/visit  = 1 sticker, 5 stickers = 500k voucher, no cap
CREATE OR REPLACE FUNCTION add_member_transaction(
  p_member_id BIGINT,
  p_amount NUMERIC,
  p_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_cashier_name VARCHAR DEFAULT NULL,
  p_visit_id UUID DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
  v_min NUMERIC; v_voucher_amount NUMERIC; v_cap INTEGER;
  v_qualified BOOLEAN;
  v_reason TEXT;
  v_new_total INTEGER;
  v_round INTEGER;
  v_vouchers_to_issue INTEGER := 0;
  v_txn_id BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be positive';
  END IF;

  SELECT * INTO m FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member % not found', p_member_id;
  END IF;
  IF NOT m.is_active THEN
    RAISE EXCEPTION 'Member % is inactive', m.member_number;
  END IF;

  -- Same visit already recorded? Skip silently (idempotent).
  IF p_visit_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM member_transactions WHERE visit_id = p_visit_id
  ) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'visit_already_recorded');
  END IF;

  IF m.member_type = 'Family' THEN
    v_min := 300000; v_voucher_amount := 100000; v_cap := 15;
  ELSE
    v_min := 2000000; v_voucher_amount := 500000; v_cap := NULL;
  END IF;

  -- Why did (or didn't) this earn a sticker? (used for Indonesian toasts)
  IF p_amount < v_min THEN
    v_qualified := FALSE; v_reason := 'below_minimum';
  ELSIF v_cap IS NOT NULL AND m.total_stickers >= v_cap THEN
    v_qualified := FALSE; v_reason := 'cap_reached';
  ELSE
    v_qualified := TRUE; v_reason := 'earned';
  END IF;
  v_new_total := m.total_stickers + CASE WHEN v_qualified THEN 1 ELSE 0 END;
  v_round := CASE WHEN v_qualified THEN (m.total_stickers / 5) + 1 ELSE NULL END;

  IF v_qualified THEN
    v_vouchers_to_issue := (v_new_total / 5) - (m.total_stickers / 5);
  END IF;

  INSERT INTO member_transactions
    (member_id, visit_id, transaction_date, cashier_name, created_by, transaction_amount, qualified_sticker, sticker_round, notes)
  VALUES
    (p_member_id, p_visit_id, p_date, p_cashier_name, p_created_by, p_amount, v_qualified, v_round, p_notes)
  RETURNING id INTO v_txn_id;

  IF v_vouchers_to_issue > 0 THEN
    INSERT INTO member_vouchers (member_id, voucher_type, voucher_amount, issued_at)
    SELECT p_member_id, m.member_type, v_voucher_amount, p_date
    FROM generate_series(1, v_vouchers_to_issue);
  END IF;

  UPDATE members
  SET total_stickers = v_new_total,
      available_vouchers = available_vouchers + v_vouchers_to_issue
  WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'transaction_id', v_txn_id,
    'earned_sticker', v_qualified,
    'sticker_reason', v_reason,
    'new_total_stickers', v_new_total,
    'vouchers_issued', v_vouchers_to_issue,
    'at_sticker_cap', v_cap IS NOT NULL AND v_new_total >= v_cap
  );
END;
$$;

-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'redeem_member_voucher'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION redeem_member_voucher(
  p_voucher_id BIGINT,
  p_redeemed_by UUID DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_member_id BIGINT;
BEGIN
  UPDATE member_vouchers
  SET redeemed = true, redeemed_at = NOW(), redeemed_by = p_redeemed_by
  WHERE id = p_voucher_id AND redeemed = false
  RETURNING member_id INTO v_member_id;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Voucher not found or already redeemed';
  END IF;

  UPDATE members
  SET available_vouchers = GREATEST(available_vouchers - 1, 0)
  WHERE id = v_member_id;

  RETURN jsonb_build_object('ok', true, 'member_id', v_member_id);
END;
$$;


-- ################################################################
-- ## 20260705_02_fix_spending_tier_no_spend.sql
-- ################################################################

-- Fix (found during staging QA 5 Jul): guests with ZERO spend visits were
-- classified as medium_spender. BOOL_OR over zero rows = NULL, so the
-- "no spend -> no tier" early exit never fired. Bug exists in PROD's
-- function too. Run this on the new prod AFTER the schema + data copy.

-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'calculate_guest_spending_tier'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION public.calculate_guest_spending_tier(p_guest_id uuid)
 RETURNS TABLE(tier text, qualified_at timestamp with time zone)
 LANGUAGE plpgsql AS $function$
DECLARE
  v_latest_qualifying_date  TIMESTAMPTZ := NULL;
  v_stored_qualified_at     TIMESTAMPTZ := NULL;
  v_effective_qualified_at  TIMESTAMPTZ := NULL;
  v_has_any_spend           BOOLEAN     := FALSE;
  v_sticky_cutoff           TIMESTAMPTZ := NOW() - INTERVAL '90 days';
BEGIN
  SELECT high_spender_qualified_at INTO v_stored_qualified_at
  FROM guests WHERE id = p_guest_id;

  SELECT
    COALESCE(BOOL_OR(spend_amount > 0), FALSE),
    MAX(CASE
      WHEN spend_amount >= 1000000
        OR (spend_amount / NULLIF(pax, 0)) >= 300000
      THEN visit_date::TIMESTAMPTZ
      ELSE NULL
    END)
  INTO v_has_any_spend, v_latest_qualifying_date
  FROM visits
  WHERE guest_id = p_guest_id
    AND spend_amount IS NOT NULL AND spend_amount > 0
    AND pax IS NOT NULL AND pax > 0;

  IF NOT v_has_any_spend THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_effective_qualified_at := GREATEST(v_latest_qualifying_date, v_stored_qualified_at);

  IF v_effective_qualified_at IS NOT NULL AND v_effective_qualified_at >= v_sticky_cutoff THEN
    RETURN QUERY SELECT 'high_spender'::TEXT, v_effective_qualified_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'medium_spender'::TEXT, v_effective_qualified_at;
END;
$function$;

-- Re-classify guests wrongly marked with a tier despite zero spend history
UPDATE guests g
SET spending_tier = NULL, tier_last_calculated_at = NOW()
WHERE g.tier_source = 'auto'
  AND g.spending_tier IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM visits v
    WHERE v.guest_id = g.id AND v.spend_amount > 0 AND v.pax > 0
  );


-- ################################################################
-- ## 20260714_delete_void_feature.sql
-- ################################################################

-- ============================================================
-- Manager delete/void for reservations & walk-ins
-- ============================================================
-- Problem: staff double-input reservation + walk-in for the same guest.
-- Reservations already have a soft path (status = 'Cancelled'), but that
-- carries reporting meaning ("guest backed out") that we don't want to
-- conflate with "staff made a data-entry mistake". Walk-ins had NO removal
-- path at all — a mis-entered walk-in just sat in the list forever.
--
-- This migration:
--   1. Reconciles schema drift — visits.status/completed_at and
--      staff_users.role exist live in prod but were never captured in
--      schema.sql or a migration. Added here as IF NOT EXISTS so this is
--      safe to run on prod (no-op) and on any environment rebuilt from
--      schema.sql (creates them fresh).
--   2. Adds a distinct 'Deleted' reservation status + audit columns.
--   3. Adds void columns to visits (soft-delete, never a hard DELETE).
--   4. Excludes voided visits from spending-tier calculation so removing
--      a mistaken walk-in doesn't leave stale spend/tier data behind.
--
-- Nothing in this migration hard-deletes a row. Guest, visit, and
-- reservation records are never destroyed — only marked and hidden from
-- the default view. Manager-only in the UI (js/app.js), enforced by
-- currentStaffRole() checks; RLS is a known separate gap (see backlog).
-- ============================================================

-- NOTE: the schema-drift reconciliation for visits.status/completed_at and
-- staff_users.role that was originally planned here was DROPPED — live prod
-- already had both (confirmed via Supabase MCP list_tables before applying),
-- so it would have been a no-op. Skipped to keep this migration's applied
-- history matching exactly what was run.

-- ------------------------------------------------------------
-- 1. Reservations: 'Deleted' status + audit trail
-- ------------------------------------------------------------
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('Reserved','Confirmed','Arrived','Cancelled','Cancelled (No Show)','No Show','Completed','Deleted'));

CREATE INDEX IF NOT EXISTS idx_reservations_deleted_at ON reservations(deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Visits: void columns (soft-delete for walk-ins & arrival visits)
-- ------------------------------------------------------------
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_visits_voided_at ON visits(voided_at) WHERE voided_at IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Spending tier calc must ignore voided visits.
--
-- IMPORTANT: the original draft of this migration (and schema.sql at the
-- time) had an OLDER, simpler version of calculate_guest_spending_tier
-- (RETURNS TEXT, no sticky window). Applying that would have SILENTLY
-- REVERTED the real live function, which is a newer 90-day "sticky"
-- high-spender version (RETURNS TABLE(tier, qualified_at), reads/writes
-- guests.high_spender_qualified_at) that isn't in any prior migration —
-- more undocumented prod drift. Caught this via `apply_migration` erroring
-- on "cannot change return type of existing function" before anything was
-- committed (Postgres DDL is transactional, so the failed attempt was a
-- full no-op). Pulled the real definition via
-- `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = ...` and
-- patched ONLY the "AND voided_at IS NULL" line into it below — everything
-- else matches what was already live. schema.sql has been updated to
-- match this real function too (plus the previously-missing
-- guests.high_spender_qualified_at and guests.tag columns it depends on).
-- ------------------------------------------------------------
-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'calculate_guest_spending_tier'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION public.calculate_guest_spending_tier(p_guest_id uuid)
 RETURNS TABLE(tier text, qualified_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_latest_qualifying_date  TIMESTAMPTZ := NULL;
  v_stored_qualified_at     TIMESTAMPTZ := NULL;
  v_effective_qualified_at  TIMESTAMPTZ := NULL;
  v_has_any_spend           BOOLEAN     := FALSE;
  v_sticky_cutoff           TIMESTAMPTZ := NOW() - INTERVAL '90 days';
BEGIN
  SELECT high_spender_qualified_at INTO v_stored_qualified_at
  FROM guests WHERE id = p_guest_id;

  SELECT
    COALESCE(BOOL_OR(spend_amount > 0), FALSE),
    MAX(CASE
      WHEN spend_amount >= 1000000
        OR (spend_amount / NULLIF(pax, 0)) >= 300000
      THEN visit_date::TIMESTAMPTZ
      ELSE NULL
    END)
  INTO v_has_any_spend, v_latest_qualifying_date
  FROM visits
  WHERE guest_id = p_guest_id
    AND spend_amount IS NOT NULL AND spend_amount > 0
    AND pax IS NOT NULL AND pax > 0
    AND voided_at IS NULL;

  IF NOT v_has_any_spend THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_effective_qualified_at := GREATEST(v_latest_qualifying_date, v_stored_qualified_at);

  IF v_effective_qualified_at IS NOT NULL AND v_effective_qualified_at >= v_sticky_cutoff THEN
    RETURN QUERY SELECT 'high_spender'::TEXT, v_effective_qualified_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'medium_spender'::TEXT, v_effective_qualified_at;
END;
$function$;

-- ------------------------------------------------------------
-- 4. get_guest_visit_summary (used by the Guests list page for visit count
-- / last visit date) also needs to exclude voided visits — otherwise a
-- voided duplicate still inflates a guest's visit count and last-visit date
-- even though it's hidden from the Walk-In Log and Guest Profile. This RPC
-- pre-dates this migration and was never in schema.sql or any prior
-- migration file (found live via pg_get_functiondef while chasing this bug)
-- — noted here rather than backfilling its original migration history.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_guest_visit_summary()
 RETURNS TABLE(guest_id uuid, visit_count bigint, last_visit_date date)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT guest_id, COUNT(*) AS visit_count, MAX(visit_date) AS last_visit_date
  FROM visits
  WHERE guest_id IS NOT NULL
    AND voided_at IS NULL
  GROUP BY guest_id;
$function$;

-- ------------------------------------------------------------
-- Verification queries (run manually, not part of migration):
--   SELECT conname FROM pg_constraint WHERE conrelid = 'visits'::regclass;
--   SELECT conname FROM pg_constraint WHERE conrelid = 'reservations'::regclass;
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'visits';
-- ------------------------------------------------------------


-- ################################################################
-- ## 20260717_favorite_menu.sql
-- ################################################################

-- ============================================================
-- Favorite Menu / Recent Order
-- ============================================================
-- Adds a free-text field on guests to record what a guest typically
-- orders. Captured optionally at Complete Visit time (spend input
-- screen); overwritten each time staff enter a new value there.
-- Displayed on dashboard reservation/walk-in rows only once a guest
-- has more than 1 visit (first visit has no "recent order" yet).
--
-- Safe to run any time: additive column, nullable, no default,
-- no backfill, no trigger changes. Does not touch existing data.
-- ============================================================

ALTER TABLE guests ADD COLUMN IF NOT EXISTS favorite_menu TEXT;

COMMENT ON COLUMN guests.favorite_menu IS
  'Free-text favorite menu / recent order, staff-entered at visit completion. Overwritten on each new entry (most recent wins).';


-- ################################################################
-- ## 20260718_broadcast_tables.sql
-- ################################################################

-- Broadcast feature migration — APPLIED TO PROD YOUR_SUPABASE_PROJECT_REF on 2026-07-18
-- (via MCP apply_migration: broadcast_wa_templates_outreach_log)
-- Verified after apply: 6 templates seeded, wa_outreach_log empty, guests.do_not_contact added (345 guests, all false).
-- All additive; safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

create table if not exists wa_templates (
  key text primary key,
  label text not null,
  body text not null check (length(trim(body)) > 0),
  is_broadcast boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists wa_outreach_log (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests(id) on delete cascade,
  template_key text not null,
  is_broadcast boolean not null default false,
  sent_at timestamptz not null default now(),
  sent_by text
);

create index if not exists idx_wa_outreach_log_guest_sent
  on wa_outreach_log (guest_id, sent_at desc);

alter table guests add column if not exists do_not_contact boolean not null default false;

insert into wa_templates (key, label, body, is_broadcast) values
  ('thank_you', 'Thank You (setelah kunjungan)',
   'Terima kasih atas kunjungan bapak/ibu di resto {resto} hari ini. Kami nantikan kedatangannya kembali di lain waktu!',
   false),
  ('follow_up', 'Follow Up (konfirmasi reservasi)',
   E'Halo {nama}!\n\nKami dari {resto} ingin mengonfirmasi reservasi Bapak/Ibu:\n\nTanggal: {tanggal}\nJam: {jam}\nJumlah: {pax} orang\n\nKami nantikan kehadiran dari anda di {resto}. Terima kasih!',
   false),
  ('at_risk', 'Broadcast: At Risk (lama tidak berkunjung)',
   'Halo {nama}! Sudah lama kami tidak melihat Bapak/Ibu di {resto} — kami rindu! Kami tunggu kedatangannya kembali ya. Terima kasih!',
   true),
  ('medium_spender', 'Broadcast: Medium Spender',
   'Halo {nama}! Terima kasih sudah menjadi pelanggan setia {resto}. Kami tunggu kunjungan berikutnya ya!',
   true),
  ('high_spender', 'Broadcast: High Spender',
   'Halo {nama}! Terima kasih sudah menjadi pelanggan istimewa {resto}. Suatu kehormatan bagi kami untuk selalu melayani Bapak/Ibu. Sampai jumpa di kunjungan berikutnya!',
   true),
  ('tag_default', 'Broadcast: Template Dasar Tag',
   'Halo {nama}! Ada info spesial dari {resto} untuk Bapak/Ibu. [ganti dengan isi promo]',
   true)
on conflict (key) do nothing;


-- ################################################################
-- ## 20260719_public_reservation.sql
-- ################################################################

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


-- ################################################################
-- ## 20260721_01_settings_feature.sql
-- ################################################################

-- ============================================================
-- BLUE HERON — SETTINGS FEATURE
-- Run on STAGING first, then prod at the next cutover window.
--
-- What this does:
--  1. Seeds app_settings with `spending_tier` and `membership` keys
--     (same shape as Sirkel/gms-proto). Idempotent: existing keys kept.
--  2. New `featured_dishes` table for the Reservation Configuration
--     subpage (signature dishes / chef recommendations shown on the
--     public reserve page).
--  3. Storage bucket `dish-images` for staff-uploaded dish photos.
--  4. Rewrites calculate_guest_spending_tier() to read thresholds
--     from app_settings instead of the hardcoded 1jt / 300k / 90 days.
--  5. Rewrites add_member_transaction() to read membership rules
--     from app_settings instead of hardcoded Family/Company numbers.
--
-- Defaults are identical to the current hardcoded values, so applying
-- this migration alone changes NO behavior until a manager edits
-- Settings. Safe to re-run (CREATE OR REPLACE / IF NOT EXISTS /
-- ON CONFLICT DO NOTHING everywhere).
-- ============================================================

-- ---------- 1. SETTINGS SEEDS ----------
-- app_settings + get_setting() already exist (20260719_public_reservation).
insert into app_settings (key, value) values
  ('spending_tier', '{"high_visit_total": 1000000, "high_per_pax": 300000, "sticky_days": 90}'),
  ('membership', '{
     "stickers_per_voucher": 5,
     "Family":  {"label": "Family Card",  "min_spend": 300000,  "voucher_amount": 100000, "cap": 15},
     "Company": {"label": "Company Card", "min_spend": 2000000, "voucher_amount": 500000, "cap": null}
   }')
on conflict (key) do nothing;

-- ---------- 2. FEATURED DISHES ----------
create table if not exists featured_dishes (
  id UUID primary key default gen_random_uuid(),
  name TEXT not null,
  description TEXT,
  image_url TEXT,
  category TEXT not null check (category in ('signature', 'chef_recommendation')),
  display_order INTEGER not null default 0,
  is_active BOOLEAN not null default true,
  created_at TIMESTAMPTZ not null default now(),
  updated_at TIMESTAMPTZ not null default now()
);

create index if not exists idx_featured_dishes_category
  on featured_dishes (category, display_order);

drop trigger if exists featured_dishes_updated_at on featured_dishes;
DROP TRIGGER IF EXISTS featured_dishes_updated_at ON featured_dishes;
CREATE TRIGGER featured_dishes_updated_at
  before update on featured_dishes
  for each row execute function update_updated_at();

-- Same MVP security model as the rest of the schema (public policies,
-- staff auth handled app-side via staff_users PIN). Known debt — will be
-- tightened together with the other tables when we move to real auth.
alter table featured_dishes enable row level security;
drop policy if exists "Public full access - featured_dishes" on featured_dishes;
DROP POLICY IF EXISTS "Public full access - featured_dishes" ON featured_dishes;
CREATE POLICY "Public full access - featured_dishes" ON featured_dishes for all
  using (true)
  with check (true);

-- ---------- 3. STORAGE BUCKET FOR DISH IMAGES ----------
-- Public bucket: reserve.html shows the images to guests without auth.
-- 2 MB limit + image-only MIME types enforced DB-side as a guardrail
-- (the app also compresses/validates before upload).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-images', 'dish-images', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Public read - dish-images" on storage.objects;
DROP POLICY IF EXISTS "Public read - dish-images" ON storage.objects;
CREATE POLICY "Public read - dish-images" ON storage.objects for select
  using (bucket_id = 'dish-images');

drop policy if exists "Public write - dish-images" on storage.objects;
DROP POLICY IF EXISTS "Public write - dish-images" ON storage.objects;
CREATE POLICY "Public write - dish-images" ON storage.objects for insert
  with check (bucket_id = 'dish-images');

drop policy if exists "Public update - dish-images" on storage.objects;
DROP POLICY IF EXISTS "Public update - dish-images" ON storage.objects;
CREATE POLICY "Public update - dish-images" ON storage.objects for update
  using (bucket_id = 'dish-images');

drop policy if exists "Public delete - dish-images" on storage.objects;
DROP POLICY IF EXISTS "Public delete - dish-images" ON storage.objects;
CREATE POLICY "Public delete - dish-images" ON storage.objects for delete
  using (bucket_id = 'dish-images');

-- ---------- 4. SPENDING TIER READS SETTINGS ----------
-- Same logic as before; only the three constants now come from
-- app_settings.spending_tier (falling back to the old hardcoded values).
-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'calculate_guest_spending_tier'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION calculate_guest_spending_tier(p_guest_id UUID)
 RETURNS TABLE(tier text, qualified_at timestamptz) AS $$
DECLARE
  v_cfg                     JSONB       := coalesce(get_setting('spending_tier'), '{}'::jsonb);
  v_high_total              NUMERIC     := coalesce((v_cfg->>'high_visit_total')::numeric, 1000000);
  v_high_per_pax            NUMERIC     := coalesce((v_cfg->>'high_per_pax')::numeric, 300000);
  v_sticky_days             INTEGER     := coalesce((v_cfg->>'sticky_days')::integer, 90);
  v_latest_qualifying_date  TIMESTAMPTZ := NULL;
  v_stored_qualified_at     TIMESTAMPTZ := NULL;
  v_effective_qualified_at  TIMESTAMPTZ := NULL;
  v_has_any_spend           BOOLEAN     := FALSE;
  v_sticky_cutoff           TIMESTAMPTZ;
BEGIN
  v_sticky_cutoff := NOW() - make_interval(days => v_sticky_days);

  SELECT high_spender_qualified_at INTO v_stored_qualified_at
  FROM guests WHERE id = p_guest_id;

  SELECT
    COALESCE(BOOL_OR(spend_amount > 0), FALSE),
    MAX(CASE
      WHEN spend_amount >= v_high_total
        OR (spend_amount / NULLIF(pax, 0)) >= v_high_per_pax
      THEN visit_date::TIMESTAMPTZ
      ELSE NULL
    END)
  INTO v_has_any_spend, v_latest_qualifying_date
  FROM visits
  WHERE guest_id = p_guest_id
    AND spend_amount IS NOT NULL AND spend_amount > 0
    AND pax IS NOT NULL AND pax > 0
    AND voided_at IS NULL;

  IF NOT v_has_any_spend THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_effective_qualified_at := GREATEST(v_latest_qualifying_date, v_stored_qualified_at);

  IF v_effective_qualified_at IS NOT NULL AND v_effective_qualified_at >= v_sticky_cutoff THEN
    RETURN QUERY SELECT 'high_spender'::TEXT, v_effective_qualified_at;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'medium_spender'::TEXT, v_effective_qualified_at;
END;
$$ LANGUAGE plpgsql;

-- ---------- recalculate_guest_spending_tier: PAIRED WITH THE ABOVE ----------
-- This MUST stay directly beneath the last definition of
-- calculate_guest_spending_tier, and must move with it if that one ever moves.
-- Everything after this point may write to visits or reservations, and any
-- such write fires a trigger that calls this function. If the two disagree
-- about the return shape at that moment, the write fails with a
-- guests_spending_tier_check violation on a real guest row.
--
-- The full account of the two bugs this fixes is in the 20260823 section
-- further down, where they were originally found.
create or replace function recalculate_guest_spending_tier(p_guest_id uuid)
returns void as $$
declare
  v_tier         text;
  v_qualified_at timestamptz;
begin
  if p_guest_id is null then
    return;
  end if;

  -- FROM, not SELECT ... INTO: calculate_guest_spending_tier returns a
  -- TABLE(tier, qualified_at). Assigning the call to a single text variable
  -- is what produced `(,)`. Do not "simplify" this back.
  select t.tier, t.qualified_at
    into v_tier, v_qualified_at
  from calculate_guest_spending_tier(p_guest_id) as t;

  update guests
  set spending_tier            = v_tier,
      tier_source              = 'auto',
      tier_last_calculated_at  = now(),
      high_spender_qualified_at = v_qualified_at
  where id = p_guest_id
    and tier_source = 'auto';
end;
$$ language plpgsql;


-- ---------- 5. MEMBERSHIP RULES READ SETTINGS ----------
-- Same contract and idempotency as 20260705_membership_merge; only the
-- Family/Company constants and the 5-stickers-per-voucher divisor now
-- come from app_settings.membership.
-- Cap semantics: key present with null = no cap (manager cleared it);
-- key absent entirely = old default (Family 15, Company none).
CREATE OR REPLACE FUNCTION add_member_transaction(
  p_member_id BIGINT,
  p_amount NUMERIC,
  p_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_cashier_name VARCHAR DEFAULT NULL,
  p_visit_id UUID DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  m RECORD;
  v_cfg JSONB;
  v_type_cfg JSONB;
  v_spv INTEGER;
  v_min NUMERIC; v_voucher_amount NUMERIC; v_cap INTEGER;
  v_qualified BOOLEAN;
  v_reason TEXT;
  v_new_total INTEGER;
  v_round INTEGER;
  v_vouchers_to_issue INTEGER := 0;
  v_txn_id BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be positive';
  END IF;

  SELECT * INTO m FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member % not found', p_member_id;
  END IF;
  IF NOT m.is_active THEN
    RAISE EXCEPTION 'Member % is inactive', m.member_number;
  END IF;

  -- Same visit already recorded? Skip silently (idempotent).
  IF p_visit_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM member_transactions WHERE visit_id = p_visit_id
  ) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'visit_already_recorded');
  END IF;

  -- Business rules from settings, defaults = pre-migration hardcoded values
  v_cfg := coalesce(get_setting('membership'), '{}'::jsonb);
  v_spv := coalesce((v_cfg->>'stickers_per_voucher')::integer, 5);
  IF v_spv < 1 THEN v_spv := 5; END IF;
  v_type_cfg := v_cfg->m.member_type;

  IF m.member_type = 'Family' THEN
    v_min            := coalesce((v_type_cfg->>'min_spend')::numeric, 300000);
    v_voucher_amount := coalesce((v_type_cfg->>'voucher_amount')::numeric, 100000);
    v_cap            := CASE WHEN v_type_cfg IS NOT NULL AND v_type_cfg ? 'cap'
                             THEN (v_type_cfg->>'cap')::integer
                             ELSE 15 END;
  ELSE
    v_min            := coalesce((v_type_cfg->>'min_spend')::numeric, 2000000);
    v_voucher_amount := coalesce((v_type_cfg->>'voucher_amount')::numeric, 500000);
    v_cap            := CASE WHEN v_type_cfg IS NOT NULL AND v_type_cfg ? 'cap'
                             THEN (v_type_cfg->>'cap')::integer
                             ELSE NULL END;
  END IF;

  -- Why did (or didn't) this earn a sticker? (used for Indonesian toasts)
  IF p_amount < v_min THEN
    v_qualified := FALSE; v_reason := 'below_minimum';
  ELSIF v_cap IS NOT NULL AND m.total_stickers >= v_cap THEN
    v_qualified := FALSE; v_reason := 'cap_reached';
  ELSE
    v_qualified := TRUE; v_reason := 'earned';
  END IF;
  v_new_total := m.total_stickers + CASE WHEN v_qualified THEN 1 ELSE 0 END;
  v_round := CASE WHEN v_qualified THEN (m.total_stickers / v_spv) + 1 ELSE NULL END;

  IF v_qualified THEN
    v_vouchers_to_issue := (v_new_total / v_spv) - (m.total_stickers / v_spv);
  END IF;

  INSERT INTO member_transactions
    (member_id, visit_id, transaction_date, cashier_name, created_by, transaction_amount, qualified_sticker, sticker_round, notes)
  VALUES
    (p_member_id, p_visit_id, p_date, p_cashier_name, p_created_by, p_amount, v_qualified, v_round, p_notes)
  RETURNING id INTO v_txn_id;

  IF v_vouchers_to_issue > 0 THEN
    INSERT INTO member_vouchers (member_id, voucher_type, voucher_amount, issued_at)
    SELECT p_member_id, m.member_type, v_voucher_amount, p_date
    FROM generate_series(1, v_vouchers_to_issue);
  END IF;

  UPDATE members
  SET total_stickers = v_new_total,
      available_vouchers = available_vouchers + v_vouchers_to_issue
  WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'transaction_id', v_txn_id,
    'earned_sticker', v_qualified,
    'sticker_reason', v_reason,
    'new_total_stickers', v_new_total,
    'vouchers_issued', v_vouchers_to_issue,
    'at_sticker_cap', v_cap IS NOT NULL AND v_new_total >= v_cap
  );
END;
$$;

-- ---------- 6. RECALC ALL TIERS (Settings page "apply now" button) ----------
-- Only touches tier_source = 'auto' guests; manual overrides untouched.
create or replace function public.recalc_all_tiers()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
  g record;
begin
  for g in select id from guests where tier_source = 'auto' loop
    perform recalculate_guest_spending_tier(g.id);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('recalculated', v_count);
end;
$$;


-- ################################################################
-- ## 20260721_02_seed_featured_dishes.sql
-- ################################################################

-- ============================================================
-- BLUE HERON — SEED FEATURED DISHES
-- Run AFTER 20260721_settings_feature.sql (needs the table).
--
-- Inserts the two dishes currently hardcoded on reserve.html so
-- managers can edit/hide them from Settings > Reservation
-- Configuration. Once these rows exist, the public page renders
-- from the database and the static fallback is no longer used.
--
-- image_url is a relative path into the deployed site's assets/
-- folder (works on your-site.example for both reserve.html
-- and the staff app, which live at the same root). Replacing a
-- photo from Settings uploads to the dish-images bucket instead.
--
-- Idempotent: skips any dish whose name already exists.
-- ============================================================

insert into featured_dishes (name, description, image_url, category, display_order, is_active)
select * from (values
  (
    'Sirloin Wagyu MB5',
    'Grilled sirloin wagyu marbling 5, disajikan dengan garlic confit, sauteed mushroom, pilihan kentang pendamping, sayuran dan saus.',
    'assets/sirloin-wagyu-web.jpg',
    'signature',
    1,
    true
  ),
  (
    'Butter Salmon',
    'Grilled Norwegian Salmon yang dimasak dengan bawang merah, bawang putih, cabai pilihan, smoked beef dan butter.',
    'assets/butter-salmon-web.jpg',
    'chef_recommendation',
    1,
    true
  )
) as seed(name, description, image_url, category, display_order, is_active)
where not exists (
  select 1 from featured_dishes fd where fd.name = seed.name
);


-- ################################################################
-- ## 20260722_landing_page_config.sql
-- ################################################################

-- ============================================================
-- BLUE HERON — SHARED MENU CONFIG (reserve.html + landing page)
-- Run on STAGING first, then prod at the next cutover window.
--
-- What this does:
--  1. Adds 'best_seller' as a valid featured_dishes category, on top
--     of the existing 'signature' / 'chef_recommendation' used by
--     reserve.html (20260721_settings_feature.sql).
--  2. Seeds app_settings with a `full_menu` key holding the "Full Menu"
--     link — shown on BOTH reserve.html and the landing page.
--
-- Revised 2026-07-22: originally this was going to be a separate
-- "Landing Page Config" settings page with its own copy of the dishes.
-- Rere caught that this just duplicates Reservation Configuration for
-- no reason — there's ONE set of featured dishes and ONE full-menu
-- link, shared by both public pages. So:
--   - 'signature' and 'chef_recommendation' dishes are the SAME rows
--     reserve.html already shows. No change there.
--   - 'best_seller' is a new 3rd category, shown on BOTH reserve.html
--     and the landing page now (reserve.html's dish query is updated
--     to include it — see js/app.js history / reserve.html directly).
--   - `full_menu` replaces reserve.html's hardcoded Google Drive link
--     AND drives the landing page's "View Full Menu" button. One
--     field to edit, both pages update.
--   - Managed from ONE settings page in the staff app: Settings >
--     Reservation Configuration (relabeled "Menu & Dishes").
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- 1. ADD 'best_seller' CATEGORY ----------
-- Drops whatever the existing category check constraint is actually named
-- (found dynamically, not guessed) so we never end up with two conflicting
-- CHECK constraints on the same column — that would silently keep blocking
-- 'best_seller' inserts even after this migration "succeeds".
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'featured_dishes'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%category%'
  loop
    execute format('alter table featured_dishes drop constraint %I', c.conname);
  end loop;
end $$;

alter table featured_dishes add constraint featured_dishes_category_check
  check (category in ('signature', 'chef_recommendation', 'best_seller'));

-- ---------- 2. SHARED FULL MENU LINK ----------
-- Seeded with the link already hardcoded on reserve.html today, so the
-- landing page starts with a working button instead of showing "not set
-- yet" until a manager visits Settings. Change it any time from
-- Settings > Menu & Dishes — updates both public pages at once.
insert into app_settings (key, value) values
  ('full_menu', '{"url": "https://drive.google.com/file/d/1A2M5iYbCJC_H9hD-793q4k3O49TpAsBH/view"}')
on conflict (key) do nothing;


-- ################################################################
-- ## 20260726_dashboard_reports.sql
-- ################################################################

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


-- ################################################################
-- ## 20260726_first_timer_template.sql
-- ################################################################

-- ============================================================
-- BLUE HERON — "first_timer" BROADCAST TEMPLATE
-- Prod: YOUR_SUPABASE_PROJECT_REF
-- Date: 2026-07-26
--
-- WHY: the owner dashboard surfaces "N tamu baru yang belum kembali"
-- and its action now hands that exact population to Broadcast
-- (bcOpenFirstTimers in js/broadcast.js). None of the existing
-- templates fit that audience:
--
--   at_risk        says "sudah lama tidak berkunjung" — wrong for a
--                  guest who ate here five days ago
--   medium/high_   thanks them for being a loyal regular — wrong for
--   spender        someone who has visited exactly once
--
-- Sending either of those to a first-timer reads as a careless mass
-- mail, which is worse than sending nothing. Hence a template written
-- for the audience: it leads with the guest's actual visit date so it
-- cannot feel like a blast, and it never implies a long absence.
--
-- Placeholders used are all valid for the broadcast class
-- (BC_PLACEHOLDERS.broadcast): {nama}, {resto}, {tanggal_terakhir}.
-- No emoji, per the 2026-07-17 decision (the front-desk PC corrupts
-- them into "?").
--
-- Idempotent: on conflict do nothing, so re-running never overwrites
-- wording staff have since edited in the template editor.
-- ============================================================

insert into public.wa_templates (key, label, body, is_broadcast)
values (
  'first_timer',
  'Broadcast: Tamu Baru (belum kembali)',
  'Halo {nama}! Terima kasih sudah berkunjung ke {resto} pada ' ||
  '{tanggal_terakhir}. Senang sekali bisa melayani Bapak/Ibu, ' ||
  'dan kami harap masakan kami berkesan. ' ||
  'Kami tunggu kunjungan berikutnya ya!',
  true
)
on conflict (key) do nothing;


-- ################################################################
-- ## 20260731_01_voucher_code_expiry.sql
-- ################################################################

-- ============================================================
-- Voucher card: voucher_code + expires_at
-- Date: 2026-07-31
-- Target: prod YOUR_SUPABASE_PROJECT_REF (additive, idempotent)
--
-- What this does
--   1. Adds member_vouchers.voucher_code (unique) and .expires_at
--   2. Trigger fills both on INSERT, so add_member_transaction()
--      does NOT need to be touched (it inserts vouchers directly)
--   3. Backfills existing rows
--   4. redeem_member_voucher() refuses expired vouchers unless the
--      caller explicitly passes p_allow_expired := true (manager override)
--   5. Seeds membership.voucher_validity_days = 90 in app_settings
--
-- Code format: BH-<member suffix>-<voucher id, 4 digits>
--   member BFC-F21, voucher id 7  ->  BH-F21-0007
--   Deterministic, human-readable, unique, and lets staff trace a code
--   a guest sends back to both the member and the exact voucher row.
--
-- SAFETY: run on staging first. Nothing here drops or rewrites data.
-- ============================================================

BEGIN;

-- ── 1. Columns ──────────────────────────────────────────────
ALTER TABLE member_vouchers ADD COLUMN IF NOT EXISTS voucher_code varchar(24);
ALTER TABLE member_vouchers ADD COLUMN IF NOT EXISTS expires_at   timestamptz;

-- ── 2. Validity setting (default 90 days) ───────────────────
-- Merged into the existing 'membership' key so the Settings page
-- keeps working with a single row.
INSERT INTO app_settings (key, value)
VALUES ('membership', jsonb_build_object('voucher_validity_days', 90))
ON CONFLICT (key) DO UPDATE
SET value = app_settings.value
          || jsonb_build_object(
               'voucher_validity_days',
               coalesce(app_settings.value->'voucher_validity_days', to_jsonb(90))
             );

-- ── 3. Helpers ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION voucher_validity_days()
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT GREATEST(
    coalesce((get_setting('membership')->>'voucher_validity_days')::integer, 90),
    1
  );
$$;

CREATE OR REPLACE FUNCTION build_voucher_code(p_member_number text, p_voucher_id bigint)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'BH-'
      || upper(coalesce(
           nullif(regexp_replace(coalesce(p_member_number, ''), '^.*-', ''), ''),
           'XXX'))
      || '-'
      || lpad(p_voucher_id::text, 4, '0');
$$;

-- ── 4. Trigger: fill code + expiry on insert ────────────────
-- id is an IDENTITY column, so NEW.id is already populated in a
-- BEFORE INSERT trigger. Both fields are only set when NULL, so an
-- explicit value (e.g. a data repair) is always respected.
CREATE OR REPLACE FUNCTION set_member_voucher_defaults()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_member_number text;
  v_days integer;
BEGIN
  IF NEW.voucher_code IS NULL THEN
    SELECT member_number INTO v_member_number FROM members WHERE id = NEW.member_id;
    NEW.voucher_code := build_voucher_code(v_member_number, NEW.id);
  END IF;

  IF NEW.expires_at IS NULL THEN
    v_days := voucher_validity_days();
    -- End of the last valid day, Jakarta time, so a voucher is never
    -- "expired" mid-afternoon on the day it says it expires.
    NEW.expires_at := ((
      ((NEW.issued_at AT TIME ZONE 'Asia/Jakarta')::date + v_days)::timestamp
      + time '23:59:59'
    ) AT TIME ZONE 'Asia/Jakarta');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_voucher_defaults ON member_vouchers;
DROP TRIGGER IF EXISTS trg_member_voucher_defaults ON member_vouchers;
CREATE TRIGGER trg_member_voucher_defaults
  BEFORE INSERT ON member_vouchers
  FOR EACH ROW EXECUTE FUNCTION set_member_voucher_defaults();

-- ── 5. Backfill existing rows ───────────────────────────────
UPDATE member_vouchers v
SET voucher_code = build_voucher_code(m.member_number, v.id)
FROM members m
WHERE m.id = v.member_id
  AND v.voucher_code IS NULL;

-- Redeemed vouchers: historical expiry, no one is affected.
UPDATE member_vouchers
SET expires_at = ((
      ((issued_at AT TIME ZONE 'Asia/Jakarta')::date + voucher_validity_days())::timestamp
      + time '23:59:59'
    ) AT TIME ZONE 'Asia/Jakarta')
WHERE expires_at IS NULL
  AND redeemed = true;

-- Outstanding vouchers: GUARDRAIL — never let a voucher a guest is
-- already holding expire the moment this migration ships. Anything
-- that would land in the past gets at least 30 more days.
UPDATE member_vouchers
SET expires_at = GREATEST(
      ((
        ((issued_at AT TIME ZONE 'Asia/Jakarta')::date + voucher_validity_days())::timestamp
        + time '23:59:59'
      ) AT TIME ZONE 'Asia/Jakarta'),
      now() + interval '30 days'
    )
WHERE expires_at IS NULL
  AND redeemed = false;

-- ── 6. Unique index on the code ─────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS member_vouchers_code_key
  ON member_vouchers (voucher_code);

-- ── 7. Redeem guard ─────────────────────────────────────────
-- The old 2-arg function MUST be dropped: keeping it alongside the new
-- 3-arg one makes a 2-arg call ambiguous ("function is not unique") —
-- the same overload trap that bit add_member_transaction in July.
-- Calls with only 2 args still work: p_allow_expired defaults to false,
-- so an un-updated frontend can never silently redeem an expired voucher.
DROP FUNCTION IF EXISTS public.redeem_member_voucher(bigint, uuid);

-- round 4: this function is redefined below with a different shape, so the
-- previous version must go first. CREATE OR REPLACE cannot change a return
-- type or argument list. No CASCADE: nothing depends on these directly
-- (trigger functions CALL them, and Postgres does not track that as a
-- dependency), so a plain drop is safe here.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'redeem_member_voucher'
  loop execute 'drop function if exists ' || r.sig; end loop;
end $$;

CREATE OR REPLACE FUNCTION public.redeem_member_voucher(
  p_voucher_id bigint,
  p_redeemed_by uuid DEFAULT NULL::uuid,
  p_allow_expired boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql AS $function$
DECLARE
  v_member_id BIGINT;
  v_expires   timestamptz;
  v_redeemed  boolean;
BEGIN
  SELECT member_id, expires_at, redeemed
    INTO v_member_id, v_expires, v_redeemed
  FROM member_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND';
  END IF;
  IF v_redeemed THEN
    RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED';
  END IF;
  IF NOT p_allow_expired AND v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'VOUCHER_EXPIRED';
  END IF;

  -- Still conditional on redeemed = false: the row lock above plus this
  -- guard keep a double-click from decrementing the counter twice.
  UPDATE member_vouchers
  SET redeemed = true, redeemed_at = NOW(), redeemed_by = p_redeemed_by
  WHERE id = p_voucher_id AND redeemed = false
  RETURNING member_id INTO v_member_id;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED';
  END IF;

  UPDATE members
  SET available_vouchers = GREATEST(available_vouchers - 1, 0)
  WHERE id = v_member_id;

  RETURN jsonb_build_object(
    'ok', true,
    'member_id', v_member_id,
    'was_expired', v_expires IS NOT NULL AND v_expires < now()
  );
END;
$function$;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────
-- SELECT id, member_id, voucher_code, voucher_amount, issued_at, expires_at, redeemed
-- FROM member_vouchers ORDER BY id;


-- ################################################################
-- ## 20260731_02_wa_template.sql
-- ################################################################

-- ============================================================
-- Voucher card: WhatsApp template seed
-- Date: 2026-07-31
--
-- Transactional (is_broadcast = false): the guest earned this voucher,
-- so it is immune to do_not_contact and never counts towards the
-- 5-day resend warning — same class as thank_you / follow_up.
--
-- Idempotent: an existing row is left ALONE, so a template staff have
-- already edited is never overwritten by a re-run.
-- ============================================================

INSERT INTO wa_templates (key, label, body, is_broadcast, updated_at)
VALUES (
  'voucher_ready',
  'Voucher (kirim ke member)',
  'Halo {nama}!' || chr(10) || chr(10) ||
  'Selamat, Bapak/Ibu mendapatkan voucher belanja {nominal} dari {resto} sebagai apresiasi atas kunjungan yang selalu setia.' || chr(10) || chr(10) ||
  'Kode voucher: {kode}' || chr(10) ||
  'Berlaku sampai: {berlaku}' || chr(10) || chr(10) ||
  'Cukup tunjukkan voucher ini kepada staf kami saat pembayaran. Kami tunggu kunjungan berikutnya!',
  false,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- Verify:
-- SELECT key, is_broadcast, left(body, 40) FROM wa_templates ORDER BY key;


-- ################################################################
-- ## 20260801_01_broadcast_campaigns.sql
-- ################################################################

-- ============================================================
-- BROADCAST CAMPAIGNS + EFFECTIVENESS REPORTING
-- 2026-08-01. Additive only: 2 new tables, 2 nullable columns.
-- No existing row is rewritten, no function/trigger touched.
-- Safe to run during opening hours.
-- ============================================================
--
-- WHY THIS EXISTS
-- ---------------
-- wa_outreach_log already records every WA click (guest_id,
-- template_key, is_broadcast, sent_at, sent_by). What it does NOT
-- record is WHAT was sent and WHICH BLAST it belonged to.
--
-- Templates are edited in place. If ops edits `medium_spender` to
-- offer a burger in August and a steak in September, both blasts
-- land in the log as "medium_spender" and are indistinguishable
-- forever. Marketing's actual question — "did the burger blast
-- work better than the steak blast?" — is unanswerable.
--
-- So: a campaign is created BEFORE sending, freezing the message
-- text and the eligible audience. Each send then points at it.
--
-- The audience snapshot is the part that makes the report honest.
-- Without it we could only say "48% of messaged guests came back",
-- which sounds great until you notice high spenders come back at
-- 40% anyway. With it we can say "48% of the ones we messaged vs
-- 16% of the identical guests we did not" — the same segment, the
-- same fortnight, the only difference being the message.
-- ============================================================

begin;

-- ── 1. Campaigns ─────────────────────────────────────────────
create table if not exists wa_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  -- What ops was actually promoting, in their own words
  -- ("Promo burger beli 1 gratis 1"). Free text on purpose: the
  -- report is read by humans, not joined on.
  note          text,
  -- Snapshot of the filter that produced the audience
  segment       text        not null,
  segment_tag   text,
  template_key  text        not null,
  -- FROZEN copy of the template body at campaign start. The
  -- wa_templates row may be edited tomorrow; this must not change.
  message_body  text        not null,
  started_at    timestamptz not null default now(),
  -- null = still sending. Set when ops finishes, or automatically
  -- when the next campaign starts (only one open at a time).
  ended_at      timestamptz,
  created_by    text
);

-- ── 2. Audience snapshot (the control group) ─────────────────
-- Every guest who MATCHED the filter at campaign start, whether or
-- not they ended up being messaged. Rows never sent become the
-- comparison group in the report.
--
-- has_wa is stored rather than derived later: a guest whose phone
-- number gets fixed next week was still unreachable during the
-- campaign, and the comparison must be between guests who were
-- equally reachable at the time.
create table if not exists wa_campaign_audience (
  campaign_id uuid    not null references wa_campaigns(id) on delete cascade,
  guest_id    uuid    not null references guests(id)       on delete cascade,
  has_wa      boolean not null default false,
  primary key (campaign_id, guest_id)
);

-- ── 3. Link the existing log to campaigns ────────────────────
-- Nullable by design. Transactional sends (thank_you, follow_up,
-- voucher_ready) have no campaign and never will. Ad-hoc broadcasts
-- sent without starting a campaign also stay null — they simply do
-- not appear in the effectiveness report, which is correct: we
-- cannot measure what we did not define.
alter table wa_outreach_log
  add column if not exists campaign_id uuid references wa_campaigns(id) on delete set null;

-- The exact text this guest received, after placeholder rendering.
-- Belt-and-braces next to wa_campaigns.message_body: it survives
-- even for campaign-less sends, and proves what a specific guest
-- was told if they ever ask.
alter table wa_outreach_log
  add column if not exists message_body text;

-- ── 4. Indexes ───────────────────────────────────────────────
create index if not exists idx_outreach_campaign  on wa_outreach_log (campaign_id);
create index if not exists idx_outreach_guest_sent on wa_outreach_log (guest_id, sent_at desc);
create index if not exists idx_campaigns_started   on wa_campaigns (started_at desc);
create index if not exists idx_campaign_audience_guest on wa_campaign_audience (guest_id);

-- ── 5. One open campaign at a time ───────────────────────────
-- Enforced in the DB, not just the UI: two open campaigns would
-- make "which campaign does this send belong to?" ambiguous, and
-- the app resolves that client-side.
create unique index if not exists idx_one_open_campaign
  on wa_campaigns ((ended_at is null)) where ended_at is null;

commit;


-- ################################################################
-- ## 20260801_02_standalone_vouchers.sql
-- ################################################################

-- ============================================================
-- STANDALONE VOUCHERS
-- 2026-08-01. Additive only: 1 new table, 1 settings key,
-- 2 functions, 1 reporting view. Nothing existing is touched.
-- NOT YET APPLIED — review first, then run on staging.
-- ============================================================
--
-- WHY A SEPARATE TABLE
-- --------------------
-- member_vouchers is earned: a member collects stickers, the
-- system issues a voucher, and members.available_vouchers is
-- decremented on redeem. Every membership statistic counts those
-- rows.
--
-- These vouchers are given, not earned: a thank-you to a top
-- spender, a birthday gift to a friend of the house, or a block
-- of vouchers converted from a partner's leftover budget
-- (tiket.com, July 2026). They belong to no member and must never
-- touch available_vouchers or the membership reports. Squeezing
-- them into member_vouchers with a null member_id would silently
-- corrupt every membership number in the app.
--
-- WHY IT IS TRACKED AT ALL
-- ------------------------
-- A voucher is money leaving the business, and unlike an invoice
-- it comes back. An image alone cannot answer:
--   • has this one already been used? (a forwarded screenshot
--     redeems just as well as the original)
--   • has it expired?
--   • how much of the partner's budget have we actually issued,
--     and how much has been burned?
-- Those three questions are the whole reason this table exists.
-- ============================================================

begin;

-- ── 1. Validity setting ──────────────────────────────────────
-- Its own key rather than reusing membership.voucher_validity_days:
-- a gift voucher and an earned voucher have no reason to expire on
-- the same schedule, and ops must be able to change one without
-- moving the other.
insert into app_settings (key, value)
values ('vouchers', jsonb_build_object('standalone_validity_days', 60))
on conflict (key) do update
set value = app_settings.value
          || jsonb_build_object(
               'standalone_validity_days',
               coalesce(app_settings.value->'standalone_validity_days', to_jsonb(60))
             );

create or replace function public.standalone_voucher_validity_days()
returns integer
language sql stable as $$
  select greatest(
    coalesce((get_setting('vouchers')->>'standalone_validity_days')::integer, 60),
    1
  );
$$;

-- ── 2. The table ─────────────────────────────────────────────
create table if not exists public.standalone_vouchers (
  id            bigint generated always as identity primary key,

  -- BHV-00001. The BHV prefix keeps these distinguishable at a
  -- glance from membership codes (BH-F21-0007), so staff reading a
  -- code a guest sent back know which screen to look on.
  voucher_code  text not null,

  -- Groups one issuing action. A single voucher gets its own
  -- batch_id too, so "show me everything from that tiket.com run"
  -- and "show me that one birthday voucher" are the same query.
  batch_id      uuid not null default gen_random_uuid(),
  batch_label   text,

  -- What it was for. Free-ish but constrained, because the whole
  -- point of the report is grouping by it.
  occasion      text not null default 'other'
                check (occasion in ('top_spender','top_visits','birthday',
                                    'partnership','apology','other')),
  -- 'tiket.com'. Only meaningful for partnership vouchers, but not
  -- constrained to them: a birthday voucher for a partner contact
  -- is a real case.
  partner_name  text,

  -- ── Recipient ──
  -- guest_id is the useful one: it lets the owner ask later whether
  -- the top spenders we sent vouchers to actually came back.
  -- recipient_name is still stored even when guest_id is set — it is
  -- a snapshot of the name printed on the card, and a guest record
  -- can be renamed or merged after the fact.
  guest_id        uuid references guests(id) on delete set null,
  recipient_name  text,
  recipient_phone text,

  -- ── Value ──
  -- Three shapes, one row. value_idr is filled for every type
  -- (for percent and item it is the expected cost) so budget
  -- reporting never has to special-case them.
  value_type    text not null check (value_type in ('amount','percent','item')),
  value_idr     numeric(12,0),
  value_percent numeric(5,2),
  value_item    text,
  -- Optional guard rails printed on the card
  percent_cap_idr numeric(12,0),
  min_spend_idr   numeric(12,0),
  note            text,

  -- The line printed under the date on the card. Defaults to the
  -- occasion label ("Top spender thank you") but is free text,
  -- because what reads well to a guest is not the same as what
  -- groups well in a report. "Terima kasih sudah jadi tamu setia
  -- kami" belongs on the card; `occasion` stays clean for grouping.
  card_label      text,

  -- ── Lifecycle ──
  issued_at   timestamptz not null default now(),
  issued_by   uuid references staff_users(id),
  expires_at  timestamptz,

  redeemed      boolean not null default false,
  redeemed_at   timestamptz,
  redeemed_by   uuid references staff_users(id),
  redeem_note   text,

  -- A mis-issued voucher is voided, never deleted: if a guest turns
  -- up holding the card, staff must be able to see what happened to
  -- it and who cancelled it.
  voided       boolean not null default false,
  voided_at    timestamptz,
  voided_by    uuid references staff_users(id),
  void_reason  text,

  -- A voucher must be attributable to somebody: a guest record, a
  -- named person, or a partner. The third case is deliberate — a
  -- block of tiket.com vouchers is a bearer instrument, handed out
  -- by the partner to people we will never know in advance. What
  -- must never exist is a voucher attributable to no one at all,
  -- because then nobody can say where the value went.
  constraint standalone_voucher_has_recipient
    check (guest_id is not null
           or nullif(btrim(coalesce(recipient_name, '')), '') is not null
           or nullif(btrim(coalesce(partner_name, '')), '') is not null),

  -- Each value type carries exactly the fields it needs. Without
  -- this a "20%" voucher could be saved with no percentage and
  -- print as a blank promise.
  constraint standalone_voucher_value_shape check (
    (value_type = 'amount'  and value_idr is not null and value_idr > 0)
    or (value_type = 'percent' and value_percent is not null
        and value_percent > 0 and value_percent <= 100)
    or (value_type = 'item' and nullif(btrim(coalesce(value_item, '')), '') is not null)
  ),

  -- Redeemed and voided are mutually exclusive states.
  constraint standalone_voucher_not_both
    check (not (redeemed and voided))
);

create unique index if not exists standalone_vouchers_code_key
  on public.standalone_vouchers (voucher_code);
create index if not exists idx_standalone_vouchers_batch
  on public.standalone_vouchers (batch_id);
create index if not exists idx_standalone_vouchers_guest
  on public.standalone_vouchers (guest_id);
create index if not exists idx_standalone_vouchers_issued
  on public.standalone_vouchers (issued_at desc);
create index if not exists idx_standalone_vouchers_open
  on public.standalone_vouchers (expires_at)
  where redeemed = false and voided = false;

-- ── 3. Code + expiry on insert ───────────────────────────────
-- id is an IDENTITY column, so NEW.id is populated in a BEFORE
-- INSERT trigger. Both fields are only filled when null, so an
-- explicit value (a data repair, an import) is respected.
create or replace function public.set_standalone_voucher_defaults()
returns trigger
language plpgsql as $$
declare
  v_days integer;
begin
  if new.voucher_code is null then
    new.voucher_code := 'BHV-' || lpad(new.id::text, 5, '0');
  end if;

  if new.expires_at is null then
    v_days := standalone_voucher_validity_days();
    -- End of the last valid day in Jakarta time. Without this a
    -- voucher stamped "valid until 30 September" would start being
    -- refused at 07:00 that morning, in front of the guest.
    new.expires_at := ((
      ((new.issued_at at time zone 'Asia/Jakarta')::date + v_days)::timestamp
      + time '23:59:59'
    ) at time zone 'Asia/Jakarta');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_standalone_voucher_defaults on public.standalone_vouchers;
DROP TRIGGER IF EXISTS trg_standalone_voucher_defaults ON public.standalone_vouchers;
CREATE TRIGGER trg_standalone_voucher_defaults
  before insert on public.standalone_vouchers
  for each row execute function public.set_standalone_voucher_defaults();

-- ── 4. Redeem ────────────────────────────────────────────────
-- Looked up by CODE, not id: that is what the guest hands over.
-- Case and surrounding spaces are forgiven because the code will
-- arrive typed off a phone screen.
--
-- Every refusal is a distinct exception so the UI can explain what
-- actually happened. "Invalid voucher" at a busy till, with a guest
-- watching, is not good enough.
create or replace function public.redeem_standalone_voucher(
  p_code          text,
  p_redeemed_by   uuid    default null,
  p_note          text    default null,
  p_allow_expired boolean default false
)
returns jsonb
language plpgsql as $$
declare
  v_row public.standalone_vouchers;
begin
  select * into v_row
  from public.standalone_vouchers
  where voucher_code = upper(btrim(p_code))
  for update;

  if v_row.id is null then
    raise exception 'VOUCHER_NOT_FOUND';
  end if;
  if v_row.voided then
    raise exception 'VOUCHER_VOIDED';
  end if;
  if v_row.redeemed then
    raise exception 'VOUCHER_ALREADY_REDEEMED';
  end if;
  if not p_allow_expired and v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception 'VOUCHER_EXPIRED';
  end if;

  -- The row lock above plus `and redeemed = false` here are what
  -- stop a double-click, or two tills at once, redeeming twice.
  update public.standalone_vouchers
  set redeemed    = true,
      redeemed_at = now(),
      redeemed_by = p_redeemed_by,
      redeem_note = p_note
  where id = v_row.id and redeemed = false
  returning * into v_row;

  if v_row.id is null then
    raise exception 'VOUCHER_ALREADY_REDEEMED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'voucher_code', v_row.voucher_code,
    'recipient_name', v_row.recipient_name,
    'guest_id', v_row.guest_id,
    'value_type', v_row.value_type,
    'value_idr', v_row.value_idr,
    'value_percent', v_row.value_percent,
    'value_item', v_row.value_item,
    'was_expired', v_row.expires_at is not null and v_row.expires_at < now()
  );
end;
$$;

-- ── 5. Void ──────────────────────────────────────────────────
-- Cancelling a voucher issued by mistake. Refuses to void one that
-- has already been redeemed: that value is gone, and pretending
-- otherwise would make the budget report lie.
create or replace function public.void_standalone_voucher(
  p_code      text,
  p_voided_by uuid default null,
  p_reason    text default null
)
returns jsonb
language plpgsql as $$
declare
  v_row public.standalone_vouchers;
begin
  select * into v_row
  from public.standalone_vouchers
  where voucher_code = upper(btrim(p_code))
  for update;

  if v_row.id is null then
    raise exception 'VOUCHER_NOT_FOUND';
  end if;
  if v_row.redeemed then
    raise exception 'VOUCHER_ALREADY_REDEEMED';
  end if;
  if v_row.voided then
    return jsonb_build_object('ok', true, 'already_voided', true, 'id', v_row.id);
  end if;

  update public.standalone_vouchers
  set voided = true, voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
  where id = v_row.id;

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

-- ── 6. Budget report ─────────────────────────────────────────
-- One row per batch: what was handed out, what came back, what is
-- still outstanding. issued_idr is the exposure; redeemed_idr is
-- the actual cost so far.
create or replace view public.standalone_voucher_batches as
select
  batch_id,
  min(batch_label)                                          as batch_label,
  min(occasion)                                             as occasion,
  min(partner_name)                                         as partner_name,
  min(issued_at)                                            as issued_at,
  count(*)                                                  as issued_count,
  count(*) filter (where redeemed)                          as redeemed_count,
  count(*) filter (where voided)                            as voided_count,
  count(*) filter (where not redeemed and not voided
                     and expires_at < now())                as expired_count,
  count(*) filter (where not redeemed and not voided
                     and (expires_at is null or expires_at >= now()))
                                                            as open_count,
  coalesce(sum(value_idr), 0)                               as issued_idr,
  coalesce(sum(value_idr) filter (where redeemed), 0)       as redeemed_idr,
  coalesce(sum(value_idr) filter (where not redeemed and not voided
                     and (expires_at is null or expires_at >= now())), 0)
                                                            as open_idr
from public.standalone_vouchers
group by batch_id;

commit;

-- ── Verify ───────────────────────────────────────────────────
-- select voucher_code, occasion, recipient_name, value_type,
--        value_idr, value_percent, value_item, expires_at, redeemed
-- from standalone_vouchers order by id desc limit 20;
--
-- select * from standalone_voucher_batches order by issued_at desc;
--
-- Rollback (only safe while nothing has been issued):
--   drop view if exists standalone_voucher_batches;
--   drop function if exists redeem_standalone_voucher(text, uuid, text, boolean);
--   drop function if exists void_standalone_voucher(text, uuid, text);
--   drop trigger if exists trg_standalone_voucher_defaults on standalone_vouchers;
--   drop function if exists set_standalone_voucher_defaults();
--   drop table if exists standalone_vouchers;
--   drop function if exists standalone_voucher_validity_days();


-- ################################################################
-- ## 20260801_03_voucher_card_label.sql
-- ################################################################

-- ============================================================
-- STANDALONE VOUCHERS — card_label
-- 2026-08-01, follow-up to 01_standalone_vouchers.sql
--
-- Only needed on a database that ran 01 BEFORE this column was
-- added to it. A fresh run of 01 already creates the column, and
-- running this afterwards is harmless either way.
--
-- What it is: the line printed under the date on the voucher
-- card. Defaults to the occasion label ("Top spender thank you")
-- but is free text, because what reads well to a guest is not
-- what groups well in a report. The warm wording lives here;
-- `occasion` stays a clean reporting category.
--
-- Additive, nullable, no default, no rewrite. Safe during
-- service.
-- ============================================================

alter table public.standalone_vouchers
  add column if not exists card_label text;

-- ── Verify ───────────────────────────────────────────────────
-- select voucher_code, occasion, card_label from standalone_vouchers
-- order by id desc limit 10;
--
-- Existing vouchers keep card_label = null, which the app renders
-- as the occasion label — so nothing already issued changes.


-- ################################################################
-- ## 20260809_backfill_visit_stickers.sql
-- ################################################################

-- ============================================================
-- 20260809 — Convert past visits into membership stickers
--
-- Why: when the front desk signs up a guest who has already been
-- eating here for months, those past visits are invisible to the
-- membership card. Staff currently "fix" this by typing manual
-- transactions, which double-counts (no visit_id link) and is
-- untraceable. This gives them a controlled way to do it.
--
-- Two functions:
--   list_member_backfill_visits(member_id)  -> read-only candidate list
--   convert_visits_to_stickers(member_id, visit_ids[], created_by)
--
-- Business rules (decided 2026-08-09 with Rere):
--   * Only visits of the member's OWN linked guest.
--   * Only status Done, not voided, spend >= min_spend for the card type.
--   * Vouchers ARE issued normally when a backfill crosses 5 stickers.
--   * No time window — all history is eligible.
--   * Manager/admin only (enforced in UI; DB has no auth context here
--     because the app uses the anon key + PIN login, so the DB cannot
--     see who is calling. The audit trail is created_by + notes.)
--
-- Safety: reuses add_member_transaction() so cap, voucher maths and
-- the one-transaction-per-visit unique rule stay in exactly one place.
-- The whole conversion runs in one transaction — all or nothing.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Candidate list
-- Returns every past visit of this member's guest with a verdict,
-- so the UI never has to re-derive the threshold rules itself.
-- eligible = checkable in the modal.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_member_backfill_visits(p_member_id bigint)
RETURNS TABLE (
  visit_id uuid,
  visit_date date,
  visit_time time,
  pax integer,
  spend_amount numeric,
  notes text,
  eligible boolean,
  reason text
)
LANGUAGE plpgsql
AS $$
DECLARE
  m RECORD;
  v_cfg JSONB;
  v_type_cfg JSONB;
  v_min NUMERIC;
BEGIN
  SELECT * INTO m FROM members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND';
  END IF;
  IF m.guest_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_LINKED';
  END IF;

  v_cfg      := coalesce(get_setting('membership'), '{}'::jsonb);
  v_type_cfg := v_cfg->m.member_type;
  v_min := CASE WHEN m.member_type = 'Family'
                THEN coalesce((v_type_cfg->>'min_spend')::numeric, 300000)
                ELSE coalesce((v_type_cfg->>'min_spend')::numeric, 2000000)
           END;

  RETURN QUERY
  SELECT
    v.id,
    v.visit_date,
    v.visit_time,
    v.pax,
    v.spend_amount,
    v.notes,
    (mt.id IS NULL
       AND v.status = 'Done'
       AND v.voided_at IS NULL
       AND coalesce(v.spend_amount, 0) >= v_min)             AS eligible,
    CASE
      WHEN mt.id IS NOT NULL                THEN 'already_counted'
      WHEN v.status <> 'Done'               THEN 'not_done'
      WHEN v.voided_at IS NOT NULL          THEN 'voided'
      WHEN coalesce(v.spend_amount, 0) <= 0 THEN 'no_spend'
      WHEN v.spend_amount < v_min           THEN 'below_minimum'
      ELSE 'eligible'
    END                                                       AS reason
  FROM visits v
  LEFT JOIN member_transactions mt ON mt.visit_id = v.id
  WHERE v.guest_id = m.guest_id
  ORDER BY v.visit_date DESC, v.visit_time DESC NULLS LAST;
END;
$$;

-- ------------------------------------------------------------
-- 2. Conversion
-- Re-validates every visit server-side. A stale modal (staff left it
-- open while a colleague voided a visit, or the threshold changed)
-- must not be able to award a sticker it is no longer entitled to.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_visits_to_stickers(
  p_member_id bigint,
  p_visit_ids uuid[],
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  m RECORD;
  v RECORD;
  v_cfg JSONB;
  v_type_cfg JSONB;
  v_min NUMERIC;
  r JSONB;
  v_converted INTEGER := 0;
  v_stickers  INTEGER := 0;
  v_vouchers  INTEGER := 0;
  v_skipped   JSONB := '[]'::jsonb;
BEGIN
  IF p_visit_ids IS NULL OR array_length(p_visit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_VISITS_SELECTED';
  END IF;
  IF array_length(p_visit_ids, 1) > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_VISITS';
  END IF;

  SELECT * INTO m FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND            THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF NOT m.is_active      THEN RAISE EXCEPTION 'MEMBER_INACTIVE';  END IF;
  IF m.guest_id IS NULL   THEN RAISE EXCEPTION 'MEMBER_NOT_LINKED'; END IF;

  v_cfg      := coalesce(get_setting('membership'), '{}'::jsonb);
  v_type_cfg := v_cfg->m.member_type;
  v_min := CASE WHEN m.member_type = 'Family'
                THEN coalesce((v_type_cfg->>'min_spend')::numeric, 300000)
                ELSE coalesce((v_type_cfg->>'min_spend')::numeric, 2000000)
           END;

  -- Oldest first: stickers and vouchers then accrue in the order the
  -- guest actually earned them, and the cap cuts off the newest visits
  -- rather than an arbitrary set.
  FOR v IN
    SELECT vi.*
    FROM visits vi
    WHERE vi.id = ANY(p_visit_ids)
    ORDER BY vi.visit_date ASC, vi.visit_time ASC NULLS FIRST
  LOOP
    IF v.guest_id IS DISTINCT FROM m.guest_id THEN
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', 'other_guest');
      CONTINUE;
    END IF;
    IF v.status <> 'Done' THEN
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', 'not_done');
      CONTINUE;
    END IF;
    IF v.voided_at IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', 'voided');
      CONTINUE;
    END IF;
    IF coalesce(v.spend_amount, 0) < v_min THEN
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', 'below_minimum');
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM member_transactions WHERE visit_id = v.id) THEN
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', 'already_counted');
      CONTINUE;
    END IF;

    r := add_member_transaction(
      p_member_id  := p_member_id,
      p_amount     := v.spend_amount,
      p_date       := (v.visit_date::timestamp + coalesce(v.visit_time, '19:00'::time))
                        AT TIME ZONE 'Asia/Jakarta',
      p_notes      := 'Konversi kunjungan lama (' || to_char(v.visit_date, 'DD Mon YYYY') || ')',
      p_created_by := p_created_by,
      p_visit_id   := v.id
    );

    IF coalesce((r->>'skipped')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', 'already_counted');
      CONTINUE;
    END IF;

    v_converted := v_converted + 1;
    IF coalesce((r->>'earned_sticker')::boolean, false) THEN
      v_stickers := v_stickers + 1;
    ELSE
      -- Recorded, but the card is full. Kept as a transaction so the
      -- spend history stays complete; the UI reports it separately.
      v_skipped := v_skipped || jsonb_build_object('visit_id', v.id, 'reason', r->>'sticker_reason');
    END IF;
    v_vouchers := v_vouchers + coalesce((r->>'vouchers_issued')::integer, 0);
  END LOOP;

  SELECT * INTO m FROM members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'converted',          v_converted,
    'stickers_awarded',   v_stickers,
    'vouchers_issued',    v_vouchers,
    'new_total_stickers', m.total_stickers,
    'available_vouchers', m.available_vouchers,
    'skipped',            v_skipped
  );
END;
$$;


-- ################################################################
-- ## 20260815_reservation_follow_up.sql
-- ################################################################

-- ============================================================
-- BLUE HERON — RESERVATION FOLLOW-UP TRACKING
-- Prod: YOUR_SUPABASE_PROJECT_REF
-- Date: 2026-08-15
--
-- Purely additive. Nothing existing is dropped or renamed.
--
-- WHY (incident 2026-08-15):
--   Two online-form reservations (Bob, Ratih Prajna Paramita) got no
--   staff follow-up because the "new reservation" bell was purely a
--   live Postgres Realtime listener + per-browser localStorage cache.
--   If no dashboard tab was connected at the exact moment a booking
--   came in (e.g. before opening hours), or the day rolled over before
--   anyone opened the panel, the reservation left no trace anywhere —
--   not a missed alert, an alert that never existed.
--
--   Fix: give follow-up status a durable, shared home in the database
--   itself, so the bell/list is a live query ("today's Online Form
--   reservations, follow-up pending") rather than a cache of events a
--   browser happened to catch. See js/notify.js for the query-side fix.
-- ============================================================

alter table public.reservations
  add column if not exists follow_up_done boolean not null default false,
  add column if not exists follow_up_done_at timestamptz,
  add column if not exists follow_up_done_by uuid references public.staff_users(id);

comment on column public.reservations.follow_up_done is
  'Whether staff have followed up on this booking (currently tracked for Online Form reservations). Shared across devices — not a per-browser flag.';


-- ################################################################
-- ## 20260821_reservation_reminder_ack.sql
-- ################################################################

-- ============================================================
-- BLUE HERON — RESERVATION REMINDER ACKNOWLEDGEMENT
-- Prod: YOUR_SUPABASE_PROJECT_REF
-- Date: 2026-08-21
--
-- Purely additive. Four nullable columns, no defaults, no backfill,
-- nothing existing dropped or renamed. Safe to run during service.
--
-- WHY:
--   follow_up_done answers "has FO contacted this guest at all?" — a
--   once-per-booking question, asked as soon as the online form lands.
--   It cannot also carry "has FO re-checked attendance for tomorrow?"
--   and "…for today?", because those are asked LATER and asking them
--   must not be blocked by the first question already being answered.
--   One flag would mean either the reminder never fires (already done)
--   or unticking follow-up to make it fire again (destroys the record
--   of the original follow-up).
--
--   So: three independent acknowledgements per booking.
--     follow_up_done        — FO contacted the guest after they booked
--     reminder_d1_ack_at    — FO re-checked attendance on D-1
--     reminder_dday_ack_at  — FO re-checked attendance on D-day
--
--   Acking D-1 deliberately does NOT ack D-day. That is the whole point
--   of two columns: the guest confirmed yesterday is still asked about
--   again on the day itself.
--
--   Like follow_up_done these live in the DB, not localStorage, so the
--   state is shared across front-desk PCs and survives a machine being
--   off overnight. See js/notify.js for the query side.
-- ============================================================

alter table public.reservations
  add column if not exists reminder_d1_ack_at timestamptz,
  add column if not exists reminder_d1_ack_by uuid references public.staff_users(id),
  add column if not exists reminder_dday_ack_at timestamptz,
  add column if not exists reminder_dday_ack_by uuid references public.staff_users(id);

comment on column public.reservations.reminder_d1_ack_at is
  'FO marked the day-before attendance reminder as read. Independent of follow_up_done and of reminder_dday_ack_at.';

comment on column public.reservations.reminder_dday_ack_at is
  'FO marked the day-of attendance reminder as read. Independent of follow_up_done and of reminder_d1_ack_at.';

-- Rollback (only if nothing has been written yet):
--   alter table public.reservations
--     drop column if exists reminder_d1_ack_at,
--     drop column if exists reminder_d1_ack_by,
--     drop column if exists reminder_dday_ack_at,
--     drop column if exists reminder_dday_ack_by;


-- ################################################################
-- ## 20260822_admin_role_and_first_user.sql
-- ################################################################

-- ============================================================
-- ADMIN ROLE + FIRST STAFF USER
-- Date: 2026-08-22
--
-- WHY THIS EXISTS
-- The base schema allows only two roles:
--
--   role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager'))
--
-- but the application code checks for a third, 'admin' (owner dashboard,
-- ADMIN_ONLY_PAGES, the staff-dashboard view). No migration ever added it.
-- The original database had it widened by hand, outside the migration files,
-- so the migrations do NOT reproduce a working database from zero.
--
-- Inserting a user with role 'admin' on a fresh project fails the CHECK
-- constraint. That is the first real proof that this migration set needed
-- patching before it could stand up a new client. Keep this file in the set.
--
-- Also: a brand new database has no staff at all, and the app has no
-- sign-up screen by design. Somebody has to be created in SQL before anyone
-- can log in. That is what the second half does.
-- ============================================================

-- 1. Allow the third role the code already expects ------------
alter table public.staff_users
  drop constraint if exists staff_users_role_check;

alter table public.staff_users
  add constraint staff_users_role_check
  check (role in ('staff', 'manager', 'admin'));

-- 2. Create the first user ------------------------------------
-- PIN must be EXACTLY four digits: the column enforces ^[0-9]{4}$.
-- Login matches the username EXACTLY and is case sensitive, so keep it
-- lowercase and type it the same way on the login screen.
--
-- CHANGE THE PIN before using this anywhere real.
insert into public.staff_users (username, display_name, pin, role, is_active)
values ('rere', 'Rere', '1234', 'admin', true)
on conflict (username) do update
  set display_name = excluded.display_name,
      pin          = excluded.pin,
      role         = excluded.role,
      is_active    = true;

-- 3. Confirm ---------------------------------------------------
select username, display_name, role, is_active
from public.staff_users
order by username;


-- ################################################################
-- ## 20260823_gaps_found_against_prod.sql
-- ################################################################

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

-- ============================================================
-- ## 20260823_branding_and_staff_config.sql
-- ============================================================
-- Two things, both needed before client one:
--
--   1. A `branding` storage bucket + an `app_settings.branding` row, so the
--      logo shown on the guest pages, the staff app, the invoice and the
--      voucher card can be changed from Settings instead of by editing files
--      and redeploying. This is backlog item 2 in CLAUDE.md, the image half
--      of it.
--
--   2. The guardrails behind the admin-only Staff Configuration screen:
--      a case-insensitive unique username, and a check that the database
--      itself refuses to leave the system with zero usable admins.
--
-- Idempotent, like everything else in this file. Safe to run twice.

-- ---------- 1. BRANDING BUCKET ----------
-- Public, because the guest pages read it with no auth, exactly like
-- dish-images. 2 MB ceiling: a logo bigger than that is a mistake, and
-- the voucher background (1084x1940 JPG) sits well under it.
--
-- SVG is deliberately NOT allowed. An SVG is a script-capable document and
-- this bucket is world-writable under the current MVP policy model, so
-- accepting one would let anybody host active content on the client's
-- domain. PNG with transparency covers every real logo need.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Public read - branding" on storage.objects;
DROP POLICY IF EXISTS "Public read - branding" ON storage.objects;
CREATE POLICY "Public read - branding" ON storage.objects for select
  using (bucket_id = 'branding');

drop policy if exists "Public write - branding" on storage.objects;
DROP POLICY IF EXISTS "Public write - branding" ON storage.objects;
CREATE POLICY "Public write - branding" ON storage.objects for insert
  with check (bucket_id = 'branding');

drop policy if exists "Public update - branding" on storage.objects;
DROP POLICY IF EXISTS "Public update - branding" ON storage.objects;
CREATE POLICY "Public update - branding" ON storage.objects for update
  using (bucket_id = 'branding');

drop policy if exists "Public delete - branding" on storage.objects;
DROP POLICY IF EXISTS "Public delete - branding" ON storage.objects;
CREATE POLICY "Public delete - branding" ON storage.objects for delete
  using (bucket_id = 'branding');

-- ---------- 2. BRANDING SETTINGS ROW ----------
-- All three keys start null, which means "use the file bundled in the repo".
-- That is what makes this safe to deploy to a running client: nothing
-- changes on screen until somebody uploads something.
--
--   logo_url        the wide wordmark: guest pages, login, sidebar, invoice
--   small_logo_url  the square mark: favicon, invoice watermark
--   voucher_bg_url  the whole voucher card artwork, NOT a logo (see below)
insert into app_settings (key, value)
values ('branding', jsonb_build_object(
          'logo_url', null,
          'small_logo_url', null,
          'voucher_bg_url', null))
on conflict (key) do update
set value = app_settings.value
            || jsonb_build_object(
                 'logo_url', coalesce(app_settings.value->'logo_url', 'null'::jsonb),
                 'small_logo_url', coalesce(app_settings.value->'small_logo_url', 'null'::jsonb),
                 'voucher_bg_url', coalesce(app_settings.value->'voucher_bg_url', 'null'::jsonb));

-- ---------- 3. STAFF USERNAME UNIQUENESS ----------
-- staff_users.username already has a plain UNIQUE constraint, but login
-- matches the username EXACTLY and case-sensitively. So "Rina" and "rina"
-- are two different accounts that a human reads as one, and the front desk
-- would blame the PIN when the wrong one is typed. There is already a
-- LOWER(username) index; make it unique so the database refuses the pair.
--
-- If this fails, the client's table ALREADY contains a case-clashing pair.
-- That is information, not a bug in this file: find them with
--   select lower(username), count(*) from staff_users
--   group by 1 having count(*) > 1;
-- and rename one before re-running.
drop index if exists idx_staff_users_username;
create unique index if not exists idx_staff_users_username
  on staff_users (lower(username));

-- ---------- 4. NEVER ZERO ADMINS ----------
-- The Staff Configuration screen blocks this in the UI, but the UI is
-- public JavaScript and the anon key is public with it. The rule that
-- actually matters has to live here.
--
-- Locking every admin out of a client's own system is unrecoverable without
-- Rere opening the SQL editor for them, so it gets a database-side guard.
create or replace function public.guard_last_admin()
returns trigger
language plpgsql
as $$
declare
  v_active_admins int;
begin
  -- Only interested in changes that could REMOVE an active admin:
  -- deleting one, deactivating one, or demoting one.
  if tg_op = 'UPDATE'
     and old.role = 'admin' and old.is_active
     and new.role = 'admin' and new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (old.role = 'admin' and old.is_active) then
    return new;
  end if;
  if tg_op = 'DELETE' and not (old.role = 'admin' and old.is_active) then
    return old;
  end if;

  select count(*) into v_active_admins
  from staff_users
  where role = 'admin' and is_active and id <> old.id;

  if v_active_admins = 0 then
    raise exception
      'Cannot remove the last active admin. Promote another user to admin first.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists staff_users_guard_last_admin on staff_users;
create trigger staff_users_guard_last_admin
  before update or delete on staff_users
  for each row execute function public.guard_last_admin();

-- ---------- 5. CONFIRM ----------
select 'branding bucket' as checked,
       count(*) as found from storage.buckets where id = 'branding'
union all
select 'branding setting', count(*) from app_settings where key = 'branding'
union all
select 'last-admin trigger', count(*) from pg_trigger
  where tgname = 'staff_users_guard_last_admin';
-- expect: 1, 1, 1

-- ============================================================
-- ## 20260823_birthday_followup.sql
-- ============================================================
-- Front desk sees a badge, opens the birthday list, sends a WhatsApp
-- greeting, then ticks the guest off. The badge clears; the list stays,
-- so anyone can still see whose birthday falls this month.
--
-- WHY A TABLE AND NOT wa_outreach_log:
-- "we contacted this guest" and "a WhatsApp message was opened" are two
-- different facts, and the app already keeps them apart everywhere else
-- (reservations.follow_up_done vs the outreach log). Staff greet people at
-- the table, by phone, or from their own handset, and all of those are
-- legitimately "done" with no wa.me click behind them. Deriving the badge
-- from the outreach log would either lose those or force a fake log row.
--
-- The WhatsApp send is STILL logged to wa_outreach_log like every other WA
-- button. This table answers a different question.

create table if not exists public.birthday_greetings (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  -- The CALENDAR year the greeting belongs to, not the guest's birth year.
  -- A guest is greeted once per year and becomes due again next year; this
  -- is what makes the row expire on its own with no cleanup job.
  birthday_year int not null,
  greeted_at timestamptz not null default now(),
  greeted_by uuid references public.staff_users(id),
  -- Denormalised on purpose: the list has to show "ditandai oleh Rina"
  -- without joining staff_users on every render, and it must keep saying so
  -- after Rina's account is deactivated.
  greeted_by_name text,
  -- 'whatsapp' when the WA button was used, 'manual' when someone ticked the
  -- box (greeted in person, called, messaged from their own phone).
  method text not null default 'manual' check (method in ('whatsapp', 'manual'))
);

-- One greeting per guest per year, enforced here rather than in the UI.
-- Two people at two tills opening the same list is the normal case, not the
-- edge case, and without this they both insert.
create unique index if not exists idx_birthday_greetings_guest_year
  on public.birthday_greetings (guest_id, birthday_year);

create index if not exists idx_birthday_greetings_year
  on public.birthday_greetings (birthday_year);

-- Same MVP security model as every other table here (public policy, staff
-- auth handled app-side). Known debt, tightened with the rest at RLS time.
alter table public.birthday_greetings enable row level security;
drop policy if exists "Public full access - birthday_greetings" on public.birthday_greetings;
create policy "Public full access - birthday_greetings" on public.birthday_greetings
  for all using (true) with check (true);

comment on table public.birthday_greetings is
  'One row per guest per calendar year once the birthday greeting has been sent or marked done. Clears the birthday badge; the month list stays visible either way.';

-- ---------- The birthday WhatsApp template ----------
-- TRANSACTIONAL (is_broadcast = false), and that is a decision, not an
-- oversight. A birthday greeting is addressed to one person on one day: it
-- must not be filtered by do_not_contact the way a promo blast is, and it
-- must not count towards the 5-day resend warning, or a guest who got a
-- campaign on Tuesday would be skipped for their own birthday on Thursday.
--
-- No {link}, for the same reason the thank-you template has none: there is
-- no campaign behind it and no promo page to point at.
--
-- No emoji. The front desk PC corrupts them into "?" on the WhatsApp handoff
-- (2026-07-17 decision, applies to every template in this table).
insert into wa_templates (key, label, body, is_broadcast) values
  ('birthday', 'Ulang Tahun (ucapan ke tamu)',
   E'Halo {nama}!\n\nSelamat ulang tahun dari kami semua di {resto}. Semoga hari ini menyenangkan dan tahun ini membawa banyak hal baik untuk Bapak/Ibu.\n\nKami akan senang sekali kalau bisa merayakannya bersama Anda di {resto}. Terima kasih sudah menjadi bagian dari cerita kami!',
   false)
on conflict (key) do nothing;

-- ---------- Confirm ----------
select 'birthday_greetings' as checked, count(*) as found
from information_schema.tables
where table_schema = 'public' and table_name = 'birthday_greetings'
union all
select 'unique guest+year', count(*) from pg_indexes
where schemaname = 'public' and indexname = 'idx_birthday_greetings_guest_year'
union all
select 'birthday template', count(*) from wa_templates where key = 'birthday';
-- expect: 1, 1, 1

-- ============================================================
-- ## 20260823_fix_recalculate_spending_tier.sql
-- ============================================================
-- FIXES A SHOWSTOPPER. Without this, on a database built from this file,
-- creating a walk-in or a reservation for a guest with no spend history
-- fails with:
--
--   new row for relation "guests" violates check constraint
--   "guests_spending_tier_check"
--
-- and the guest row is left behind while the visit or reservation is not
-- written. Reported by Rere 2026-08-23 on the first real client database.
--
-- ── What was actually wrong ───────────────────────────────────────────
-- Two functions in this file drifted out of step with each other:
--
--   calculate_guest_spending_tier   redefined THREE times. The last version
--                                   (20260721, settings-driven thresholds)
--                                   RETURNS TABLE(tier, qualified_at).
--   recalculate_guest_spending_tier redefined TWICE. The last version
--                                   (20260602) still does
--                                     SELECT calculate_...(id) INTO new_tier
--                                   which is the call shape for a function
--                                   returning a scalar TEXT.
--
-- The 20260602 recalculate_ sits LATER in this file than the correct
-- 20260518 one, so it is the version that survives, and it is paired with a
-- calculate_ that no longer matches it.
--
-- Selecting a TABLE-returning function into a text variable does not fail.
-- It quietly stringifies the whole ROW. For a guest with no spend the
-- function returns (NULL, NULL), so new_tier becomes the literal three
-- characters `(,)` — not null, and not one of the two allowed tiers. The
-- CHECK constraint then does its job and rejects the write.
--
-- The constraint is CORRECT and is not what gets changed here. Nothing in
-- the codebase ever writes a tier other than 'high_spender', 'medium_spender'
-- or NULL. Widening the constraint would have hidden the bug and let `(,)`
-- into the tier column of every new guest.
--
-- ── The second, quieter bug this also fixes ───────────────────────────
-- The 20260602 version never writes high_spender_qualified_at. That column
-- is what makes High Spender status STICKY for 90 days: calculate_ reads it
-- back on the next run to decide whether the window is still open. With it
-- never written, a guest would be High on the visit that qualified them and
-- silently drop to Medium on their next visit. The version below restores
-- the write, matching the 20260518 definition.
--
-- Idempotent: create or replace, plus a repair pass that is a no-op on a
-- healthy database.

-- The corrected definition that used to live HERE was MOVED UP on
-- 2026-08-30, to sit immediately after the last redefinition of
-- calculate_guest_spending_tier. See that copy for the function itself; the
-- explanation above is kept here because this is where the bug was found.
--
-- WHY IT HAD TO MOVE. calculate_guest_spending_tier changes shape to
-- TABLE(tier, qualified_at) at the "spending tier reads settings" section.
-- The booking_name backfill (`update public.reservations ... set booking_name`)
-- runs BEFORE this point and fires the reservations tier trigger, which calls
-- recalculate_guest_spending_tier. With the fix down here, that trigger ran
-- against the OLD text-expecting version and every affected guest failed
-- guests_spending_tier_check with `(medium_spender,)`.
--
-- On an EMPTY database the backfill matches no rows, so nothing fires and the
-- whole file runs clean. It only breaks on a database that already has Online
-- Form reservations, which is to say every real one. Reported by Rere
-- 2026-08-30 re-running this file against her seeded Intoch database.

-- Repair pass. On a database where the CHECK constraint was in place this
-- matches nothing, because the constraint is exactly what stopped the bad
-- value being stored. It is here for a database where the constraint was
-- dropped or was never created, in which case `(,)` really is sitting in the
-- column and every tier badge in the app is reading it.
--
-- NULLs are untouched: `spending_tier not in (...)` is NULL for a NULL, not
-- true, so an un-tiered guest stays un-tiered.
update guests
set spending_tier = null
where spending_tier is not null
  and spending_tier not in ('high_spender', 'medium_spender');

-- ---------- Confirm ----------
-- Proves the pairing is right by RUNNING it rather than trusting the
-- definition: a guest with no spend must come back with a NULL tier.
--
-- The temporary guest is created and removed inside this block. If creating
-- it fails for some unrelated reason the check is skipped with a notice
-- rather than aborting the whole file, because a self-test must never be the
-- thing that stops a migration from applying.
do $$
declare
  v_id      uuid;
  v_tier    text;
  v_checked boolean := false;
begin
  begin
    insert into guests (name) values ('__tier_selftest__') returning id into v_id;
    v_checked := true;
  exception when others then
    raise notice 'spending tier self-test skipped (could not create a temporary guest: %)', sqlerrm;
  end;

  if not v_checked then
    return;
  end if;

  perform recalculate_guest_spending_tier(v_id);
  select spending_tier into v_tier from guests where id = v_id;
  delete from guests where id = v_id;

  if v_tier is not null then
    raise exception
      'recalculate_guest_spending_tier is still broken: expected NULL for a guest with no spend, got %', v_tier;
  end if;
  raise notice 'spending tier recalculation OK (no-spend guest -> NULL)';
end $$;

-- ============================================================
-- ## 20260823_reserve_appearance_and_voucher_style.sql
-- ============================================================
-- Two more app_settings rows, both seeded with the values already hardcoded
-- in the CSS and the canvas renderer. Seeding the CURRENT look rather than
-- something new is the point: applying this changes nothing on screen until
-- somebody edits it in Settings.
--
--   reserve_appearance  the public booking page and the thank-you page after
--                       it: backdrop photo, form panel colour and how solid
--                       it is, button colour, logo height.
--   voucher_style       the downloadable voucher card, which is now DRAWN
--                       from these colours instead of being text painted on
--                       a 1084x1940 artwork file. `use_artwork` switches back
--                       to the artwork route for a client who has one; the
--                       file itself still lives in app_settings.branding
--                       under voucher_bg_url.
--
-- Both use the same merge shape as the branding row: existing keys win, so
-- re-running never overwrites a client's choices, and a key added later
-- appears with its default instead of being missing.

insert into app_settings (key, value)
values ('reserve_appearance', jsonb_build_object(
          'bg_url', null,
          'glass_color', '#28547C',
          'glass_opacity', 0.6,
          'accent_color', '#5596CE',
          'logo_max_height', 72))
on conflict (key) do update
set value = app_settings.value
            || jsonb_build_object(
                 'bg_url',          coalesce(app_settings.value->'bg_url', 'null'::jsonb),
                 'glass_color',     coalesce(app_settings.value->'glass_color', '"#28547C"'::jsonb),
                 'glass_opacity',   coalesce(app_settings.value->'glass_opacity', '0.6'::jsonb),
                 'accent_color',    coalesce(app_settings.value->'accent_color', '"#5596CE"'::jsonb),
                 'logo_max_height', coalesce(app_settings.value->'logo_max_height', '72'::jsonb));

insert into app_settings (key, value)
values ('voucher_style', jsonb_build_object(
          'bg_color', '#F9F5F2',
          'accent_color', '#4795D0',
          'text_color', '#28547C',
          'logo_scale', 100,
          'use_artwork', false))
on conflict (key) do update
set value = app_settings.value
            || jsonb_build_object(
                 'bg_color',     coalesce(app_settings.value->'bg_color', '"#F9F5F2"'::jsonb),
                 'accent_color', coalesce(app_settings.value->'accent_color', '"#4795D0"'::jsonb),
                 'text_color',   coalesce(app_settings.value->'text_color', '"#28547C"'::jsonb),
                 'logo_scale',   coalesce(app_settings.value->'logo_scale', '100'::jsonb),
                 'use_artwork',  coalesce(app_settings.value->'use_artwork', 'false'::jsonb));

-- A client who uploaded voucher artwork BEFORE this existed had it applied
-- automatically, because artwork was the only mode. Now that colours are the
-- default, flip them to artwork mode so their card does not silently change
-- the next time they hand one out.
update app_settings
set value = jsonb_set(value, '{use_artwork}', 'true'::jsonb)
where key = 'voucher_style'
  and coalesce(value->>'use_artwork', 'false') = 'false'
  and exists (
    select 1 from app_settings b
    where b.key = 'branding'
      and coalesce(b.value->>'voucher_bg_url', '') <> ''
  );

-- ---------- Confirm ----------
select 'reserve_appearance' as checked, count(*) as found
from app_settings where key = 'reserve_appearance'
union all
select 'voucher_style', count(*) from app_settings where key = 'voucher_style';
-- expect: 1, 1

-- ============================================================
-- ## 20260823_campaign_status_columns.sql
-- ============================================================
-- FIXES A BROKEN PAGE. Without this, Broadcast > Campaign fails to load with
-- a 400 and the console shows "Gagal memuat daftar campaign", because
-- `ceLoadList()` orders by `wa_campaigns.status` and that column exists in NO
-- migration in this file. Reported by Rere 2026-08-23.
--
-- THIS IS THE THIRD COLUMN THE CODE USES THAT THIS FILE NEVER CREATED
-- (after the `admin` role and the spending-tier function pair). All three
-- come from the same place: the live Blue Heron database was patched by hand
-- and the migration file was never brought back into line. Assume there are
-- more. The only reliable way to find them is to build a fresh project from
-- this file and drive every page of the app against it.
--
-- ── Why no CHECK constraint ───────────────────────────────────────────
-- The obvious thing is `check (status in ('draft','active','done'))`. It is
-- deliberately NOT here.
--
-- Twice now a CHECK narrower than the code has taken a working screen down in
-- production: `staff_users.role` refused `admin`, and `guests_spending_tier`
-- refused a value a stale function was writing. On the audience table the code
-- already writes four different values from three different places, and a
-- fifth added next month would fail at the till rather than in review.
--
-- The allowed values are documented in COMMENT ON COLUMN instead. That is
-- discoverable by anyone reading the schema and cannot break a save. Add the
-- constraint later, once RLS work makes this schema stable and every writer
-- has been audited.

alter table public.wa_campaigns
  add column if not exists status text not null default 'draft';

comment on column public.wa_campaigns.status is
  'draft = built but not started, active = currently sending, done = finished. Set by js/campaign-editor.js. Intentionally unconstrained, see the migration note.';

alter table public.wa_campaign_audience
  add column if not exists status     text not null default 'pending',
  add column if not exists updated_at timestamptz;

comment on column public.wa_campaign_audience.status is
  'pending = not contacted yet, sent = message opened for this guest, done = manually marked finished, skipped = deliberately not contacted (see skip_reason). Intentionally unconstrained, see the migration note.';

-- ---------- Backfill ----------
-- A database that already has campaigns gets every one of them defaulted to
-- 'draft', which would show finished work as unstarted and let the editor
-- offer to "start" a campaign that ran last month. Derive the real state from
-- the timestamps that were already being written.
--
-- ── Why this is gated instead of just filtered on status = 'draft' ─────
-- `started_at` is NOT NULL DEFAULT now(), so EVERY campaign has one,
-- including a genuine unstarted draft. "draft with a started_at" therefore
-- does not mean "legacy running campaign", and a second run of this file
-- would flip every real draft the user had since created to 'active'.
-- Caught by running this section twice against a local Postgres.
--
-- The gate is "nobody has set a status yet", which is true exactly once: the
-- run that adds the column. The moment anyone saves any campaign the backfill
-- stops firing, so the file stays re-runnable.
do $$
declare
  v_untouched boolean;
begin
  select not exists (select 1 from public.wa_campaigns where status <> 'draft')
    into v_untouched;

  if not v_untouched then
    raise notice 'campaign status backfill skipped (statuses are already in use)';
    return;
  end if;

  update public.wa_campaigns
  set status = case when ended_at is not null then 'done' else 'active' end;

  -- Same for the audience. A guest carrying a skip_reason was deliberately
  -- passed over, and one with a row in the outreach log for this campaign was
  -- demonstrably contacted. Everyone else is genuinely still pending.
  update public.wa_campaign_audience
  set status = 'skipped'
  where coalesce(skip_reason, '') <> '';

  update public.wa_campaign_audience a
  set status = 'sent'
  where a.status = 'pending'
    and exists (
      select 1 from public.wa_outreach_log l
      where l.campaign_id = a.campaign_id
        and l.guest_id = a.guest_id
    );

  raise notice 'campaign status backfill applied';
end $$;

-- ---------- Confirm ----------
-- Runs the query the page actually runs. Reading the column list would not
-- have caught this bug in the first place; issuing the failing order does.
do $$
begin
  perform 1 from public.wa_campaigns order by status asc, started_at desc limit 1;
  perform 1 from public.wa_campaign_audience order by status limit 1;
  raise notice 'campaign list query OK (status + started_at both orderable)';
end $$;

select 'wa_campaigns.status' as checked, count(*) as found
from information_schema.columns
where table_schema = 'public' and table_name = 'wa_campaigns' and column_name = 'status'
union all
select 'wa_campaign_audience.status', count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'wa_campaign_audience' and column_name = 'status'
union all
select 'wa_campaign_audience.updated_at', count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'wa_campaign_audience' and column_name = 'updated_at';
-- expect: 1, 1, 1

-- ============================================================
-- ## 20260823_invoice_style.sql
-- ============================================================
-- Makes the invoice sheet configurable: five colours, both logo sizes, and
-- the footer address. Same shape as `voucher_style`.
--
-- Seeded with the values already hardcoded in the stylesheet, so applying
-- this changes nothing on screen until somebody edits it in Settings.
--
-- THE ADDRESS IS THE EXCEPTION and is seeded EMPTY on purpose. Until now the
-- invoice footer carried one particular restaurant's real street address in
-- Yogyakarta, plus "[nomor telepon]" and "[akun]" as unfilled placeholders —
-- left over from the de-branding pass. A new client printing an invoice would
-- have posted somebody else's address to their guest. Empty renders nothing,
-- which is wrong but obviously wrong, rather than confidently wrong.
--
-- Address, phone and Instagram are separate columns rather than one blob so
-- the footer cannot be shipped half-filled, and so the phone can be reused
-- elsewhere later without re-parsing a paragraph.

insert into app_settings (key, value)
values ('invoice_style', jsonb_build_object(
          'ink',         '#28547C',
          'accent',      '#3E8FCB',
          'frame',       '#7FB8E0',
          'row_fill',    '#CFE4F5',
          'muted',       '#4795D0',
          'logo_width',  172,
          'mark_width',  62,
          'address',     '',
          'phone',       '',
          'instagram',   ''))
on conflict (key) do update
set value = app_settings.value
            || jsonb_build_object(
                 'ink',        coalesce(app_settings.value->'ink',        '"#28547C"'::jsonb),
                 'accent',     coalesce(app_settings.value->'accent',     '"#3E8FCB"'::jsonb),
                 'frame',      coalesce(app_settings.value->'frame',      '"#7FB8E0"'::jsonb),
                 'row_fill',   coalesce(app_settings.value->'row_fill',   '"#CFE4F5"'::jsonb),
                 'muted',      coalesce(app_settings.value->'muted',      '"#4795D0"'::jsonb),
                 'logo_width', coalesce(app_settings.value->'logo_width', '172'::jsonb),
                 'mark_width', coalesce(app_settings.value->'mark_width', '62'::jsonb),
                 'address',    coalesce(app_settings.value->'address',    '""'::jsonb),
                 'phone',      coalesce(app_settings.value->'phone',      '""'::jsonb),
                 'instagram',  coalesce(app_settings.value->'instagram',  '""'::jsonb));

-- ---------- Confirm ----------
select 'invoice_style' as checked, count(*) as found
from app_settings where key = 'invoice_style';
-- expect: 1

-- ============================================================
-- ## 20260830_campaign_slug_and_promo_bucket.sql
-- ============================================================
-- Two more objects that exist in the live Blue Heron database and in no
-- migration. Found on 2026-08-30 by building this file onto an empty
-- Postgres and diffing the result against every table, column, RPC and
-- storage bucket the application code actually references.
--
-- Same root cause as the three defects recorded in migrations/README.md:
-- production was patched by hand, so nothing ever exercised this file.
--
-- What was broken on a database built from this file alone:
--
--   1. `wa_campaigns.slug` did not exist. Broadcast > Campaigns was
--      unusable end to end, not merely degraded. `ceUniqueSlug()` reads
--      `.select("slug").eq("slug", base)` before every save, and
--      `saveCampaign()` writes `slug` in the insert. Both 400.
--      So NO campaign could be created at all on a new client.
--
--   2. The `promo-images` storage bucket did not exist. Uploading a promo
--      image 404s, and because `cePromoImageUrl()` builds
--      /storage/v1/object/public/promo-images/<path> by hand, the WhatsApp
--      share card for every campaign would have resolved to nothing.
--
-- Idempotent, like the rest of this file. Safe to run twice.

-- ---------- 1. wa_campaigns.slug ----------
-- The slug is the only part of this system a paying guest ever sees: it is
-- the tail of the promo link forwarded in a WhatsApp thread. It is generated
-- by ceSlugify() as lowercase a-z, 0-9 and hyphens, capped at 40 characters.

alter table public.wa_campaigns
  add column if not exists slug text;

-- The unique index is not decoration. campaign-editor.js says so in a
-- comment and DEPENDS on it: ceUniqueSlug() asks the database whether a
-- slug is taken and only adds a random suffix when it is. Two racing saves
-- both read "free" and both write. Without the index the second one wins
-- silently and two campaigns share a promo link, which means one campaign's
-- WhatsApp card renders the other campaign's offer. With the index the
-- second insert fails loudly and the operator retries.
--
-- Partial rather than plain, because rows created before this column
-- existed have slug NULL and there can legitimately be many of those.
-- (Postgres already permits duplicate NULLs in a unique index; the WHERE
-- clause makes the intent explicit and keeps the index small.)
--
-- Applied through a guard rather than blind, because a unique index cannot
-- be created over data that already violates it. On the empty database this
-- file is meant to build there is nothing to violate; the guard exists so
-- that if it is ever run against a hand-patched database with duplicates it
-- names them instead of failing with a bare 23505.

do $$
declare
  dupes text;
begin
  select string_agg(slug || ' (x' || n || ')', ', ')
    into dupes
  from (
    select slug, count(*) as n
    from public.wa_campaigns
    where slug is not null
    group by slug
    having count(*) > 1
  ) d;

  if dupes is not null then
    raise exception
      'Cannot create the unique index on wa_campaigns.slug: these slugs are already duplicated: %. Two campaigns sharing a slug share a promo link, so fix the data first (rename the newer campaign), then re-run this file.',
      dupes;
  end if;

  create unique index if not exists wa_campaigns_slug_key
    on public.wa_campaigns (slug)
    where slug is not null;
end $$;

-- ---------- 2. promo-images storage bucket ----------
-- Public, for the same reason as dish-images and branding: the WhatsApp
-- crawler and the guest's phone fetch this image with no auth at all.
--
-- 2 MB ceiling, matching the other two buckets. The uploader re-encodes
-- every file to a 1200x630 JPEG and refuses anything over 600 KB before it
-- ever reaches Storage, so this limit is a backstop against a bug in the
-- client, not a working constraint.
--
-- SVG is deliberately NOT allowed, the same call made for the branding
-- bucket: an SVG is a script-capable document and this bucket is
-- world-writable under the current MVP policy model.
--
-- Yes, world-writable is wrong. It is wrong identically for all three
-- buckets and it gets fixed as part of backlog item 1 (RLS), not here.
-- Making this one bucket stricter than its siblings would leave the same
-- hole open and cost a day of debugging why only promo uploads fail.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promo-images', 'promo-images', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Public read - promo-images" on storage.objects;
create policy "Public read - promo-images" on storage.objects for select
  using (bucket_id = 'promo-images');

drop policy if exists "Public write - promo-images" on storage.objects;
create policy "Public write - promo-images" on storage.objects for insert
  with check (bucket_id = 'promo-images');

drop policy if exists "Public update - promo-images" on storage.objects;
create policy "Public update - promo-images" on storage.objects for update
  using (bucket_id = 'promo-images');

-- Delete matters here, unlike a nice-to-have. Replacing a promo image
-- writes a new timestamped path and then removes the old one; without this
-- policy every replacement leaks a file and the bucket grows forever.
drop policy if exists "Public delete - promo-images" on storage.objects;
create policy "Public delete - promo-images" on storage.objects for delete
  using (bucket_id = 'promo-images');

-- ---------- Confirm ----------
select 'wa_campaigns.slug' as checked, count(*) as found
from information_schema.columns
where table_schema = 'public' and table_name = 'wa_campaigns' and column_name = 'slug'
union all
select 'wa_campaigns_slug_key', count(*)
from pg_indexes
where schemaname = 'public' and indexname = 'wa_campaigns_slug_key'
union all
select 'promo-images bucket', count(*)
from storage.buckets where id = 'promo-images'
union all
select 'promo-images policies', count(*)
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like '%promo-images%';
-- expect: 1, 1, 1, 4

-- ## 20260831_member_nickname.sql
-- ============================================================
-- MEMBER NICKNAME
-- Ported from blueheron-gms, 2026-08-31.
--
-- Purely additive. One nullable column, no default, no backfill,
-- nothing existing dropped or renamed. Safe to run during service,
-- and safe to run twice like the rest of this file.
--
-- WHY:
--   Front desk wants a short alias for a member (e.g. "Alif") that is
--   independent of members.full_name, which is staff-facing record
--   data synced from the linked guest at signup and not meant to be
--   casually edited. nickname is optional display-only text: the
--   Membership page shows it first and falls back to the existing
--   name (memberReadingName in js/membership.js) when it is empty.
-- ============================================================

alter table public.members
  add column if not exists nickname text;

comment on column public.members.nickname is
  'Optional short display alias, shown ahead of full_name on the Membership page. Never overwritten automatically.';

-- ---------- Confirm ----------
select 'members.nickname' as checked, count(*) as found
from information_schema.columns
where table_schema = 'public' and table_name = 'members' and column_name = 'nickname';
-- expect: 1

-- Rollback (only if nothing has been written yet):
--   alter table public.members
--     drop column if exists nickname;

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
