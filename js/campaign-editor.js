// ============================================================
// CAMPAIGN WORKSPACE — the place ops actually works
// ------------------------------------------------------------
// Rework 2026-08-01 (Rere). A campaign used to be a label stuck on a
// batch of sends: you filtered guests, pressed "Mulai Campaign", and
// the campaign then had no screen of its own. Everything worth
// changing — the wording, the picture, who is on the list — lived
// somewhere else, and progress lived nowhere at all.
//
// Now a campaign owns all of it:
//   Ringkasan  — what this is, how far along it is
//   Pesan      — the message, edited here, versioned on every change
//   Gambar     — promo image, headline, and where a tap leads
//   Penerima   — the recipient list, one row per guest, with progress
//
// TWO RULES THAT KEEP THE REPORT HONEST
//
// 1. Row status is a WORKLIST, not evidence. Marking someone "done"
//    or "skipped" changes what ops sees and nothing else. The
//    effectiveness report counts rows in wa_outreach_log — actual
//    WhatsApp hand-offs — so no amount of clicking in here can move
//    the numbers.
//
// 2. Skipping keeps a guest in the audience. They were eligible, they
//    were not messaged, so they belong in the comparison group. If
//    skipping removed them entirely, ops quietly skipping the guests
//    who "probably won't come anyway" would tilt every result.
// ============================================================

const CE_PAGE_SIZE = 25;

let ceCampaigns = []; // list view
let ceCampaign = null; // the campaign open in the workspace
let ceAudience = []; // rows for ceCampaign, joined to guest data
let ceSection = "ringkasan";
let cePage = 1;
let ceSearch = "";
let ceRowFilter = "all"; // all | pending | sent | skipped | done
let ceSpendSort = null; // null (send order) | "desc" (High first) | "asc"
let ceVisitSort = null; // null (send order) | "asc" (longest ago first) | "desc"
let ceDirty = { message: false, promo: false };
let ceCreateSegment = "at_risk";
let ceCreateTag = "";

// ── Small helpers ────────────────────────────────────────────
function ceStatusPill(status, count) {
  const map = {
    pending: ["Belum dikirim", "#F0EDE7", "#777"],
    sent: [count > 1 ? `Terkirim ${count}x` : "Terkirim", "#E4F5EC", "#1B7A4B"],
    skipped: ["Dilewati", "#FBEEEC", "#B4523F"],
    done: ["Selesai", "var(--brand-tint2)", "var(--brand-ink)"],
  };
  const [label, bg, fg] = map[status] || map.pending;
  return `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium"
    style="background:${bg};color:${fg}">${escapeHtml(label)}</span>`;
}

function ceCampaignStatusPill(status) {
  const map = {
    draft: ["Draft", "#F0EDE7", "#777"],
    active: ["Berjalan", "#1FAF5E", "#fff"],
    done: ["Selesai", "var(--brand-tint2)", "var(--brand-ink)"],
  };
  const [label, bg, fg] = map[status] || map.draft;
  return `<span class="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-widest"
    style="background:${bg};color:${fg}">${label}</span>`;
}

function ceProgress(rows) {
  const total = rows.length;
  const sent = rows.filter((r) => r.status === "sent").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const done = rows.filter((r) => r.status === "done").length;
  const pending = total - sent - skipped - done;
  const handled = total - pending;
  return { total, sent, skipped, done, pending, handled };
}

function ceSlugify(name) {
  return (
    (name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "promo"
  );
}

// ── Promo link shape ─────────────────────────────────────────
// This URL is read by a guest, in a chat, on a phone. It is the only
// part of the system a customer ever sees, so it gets treated as copy
// rather than as plumbing.
//
//   before:  /promo/testing-rere-1-kbce21
//   after:   /p/steak-agustus
//
// The random suffix used to be unconditional. It exists for a real
// reason — WhatsApp caches preview images per URL, hard and for weeks,
// so two different promos sharing a URL means the second one shows the
// first one's picture. But it only needs to appear when a name actually
// repeats, which ceUniqueSlug handles by asking the database first.
const CE_PROMO_PATH = "/p/";

// The host that actually runs the /p/* function, pinned rather than
// taken from location.origin.
//
// location.origin is whatever domain the STAFF happen to have the app
// open on, and that is not necessarily the domain serving the promo
// function. Two ways it breaks:
//   - staff app served from a second host (e.g. while Netlify deploys
//     are paused) => every generated link 404s for the guest;
//   - testing on localhost => link points at localhost.
//
// Neither is self-healing. The comment above explains why: WhatsApp
// caches the preview image per URL, hard and for weeks, so a link sent
// once wrong stays wrong long after the app is fixed.
//
// Change this ONLY if the /p/* function itself moves hosts.
const CE_PROMO_ORIGIN = "https://your-site.example";

function cePromoUrl(c) {
  return c?.slug ? `${CE_PROMO_ORIGIN}${CE_PROMO_PATH}${c.slug}` : "";
}

// Reserve the paths the site already serves, so a campaign called
// "Reserve" cannot generate a link that collides with the booking form.
const CE_RESERVED_SLUGS = [
  "promo",
  "p",
  "reserve",
  "reservation-created",
  "reservation-confirmation",
  "spin",
  "index",
  "assets",
  "js",
  "admin",
  "netlify",
];

// Ask the database for the clean slug first and only add a suffix if it
// is taken. `slug` has a unique index, so guessing wrong is a hard
// insert error rather than a silent overwrite.
async function ceUniqueSlug(name) {
  const base = ceSlugify(name);
  if (CE_RESERVED_SLUGS.includes(base))
    return `${base}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await db
    .from("wa_campaigns")
    .select("slug")
    .eq("slug", base)
    .maybeSingle();

  // If the check itself fails, fall back to the old always-unique form.
  // A slightly ugly link beats a failed campaign creation.
  if (error) return `${base}-${Math.random().toString(36).slice(2, 6)}`;
  if (!data) return base;

  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

// The public URL Supabase Storage serves an uploaded promo image from.
function cePromoImageUrl(c) {
  if (!c?.promo_image_path) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/promo-images/${c.promo_image_path}`;
}

// ============================================================
// LIST VIEW
// ============================================================

async function ceLoadList() {
  const el = document.getElementById("ce-list");
  if (!el) return;
  el.innerHTML = `<div class="p-8 text-center text-sm text-[#999]">Memuat campaign...</div>`;

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .select("*")
        .order("status", { ascending: true })
        .order("started_at", { ascending: false }),
    "Gagal memuat daftar campaign",
  );
  if (error) return;
  ceCampaigns = data || [];

  // Progress counts for every campaign in one round trip rather than
  // one query per card.
  const ids = ceCampaigns.map((c) => c.id);
  let counts = {};
  if (ids.length) {
    const { data: aud } = await supabaseQuery(
      () =>
        db
          .from("wa_campaign_audience")
          .select("campaign_id, status")
          .in("campaign_id", ids),
      "Gagal memuat progres campaign",
    );
    (aud || []).forEach((r) => {
      const c = (counts[r.campaign_id] = counts[r.campaign_id] || {
        total: 0,
        sent: 0,
        skipped: 0,
        done: 0,
      });
      c.total++;
      if (c[r.status] !== undefined) c[r.status]++;
    });
  }
  ceRenderList(counts);
}

function ceRenderList(counts) {
  const el = document.getElementById("ce-list");
  if (!el) return;

  const active = ceCampaigns.filter((c) => c.status === "active");
  const drafts = ceCampaigns.filter((c) => c.status === "draft");
  const done = ceCampaigns.filter((c) => c.status === "done");

  const card = (c) => {
    const k = counts[c.id] || { total: 0, sent: 0, skipped: 0, done: 0 };
    const handled = k.sent + k.skipped + k.done;
    const pct = k.total ? Math.round((handled / k.total) * 100) : 0;
    return `<button onclick="ceOpen('${c.id}')"
      class="w-full text-left bg-white rounded-2xl border border-[#E7E4DE] p-4 mb-3 hover:border-[color:var(--brand-ink)] transition-colors">
      <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div class="min-w-0">
          <p class="font-semibold text-[color:var(--brand-ink)] truncate">${escapeHtml(c.name)}</p>
          <p class="text-xs text-[#999] mt-0.5">
            ${escapeHtml(campSegmentLabel(c.segment, c.segment_tag))}
            &middot; ${campFmtDate(c.started_at)}
            ${c.created_by ? "&middot; " + escapeHtml(c.created_by) : ""}
          </p>
        </div>
        ${ceCampaignStatusPill(c.status)}
      </div>
      ${
        c.note
          ? `<p class="text-xs text-[#666] italic mb-2 truncate">${escapeHtml(c.note)}</p>`
          : ""
      }
      <div class="flex items-center gap-3">
        <div class="flex-1 h-2 rounded-full bg-[#F0EDE7] overflow-hidden">
          <div class="h-full rounded-full" style="width:${pct}%;background:#1FAF5E"></div>
        </div>
        <span class="text-xs text-[#777] whitespace-nowrap">
          ${k.sent} terkirim &middot; ${k.total} orang
        </span>
      </div>
    </button>`;
  };

  const group = (title, list, hint) =>
    list.length
      ? `<div class="mb-6">
           <p class="text-[11px] uppercase tracking-widest text-[#999] mb-2">${title}</p>
           ${hint ? `<p class="text-xs text-[#777] mb-3">${hint}</p>` : ""}
           ${list.map(card).join("")}
         </div>`
      : "";

  el.innerHTML =
    `<div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-[#555]">
        Tiap campaign punya pesan, gambar, dan daftar penerimanya sendiri.
      </p>
      <button onclick="ceOpenCreate()"
        class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[color:var(--brand-ink)] hover:bg-[color:var(--brand-deep)] whitespace-nowrap">
        + Campaign Baru
      </button>
    </div>` +
    (ceCampaigns.length
      ? group("Sedang berjalan", active) +
        group("Draft", drafts, "Belum ada pesan yang dikirim. Aman untuk diubah.") +
        group("Selesai", done)
      : `<div class="bg-white rounded-2xl border border-[#E7E4DE] p-8 text-center">
           <p class="text-sm font-medium text-[#555]">Belum ada campaign.</p>
           <p class="text-xs text-[#999] mt-2 max-w-sm mx-auto leading-relaxed">
             Buat campaign baru, pilih segmennya, atur pesan dan gambarnya,
             lalu kirim satu per satu dari daftar penerima.
           </p>
         </div>`);
}

