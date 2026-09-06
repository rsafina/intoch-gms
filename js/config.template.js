// ============================================================
// INTOCH — Supabase Config & Utilities
// ============================================================

// GENERATED FILE — do not edit js/config.js directly and do not commit it.
// Edit js/config.template.js instead. `node build-config.js` fills the two
// placeholders below from the SUPABASE_URL / SUPABASE_ANON_KEY environment
// variables set per client in the hosting dashboard.
const IS_STAGING = false;
const SUPABASE_URL = "__SUPABASE_URL__";
const SUPABASE_ANON_KEY =
  "__SUPABASE_ANON_KEY__";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Host that serves this deployment's promo pages (/p/<slug>). Leave null
// when the staff app and the promo pages are on the same site, which is the
// normal setup — campaign.js then uses the app's own host. Set it only when
// the two are split across hosts.
const PROMO_HOST = null;

// The restaurant's own name, used in WhatsApp messages, voucher cards and
// invoices. Reads app_settings.restaurant_name once settings have loaded, so
// each client sees their own name without a code change. The fallback is
// deliberately generic: if it ever shows up in a real message, it reads as a
// misconfiguration rather than as another restaurant's brand.
function restaurantName() {
  try {
    if (
      typeof APP_SETTINGS !== "undefined" &&
      APP_SETTINGS &&
      APP_SETTINGS.restaurant_name
    ) {
      return String(APP_SETTINGS.restaurant_name);
    }
  } catch (_) {}
  return "Restoran";
}

// ── DEV MODE (2026-07-18) ────────────────────────────────────
// Auto-detected when the app runs from localhost / a local file
// (live-reload development). Never true on Netlify. In dev mode:
// - realtime subscription + periodic auto-refresh timers are skipped
// - queries that opt in via devCacheKey are served from a short
//   sessionStorage cache, so rapid live-reload saves cost ~zero egress
const IS_DEV =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
  window.location.protocol === "file:";
const DEV_CACHE_TTL_MS = 60 * 1000; // 1 minute — dev only

if (IS_DEV) {
  // The on-screen "DEV" pill was removed 2026-07-26 (Rere) — it overlapped
  // the sidebar footer and looked like part of the product. Dev mode is still
  // announced in the console, which is where a developer is already looking;
  // nothing about the caching/realtime behaviour changed.
  console.info(
    "%cDEV MODE: realtime + auto-refresh off, cacheable queries served from sessionStorage (TTL 60s)",
    "color:#C77700;font-weight:bold",
  );
}

// Visual staging marker so nobody mistakes this for the live app
if (typeof IS_STAGING !== "undefined" && IS_STAGING) {
  document.addEventListener("DOMContentLoaded", () => {
    document.title = "[STAGING] " + document.title;
    const banner = document.createElement("div");
    banner.textContent = "STAGING — test environment, not live data";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;background:#B7791F;color:#fff;text-align:center;font-size:11px;font-weight:600;letter-spacing:.08em;padding:2px 0;text-transform:uppercase;";
    document.body.appendChild(banner);
  });
}
const STAFF_SESSION_KEY = "intochStaffUser";

// ============================================================
// LANGUAGE / TRANSLATION (ID default, EN toggle)
// ============================================================
// Design: rather than inventing short translation keys everywhere, the
// dictionary is keyed by the ORIGINAL ENGLISH STRING as authored in the
// code/HTML. t("Some English Text") returns the Indonesian translation
// when CURRENT_LANG === "id", or the original string in "en" mode or if
// no translation exists yet (safe fallback — never shows a blank label).
// Persisted per-browser (front-desk PC), not per staff account.
const LANG_STORAGE_KEY = "gms_lang";
let CURRENT_LANG =
  localStorage.getItem(LANG_STORAGE_KEY) === "en" ? "en" : "id";

// Terms that must ALWAYS stay in English, even in Indonesian mode —
// per product decision, these are treated as fixed product/domain terms
// rather than translatable UI copy.
const I18N_EXCEPTION_TERMS = new Set([
  "At risk",
  "Returning",
  "Retain",
  "Visit",
  "Visits",
  "High Spender",
  "Medium Spender",
  "VIP",
  "Quick Walk In",
  "Quick Walk-In",
]);

// Nav labels (and their matching page <h1> titles) kept in English by
// product decision (2026-07-17) — Dashboard, Membership, Reservations,
// Walk-Ins read as awkward/unfamiliar when translated, unlike
// Guests/Areas/Reports/Prizes. Unlike I18N_EXCEPTION_TERMS above (which
// blocks translation of that exact string EVERYWHERE), these are scoped to
// specific elements via the data-i18n-skip attribute in index.html, so the
// same word elsewhere (e.g. the "Reservations" column header on the Reports
// page) still translates normally. See i18nTranslateTree() in js/i18n.js.

