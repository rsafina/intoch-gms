// ============================================================
// GUEST-PAGE LANGUAGE (Indonesian default, English toggle)
// ============================================================
// The four pages a guest sees — the booking form, the page after it, the
// reservation confirmation and the spin wheel — are authored in ENGLISH and
// translated into Indonesian at runtime. Same direction as the staff app, for
// the same reason: the dictionary is keyed by the English sentence as written
// in the page, so a missing entry shows readable English rather than a blank
// label or a raw key.
//
// This file is loaded by ALL FOUR pages, including reserve.html. That page
// cannot load js/config.js — both declare `const SUPABASE_URL` and the
// redeclaration kills the page — but the restriction is about that one file,
// not about scripts in general. Everything here is named so it can sit
// alongside config.js on the pages that do load it: gt() not t(), GUEST_DICT
// not ID_DICT. A second copy of this dictionary is exactly the thing this
// file exists to prevent, so do not inline it into a page.
//
// The client's OWN words are never translated: the welcome line, dish names
// and descriptions, area names, and staff-written closure reasons are typed by
// the restaurant and printed as they were typed.

const GUEST_LANG_KEY = "intoch_guest_lang";
// Last known value of the restaurant's setting. Kept only so the FIRST paint
// of a repeat visit is already right: the setting itself lives in the
// database, this is a hint, and it is overwritten by the real value on every
// load. See initGuestLanguageSync() for why the hint is worth having.
const GUEST_SETTING_CACHE_KEY = "intoch_guest_lang_setting";
const GUEST_LANGS = ["id", "en"];

// Product terms that stay English in both languages, the guest-page half of
// I18N_EXCEPTION_TERMS in config.js.
// Terms that are already the same in both languages, or are product names.
// They belong HERE rather than as identity entries in the dictionary: an
// entry whose translation equals its key is indistinguishable from a
// translation somebody forgot to write.
const GUEST_KEEP_ENGLISH = new Set([
  "Best Seller",
  "Chef's Recommendation",
  "WhatsApp",
  "Deposit (DP)", // DP is the Indonesian abbreviation already
]);