// ============================================================
// CREATE
// ============================================================

function ceOpenCreate() {
  ceCreateSegment = "at_risk";
  ceCreateTag = "";
  const sel = document.getElementById("ce-create-segment");
  if (sel) sel.value = ceCreateSegment;
  document.getElementById("ce-create-name").value = "";
  ceRenderCreatePreview();
  showModal("ce-create-modal");
  document.getElementById("ce-create-name").focus();
}

function ceSetCreateSegment(seg) {
  ceCreateSegment = seg;
  const tagSel = document.getElementById("ce-create-tag");
  if (tagSel) {
    tagSel.style.display = seg === "tag" ? "" : "none";
    if (seg === "tag" && !tagSel.options.length) {
      const tags = [...new Set(bcGuests.flatMap((g) => g.tags))].sort();
      tagSel.innerHTML =
        `<option value="">Pilih tag...</option>` +
        tags
          .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
          .join("");
    }
  }
  ceRenderCreatePreview();
}

function ceSetCreateTag(tag) {
  ceCreateTag = tag;
  ceRenderCreatePreview();
}

// Who would be on the list if this campaign were created right now.
// Reuses the Broadcast page's own segment predicates so the audience
// and the guest browser can never disagree about what "at risk" means.
function ceCreateAudience() {
  const savedSeg = bcSegment;
  const savedTag = bcTag;
  bcSegment = ceCreateSegment;
  bcTag = ceCreateTag;
  const list = bcGuests.filter((g) => bcMatchesSegment(g) && !g.do_not_contact);
  bcSegment = savedSeg;
  bcTag = savedTag;
  return list;
}

function ceRenderCreatePreview() {
  const el = document.getElementById("ce-create-preview");
  if (!el) return;
  const list = ceCreateAudience();
  const reachable = list.filter((g) => g.waPhone).length;
  const nameEl = document.getElementById("ce-create-name");
  const rangeLabel =
    typeof bcCreateSegmentRangeLabel === "function"
      ? bcCreateSegmentRangeLabel(ceCreateSegment)
      : "";
  if (nameEl && !nameEl.value.trim()) {
    const month = new Date().toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
    nameEl.placeholder = `${campSegmentLabel(ceCreateSegment, ceCreateTag)} — ${rangeLabel || month}`;
  }
  el.innerHTML = `<div class="text-xs text-[#555] leading-relaxed">
    <p><strong>${list.length} guest</strong> masuk segmen ini sekarang,
       <strong>${reachable}</strong> punya nomor WA valid.</p>
    ${
      rangeLabel
        ? `<p class="mt-2 text-[#777]">Segmen ini memakai periode laporan: <strong>${escapeHtml(rangeLabel)}</strong>.</p>`
        : ""
    }
    <p class="mt-2 text-[#777]">
      Daftar ini dibekukan saat campaign dibuat. Guest yang masuk segmen tapi
      tidak jadi dikirimi pesan dipakai sebagai pembanding di laporan, supaya
      bisa dibedakan mana yang kembali karena pesan kita dan mana yang memang
      mau datang.
    </p>
    ${
      ceCreateSegment === "tag" && !ceCreateTag
        ? `<p class="mt-2 text-[#B4523F]">Pilih tag dulu ya.</p>`
        : ""
    }
  </div>`;
}

async function ceCreate() {
  const name =
    document.getElementById("ce-create-name").value.trim() ||
    document.getElementById("ce-create-name").placeholder;
  if (!name) {
    toast("Beri nama campaign dulu ya", "error");
    return;
  }
  if (ceCreateSegment === "tag" && !ceCreateTag) {
    toast("Pilih tag dulu ya", "error");
    return;
  }
  const list = ceCreateAudience();
  if (!list.length) {
    toast("Tidak ada guest di segmen ini — campaign tidak dibuat", "error");
    return;
  }

  // Start from the matching template so ops has real wording to edit
  // rather than an empty box.
  const tplKey =
    ceCreateSegment === "tag"
      ? bcTagTemplateKey(ceCreateTag)
      : BC_SEGMENTS[ceCreateSegment]?.template || "";
  const body =
    waTemplateBody(tplKey) ||
    WA_DEFAULT_TEMPLATES.tag_default.body;

  // Prefer the clean, readable slug; ceUniqueSlug only adds a suffix
  // when the name is already taken or is a reserved path.
  const slug = await ceUniqueSlug(name);

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .insert({
          name,
          slug,
          status: "draft",
          segment: ceCreateSegment,
          segment_tag: ceCreateSegment === "tag" ? ceCreateTag : null,
          template_key: tplKey || "tag_default",
          message_body: body,
          message_version: 1,
          promo_destination: `/reserve?from=${slug}`,
          created_by:
            getStaffSession()?.display_name ||
            getStaffSession()?.username ||
            null,
        })
        .select()
        .single(),
    "Gagal membuat campaign",
  );
  if (error || !data) return;

  const rows = list.map((g) => ({
    campaign_id: data.id,
    guest_id: g.id,
    has_wa: !!g.waPhone,
    // Unreachable guests start as skipped with the reason already
    // filled in: they cannot be messaged, and saying so up front beats
    // ops discovering it one row at a time.
    status: g.waPhone ? "pending" : "skipped",
    skip_reason: g.waPhone ? null : "Nomor WA tidak valid / kosong",
  }));
  const { error: audErr } = await supabaseQuery(
    () => db.from("wa_campaign_audience").insert(rows),
    "Gagal menyimpan daftar penerima",
  );
  if (audErr) {
    toast(
      "Campaign dibuat tapi daftar penerimanya gagal disimpan — hapus campaign ini dan coba lagi",
      "error",
    );
  }

  hideModal("ce-create-modal");
  toast(`Campaign "${name}" dibuat sebagai draft`);
  await ceOpen(data.id);
}

// ============================================================
// WORKSPACE
// ============================================================

// Last visit per guest, read from guest_visit_stats — the same view the
// dashboard reports use, so this column agrees with them. It already
// excludes voided visits (migrations/20260726_dashboard_reports.sql), so a
// mis-entered walk-in that was later voided cannot show up here as a real
// visit.
//
// Chunked on purpose: a "Semua Guest" campaign can carry thousands of ids,
// and one call with all of them would both blow the request URL length and
// hit PostgREST's 1000-row default cap, silently leaving the tail of the
// list blank.
const CE_VISIT_CHUNK = 200;

async function ceLoadLastVisits(guestIds) {
  const ids = [...new Set(guestIds.filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < ids.length; i += CE_VISIT_CHUNK)
    chunks.push(ids.slice(i, i + CE_VISIT_CHUNK));

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabaseQuery(
        () =>
          db
            .from("guest_visit_stats")
            .select("guest_id, last_visit_date")
            .in("guest_id", chunk),
        "Gagal memuat kunjungan terakhir",
      ),
    ),
  );

  // A failed chunk leaves those rows showing "-" rather than blocking the
  // campaign from opening; the visit date is context, not something ops
  // needs in order to send.
  const map = {};
  results.forEach((res) =>
    (res.data || []).forEach((v) => {
      if (v.guest_id) map[v.guest_id] = v.last_visit_date || null;
    }),
  );
  return map;
}

