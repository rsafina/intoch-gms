// ============================================================
// INTOCH — DOM-mutation i18n translator
// ============================================================
// Ports the approach proven in gms-proto/js/i18n.js: the app is authored
// in English (plus a handful of spots that already hardcode Indonesian
// via CURRENT_LANG checks in app.js/membership.js). When CURRENT_LANG is
// "id", this file walks the rendered DOM and swaps known English phrases
// for Indonesian using ID_DICT (exact match, from config.js) plus the
// ID_DICT_PATTERNS regex list below (for strings with embedded counts,
// dates, or names). A MutationObserver re-runs the walk whenever new
// content is rendered (modals, toasts, dynamically built tables/lists),
// so call sites don't need to be individually wired to t().
//
// Reuses (does not redefine) from js/config.js: ID_DICT,
// I18N_EXCEPTION_TERMS, CURRENT_LANG, LANG_STORAGE_KEY, t(),
// updateLangToggleUI(), translateStaticDOM(), initI18nCache().
// Must load AFTER js/config.js.
// ============================================================

// Dynamic strings with counts/dates/names embedded — verified against
// actual template literals in js/app.js and js/membership.js as of
// 2026-07-17. Strings already gated by `CURRENT_LANG === "id"` checks in
// app.js (e.g. the dashboard walk-in count label, the VIP conflict toast)
// are hardcoded Indonesian at the source and need no pattern here.
const ID_DICT_PATTERNS = [
  // Walk-in Insight section descriptions — amounts are dynamic since the
  // spending-tier thresholds became configurable (Settings, 2026-07-21).
  // The exact-match ID_DICT entries still cover the static HTML defaults.
  [
    /^Groups spending more than Rp ([\d.,]+) per guest$/,
    "Grup dengan belanja lebih dari Rp $1 per tamu",
  ],
  [
    /^Groups with total spend of Rp ([\d.,]+) or more$/,
    "Grup dengan total belanja Rp $1 atau lebih",
  ],

  // Dashboard "Upcoming Reservations" date tab headers (app.js ~1284-1286)
  [/^Today \((\d+)\), (.+)$/, "Hari Ini ($1), $2"],
  [/^Tomorrow \((\d+)\), (.+)$/, "Besok ($1), $2"],
  [/^\+2 Days \((\d+)\), (.+)$/, "+2 Hari ($1), $2"],

  // Dashboard reservations list date sub-header (app.js ~1317)
  [/^Showing reservations for (.+)$/, "Menampilkan reservasi untuk $1"],

  // Reservation status toast (app.js ~4498)
  [/^Status updated to (.+)$/, "Status diperbarui menjadi $1"],

  // Ops report pax counters (app.js ~6471, ~6480)
  [/^(\d+) pax expected$/, "$1 pax diperkirakan datang"],
  [/^(\d+) pax released$/, "$1 pax dibatalkan"],

  // Ops report cancellation counter (app.js ~6507)
  [/^(\d+) cancellations?$/, "$1 pembatalan"],

  // Admin dashboard — cancellation share of bookings
  [/^(\d+)% of bookings$/, "$1% dari pemesanan"],

  // Peak traffic busiest-day line, "12 Jul 2026 · 14 total guests"
  [/^(.+) · (\d+) total guests$/, "$1 · $2 total tamu"],

  // Admin dashboard top-guest rows: "Rp 1.4jt · 9 visits" / "9 visits · Rp 1.4jt"
  [/^(.+) · (\d+) visits?$/, "$1 · $2 kunjungan"],
  [/^(\d+) visits? · (.+)$/, "$1 kunjungan · $2"],

  // Birthday widget relative-day labels (app.js ~7106, ~7400)
  [/^in (\d+) days$/, "$1 hari lagi"],
  [/^in (\d+)d$/, "$1 hari"],

  // Birthday alert badge (app.js ~7154)
  [/^(\d+) in next 7 days$/, "$1 dalam 7 hari ke depan"],

  // Prize/spin search results counter (app.js ~7243-7244)
  [/^(\d+) results? for "(.*)"$/, 'Hasil: $1 untuk "$2"'],
  [/^No results for "(.*)"$/, 'Tidak ada hasil untuk "$1"'],

  // Prize pending redemptions counter (app.js ~7249)
  [/^(\d+) pending redemptions?$/, "$1 pending klaim"],

  // Birthday month header (app.js ~7338)
  [/^Guests celebrating a birthday in (.+)$/, "Tamu yang berulang tahun pada $1"],

  // Quick walk-in toast (app.js ~8187)
  [/^Walk-in added: (.+)$/, "Tamu walk-in ditambahkan: $1"],

  // Members table — linked guest sub-label (membership.js ~153)
  [/^Guest: (.+)$/, "Tamu: $1"],

  // Members table — available vouchers pill (membership.js ~159)
  [/^(\d+) vouchers? available$/, "$1 voucher tersedia"],

  // Add Member modal — existing-guest link hints (membership.js ~198, ~281)
  [/^✓ Linked to existing guest: (.+)$/, "✓ Ditautkan ke tamu yang sudah ada: $1"],
  [/^Will be linked to existing guest: (.+)$/, "Akan ditautkan ke tamu yang sudah ada: $1"],

  // Add Member modal — validation errors (membership.js ~308, ~318)
  [/^Member number (.+) already exists\.$/, "Nomor anggota $1 sudah ada."],
  [/^This phone already belongs to member (.+)\.$/, "Nomor telepon ini sudah terdaftar atas anggota $1."],

  // Member created toast (membership.js ~394)
  [/^Member (.+) created$/, "Anggota $1 dibuat"],

  // Voucher redeemed-at label (membership.js ~481)
  [/^redeemed (.+)$/, "diklaim $1"],

  // Membership txn modal hint (membership.js ~501)
  [/^Earns a sticker if ≥ (.+)$/, "Dapat sticker jika ≥ $1"],

  // Areas overview card — capacity/reserved labels and occupancy line
  // (app.js renderAreaCards ~1173-1179)
  [/^Capacity: (.+)$/, "Kapasitas: $1"],
  [/^Reserved: (\d+)$/, "Dipesan: $1"],
  [/^(\d+) seats remaining · (\d+)% occupied$/, "$1 kursi tersisa · $2% terisi"],

  // Table Configuration — table count per area (app.js ~957)
  [/^(\d+) tables?$/, "$1 meja"],

  // Reports — Marketing headline sub-label, "in <date or date range>"
  // (app.js loadReports ~6822). Anchored on a leading day-number so it
  // doesn't collide with unrelated "in ..." phrases elsewhere.
  [/^in (\d{1,2} .+)$/, "pada $1"],

  // Reports — Spending Insights pager, "N–M of X" (app.js renderSpendPage ~5847)
  [/^(\d+)–(\d+) of (\d+)$/, "$1–$2 dari $3"],

  // Reports — Operations "In Period" reservation/walk-in counts (app.js ~6526-6530)
  [/^(\d+) reservations?$/, "$1 reservasi"],
  [/^(\d+) walk-ins?$/, "$1 tanpa reservasi"],

  // Reports — At-Risk High Spender days remaining (app.js ~7040)
  [/^(\d+) days$/, "$1 hari"],

  // Invoice Generator (invoice.js, 2026-07-31) — strings carrying a
  // rupiah figure, a count or an item name. The two tax-base variants
  // are separate entries because the base itself differs, and getting
  // that sentence wrong would misdescribe what a guest is charged.
  [
    /^Tax is calculated on Sub Total \+ Service Charge \((.+)\)\.$/,
    "Pajak dihitung dari Sub Total + Service Charge ($1).",
  ],
  [
    /^Tax is calculated on Sub Total \((.+)\)\.$/,
    "Pajak dihitung dari Sub Total ($1).",
  ],
  [
    /^"(.+)" is too long for the Items column and will be cut off\. Shorten it to (\d+) characters\.$/,
    '"$1" terlalu panjang untuk kolom Items dan akan terpotong. Persingkat jadi maksimal $2 karakter.',
  ],
  [
    /^(\d+) item names are too long for the Items column and will be cut off\. Keep each under (\d+) characters\.$/,
    "$1 nama item terlalu panjang untuk kolom Items dan akan terpotong. Jaga tiap nama di bawah $2 karakter.",
  ],
  [
    /^Too many items for one page \((\d+)\)\. Keep it to (\d+) or combine lines\.$/,
    "Item terlalu banyak untuk satu halaman ($1). Batasi maksimal $2 atau gabungkan barisnya.",
  ],
  [
    /^Receipt no (.+) was already used recently\.$/,
    "Receipt no $1 baru saja dipakai.",
  ],

  // Vouchers (vouchers.js, 2026-08-01). Voucher codes are never
  // translated — they are printed on the card the guest holds.
  [/^Voucher (VCH-\d+) issued\.$/, "Voucher $1 diterbitkan."],
  [/^(\d+) vouchers issued\.$/, "$1 voucher diterbitkan."],
  [/^Issue (\d+) vouchers$/, "Terbitkan $1 voucher"],
  [/^Redeemed (VCH-\d+)\.$/, "$1 berhasil ditukar."],
  [/^(VCH-\d+) cancelled\.$/, "$1 dibatalkan."],
  [
    /^(\d+) vouchers, each with its own code\. Leave the recipient empty for bearer vouchers a partner hands out\.$/,
    "$1 voucher, masing-masing dengan kodenya sendiri. Kosongkan penerima untuk voucher atas nama pembawa yang dibagikan partner.",
  ],
  // Order matters here: i18nTranslate takes the FIRST pattern that
  // matches, and the short "no voucher" regex would also swallow the
  // longer membership-hint sentence, throwing the hint away.
  [
    /^Nothing found for "(.+?)"\. That looks like a membership voucher code — check it on the Membership page\.$/,
    'Tidak ada hasil untuk "$1". Itu sepertinya kode voucher membership, coba cek di halaman Keanggotaan.',
  ],
  [/^Nothing found for "(.+?)"\.$/, 'Tidak ada hasil untuk "$1".'],
  [
    /^(\d+) vouchers found\. Pick the right one\.$/,
    "Ketemu $1 voucher. Pilih yang benar.",
  ],
  [/^← Back to the (\d+) results$/, "← Kembali ke $1 hasil"],
  [/^Already redeemed on (.+)\. Nothing further to do\.$/, "Sudah ditukar pada $1. Tidak ada yang perlu dilakukan lagi."],
  [/^This voucher was cancelled: (.+)\.$/, "Voucher ini dibatalkan: $1."],
  [
    /^Expired on (.+)\. Honouring it anyway is a service decision, and it will be recorded under your name\.$/,
    "Kadaluarsa pada $1. Tetap melayaninya adalah keputusan servis, dan akan tercatat atas nama Anda.",
  ],
  [
    /^Minimum spend (Rp [\d.]+)\. Check the bill before redeeming\.$/,
    "Minimum transaksi $1. Cek dulu bill-nya sebelum ditukarkan.",
  ],
  [/^Minimum spend (Rp [\d.]+)$/, "Minimum transaksi $1"],
  [/^Maximum discount (Rp [\d.]+)$/, "Potongan maksimal $1"],
  [/^Issued (\d+) · (.+)$/, "Terbit $1 · $2"],
  [/^Redeemed (\d+) · (.+)$/, "Ditukar $1 · $2"],
  [/^Outstanding (\d+) · (.+)$/, "Beredar $1 · $2"],
  [/^Expired (\d+)$/, "Kadaluarsa $1"],
  [/^Cancelled (\d+)$/, "Dibatalkan $1"],
  [/^Linked to (.+)$/, "Ditautkan ke $1"],
  [/^Active \((\d+)\)$/, "Aktif ($1)"],
  [/^Redeemed \((\d+)\)$/, "Ditukar ($1)"],
  [/^Expired \((\d+)\)$/, "Kadaluarsa ($1)"],
  [/^Cancelled \((\d+)\)$/, "Dibatalkan ($1)"],
  [/^All \((\d+)\)$/, "Semua ($1)"],

  // Reports — Birthday report empty state (app.js ~7530)
  [
    /^No birthdays found for (.+)\. Guests with birthdays in this month will appear here\.$/,
    "Tidak ada ulang tahun untuk $1. Tamu dengan ulang tahun bulan ini akan muncul di sini.",
  ],

  // Reservations guest search — result count in the active-search banner
  // (app.js renderResSearchChip). The 0 and 1 cases are exact-match
  // entries in ID_DICT; this covers 2+.
  [/^(\d+) reservations found$/, "$1 reservasi ditemukan"],
];