// Indonesian, keyed by the English source string.
//
// {n}, {min}, {pct} and friends are filled in by the caller AFTER translation.
// Sentences are whole on purpose: a message assembled from three translated
// fragments matches no dictionary key once it is concatenated, which is the
// trap the prototype fell into.
const GUEST_DICT = {
  // ── Booking form: the form itself ──
  "Book a Table": "Reservasi Meja",
  "It only takes a minute. Book now, and see you soon!":
    "Hanya butuh 1 menit, reservasi dengan cepat, sampai jumpa!",
  Name: "Nama",
  "Your name": "Nama Anda",
  "WhatsApp Number": "Nomor WhatsApp",
  "Number of Guests": "Jumlah Tamu",
  "Number of guests": "Jumlah tamu",
  Fewer: "Kurangi",
  More: "Tambah",
  "Choose an Area": "Pilih Area",
  Date: "Tanggal",
  Time: "Jam",
  Company: "Perusahaan",
  "Company name": "Nama perusahaan",
  Notes: "Catatan",
  "(optional)": "(opsional)",
  "Romantic decoration, pre-ordered dishes, a baby chair, and so on.":
    "Bisa dekorasi romantis, pre-order menu, baby chair, dsb.",
  "Reserve Now": "Pesan Sekarang",
  "Book a private room if available": "Pesan ruang privat jika tersedia",
  "Sending...": "Mengirim...",

  // ── Booking form: the hour picker ──
  "+{n} more hours": "+{n} jam lainnya",
  "Show fewer": "Tampilkan lebih sedikit",
  "No hours can be picked for this date yet.":
    "Belum ada jam yang bisa dipilih untuk tanggal ini.",
  "Closed on this date: {reason}": "Tutup pada tanggal ini: {reason}",
  "We are closed on this date. Please pick another one.":
    "Kami tutup pada tanggal ini. Mohon pilih tanggal lain.",
  "Today is fully booked. Please pick another date, or contact us on WhatsApp.":
    "Slot hari ini sudah habis. Silakan pilih tanggal lain atau hubungi kami via WhatsApp.",
  "No hours can be booked on this date. Please pick another one.":
    "Tidak ada jam yang bisa dipesan pada tanggal ini. Mohon pilih tanggal lain.",

  // ── Booking form: area conditions ──
  "Minimum guests": "Minimum tamu",
  "{n} people": "{n} orang",
  "Minimum spend": "Minimum belanja",
  "No special conditions": "Tidak ada ketentuan khusus",
  "{pct}% booked": "Sudah {pct}% terisi",
  "around {n} tables free": "kira-kira {n} meja",

  // ── Booking form: what the guest is told before submitting ──
  "Parties of more than {n} are reviewed first, so your booking goes in as a request.":
    "Rombongan lebih dari {n} orang kami tinjau dulu. Reservasi Anda masuk sebagai permintaan.",
  "Please choose an area first.": "Mohon pilih area terlebih dahulu.",

  // ── Booking form: the server's refusals ──
  "Please fill in your name (2-80 characters).":
    "Mohon isi nama Anda (2-80 karakter).",
  "That phone number is not valid. Example: 0812xxxxxxxx.":
    "Nomor telepon tidak valid. Contoh: 0812xxxxxxxx.",
  "Please fill in the number of guests (at least 1).":
    "Mohon isi jumlah tamu (minimal 1 orang).",
  "Sorry, a party that size is larger than our whole restaurant. Please contact us on WhatsApp for a large event.":
    "Maaf, rombongan sebesar itu melebihi kapasitas seluruh restoran kami. Silakan hubungi kami via WhatsApp untuk acara besar.",
  "That area cannot be booked online at the moment. Please choose another one.":
    "Area tersebut sedang tidak bisa dipesan online. Silakan pilih area lain.",
  "That area is full on that date. Please pick another date or area, or contact us on WhatsApp to go on the waiting list.":
    "Area tersebut sudah penuh di tanggal itu. Silakan pilih tanggal atau area lain, atau hubungi kami via WhatsApp untuk masuk daftar tunggu.",
  "Please pick a date and a time.": "Mohon pilih tanggal dan jam.",
  "That date has passed. Please pick another one.":
    "Tanggal sudah lewat. Mohon pilih tanggal lain.",
  "Reservations can be made up to {n} days ahead.":
    "Reservasi maksimal {n} hari ke depan.",
  "That time is outside our opening hours.":
    "Jam tersebut di luar jam operasional kami.",
  "For today, please book at least {n} minutes ahead. Pick another time, or contact us on WhatsApp.":
    "Untuk hari ini, reservasi minimal {n} menit sebelumnya. Silakan pilih jam lain atau hubungi kami via WhatsApp.",
  "This number already has a reservation on that date. To change it, please contact us on WhatsApp.":
    "Nomor ini sudah punya reservasi di tanggal tersebut. Untuk mengubahnya, silakan hubungi kami via WhatsApp.",
  "We are not taking online reservations at the moment. Please contact us on WhatsApp.":
    "Kami sedang tidak menerima reservasi online. Silakan hubungi kami via WhatsApp.",
  "Reservations have to be made a few days ahead. Please pick another date.":
    "Reservasi harus dibuat beberapa hari sebelumnya. Mohon pilih tanggal lain.",
  "Connection problem. Please try again.": "Koneksi bermasalah. Mohon coba lagi.",

  // ── Booking form: the signature dishes sheet ──
  "Our Signatures": "Menu Andalan Kami",
  "Guest favourites, plate after plate.": "Hidangan yang paling dicintai tamu kami.",
  "View Full Menu": "Lihat Menu Lengkap",
  Close: "Tutup",

  // ── The page after booking ──
  "Reservation Created": "Reservasi Dibuat",
  "Request Sent": "Permintaan Terkirim",
  "Our staff will contact you shortly, or you can add a more personal touch by tapping the button below to reach us.":
    "Staff kami akan segera menghubungi Anda, atau Anda bisa menambahkan sentuhan lebih personal dengan mengklik tombol di bawah untuk terhubung dengan kami.",
  "This is not a confirmed reservation yet.":
    "Ini belum menjadi reservasi yang terkonfirmasi.",
  "{reason}, so our staff will review it and let you know on WhatsApp. Please do not come in before we confirm.":
    "{reason}, jadi staff kami akan meninjau dan mengabari Anda lewat WhatsApp. Mohon jangan datang sebelum kami konfirmasi.",
  "Your party is larger than the area you chose":
    "Rombongan Anda lebih besar dari kapasitas area yang dipilih",
  "Your party is below the minimum for the area you chose":
    "Rombongan Anda di bawah minimum area yang dipilih",
  "Your party is a large one": "Rombongan Anda cukup besar",
  "We need to review your request": "Permintaan Anda perlu kami tinjau",
  "Status: waiting for staff to confirm": "Status: menunggu konfirmasi staff",
  "We will send the payment details on WhatsApp. Your reservation is held until the deposit arrives.":
    "Kami akan mengirimkan detail pembayaran lewat WhatsApp. Reservasi Anda kami tahan sampai DP diterima.",
  "Chat with us on WhatsApp": "Chat dengan kami di WhatsApp",
  // The large-party handoff. Whole sentences, because a translator cannot
  // reorder "Name" + ":" + value, and Indonesian would not put them in the
  // English order anyway.
  "Parties of more than {n} are arranged with us directly. Tap below and we will help you plan it.":
    "Rombongan di atas {n} orang kami atur langsung. Tekan tombol di bawah, kami bantu rencanakan.",
  "Hello, I would like to arrange a booking for {n} guests.":
    "Halo, saya ingin mengatur reservasi untuk {n} orang.",
  "My name is {name}, for {date} at {time}.":
    "Nama saya {name}, untuk tanggal {date} pukul {time}.",
  "Make another reservation": "Buat reservasi lain",
  "Reservation for {name} on {date} at {time}. Hello, I have something to add to my reservation.":
    "Reservasi atas nama {name} untuk {date} jam {time}. Halo, saya ada catatan tambahan untuk reservasi saya.",

  // ── The reservation confirmation page ──
  "Loading your reservation…": "Memuat reservasi Anda…",
  "We could not find that reservation.": "Reservasi tersebut tidak kami temukan.",
  Guests: "Tamu",
  "{n} person": "{n} orang",
  Location: "Lokasi",
  Occasion: "Acara",
  "Add to Calendar": "Tambahkan ke Kalender",
  "Download as Image": "Unduh sebagai Gambar",
  "Generating…": "Membuat…",
  Guest: "Tamu",
  "Reservation Confirmed": "Reservasi Terkonfirmasi",
  "Reservation not found": "Reservasi tidak ditemukan",
  "This link may be invalid or expired.":
    "Tautan ini mungkin tidak valid atau sudah kedaluwarsa.",
  "Welcome, {name}!": "Selamat datang, {name}!",
  "{date} at {time}": "{date} pukul {time}",
  "Note from our team": "Catatan dari kami",
  "e.g. Ibu Ima": "mis. Ibu Ima",

  // ── The spin wheel ──
  "Your Name": "Nama Anda",
  Continue: "Lanjutkan",
  "Spin!": "Putar!",
  "This voucher is valid for 30 days": "Voucher ini berlaku selama 30 hari",
  "Thank you for your review! 🎉": "Terima kasih atas ulasan Anda! 🎉",
  "Spin & Win": "Putar & Menang",
  "Leave a Google review and redeem your prize on your next visit!":
    "Tambahkan Google review dan redeem prize di kunjungan selanjutnya!",
  "Full name": "Nama lengkap",
  "You're in!": "Kamu ikut!",
  "Spin the wheel to reveal your prize": "Putar rodanya untuk melihat hadiahmu",
  Congratulations: "Selamat",
  "Reference Code": "Kode Referensi",
  "You can screenshot this too!": "Kamu bisa screenshot ini juga loh!",
  "How to redeem": "Cara menukarkan",
  "Show the downloaded voucher to our team on your next visit!":
    "Tunjukkan voucher yang telah didownload kepada tim kami di kunjungan kamu selanjutnya!",
  "Download Voucher": "Unduh Voucher",
  "Please wait…": "Mohon tunggu…",
  "Please enter your name.": "Mohon isi nama Anda.",
  "No prizes are available right now.": "Belum ada hadiah yang tersedia saat ini.",
  "Something went wrong. Please try again.":
    "Terjadi kesalahan. Mohon coba lagi.",
};

