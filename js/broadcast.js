// ============================================================
// BROADCAST PAGE — segment guests, pick a template, send WA
// one by one via wa.me. Spec: BROADCAST_FEATURE_SPEC.md (2026-07-18).
//
// Design rules baked in:
// - NO "send all" button, ever (WhatsApp ban risk for the FD number)
// - do_not_contact guests excluded by default (broadcast only —
//   Thank You / Follow Up buttons elsewhere are unaffected)
// - warn (not block) if the guest already got a BROADCAST within
//   7 days; transactional sends never trigger the warning
// - invalid/landline phones shown greyed with a reason, not hidden
// ============================================================

const BC_AT_RISK_DAYS = 60;
const BC_WARN_DAYS = 5;
const BC_SOFT_CAP_NOTE = 20; // list size that triggers the pacing nudge

// Stand-in for {link} in previews only. Points at the worked example in
// promo/, which is a real published page — so if a staff member taps it
// out of curiosity they land somewhere sane instead of on a 404.
const BC_SAMPLE_PROMO_LINK =
  "https://your-site.example/p/contoh-promo";

// Segment → template auto-pairing. "tag" resolves to tag:<name>
// (falls back to tag_default until a tag-specific template exists).
const BC_SEGMENTS = {
  all: { label: "Semua Guest", template: null },
  high_spender: { label: "High Spender", template: "high_spender" },
  medium_spender: { label: "Medium Spender", template: "medium_spender" },
  at_risk: { label: `At Risk (>${BC_AT_RISK_DAYS} hari tidak berkunjung)`, template: "at_risk" },
  acquisition: { label: "Akuisisi", template: "acquisition" },
  returning: { label: "Tamu yang kembali", template: "returning" },
  // Added 2026-07-26 so the owner dashboard's "N tamu baru yang belum
  // kembali" item can hand its exact population straight to Front Desk.
  first_timer: { label: "Tamu Baru (belum kembali)", template: "first_timer" },
  tag: { label: "Tag", template: null },
};

// Windows for date-scoped segments, set by dashboard/report hand-offs so the
// list is the SAME population the owner just clicked on. null = default to
// month-to-date, which is the dashboard/report default period.
// Guests who visited very recently are flagged rather than hidden — see
// BC_FIRST_TIMER_TOO_SOON_DAYS.
let bcFirstTimerWindow = null;
let bcReportSegmentWindow = null;
const BC_FIRST_TIMER_TOO_SOON_DAYS = 7;

// Editor: allowed placeholders per template class
const BC_PLACEHOLDERS = {
  thank_you: ["nama", "resto"],
  follow_up: ["nama", "resto", "tanggal", "jam", "pax"],
  voucher_ready: ["nama", "resto", "nominal", "kode", "berlaku"],
  // Deliberately just the two. A birthday greeting that quotes the guest's
  // last visit date or spend reads as surveillance rather than a greeting.
  birthday: ["nama", "resto"],
  // {link} (2026-08-01): the promo page URL, so WhatsApp draws a preview
  // card with the promo image above the message. Broadcast-only — a
  // thank-you or reservation confirmation has no promo to link to.
  broadcast: ["nama", "resto", "tanggal_terakhir", "link"],
};

let bcGuests = []; // {id,name,phone,tier,tags[],created_at,do_not_contact,lastVisit,visitCount,waPhone}
let bcLog = {}; // guest_id -> {lastAny: ts, lastBroadcast: ts}
let bcSegment = "all";
let bcTag = "";
let bcOnlyValid = true;
let bcShowOptedOut = false;
// "" = no template chosen yet — Kirim WA is blocked until staff picks one
let bcTemplateKey = "";
let bcTemplateManuallyChosen = false;
let bcLoaded = false;
let bcPage = 1;
const BC_PAGE_SIZE = 10;
let bcSearch = "";
let bcSort = "name";

