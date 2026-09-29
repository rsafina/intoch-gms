# Approved demo copy review - 2026-09-29

Approved wording retained, including exceptions to the general wording guidelines.

Subsequent user-approved name update: Dewi is Michelle, Rina is Noelle, Sari is Jessica,
Andi is Daniel, Bima is John, and Bayu is Brian throughout runtime copy and animations.
The original approved-copy quotations and mismatch notes below describe the earlier
copy review; this name update supersedes their character names.

Copy-only update on `demo`. Existing scene IDs/order, routes, fictional guests, layout,
styles, camera, timing and playback behavior remain unchanged. Existing note placement
is preserved (Membership note remains on step 2); Walk-in has no note.

Title maps to existing `title` and `keyMessage` fields; subtitle maps to `problem`.
Browser title and description inherit those fields. Accessible step titles/ARIA labels
use the first sentence of each approved step. All requested callout groups are updated.

## Preserved mismatches and existing text

- Campaign still filters At Risk (>60 days) and targets Dewi/Rina; approved steps describe
  New Comer/Pelanggan Baru. No audience logic was changed.
- Reservation name mismatch resolved: form, confirmation, booking notification and profile
  now show Michelle. Dewi remains in the other stories, including Follow Up.
- Walk-in steps still show visit A3 and Bayu's profile, not adding notes and changing tables.
- At Risk filter is strictly greater than 60 days, whereas approved copy says starting at 60.
- Full Journey has no message-history display proving the subtitle's claim that every
  message is stored in the profile; no storage behavior was added.
- No typewriter subtitle implementation exists. A subsequent user-requested parity fix
  places the title in the header and subtitle in the body on both desktop and mobile;
  the subtitle is no longer hidden on mobile.
- Static Open Graph text remains the generic library preview, as before; no route-specific
  social metadata generator was introduced.
- Real screen labels (Database Tamu, Profil Tamu, Buat Campaign, Follow-up Reservasi,
  form labels and statuses), fictional names, existing short category/step labels,
  library introduction, contact CTA and callouts without approved replacements remain.
  These preserve existing product vocabulary and identifiers; this is not a global
  replacement of every occurrence of tamu, audiens or konteks.
- Approved exceptions such as customer/new comer, relevan, terhubung and Follow up with
  lowercase campaign were kept verbatim; explicit approved copy takes precedence over
  the general wording guidance. Lowercase standalone anda is normalized to Anda.

## Validation

- All nine stories and direct routes checked, including refresh, step restart, pause,
  replay, completion, reduced motion and automatic camera handoff.
- Existing full test runner: 91 suites, zero failures. Syntax and diff checks pass.
- Existing build-config.js run in an isolated temporary template copy: seven outputs.
- Browser viewport checks: 1440x900, 1280x720, 393x852, 320x640; no horizontal overflow,
  and the stage, caption and controls remain together. No layout edits were needed.
- Existing code replaces the old marketing strings; historical docs are not runtime copy.

## Copy exceeding length guidelines

| Demo | Field | Length / guideline | Approved copy |
|---|---|---|---|
| customer-database | Catatan | 127 / 120 | Total belanja pelanggan dapat ditambahkan di data kunjungan dan menjadi 'spending behavior' yang dapat digunakan di masa depan. |
| reactivation | Subjudul | 86 / 72 | Temukan pelanggan yang lama belum kembali, dan berikan perhatian lewat pesan WhatsApp. |
| reactivation | Catatan | 127 / 120 | Dengan Intoch, data pelanggan menjadi milik Anda sepenuhnya, dan dapat Anda manfaatkan untuk menciptakan Customer Relationship. |
| reactivation | Langkah 3 | 104 / 100 | Follow up dengan campaign, siapkan pesan ajakan repeat order dan kirim secara personal melalui WhatsApp. |
| campaign | Judul | 73 / 60 | Berhenti bagikan pesan broadcast yang sama ke semua leads pelanggan Anda. |
| campaign | Subjudul | 108 / 72 | Kirimkan broadcast marketing yang relevan dengan history visit, data spending, atau event spesial pelanggan. |
| campaign | Langkah 1 | 128 / 100 | Ada pelanggan new comer, ada loyal customer dan ada yang lama tidak repeat order. Tentu, marketing broadcastnya tidak bisa sama. |
| campaign | Langkah 2 | 140 / 100 | Contoh, Anda ingin pelanggan 'New Comer' untuk berkunjung kedua kalinya. Anda bisa membuat campaign dengan target kategori 'Pelanggan Baru'. |
| walk-in | Judul | 63 / 60 | Dapatkan data pelanggan walk-in, tanpa membuat mereka menunggu. |
| reservation | Judul | 84 / 60 | Mudahkan Reservasi Pelanggan dengan Online Form, Simpan dan Manfaatkan Data Kemudian |
| reservation | Subjudul | 83 / 72 | Setiap data kunjungan terakumulasi, on track dan jadi database yang siap digunakan. |
| reservation | Langkah 1 | 107 / 100 | Michelle klik link form reservasi, kemudian isi nama, nomor WhatsApp, pilih tanggal, waktu, dan jumlah pax. |
| follow-up | Subjudul | 73 / 72 | Tim tahu booking mana yang sudah dan belum dihubungi, tanpa saling tanya. |
