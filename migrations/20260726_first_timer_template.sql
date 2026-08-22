-- ============================================================
-- BLUE HERON — "first_timer" BROADCAST TEMPLATE
-- Prod: YOUR_SUPABASE_PROJECT_REF
-- Date: 2026-07-26
--
-- WHY: the owner dashboard surfaces "N tamu baru yang belum kembali"
-- and its action now hands that exact population to Broadcast
-- (bcOpenFirstTimers in js/broadcast.js). None of the existing
-- templates fit that audience:
--
--   at_risk        says "sudah lama tidak berkunjung" — wrong for a
--                  guest who ate here five days ago
--   medium/high_   thanks them for being a loyal regular — wrong for
--   spender        someone who has visited exactly once
--
-- Sending either of those to a first-timer reads as a careless mass
-- mail, which is worse than sending nothing. Hence a template written
-- for the audience: it leads with the guest's actual visit date so it
-- cannot feel like a blast, and it never implies a long absence.
--
-- Placeholders used are all valid for the broadcast class
-- (BC_PLACEHOLDERS.broadcast): {nama}, {resto}, {tanggal_terakhir}.
-- No emoji, per the 2026-07-17 decision (the front-desk PC corrupts
-- them into "?").
--
-- Idempotent: on conflict do nothing, so re-running never overwrites
-- wording staff have since edited in the template editor.
-- ============================================================

insert into public.wa_templates (key, label, body, is_broadcast)
values (
  'first_timer',
  'Broadcast: Tamu Baru (belum kembali)',
  'Halo {nama}! Terima kasih sudah berkunjung ke {resto} pada ' ||
  '{tanggal_terakhir}. Senang sekali bisa melayani Bapak/Ibu, ' ||
  'dan kami harap masakan kami berkesan. ' ||
  'Kami tunggu kunjungan berikutnya ya!',
  true
)
on conflict (key) do nothing;
