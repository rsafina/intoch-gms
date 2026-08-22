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
