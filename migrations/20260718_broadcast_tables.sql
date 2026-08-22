-- Broadcast feature migration — APPLIED TO PROD YOUR_SUPABASE_PROJECT_REF on 2026-07-18
-- (via MCP apply_migration: broadcast_wa_templates_outreach_log)
-- Verified after apply: 6 templates seeded, wa_outreach_log empty, guests.do_not_contact added (345 guests, all false).
-- All additive; safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

create table if not exists wa_templates (
  key text primary key,
  label text not null,
  body text not null check (length(trim(body)) > 0),
  is_broadcast boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists wa_outreach_log (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests(id) on delete cascade,
  template_key text not null,
  is_broadcast boolean not null default false,
  sent_at timestamptz not null default now(),
  sent_by text
);

create index if not exists idx_wa_outreach_log_guest_sent
  on wa_outreach_log (guest_id, sent_at desc);

alter table guests add column if not exists do_not_contact boolean not null default false;

insert into wa_templates (key, label, body, is_broadcast) values
  ('thank_you', 'Thank You (setelah kunjungan)',
   'Terima kasih atas kunjungan bapak/ibu di resto {resto} hari ini. Kami nantikan kedatangannya kembali di lain waktu!',
   false),
  ('follow_up', 'Follow Up (konfirmasi reservasi)',
   E'Halo {nama}!\n\nKami dari {resto} ingin mengonfirmasi reservasi Bapak/Ibu:\n\nTanggal: {tanggal}\nJam: {jam}\nJumlah: {pax} orang\n\nKami nantikan kehadiran dari anda di {resto}. Terima kasih!',
   false),
  ('at_risk', 'Broadcast: At Risk (lama tidak berkunjung)',
   'Halo {nama}! Sudah lama kami tidak melihat Bapak/Ibu di {resto} — kami rindu! Kami tunggu kedatangannya kembali ya. Terima kasih!',
   true),
  ('medium_spender', 'Broadcast: Medium Spender',
   'Halo {nama}! Terima kasih sudah menjadi pelanggan setia {resto}. Kami tunggu kunjungan berikutnya ya!',
   true),
  ('high_spender', 'Broadcast: High Spender',
   'Halo {nama}! Terima kasih sudah menjadi pelanggan istimewa {resto}. Suatu kehormatan bagi kami untuk selalu melayani Bapak/Ibu. Sampai jumpa di kunjungan berikutnya!',
   true),
  ('tag_default', 'Broadcast: Template Dasar Tag',
   'Halo {nama}! Ada info spesial dari {resto} untuk Bapak/Ibu. [ganti dengan isi promo]',
   true)
on conflict (key) do nothing;
