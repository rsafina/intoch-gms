-- ============================================================
-- Voucher card: WhatsApp template seed
-- Date: 2026-07-31
--
-- Transactional (is_broadcast = false): the guest earned this voucher,
-- so it is immune to do_not_contact and never counts towards the
-- 5-day resend warning — same class as thank_you / follow_up.
--
-- Idempotent: an existing row is left ALONE, so a template staff have
-- already edited is never overwritten by a re-run.
-- ============================================================

INSERT INTO wa_templates (key, label, body, is_broadcast, updated_at)
VALUES (
  'voucher_ready',
  'Voucher (kirim ke member)',
  'Halo {nama}!' || chr(10) || chr(10) ||
  'Selamat, Bapak/Ibu mendapatkan voucher belanja {nominal} dari {resto} sebagai apresiasi atas kunjungan yang selalu setia.' || chr(10) || chr(10) ||
  'Kode voucher: {kode}' || chr(10) ||
  'Berlaku sampai: {berlaku}' || chr(10) || chr(10) ||
  'Cukup tunjukkan voucher ini kepada staf kami saat pembayaran. Kami tunggu kunjungan berikutnya!',
  false,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- Verify:
-- SELECT key, is_broadcast, left(body, 40) FROM wa_templates ORDER BY key;