async function ceOpen(id) {
  ceSection = "ringkasan";
  cePage = 1;
  ceSearch = "";
  ceRowFilter = "all";
  ceSpendSort = null;
  ceVisitSort = null;
  ceDirty = { message: false, promo: false };

  const [campRes, audRes] = await Promise.all([
    supabaseQuery(
      () => db.from("wa_campaigns").select("*").eq("id", id).single(),
      "Gagal memuat campaign",
    ),
    supabaseQuery(
      () =>
        db
          .from("wa_campaign_audience")
          .select("*, guests(id, name, phone, spending_tier, tag, do_not_contact)")
          .eq("campaign_id", id),
      "Gagal memuat daftar penerima",
    ),
  ]);
  if (campRes.error || !campRes.data) return;

  ceCampaign = campRes.data;
  const lastVisits = await ceLoadLastVisits(
    (audRes.data || []).map((r) => r.guest_id),
  );
  ceAudience = (audRes.data || []).map((r) => ({
    ...r,
    name: r.guests?.name || "",
    phone: r.guests?.phone || "",
    tier: r.guests?.spending_tier || null,
    lastVisit: lastVisits[r.guest_id] || null,
    waPhone: waPhone(r.guests?.phone),
    do_not_contact: !!r.guests?.do_not_contact,
  }));

  document.getElementById("ce-view-list").classList.add("hidden");
  document.getElementById("ce-view-workspace").classList.remove("hidden");
  ceRenderWorkspace();
}

function ceBackToList() {
  if (ceDirty.message || ceDirty.promo) {
    if (!confirm("Ada perubahan yang belum disimpan. Tetap keluar?")) return;
  }
  ceCampaign = null;
  ceAudience = [];
  document.getElementById("ce-view-workspace").classList.add("hidden");
  document.getElementById("ce-view-list").classList.remove("hidden");
  ceLoadList();
}

function ceSetSection(section) {
  ceSection = section;
  ceRenderWorkspace();
}

function ceRenderWorkspace() {
  const el = document.getElementById("ce-workspace");
  if (!el || !ceCampaign) return;
  const c = ceCampaign;
  const p = ceProgress(ceAudience);

  const sections = [
    ["ringkasan", "Ringkasan"],
    ["pesan", "Pesan"],
    ["gambar", "Gambar & Link"],
    ["penerima", `Penerima (${p.total})`],
  ];
  const activeCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-[color:var(--brand-ink)] text-white transition";
  const idleCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-white text-[#555] border border-[#E6E2DC] hover:bg-[#F8F6F2] transition";

  el.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div class="min-w-0">
        <button onclick="ceBackToList()" class="text-xs text-[color:var(--brand-ink)] hover:underline mb-2">&larr; Semua campaign</button>
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="font-display text-2xl text-[color:var(--brand-ink)]">${escapeHtml(c.name)}</h2>
          ${ceCampaignStatusPill(c.status)}
        </div>
        <p class="text-xs text-[#999] mt-1">
          ${escapeHtml(campSegmentLabel(c.segment, c.segment_tag))}
          &middot; dibuat ${campFmtDate(c.started_at)}
          ${c.created_by ? "&middot; " + escapeHtml(c.created_by) : ""}
        </p>
      </div>
      <div id="ce-action-buttons" class="flex flex-wrap gap-2">${ceActionButtons(c, p)}</div>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-5">
      ${sections
        .map(
          ([k, label]) =>
            `<button onclick="ceSetSection('${k}')" class="${k === ceSection ? activeCls : idleCls}">${label}</button>`,
        )
        .join("")}
    </div>

    <div id="ce-section-body">${ceRenderSection(c, p)}</div>`;

  if (ceSection === "pesan") ceUpdateMessagePreview();
  if (ceSection === "gambar") ceRenderCardPreview();
}

function ceActionButtons(c, p) {
  const btn = (label, fn, primary) =>
    `<button onclick="${fn}" class="px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap ${
      primary
        ? "text-white bg-[#1FAF5E] hover:bg-[#178C4B]"
        : "border border-[#E7E4DE] bg-white text-[#555] hover:bg-[#F8F6F2] font-medium"
    }">${label}</button>`;

  if (c.status === "draft")
    return (
      btn("Mulai Kirim", "ceActivate()", true) +
      btn("Hapus Campaign", "ceDelete()")
    );
  if (c.status === "active")
    return (
      (p.pending ? btn("Lanjut Kirim", "ceSetSection('penerima')", true) : "") +
      btn("Selesaikan", "ceFinish()")
    );
  return btn("Buka Lagi", "ceReopen()");
}

function ceRenderSection(c, p) {
  if (ceSection === "ringkasan") return ceRenderRingkasan(c, p);
  if (ceSection === "pesan") return ceRenderPesan(c);
  if (ceSection === "gambar") return ceRenderGambar(c);
  return ceRenderPenerima(c, p);
}

// ── Ringkasan ────────────────────────────────────────────────
function ceRenderRingkasan(c, p) {
  const pct = p.total ? Math.round((p.handled / p.total) * 100) : 0;
  const stat = (label, value, sub) => `
    <div class="rounded-xl border border-[#E7E4DE] bg-white p-3">
      <p class="text-[10px] uppercase tracking-wider text-[#999]">${label}</p>
      <p class="text-lg font-semibold text-[#333] mt-1">${value}</p>
      <p class="text-[11px] text-[#999]">${sub}</p>
    </div>`;

  return `
    <div class="bg-white rounded-2xl border border-[#E7E4DE] p-5 mb-4">
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm font-medium text-[#333]">Progres pengiriman</p>
        <p class="text-sm text-[#777]">${p.handled} dari ${p.total} sudah ditangani</p>
      </div>
      <div class="h-3 rounded-full bg-[#F0EDE7] overflow-hidden flex">
        <div style="width:${p.total ? (p.sent / p.total) * 100 : 0}%;background:#1FAF5E"></div>
        <div style="width:${p.total ? (p.done / p.total) * 100 : 0}%;background:var(--brand-ink)"></div>
        <div style="width:${p.total ? (p.skipped / p.total) * 100 : 0}%;background:#D9A79B"></div>
      </div>
      <p class="text-xs text-[#999] mt-2">${pct}% selesai</p>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      ${stat("Belum dikirim", p.pending, "menunggu giliran")}
      ${stat("Terkirim", p.sent, "chat WhatsApp dibuka")}
      ${stat("Dilewati", p.skipped, "jadi pembanding")}
      ${stat("Ditandai selesai", p.done, "ditangani tanpa pesan")}
    </div>

    <div class="bg-white rounded-2xl border border-[#E7E4DE] p-4">
      <p class="text-[10px] uppercase tracking-wider text-[#999] mb-2">Catatan promo</p>
      <input id="ce-note" class="form-input" value="${escapeHtml(c.note || "")}"
        placeholder="Beli 1 gratis 1 burger, berlaku sampai 15 Agustus"
        onchange="ceSaveNote(this.value)"/>
      <p class="text-[11px] text-[#999] mt-2">
        Dipakai di laporan supaya beberapa bulan lagi masih jelas promo apa ini.
      </p>
    </div>

    ${
      p.total > BC_SOFT_CAP_NOTE
        ? `<p class="mt-4 text-xs text-[#C77700] leading-relaxed">
             Daftar ini panjang. Kirim bertahap ya, maksimal &plusmn;20&ndash;30 pesan per hari
             dan beri jeda antar pesan. Nomor WA resto bisa diblokir WhatsApp kalau
             mengirim terlalu banyak pesan serupa sekaligus.
           </p>`
        : ""
    }`;
}

async function ceSaveNote(value) {
  if (!ceCampaign) return;
  const { error } = await supabaseQuery(
    () =>
      db.from("wa_campaigns").update({ note: value.trim() || null }).eq("id", ceCampaign.id),
    "Gagal menyimpan catatan",
  );
  if (!error) {
    ceCampaign.note = value.trim() || null;
    toast("Catatan tersimpan");
  }
}

// ── Pesan ────────────────────────────────────────────────────
// Editable at any point, including mid-campaign. Every send already
// records the exact text that guest received plus the version number,
// so a campaign whose wording changed halfway can still be reported
// truthfully instead of pretending everyone got the final draft.
function ceRenderPesan(c) {
  const sent = ceAudience.filter((r) => r.status === "sent").length;
  const allowed = BC_PLACEHOLDERS.broadcast.map((p) => `{${p}}`).join(" ");

  return `
    <div class="grid md:grid-cols-2 gap-4 items-start">
      <div class="bg-white rounded-2xl border border-[#E7E4DE] p-4">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-medium text-[#333]">Isi pesan</p>
          <span class="text-[11px] text-[#999]">Versi ${c.message_version}</span>
        </div>
        <textarea id="ce-message" rows="10"
          class="w-full text-sm border border-[#E7E4DE] rounded-lg p-3 focus:outline-none focus:border-[color:var(--brand-ink)]"
          oninput="ceDirty.message = true; ceUpdateMessagePreview()">${escapeHtml(c.message_body || "")}</textarea>
        <p class="text-[11px] text-[#999] mt-1">
          Placeholder: <span class="font-mono">${allowed}</span> — tanpa emoji.
          <span class="font-mono">{link}</span> diisi otomatis dari tab Gambar &amp; Link.
        </p>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <button onclick="ceSaveMessage()"
            class="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[color:var(--brand-ink)] hover:bg-[color:var(--brand-deep)]">
            Simpan Pesan
          </button>
          <button onclick="ceResetMessageToTemplate()"
            class="px-4 py-2 rounded-xl text-sm font-medium border border-[#E7E4DE] bg-white text-[#555] hover:bg-[#F8F6F2]">
            Ambil dari template
          </button>
        </div>
        ${
          sent
            ? `<p class="text-[11px] text-[#C77700] mt-3 leading-relaxed">
                 ${sent} orang sudah menerima versi sebelumnya. Kalau pesan ini diubah,
                 laporannya nanti memisahkan hasil tiap versi — jadi tidak apa-apa
                 memperbaiki salah ketik, tapi mengganti isi promo di tengah jalan
                 membuat hasilnya lebih sulit dibaca.
               </p>`
            : ""
        }
      </div>

      <div class="bg-white rounded-2xl border border-[#E7E4DE] p-4">
        <p class="text-sm font-medium text-[#333] mb-2">Preview yang diterima guest</p>
        <div id="ce-message-preview"
          class="text-sm text-[#333] rounded-xl p-3 whitespace-pre-wrap"
          style="background:#E7FFDB;border:1px solid #CFEFC0"></div>
        <p class="text-[11px] text-[#999] mt-2" id="ce-message-meta"></p>
      </div>
    </div>`;
}