// The language in force right now. Starts at the Indonesian default so a page
// that never calls initGuestLanguage() behaves the way it did before this
// file existed.
let GUEST_LANG = "id";

function gt(str) {
  if (!str) return str;
  if (GUEST_LANG === "en") return str;
  if (GUEST_KEEP_ENGLISH.has(str)) return str;
  return Object.prototype.hasOwnProperty.call(GUEST_DICT, str) ? GUEST_DICT[str] : str;
}

// gt() with the numbers put back afterwards. Translating first and filling in
// second is the whole point: "{n} people" is one dictionary key, while
// n + " people" would be three fragments that match nothing.
function gtf(str, values) {
  let out = gt(str);
  for (const k of Object.keys(values || {}))
    out = out.split("{" + k + "}").join(String(values[k]));
  return out;
}

// Which language to show, in priority order:
//   1. what this guest chose on this device, if they chose anything
//   2. "auto" in Settings, meaning follow the phone
//   3. what the restaurant set
// A stored choice outranks the setting on purpose. A guest who tapped EN and
// comes back to a form in Indonesian would reasonably think the switch is
// broken.
function resolveGuestLang(setting, stored, deviceLang) {
  if (GUEST_LANGS.includes(stored)) return stored;
  const want = String(setting || "id").toLowerCase();
  if (want === "auto")
    return String(deviceLang || "").toLowerCase().startsWith("id") ? "id" : "en";
  return GUEST_LANGS.includes(want) ? want : "id";
}

