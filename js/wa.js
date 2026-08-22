// ============================================================
// WHATSAPP TEMPLATES (wa.me links)
// ------------------------------------------------------------
// Front Desk clicks a button on a walk-in / reservation row (or
// the Broadcast page) and WhatsApp Web opens a chat with the
// guest, message pre-typed. NOTHING is auto-sent: staff always
// reviews and presses send.
//
// v2 (2026-07-18): templates now load from the wa_templates
// table (editable in Broadcast > Kelola Template). If the fetch
// fails for any reason, the hardcoded fallbacks below are used —
// the WA buttons must never hard-break. Every send is logged to
// wa_outreach_log ("clicked" is our best proxy for "sent").
// ============================================================

// Was hardcoded to one restaurant. Now resolved per deployment; see
// restaurantName() in config.
const WA_RESTAURANT_NAME =
  typeof restaurantName === "function" ? restaurantName() : "Restoran";

// ── Hardcoded fallbacks (also the "Kembalikan ke default" source) ──
// NO EMOJI, by decision (2026-07-17): the FD PC's browser/WhatsApp
// handoff corrupts emoji into "?" no matter the encoding.
//
// {link} IN BROADCAST BODIES (2026-08-01): every is_broadcast template
// ends with {link} on its own line. wa.me cannot attach an image, so a
// promo picture only reaches the guest as a WhatsApp preview card drawn
// from a URL in the message — no {link} in the body means no image, no
// matter what ops uploaded in the app. Three real campaigns went out
// without it before this was fixed, because the templates shipped
// without the placeholder and nothing at send time noticed.
//
// The link resolves to /promo/<slug>, which always exists (the slug is
// generated with the campaign), so it is safe even with no promo image:
// the page falls back to the house og: image and forwards the guest to
// the reservation form carrying ?from=<slug> for attribution.
//
// Transactional templates (thank_you, follow_up, voucher_ready) stay
// clean — they belong to no campaign and have no promo page.
const WA_DEFAULT_TEMPLATES = {
  thank_you: {
    label: "Thank You (setelah kunjungan)",
    is_broadcast: false,
    body:
      "Terima kasih atas kunjungan bapak/ibu di resto {resto} hari ini. " +
      "Kami nantikan kedatangannya kembali di lain waktu!",
  },
  follow_up: {
    label: "Follow Up (konfirmasi reservasi)",
    is_broadcast: false,
    body:
      "Halo {nama}!\n\n" +
      "Kami dari {resto} ingin mengonfirmasi reservasi Bapak/Ibu:\n\n" +
      "Tanggal: {tanggal}\nJam: {jam}\nJumlah: {pax} orang\n\n" +
      "Kami nantikan kehadiran dari anda di {resto}. Terima kasih!",
  },
  at_risk: {
    label: "Broadcast: At Risk (lama tidak berkunjung)",
    is_broadcast: true,
    body:
      "Halo {nama}! Sudah lama kami tidak melihat Bapak/Ibu di {resto} — " +
      "kami rindu! Kami tunggu kedatangannya kembali ya. Terima kasih!\n\n" +
      "{link}",
  },
  medium_spender: {
    label: "Broadcast: Medium Spender",
    is_broadcast: true,
    body:
      "Halo {nama}! Terima kasih sudah menjadi pelanggan setia {resto}. " +
      "Kami tunggu kunjungan berikutnya ya!\n\n" +
      "{link}",
  },
  high_spender: {
    label: "Broadcast: High Spender",
    is_broadcast: true,
    body:
      "Halo {nama}! Terima kasih sudah menjadi pelanggan istimewa {resto}. " +
      "Suatu kehormatan bagi kami untuk selalu melayani Bapak/Ibu. " +
      "Sampai jumpa di kunjungan berikutnya!\n\n" +
      "{link}",
  },
  // Added 2026-07-26 for the dashboard's "first-timers who haven't come
  // back" segment. Deliberately does NOT say "sudah lama tidak berkunjung"
  // like at_risk does — this audience may have eaten here last week, and
  // telling a recent guest we miss them reads as a careless mass mail.
  // Leads with their actual visit date so it cannot feel like a blast.
  first_timer: {
    label: "Broadcast: Tamu Baru (belum kembali)",
    is_broadcast: true,
    body:
      "Halo {nama}! Terima kasih sudah berkunjung ke {resto} pada " +
      "{tanggal_terakhir}. Senang sekali bisa melayani Bapak/Ibu, " +
      "dan kami harap masakan kami berkesan. " +
      "Kami tunggu kunjungan berikutnya ya!\n\n" +
      "{link}",
  },
  acquisition: {
    label: "Broadcast: Akuisisi",
    is_broadcast: true,
    body:
      "Halo {nama}! Terima kasih sudah pertama kali berkunjung ke {resto} pada " +
      "{tanggal_terakhir}. Senang sekali bisa menyambut Bapak/Ibu, " +
      "kami tunggu kunjungan berikutnya ya!\n\n" +
      "{link}",
  },
  returning: {
    label: "Broadcast: Tamu yang kembali",
    is_broadcast: true,
    body:
      "Halo {nama}! Terima kasih sudah kembali berkunjung ke {resto}. " +
      "Kami sangat menghargai kepercayaannya dan senang bisa melayani Bapak/Ibu lagi. " +
      "Sampai jumpa di kunjungan berikutnya!\n\n" +
      "{link}",
  },
  // Added 2026-07-31 for the voucher card. TRANSACTIONAL, not a broadcast:
  // the guest earned this voucher, so it is immune to do_not_contact and
  // never counts towards the 5-day resend warning. The image itself is
  // attached BY HAND in WhatsApp — wa.me cannot carry an attachment.
  voucher_ready: {
    label: "Voucher (kirim ke member)",
    is_broadcast: false,
    body:
      "Halo {nama}!\n\n" +
      "Selamat, Bapak/Ibu mendapatkan voucher belanja {nominal} dari {resto} " +
      "sebagai apresiasi atas kunjungan yang selalu setia.\n\n" +
      "Kode voucher: {kode}\n" +
      "Berlaku sampai: {berlaku}\n\n" +
      "Cukup tunjukkan voucher ini kepada staf kami saat pembayaran. " +
      "Kami tunggu kunjungan berikutnya!",
  },
  tag_default: {
    label: "Broadcast: Template Dasar Tag",
    is_broadcast: true,
    body:
      "Halo {nama}! Ada info spesial dari {resto} untuk Bapak/Ibu. " +
      "[ganti dengan isi promo]\n\n" +
      "{link}",
  },
};