// Preview uses a REAL guest off this campaign's list, not a made-up
// "Budi". Staff data is full of names like "Andini 13 Jul 26", and the
// greeting cleanup is exactly the thing worth eyeballing before a blast.
function ceSampleRow() {
  return (
    ceAudience.find((r) => r.status === "pending" && r.waPhone) ||
    ceAudience.find((r) => r.waPhone) ||
    ceAudience[0] ||
    null
  );
}

function ceUpdateMessagePreview() {
  const ta = document.getElementById("ce-message");
  const prev = document.getElementById("ce-message-preview");
  if (!ta || !prev || !ceCampaign) return;
  const row = ceSampleRow();
  const body = campApplyLink(ta.value, cePromoUrl(ceCampaign));
  const text = waRenderTemplate(body, {
    nama: waGreetName(row?.name || ""),
    resto: WA_RESTAURANT_NAME,
    tanggal_terakhir: waFormatDateId(TODAY),
  });
  prev.textContent = text;
  const meta = document.getElementById("ce-message-meta");
  if (meta)
    meta.textContent =
      `${text.length} karakter` +
      (row ? ` · contoh untuk ${waCleanGuestName(row.name) || "guest"}` : "");
}

async function ceSaveMessage() {
  const ta = document.getElementById("ce-message");
  if (!ta || !ceCampaign) return;
  const body = ta.value;

  const err = bcValidateBody("broadcast_campaign", body);
  if (err) {
    toast(err, "error");
    return;
  }
  if (body === ceCampaign.message_body) {
    toast("Tidak ada perubahan");
    ceDirty.message = false;
    return;
  }

  // Only bump the version once anyone has actually received something.
  // Editing a draft ten times should not produce version 11 and a
  // report full of empty version rows.
  const anySent = ceAudience.some((r) => r.send_count > 0);
  const nextVersion = anySent
    ? ceCampaign.message_version + 1
    : ceCampaign.message_version;

  const { error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .update({ message_body: body, message_version: nextVersion })
        .eq("id", ceCampaign.id),
    "Gagal menyimpan pesan",
  );
  if (error) return;

  ceCampaign.message_body = body;
  ceCampaign.message_version = nextVersion;
  ceDirty.message = false;

  // Saving is allowed either way — ops may be mid-edit and about to
  // paste {link} back. But say so loudly here rather than letting them
  // find out at Mulai Kirim, or worse, not at all.
  const linkErr = ceLinkGuard(ceCampaign);
  if (linkErr) {
    toast(linkErr, "error");
  } else {
    toast(
      anySent
        ? `Pesan tersimpan sebagai versi ${nextVersion}`
        : "Pesan tersimpan",
    );
  }
  ceRenderWorkspace();
}

async function ceResetMessageToTemplate() {
  if (!ceCampaign) return;
  if (!confirm("Ganti isi pesan dengan teks template? Perubahan yang belum disimpan akan hilang."))
    return;
  await waLoadTemplates();
  const body =
    waTemplateBody(ceCampaign.template_key) ||
    WA_DEFAULT_TEMPLATES.tag_default.body;
  const ta = document.getElementById("ce-message");
  if (ta) {
    ta.value = body;
    ceDirty.message = true;
    ceUpdateMessagePreview();
  }
}

// ── Gambar & Link ────────────────────────────────────────────
function ceRenderGambar(c) {
  const url = cePromoUrl(c);
  const img = cePromoImageUrl(c);
  const hasLink = (c.message_body || "").includes("{link}");

  return `
    <div class="grid md:grid-cols-2 gap-4 items-start">
      <div class="bg-white rounded-2xl border border-[#E7E4DE] p-4">
        <p class="text-sm font-medium text-[#333] mb-1">Gambar promo</p>
        <p class="text-[11px] text-[#999] mb-3 leading-relaxed">
          Pilih foto apa saja — otomatis dipotong dan dikecilkan ke ukuran kartu
          WhatsApp (1200 &times; 630). Bagian tengah foto yang dipakai, jadi taruh
          objek utamanya di tengah. Tulisan di gambar harus besar: di HP kartunya
          kecil dan terpotong kiri-kanan.
        </p>

        <div class="rounded-xl border border-dashed border-[#D8D3CB] p-4 text-center mb-3"
             style="background:#FAF9F6">
          ${
            img
              ? `<img src="${escapeHtml(img)}" alt="" class="w-full rounded-lg mb-3" style="aspect-ratio:1200/630;object-fit:cover"/>`
              : `<p class="text-xs text-[#999] py-6">Belum ada gambar</p>`
          }
          <input type="file" id="ce-image-file" accept="image/jpeg,image/png,image/webp"
                 class="hidden" onchange="ceUploadImage(this)"/>
          <button onclick="document.getElementById('ce-image-file').click()"
            class="px-4 py-2 rounded-xl text-sm font-medium border border-[#E7E4DE] bg-white text-[#555] hover:bg-[#F8F6F2]">
            ${img ? "Ganti gambar" : "Pilih gambar"}
          </button>
          ${
            img
              ? `<button onclick="ceRemoveImage()" class="ml-2 text-xs text-[#B4523F] hover:underline">Hapus</button>`
              : ""
          }
        </div>

        <label class="block text-xs uppercase tracking-wider text-[#999] mb-1">
          Judul di kartu preview
          ${img ? `<span class="text-[#B4523F] normal-case">— wajib diisi</span>` : ""}
        </label>
        <input id="ce-promo-title" class="form-input mb-1" maxlength="80"
          value="${escapeHtml(c.promo_title || "")}"
          placeholder="Promo Burger Beli 1 Gratis 1"
          oninput="ceDirty.promo = true; ceRenderCardPreview()"/>
        <p class="text-[11px] text-[#999] mb-3 leading-relaxed">
          Tulisan paling besar yang dibaca tamu — lebih besar dari isi pesannya sendiri.
        </p>

        <label class="block text-xs uppercase tracking-wider text-[#999] mb-1">
          Keterangan singkat
          ${img ? `<span class="text-[#B4523F] normal-case">— wajib diisi</span>` : ""}
        </label>
        <input id="ce-promo-desc" class="form-input mb-3" maxlength="140"
          value="${escapeHtml(c.promo_description || "")}"
          placeholder="Berlaku sampai 15 Agustus."
          oninput="ceDirty.promo = true; ceRenderCardPreview()"/>

        ${
          ceCardTextGuard(c)
            ? `<div class="rounded-xl border border-[#E3B7AE] bg-[#FDF3F1] p-3 mb-3">
                 <p class="text-[11px] text-[#8A4436] leading-relaxed">${escapeHtml(ceCardTextGuard(c))}</p>
               </div>`
            : ""
        }

        <label class="block text-xs uppercase tracking-wider text-[#999] mb-1">Kalau gambarnya diketuk, buka</label>
        <select id="ce-promo-dest" class="bc-select text-sm w-full mb-3"
          onchange="ceDirty.promo = true">
          ${[
            [`/reserve?from=${c.slug}`, "Form reservasi (disarankan)"],
            ["/reserve", "Form reservasi tanpa penanda"],
          ]
            .map(
              ([v, label]) =>
                `<option value="${escapeHtml(v)}" ${(c.promo_destination || "") === v ? "selected" : ""}>${label}</option>`,
            )
            .join("")}
        </select>

        <button onclick="ceSavePromo()"
          class="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[color:var(--brand-ink)] hover:bg-[color:var(--brand-deep)]">
          Simpan
        </button>
      </div>

      <div>
        <div class="bg-white rounded-2xl border border-[#E7E4DE] p-4 mb-4">
          <p class="text-sm font-medium text-[#333] mb-2">Kira-kira begini di WhatsApp</p>
          <div class="rounded-xl p-3" style="background:#E7FFDB;border:1px solid #CFEFC0">
            <div id="ce-card-preview" class="rounded-lg overflow-hidden bg-white border border-[#DDE7D6] mb-2"></div>
            <p class="text-xs text-[#333]">…isi pesan…</p>
            <p class="text-[11px] text-[#4A7C59] mt-1 break-all">${escapeHtml(url)}</p>
          </div>
          <p class="text-[11px] text-[#999] mt-2 leading-relaxed">
            Tampilan asli di WhatsApp bisa sedikit berbeda. Yang penting gambarnya
            muncul dan judulnya terbaca.
          </p>
        </div>

        <div class="rounded-2xl p-4" style="background:#F4F8FB;border:1px solid var(--brand-tint)">
          <p class="text-xs text-[color:var(--brand-ink)] font-semibold mb-1">Link campaign ini</p>
          <p class="text-xs text-[#555] break-all mb-2">${escapeHtml(url)}</p>
          <p class="text-[11px] text-[#555] leading-relaxed">
            Link ini milik campaign ini sendiri dan tidak dipakai ulang. Itu penting:
            WhatsApp menyimpan gambar preview per link, jadi kalau satu link dipakai
            untuk dua promo, tamu akan tetap melihat gambar yang lama.
          </p>
          ${
            !hasLink
              ? `<div class="mt-3 rounded-xl border border-[#E3B7AE] bg-[#FDF3F1] p-3">
                   <p class="text-xs font-medium text-[#B4523F] mb-1">
                     Campaign ini belum bisa dikirim
                   </p>
                   <p class="text-[11px] text-[#8A4436] leading-relaxed">
                     Pesannya belum memuat <span class="font-mono">{link}</span>, jadi gambar
                     di atas tidak akan ikut terkirim — tamu hanya menerima teks polos.
                     Tambahkan <span class="font-mono">{link}</span> di tab Pesan dulu.
                   </p>
                   <button onclick="ceSetSection('pesan')"
                     class="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#B4523F] text-white hover:bg-[#9C4636]">
                     Buka tab Pesan
                   </button>
                 </div>`
              : ""
          }
        </div>
      </div>
    </div>`;
}

