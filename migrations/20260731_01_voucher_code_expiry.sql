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