// ── Template cache ───────────────────────────────────────────
// Loaded once per session (or force-refreshed when the Broadcast
// page opens / a template is saved). null = fetch failed → the
// message builders silently fall back to WA_DEFAULT_TEMPLATES.
let waTemplatesCache = null;

async function waLoadTemplates(force = false) {
  if (waTemplatesCache && !force) return waTemplatesCache;
  try {
    const { data, error } = await db
      .from("wa_templates")
      .select("key, label, body, is_broadcast, updated_at, updated_by");
    if (error || !data || !data.length) throw error || new Error("empty");
    waTemplatesCache = {};
    data.forEach((t) => (waTemplatesCache[t.key] = t));
  } catch (e) {
    console.warn("wa_templates fetch failed, using hardcoded fallbacks", e);
    waTemplatesCache = null;
  }
  return waTemplatesCache;
}

function waTemplateBody(key) {
  return (
    waTemplatesCache?.[key]?.body || WA_DEFAULT_TEMPLATES[key]?.body || ""
  );
}

// ── Placeholder rendering ────────────────────────────────────
// Unknown {placeholders} are left as-is (the editor blocks saving
// them, so this only happens on hand-broken data — visible beats
// silently wrong).
function waRenderTemplate(body, ctx) {
  return String(body || "").replace(/\{(\w+)\}/g, (m, key) =>
    ctx[key] !== undefined && ctx[key] !== null && ctx[key] !== ""
      ? String(ctx[key])
      : m === "{resto}"
        ? WA_RESTAURANT_NAME
        : m,
  );
}

