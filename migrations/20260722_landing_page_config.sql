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
