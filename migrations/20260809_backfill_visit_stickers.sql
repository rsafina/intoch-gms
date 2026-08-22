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