// Indonesian translations, keyed by the English source string.
const ID_DICT = {
  // ── Area conditions + booking limits (added 2026-09-04) ───
  // Identity mappings are omitted on purpose; see the note above.
  "Booking limits": "Batas reservasi",
  "Bookable online": "Bisa dipesan online",
  "Largest party": "Jumlah tamu terbanyak",
  "Book up to (days ahead)": "Bisa pesan sampai (hari ke depan)",
  "A party larger than this is told to contact you on WhatsApp instead. Raise it if you want big groups to book online themselves.":
    "Rombongan yang lebih besar dari ini akan diminta menghubungi Anda via WhatsApp. Naikkan angkanya jika Anda ingin rombongan besar memesan sendiri secara online.",
  "Guests can book this area online": "Tamu bisa memesan area ini secara online",
  "Off by default. While no area is switched on, the booking form does not ask guests to choose one and works exactly as it does today.":
    "Mati secara default. Selama belum ada area yang diaktifkan, form reservasi tidak meminta tamu memilih area dan tetap berjalan seperti sekarang.",
  "Minimum guests": "Minimum tamu",
  "Minimum spend (Rp)": "Minimum belanja (Rp)",
  // "Deposit (Rp)" is deliberately absent: it is identical in both languages
  // and an identity mapping self-feeds through the MutationObserver.
  "Leave any of these blank for no rule. Guests see them on the booking form before they choose.":
    "Kosongkan jika tidak ada aturan. Tamu melihat ketentuan ini di form reservasi sebelum memilih.",
  "Minimum guests must be 1 or more": "Minimum tamu harus 1 atau lebih",
  "This deposit is larger than the minimum spend.":
    "Deposit ini lebih besar dari minimum belanja.",
  "Staff only": "Khusus staf",
  "Nothing was saved. The area may have been deleted, or the database refused the change.":
    "Tidak ada yang tersimpan. Area mungkin sudah dihapus, atau database menolak perubahan.",
  "Saved, but the database did not keep the online booking settings.":
    "Tersimpan, tapi database tidak menyimpan pengaturan pemesanan online.",
  "Needs deposit": "Perlu deposit",
  "Minimum guests cannot be higher than the seats in this area":
    "Minimum tamu tidak boleh lebih besar dari jumlah kursi di area ini",
  // ── Day run sheet (added 2026-09-04) ──────────────────────
  // Only words that actually CHANGE are listed. "Pax", "Area", "Deposit"
  // and "DP" are the same in both languages and are deliberately absent:
  // i18nTranslate() returns a value for any key it finds and
  // i18nTranslateTree() then assigns it to nodeValue, so an identity
  // mapping rewrites the node with the value it already had. The
  // MutationObserver in i18n.js reschedules a full re-translate on any
  // mutation, which makes an identity entry a self-feeding loop with no
  // fixpoint. A word that is already correct needs no entry at all.
  // "Close", "Notes", "reservations", "Not yet placed" and "pax" are
  // already in this dictionary further down and are not repeated here:
  // a duplicate key is silently the last one to win.
  "Day Run Sheet": "Lembar Harian",
  "Run Sheet": "Lembar Harian",
  "Could not load the run sheet.": "Gagal memuat lembar harian.",
  "No bookings for this day.": "Tidak ada reservasi untuk hari ini.",
  Print: "Cetak",
  Printed: "Dicetak",
  Time: "Jam",
  Name: "Nama",
  Table: "Meja",
  // ── Invoice design (added 2026-08-23) ─────────────────────────────
  "Build Invoice": "Buat Invoice",
  "Invoice Design": "Desain Invoice",
  Colours: "Warna",
  "The text on the blue bars is not listed here: it picks white or dark by itself depending on how light the bar colour is, so a Total line can never come out invisible.":
    "Warna tulisan di atas bar tidak diatur di sini: otomatis memilih putih atau gelap tergantung terangnya warna bar, jadi baris Total tidak akan pernah jadi tidak terbaca.",
  Ink: "Tinta",
  "Headings, figures, guest details": "Judul, angka, dan data tamu",
  Bars: "Bar",
  "Table header, totals bar, rules": "Kepala tabel, bar total, dan garis",
  Frame: "Bingkai",
  "The border around the page": "Garis tepi halaman",
  "Row fill": "Isi baris",
  "Item rows and the paid bar": "Baris item dan bar sudah dibayar",
  "Secondary text": "Teks sekunder",
  "Totals labels and the footer": "Label total dan bagian bawah",
  "Logo sizes": "Ukuran logo",
  "Main logo width": "Lebar logo utama",
  "Footer mark width": "Lebar ikon bawah",
  "Both images come from Settings > Branding, so they only have to be uploaded once. Only the size is set here.":
    "Kedua gambar diambil dari Pengaturan > Branding, jadi cukup diunggah sekali. Di sini hanya ukurannya yang diatur.",
  "Footer details": "Detail bagian bawah",
  "Printed along the bottom of every invoice. Anything left empty is left out entirely, separators and all.":
    "Dicetak di bagian bawah setiap invoice. Yang dikosongkan tidak akan ditampilkan sama sekali, termasuk tanda pemisahnya.",
  Address: "Alamat",
  "Reservation phone": "Nomor reservasi",
  // "Instagram" is already in this dictionary further down and translates to
  // itself. Not added twice: a duplicate key is silently dropped and the two
  // copies then drift apart.
  "Footer preview": "Pratinjau bagian bawah",
  "Nothing filled in yet — the footer will be blank.":
    "Belum ada yang diisi — bagian bawah akan kosong.",
  "The sheet on the Build tab updates as you change these, so switch across to see a full page before saving.":
    "Halaman invoice di tab Buat ikut berubah saat Anda mengubah ini, jadi pindah ke sana untuk melihat satu halaman penuh sebelum menyimpan.",
  "Invoice design saved": "Desain invoice disimpan",
  "Only a manager can change the invoice design":
    "Hanya manager yang bisa mengubah desain invoice",
  "Put the invoice design back to the built-in one? The address is kept.":
    "Kembalikan desain invoice ke bawaan? Alamat tetap dipertahankan.",

  // ── Areas, tables and import (added 2026-08-23) ───────────────────
  "Areas & Tables": "Area & Meja",
  "Create the rooms and sections first, then add the tables inside each one.":
    "Buat ruangan dan bagiannya dulu, lalu tambahkan meja di dalam masing-masing.",
  "Add Area": "Tambah Area",
  "Edit Area": "Ubah Area",
  "Create Area": "Buat Area",
  "Add the first area": "Tambah area pertama",
  "No areas yet.": "Belum ada area.",
  "An area is a room or section of the restaurant: Indoor, Terrace, VIP Room. Tables belong to one.":
    "Area adalah ruangan atau bagian dari restoran: Indoor, Teras, VIP Room. Setiap meja berada di salah satunya.",
  "Area name *": "Nama area *",
  "A room or section of the restaurant. Guests see this when they pick where to sit.":
    "Ruangan atau bagian dari restoran. Tamu melihat ini saat memilih tempat duduk.",
  "Seats in this area *": "Jumlah kursi di area ini *",
  "Total covers, used by the capacity cards. This is the number the room actually holds, not the sum of the tables you happen to have set up today.":
    "Total kursi, dipakai di kartu kapasitas. Ini kapasitas ruangannya, bukan jumlah kursi dari meja yang kebetulan tersusun hari ini.",
  "Area name is required (min 2 characters)": "Nama area wajib diisi (min 2 karakter)",
  "Seats must be 0 or more": "Jumlah kursi minimal 0",
  "An area with that name already exists": "Area dengan nama itu sudah ada",
  "Area created": "Area dibuat",
  "Area updated": "Area diperbarui",
  "Area deleted": "Area dihapus",
  "Delete this area?": "Hapus area ini?",
  "Failed to save area": "Gagal menyimpan area",
  "Failed to delete area": "Gagal menghapus area",
  "Only a manager can change areas": "Hanya manager yang bisa mengubah area",
  "This area still has tables used by reservations, so it cannot be deleted. Deactivate the tables instead.":
    "Area ini masih punya meja yang dipakai di reservasi, jadi tidak bisa dihapus. Nonaktifkan mejanya saja.",
  seats: "kursi",
  Import: "Impor",
  "Import Areas & Tables": "Impor Area & Meja",
  "Nothing is written until you press Add. Anything that already exists is skipped, so re-importing a corrected file is safe.":
    "Tidak ada yang disimpan sampai Anda menekan Tambahkan. Yang sudah ada akan dilewati, jadi mengimpor ulang file yang sudah diperbaiki tetap aman.",
  "Quick add by range": "Tambah cepat pakai rentang",
  "Add to list": "Tambahkan ke daftar",
  "A1-A12 becomes twelve tables. T01-T08 keeps the leading zero. Commas work too.":
    "A1-A12 menjadi dua belas meja. T01-T08 tetap memakai angka nol di depan. Bisa juga dipisah koma.",
  "Or paste a spreadsheet": "Atau tempel dari spreadsheet",
  "Copy straight out of Excel, or pick a .csv or .xlsx file. A header row is detected if there is one.":
    "Salin langsung dari Excel, atau pilih file .csv atau .xlsx. Baris judul akan dikenali otomatis kalau ada.",
  "What will happen": "Yang akan terjadi",
  "Clear list": "Kosongkan daftar",
  "Add them": "Tambahkan",
  "Nothing queued yet. Paste a list, pick a file, or add a range above.":
    "Belum ada yang antre. Tempel daftar, pilih file, atau tambahkan rentang di atas.",
  "Nothing to import. Check the pasted text.": "Tidak ada yang bisa diimpor. Cek teks yang ditempel.",
  "Nothing to import. Check the file.": "Tidak ada yang bisa diimpor. Cek isi filenya.",
  "Use a CSV or Excel file.": "Gunakan file CSV atau Excel.",
  "Could not read that Excel file. Try saving it as CSV.":
    "File Excel itu tidak bisa dibaca. Coba simpan sebagai CSV.",
  "Could not load the Excel reader. Save the file as CSV and try again.":
    "Pembaca Excel gagal dimuat. Simpan file sebagai CSV lalu coba lagi.",
  "Pick or type an area first": "Pilih atau ketik areanya dulu",
  "Type table names, e.g. A1-A12": "Ketik nama meja, misalnya A1-A12",
  "to add": "akan ditambah",
  "already there": "sudah ada",
  unusable: "tidak terpakai",
  "New areas": "Area baru",
  ADD: "TAMBAH",
  EXISTS: "SUDAH ADA",
  INVALID: "TIDAK VALID",
  "Failed to create areas": "Gagal membuat area",
  "Failed to create tables": "Gagal membuat meja",

  // ── Reservation form appearance + voucher card design (2026-08-23) ──
  "Reservation Form": "Formulir Reservasi",
  "Everything a guest sees on the online booking page: how it looks, the dishes you feature, and where the full menu lives":
    "Semua yang dilihat tamu di halaman reservasi online: tampilannya, menu yang ditonjolkan, dan di mana menu lengkap berada",
  "Page Appearance": "Tampilan Halaman",

  // -- Settings > Reservation Form > Fields on the Form (2026-09-06) --
  // The welcome line a client types is NOT in here and must never be: it is
  // their own words, printed as typed in whatever language they wrote it.
  "Fields on the Form": "Kolom di Formulir",
  "Which optional boxes a guest fills in, and the line under the page title. Name, phone, date, time and party size are always shown: the booking cannot be taken without them.":
    "Kolom opsional yang diisi tamu, dan kalimat di bawah judul halaman. Nama, nomor HP, tanggal, jam dan jumlah orang selalu ditampilkan: reservasi tidak bisa diproses tanpa itu.",
  "Notes box": "Kolom Catatan",
  "Where a guest asks for a highchair, a birthday setup or a pre-order. On unless you turn it off.":
    "Tempat tamu meminta kursi bayi, dekorasi ulang tahun atau pre-order. Aktif kecuali Anda matikan.",
  "Company box": "Kolom Perusahaan",
  "For corporate bookings. Only filled in on the guest record when that guest has no company saved yet, so a blank never wipes what you already have.":
    "Untuk reservasi kantor. Hanya diisikan ke data tamu bila tamu tersebut belum punya perusahaan tersimpan, jadi kolom kosong tidak pernah menghapus data yang sudah ada.",
  "Show how full each area is": "Tampilkan seberapa penuh tiap area",
  "Adds a line like \"60% terisi\" under each area. It nudges guests towards a quiet night, but it also tells them when you are empty. Off unless you turn it on.":
    "Menambah keterangan seperti \"60% terisi\" di bawah tiap area. Ini mengarahkan tamu ke hari yang sepi, tapi juga memberi tahu saat restoran kosong. Nonaktif kecuali Anda aktifkan.",
  "Welcome line under the page title": "Kalimat sambutan di bawah judul halaman",
  "Your own words, shown exactly as typed and never translated. Leave it empty for the built-in sentence in the box above.":
    "Kalimat Anda sendiri, ditampilkan persis seperti yang diketik dan tidak pernah diterjemahkan. Kosongkan untuk memakai kalimat bawaan pada kotak di atas.",
  "Save Fields": "Simpan Kolom",
  "Form fields saved": "Kolom formulir tersimpan",
  "Nothing was saved. Check with your administrator.":
    "Tidak ada yang tersimpan. Hubungi administrator Anda.",
  "How the booking page looks to a guest. The same backdrop and colours carry over to the thank-you page they land on after booking.":
    "Tampilan halaman reservasi untuk tamu. Latar dan warna yang sama juga dipakai di halaman terima kasih setelah mereka memesan.",
  "Background photo": "Foto latar",
  "Landscape, at least 1600px wide, max 2 MB. A darker photo makes the form easier to read.":
    "Format melebar, minimal 1600px, maks 2 MB. Foto yang lebih gelap membuat formulir lebih mudah dibaca.",
  "Form panel colour": "Warna panel formulir",
  "How solid the panel is": "Ketebalan panel",
  "See-through": "Tembus pandang",
  Solid: "Pekat",
  "Button colour": "Warna tombol",
  "Used for the Book button and the selected time slot. The darker end of the button gradient is worked out from this.":
    "Dipakai untuk tombol Pesan dan jam yang dipilih. Ujung gelap gradasi tombol dihitung dari warna ini.",
  "Logo height on this page": "Tinggi logo di halaman ini",
  "The logo itself is the one in Settings > Branding, so it only has to be uploaded once.":
    "Logonya sendiri diambil dari Pengaturan > Branding, jadi cukup diunggah sekali.",
  Small: "Kecil",
  Large: "Besar",
  Preview: "Pratinjau",
  "Book a Table": "Pesan Meja",
  Reserve: "Pesan",
  "Save Appearance": "Simpan Tampilan",
  "Back to defaults": "Kembali ke bawaan",
  "Appearance saved": "Tampilan disimpan",
  "Back to the built-in look": "Kembali ke tampilan bawaan",
  "Background updated": "Foto latar diperbarui",
  "Put the colours and sizes back to the built-in ones? The background photo is kept.":
    "Kembalikan warna dan ukuran ke bawaan? Foto latar tetap dipertahankan.",

  "Issue & Redeem": "Terbitkan & Tukar",
  "Card Design": "Desain Kartu",
  "Card colours": "Warna kartu",
  "The card is drawn from these, so nothing has to be designed in advance. The logo is the one in Settings > Branding.":
    "Kartu digambar dari pengaturan ini, jadi tidak perlu desain khusus. Logonya diambil dari Pengaturan > Branding.",
  Background: "Latar",
  Text: "Teks",
  Accent: "Aksen",
  "The guest name, the amount and the code. Smaller labels use a lighter version of this automatically.":
    "Nama tamu, nominal, dan kode. Label kecil otomatis memakai versi yang lebih pudar dari warna ini.",
  "The bands top and bottom, the \"VOUCHER DINE IN\" line and the hairlines.":
    "Garis tebal atas dan bawah, tulisan \"VOUCHER DINE IN\", dan garis-garis tipis.",
  "Logo size": "Ukuran logo",
  "Use my own artwork instead": "Pakai desain saya sendiri",
  "For a restaurant that already has a designed voucher. The colours and logo above are ignored and only the wording is drawn on top, so the file must be exactly 1084 x 1940 and must leave the middle empty.":
    "Untuk restoran yang sudah punya desain voucher sendiri. Warna dan logo di atas diabaikan, hanya tulisan yang digambar di atasnya, jadi file harus tepat 1084 x 1940 dan bagian tengahnya dibiarkan kosong.",
  "Custom artwork uploaded": "Desain sendiri sudah diunggah",
  "No artwork uploaded yet": "Belum ada desain yang diunggah",
  "Save Design": "Simpan Desain",
  "Card design saved": "Desain kartu disimpan",
  "Put the card design back to the built-in one?": "Kembalikan desain kartu ke bawaan?",
  "Remove the uploaded artwork?": "Hapus desain yang diunggah?",
  "Artwork updated": "Desain diperbarui",
  "Artwork removed": "Desain dihapus",
  // "Remove" is already in this dictionary twice further down. Not added a
  // third time: a duplicate key is silently dropped and the two copies then
  // drift apart.
  "Only a manager can change the card design":
    "Hanya manager yang bisa mengubah desain kartu",
  "A real card with sample details, drawn the same way the one a guest receives is drawn.":
    "Kartu asli dengan data contoh, digambar dengan cara yang sama seperti kartu yang diterima tamu.",
  Sample: "Contoh",
  "Looking for the voucher card? Its colours, logo size and the optional custom artwork now live under Vouchers > Card Design, next to a live preview of the card itself.":
    "Mencari kartu voucher? Warna, ukuran logo, dan desain khusus opsionalnya sekarang ada di Voucher > Desain Kartu, lengkap dengan pratinjau kartunya.",

  // ── Birthday follow-up (added 2026-08-23) ─────────────────────────
  "Send WhatsApp": "Kirim WA",
  "Mark as sent": "Tandai sudah dikirim",
  "Greeting sent": "Sudah diucapkan",
  "Marked as sent": "Ditandai sudah dikirim",
  "Marked as not sent yet": "Ditandai belum dikirim",
  "Could not mark this as sent": "Tidak bisa menandai sudah dikirim",
  "Could not undo this": "Tidak bisa membatalkan",
  Undo: "Batalkan",
  "No phone": "Tanpa nomor",
  "No phone on file": "Nomor telepon belum ada",
  "No birthdays this month.": "Tidak ada ulang tahun bulan ini.",
  "Birthdays this month": "Ulang tahun bulan ini",
  "See the full list": "Lihat daftar lengkap",
  "Follow Up": "Follow Up",
  // "Today" is already in this dictionary further down; do not add it twice,
  // the later key silently wins and the two can drift apart.
  Tomorrow: "Besok",
  passed: "sudah lewat",

  // ── Settings > Branding + Settings > Staff (added 2026-08-23) ──────
  Branding: "Branding",
  "The logo shown to guests on the reservation and thank-you pages, on the spin page, on this app, and on invoices. Upload once here instead of asking for a new build.":
    "Logo yang dilihat tamu di halaman reservasi dan halaman terima kasih, di halaman spin, di aplikasi ini, dan di invoice. Cukup unggah di sini, tidak perlu minta build baru.",
  "One thing this does not change: the preview picture WhatsApp shows when someone forwards the booking link. WhatsApp reads that from the page before any code runs, so it stays a fixed file in the build and has to be changed at deploy time.":
    "Satu hal yang tidak ikut berubah: gambar pratinjau yang muncul di WhatsApp saat link reservasi diteruskan. WhatsApp membacanya sebelum kode apa pun jalan, jadi gambar itu tetap file tetap di dalam build dan hanya bisa diganti saat deploy.",
  "Main logo": "Logo utama",
  "The wide one. Used on the guest pages, the login screen, the sidebar and the invoice header. Transparent PNG looks best. Any shape works: it is fitted to a box, never stretched.":
    "Yang memanjang. Dipakai di halaman tamu, layar login, sidebar, dan kepala invoice. PNG transparan paling bagus. Bentuk apa pun bisa: gambar disesuaikan ke dalam kotak, tidak pernah ditarik.",
  "Small mark": "Ikon kecil",
  "The square one. Used as the browser tab icon and the small mark at the bottom of an invoice. A square image, roughly 512 by 512, works best.":
    "Yang berbentuk kotak. Dipakai sebagai ikon tab browser dan tanda kecil di bagian bawah invoice. Gambar persegi sekitar 512 x 512 paling bagus.",
  "Voucher card design": "Desain kartu voucher",
  "This one is not a logo, it is the whole voucher card artwork. The guest's name, the code and the expiry date are drawn on top of it at fixed positions, so it must be 1084 by 1940 pixels and must leave the middle of the card empty for that text.":
    "Yang ini bukan logo, melainkan seluruh desain kartu voucher. Nama tamu, kode, dan tanggal berlaku digambar di atasnya pada posisi tetap, jadi ukurannya harus 1084 x 1940 piksel dan bagian tengah kartu harus dibiarkan kosong untuk teks itu.",
  "JPG, PNG or WebP, max 2 MB.": "JPG, PNG, atau WebP, maks 2 MB.",
  "JPG, PNG or WebP, max 2 MB, exactly 1084 x 1940 pixels.":
    "JPG, PNG, atau WebP, maks 2 MB, tepat 1084 x 1940 piksel.",
  Upload: "Unggah",
  "Uploading...": "Mengunggah...",
  "Use built-in": "Pakai bawaan",
  "Custom image": "Gambar sendiri",
  "Default image": "Gambar bawaan",
  "Pick an image file first": "Pilih file gambar dulu",
  "Use a JPG, PNG or WebP file. SVG is not accepted.":
    "Gunakan file JPG, PNG, atau WebP. SVG tidak diterima.",
  "Image must be under 2 MB.": "Gambar harus di bawah 2 MB.",
  "Upload failed. Please try again.": "Unggah gagal. Silakan coba lagi.",
  "Logo updated": "Logo diperbarui",
  "Go back to the built-in image?": "Kembali ke gambar bawaan?",
  "Back to the built-in image": "Kembali ke gambar bawaan",

  "Who can log in, and what they are allowed to see.":
    "Siapa yang bisa login, dan apa saja yang boleh mereka lihat.",
  "Add Staff": "Tambah Staf",
  "Edit Staff": "Ubah Staf",
  "Save Staff": "Simpan Staf",
  "No staff accounts yet.": "Belum ada akun staf.",
  "Could not load the staff list. Check the connection and try again.":
    "Daftar staf tidak bisa dimuat. Periksa koneksi lalu coba lagi.",
  "(you)": "(Anda)",
  Inactive: "Nonaktif",
  Deactivate: "Nonaktifkan",
  Activate: "Aktifkan",
  "Name *": "Nama *",
  "Shown on the dashboard and against every visit they record.":
    "Ditampilkan di dashboard dan tercatat pada setiap kunjungan yang mereka input.",
  "Username *": "Username *",
  "Lowercase letters, numbers, dot, dash or underscore. This is what they type to log in.":
    "Huruf kecil, angka, titik, strip, atau garis bawah. Ini yang mereka ketik saat login.",
  "The username cannot be changed after the account is created, because it is what they log in with.":
    "Username tidak bisa diubah setelah akun dibuat, karena inilah yang dipakai untuk login.",
  "Leave blank to keep the current PIN.":
    "Kosongkan kalau PIN tidak diubah.",
  "Exactly 4 digits. The staff member types this to log in.":
    "Tepat 4 angka. Ini yang diketik staf saat login.",
  "Role *": "Peran *",
  "You cannot change your own role. Ask another admin to do it.":
    "Anda tidak bisa mengubah peran sendiri. Minta admin lain yang melakukannya.",
  "What each role can do": "Apa yang bisa dilakukan tiap peran",
  "— the front desk. Dashboard, reservations, walk-ins, membership and broadcast. Can see areas and the dish list but cannot change them.":
    "— front desk. Dashboard, reservasi, walk-in, keanggotaan, dan broadcast. Bisa melihat area dan daftar menu, tapi tidak bisa mengubahnya.",
  "— everything staff can do, plus prizes, thresholds, branding, and deleting a reservation or voiding a walk-in.":
    "— semua yang bisa dilakukan staf, ditambah hadiah, thresholds, branding, serta menghapus reservasi atau membatalkan walk-in.",
  "— the owner. Everything a manager can do, plus the owner dashboard and this screen.":
    "— pemilik. Semua yang bisa dilakukan manager, ditambah dashboard pemilik dan halaman ini.",
  "Accounts are never deleted, only deactivated. A deactivated person cannot log in, and the visits, walk-ins and vouchers they recorded keep their name on them. Deleting the account would erase that history.":
    "Akun tidak pernah dihapus, hanya dinonaktifkan. Orang yang dinonaktifkan tidak bisa login, dan kunjungan, walk-in, serta voucher yang pernah mereka input tetap membawa nama mereka. Menghapus akun akan menghilangkan riwayat itu.",
  "Only an admin can manage staff": "Hanya admin yang bisa mengelola staf",
  "Only a manager can change settings":
    "Hanya manager yang bisa mengubah pengaturan",
  "Name is required (min 2 characters)": "Nama wajib diisi (min 2 karakter)",
  "Username must be 3-20 characters: lowercase letters, numbers, dot, dash or underscore.":
    "Username harus 3-20 karakter: huruf kecil, angka, titik, strip, atau garis bawah.",
  "Pick a role": "Pilih peran",
  "PIN must be exactly 4 digits": "PIN harus tepat 4 angka",
  "This is the last active admin. Promote someone else to admin first.":
    "Ini admin aktif terakhir. Jadikan orang lain admin dulu.",
  "That username is already taken. Pick another one.":
    "Username itu sudah dipakai. Pilih yang lain.",
  "You cannot deactivate your own account.":
    "Anda tidak bisa menonaktifkan akun sendiri.",
  "Failed to save staff": "Gagal menyimpan staf",
  "Failed to update staff": "Gagal memperbarui staf",
  "Staff added": "Staf ditambahkan",
  "Staff updated": "Staf diperbarui",
  "Staff deactivated": "Staf dinonaktifkan",
  "Staff reactivated": "Staf diaktifkan kembali",

  // Sidebar navigation
  // "Staff Dashboard" (admin-only, 2026-07-26): the owner looking at the
  // front-desk view.
  "Staff Dashboard": "Dashboard Staf",
  "You are viewing the front desk dashboard":
    "Anda sedang melihat dashboard front desk",
  "This is exactly what your staff see. Anything you save here — including Quick Walk-In — is recorded for real.":
    "Ini persis yang dilihat staf Anda. Apa pun yang Anda simpan di sini — termasuk Quick Walk-In — tercatat sungguhan.",
  "Back to my dashboard": "Kembali ke dashboard saya",
  Dashboard: "Beranda",
  Guests: "Tamu",
  Membership: "Keanggotaan",
  Reservations: "Reservasi",
  "Walk-Ins": "Tanpa Reservasi",
  Areas: "Area",
  Reports: "Laporan",
  Prizes: "Hadiah",
  Settings: "Pengaturan",
  "Signed in": "Masuk sebagai",

  // Settings pages (tabs, thresholds, featured dishes) — added 2026-07-21
  "Reservation Configuration": "Konfigurasi Reservasi",
  Thresholds: "Thresholds",
  "Signature dishes and chef recommendations shown to guests on the online reservation page":
    "Signature Dishes dan Chef's Recommendation yang ditampilkan ke tamu di halaman reservasi online",
  "Add Dish": "Tambah Menu",
  "Edit Dish": "Ubah Menu",
  "Signature Dishes": "Signature Dishes",
  "The dishes this restaurant is known for":
    "Menu yang menjadi ciri khas restoran ini",
  "Chef Recommendations": "Chef's Recommendation",
  "Rotating picks from the kitchen": "Pilihan terbaik dari dapur",
  "No dishes yet. Add one so guests see it when reserving online.":
    "Belum ada menu. Tambahkan agar tamu melihatnya saat reservasi online.",
  "No description": "Tanpa deskripsi",
  Hidden: "Disembunyikan",
  Hide: "Sembunyikan",
  Show: "Tampilkan",
  "Dish Name *": "Nama Menu *",
  "Category *": "Kategori *",
  "Signature Dish": "Signature Dishes",
  "Chef Recommendation": "Chef's Recommendation",
  Photo: "Foto",
  "JPG, PNG or WebP, max 2 MB. Landscape photos look best.":
    "JPG, PNG, atau WebP, maks 2 MB. Foto landscape terlihat paling bagus.",
  "Visible on reservation page": "Tampil di halaman reservasi",
  "Save Dish": "Simpan Menu",
  "Saving...": "Menyimpan...",
  "Dish added": "Menu ditambahkan",
  "Dish updated": "Menu diperbarui",
  "Dish deleted": "Menu dihapus",
  "Dish hidden from guests": "Menu disembunyikan dari tamu",
  "Dish visible to guests": "Menu ditampilkan ke tamu",
  "Dish name is required (min 2 characters)":
    "Nama menu wajib diisi (min 2 karakter)",
  "Pick a category": "Pilih kategori",
  "Photo must be JPG, PNG or WebP": "Foto harus JPG, PNG, atau WebP",
  "Photo is too large (max 2 MB). Resize it and try again.":
    "Foto terlalu besar (maks 2 MB). Perkecil lalu coba lagi.",
  "Photo upload failed. Please try again.":
    "Unggah foto gagal. Silakan coba lagi.",
  "Failed to save dish": "Gagal menyimpan menu",
  "Failed to update dish. Please try again.":
    "Gagal memperbarui menu. Silakan coba lagi.",
  "Failed to delete dish. Please try again.":
    "Gagal menghapus menu. Silakan coba lagi.",
  "Unable to load dishes. Check the connection and try again.":
    "Tidak bisa memuat menu. Periksa koneksi dan coba lagi.",
  "Business rules for spending tiers and membership — changes apply immediately after saving":
    "Aturan bisnis untuk tier pengeluaran dan keanggotaan — perubahan langsung berlaku setelah disimpan",
  "Spending Tier": "Tier Pengeluaran",
  "A guest becomes a High Spender when one visit reaches either threshold. Reports and dashboards use these same numbers.":
    "Tamu menjadi High Spender jika satu kunjungan mencapai salah satu thresholds. Laporan dan Daashboard akan memakai angka yang sama.",
  "Visit total ≥ (Rp)": "Total kunjungan ≥ (Rp)",
  "Or spend per pax ≥ (Rp)": "Atau pengeluaran per pax ≥ (Rp)",
  "High status lasts (days)": "Status High bertahan (hari)",
  "Sticker and voucher rules per card type. Changes apply to new transactions only — existing stickers and vouchers are not recalculated.":
    "Aturan stiker dan voucher per jenis kartu. Perubahan hanya berlaku untuk transaksi baru — stiker dan voucher yang sudah ada tidak dihitung ulang.",
  "Stickers needed per voucher": "Jumlah stiker per voucher",
  "Min spend per sticker (Rp)": "Belanja minimum per stiker (Rp)",
  "Voucher amount (Rp)": "Nilai voucher (Rp)",
  "Sticker cap (empty = no cap)": "Batas stiker (kosong = tanpa batas)",
  "Online Reservation Hours": "Jam Reservasi Online",
  "Booking window offered on the public reservation page. Enforced by the database, not just the form.":
    "Rentang waktu booking di halaman reservasi publik. Divalidasi oleh database, bukan hanya formulir.",
  Open: "Buka",
  "Last booking": "Booking terakhir",
  "Save Settings": "Simpan Pengaturan",
  "Settings saved": "Pengaturan tersimpan",
  "Unable to save settings": "Tidak bisa menyimpan pengaturan",
  "Saved. Guest tiers update automatically on their next visit — or apply the new thresholds to everyone now:":
    "Tersimpan. Tier tamu diperbarui otomatis pada kunjungan berikutnya — atau terapkan threshold baru ke semua tamu sekarang:",
  "Recalculate all guest tiers now": "Hitung ulang semua tier tamu sekarang",
  "Recalculate the spending tier of every auto-tier guest using the current thresholds?":
    "Hitung ulang tier pengeluaran semua tamu (mode otomatis) dengan threshold saat ini?",
  "Unable to recalculate tiers": "Tidak bisa menghitung ulang tier",
  "High spender visit total must be > 0":
    "Total kunjungan High Spender harus > 0",
  "High spender per-pax must be > 0": "Per-pax High Spender harus > 0",
  "Per-pax threshold should not exceed the visit total threshold":
    "Ambang per-pax sebaiknya tidak melebihi ambang total kunjungan",
  "Sticky days must be at least 1": "Durasi status minimal 1 hari",
  "Stickers per voucher must be a whole number of at least 1":
    "Stiker per voucher harus bilangan bulat minimal 1",
  "Family minimum and voucher must be > 0":
    "Minimum dan voucher Family harus > 0",
  "Company minimum and voucher must be > 0":
    "Minimum dan voucher Company harus > 0",
  "Family cap must be a whole number of at least 1, or empty for no cap":
    "Batas Family harus bilangan bulat minimal 1, atau kosong untuk tanpa batas",
  "Company cap must be a whole number of at least 1, or empty for no cap":
    "Batas Company harus bilangan bulat minimal 1, atau kosong untuk tanpa batas",
  "Online reservation hours are required": "Jam reservasi online wajib diisi",
  "Online reservation: open time must be before last booking time":
    "Reservasi online: jam buka harus sebelum jam booking terakhir",
  Staff: "Staf",
  Manager: "Manajer",
  Logout: "Keluar",

  // Common actions / buttons
  Edit: "Ubah",
  Save: "Simpan",
  Cancel: "Batal",
  Delete: "Hapus",
  Remove: "Hapus",
  Close: "Tutup",
  Update: "Perbarui",
  View: "Lihat",
  Reset: "Atur Ulang",
  Notes: "Catatan",
  "Optional details for the new guest. Can be filled in later from the guest profile.":
    "Detail tambahan untuk tamu baru. Bisa diisi nanti dari profil tamu.",
  Optional: "opsional",
  "(optional)": "(opsional)",
  Link: "Tautan",
  "New Guest": "Tamu Baru",
  "+ New Guest": "+ Tamu Baru",
  Add: "Tambah",
  "Walk-In": "Tanpa Reservasi",
  "New Reservation": "Reservasi Baru",
  "Guest name *": "Nama tamu *",
  "Phone (optional)": "Telepon (opsional)",

  // Guest Database page
  "Guest Database": "Database Tamu",
  "Search and manage guest profiles": "Cari dan kelola profil tamu",
  "Search by name, phone, or company...":
    "Cari nama, nomor telepon, atau perusahaan...",
  "All Tiers": "Semua Tingkatan",
  "All Tags": "Semua Label",
  "Any Visits": "Semua Kunjungan",
  "Last visit": "Kunjungan terakhir",
  "Last Visit": "Kunjungan Terakhir",
  Guest: "Tamu",
  Phone: "Telepon",
  Company: "Perusahaan",
  Tag: "Label",
  Tier: "Tingkatan",
  Spending: "Belanja",
  "No Tier": "Tanpa Tingkatan",
  "1+ Visits": "1+ Kunjungan",
  "2+ Visits": "2+ Kunjungan",
  "3+ Visits": "3+ Kunjungan",
  "5+ Visits": "5+ Kunjungan",
  "10+ Visits": "10+ Kunjungan",
  "Search by name, phone, or company…":
    "Cari nama, nomor telepon, atau perusahaan…",
  "Loading guests…": "Memuat data tamu…",
  None: "Tidak ada",

  // Complete Visit modal
  "Complete Visit": "Selesaikan Kunjungan",
  "Spend Amount (Rp)": "Jumlah Pengeluaran (Rp)",
  "Spend amount is required before completing.":
    "Jumlah pengeluaran wajib diisi sebelum menyelesaikan.",
  "Favorite Menu / Recent Order": "Menu Favorit / Pesanan Terakhir",
  "Shown on this guest's future visits. Leave blank to keep what's already saved.":
    "Akan ditampilkan pada kunjungan tamu ini berikutnya. Kosongkan untuk tetap menyimpan data sebelumnya.",
  "Complete & Save": "Selesaikan & Simpan",
  "Booked On": "Dipesan Pada",
  "Did this guest arrive?": "Tamu ini jadi datang?",
  "Nobody marked them Arrived, so the system cannot tell. Completing a no-show would count them as a guest who came.":
    "Belum ada yang menandai Arrived, jadi sistem tidak tahu. Menyelesaikan tamu yang tidak datang akan terhitung sebagai tamu yang datang.",
  "Yes, they came": "Ya, jadi datang",
  "No, they did not come": "Tidak jadi datang",
  "Please choose one before completing.": "Pilih salah satu dulu.",
  "Mark as No Show": "Tandai Tidak Datang",
  "Marked as no show": "Ditandai tidak datang",
  "Failed to save. Please try again.": "Gagal menyimpan. Coba lagi.",
  "Could not save the visit. Spend was not recorded, please try again.":
    "Kunjungan tidak bisa disimpan. Belanja belum tercatat, coba lagi.",

  // Guest Profile modal
  "Guest Profile": "Profil Tamu",
  "Member since": "Anggota sejak",
  "Manual override": "Diatur manual",
  "Auto-calculated": "Dihitung otomatis",
  Allergy: "Alergi",
  Preference: "Preferensi",
  "Average Spend": "Rata-rata Pengeluaran",
  "Recent Order": "Pesanan Terakhir",
  "no spend recorded yet": "belum ada pengeluaran tercatat",
  "recorded at next Complete Visit":
    "akan tercatat saat kunjungan berikutnya diselesaikan",
  "from last recorded visit": "dari kunjungan terakhir tercatat",

  // Common toasts / status messages
  "Visit completed": "Kunjungan selesai",
  "Failed to save — visit not completed. Please try again.":
    "Gagal menyimpan — kunjungan belum selesai. Silakan coba lagi.",
  "Spend amount did not save correctly. Please try again.":
    "Jumlah pengeluaran gagal tersimpan dengan benar. Silakan coba lagi.",
  "Failed to save — reservation not completed. Please try again.":
    "Gagal menyimpan — reservasi belum selesai. Silakan coba lagi.",
  "Access restricted. Contact a manager.": "Akses dibatasi. Hubungi manajer.",
  "Unable to connect to Supabase. Check credentials and RLS policies.":
    "Tidak dapat terhubung ke server. Periksa kredensial dan kebijakan RLS.",

  // Status labels — used by statusBadge() and inline status pills, so
  // translating these here covers every reservation/walk-in table & card.
  Reserved: "Dipesan",
  Waitlist: "Daftar Tunggu",
  // Waitlist reasons, shown as words in the reservations list. The stored value
  // is a code; staff should never have to read one.
  over_capacity: "Terlalu besar untuk area",
  below_min_pax: "Di bawah minimum area",
  over_max_pax: "Rombongan besar",
  Confirmed: "Terkonfirmasi",
  Arrived: "Tiba",
  Cancelled: "Dibatalkan",
  "Cancelled (No Show)": "Dibatalkan (Tidak Hadir)",
  Completed: "Selesai",
  Deleted: "Dihapus",
  Done: "Selesai",
  Active: "Aktif",
  "✓ Done": "✓ Selesai",

  // Page headers
  "Welcome!": "Selamat Datang!",
  "Loading...": "Memuat...",
  "Family & Company cards — stickers and vouchers":
    "Kartu Keluarga & Perusahaan — stiker dan voucher",
  "+ Add Member": "+ Tambah Anggota",
  "Walk-In Log": "Log Tanpa Reservasi",
  "Today's walk-in guests": "Tamu tanpa reservasi hari ini",
  "Area Capacity": "Kapasitas Area",
  "Real-time area availability for today":
    "Ketersediaan area hari ini secara langsung",
  "Guest retention, loyalty insights and marketing audiences":
    "Retensi tamu, wawasan loyalitas, dan audiens pemasaran",
  "Spin Prizes": "Hadiah Putar",
  "Manage wheel prizes and review spin results":
    "Kelola hadiah roda putar dan tinjau hasil putaran",
  "Reservation demand, utilization and operational performance":
    "Permintaan reservasi, utilisasi, dan kinerja operasional",
  "High-value guest identification and spending behavior analysis":
    "Identifikasi tamu bernilai tinggi dan analisis perilaku belanja",
  "Show voided": "Tampilkan yang dibatalkan",
  "Hide voided": "Sembunyikan yang dibatalkan",

  // Areas & Table Configuration page
  "View all →": "Lihat semua →",
  "Table Configuration": "Konfigurasi Meja",
  "Manage physical tables by area and active status.":
    "Kelola meja fisik berdasarkan area dan status aktif.",
  "Add Table": "Tambah Meja",
  "Add to area": "Tambah ke area",
  Capacity: "Kapasitas",
  Today: "Hari Ini",

  // Reports — Marketing / retention
  "All cards and exports always update automatically based on this selected date range.":
    "Semua kartu dan ekspor selalu diperbarui otomatis berdasarkan rentang tanggal yang dipilih ini.",
  Acquire: "Akuisisi",
  "first-time visitors": "pengunjung pertama kali",
  "Guests with exactly 1 visit in period":
    "Tamu dengan tepat 1 kunjungan pada periode ini",
  "Guests whose first visit is in this period":
    "Tamu yang kunjungan pertamanya jatuh pada periode ini",
  "Via reservation": "Via reservasi",
  "Via walk-in": "Via walk-in",
  "Total pax": "Total pax",
  "Channel of their first visit in this period":
    "Kanal kunjungan pertama mereka pada periode ini",
  "returning guests": "tamu yang kembali",
  "Guests who had already visited before this period":
    "Tamu yang sudah pernah berkunjung sebelum periode ini",
  "By lifetime visits": "Berdasarkan total kunjungan sepanjang waktu",
  "Visited more than once in this period":
    "Datang lebih dari sekali pada periode ini",
  "haven't returned in 60–89 days": "belum kembali dalam 60–89 hari",
  "haven't returned in 90+ days": "belum kembali dalam 90+ hari",
  "60–89 Days": "60–89 Hari",
  "90+ Days": "90+ Hari",
  "Based on all-time last visit date":
    "Berdasarkan tanggal kunjungan terakhir sepanjang waktu",
  "Export At-Risk List": "Ekspor Daftar At-Risk",
  "Top Guests by Visits": "Tamu Teratas berdasarkan Kunjungan",
  "Most loyal customers in selected period":
    "Pelanggan paling loyal pada periode terpilih",
  "View Full List & Export →": "Lihat Semua & Ekspor →",
  "All data reflects the selected date range. At-Risk is always based on all-time last visit.":
    "Semua data mencerminkan rentang tanggal yang dipilih. At-Risk selalu berdasarkan kunjungan terakhir sepanjang waktu.",
  "Top Spender Leaderboard": "Papan Peringkat Pembelanja Teratas",
  "Highest spending guests": "Tamu dengan pembelanjaan tertinggi",
  "Guests celebrating a birthday this month":
    "Tamu yang merayakan ulang tahun bulan ini",
  "At-Risk High Spenders": "High Spenders Berisiko",
  "High Spender guests nearing automatic downgrade to Medium Spender":
    "Tamu High Spender yang mendekati penurunan otomatis ke Medium Spender",
  "No High Spenders are approaching downgrade. Guests nearing expiration will appear here.":
    "Tidak ada High Spender yang mendekati penurunan tingkat. Tamu yang mendekati kedaluwarsa akan muncul di sini.",

  // Reports — tab bar & shared range controls
  Operations: "Operasional",
  "Spending Insights": "Kemampuan Belanja",
  "Date Range": "Rentang Tanggal",
  "This Week": "Minggu Ini",
  "This Month": "Bulan Ini",
  "Custom Range": "Rentang Khusus",
  Custom: "Kustom",
  to: "hingga",
  "guests visited": "tamu berkunjung",
  "in selected period": "pada periode terpilih",

  // Acquire / Retain / At-Risk panel
  "Export First-Time Guests": "Ekspor Tamu Baru",
  "Returning (2–4 visits)": "Kembali (2–4 kunjungan)",
  "Loyal (5–9 visits)": "Loyal (5–9 kunjungan)",
  "VIP (10+ visits)": "VIP (10+ kunjungan)",
  "Export Returning Guests": "Ekspor Tamu yang Kembali",
  "Failed to load marketing data": "Gagal memuat data pemasaran",

  // Top Spender Leaderboard
  Rank: "Peringkat",
  "Total Spend": "Total Belanja",
  "Total Visits": "Total Kunjungan",
  "No spending data available for the selected period":
    "Tidak ada data belanja untuk periode yang dipilih",

  // Google Review Promotion
  "All Time": "Sepanjang Waktu",
  "Google Review Promotion": "Promosi Ulasan Google",
  "Total Spins": "Total Putaran",
  "Prizes Won": "Hadiah Dimenangkan",
  "Rejected Reviews": "Ulasan Ditolak",
  "Redeemed Prizes": "Hadiah Diklaim",
  "Redemption Rate": "Tingkat Klaim",
  "Prize Breakdown": "Rincian Hadiah",
  "Prize Name": "Nama Hadiah",
  "Times Won": "Jumlah Menang",
  "Times Redeemed": "Jumlah Diklaim",

  // Birthday Guests report
  "Birthday Guests": "Tamu Ulang Tahun",
  "Previous Month": "Bulan Sebelumnya",
  "Next Month": "Bulan Berikutnya",
  "Guest Name": "Nama Tamu",
  "Birthday Date": "Tanggal Ulang Tahun",
  "Phone Number": "Nomor Telepon",
  "Spending Tier": "Tingkat Belanja",
  "Last Visit Date": "Tanggal Kunjungan Terakhir",
  "Failed to load data": "Gagal memuat data",

  // At-Risk High Spender report
  "Qualification Date": "Tanggal Kualifikasi",
  "Days Remaining": "Sisa Hari",

  // Operations tab — Live / Peak Traffic / In Period
  Live: "Langsung",
  "always reflects today": "selalu mencerminkan hari ini",
  "Live — Today": "Langsung — Hari Ini",
  "Today's Reservations": "Reservasi Hari Ini",
  "Today's Cancellations": "Pembatalan Hari Ini",
  "Live Forecast": "Perkiraan Langsung",
  "Upcoming Reservations": "Reservasi Mendatang",
  "Next Week": "Minggu Depan",
  "Peak Traffic": "Lalu Lintas Puncak",
  "14-day window, independent of filter":
    "jendela 14 hari, tidak tergantung filter",
  "14-Day Window": "Jendela 14 Hari",
  "Last 14 days": "14 hari terakhir",
  "Last 10 days + next 3 days": "10 hari terakhir + 3 hari ke depan",
  Su: "Mg",
  Mo: "Sn",
  Tu: "Sl",
  We: "Rb",
  Th: "Km",
  Fr: "Jm",
  Sa: "Sb",
  "Select a start date": "Pilih tanggal mulai",
  "Reset to today": "Atur ulang ke hari ini",
  "Busiest day:": "Hari tersibuk:",
  "In Period": "Dalam Periode",
  "filtered by reporting period below":
    "difilter berdasarkan periode laporan di bawah",
  "Reporting Period": "Periode Laporan",
  "Reservation vs Walk-In vs Cancelled":
    "Reservasi vs Tanpa Reservasi vs Dibatalkan",
  "Reservation Share": "Persentase Reservasi",
  "Walk-In Share": "Persentase Tanpa Reservasi",
  "Reservation Sources": "Sumber Reservasi",
  "Top booking channels": "Saluran pemesanan teratas",
  Export: "Ekspor",
  Source: "Sumber",
  "No source data yet": "Belum ada data sumber",
  "Previous Day": "Hari Sebelumnya",
  "Next Day": "Hari Berikutnya",

  // Admin dashboard (owner/head-chef view)
  "Reservations — This Month": "Reservasi — Bulan Ini",
  "Total Reservations": "Total Reservasi",
  Cancellations: "Pembatalan",
  "No-Show Rate": "Tingkat No-Show",
  "of all bookings": "dari semua pemesanan",
  "Guests — This Month": "Tamu — Bulan Ini",
  "New Guests": "Tamu Baru",
  "first visit this month": "kunjungan pertama bulan ini",
  "Returning Guests": "Tamu yang Kembali",
  "2–4 visits this month": "2–4 kunjungan bulan ini",
  "At Risk": "Berisiko Hilang",
  "No visit in 60+ days": "Tidak berkunjung 60+ hari",
  "No visit in 90+ days": "Tidak berkunjung 90+ hari",
  "Reservations — Next 7 Days": "Reservasi — 7 Hari ke Depan",
  "Last 7 days + next 6 days": "7 hari terakhir + 6 hari ke depan",
  "Based on recorded guest spend — not full restaurant revenue":
    "Berdasarkan belanja tamu yang tercatat — bukan total pendapatan restoran",
  "Top Guests by Spend": "Tamu Teratas berdasarkan Belanja",
  "Birthdays This Month": "Ulang Tahun Bulan Ini",
  "No birthdays this month": "Tidak ada ulang tahun bulan ini",
  "Couldn't load birthdays": "Gagal memuat ulang tahun",
  "No data for this period": "Tidak ada data untuk periode ini",

  // Peak traffic chart bits shared with Reports > Operations that were
  // never in the dictionary (legend + empty state showed English even in id)
  "No recent activity": "Belum ada aktivitas terkini",
  "Peak res:": "Puncak reservasi:",
  "Peak walk-in:": "Puncak walk-in:",

  // Spending Insights tab
  "Spending Summary": "Ringkasan Belanja",
  "Real-time totals for walk-in and reservation spending":
    "Total real-time untuk belanja tanpa reservasi dan reservasi",
  "Walk-In Spending": "Belanja Tanpa Reservasi",
  "Reservation Spending": "Belanja Reservasi",
  "Total Spending Today": "Total Belanja Hari Ini",
  "Analyze high-value guests based on spending across all completed visits":
    "Analisis tamu bernilai tinggi berdasarkan belanja di semua kunjungan yang selesai",
  Tags: "Label",
  "Filter tags (press Enter)": "Filter label (tekan Enter)",
  "Any Assigned Tag": "Label Apa Saja yang Ditetapkan",
  "Latest Tag": "Label Terbaru",
  "Reset Filters": "Atur Ulang Filter",
  "Saved Segments…": "Segmen Tersimpan…",
  "Export CSV": "Ekspor CSV",
  "Save Segment": "Simpan Segmen",
  "High Average Spend Per Person": "Rata-rata Belanja per Orang Tinggi",
  "Medium Average Spend Per Person": "Rata-rata Belanja per Orang Sedang",
  "Groups spending more than Rp 300,000 per guest":
    "Grup dengan belanja lebih dari Rp 300.000 per tamu",
  "Completed walk-ins from medium spender guests, ranked by average spend per guest":
    "Kunjungan selesai dari tamu medium spender, diurutkan berdasarkan rata-rata belanja per tamu",
  "Based on average spend per person":
    "Berdasarkan rata-rata belanja per orang",
  "Qualified Guests": "Tamu Memenuhi Syarat",
  "Highest Avg Spend": "Rata-rata Belanja Tertinggi",
  "Average Spend / Person": "Rata-rata Belanja / Orang",
  "Avg Spend / Person": "Rata-rata Belanja / Orang",
  "Total Revenue": "Total Pendapatan",
  "Top Guests": "Tamu Teratas",
  "View All Guests": "Lihat Semua Tamu",
  "No guests matched this spending criteria for the selected date range.":
    "Tidak ada tamu yang cocok dengan kriteria belanja ini untuk rentang tanggal yang dipilih.",
  "Tag Distribution": "Distribusi Label",
  "High Total Spending": "Total Belanja Tinggi",
  "Medium Total Spending": "Total Belanja Sedang",
  "Groups with total spend of Rp 1,000,000 or more":
    "Grup dengan total belanja Rp 1.000.000 atau lebih",
  "Completed walk-ins from medium spender guests, ranked by total spend":
    "Kunjungan selesai dari tamu medium spender, diurutkan berdasarkan total belanja",
  "Based on total spend": "Berdasarkan total belanja",
  "Highest Spend": "Belanja Tertinggi",
  "Average Spend": "Rata-rata Belanja",
  "Other Tags": "Label Lainnya",
  "Unable to load walk-in spending insights":
    "Tidak dapat memuat wawasan belanja tanpa reservasi",
  "No tags in current result set": "Tidak ada label pada hasil saat ini",

  // Guest Profile — inline favorite menu edit
  "Failed to save favorite menu. Please try again.":
    "Gagal menyimpan menu favorit. Silakan coba lagi.",
  "Favorite menu updated": "Menu favorit berhasil diperbarui",

  // ══════════════════════════════════════════════════════════
  // OWNER DASHBOARD (rebuilt 2026-07-26)
  // ══════════════════════════════════════════════════════════
  // Period switcher + range label
  "Month to Date": "Bulan Berjalan",
  "Last 30 Days": "30 Hari Terakhir",
  "compared to": "dibandingkan",
  vs: "vs",
  "All changes on this page compare these two periods":
    "Semua perubahan di halaman ini membandingkan dua periode ini",

  // Headline metrics. "Covers" is the F&B term for guests served; Indonesian
  // staff read "pax" far more readily than any literal translation, so the
  // label says Pax on purpose.
  "Recorded Spend": "Belanja Tercatat",
  Covers: "Jumlah Pax",
  "Spend / Guest": "Belanja / Tamu",
  "Repeat Guest Rate": "Tingkat Tamu Kembali",
  "guests had been before": "tamu pernah datang sebelumnya",
  "Spend is recorded per visit at checkout — treat as guest spend, not audited revenue.":
    "Belanja dicatat per kunjungan saat checkout — anggap sebagai belanja tamu, bukan pendapatan yang diaudit.",
  "Spend is recorded per visit at checkout — treat as guest spend, not audited revenue. Voided visits and deleted bookings are excluded throughout.":
    "Belanja dicatat per kunjungan saat checkout — anggap sebagai belanja tamu, bukan pendapatan yang diaudit. Kunjungan yang dibatalkan (void) dan booking yang dihapus tidak dihitung.",

  // Comparison chips
  "vs previous": "vs sebelumnya",
  "Flat vs previous": "Sama dengan sebelumnya",
  "No change": "Tidak ada perubahan",
  "New — nothing to compare": "Baru — belum ada pembanding",
  "No comparable earlier period": "Belum ada periode pembanding",

  // Needs Your Attention
  "Needs Your Attention": "Perlu Perhatian Anda",
  "All clear": "Semua Aman",
  "item needs action": "hal perlu dicek",
  "items need action": "hal perlu dicek",
  "Nothing needs action right now — no no-shows, no regulars gone quiet, no birthdays this week.":
    "Tidak ada yang perlu ditindak saat ini — tidak ada tamu yang tidak datang, tidak ada pelanggan tetap yang menghilang, tidak ada ulang tahun minggu ini.",
  "No-show rate": "Tingkat tidak datang",
  "Cancellation rate": "Tingkat pembatalan",
  "pax of unsold covers": "pax kursi tidak terjual",
  "of guests had visited before": "tamu pernah datang sebelumnya",
  "first-time guests have not come back": "tamu baru belum kembali",
  "high spenders not seen in": "tamu belanja tinggi tidak datang dalam",
  "guests in total have not visited in": "total tamu tidak berkunjung dalam",
  "guest birthdays in the next": "ulang tahun tamu dalam",
  "See bookings": "Lihat booking",
  "Plan outreach": "Rencanakan outreach",
  "Win them back": "Ajak kembali",
  "Open reports": "Buka laporan",
  "Send greetings": "Kirim ucapan",

  // Bare connector words used to compose sentences around interpolated
  // numbers (see the attention list + coverage warnings in app.js). Kept as
  // separate keys so the numbers stay outside translated text.
  of: "dari",
  days: "hari",
  more: "lainnya",
  guests: "tamu",
  Spend: "Belanja",
  "pax booked": "pax dipesan",
  "Loading…": "Memuat…",

  // Today band
  "Walk-Ins So Far": "Walk-In Sejauh Ini",
  "Spend So Far": "Belanja Sejauh Ini",
  "— pax expected": "— pax diperkirakan datang",
  "— pax seated": "— pax duduk",
  "— pax released": "— pax dibatalkan",
  "— closed out": "— selesai",
  "pax seated": "pax duduk",
  "visits closed out": "kunjungan selesai",
  "No visits recorded yet": "Belum ada kunjungan tercatat",

  // 7-day strip
  "Booked, Next 7 Days": "Terisi, 7 Hari ke Depan",
  "Confirmed + reserved only": "Hanya yang dikonfirmasi + dipesan",

  // Booking channels tile
  "Booking Channels": "Kanal Reservasi",
  "Online reservation form": "Formulir reservasi online",
  "Full channel report →": "Laporan kanal lengkap →",
  "showed up": "datang",
  spend: "belanja",
  "No online form bookings in this period":
    "Belum ada reservasi dari formulir online di periode ini",
  "Booking source recorded for": "Sumber booking tercatat untuk",
  "Channel shares reflect recorded bookings only.":
    "Porsi kanal hanya mencerminkan booking yang tercatat.",
  "No bookings in this period.": "Tidak ada booking di periode ini.",

  // Who matters / spending tiers
  "Who Matters Most": "Tamu Paling Berpengaruh",
  "Spending tier breakdown": "Rincian tingkat belanja",
  "Medium vs high spender detail": "Detail belanja sedang vs tinggi",
  // NOTE: "Medium Spender" / "High Spender" / "Visits" are in
  // I18N_EXCEPTION_TERMS and deliberately stay English everywhere, so they
  // get no entry here.
  "Medium average spend per person": "Rata-rata belanja per orang (sedang)",
  "Medium total spending": "Total belanja (sedang)",

  "Menu & Dishes": "Menu & Hidangan",
  "Full menu link must start with http:// or https://":
    "Tautan menu lengkap harus dimulai dengan http:// atau https://",

  // Reservation source dropdown. Only the visible LABEL is translated —
  // the option `value` attribute stays English, so what lands in
  // reservations.reservation_source is language-independent.
  "Not recorded": "Tidak dicatat",
  WhatsApp: "WhatsApp",
  "Phone Call": "Telepon",
  "Walk-In Enquiry": "Tanya Langsung di Tempat",
  Instagram: "Instagram",
  "Referral / Word of Mouth": "Rekomendasi / Mulut ke Mulut",
  "Hotel Concierge": "Concierge Hotel",
  "Corporate / Event Organiser": "Korporat / Event Organizer",
  "Online Form (guest self-booked)": "Formulir Online (dipesan tamu sendiri)",
  "Other (type below)": "Lainnya (tulis di bawah)",
  "Describe the source": "Jelaskan sumbernya",

  // ══════════════════════════════════════════════════════════
  // REPORT > OPERATIONS — online form + repeat guests (2026-07-26)
  // ══════════════════════════════════════════════════════════
  "Online Form & Repeat Guests": "Formulir Online & Tamu Kembali",
  "Online Reservation Form": "Formulir Reservasi Online",
  "Bookings made by guests themselves, and what they spent":
    "Reservasi yang dibuat sendiri oleh tamu, beserta belanjanya",
  Bookings: "Reservasi",
  bookings: "booking",
  "— pax booked": "— pax dipesan",
  "Showed Up": "Datang",
  "— turned up": "— datang",
  "turned up": "datang",
  Lost: "Hilang",
  "cancelled / no-show": "dibatalkan / tidak datang",
  "still upcoming": "masih akan datang",
  "Spend Generated": "Belanja Dihasilkan",
  "— per guest who arrived": "— per tamu yang datang",
  "per guest who arrived": "per tamu yang datang",
  "no arrivals yet": "belum ada yang datang",
  "Booked For": "Dipesan Untuk",
  Outcome: "Hasil",
  Upcoming: "Akan Datang",
  "No show": "Tidak datang",
  "Did not arrive": "Tidak datang",
  "Could not load online form data": "Tidak dapat memuat data formulir online",
  'Spend is credited to a booking only via the visit linked to it. Bookings still in the future count as "upcoming", not as lost. Staff-deleted bookings are excluded.':
    'Belanja hanya dihitung untuk booking melalui kunjungan yang terhubung dengannya. Booking yang masih di masa depan dihitung sebagai "akan datang", bukan hilang. Booking yang dihapus staf tidak dihitung.',

  "Repeat Guests": "Tamu Kembali",
  "Guests who came back — how often, and how much they spent":
    "Tamu yang datang lagi — seberapa sering, dan berapa belanjanya",
  "Minimum visits": "Minimum kunjungan",
  visits: "kunjungan",
  "Avg / Visit": "Rata-rata / Kunjungan",
  "First Visit": "Kunjungan Pertama",
  "lifetime spend": "belanja seumur hidup",
  "No guests yet with at least": "Belum ada tamu dengan minimal",
  "Could not load repeat guests": "Tidak dapat memuat tamu kembali",
  Prev: "Sebelumnya",
  Next: "Berikutnya",
  "Lifetime figures, not filtered by the reporting period above — a repeat guest's value is the whole relationship. Voided visits excluded. Spend is only counted once a visit is closed out.":
    "Angka seumur hidup, tidak mengikuti filter periode di atas — nilai tamu kembali adalah keseluruhan hubungannya. Kunjungan yang dibatalkan (void) tidak dihitung. Belanja baru dihitung setelah kunjungan selesai.",

  // Reservation sources — coverage warning
  "Share of recorded": "Porsi dari yang tercatat",
  "Source recorded for": "Sumber tercatat untuk",
  "Source recorded for all": "Sumber tercatat untuk semua",
  "The remaining": "Sisanya",
  "were saved without a source, so the shares below describe recorded bookings only — not all bookings. Picking a source when taking a booking is what closes this gap.":
    "disimpan tanpa sumber, jadi porsi di bawah hanya menggambarkan booking yang tercatat — bukan seluruh booking. Memilih sumber saat menerima booking adalah cara menutup celah ini.",
  "Shares below are complete.": "Porsi di bawah sudah lengkap.",
  "No source recorded on any booking in this period":
    "Tidak ada sumber tercatat pada booking mana pun di periode ini",

  // ── Invoice Generator (2026-07-31) ────────────────────────────
  // Only the explanatory text, buttons and messages are translated.
  // The words that also appear on the printed sheet (Name, Table,
  // Pax, Items, Qty, Unit Price, Amount, Sub Total, Service Charge,
  // Tax, Total, Down Payment, Settlement) are deliberately absent
  // from this dictionary: the invoice itself is always English, and
  // a form field must read the same as the line it fills in.
  "Invoice Generator": "Pembuat Invoice",
  "Event bookings, large takeaway orders, and down payments. Fills the sheet on the right and downloads it as PDF — nothing is saved to the system.":
    "Untuk booking acara, pesanan takeaway besar, dan pembayaran DP. Mengisi lembar di sebelah kanan lalu mengunduhnya sebagai PDF. Tidak ada data yang disimpan ke sistem.",
  "Leave a date empty to hide that line on the invoice.":
    "Kosongkan tanggalnya kalau baris itu tidak perlu tampil di invoice.",
  "+ Add item": "+ Tambah item",
  "Amount is calculated as Qty × Unit Price. Type over it if you need a different figure.":
    "Amount dihitung dari Qty × Unit Price. Ketik ulang kalau butuh angka yang berbeda.",
  Totals: "Perhitungan",
  "Show a service charge line": "Tampilkan baris service charge",
  "Show a tax line": "Tampilkan baris pajak",
  "Show a down payment line": "Tampilkan baris down payment",
  "Show a settlement line (the rest still to pay)":
    "Tampilkan baris settlement (sisa yang masih harus dibayar)",
  'Settlement is Total minus Down Payment — what the guest still owes after the deposit. Turning this on also marks the down payment as already paid: its bar turns pale and reads "Down Payment Paid", so only the settlement reads as money still being asked for.':
    'Settlement adalah Total dikurangi Down Payment, yaitu sisa yang masih harus dibayar tamu setelah DP. Mengaktifkan ini juga menandai down payment sebagai sudah dibayar: barnya berubah menjadi biru muda dan bertuliskan "Down Payment Paid", sehingga hanya settlement yang terbaca sebagai tagihan yang belum dibayar.',
  "Note (bottom left of the invoice)": "Catatan (di kiri bawah invoice)",
  "Recent invoices": "Invoice terakhir",
  "this browser only": "hanya di browser ini",
  "Preview — this is exactly what the PDF will look like":
    "Pratinjau: persis seperti inilah tampilan PDF nanti",
  Clear: "Bersihkan",
  "Download PDF": "Unduh PDF",
  "Clear the form and start a new invoice?":
    "Bersihkan formulir dan mulai invoice baru?",
  // Item row placeholders and the small buttons beside each figure
  "Item name": "Nama item",
  "Unit price": "Harga satuan",
  "Amount (auto)": "Amount (otomatis)",
  "label only": "hanya label",
  Recalculate: "Hitung ulang",
  Remove: "Hapus",
  // Messages written by invoice.js. Ones carrying a number or a name
  // live in ID_DICT_PATTERNS in js/i18n.js instead.
  "Fill in the guest name first.": "Isi nama tamu dulu.",
  "Add at least one item.": "Tambahkan minimal satu item.",
  "PDF library did not load. Check the internet connection.":
    "Library PDF gagal dimuat. Cek koneksi internet.",
  "Could not build the PDF. Try again.": "Gagal membuat PDF. Coba lagi.",
  "Invoice downloaded.": "Invoice berhasil diunduh.",
  "Loaded. Edit anything, then download again.":
    "Invoice dimuat. Ubah seperlunya, lalu unduh lagi.",
  "Nothing yet. The last 5 invoices you download appear here so you can re-open one.":
    "Belum ada. 5 invoice terakhir yang Anda unduh akan muncul di sini supaya bisa dibuka lagi.",
  "(no name)": "(tanpa nama)",

  // ── Vouchers (standalone, 2026-08-01) ─────────────────────────
  // "Voucher" itself is the same word in both languages, so it is
  // left alone. Codes and the printed card are never translated.
  "Gift vouchers outside the membership programme. Every voucher gets a code, an expiry, and a record of who redeemed it.":
    "Voucher hadiah di luar program membership. Setiap voucher punya kode, masa berlaku, dan catatan siapa yang menukarkannya.",
  "Redeem a voucher": "Tukarkan voucher",
  "Search by the guest's name, or by the code if they can show it.":
    "Cari dari nama tamu, atau dari kodenya kalau tamu bisa menunjukkannya.",
  "Name, phone, partner or code": "Nama, nomor HP, partner, atau kode",
  Search: "Cari",
  "Issue a voucher": "Terbitkan voucher",
  Occasion: "Keperluan",
  "Top spender thank you": "Terima kasih untuk top spender",
  "Most visits thank you": "Terima kasih untuk tamu paling sering datang",
  Birthday: "Ulang tahun",
  "Partnership / company": "Kerja sama / perusahaan",
  "Service recovery": "Permintaan maaf",
  Other: "Lainnya",
  "Partner or company": "Partner atau perusahaan",
  Recipient: "Penerima",
  "Search a guest by name or phone": "Cari tamu dari nama atau nomor HP",
  // Reservations page guest search (2026-08-09)
  "Searching...": "Mencari...",
  "No guests found": "Tamu tidak ditemukan",
  "Clear search": "Hapus pencarian",
  "Search results for": "Hasil pencarian untuk",
  "Back to day view": "Kembali ke tampilan harian",
  "No reservations found": "Tidak ada reservasi ditemukan",
  "1 reservation found": "1 reservasi ditemukan",
  "No reservations found for this guest": "Tidak ada reservasi untuk tamu ini",
  "Type at least 2 characters to search": "Ketik minimal 2 huruf untuk mencari",
  "all dates": "semua tanggal",
  "Not in the guest list? Just type the name below instead.":
    "Tidak ada di daftar tamu? Ketik saja namanya di bawah ini.",
  "Name on the voucher": "Nama di voucher",
  "What is it worth": "Nilai voucher",
  Amount: "Nominal",
  Percent: "Persen",
  "Free item": "Item gratis",
  "A fixed rupiah discount. This is the only type where budget reporting is exact.":
    "Potongan rupiah tetap. Hanya tipe ini yang laporan budget-nya persis.",
  "A percentage of the bill. Set a maximum so an unusually large table cannot cost more than intended.":
    "Persentase dari total bill. Beri batas maksimal supaya meja besar tidak jadi lebih mahal dari rencana.",
  "A free item. The cost figure is what it costs the restaurant, and is what the batch report totals.":
    "Item gratis. Angka biayanya adalah ongkos untuk restoran, dan itu yang dijumlahkan di laporan batch.",
  "Minimum spend (optional)": "Minimum transaksi (opsional)",
  "Valid until": "Berlaku sampai",
  "Line on the card": "Tulisan di kartu",
  "Printed under the date, in whatever words suit the guest. Leave it empty to use the occasion. Editable later on the card itself.":
    "Dicetak di bawah tanggal, pakai kalimat yang paling pas untuk tamunya. Kosongkan kalau mau memakai keperluannya. Bisa diubah nanti langsung di kartunya.",
  "Saved to the voucher, not just this preview, so a re-download says the same thing.":
    "Tersimpan di vouchernya, bukan cuma di pratinjau ini, jadi kalau diunduh ulang tulisannya tetap sama.",
  "Card line saved.": "Tulisan kartu tersimpan.",
  "Could not save the card line.": "Gagal menyimpan tulisan kartu.",
  "Note (internal, not printed)": "Catatan (internal, tidak dicetak)",
  "How many": "Berapa banyak",
  "Batch label": "Label batch",
  "One voucher. A batch label is optional.":
    "Satu voucher. Label batch opsional.",
  "Issue voucher": "Terbitkan voucher",
  "Issued vouchers": "Voucher yang sudah terbit",
  "Code, name or partner": "Kode, nama, atau partner",
  Batches: "Batch",
  "What was handed out, what came back, and what is still outstanding.":
    "Berapa yang dibagikan, berapa yang kembali, dan berapa yang masih beredar.",
  Redeemed: "Ditukar",
  Expired: "Kadaluarsa",
  All: "Semua",
  // Voucher statuses reuse words the dictionary already defines
  // (Active, Cancelled, Close, Phone (optional)) rather than
  // redefining them — a duplicate key here would silently change
  // what those words mean on every other screen.
  Void: "Batal",
  Card: "Kartu",
  "No vouchers issued yet.": "Belum ada voucher yang diterbitkan.",
  "Nothing matches this filter.": "Tidak ada yang cocok dengan filter ini.",
  "No batches yet.": "Belum ada batch.",
  Redeem: "Tukarkan",
  "Redeem anyway": "Tetap tukarkan",
  "Cancel this voucher": "Batalkan voucher ini",
  "Voucher card": "Kartu voucher",
  "Download card": "Unduh kartu",
  "Open WhatsApp": "Buka WhatsApp",
  For: "Untuk",
  Worth: "Nilai",
  Status: "Status",
  Unlink: "Lepas tautan",
  // Messages
  "Add a recipient: pick a guest, type a name, or name the partner.":
    "Tambahkan penerima: pilih tamu, ketik nama, atau isi nama partner.",
  "Name the partner or company this batch is for.":
    "Isi nama partner atau perusahaan untuk batch ini.",
  "Enter the voucher amount.": "Isi nominal vouchernya.",
  "Enter a percentage between 1 and 100.": "Isi persentase antara 1 dan 100.",
  "Describe the free item.": "Tulis item gratisnya apa.",
  "Set a valid-until date.": "Tentukan tanggal berlaku sampai kapan.",
  "Valid until is in the past.": "Tanggal berlakunya sudah lewat.",
  "How many must be between 1 and 200.": "Jumlahnya harus antara 1 dan 200.",
  "A batch cannot be linked to one guest. Unlink the guest, or issue them one voucher.":
    "Batch tidak bisa ditautkan ke satu tamu. Lepas tautannya, atau terbitkan satu voucher saja untuk tamu itu.",
  "Could not issue the voucher. If this keeps happening the database migration may not be applied yet.":
    "Gagal menerbitkan voucher. Kalau terus terjadi, kemungkinan migrasi database-nya belum dijalankan.",
  "Already redeemed. Someone got there first.":
    "Sudah ditukar. Ada yang menukarkannya lebih dulu.",
  "Expired. Use 'Redeem anyway' if you are honouring it.":
    "Sudah kadaluarsa. Pakai 'Tetap tukarkan' kalau memang mau dilayani.",
  "This voucher was cancelled.": "Voucher ini sudah dibatalkan.",
  "Could not redeem. Try again.": "Gagal menukarkan. Coba lagi.",
  "Already redeemed, so it cannot be cancelled.":
    "Sudah ditukar, jadi tidak bisa dibatalkan.",
  "Could not cancel. Try again.": "Gagal membatalkan. Coba lagi.",
  "Could not reach the database. Try again.":
    "Tidak bisa terhubung ke database. Coba lagi.",
  "Card saved. Attach it in WhatsApp.":
    "Kartu tersimpan. Lampirkan manual di WhatsApp ya.",
  "Could not save the card image.": "Gagal menyimpan gambar kartu.",
  "No phone number on this voucher. Add one, or send the image yourself.":
    "Voucher ini tidak ada nomor HP-nya. Tambahkan, atau kirim gambarnya sendiri.",
  "This voucher was just redeemed — do not send it.":
    "Voucher ini baru saja ditukar, jangan dikirim.",
  "This voucher was cancelled — do not send it.":
    "Voucher ini sudah dibatalkan, jangan dikirim.",
  "Could not load vouchers. If this is the first run, the database migration may not be applied yet.":
    "Gagal memuat voucher. Kalau ini pertama kali dijalankan, kemungkinan migrasi database-nya belum dijalankan.",
  "Drawing the card…": "Menyiapkan kartu…",
  "Could not draw the card.": "Gagal menyiapkan kartu.",
  "Preparing…": "Menyiapkan…",
  "Issuing…": "Menerbitkan…",

  // ══════════════════════════════════════════════════════════
  // TOTAL RESERVATIONS + TOTAL PAX (2026-08-06)
  // Reservations day summary and the Upcoming Reservations tabs.
  // ══════════════════════════════════════════════════════════
  "Reservations Today": "Reservasi Hari Ini",
  "Total Pax": "Total Pax",
  "all reservations, placed or not": "semua reservasi, ditempatkan atau belum",
  "Not yet placed": "Belum ditempatkan",
  "not yet placed": "belum ditempatkan",
  "not counted in the area figures above": "belum masuk hitungan area di atas",
  reservations: "reservasi",
  "Expected Pax": "Perkiraan Pax",
  "cancelled / no-show, not counted":
    "dibatalkan / tidak datang, tidak dihitung",
  "seats remaining": "kursi tersisa",
  "Next 3 days": "3 hari ke depan",
};

