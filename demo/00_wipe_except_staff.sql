-- ============================================================
-- DEMO RESET: wipe all guest data, keep staff and configuration
-- ============================================================
-- ⚠️  THIS DELETES EVERY GUEST, VISIT, RESERVATION, MEMBER AND VOUCHER.
--     There is no undo. Never run it on a restaurant's live database.
--
-- Intended for a demo/presentation database that you are about to re-seed
-- with 01_seed_3_months.sql.
--
-- ── What is KEPT ──────────────────────────────────────────────────────
--   staff_users       your logins. Wiping these locks you out of your own app
--   areas, tables     the floor plan you built. Reservations need tables to
--                     point at, so wiping them would break the demo you are
--                     about to seed
--   app_settings      thresholds, branding, invoice and voucher design
--   wa_templates      your WhatsApp wording
--   prizes            the spin wheel
--   featured_dishes   the menu shown on the booking page
--
-- "Everything except staff" read literally would include the floor plan and
-- your settings. That is almost certainly not what you want two hours before
-- a presentation, so configuration stays. There is a block at the bottom,
-- commented out, if you really do want a bare database.
--
-- ── What is WIPED ─────────────────────────────────────────────────────
--   guests, visits, reservations, members and their transactions and
--   vouchers, standalone vouchers, spin submissions, campaigns and their
--   audiences, the WhatsApp outreach log, birthday greetings, saved segments.
--
-- ── The safety catch ──────────────────────────────────────────────────
-- This file refuses to run as pasted. To arm it, UNCOMMENT the `set` line
-- immediately below. That one deliberate act is the difference between
-- reading this file and destroying a database with it.

-- set demo.confirm = 'WIPE-EVERYTHING-EXCEPT-STAFF';

do $$
begin
  if coalesce(current_setting('demo.confirm', true), '') <> 'WIPE-EVERYTHING-EXCEPT-STAFF' then
    raise exception
      E'Refusing to run.\n\nThis script deletes every guest, visit, reservation, member and voucher in this database.\n\nIf that is what you want, uncomment the `set demo.confirm = ...` line near the top of this file and run it again.\n\nIf you are looking at a live restaurant database, close this file.';
  end if;
end $$;

-- Show what is about to go, so the numbers are on screen BEFORE the delete
-- rather than only afterwards.
select 'guests' as table_name, count(*) as rows_about_to_be_deleted from guests
union all select 'visits', count(*) from visits
union all select 'reservations', count(*) from reservations
union all select 'members', count(*) from members
union all select 'member_transactions', count(*) from member_transactions
union all select 'member_vouchers', count(*) from member_vouchers
union all select 'standalone_vouchers', count(*) from standalone_vouchers
union all select 'spin_submissions', count(*) from spin_submissions
union all select 'wa_campaigns', count(*) from wa_campaigns
union all select 'wa_campaign_audience', count(*) from wa_campaign_audience
union all select 'wa_outreach_log', count(*) from wa_outreach_log
union all select 'birthday_greetings', count(*) from birthday_greetings
union all select 'saved_segments', count(*) from saved_segments
order by 1;

-- One TRUNCATE listing every table explicitly, rather than relying on
-- CASCADE to reach them. CASCADE would work, but it would also silently
-- reach anything added to the schema later — and a delete that quietly grows
-- its own scope is not something to leave in a file marked "demo".
--
-- RESTART IDENTITY resets the bigint sequences on members and their
-- transactions, so a re-seed starts at member number 1 again instead of
-- carrying on from wherever the last demo ended.
truncate table
  birthday_greetings,
  member_vouchers,
  member_transactions,
  members,
  standalone_vouchers,
  spin_submissions,
  wa_campaign_audience,
  wa_outreach_log,
  wa_campaigns,
  saved_segments,
  visits,
  reservations,
  guests
restart identity;

-- ---------- Confirm ----------
select 'guests' as table_name, count(*) as rows_now from guests
union all select 'visits', count(*) from visits
union all select 'reservations', count(*) from reservations
union all select 'members', count(*) from members
union all select 'STAFF KEPT (should be > 0)', count(*) from staff_users
union all select 'AREAS KEPT (should be > 0)', count(*) from areas
union all select 'TABLES KEPT', count(*) from tables
union all select 'SETTINGS KEPT (should be > 0)', count(*) from app_settings
union all select 'WA TEMPLATES KEPT', count(*) from wa_templates
order by 1;


-- ============================================================
-- OPTIONAL: also wipe the configuration
-- ============================================================
-- Only if you want a genuinely bare database — a fresh client onboarding
-- rehearsal, for example. Note that this deletes your floor plan, so
-- 01_seed_3_months.sql will have no tables to seat anyone at, and your
-- branding, thresholds and invoice design all go back to defaults.
--
-- staff_users is NOT in this list either. Losing every login means losing
-- access to the app, and the only way back is the SQL editor.
--
--   truncate table featured_dishes, prizes restart identity;
--   truncate table tables, areas restart identity cascade;
--   delete from app_settings;
--   delete from wa_templates;
--   -- then re-run migrations/ALL_IN_ONE.sql to restore the seeded defaults.