// ── Data load ────────────────────────────────────────────────
async function loadBroadcast() {
  // Always land on the Campaign tab, even if staff navigated away
  // mid-edit last time.
  bcShowTab("campaign");

  await waLoadTemplates(true); // fresh templates every page open

  const [guestsRes, visitsRes, logRes] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("guests")
          .select(
            "id, name, phone, spending_tier, tag, created_at, do_not_contact",
          )
          .order("name"),
      "Gagal memuat daftar guest",
      "bc-guests", // dev-only cache (see supabaseQuery) — query shape is filter-independent
    ),
    supabaseQuery(
      // voided_at filter added 2026-07-26: a mis-entered walk-in that was
      // later voided was still counting as a visit here, so a guest whose
      // only visit was voided looked like they had been in — and never
      // showed up as At Risk. It also made this page disagree with the
      // owner dashboard, which has always excluded voided visits.
      () =>
        db
          .from("visits")
          .select("guest_id, visit_date")
          .is("voided_at", null),
      "Gagal memuat data kunjungan",
      "bc-visits",
    ),
    supabaseQuery(
      () =>
        db
          .from("wa_outreach_log")
          .select("guest_id, is_broadcast, sent_at")
          .gte(
            "sent_at",
            new Date(Date.now() - 90 * 864e5).toISOString(),
          ),
      "Gagal memuat riwayat pesan",
    ),
  ]);
  if (guestsRes.error) return;

  // First + last visit per guest. firstVisit is what identifies a
  // first-timer: if a guest's FIRST ever visit falls inside the reporting
  // window, they had no visit before it — which is exactly the owner
  // dashboard's definition of a non-repeat guest.
  const lastVisit = {};
  const firstVisit = {};
  const visitCount = {};
  const visitDates = {};
  (visitsRes.data || []).forEach((v) => {
    if (!v.guest_id || !v.visit_date) return;
    visitCount[v.guest_id] = (visitCount[v.guest_id] || 0) + 1;
    (visitDates[v.guest_id] = visitDates[v.guest_id] || []).push(v.visit_date);
    if (!lastVisit[v.guest_id] || v.visit_date > lastVisit[v.guest_id])
      lastVisit[v.guest_id] = v.visit_date;
    if (!firstVisit[v.guest_id] || v.visit_date < firstVisit[v.guest_id])
      firstVisit[v.guest_id] = v.visit_date;
  });

  // Outreach summary per guest
  bcLog = {};
  (logRes.data || []).forEach((r) => {
    const e = (bcLog[r.guest_id] = bcLog[r.guest_id] || {});
    if (!e.lastAny || r.sent_at > e.lastAny) e.lastAny = r.sent_at;
    if (r.is_broadcast && (!e.lastBroadcast || r.sent_at > e.lastBroadcast))
      e.lastBroadcast = r.sent_at;
  });

  bcGuests = (guestsRes.data || []).map((g) => ({
    id: g.id,
    name: g.name || "",
    phone: g.phone || "",
    tier: g.spending_tier || null,
    tags: g.tag
      ? g.tag.split(",").map((t) => t.trim()).filter(Boolean)
      : [],
    created_at: g.created_at,
    do_not_contact: !!g.do_not_contact,
    lastVisit: lastVisit[g.id] || null,
    firstVisit: firstVisit[g.id] || null,
    visitCount: visitCount[g.id] || 0,
    visitDates: visitDates[g.id] || [],
    waPhone: waPhone(g.phone),
  }));

  bcLoaded = true;
  // bcGuests is what the campaign workspace segments against, so the
  // list can only be rendered once this has finished.
  ceLoadList();
}

// ── Segment / filter logic ───────────────────────────────────
function bcIsAtRisk(g) {
  const cutoff = new Date(Date.now() - BC_AT_RISK_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);
  if (g.lastVisit) return g.lastVisit < cutoff;
  // Never visited: only at-risk if the profile itself is older than
  // the window — a fresh profile with no visits is NEW, not lapsed.
  return (g.created_at || "").slice(0, 10) < cutoff;
}

// Default window = month-to-date, mirroring the dashboard's default period.
function bcFirstTimerRange() {
  if (bcFirstTimerWindow) return bcFirstTimerWindow;
  return bcDefaultReportRange();
}

function bcDefaultReportRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: ymd(first), to: ymd(now) };
}

function bcReportSegmentRange() {
  return bcReportSegmentWindow || bcDefaultReportRange();
}

function bcReportRangeLabel(range = bcReportSegmentRange()) {
  if (!range?.from || !range?.to) return "";
  if (range.from === range.to) return waFormatDateId(range.from);
  return `${waFormatDateId(range.from)} - ${waFormatDateId(range.to)}`;
}

function bcCreateSegmentRangeLabel(segment) {
  if (segment === "first_timer") return bcReportRangeLabel(bcFirstTimerRange());
  if (segment === "acquisition" || segment === "returning")
    return bcReportRangeLabel(bcReportSegmentRange());
  return "";
}

function bcVisitCountInRange(g, range = bcReportSegmentRange()) {
  const { from, to } = range;
  return (g.visitDates || []).filter((d) => d >= from && d <= to).length;
}