function ceRenderCardPreview() {
  const el = document.getElementById("ce-card-preview");
  if (!el || !ceCampaign) return;
  const img = cePromoImageUrl(ceCampaign);
  const title =
    document.getElementById("ce-promo-title")?.value || ceCampaign.promo_title || "";
  const desc =
    document.getElementById("ce-promo-desc")?.value || ceCampaign.promo_description || "";
  el.innerHTML = `
    ${
      img
        ? `<img src="${escapeHtml(img)}" alt="" style="width:100%;aspect-ratio:1200/630;object-fit:cover;display:block"/>`
        : `<div style="width:100%;aspect-ratio:1200/630;background:#EFEDE8;display:flex;align-items:center;justify-content:center">
             <span class="text-[11px] text-[#999]">Belum ada gambar</span>
           </div>`
    }
    <div class="p-2">
      <p class="text-xs font-semibold text-[#333] leading-snug">${escapeHtml(title || restaurantName() + " - Promo")}</p>
      <p class="text-[11px] text-[#777] leading-snug mt-0.5">${escapeHtml(desc || "Ada penawaran spesial dari " + restaurantName() + ".")}</p>
      <p class="text-[10px] text-[#999] mt-1">your-site.example</p>
    </div>`;
}

// ============================================================
// PROMO IMAGE PROCESSING
// ------------------------------------------------------------
// WHATSAPP'S RULES, WHICH ARE STRICTER THAN ANYONE EXPECTS
// (Verified 2026-08-01 after a real promo rendered as a tiny
// thumbnail instead of the full-width card.)
//
//   over 600 KB ............ preview degrades or disappears entirely
//   under 100 px ........... no preview at all
//   100-299 px wide ........ small thumbnail beside the link
//   300 px+ and under 600 KB  FULL-WIDTH CARD  <- what we want
//
// The app used to accept anything up to 3 MB. Ops uploaded a 2 MB PNG
// straight off a phone, Storage accepted it, the app previewed it
// happily, and WhatsApp quietly refused to draw the big card. Nothing
// in the system said a word. File size is not something a restaurant
// manager should have to think about, so the browser now fixes it
// instead of complaining about it.
//
// Everything below runs client-side before the upload, so what lands in
// Storage is already guaranteed to satisfy the rules above.
// ============================================================

// What we accept FROM ops. Generous on purpose — anything bigger than
// this is likely a mis-click (a screenshot of a PDF, a RAW export).
const CE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// What we send TO WhatsApp. 1200x630 is the classic 1.91:1 promo card.
const CE_CARD_W = 1200;
const CE_CARD_H = 630;

// Target well under WhatsApp's 600 KB cliff. The margin is deliberate:
// the limit applies to what WhatsApp's crawler downloads, and being
// near the edge is how you get an intermittent, unreproducible bug.
const CE_TARGET_BYTES = 300 * 1024;
const CE_HARD_LIMIT_BYTES = 600 * 1024;

function ceLoadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gambar tidak bisa dibaca"));
    };
    im.src = url;
  });
}

function ceCanvasToBlob(canvas, quality) {
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
}

// Centre-crop to 1200x630 and re-encode as JPEG, stepping the quality
// down until it fits. JPEG rather than PNG because a photo saved as PNG
// is roughly ten times larger for no visible gain — that alone is what
// pushed the original upload to 2 MB.
async function ceProcessPromoImage(file) {
  const im = await ceLoadImageElement(file);
  if (!im.width || !im.height) throw new Error("Gambar tidak bisa dibaca");

  const canvas = document.createElement("canvas");
  canvas.width = CE_CARD_W;
  canvas.height = CE_CARD_H;
  const ctx = canvas.getContext("2d");

  // Fill the frame, crop the overflow, never letterbox. Bars around a
  // promo photo look like a broken image in a chat thread.
  const scale = Math.max(CE_CARD_W / im.width, CE_CARD_H / im.height);
  const dw = im.width * scale;
  const dh = im.height * scale;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, CE_CARD_W, CE_CARD_H);
  ctx.drawImage(im, (CE_CARD_W - dw) / 2, (CE_CARD_H - dh) / 2, dw, dh);

  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const blob = await ceCanvasToBlob(canvas, q);
    if (blob && blob.size <= CE_TARGET_BYTES) return blob;
    // Last resort: still under WhatsApp's real cliff, so ship it rather
    // than block ops over a few kilobytes of visual quality.
    if (q === 0.45 && blob && blob.size <= CE_HARD_LIMIT_BYTES) return blob;
  }
  throw new Error(
    "Gambar ini terlalu rumit untuk dikecilkan. Coba foto lain yang lebih sederhana.",
  );
}

async function ceUploadImage(input) {
  const file = input.files?.[0];
  input.value = ""; // let the same file be picked again after a failure
  if (!file || !ceCampaign) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    toast("Format gambar harus JPG, PNG, atau WebP", "error");
    return;
  }
  if (file.size > CE_MAX_IMAGE_BYTES) {
    toast(
      `Gambar terlalu besar (${Math.round((file.size / 1024 / 1024) * 10) / 10} MB). Maksimal 10 MB.`,
      "error",
    );
    return;
  }

  loader(true);
  try {
    // Always re-encode, even for a file that is already small: it also
    // normalises the dimensions, so og:image:width/height stop lying
    // and every campaign card looks the same shape in the thread.
    const blob = await ceProcessPromoImage(file);

    // Unique filename per upload rather than a fixed name: Storage and
    // any CDN in front of it cache aggressively, and ops replacing an
    // image would otherwise keep seeing the old one.
    const path = `${ceCampaign.slug}/${Date.now()}.jpg`;
    const { error: upErr } = await db.storage
      .from("promo-images")
      .upload(path, blob, {
        cacheControl: "3600",
        upsert: false,
        contentType: "image/jpeg",
      });
    if (upErr) throw upErr;

    const oldPath = ceCampaign.promo_image_path;
    const { error } = await supabaseQuery(
      () =>
        db
          .from("wa_campaigns")
          .update({ promo_image_path: path })
          .eq("id", ceCampaign.id),
      "Gagal menyimpan gambar",
    );
    if (error) return;
    ceCampaign.promo_image_path = path;

    // Best-effort tidy-up; a leftover file is harmless, a crash is not.
    if (oldPath)
      db.storage.from("promo-images").remove([oldPath]).catch(() => {});

    // Uploading the image is the exact moment the mismatch gets
    // created, so it is the cheapest moment to catch it.
    const linkErr = ceLinkGuard(ceCampaign);
    toast(
      linkErr ||
        `Gambar tersimpan (${Math.round(blob.size / 1024)} KB, siap untuk kartu WhatsApp)`,
      linkErr ? "error" : undefined,
    );
    ceRenderWorkspace();
  } catch (e) {
    console.error(e);
    toast(
      e?.message || "Gagal mengunggah gambar. Coba lagi atau pilih foto lain.",
      "error",
    );
  } finally {
    loader(false);
  }
}