function i18nTranslate(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // HTML source wraps long sentences across indented lines, so a text
  // node can contain newlines + runs of spaces. Normalize whitespace to a
  // single space before matching so dictionary keys can use plain spaces.
  const normalized = trimmed.replace(/\s+/g, " ");
  if (I18N_EXCEPTION_TERMS.has(normalized)) return null;
  const exact = Object.prototype.hasOwnProperty.call(ID_DICT, normalized)
    ? ID_DICT[normalized]
    : undefined;
  if (exact !== undefined) return text.replace(trimmed, exact);
  for (const [re, replacement] of ID_DICT_PATTERNS) {
    if (re.test(normalized))
      return text.replace(trimmed, normalized.replace(re, replacement));
  }
  return null;
}

let i18nBusy = false;

function i18nTranslateTree(root) {
  if (CURRENT_LANG !== "id" || !root) return;
  i18nBusy = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        if (tag === "SCRIPT" || tag === "STYLE")
          return NodeFilter.FILTER_REJECT;
        // data-i18n-skip marks specific elements (e.g. the Dashboard/
        // Membership/Reservations/Walk-Ins nav labels and matching page
        // titles) that must stay English even though the identical word
        // elsewhere on the page should translate — see js/config.js.
        if (node.parentElement?.closest("[data-i18n-skip]"))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const translated = i18nTranslate(n.nodeValue || "");
      if (translated !== null) n.nodeValue = translated;
    });

    // Attributes that show text to the user
    const attrRoot = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    attrRoot
      .querySelectorAll("[placeholder], [title], [aria-label]")
      .forEach((el) => {
        if (el.closest("[data-i18n-skip]")) return;
        ["placeholder", "title", "aria-label"].forEach((attr) => {
          const v = el.getAttribute(attr);
          if (!v) return;
          const translated = i18nTranslate(v);
          if (translated !== null) el.setAttribute(attr, translated);
        });
      });
  } finally {
    i18nBusy = false;
  }
}

// setLanguage() persists the choice and reloads — reload restores a clean
// English DOM before re-translating, avoiding partial-translation bugs
// from swapping text mid-session. Language switching is an infrequent
// settings action, not a hot path, so the reload cost is acceptable.
function setLanguage(lang) {
  const normalized = lang === "en" ? "en" : "id";
  localStorage.setItem(LANG_STORAGE_KEY, normalized);
  location.reload();
}

// Keep dynamically rendered content translated (modals, lists, toasts,
// tables rebuilt via innerHTML) without wiring every render call site.
function i18nInit() {
  document.documentElement.lang = CURRENT_LANG;
  if (typeof updateLangToggleUI === "function") updateLangToggleUI();

  if (CURRENT_LANG !== "id") return; // HTML is already authored in English

  const run = () => i18nTranslateTree(document.body);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  let pending = false;
  const observer = new MutationObserver(() => {
    if (i18nBusy || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      i18nTranslateTree(document.body);
    });
  });
  const startObserver = () =>
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver);
}

i18nInit();