// A first-timer worth contacting: their first ever visit happened inside the
// window AND they have not come back on a later day.
//
// The second condition was missing until 2026-07-26 (spotted by Rere, who
// found a 2-visit guest in the list). "First visit in the window" on its own
// also matches guests who came back DURING the window — Evelyn first visited
// 28 Jun and returned 11 Jul, so on a 30-day window she qualified. She is the
// opposite of an outreach target: she is the outcome we want. Messaging her
// "we hope to see you again" when she already did is exactly the careless
// mass-mail we are trying to avoid.
//
// Comparing lastVisit to firstVisit rather than checking visitCount === 1 is
// deliberate: two visits on the SAME day (lunch and dinner, or a duplicate
// entry) is not a guest who came back, so they stay in the list.
function bcIsFirstTimer(g) {
  if (!g.firstVisit) return false;
  const { from, to } = bcFirstTimerRange();
  if (g.firstVisit < from || g.firstVisit > to) return false;
  return g.lastVisit === g.firstVisit;
}

// First visit in the window but they DID return — counted for the banner so
// the owner can see the good news the segment deliberately filters out.
function bcReturnedAfterFirstVisit(g) {
  if (!g.firstVisit) return false;
  const { from, to } = bcFirstTimerRange();
  if (g.firstVisit < from || g.firstVisit > to) return false;
  return g.lastVisit > g.firstVisit;
}

function bcIsAcquisition(g) {
  if (!g.firstVisit) return false;
  const { from, to } = bcReportSegmentRange();
  return g.firstVisit >= from && g.firstVisit <= to;
}

// Must stay identical to reportIsRetainGuest() in app.js: visited inside the
// window AND had already visited before it. Until 2026-08-09 this asked for 2+
// visits INSIDE the window, so the Retain card said 3 while 16 guests had
// actually come back, and the campaign audience inherited the same wrong list.
function bcIsReturningReportGuest(g) {
  const { from, to } = bcReportSegmentRange();
  if (bcVisitCountInRange(g, { from, to }) < 1) return false;
  if (!g.firstVisit) return false;
  return g.firstVisit < from;
}

// True when this guest ate here so recently that a "come back" message
// would land badly. They stay in the list (the count must match what the
// dashboard promised) but the row says so and sorts to the bottom.
function bcVisitedTooRecently(g) {
  if (!g.lastVisit) return false;
  const cutoff = new Date(Date.now() - BC_FIRST_TIMER_TOO_SOON_DAYS * 864e5);
  return g.lastVisit > ymd(cutoff);
}

// Segment membership ONLY — no phone/opt-out/search/pagination filters.
// Split out 2026-08-01 so the campaign audience snapshot and the visible
// table are guaranteed to use the same definition of "who is in this
// segment". If these ever drift apart, the effectiveness report silently
// compares recipients against the wrong control group.
function bcMatchesSegment(g) {
  if (bcSegment === "high_spender" && g.tier !== "high_spender") return false;
  if (bcSegment === "medium_spender" && g.tier !== "medium_spender")
    return false;
  if (bcSegment === "at_risk" && !bcIsAtRisk(g)) return false;
  if (bcSegment === "acquisition" && !bcIsAcquisition(g)) return false;
  if (bcSegment === "returning" && !bcIsReturningReportGuest(g)) return false;
  if (bcSegment === "first_timer" && !bcIsFirstTimer(g)) return false;
  if (bcSegment === "tag") {
    if (!bcTag) return false;
    if (!g.tags.some((t) => t.toLowerCase() === bcTag.toLowerCase()))
      return false;
  }
  return true;
}

function bcTagTemplateKey(tag) {
  return "tag:" + tag.toLowerCase();
}

// renderBroadcast() and its segment banner lived here until 2026-08-01.
// They drove the standalone guest browser on the old Kirim tab, which no
// longer exists — the same list is now the "Penerima" section inside a
// campaign, rendered by ceRenderPenerima() in campaign-editor.js.

