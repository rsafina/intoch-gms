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
