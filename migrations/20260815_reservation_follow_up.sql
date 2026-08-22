-- ============================================================
-- BLUE HERON — RESERVATION FOLLOW-UP TRACKING
-- Prod: YOUR_SUPABASE_PROJECT_REF
-- Date: 2026-08-15
--
-- Purely additive. Nothing existing is dropped or renamed.
--
-- WHY (incident 2026-08-15):
--   Two online-form reservations (Bob, Ratih Prajna Paramita) got no
--   staff follow-up because the "new reservation" bell was purely a
--   live Postgres Realtime listener + per-browser localStorage cache.
--   If no dashboard tab was connected at the exact moment a booking
--   came in (e.g. before opening hours), or the day rolled over before
--   anyone opened the panel, the reservation left no trace anywhere —
--   not a missed alert, an alert that never existed.
--
--   Fix: give follow-up status a durable, shared home in the database
--   itself, so the bell/list is a live query ("today's Online Form
--   reservations, follow-up pending") rather than a cache of events a
--   browser happened to catch. See js/notify.js for the query-side fix.
-- ============================================================

alter table public.reservations
  add column if not exists follow_up_done boolean not null default false,
  add column if not exists follow_up_done_at timestamptz,
  add column if not exists follow_up_done_by uuid references public.staff_users(id);

comment on column public.reservations.follow_up_done is
  'Whether staff have followed up on this booking (currently tracked for Online Form reservations). Shared across devices — not a per-browser flag.';