function waFormatDateId(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Phone conversion ─────────────────────────────────────────
// DB stores phones in local format ("08xx", via normalizePhone).
// wa.me needs international digits with no "+" ("628xx").
function waPhone(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let intl;
  if (trimmed.startsWith("+")) {
    // Foreign number stored with country code (+65, +1, ...) — keep as-is
    intl = digits;
  } else if (digits.startsWith("0")) {
    intl = "62" + digits.slice(1); // 0812… → 62812…
  } else if (digits.startsWith("62")) {
    intl = digits; // already international
  } else if (digits.startsWith("8")) {
    intl = "62" + digits; // local number missing the leading 0
  } else {
    intl = digits;
  }

  // WhatsApp numbers are 10–15 digits; anything else is a typo or
  // a landline fragment — better to block than open a dead chat.
  if (intl.length < 10 || intl.length > 15) return null;

  // Indonesian numbers must be MOBILE (628xx). Landlines (6221xx etc.)
  // have no WhatsApp — opening the chat would just dead-end for staff.
  if (intl.startsWith("62") && !intl.startsWith("628")) return null;

  return intl;
}

// Staff habit: cramming extras into the name field, e.g.
// "Jonathan Sihombing 13 Jul 26 (loyal customer)". The DB keeps
// whatever staff typed, but the guest should never see it in a
// WhatsApp greeting — strip parentheticals and trailing dates.
function waCleanGuestName(raw) {
  let name = (raw || "").trim();

  // "(loyal customer)", "(VIP)", ... anywhere in the name
  name = name.replace(/\s*\([^)]*\)/g, "");

  // Trailing dates, Indonesian or English month names, short or long:
  // "13 Jul 26", "13 Juli 2026", "1 Agustus 26", "17 Jul", "22 Des’24"
  //
  // Front Desk writes the visit date into the guest name and has said
  // they are not changing that habit, so this has to absorb whatever
  // they type. Checked against all 457 real prod names (2026-08-01):
  // 305 carry a date, all 305 strip clean, and no date-free name is
  // touched.
  //
  // AGUSTUS IS SPELLED FOUR WAYS in the real data — "Agu", "Agus",
  // "Agust", "Agustus" — plus "Agt". `agu(?:st?(?:us)?)?` covers the
  // first four; "agt" is listed separately.
  //
  // THE YEAR IS OPTIONAL because staff drop it ("Bpk Troy 17 Jul").
  // That is safe only because a digit day is still required in front:
  // Juni, Mei and Desi are ordinary Indonesian names, and without the
  // leading number this rule would eat them.
  const MONTHS =
    "jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|may|jun(?:i|e)?|" +
    "jul(?:i|y)?|agu(?:st?(?:us)?)?|agt|aug(?:ust)?|sep(?:t(?:ember)?)?|" +
    "okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|des(?:ember)?|dec(?:ember)?";
  name = name.replace(
    new RegExp(
      // day        month          optional ’24 / '24 / 24 / 2024
      "\\s*\\b\\d{1,2}\\s*(" + MONTHS + ")(?:\\s*['’]?\\s*\\d{2,4})?\\b\\s*$",
      "i",
    ),
    "",
  );

  // Trailing numeric dates: "13/7/26", "13-07-2026", "13/07"
  name = name.replace(/\s*\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b\s*$/, "");

  return waStripHonorific(name).replace(/\s{2,}/g, " ").trim();
}

// ── Leading honorific only (2026-08-09) ───────────────────────
// SEPARATE FROM waCleanGuestName ON PURPOSE. Rere's rule for the
// staff-facing screens: remove the title, touch NOTHING after the
// name. The visit date and the "( Kalbe )" / "( Mas Arya )" notes
// staff cram in there are how they tell four different Sintas
// apart at the door — hiding those is how the July wrong-guest
// incident happens again.
//
// So: app.js renders waStripHonorific("Ibu Hesti 8 Agust 26")
// → "Hesti 8 Agust 26", while WhatsApp uses the full
// waCleanGuestName → "Hesti", because the guest should never read
// their own visit date back in a greeting.
//
// Counted in prod 2026-08-09 — 77 of 520 names carry a title:
// ibu 40, bapak 10, bpk 8, dr 3, "dr." 3, bp 3, dokter 2,
// "bp." 2, and one each of pak / kak / mas / "mr." / "mr." with
// no space / "mrs.".
//
// ORDER MATTERS, alternation is first-match-wins: longer forms
// must come first or "bp" swallows "bpk" and "ib" swallows "ibu".
//
// THE GUARD IS [\s.] AND IT IS NOT OPTIONAL. It is the only thing
// stopping "Bu" from eating "Budi", "Mas" from "Masayu", "Ib"
// from "Ibrahim". Delete it and real guests get silently renamed
// with nothing in the UI to show it happened.
const WA_STRIPPABLE_TITLES =
  "bapak|bpk|bp|pak|ibu|ib|bunda|bu|mbak|mba|mb|mas|kakak|kak|mrs|mr|ms";