async function ceRemoveImage() {
  if (!ceCampaign?.promo_image_path) return;
  if (!confirm("Hapus gambar promo dari campaign ini?")) return;
  const path = ceCampaign.promo_image_path;
  const { error } = await supabaseQuery(
    () =>
      db.from("wa_campaigns").update({ promo_image_path: null }).eq("id", ceCampaign.id),
    "Gagal menghapus gambar",
  );
  if (error) return;
  ceCampaign.promo_image_path = null;
  db.storage.from("promo-images").remove([path]).catch(() => {});
  toast("Gambar dihapus");
  ceRenderWorkspace();
}

async function ceSavePromo() {
  if (!ceCampaign) return;
  const title = document.getElementById("ce-promo-title").value.trim();
  const desc = document.getElementById("ce-promo-desc").value.trim();
  const dest = document.getElementById("ce-promo-dest").value;

  const { error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .update({
          promo_title: title || null,
          promo_description: desc || null,
          promo_destination: dest,
        })
        .eq("id", ceCampaign.id),
    "Gagal menyimpan detail promo",
  );
  if (error) return;
  Object.assign(ceCampaign, {
    promo_title: title || null,
    promo_description: desc || null,
    promo_destination: dest,
  });
  ceDirty.promo = false;
  toast("Detail promo tersimpan");
}

// ============================================================
// PENERIMA — the worklist
// ============================================================
// The row states exist so a human can put the list down and pick it up
// again. Resending is deliberately NOT treated as a mistake: the
// original design warned about repeat sends, which is right for
// accidental double-hits but wrong here, because the commonest reason
// to click twice is that WhatsApp Web ate the first one.

// Redraw only the parts of the recipient list that actually changed.
// Anything that calls ceRenderWorkspace() while the user has the search
// box focused will replace that input and steal the caret, which is the
// bug this exists to prevent. Falls back to a full render if the
// containers are not on screen (another section is open).
function ceRefreshRows() {
  if (!ceCampaign) return;
  const rowsEl = document.getElementById("ce-rows-body");
  if (!rowsEl) {
    ceRenderWorkspace();
    return;
  }
  const p = ceProgress(ceAudience);
  rowsEl.innerHTML = ceRenderRowsBody(ceCampaign);

  const chipsEl = document.getElementById("ce-row-chips");
  if (chipsEl) chipsEl.innerHTML = ceRenderRowChips(p);

  // Sending or skipping the last pending row can unlock "Tandai Selesai"
  // in the header, so the buttons have to follow the counts.
  const actEl = document.getElementById("ce-action-buttons");
  if (actEl) actEl.innerHTML = ceActionButtons(ceCampaign, p);
}

function ceSetRowFilter(f) {
  ceRowFilter = f;
  cePage = 1;
  ceRefreshRows();
}

function ceSetRowSearch(q) {
  ceSearch = q;
  cePage = 1;
  ceRefreshRows();
}

// High first in "desc". Anything unrecognised sorts with the no-spend rows
// rather than jumping to the top, so a future third tier cannot silently
// outrank High Spender.
function ceSpendRank(tier) {
  if (tier === "high_spender") return 0;
  if (tier === "medium_spender") return 1;
  return 2;
}

// Off → High first → None first → off. The third click restores the send
// order (pending at the top), which is what ops works down day to day.
function ceToggleSpendSort() {
  ceSpendSort =
    ceSpendSort === null ? "desc" : ceSpendSort === "desc" ? "asc" : null;
  cePage = 1;
  ceRefreshRows();
}

// Off → longest ago first → most recent first → off. The first click is
// the at-risk direction because that is what ops opens this list to find.
function ceToggleVisitSort() {
  ceVisitSort =
    ceVisitSort === null ? "asc" : ceVisitSort === "asc" ? "desc" : null;
  cePage = 1;
  ceRefreshRows();
}

function ceSetPage(p) {
  const rows = ceVisibleRows();
  const total = Math.max(1, Math.ceil(rows.length / CE_PAGE_SIZE));
  cePage = Math.min(Math.max(1, p), total);
  ceRefreshRows();
}

function ceVisibleRows() {
  const q = ceSearch.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return ceAudience
    .filter((r) => {
      if (ceRowFilter !== "all" && r.status !== ceRowFilter) return false;
      if (!q) return true;
      if (
        (r.name || "").toLowerCase().includes(q) ||
        waCleanGuestName(r.name).toLowerCase().includes(q)
      )
        return true;
      if (qDigits.length >= 3) {
        if ((r.phone || "").replace(/\D/g, "").includes(qDigits)) return true;
        if (r.waPhone && r.waPhone.includes(qDigits)) return true;
      }
      return false;
    })
    .sort((a, b) => {
      // Spending sort, when the header is toggled on, outranks everything:
      // ops asked for it precisely to pull the big spenders to the top of a
      // segment that was not built on spending in the first place.
      if (ceSpendSort) {
        const s = ceSpendRank(a.tier) - ceSpendRank(b.tier);
        if (s) return ceSpendSort === "desc" ? s : -s;
      }
      // Visit sort runs UNDER the spending sort on purpose, so the two can
      // be on together: tier groups the list, recency orders each group.
      // That is the "which Medium Spenders have not been in for ages" view.
      if (ceVisitSort) {
        // Never-visited rows have no date to compare, so they sit at the
        // bottom in both directions rather than being guessed into the
        // "longest ago" end of the list.
        const an = !a.lastVisit,
          bn = !b.lastVisit;
        if (an !== bn) return an ? 1 : -1;
        if (!an) {
          const v = a.lastVisit < b.lastVisit ? -1 : a.lastVisit > b.lastVisit ? 1 : 0;
          if (v) return ceVisitSort === "asc" ? v : -v;
        }
      }
      // Pending first: the list should shrink towards done as ops works
      // down it, so the next thing to do is always at the top.
      const rank = { pending: 0, sent: 1, done: 2, skipped: 3 };
      const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (d) return d;
      return waCleanGuestName(a.name).localeCompare(
        waCleanGuestName(b.name),
        "id",
        { sensitivity: "base" },
      );
    });
}

// ── Recipient list ───────────────────────────────────────────
// SPLIT INTO THREE PIECES ON PURPOSE (2026-08-01, focus bug).
// Typing one letter in the search box used to blow away the whole
// workspace via innerHTML, which destroyed the <input> the user was
// typing into and threw away focus and caret — so every character
// needed a fresh click. The search input now lives in its own block
// that is never re-rendered while the user is typing; only the chips
// and the rows below are redrawn. Do not merge these back together.
//
//   ce-row-chips  — filter buttons, redrawn when the filter changes
//   ce-row-search — the input, rendered ONCE per section mount
//   ce-rows-body  — table + pagination, redrawn on every keystroke

function ceRenderRowChips(p) {
  const chip = (key, label, count) => {
    const on = ceRowFilter === key;
    return `<button onclick="ceSetRowFilter('${key}')"
      class="px-3 py-1.5 rounded-full text-xs font-medium border transition ${
        on
          ? "bg-[color:var(--brand-ink)] text-white border-[color:var(--brand-ink)]"
          : "bg-white text-[#555] border-[#E6E2DC] hover:bg-[#F8F6F2]"
      }">${label} ${count}</button>`;
  };
  return (
    chip("all", "Semua", p.total) +
    chip("pending", "Belum dikirim", p.pending) +
    chip("sent", "Terkirim", p.sent) +
    chip("skipped", "Dilewati", p.skipped) +
    chip("done", "Selesai", p.done)
  );
}

// "14 Agu 2026" with the gap underneath, since on an At Risk campaign the
// number of days is the thing ops is actually reading the date for.
function ceLastVisitCell(iso) {
  if (!iso) return `<span class="text-sm text-[#999]">Belum pernah</span>`;

  // Compare CALENDAR DAYS in local time, not raw instants.
  //
  // The old version did Math.round((Date.now() - new Date(iso)) / 86400000).
  // new Date("2026-08-22") parses as UTC midnight, which is 07:00 in Jakarta,
  // so from 19:00 local onward the gap passed 12 hours and rounded up: a guest
  // who ate here TODAY was shown as "1 hari lalu" for the busiest hours of
  // every service. Off by one, every evening, on the screen staff use to pick
  // who to message.
  //
  // Both sides are now local midnight, so the subtraction is a whole number of
  // days and rounding cannot tip it.
  const parts = String(iso).slice(0, 10).split("-").map(Number);
  const then = new Date(parts[0], parts[1] - 1, parts[2]);
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.max(0, Math.round((today - then) / 86400000));
  return `<p class="text-sm text-[#555]">${campFmtDate(iso)}</p>
    <p class="text-[11px] text-[#999]">${days === 0 ? "hari ini" : `${days} hari lalu`}</p>`;
}

