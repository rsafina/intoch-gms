-- ============================================================
-- BLUE HERON GUEST BOOK — SUPABASE SQL SCHEMA
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: areas
-- ============================================================
CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: tables
-- ============================================================
CREATE TABLE tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tables_area_id ON tables(area_id);
CREATE INDEX idx_tables_name ON tables(LOWER(name));

-- ============================================================
-- TABLE: staff_users
-- ============================================================
CREATE TABLE staff_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  pin TEXT NOT NULL CHECK (pin ~ '^[0-9]{4}$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_users_username ON staff_users(LOWER(username));

-- ============================================================
-- TABLE: guests
-- ============================================================
CREATE TABLE guests (
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

CREATE INDEX idx_guests_phone ON guests(phone);
CREATE INDEX idx_guests_name ON guests(LOWER(name));
CREATE INDEX idx_guests_company ON guests(LOWER(company));
CREATE INDEX idx_guests_spending_tier ON guests(spending_tier);
CREATE INDEX idx_guests_tier_source ON guests(tier_source);

-- ============================================================
-- TABLE: reservations
-- ============================================================
CREATE TABLE reservations (
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

CREATE INDEX idx_reservations_date ON reservations(reservation_date);
CREATE INDEX idx_reservations_guest ON reservations(guest_id);
CREATE INDEX idx_reservations_status ON reservations(status);

-- ============================================================
-- TABLE: visits
-- ============================================================
CREATE TABLE visits (
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

CREATE INDEX idx_visits_guest ON visits(guest_id);
CREATE INDEX idx_visits_date ON visits(visit_date);
CREATE INDEX idx_visits_voided_at ON visits(voided_at) WHERE voided_at IS NOT NULL;
CREATE INDEX idx_reservations_deleted_at ON reservations(deleted_at) WHERE deleted_at IS NOT NULL;

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

CREATE TRIGGER guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

CREATE TRIGGER visits_recalculate_guest_spending_tier
  AFTER INSERT OR UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_guest_spending_tier();

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

CREATE POLICY "Authenticated full access - guests"
  ON guests FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access - reservations"
  ON reservations FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access - visits"
  ON visits FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access - areas"
  ON areas FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Anon read for areas (host stand doesn't need login for areas)
CREATE POLICY "Public read - areas"
  ON areas FOR SELECT
  USING (true);

-- Public browser access for the guest book MVP.
CREATE POLICY "Public full access - guests"
  ON guests FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public full access - reservations"
  ON reservations FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public full access - visits"
  ON visits FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public full access - prizes"
  ON prizes FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public full access - spin_submissions"
  ON spin_submissions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public full access - saved_segments"
  ON saved_segments FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- SEED DATA: Areas
-- ============================================================
INSERT INTO areas (name, capacity) VALUES
  ('Indoor Dining', 80),
  ('Outdoor Dining', 60),
  ('VIP Room A', 20),
  ('VIP Room B', 16);

-- ============================================================
-- SEED DATA: Sample Guests
-- ============================================================
INSERT INTO guests (name, phone, gender, company, preference, notes) VALUES
  ('Andika Pratama', '081234567890', 'Male', 'PT Astra International', 'Window seat, no spicy food', 'Prefers quiet areas'),
  ('Sari Dewi', '082345678901', 'Female', NULL, 'Outdoor seating', 'Regular Friday diner'),
  ('Budi Santoso', '083456789012', 'Male', 'Bank Mandiri', 'VIP Room', 'Corporate events only'),
  ('Ratna Kusuma', '084567890123', 'Female', NULL, NULL, 'Celebrates birthday in July'),
  ('Hendra Wijaya', '085678901234', 'Male', 'Gojek Indonesia', 'Indoor, near bar', 'Tech company team lunches');

-- ============================================================
-- SEED DATA: Sample Reservations (today + upcoming)
-- ============================================================
-- Note: run after guests are inserted; use subquery for guest_id
INSERT INTO reservations (guest_id, reservation_date, reservation_time, pax, occasion, status, notes)
SELECT id, CURRENT_DATE, '19:00', 4, 'Anniversary', 'Confirmed', 'Flower arrangement requested'
FROM guests WHERE phone = '081234567890';

INSERT INTO reservations (guest_id, reservation_date, reservation_time, pax, status)
SELECT id, CURRENT_DATE, '20:30', 2, 'Reserved'
FROM guests WHERE phone = '082345678901';

INSERT INTO reservations (guest_id, reservation_date, reservation_time, pax, occasion, status, notes)
SELECT id, CURRENT_DATE, '12:00', 10, 'Business Lunch', 'Confirmed', 'Corporate billing to Bank Mandiri'
FROM guests WHERE phone = '083456789012';

-- Existing databases: run once if the column is not present yet
-- ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reservation_source TEXT;
