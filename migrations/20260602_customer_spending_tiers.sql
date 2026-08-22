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
CREATE TRIGGER visits_recalculate_guest_spending_tier
  AFTER INSERT OR UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_guest_spending_tier();

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