function ceRenderRowsBody(c) {
  const rows = ceVisibleRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / CE_PAGE_SIZE));
  if (cePage > totalPages) cePage = totalPages;
  const pageRows = rows.slice((cePage - 1) * CE_PAGE_SIZE, cePage * CE_PAGE_SIZE);

  const draft = c.status === "draft";

  const body = pageRows
    .map((r) => {
      const canSend = !!r.waPhone && !r.do_not_contact && !draft;
      const label = r.send_count > 0 ? "Kirim Lagi" : "Kirim WA";
      return `<tr class="border-b border-[#F0EDE7] ${r.status === "skipped" ? "opacity-60" : ""}">
        <td class="px-4 py-3">
          <p class="text-sm font-medium text-[#333]">${escapeHtml(waCleanGuestName(r.name) || r.name || "-")}</p>
          <p class="text-xs text-[#999]">${escapeHtml(r.phone || "tanpa nomor")}</p>
          <div class="sm:hidden mt-1">${formatSpendingTierBadge(r.tier)}</div>
          <p class="text-[11px] text-[#999] md:hidden mt-0.5">
            Kunjungan terakhir: ${r.lastVisit ? campFmtDate(r.lastVisit) : "belum pernah"}
          </p>
          ${
            r.skip_reason
              ? `<p class="text-[11px] text-[#B4523F] mt-0.5">${escapeHtml(r.skip_reason)}</p>`
              : ""
          }
        </td>
        <td class="px-4 py-3 hidden sm:table-cell">
          ${formatSpendingTierBadge(r.tier)}
        </td>
        <td class="px-4 py-3 hidden md:table-cell whitespace-nowrap">
          ${ceLastVisitCell(r.lastVisit)}
        </td>
        <td class="px-4 py-3 hidden sm:table-cell">
          ${ceStatusPill(r.status, r.send_count)}
          ${
            r.last_sent_at
              ? `<p class="text-[11px] text-[#999] mt-1">${campFmtDate(r.last_sent_at)}</p>`
              : ""
          }
        </td>
        <td class="px-4 py-3 text-right whitespace-nowrap">
          ${
            canSend
              ? `<button onclick="ceSend('${r.guest_id}')"
                   class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${
                     r.send_count > 0
                       ? "bg-[#7FA8C9] hover:bg-[#6A94B7]"
                       : "bg-[#1FAF5E] hover:bg-[#178C4B]"
                   }">${label}</button>`
              : draft
                ? `<span class="text-xs text-[#999]">Mulai kirim dulu</span>`
                : `<span class="text-xs text-[#B4523F]">Tidak bisa dikirim</span>`
          }
          <button onclick="ceRowMenu('${r.guest_id}')"
            class="ml-2 text-xs text-[color:var(--brand-ink)] hover:underline">Ubah</button>
        </td>
      </tr>`;
    })
    .join("");

  return `
    ${
      ceSpendSort && ceVisitSort
        ? `<p class="text-[11px] text-[#999] mb-1.5 hidden md:block">
             Diurutkan per kelompok belanja dulu, lalu ${ceVisitSort === "asc" ? "paling lama tidak berkunjung" : "kunjungan terbaru"} di dalam tiap kelompok.
           </p>`
        : ""
    }
    <div class="bg-white rounded-2xl border border-[#E7E4DE] overflow-x-auto">
      ${
        rows.length
          ? `<table class="w-full">
               <thead><tr class="text-left text-[11px] uppercase tracking-wider text-[#999] border-b border-[#E7E4DE]">
                 <th class="px-4 py-2.5">Guest</th>
                 <th class="px-4 py-2.5 hidden sm:table-cell">
                   <button onclick="ceToggleSpendSort()"
                     title="${ceSpendSort === "desc" ? "High Spender di atas" : ceSpendSort === "asc" ? "Tanpa belanja di atas" : "Urutkan berdasarkan belanja"}"
                     class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[color:var(--brand-ink)] ${ceSpendSort ? "text-[color:var(--brand-ink)]" : ""}">
                     Spending
                     <span aria-hidden="true">${ceSpendSort === "desc" ? "&darr;" : ceSpendSort === "asc" ? "&uarr;" : "&#8597;"}</span>
                   </button>
                 </th>
                 <th class="px-4 py-2.5 hidden md:table-cell">
                   <button onclick="ceToggleVisitSort()"
                     title="${ceVisitSort === "asc" ? "Paling lama tidak berkunjung di atas" : ceVisitSort === "desc" ? "Kunjungan terbaru di atas" : "Urutkan berdasarkan kunjungan terakhir"}"
                     class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[color:var(--brand-ink)] ${ceVisitSort ? "text-[color:var(--brand-ink)]" : ""}">
                     Last Visit
                     <span aria-hidden="true">${ceVisitSort === "asc" ? "&uarr;" : ceVisitSort === "desc" ? "&darr;" : "&#8597;"}</span>
                   </button>
                 </th>
                 <th class="px-4 py-2.5 hidden sm:table-cell">Status</th>
                 <th class="px-4 py-2.5"></th>
               </tr></thead>
               <tbody>${body}</tbody>
             </table>
             ${
               totalPages > 1
                 ? `<div class="flex items-center justify-between px-4 py-3 border-t border-[#E7E4DE]">
                      <button onclick="ceSetPage(${cePage - 1})" ${cePage <= 1 ? "disabled" : ""}
                        class="text-xs px-3 py-1.5 rounded-lg border border-[#E7E4DE] ${cePage <= 1 ? "text-[#CCC]" : "text-[#555] hover:bg-[#F8F6F2]"}">&larr; Sebelumnya</button>
                      <span class="text-xs text-[#999]">Halaman ${cePage} dari ${totalPages} &middot; ${rows.length} orang</span>
                      <button onclick="ceSetPage(${cePage + 1})" ${cePage >= totalPages ? "disabled" : ""}
                        class="text-xs px-3 py-1.5 rounded-lg border border-[#E7E4DE] ${cePage >= totalPages ? "text-[#CCC]" : "text-[#555] hover:bg-[#F8F6F2]"}">Berikutnya &rarr;</button>
                    </div>`
                 : ""
             }`
          : `<div class="p-8 text-center text-sm text-[#999]">
               ${
                 ceSearch.trim()
                   ? `Tidak ada yang cocok dengan &quot;${escapeHtml(ceSearch.trim())}&quot;.`
                   : "Tidak ada yang cocok dengan filter ini."
               }
             </div>`
      }
    </div>`;
}

function ceRenderPenerima(c, p) {
  const draft = c.status === "draft";
  return `
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <div id="ce-row-chips" class="flex flex-wrap items-center gap-2">
        ${ceRenderRowChips(p)}
      </div>
      <input type="search" id="ce-row-search" value="${escapeHtml(ceSearch)}"
        oninput="ceSetRowSearch(this.value)"
        placeholder="Cari nama / nomor..."
        autocomplete="off"
        class="text-sm border border-[#E7E4DE] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-[color:var(--brand-ink)] ml-auto min-w-[180px]"/>
    </div>

    ${
      draft
        ? `<div class="rounded-xl p-3 mb-3 text-xs leading-relaxed"
                style="background:#FFF8EC;border:1px solid var(--accent-tint2)">
             Campaign ini masih draft. Cek dulu pesan dan gambarnya, lalu tekan
             <strong>Mulai Kirim</strong> di atas untuk mengaktifkan tombol kirim.
           </div>`
        : ""
    }

    <div id="ce-rows-body">${ceRenderRowsBody(c)}</div>`;
}

// ── Row actions ──────────────────────────────────────────────
let ceMenuGuestId = null;

function ceRowMenu(guestId) {
  const r = ceAudience.find((x) => x.guest_id === guestId);
  if (!r) return;
  ceMenuGuestId = guestId;
  document.getElementById("ce-row-name").textContent =
    waCleanGuestName(r.name) || r.name || "-";
  document.getElementById("ce-row-status").innerHTML = ceStatusPill(
    r.status,
    r.send_count,
  );
  document.getElementById("ce-row-skip-reason").value = r.skip_reason || "";
  showModal("ce-row-modal");
}

async function ceSetRowStatus(status) {
  const r = ceAudience.find((x) => x.guest_id === ceMenuGuestId);
  if (!r || !ceCampaign) return;
  const reason =
    status === "skipped"
      ? document.getElementById("ce-row-skip-reason").value.trim() || null
      : null;

  const { error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaign_audience")
        .update({ status, skip_reason: reason, updated_at: new Date().toISOString() })
        .eq("campaign_id", ceCampaign.id)
        .eq("guest_id", r.guest_id),
    "Gagal mengubah status",
  );
  if (error) return;
  r.status = status;
  r.skip_reason = reason;
  hideModal("ce-row-modal");
  toast(
    status === "skipped"
      ? "Dilewati — orang ini masuk kelompok pembanding di laporan"
      : status === "done"
        ? "Ditandai selesai"
        : "Dikembalikan ke belum dikirim",
  );
  // Partial refresh: ops is usually mid-search when they do this, and a
  // full re-render would wipe the search box and jump them to the top.
  ceRefreshRows();
}

// ── Send ─────────────────────────────────────────────────────
async function ceSend(guestId) {
  if (!ceCampaign || ceCampaign.status !== "active") {
    toast("Tekan Mulai Kirim dulu untuk mengaktifkan campaign ini", "error");
    return;
  }
  const row = ceAudience.find((x) => x.guest_id === guestId);
  if (!row) return;

  const body = ceCampaign.message_body || "";

  // Re-checked per send, not just at activation: the message can be
  // edited and an image can be uploaded while the campaign is already
  // running, so passing the gate once does not keep it passed.
  const linkErr = ceLinkGuard(ceCampaign);
  if (linkErr) {
    toast(linkErr, "error");
    ceSetSection("pesan");
    return;
  }

  const cardErr = ceCardTextGuard(ceCampaign);
  if (cardErr) {
    toast(cardErr, "error");
    ceSetSection("gambar");
    return;
  }

  if (body.includes("[ganti")) {
    if (
      !confirm(
        'Pesan campaign ini masih berisi teks contoh "[ganti dengan isi promo]" yang belum diganti. Tetap kirim?',
      )
    )
      return;
  }

  // Fresh read: phone or opt-out may have changed since the list loaded.
  const { data: g, error } = await supabaseQuery(
    () =>
      db
        .from("guests")
        .select("id, name, phone, do_not_contact")
        .eq("id", guestId)
        .single(),
    "Gagal memuat data guest",
  );
  if (error || !g) return;

  if (g.do_not_contact) {
    toast("Guest ini memilih tidak menerima promosi — pesan tidak dikirim", "error");
    row.status = "skipped";
    row.skip_reason = "Menolak promosi";
    await db
      .from("wa_campaign_audience")
      .update({ status: "skipped", skip_reason: "Menolak promosi" })
      .eq("campaign_id", ceCampaign.id)
      .eq("guest_id", guestId);
    ceRefreshRows();
    return;
  }

  const message = waRenderTemplate(campApplyLink(body, cePromoUrl(ceCampaign)), {
    nama: waGreetName(g.name),
    resto: WA_RESTAURANT_NAME,
    tanggal_terakhir: waFormatDateId(TODAY),
  });

  if (!waOpenChat(g.phone, message)) return;

  const now = new Date().toISOString();
  waLogSend(g.id, ceCampaign.template_key, true, {
    campaign_id: ceCampaign.id,
    message_body: message,
    message_version: ceCampaign.message_version,
  });

  row.send_count = (row.send_count || 0) + 1;
  row.status = "sent";
  row.last_sent_at = now;
  await db
    .from("wa_campaign_audience")
    .update({
      status: "sent",
      send_count: row.send_count,
      last_sent_at: now,
      updated_at: now,
    })
    .eq("campaign_id", ceCampaign.id)
    .eq("guest_id", guestId);

  ceRefreshRows();
}

// ── Lifecycle ────────────────────────────────────────────────

// The image-without-{link} check, kept separate from ceActivate so it
// can be unit tested and reused wherever a send can be started.
//
// WHY THIS IS A HARD BLOCK AND THE REVERSE IS ONLY A WARNING
// (2026-08-01, after three real campaigns went out linkless.) An image
// with no {link} is a silent, total failure: ops uploads a picture,
// writes a caption, sees a preview card in the app, presses send — and
// the guest receives plain text. Nothing in the sent message hints that
// anything was lost. The opposite case, {link} with no image, still
// delivers a working link and is merely less pretty, so it stays a
// confirm. A broadcast cannot be recalled, so the expensive mistake
// gets the stricter gate.
//
// Returns null when it is safe to start, or the reason to show ops.
function ceLinkGuard(c) {
  const body = (c?.message_body || "").trim();
  if (!body) return null; // the empty-body check owns this case
  if (!c?.promo_image_path) return null; // no image, nothing to lose
  if (body.includes("{link}")) return null;
  return (
    "Campaign ini punya gambar promo, tapi pesannya belum memuat {link}. " +
    "Tanpa {link} gambarnya TIDAK ikut terkirim — tamu hanya menerima teks. " +
    "Tambahkan {link} di tab Pesan dulu ya."
  );
}

// The title and description printed on the WhatsApp preview card.
//
// WHY THIS IS REQUIRED RATHER THAN OPTIONAL (2026-08-01)
// The first five real test campaigns all went out with both fields
// empty, so every card fell back to "<restaurant> - Promo / Ada
// penawaran spesial" — wording that says nothing and repeats on
// every promo. On the large card (which is what a guest on a phone
// sees) the title is the biggest text in the message, bigger than the
// message body itself. A fallback that generic is worse than no
// campaign at all, because it teaches guests the card is boilerplate.
//
// Only enforced when there is an image, matching ceLinkGuard: no
// image means no card, and no card means nothing to title.
function ceCardTextGuard(c) {
  if (!c?.promo_image_path) return null;
  if (!(c.promo_title || "").trim())
    return (
      "Judul kartu promo masih kosong, jadi tamu akan melihat tulisan umum " +
      'judul default. Isi judulnya di tab Gambar & Link dulu ya, ' +
      "itu tulisan paling besar yang dibaca tamu."
    );
  if (!(c.promo_description || "").trim())
    return (
      "Keterangan singkat kartu promo masih kosong. Isi di tab Gambar & Link " +
      "supaya tamu tahu isi promonya sebelum menekan link."
    );
  return null;
}

async function ceActivate() {
  if (!ceCampaign) return;
  const body = ceCampaign.message_body || "";
  if (!body.trim()) {
    toast("Isi pesannya dulu di tab Pesan", "error");
    ceSetSection("pesan");
    return;
  }

  // Hard stop. No confirm() escape hatch: see ceLinkGuard above.
  const linkErr = ceLinkGuard(ceCampaign);
  if (linkErr) {
    toast(linkErr, "error");
    ceSetSection("pesan");
    return;
  }

  // Same treatment for the card wording, and for the same reason: it
  // is invisible in the app but the first thing the guest reads.
  const cardErr = ceCardTextGuard(ceCampaign);
  if (cardErr) {
    toast(cardErr, "error");
    ceSetSection("gambar");
    return;
  }

  if (body.includes("{link}") && !ceCampaign.promo_image_path) {
    if (
      !confirm(
        "Pesan memuat {link} tapi belum ada gambar promo. Tamu akan menerima link tanpa gambar. Tetap mulai?",
      )
    )
      return;
  }

  // Only one campaign may send at a time; close whatever else is open
  // rather than failing on the unique index and confusing ops.
  const { data: others } = await db
    .from("wa_campaigns")
    .select("id, name")
    .eq("status", "active");
  if (others && others.length) {
    if (
      !confirm(
        `Campaign "${others[0].name}" sedang berjalan. Selesaikan yang itu dan mulai campaign ini?`,
      )
    )
      return;
    await db
      .from("wa_campaigns")
      .update({ status: "done", ended_at: new Date().toISOString() })
      .eq("status", "active");
  }

  const { error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .update({ status: "active", started_at: new Date().toISOString() })
        .eq("id", ceCampaign.id),
    "Gagal memulai campaign",
  );
  if (error) return;
  ceCampaign.status = "active";
  toast("Campaign aktif — tombol Kirim WA sudah bisa dipakai");
  ceSetSection("penerima");
}

async function ceFinish() {
  if (!ceCampaign) return;
  const p = ceProgress(ceAudience);
  if (
    !confirm(
      p.pending
        ? `Masih ada ${p.pending} orang yang belum dikirimi. Selesaikan campaign ini sekarang?`
        : "Selesaikan campaign ini?",
    )
  )
    return;
  const { error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .update({ status: "done", ended_at: new Date().toISOString() })
        .eq("id", ceCampaign.id),
    "Gagal menyelesaikan campaign",
  );
  if (error) return;
  ceCampaign.status = "done";
  campLoaded = false; // results tab must recompute
  toast("Campaign selesai — hasilnya muncul di tab Hasil Campaign");
  ceRenderWorkspace();
}

async function ceReopen() {
  if (!ceCampaign) return;
  const { data: others } = await db
    .from("wa_campaigns")
    .select("id")
    .eq("status", "active");
  if (others && others.length) {
    toast("Selesaikan dulu campaign yang sedang berjalan", "error");
    return;
  }
  const { error } = await supabaseQuery(
    () =>
      db
        .from("wa_campaigns")
        .update({ status: "active", ended_at: null })
        .eq("id", ceCampaign.id),
    "Gagal membuka campaign",
  );
  if (error) return;
  ceCampaign.status = "active";
  campLoaded = false;
  toast("Campaign dibuka lagi");
  ceRenderWorkspace();
}

async function ceDelete() {
  if (!ceCampaign) return;
  const sent = ceAudience.reduce((n, r) => n + (r.send_count || 0), 0);
  if (sent) {
    toast(
      "Campaign yang sudah pernah mengirim pesan tidak bisa dihapus — selesaikan saja",
      "error",
    );
    return;
  }
  if (!confirm(`Hapus campaign "${ceCampaign.name}"? Tidak bisa dibatalkan.`)) return;
  const { error } = await supabaseQuery(
    () => db.from("wa_campaigns").delete().eq("id", ceCampaign.id),
    "Gagal menghapus campaign",
  );
  if (error) return;
  if (ceCampaign.promo_image_path)
    db.storage.from("promo-images").remove([ceCampaign.promo_image_path]).catch(() => {});
  toast("Campaign dihapus");
  ceCampaign = null;
  ceAudience = [];
  document.getElementById("ce-view-workspace").classList.add("hidden");
  document.getElementById("ce-view-list").classList.remove("hidden");
  ceLoadList();
}