// Entry point used by the owner dashboard's "Rencanakan outreach" action.
// Navigates to Broadcast, then applies the segment for the exact date window
// the dashboard was showing, so the list length matches the number the owner
// just clicked. Safe to call before the page has ever loaded.
// Rewired 2026-08-01: instead of dropping the owner into a filtered guest
// browser that no longer exists, it opens the new-campaign dialog with the
// segment already chosen. The date window still comes from the dashboard,
// so the audience frozen into the campaign is exactly the population the
// owner just clicked on.
async function bcOpenFirstTimers(from, to) {
  bcFirstTimerWindow = from && to ? { from, to } : null;
  bcReportSegmentWindow = null;
  navigateTo("broadcast");
  if (!bcLoaded) await loadBroadcast();
  bcShowTab("campaign");
  ceOpenCreate();
  const sel = document.getElementById("ce-create-segment");
  if (sel) sel.value = "first_timer";
  ceSetCreateSegment("first_timer");
}

// Entry point used by the Reports page's Berisiko Hilang card.
// It lands staff in the campaign workspace and opens a new draft with the
// at-risk audience selected, ready for the usual message/image setup.
async function bcOpenAtRiskCampaign() {
  bcFirstTimerWindow = null;
  bcReportSegmentWindow = null;
  navigateTo("broadcast");
  if (!bcLoaded) await loadBroadcast();
  bcShowTab("campaign");
  ceOpenCreate();
  const sel = document.getElementById("ce-create-segment");
  if (sel) sel.value = "at_risk";
  ceSetCreateSegment("at_risk");
}

async function bcOpenReportCampaign(segment, from, to) {
  bcFirstTimerWindow = null;
  bcReportSegmentWindow = from && to ? { from, to } : null;
  navigateTo("broadcast");
  if (!bcLoaded) await loadBroadcast();
  bcShowTab("campaign");
  ceOpenCreate();
  const sel = document.getElementById("ce-create-segment");
  if (sel) sel.value = segment;
  ceSetCreateSegment(segment);
}

async function bcOpenAcquisitionCampaign() {
  const range =
    typeof getMarketingDateRange === "function"
      ? getMarketingDateRange()
      : bcDefaultReportRange();
  await bcOpenReportCampaign("acquisition", range.from, range.to);
}

async function bcOpenReturningCampaign() {
  const range =
    typeof getMarketingDateRange === "function"
      ? getMarketingDateRange()
      : bcDefaultReportRange();
  await bcOpenReportCampaign("returning", range.from, range.to);
}

// ── Send flow ────────────────────────────────────────────────
// Removed 2026-08-01. Sending moved into the campaign workspace
// (ceSend in campaign-editor.js) so that every broadcast belongs to a
// campaign and therefore always has a frozen comparison group behind
// it. A send with no campaign could never appear in the report, which
// made it a quiet way to lose data.

// ============================================================
// TEMPLATE EDITOR ("Kelola Template")
// Any staff with PIN may edit — safeties: placeholder validation,
// live preview, no emoji, no empty body, restore-to-default.
// ============================================================

// Full-page sub-view inside the Broadcast page (was a modal — too
// cramped for editing 6+ templates with previews, and a backdrop
// misclick could close it mid-edit).
// 2026-08-01: these are now tab switches (bcShowTab), kept as named
// functions because other code and markup already call them.
function bcOpenEditor() {
  bcShowTab("template");
}

function bcCloseEditor() {
  bcShowTab("kirim");
  // Templates may have changed while editing — refresh pairing/preview
}

function bcEditorAllowed(key) {
  if (key === "thank_you") return BC_PLACEHOLDERS.thank_you;
  if (key === "follow_up") return BC_PLACEHOLDERS.follow_up;
  if (key === "voucher_ready") return BC_PLACEHOLDERS.voucher_ready;
  if (key === "birthday") return BC_PLACEHOLDERS.birthday;
  return BC_PLACEHOLDERS.broadcast;
}

