-- ============================================================
-- BLUE HERON — RESERVATION REMINDER ACKNOWLEDGEMENT
-- Prod: YOUR_SUPABASE_PROJECT_REF
-- Date: 2026-08-21
--
-- Purely additive. Four nullable columns, no defaults, no backfill,
-- nothing existing dropped or renamed. Safe to run during service.
--
-- WHY:
--   follow_up_done answers "has FO contacted this guest at all?" — a
--   once-per-booking question, asked as soon as the online form lands.
--   It cannot also carry "has FO re-checked attendance for tomorrow?"
--   and "…for today?", because those are asked LATER and asking them
--   must not be blocked by the first question already being answered.
--   One flag would mean either the reminder never fires (already done)
--   or unticking follow-up to make it fire again (destroys the record
--   of the original follow-up).
--
--   So: three independent acknowledgements per booking.
--     follow_up_done        — FO contacted the guest after they booked
--     reminder_d1_ack_at    — FO re-checked attendance on D-1
--     reminder_dday_ack_at  — FO re-checked attendance on D-day
--
--   Acking D-1 deliberately does NOT ack D-day. That is the whole point
--   of two columns: the guest confirmed yesterday is still asked about
--   again on the day itself.
--
--   Like follow_up_done these live in the DB, not localStorage, so the
--   state is shared across front-desk PCs and survives a machine being
--   off overnight. See js/notify.js for the query side.
-- ============================================================

alter table public.reservations
  add column if not exists reminder_d1_ack_at timestamptz,
  add column if not exists reminder_d1_ack_by uuid references public.staff_users(id),
  add column if not exists reminder_dday_ack_at timestamptz,
  add column if not exists reminder_dday_ack_by uuid references public.staff_users(id);

comment on column public.reservations.reminder_d1_ack_at is
  'FO marked the day-before attendance reminder as read. Independent of follow_up_done and of reminder_dday_ack_at.';

comment on column public.reservations.reminder_dday_ack_at is
  'FO marked the day-of attendance reminder as read. Independent of follow_up_done and of reminder_d1_ack_at.';

-- Rollback (only if nothing has been written yet):
--   alter table public.reservations
--     drop column if exists reminder_d1_ack_at,
--     drop column if exists reminder_d1_ack_by,
--     drop column if exists reminder_dday_ack_at,
--     drop column if exists reminder_dday_ack_by;
