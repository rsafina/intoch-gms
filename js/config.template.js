// ============================================================
// BLUE HERON GUEST BOOK — Supabase Config & Utilities
// ============================================================

// GENERATED FILE — do not edit js/config.js directly and do not commit it.
// Edit js/config.template.js instead. `node build-config.js` fills the two
// placeholders below from the SUPABASE_URL / SUPABASE_ANON_KEY environment
// variables set per client in the hosting dashboard.
const IS_STAGING = false;
const SUPABASE_URL = "https://hkrhsubhfqrgqkuhpvql.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcmhzdWJoZnFyZ3FrdWhwdnFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NjIyMTgsImV4cCI6MjEwMjQzODIxOH0.36wTWGzXYBMzurfIQDH6pCx0Kyd9I6H8KKiA9CFn8aI";

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
const STAFF_SESSION_KEY = "blueHeronStaffUser";

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
    "px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#28547C] text-white transition-colors";
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
    type === "success" ? "bg-[#5596CE] text-white" : "bg-red-600 text-white";
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
const ADMIN_ONLY_PAGES = new Set(["staff-dashboard"]);

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
          ? "inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#28547C] text-white"
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
