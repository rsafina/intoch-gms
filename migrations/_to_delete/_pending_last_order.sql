
-- ## 20260902_guest_last_order.sql
-- ============================================================
-- GUEST LAST ORDER
--
-- Purely additive. One nullable column, no default, no backfill, nothing
-- dropped or renamed. Safe to run during service and safe to run twice.
--
-- WHY:
--   `guests.favorite_menu` was doing two jobs. Its label in the app read
--   "Favorite Menu / Recent Order", and the Complete Visit modal wrote the
--   dish a guest had just eaten straight into it. So recording last night's
--   meal ERASED the dish that guest always orders, which is the more valuable
--   of the two and the one staff actually rely on when greeting someone.
--
--   Same shape as the "Completed" bug at Blue Heron: one field carrying two
--   meanings, and staff losing data by using the app normally.
--
--   After this:
--     favorite_menu  the dish they always order. Staff judgement, sticky,
--                    changed only deliberately.
--     last_order     what they had most recently. Overwritten by every
--                    Complete Visit.
--
--   No backfill. An existing favorite_menu value stays where it is: it may be
--   either meaning, and guessing which would corrupt the field this change
--   exists to protect. Last order simply starts empty and fills up as visits
--   are completed.
-- ============================================================

alter table public.guests
  add column if not exists last_order text;

comment on column public.guests.last_order is
  'What this guest ordered on their most recent completed visit. Overwritten each time. Distinct from favorite_menu, which is their usual and only changes deliberately.';

-- ---------- Confirm ----------
select 'guests.last_order' as checked, count(*) as found
from information_schema.columns
where table_schema = 'public' and table_name = 'guests' and column_name = 'last_order';
-- expect: 1

-- Rollback (only if nothing has been written yet):
--   alter table public.guests drop column if exists last_order;