function t(str) {
  if (!str) return str;
  if (CURRENT_LANG === "en") return str;
  if (I18N_EXCEPTION_TERMS.has(str)) return str;
  return Object.prototype.hasOwnProperty.call(ID_DICT, str)
    ? ID_DICT[str]
    : str;
}

// Caches the originally-authored English text of static DOM elements the
// first time it sees them, so switching back to EN restores it exactly —
// elements are marked with data-i18n (text), data-i18n-placeholder, or
// data-i18n-title in the HTML.
function initI18nCache() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.dataset.i18nEn === undefined) el.dataset.i18nEn = el.textContent;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    if (el.dataset.i18nPhEn === undefined)
      el.dataset.i18nPhEn = el.getAttribute("placeholder") || "";
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    if (el.dataset.i18nTitleEn === undefined)
      el.dataset.i18nTitleEn = el.getAttribute("title") || "";
  });
}

function translateStaticDOM() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18nEn ?? el.textContent);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPhEn ?? ""));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitleEn ?? ""));
  });
  updateLangToggleUI();
}

function updateLangToggleUI() {
  const idBtn = document.getElementById("lang-toggle-id");
  const enBtn = document.getElementById("lang-toggle-en");
  if (!idBtn || !enBtn) return;
  const activeClass =
    "px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[color:var(--brand-ink)] text-white transition-colors";
  const inactiveClass =
    "px-2 py-0.5 rounded-full text-[11px] font-semibold text-[#999] hover:text-[#555] transition-colors";
  idBtn.className = CURRENT_LANG === "id" ? activeClass : inactiveClass;
  enBtn.className = CURRENT_LANG === "en" ? activeClass : inactiveClass;
}