function bcRenderEditor() {
  const wrap = document.getElementById("bc-editor-list");
  if (!wrap) return;

  // tag_default is hidden from the editor too — it lives only as the
  // seed text for new tag templates.
  const keys = [
    "thank_you",
    "follow_up",
    "voucher_ready",
    "birthday",
    "at_risk",
    "acquisition",
    "returning",
    "first_timer",
    "medium_spender",
    "high_spender",
    ...Object.keys(waTemplatesCache || {})
      .filter((k) => k.startsWith("tag:"))
      .sort(),
  ];

  wrap.innerHTML = keys
    .map((key) => {
      const t = waTemplatesCache?.[key];
      const label = t?.label || WA_DEFAULT_TEMPLATES[key]?.label || key;
      const body = t?.body ?? WA_DEFAULT_TEMPLATES[key]?.body ?? "";
      const allowed = bcEditorAllowed(key)
        .map((p) => `{${p}}`)
        .join(" ");
      const isTagTpl = key.startsWith("tag:");
      const safeId = key.replace(/[^a-z0-9_]/gi, "_");
      return `<div class="border border-[#E7E4DE] rounded-xl p-4 bg-white">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold text-[#333]">${escapeHtml(label)}</div>
          <div class="flex gap-2">
            ${isTagTpl ? `<button onclick="bcDeleteTagTemplate('${escapeHtml(key)}')" class="text-xs text-[#C0392B] hover:underline">Hapus</button>` : ""}
            <button onclick="bcRestoreDefault('${escapeHtml(key)}')" class="text-xs text-[#8B5E3C] hover:underline">Kembalikan ke default</button>
          </div>
        </div>
        <textarea id="bc-body-${safeId}" data-key="${escapeHtml(key)}" rows="4"
          class="w-full text-sm border border-[#E7E4DE] rounded-lg p-3 focus:outline-none focus:border-[#28547C]"
          oninput="bcUpdatePreview('${escapeHtml(key)}')">${escapeHtml(body)}</textarea>
        <div class="text-[11px] text-[#999] mt-1">Placeholder yang bisa dipakai: <span class="font-mono">${allowed}</span> — tanpa emoji.</div>
        ${
          bcEditorAllowed(key).includes("link")
            ? `<div class="text-[11px] text-[#777] mt-1 leading-relaxed">
                 Pakai <span class="font-mono">{link}</span> kalau promo ini punya gambar. WhatsApp akan
                 menampilkan gambarnya sebagai preview di atas pesan. Alamatnya diisi
                 per campaign saat menekan "Mulai Campaign", jadi satu template bisa
                 dipakai untuk banyak promo. Kalau campaign-nya tidak punya link,
                 <span class="font-mono">{link}</span> otomatis dihapus dari pesan.
               </div>`
            : ""
        }
        <div class="mt-2 text-[11px] uppercase tracking-wider text-[#999]">Preview</div>
        <div id="bc-preview-${safeId}" class="text-sm text-[#555] bg-[#F8F6F2] rounded-lg p-3 mt-1 whitespace-pre-wrap"></div>
        <div class="mt-2 text-right">
          <button onclick="bcSaveTemplate('${escapeHtml(key)}')" class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#28547C] hover:bg-[#1D3F5E]">Simpan</button>
        </div>
      </div>`;
    })
    .join("");

  keys.forEach((k) => bcUpdatePreview(k));

  // "Create tag template" control
  const tagSel = document.getElementById("bc-new-tag-template");
  if (tagSel) {
    const tags = [...new Set(bcGuests.flatMap((g) => g.tags))].sort();
    const existing = new Set(
      Object.keys(waTemplatesCache || {})
        .filter((k) => k.startsWith("tag:"))
        .map((k) => k.slice(4)),
    );
    const options = tags.filter((t) => !existing.has(t.toLowerCase()));
    tagSel.innerHTML =
      `<option value="">Pilih custom tags</option>` +
      options
        .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join("");
  }
}

function bcSampleCtx() {
  const sample = bcGuests[0];
  return {
    nama: waGreetName(sample?.name || "Budi Santoso"),
    resto: WA_RESTAURANT_NAME,
    // ymd(), not toISOString(): the template editor's live preview showed
    // yesterday's date before 07:00 Jakarta. Cosmetic here (it is only a
    // preview) but the same call is a real bug elsewhere — see ymd() in
    // config.js. Kept consistent so nobody copies the wrong pattern.
    tanggal_terakhir: waFormatDateId(sample?.lastVisit || TODAY),
    tanggal: waFormatDateId(TODAY),
    jam: "19.00",
    pax: 4,
    // Voucher preview sample — Family card values, the common case.
    nominal: "Rp 100.000",
    kode: "BH-F21-0001",
    berlaku: waFormatDateId(TODAY),
    // The real link is chosen per campaign; the editor only needs to show
    // roughly how much room the URL takes up in the message.
    link: BC_SAMPLE_PROMO_LINK,
  };
}

function bcUpdatePreview(key) {
  const safeId = key.replace(/[^a-z0-9_]/gi, "_");
  const ta = document.getElementById(`bc-body-${safeId}`);
  const prev = document.getElementById(`bc-preview-${safeId}`);
  if (ta && prev) prev.textContent = waRenderTemplate(ta.value, bcSampleCtx());
}

const BC_EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

