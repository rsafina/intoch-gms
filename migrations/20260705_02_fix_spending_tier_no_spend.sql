-- Fix (found during staging QA 5 Jul): guests with ZERO spend visits were
-- classified as medium_spender. BOOL_OR over zero rows = NULL, so the
-- "no spend -> no tier" early exit never fired. Bug exists in PROD's
-- function too. Run this on the new prod AFTER the schema + data copy.

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