// setLanguage() lives in js/i18n.js (loaded right after this file) — it
// needs to sit alongside the DOM-mutation translator (i18nTranslateTree)
// that does the heavy lifting for dynamically-rendered content.

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

const fmt = {
  date: (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(
      CURRENT_LANG === "id" ? "id-ID" : "en-GB",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
  },
  time: (t) => {
    if (!t) return "—";
    const [h, m] = t.split(":");
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
  },
  phone: (p) => p || "—",
  currency: (n) => (n ? `Rp ${Number(n).toLocaleString("id-ID")}` : "—"),
  pax: (n) => `${n} pax`,
};

const STATUS_COLORS = {
  Reserved: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  // A booking nobody has agreed to yet. It MUST NOT look like Reserved: the
  // fallback in statusBadge() is Reserved, so without this entry a waitlisted
  // booking is visually a confirmed one and staff have no idea it needs a
  // decision. Orange is the "this wants a human" colour here, and Confirmed is
  // listed for the same reason.
  Waitlist: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  Confirmed: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  Arrived: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400" },
  Cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-400" },
  "Cancelled (No Show)": {
    bg: "bg-gray-100",
    text: "text-gray-500",
    dot: "bg-gray-400",
  },
  Completed: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    dot: "bg-purple-400",
  },
  Deleted: {
    bg: "bg-gray-100",
    text: "text-gray-500",
    dot: "bg-gray-400",
  },
};