function waStripHonorific(raw) {
  let name = (raw || "").trim();

  // Only the LEADING one is removed. "Bp Rosi Bu Dina" is two people
  // crammed into one field — removing the second "Bu" would be
  // guessing which words belong to whom. Those rows get fixed by hand.
  const stripped = name.replace(
    new RegExp(`^(?:${WA_STRIPPABLE_TITLES})[\\s.]+`, "i"),
    "",
  );
  // If the title WAS the entire name, keep what staff typed. One real
  // prod guest is recorded as literally "Dr" — blanking that row would
  // lose the only identifier it has.
  if (stripped) name = stripped;

  // Doctors are the exception: the title is KEPT, not stripped, because
  // Indonesians read "dr." as part of the name. "Dokter Asa", "Dr Erryl"
  // and "dr. Suma" all normalise to "dr. X". The (?=\S) lookahead means
  // a bare "Dr" is left alone rather than turned into a dangling "dr. ".
  name = name.replace(/^(?:dokter|dok|dr)[\s.]+(?=\S)/i, "dr. ");

  return name.replace(/\s{2,}/g, " ").trim();
}

// "Ibu Meita" should not become "Bapak/Ibu Ibu Meita", and an empty
// name should fall back to plain "Bapak/Ibu".
//
// The list below is taken from what Front Desk actually types, counted
// across real prod names (2026-08-01): ibu 32, bpk 7, bapak 7, bp 3,
// dr 3, and one each of bp. / kak / mr. / mrs. / mas / pak. "Bpk" and
// "Bp." were missing, so eleven real guests were being greeted "Halo
// Bapak/Ibu Bpk Troy" — the exact stiffness this function exists to
// prevent.
//
// ORDER MATTERS: JS alternation is first-match-wins, so longer forms
// come before the prefixes they contain. "bu" before "bunda" would
// stop "Bunda Sari" from matching.
const WA_HONORIFICS =
  "bapak|bpk|bp|pak|ibu|bunda|bu|mbak|mas|mrs|mr|ms|drs|dr|prof|ir|kak|om|tante|hj";

function waGreetName(guestName) {
  const name = waCleanGuestName(guestName);
  if (!name) return "Bapak/Ibu";
  // The trailing [\s./] is what keeps this safe: "Bu" matches "Bu Ani"
  // and "Bu. Ani" but not "Budi". The "/" is there so an existing
  // "Bapak/Ibu X" is recognised and not doubled up.
  if (new RegExp(`^(${WA_HONORIFICS})([\\s./]|$)`, "i").test(name)) return name;
  return `Bapak/Ibu ${name}`;
}

// ── Message builders ─────────────────────────────────────────
function waThankYouMessage(guestName) {
  return waRenderTemplate(waTemplateBody("thank_you"), {
    nama: waGreetName(guestName),
    resto: WA_RESTAURANT_NAME,
  });
}

function waFollowUpMessage(guestName, resDate, resTime, pax) {
  return waRenderTemplate(waTemplateBody("follow_up"), {
    nama: waGreetName(guestName),
    resto: WA_RESTAURANT_NAME,
    tanggal: waFormatDateId(resDate),
    jam: resTime ? resTime.slice(0, 5).replace(":", ".") : "-",
    pax: pax || "-",
  });
}