function bcValidateBody(key, body) {
  if (!body || !body.trim())
    return "Template tidak boleh kosong — guest akan menerima pesan kosong.";
  if (BC_EMOJI_RE.test(body))
    return "Emoji tidak bisa dipakai (rusak jadi \"?\" di WhatsApp komputer FD). Hapus emoji dulu ya — emoji bisa ditambah manual di WhatsApp sebelum kirim.";
  const allowed = new Set(bcEditorAllowed(key));
  const bad = [...body.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((p) => !allowed.has(p));
  if (bad.length)
    return `Placeholder tidak dikenal: {${bad.join("}, {")}}. Yang bisa dipakai: ${[...allowed].map((p) => `{${p}}`).join(" ")}`;
  return null;
}

async function bcSaveTemplate(key) {
  const safeId = key.replace(/[^a-z0-9_]/gi, "_");
  const ta = document.getElementById(`bc-body-${safeId}`);
  if (!ta) return;
  const body = ta.value;

  const err = bcValidateBody(key, body);
  if (err) {
    toast(err, "error");
    return;
  }

  const label =
    waTemplatesCache?.[key]?.label ||
    WA_DEFAULT_TEMPLATES[key]?.label ||
    (key.startsWith("tag:") ? `Broadcast: Tag "${key.slice(4)}"` : key);
  const isBroadcast = key !== "thank_you" && key !== "follow_up";

  const { error } = await supabaseQuery(
    () =>
      db.from("wa_templates").upsert({
        key,
        label,
        body,
        is_broadcast: isBroadcast,
        updated_at: new Date().toISOString(),
        updated_by:
          getStaffSession()?.display_name ||
          getStaffSession()?.username ||
          null,
      }),
    "Gagal menyimpan template",
  );
  if (error) return;

  await waLoadTemplates(true);
  toast("Template tersimpan");
  bcRenderEditor();
}

async function bcRestoreDefault(key) {
  const def = key.startsWith("tag:")
    ? WA_DEFAULT_TEMPLATES.tag_default
    : WA_DEFAULT_TEMPLATES[key];
  if (!def) return;
  if (!confirm("Kembalikan template ini ke teks default?")) return;

  const { error } = await supabaseQuery(
    () =>
      db.from("wa_templates").upsert({
        key,
        label: waTemplatesCache?.[key]?.label || def.label,
        body: def.body,
        is_broadcast: def.is_broadcast,
        updated_at: new Date().toISOString(),
        updated_by:
          getStaffSession()?.display_name ||
          getStaffSession()?.username ||
          null,
      }),
    "Gagal mengembalikan template",
  );
  if (error) return;
  await waLoadTemplates(true);
  toast("Template dikembalikan ke default");
  bcRenderEditor();
}

async function bcCreateTagTemplate(tag) {
  if (!tag) return;
  const key = bcTagTemplateKey(tag);
  if (waTemplatesCache?.[key]) {
    toast("Template untuk tag ini sudah ada", "error");
    return;
  }
  const { error } = await supabaseQuery(
    () =>
      db.from("wa_templates").insert({
        key,
        label: `Broadcast: Tag "${tag}"`,
        body: WA_DEFAULT_TEMPLATES.tag_default.body,
        is_broadcast: true,
        updated_by:
          getStaffSession()?.display_name ||
          getStaffSession()?.username ||
          null,
      }),
    "Gagal membuat template tag",
  );
  if (error) return;
  await waLoadTemplates(true);
  toast(`Template untuk tag "${tag}" dibuat — jangan lupa ganti isi promonya`);
  bcRenderEditor();
}

// From the Broadcast list: tag filter active but no template for that
// tag yet — create it from the seed and auto-select it.
async function bcCreateTagTemplateFromList() {
  if (!bcTag) return;
  await bcCreateTagTemplate(bcTag);
  if (waTemplatesCache?.[bcTagTemplateKey(bcTag)]) {
    bcTemplateManuallyChosen = false;
  }
}

async function bcDeleteTagTemplate(key) {
  if (!key.startsWith("tag:")) return; // built-ins can never be deleted
  if (!confirm(`Hapus template "${key.slice(4)}"? Tag ini tidak akan punya template sampai dibuat lagi.`))
    return;
  const { error } = await supabaseQuery(
    () => db.from("wa_templates").delete().eq("key", key),
    "Gagal menghapus template",
  );
  if (error) return;
  await waLoadTemplates(true);
  if (bcTemplateKey === key) {
    bcTemplateManuallyChosen = false;
  }
  toast("Template tag dihapus");
  bcRenderEditor();
}