function statusBadge(status) {
  const c = STATUS_COLORS[status] || STATUS_COLORS["Reserved"];
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}">
    <span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span>${t(status)}
  </span>`;
}

function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  if (!el) return;
  const colors =
    type === "success" ? "bg-[color:var(--brand)] text-white" : "bg-red-600 text-white";
  el.className = `fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-xl text-sm font-medium transition-all duration-300 ${colors}`;
  // Must sit ABOVE modal overlays (z-index 100) and the page loader (200),
  // otherwise error toasts fired while a modal is open are invisible.
  el.style.zIndex = "300";
  el.textContent = t(msg);
  el.style.opacity = "1";
  el.style.transform = "translateY(0)";
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(12px)";
  }, 3000);
}

function showModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
}
function hideModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

function loader(show) {
  const el = document.getElementById("page-loader");
  if (el) el.style.display = show ? "flex" : "none";
}

function setActivePage(page) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("nav-active", el.dataset.nav === page);
  });
}

function getStaffSession() {
  try {
    return JSON.parse(localStorage.getItem(STAFF_SESSION_KEY));
  } catch (error) {
    return null;
  }
}

function setStaffSession(user) {
  localStorage.setItem(
    STAFF_SESSION_KEY,
    JSON.stringify({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role || "staff",
    }),
  );
}

function clearStaffSession() {
  localStorage.removeItem(STAFF_SESSION_KEY);
}

function currentStaffId() {
  return getStaffSession()?.id || null;
}

function currentStaffRole() {
  return getStaffSession()?.role || "staff";
}

// Manager and admin have identical permissions everywhere except the
// dashboard content — use this instead of comparing to "manager" directly
// for any manager-gated action so admin doesn't silently lose access.
function isManagerOrAdmin() {
  const role = currentStaffRole();
  return role === "manager" || role === "admin";
}

// Pages that staff (non-manager) are allowed to access.
// "settings" resolves to a subpage in navigateTo(); staff can VIEW
// Areas and the dish list (settings-menu) but every edit action there
// is manager-gated (manager-only-ui + checks inside the save functions).
// Prizes and settings-thresholds stay manager-only.
const STAFF_ALLOWED_PAGES = new Set([
  "dashboard",
  "reservations",
  "walkins",
  "settings",
  "areas",
  "settings-menu",
  "membership",
  "broadcast",
]);

// Pages only the admin (owner/head-chef) should ever see — NOT a security
// boundary, just a "this would be a duplicate for you" rule.
//
// "staff-dashboard" (added 2026-07-26, Rere) lets the owner look at the same
// dashboard the front desk uses. It is admin-only because for a manager or
// staff member the normal "Dashboard" entry ALREADY renders that exact page
// — only admin gets the owner dashboard swapped in — so showing it to them
// would put two identical destinations in the sidebar.
// "settings-staff" (added 2026-08-23, Rere) is the screen that creates staff
// accounts and sets their roles. Admin-only by decision: a manager who could
// edit roles could promote themselves, which makes the role system decorative.
//
// NOTE this is a UI gate, not a security boundary. The anon key is public and
// RLS is off, so anyone who can reach the app can write staff_users directly.
// The one rule that is genuinely enforced is "never zero active admins",
// which lives in a database trigger. See CLAUDE.md, "Must be fixed before the
// first sale".
const ADMIN_ONLY_PAGES = new Set(["staff-dashboard", "settings-staff"]);

// Admin (owner/head-chef) gets full manager-level access to every page —
// the only difference is the dashboard content, swapped in navigateTo().
function hasAccess(page) {
  const role = currentStaffRole();
  if (ADMIN_ONLY_PAGES.has(page)) return role === "admin";
  if (role === "manager" || role === "admin") return true;
  return STAFF_ALLOWED_PAGES.has(page);
}

function applyRoleToNav() {
  const role = currentStaffRole();
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const page = btn.dataset.nav;
    const allowed = ADMIN_ONLY_PAGES.has(page)
      ? role === "admin"
      : role === "manager" || role === "admin" || STAFF_ALLOWED_PAGES.has(page);
    btn.classList.toggle("nav-role-hidden", !allowed);
    btn.style.display = allowed ? "" : "none";
    // A nav item may sit inside a wrapper that carries a divider rule.
    // Hiding only the button would leave an orphan line in the sidebar.
    const wrap = document.querySelector(`[data-nav-wrap="${page}"]`);
    if (wrap) wrap.style.display = allowed ? "" : "none";
  });

  // Show/hide the role badge in the sidebar
  const badge = document.getElementById("staff-role-badge");
  if (badge) {
    badge.textContent =
      role === "admin"
        ? t("Admin")
        : role === "manager"
          ? t("Manager")
          : t("Staff");
    badge.className =
      role === "admin"
        ? "inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#8B5E3C] text-white"
        : role === "manager"
          ? "inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[color:var(--brand-ink)] text-white"
          : "inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#E7E4DE] text-[#555]";
  }

  applyManagerOnlyUI();
}

// Generic manager-gate for any element (buttons, filter chips) marked with
// class "manager-only-ui" — used by the delete-reservation / void-walk-in
// feature so staff never even sees the action, not just gets blocked on click.
// Called on login (via applyRoleToNav) AND again after any dynamic re-render
// (openResActions, loadWalkIns, loadReservations) since those replace
// innerHTML and would otherwise reset elements back to visible.
function applyManagerOnlyUI() {
  const role = currentStaffRole();
  const isManager = role === "manager" || role === "admin";
  document.querySelectorAll(".manager-only-ui").forEach((el) => {
    el.style.display = isManager ? "" : "none";
  });
}


// ============================================================
// RESERVATION PAGE APPEARANCE (per-client, set in Settings)
// ============================================================
// The guest-facing booking page and the thank-you page that follows it are
// driven by four CSS custom properties. This reads the saved values and sets
// them; the bundled defaults live in each page's own :root, so a page renders
// correctly before this resolves and stays correct if it never does.
//
// reserve.html does NOT use this. It builds its own Supabase client from the
// build-time placeholders and cannot load config.js without redeclaring
// `const SUPABASE_URL`, so it carries a copy of these two functions inline.
// Change one, change the other. The duplication is deliberate and marked at
// both ends.

const RESERVE_APPEARANCE_DEFAULTS = {
  bg_url: null,
  // LITERAL HEX, not var(). These are validated by isHexColor() and fed to an
  // <input type="color">, neither of which understands a custom property. The
  // 2026-09-05 brand sweep turned them into var() and a client with no saved
  // appearance would have got no panel colour at all, silently. Keep them in
  // step with --brand-ink / --brand by hand.
  glass_color: "#4F41A8",
  glass_opacity: 0.6,
  accent_color: "#5B4CBD",
  logo_max_height: 72,
};

// Opacity bounds. 0 makes the booking form invisible against the photo and 1
// throws away the glass effect; neither is a look anyone picks on purpose, so
// the slider and this clamp agree on the same range.
const RESERVE_GLASS_MIN_OPACITY = 0.25;
const RESERVE_GLASS_MAX_OPACITY = 0.95;
const RESERVE_LOGO_MIN_H = 32;
const RESERVE_LOGO_MAX_H = 200;

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "").trim());
}

// Darkens (amount < 0) or lightens a hex colour. Used so the button gradient
// needs ONE colour from the user instead of two that could be set to clash.
function shadeHex(hex, amount) {
  if (!isHexColor(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((n >> 16) & 255) * (1 + amount));
  const g = cl(((n >> 8) & 255) * (1 + amount));
  const b = cl((n & 255) * (1 + amount));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function hexToRgba(hex, alpha) {
  if (!isHexColor(hex)) return null;
  const h = hex.trim();
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clampGlassOpacity(value) {
  const n = Number(value);
  if (!isFinite(n)) return RESERVE_APPEARANCE_DEFAULTS.glass_opacity;
  return Math.min(RESERVE_GLASS_MAX_OPACITY, Math.max(RESERVE_GLASS_MIN_OPACITY, n));
}

let RESERVE_APPEARANCE = null;

async function loadReserveAppearance(preloaded) {
  if (preloaded && typeof preloaded === "object") {
    RESERVE_APPEARANCE = preloaded;
    return RESERVE_APPEARANCE;
  }
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "reserve_appearance")
      .maybeSingle();
    if (error) console.warn("reserve appearance: load failed, using defaults", error);
    RESERVE_APPEARANCE = (data && data.value) || {};
  } catch (e) {
    console.warn("reserve appearance: load failed, using defaults", e);
    RESERVE_APPEARANCE = {};
  }
  return RESERVE_APPEARANCE;
}

// Every value is validated before it reaches the page. These settings are
// edited by a restaurant owner, not a designer, and a typo in a colour field
// must degrade to the bundled look rather than to an unreadable booking form.
function applyReserveAppearance(cfg, target) {
  const conf = cfg || RESERVE_APPEARANCE || {};
  const root = (target || document.documentElement).style;

  const bg = String(conf.bg_url || "").trim();
  if (/^https?:\/\/\S+$/i.test(bg)) root.setProperty("--rf-bg-image", `url("${bg}")`);

  if (isHexColor(conf.glass_color)) {
    const rgba = hexToRgba(conf.glass_color, clampGlassOpacity(conf.glass_opacity));
    if (rgba) root.setProperty("--rf-glass", rgba);
  }

  if (isHexColor(conf.accent_color)) {
    root.setProperty("--primary", conf.accent_color.trim());
    root.setProperty("--dark", shadeHex(conf.accent_color.trim(), -0.32));
  }

  const h = Number(conf.logo_max_height);
  if (h >= RESERVE_LOGO_MIN_H && h <= RESERVE_LOGO_MAX_H)
    root.setProperty("--rf-logo-max-h", h + "px");
}

async function initReserveAppearance(preloaded) {
  await loadReserveAppearance(preloaded);
  applyReserveAppearance();
}

// ============================================================
// BRANDING (per-client logo, configurable from Settings)
// ============================================================
// Every client runs byte-identical code, so the logo cannot be a file in the
// repo. It is an upload in the `branding` storage bucket, with its public URL
// in app_settings.branding.
//
// The files in assets/ stay, as the FALLBACK. That is deliberate:
//   - a fresh client sees a working page before anyone uploads anything
//   - a storage outage or a deleted object degrades to a logo, not a hole
//   - the public pages render instantly and swap the logo when the fetch
//     lands, instead of showing an empty box while waiting
//
// Three slots, because they are three different pictures and one image
// cannot do all three jobs:
//   full   the wide wordmark  -> guest pages, login, sidebar, invoice header
//   small  the square mark    -> favicon, invoice watermark
//   voucher the whole card artwork, 1084x1940 -> the downloadable voucher PNG
//
// WHAT THIS DOES NOT COVER: the og:image share card on the booking link.
// WhatsApp's crawler does not run JavaScript, so that tag has to point at a
// real file. Changing the logo here does not change the WhatsApp preview.
// See CLAUDE.md, "WhatsApp constraints".
const BRAND_BUCKET = "branding";
const BRAND_FALLBACK = {
  full: "assets/full-logo.png",
  small: "assets/small-logo.png",
  voucher: "assets/voucher-bg.jpg",
};
const BRAND_KEYS = {
  full: "logo_url",
  small: "small_logo_url",
  voucher: "voucher_bg_url",
};

// null until loadBranding() has run. Deliberately NOT seeded with the
// fallbacks, so brandAsset() can tell "not loaded yet" from "loaded, empty".
let BRANDING = null;

// A URL is only usable if it is an absolute http(s) URL. A half-saved value,
// a relative path someone typed by hand, or a javascript: URI all fall back
// to the bundled asset rather than rendering a broken image.
function brandUrlOk(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

function brandAsset(slot) {
  const key = BRAND_KEYS[slot];
  const value = BRANDING && key ? BRANDING[key] : null;
  return brandUrlOk(value) ? value.trim() : BRAND_FALLBACK[slot] || null;
}

// Reads the branding row. Pass the value in when the caller already has the
// whole app_settings table in hand (the staff app does), so the app does not
// pay for a second round trip on every load.
async function loadBranding(preloaded) {
  if (preloaded && typeof preloaded === "object") {
    BRANDING = preloaded;
    return BRANDING;
  }
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "branding")
      .maybeSingle();
    // An error here is not worth a toast on a guest-facing page: the fallback
    // logo is already on screen and the guest is trying to book a table.
    if (error) console.warn("branding: load failed, using bundled assets", error);
    BRANDING = (data && data.value) || {};
  } catch (e) {
    console.warn("branding: load failed, using bundled assets", e);
    BRANDING = {};
  }
  return BRANDING;
}

// Swaps every element marked data-brand-logo="full" | "small", plus the
// favicon. Safe to call before loadBranding() (it just re-applies the
// fallbacks) and safe to call repeatedly after a re-render.
function applyBranding(root) {
  const scope = root || document;
  ["full", "small"].forEach((slot) => {
    const url = brandAsset(slot);
    if (!url) return;
    scope.querySelectorAll(`[data-brand-logo="${slot}"]`).forEach((el) => {
      // Only touch it if it differs, so a re-render does not restart the
      // image download and make the logo blink.
      if (el.tagName === "IMG") {
        if (el.getAttribute("src") !== url) el.setAttribute("src", url);
      } else {
        const css = `url("${url}")`;
        if (el.style.backgroundImage !== css) el.style.backgroundImage = css;
      }
    });
  });
  const favicon = brandAsset("small");
  if (favicon) {
    document
      .querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
      .forEach((el) => {
        if (el.getAttribute("href") !== favicon) el.setAttribute("href", favicon);
      });
  }
}

// One call for the public pages: render with the bundled logo, then swap.
async function initBranding(preloaded) {
  await loadBranding(preloaded);
  applyBranding();
}


// ══════════════════════════════════════════════════════════════
// ymd(date) — the ONLY correct way to turn a Date into the
// "YYYY-MM-DD" string our date columns use.
// ══════════════════════════════════════════════════════════════
// NEVER use `date.toISOString().split("T")[0]` for this. toISOString
// formats in UTC, and Jakarta is UTC+7, so local midnight on 19 Jul
// serialises as "2026-07-18T17:00:00Z" — one day EARLIER than intended.
//
// That bug shipped in 14 places and caused, among other things, the
// Peak Traffic chart to draw a column for 18 Jul while filtering 18 Jul's
// data out of the series (reported by Rere 2026-07-26), and the staff
// dashboard to show the previous day's list before 07:00 Jakarta time.
//
// getFullYear/getMonth/getDate are all local-time getters, so this is
// timezone-correct anywhere east or west of UTC.
function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const localNow = new Date();
const TODAY = ymd(localNow);

// Returns the current local time as "HH:MM" — called at the moment of saving,
// NOT a frozen constant, so each walk-in gets its actual arrival time.
function getNowTime() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

// Full month names, used by the birthday report's month navigator/labels
// (app.js) instead of hardcoded English arrays, so they follow CURRENT_LANG.
const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
// monthIndex1based: 1 = January/Januari
function monthNameLong(monthIndex1based) {
  const arr = CURRENT_LANG === "id" ? MONTH_NAMES_ID : MONTH_NAMES_EN;
  return arr[monthIndex1based - 1] || "";
}

// devCacheKey (optional): in DEV MODE ONLY, cache the successful result
// in sessionStorage for DEV_CACHE_TTL_MS so live-reload doesn't refetch.
// Production behavior is completely unchanged (key is ignored). Only use
// for queries whose shape never varies with filters/arguments — a varying
// query under a fixed key would serve wrong cached data.
async function supabaseQuery(
  queryFn,
  errorMsg = "Supabase request failed",
  devCacheKey = null,
) {
  const useCache = typeof IS_DEV !== "undefined" && IS_DEV && devCacheKey;
  if (useCache) {
    try {
      const raw = sessionStorage.getItem("devcache:" + devCacheKey);
      if (raw) {
        const { t, data } = JSON.parse(raw);
        if (Date.now() - t < DEV_CACHE_TTL_MS)
          return { data, error: null, fromDevCache: true };
      }
    } catch (e) {
      /* corrupt cache entry — fall through to a real fetch */
    }
  }
  try {
    const { data, error } = await queryFn();
    if (error) {
      console.error(errorMsg, error);
      return { data: null, error };
    }
    if (useCache) {
      try {
        sessionStorage.setItem(
          "devcache:" + devCacheKey,
          JSON.stringify({ t: Date.now(), data }),
        );
      } catch (e) {
        /* sessionStorage full — skip caching, never break the query */
      }
    }
    return { data, error: null };
  } catch (error) {
    console.error(errorMsg, error);
    return { data: null, error };
  }
}

async function testSupabaseConnection() {
  const { data, error } = await supabaseQuery(
    () => db.from("areas").select("id").limit(1),
    "Unable to connect to Supabase",
  );
  if (error) {
    toast(
      "Unable to connect to Supabase. Check credentials and RLS policies.",
      "error",
    );
    return false;
  }
  return true;
}