// ── Send log ─────────────────────────────────────────────────
// Fire-and-forget: a logging hiccup must never block the actual
// WhatsApp handoff. "Clicked" is our best proxy for "sent".
//
// `extra` (2026-08-01) carries campaign_id + message_body for
// broadcasts. message_body is the RENDERED text this guest received,
// not the template — templates get edited, and a report that cannot
// say what was actually sent is not a report.
async function waLogSend(guestId, templateKey, isBroadcast, extra = {}) {
  if (!guestId) return;
  try {
    await db.from("wa_outreach_log").insert({
      guest_id: guestId,
      template_key: templateKey,
      is_broadcast: !!isBroadcast,
      campaign_id: extra.campaign_id || null,
      message_body: extra.message_body || null,
      // Which draft of the campaign's wording this guest received. The
      // results card groups by it, so a campaign edited mid-flight can
      // still be read honestly.
      message_version: extra.message_version || null,
      sent_by:
        getStaffSession()?.display_name || getStaffSession()?.username || null,
    });
  } catch (e) {
    console.warn("wa_outreach_log insert failed (send not blocked)", e);
  }
}

// ── Open chat ────────────────────────────────────────────────
// Returns true if a chat window was actually opened (callers use
// this to decide whether to log the send).
function waOpenChat(rawPhone, message) {
  const phone = waPhone(rawPhone);
  if (!phone) {
    toast(
      "Nomor telepon guest tidak valid / kosong — cek profil guest dulu ya",
      "error",
    );
    return false;
  }
  window.open(
    `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    "_blank",
    "noopener",
  );
  return true;
}

// ── Click handlers (fetch fresh, never trust a stale row) ────
async function waSendThankYouVisit(visitId) {
  await waLoadTemplates();
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("id, guest_id, guests(name, phone)")
        .eq("id", visitId)
        .single(),
    "Gagal memuat data walk-in",
  );
  if (error || !data) return;
  if (waOpenChat(data.guests?.phone, waThankYouMessage(data.guests?.name)))
    waLogSend(data.guest_id, "thank_you", false);
}

async function waSendThankYouReservation(resId) {
  await waLoadTemplates();
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("id, guest_id, guests(name, phone)")
        .eq("id", resId)
        .single(),
    "Gagal memuat data reservasi",
  );
  if (error || !data) return;
  if (waOpenChat(data.guests?.phone, waThankYouMessage(data.guests?.name)))
    waLogSend(data.guest_id, "thank_you", false);
}

async function waSendFollowUpReservation(resId) {
  await waLoadTemplates();
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select(
          "id, guest_id, reservation_date, reservation_time, pax, status, guests(name, phone)",
        )
        .eq("id", resId)
        .single(),
    "Gagal memuat data reservasi",
  );
  if (error || !data) return;
  // Guard: reservation may have been cancelled/completed since render
  if (data.status !== "Reserved") {
    toast(
      `Reservasi ini statusnya sudah "${data.status}" — follow up tidak dikirim`,
      "error",
    );
    return;
  }
  const opened = waOpenChat(
    data.guests?.phone,
    waFollowUpMessage(
      data.guests?.name,
      data.reservation_date,
      data.reservation_time,
      data.pax,
    ),
  );
  if (opened) waLogSend(data.guest_id, "follow_up", false);
}

// ── Button HTML helpers (used by app.js renderers) ───────────
const WA_BTN_CLASS = "text-xs text-[#1FAF5E] hover:underline whitespace-nowrap";

function waThankYouVisitBtn(visit) {
  const isCompleted = visit.status === "Done" || !!visit.completed_at;
  if (!isCompleted || !visit.guests?.phone) return "";
  return `<button onclick="waSendThankYouVisit('${visit.id}')" class="${WA_BTN_CLASS}">WA Thanks</button>`;
}

function waReservationBtns(res) {
  if (!res.guests?.phone) return "";
  if (res.status === "Reserved") {
    return `<button onclick="waSendFollowUpReservation('${res.id}')" class="${WA_BTN_CLASS}">WA Follow Up</button>`;
  }
  if (res.status === "Completed") {
    return `<button onclick="waSendThankYouReservation('${res.id}')" class="${WA_BTN_CLASS}">WA Thanks</button>`;
  }
  return "";
}