function storedGuestLang() {
  try {
    return localStorage.getItem(GUEST_LANG_KEY);
  } catch (_) {
    // Private mode, or storage blocked entirely. The switch still works for
    // this visit; it just will not be remembered.
    return null;
  }
}

// Caches the English original the first time it sees an element, so switching
// back to EN restores exactly what was authored rather than a translation of a
// translation.
// Markup wraps: a sentence in the HTML is indented and split over three lines,
// and its textContent carries every one of those newlines and every space of
// indentation. Keys in the dictionary are single-line sentences, so without
// collapsing the whitespace first NOTHING multi-line would ever match, and it
// would fail the way translation always fails — silently, in English, on the
// longest sentences on the page.
const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

function translateGuestDOM(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.dataset.i18nEn === undefined) el.dataset.i18nEn = oneLine(el.textContent);
    el.textContent = gt(el.dataset.i18nEn);
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    if (el.dataset.i18nPhEn === undefined)
      el.dataset.i18nPhEn = el.getAttribute("placeholder") || "";
    el.setAttribute("placeholder", gt(el.dataset.i18nPhEn));
  });
  scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    if (el.dataset.i18nAriaEn === undefined)
      el.dataset.i18nAriaEn = el.getAttribute("aria-label") || "";
    el.setAttribute("aria-label", gt(el.dataset.i18nAriaEn));
  });
}

function updateGuestLangSwitch() {
  document.querySelectorAll("[data-lang-btn]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.langBtn === GUEST_LANG));
  });
}

// Everything a language change has to touch. Pages with content built in
// JavaScript (the hour pills, the area conditions, the confirmation rows)
// define onGuestLanguageChange() to redraw it; static pages define nothing.
function applyGuestLanguage(lang) {
  GUEST_LANG = GUEST_LANGS.includes(lang) ? lang : "id";
  // config.js, on the three pages that load it, keeps its own CURRENT_LANG for
  // t() and the month names. A page showing English labels over Indonesian
  // dates is worse than either language on its own.
  if (typeof CURRENT_LANG !== "undefined") CURRENT_LANG = GUEST_LANG;
  document.documentElement.lang = GUEST_LANG;
  translateGuestDOM();
  updateGuestLangSwitch();
  if (typeof onGuestLanguageChange === "function") onGuestLanguageChange();
}

function setGuestLanguage(lang) {
  try {
    localStorage.setItem(GUEST_LANG_KEY, lang);
  } catch (_) {
    /* not remembered, still applied */
  }
  applyGuestLanguage(lang);
}

// Runs in two beats, and that is deliberate.
//
// The first is synchronous: a stored choice, or the phone's own language, with
// no network in the way. The second reconciles with the restaurant's setting
// when the fetch lands. Waiting for the fetch before showing anything would
// mean a blank page whenever Supabase is slow, and hiding the body until then
// means a blank page whenever it never answers.
//
// The visible cost is that an English-only restaurant can flash Indonesian at
// an Indonesian phone for one paint. The alternative costs a page.
function initGuestLanguageSync() {
  const stored = storedGuestLang();
  let hint = "id"; // what every one of these pages did before this existed
  try {
    hint = localStorage.getItem(GUEST_SETTING_CACHE_KEY) || "id";
  } catch (_) {
    /* no hint, the default stands */
  }
  applyGuestLanguage(
    resolveGuestLang(hint, stored, navigator && navigator.language),
  );
  return stored;
}

function applyGuestLanguageSetting(cfg) {
  const stored = storedGuestLang();
  try {
    localStorage.setItem(GUEST_SETTING_CACHE_KEY, String((cfg && cfg.guest_language) || "id"));
  } catch (_) {
    /* the hint is optional; the setting is not stored here */
  }
  if (GUEST_LANGS.includes(stored)) {
    // The guest has already chosen. Only the switch's own visibility is still
    // the restaurant's call.
    showGuestLangSwitch(cfg);
    return;
  }
  applyGuestLanguage(
    resolveGuestLang(cfg && cfg.guest_language, null, navigator && navigator.language),
  );
  showGuestLangSwitch(cfg);
}

// Hidden only on an explicit false, so a restaurant that has never opened the
// settings screen keeps the switch.
function showGuestLangSwitch(cfg) {
  const el = document.getElementById("lang-switch");
  if (!el) return;
  el.hidden = cfg && cfg.show_lang_switch === false;
}
