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
create trigger featured_dishes_updated_at
  before update on featured_dishes
  for each row execute function update_updated_at();

-- Same MVP security model as the rest of the schema (public policies,
-- staff auth handled app-side via staff_users PIN). Known debt — will be
-- tightened together with the other tables when we move to real auth.
alter table featured_dishes enable row level security;
drop policy if exists "Public full access - featured_dishes" on featured_dishes;
create policy "Public full access - featured_dishes"
  on featured_dishes for all
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
create policy "Public read - dish-images"
  on storage.objects for select
  using (bucket_id = 'dish-images');

drop policy if exists "Public write - dish-images" on storage.objects;
create policy "Public write - dish-images"
  on storage.objects for insert
  with check (bucket_id = 'dish-images');

drop policy if exists "Public update - dish-images" on storage.objects;
create policy "Public update - dish-images"
  on storage.objects for update
  using (bucket_id = 'dish-images');

drop policy if exists "Public delete - dish-images" on storage.objects;
create policy "Public delete - dish-images"
  on storage.objects for delete
  using (bucket_id = 'dish-images');

-- ---------- 4. SPENDING TIER READS SETTINGS ----------
-- Same logic as before; only the three constants now come from
-- app_settings.spending_tier (falling back to the old hardcoded values).
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
