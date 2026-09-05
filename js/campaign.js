// ============================================================
// BROADCAST CAMPAIGNS — sending in named batches, and measuring
// whether those batches actually brought anyone back.
// Migration: migrations/20260801_broadcast_campaigns.sql
// ============================================================
//
// THE QUESTION THIS ANSWERS
// -------------------------
// "We blasted a burger promo to medium spenders and a steak promo
//  to high spenders. How many of them came back, and was it worth
//  doing again?"
//
// THE TRAP THIS AVOIDS
// --------------------
// The naive report says "48% of guests we messaged came back!" and
// marketing books another blast. But high spenders come back at
// roughly that rate whether or not anyone messages them. The number
// is real and completely uninformative.
//
// So every campaign freezes its full eligible audience at start —
// every guest who matched the filter, sent or not. The ones never
// sent become the comparison group: same segment, same fortnight,
// same restaurant, no message. The gap between the two is the only
// number worth acting on.
//
// This is NOT a randomised trial. Front Desk picks who to message
// from a sorted list, so the two groups differ in ways beyond the
// message (usually: the top of the list gets contacted first). The
// report says so out loud rather than pretending otherwise.
// ============================================================

// Days after a send during which a visit still counts as "they came
// back because of it". 14 = Rere's call, 2026-08-01. Long enough for
// a weekend-only diner to act, short enough that we are not claiming
// credit for a visit three weeks later that was going to happen anyway.
const CAMP_ATTRIBUTION_DAYS = 14;

// Below this many recipients, no statistical test is worth running —
// the report says "too early to tell" instead of showing a percentage
// that swings 10 points when one more person walks in.
const CAMP_MIN_SAMPLE = 15;

let campList = []; // campaigns for the Hasil tab
let campResults = {}; // campaign_id -> computed result
let campLoaded = false;
let campExpanded = {}; // campaign_id -> bool (returner detail open)
let campGuestNames = {}; // guest_id -> name, for the returner table

// ============================================================
// PURE ATTRIBUTION MATH (no DOM, no network — unit-tested in
// campaign.test.js. Keep it that way.)
// ============================================================

// "YYYY-MM-DD" of a timestamp, in the browser's local (Jakarta) time.
// Deliberately routed through ymd() — see the warning on ymd() in
// config.js about toISOString() silently shifting the date back a day.
function campDay(ts) {
  return ymd(new Date(ts));
}

function campAddDays(dayStr, n) {
  const d = new Date(dayStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function campDaysBetween(fromDay, toDay) {
  return Math.round(
    (new Date(toDay + "T00:00:00") - new Date(fromDay + "T00:00:00")) / 864e5,
  );
}

// Median send day of a campaign. Control guests were never sent
// anything, so they need a stand-in date to measure their own 14 days
// from — otherwise we would compare the recipients' 14 days against
// the control group's entire campaign-length window, handing the
// control group extra time to wander back in and quietly making every
// broadcast look useless.
function campMedianDay(days) {
  if (!days.length) return null;
  const s = [...days].sort();
  return s[Math.floor((s.length - 1) / 2)];
}

// A visit counts if it happened AFTER the send day and within the
// window. Same-day visits are excluded on purpose: staff often fire a
// thank-you-adjacent blast while a guest is sitting in the restaurant,
// and counting that as "the message brought them in" is how a report
// starts lying to the person reading it.
function campVisitsInWindow(visits, anchorDay, days) {
  const start = anchorDay;
  const end = campAddDays(anchorDay, days);
  return (visits || []).filter((v) => v.date > start && v.date <= end);
}

// Was this guest hit by a DIFFERENT broadcast close enough to muddy
// the result? Applies to control guests (a "not messaged" guest who
// got last week's other blast is not a clean comparison) and is
// reported, not silently dropped, so the counts still reconcile.
function campContaminated(otherBroadcastDays, anchorDay, days) {
  const lo = campAddDays(anchorDay, -days);
  const hi = campAddDays(anchorDay, days);
  return (otherBroadcastDays || []).some((d) => d > lo && d <= hi);
}

// Two-proportion z-test. Not to prove anything publishable — just to
// stop the UI from announcing a 12-point "win" that rests on three
// people. Returns null when either group is too small to bother.
function campZScore(x1, n1, x2, n2) {
  if (!n1 || !n2) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  if (p === 0 || p === 1) return null;
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return null;
  return (p1 - p2) / se;
}

/**
 * The whole report for one campaign.
 *
 * @param campaign {id, started_at, ended_at, ...}
 * @param audience [{guest_id, has_wa}]           snapshot at campaign start
 * @param sends    [{guest_id, sent_at}]          this campaign's sends only
 * @param visitsByGuest  {guest_id: [{date, spend, notes, pax}]}  non-voided
 * @param otherBcByGuest {guest_id: ["YYYY-MM-DD"]} broadcast days from OTHER campaigns
 * @param todayDay "YYYY-MM-DD"
 */
function campComputeResult(
  campaign,
  audience,
  sends,
  visitsByGuest,
  otherBcByGuest,
  todayDay,
) {
  // ── Recipients: earliest send per guest ──
  // A guest messaged twice in one campaign (staff resent after a
  // typo, or the guest was in two filtered pages) is ONE recipient,
  // anchored to the first contact. Counting them twice would inflate
  // the denominator and understate the campaign.
  const firstSend = {};
  (sends || []).forEach((s) => {
    const d = campDay(s.sent_at);
    if (!firstSend[s.guest_id] || d < firstSend[s.guest_id])
      firstSend[s.guest_id] = d;
  });
  const recipientIds = Object.keys(firstSend);

  const treated = [];
  let treatedRevenue = 0;
  const returners = [];

  recipientIds.forEach((gid) => {
    const anchor = firstSend[gid];
    const won = campVisitsInWindow(
      visitsByGuest[gid],
      anchor,
      CAMP_ATTRIBUTION_DAYS,
    );
    const spend = won.reduce((a, v) => a + (v.spend || 0), 0);
    const returned = won.length > 0;
    if (returned) {
      treatedRevenue += spend;
      returners.push({ guest_id: gid, sentDay: anchor, visits: won, spend });
    }
    treated.push({ guest_id: gid, sentDay: anchor, returned, spend });
  });

  const medianDay = campMedianDay(Object.values(firstSend));

  // ── Control: matched the filter, was reachable, never got messaged ──
  const sentSet = new Set(recipientIds);
  const control = [];
  let controlSkippedContaminated = 0;
  let controlSkippedNoWa = 0;

  (audience || []).forEach((a) => {
    if (sentSet.has(a.guest_id)) return;
    if (!a.has_wa) {
      // Unreachable at campaign time. Excluding them keeps the
      // comparison like-for-like: both groups could have been
      // contacted, only one was.
      controlSkippedNoWa++;
      return;
    }
    if (!medianDay) return;
    if (
      campContaminated(
        otherBcByGuest[a.guest_id],
        medianDay,
        CAMP_ATTRIBUTION_DAYS,
      )
    ) {
      controlSkippedContaminated++;
      return;
    }
    const won = campVisitsInWindow(
      visitsByGuest[a.guest_id],
      medianDay,
      CAMP_ATTRIBUTION_DAYS,
    );
    control.push({
      guest_id: a.guest_id,
      returned: won.length > 0,
      spend: won.reduce((s, v) => s + (v.spend || 0), 0),
    });
  });

  const n1 = treated.length;
  const x1 = treated.filter((t) => t.returned).length;
  const n2 = control.length;
  const x2 = control.filter((c) => c.returned).length;

  const rateTreated = n1 ? x1 / n1 : null;
  const rateControl = n2 ? x2 / n2 : null;
  const lift =
    rateTreated !== null && rateControl !== null
      ? rateTreated - rateControl
      : null;

  // ── Maturity ──
  // The last person messaged also gets 14 days. Until then the
  // campaign is still accruing and every number is provisional.
  const lastSendDay = recipientIds.length
    ? recipientIds.map((g) => firstSend[g]).sort().slice(-1)[0]
    : null;
  const matureOn = lastSendDay
    ? campAddDays(lastSendDay, CAMP_ATTRIBUTION_DAYS)
    : null;
  const mature = matureOn ? todayDay >= matureOn : false;
  const daysLeft = matureOn ? Math.max(0, campDaysBetween(todayDay, matureOn)) : null;

  // ── Message versions ──
  // A campaign whose wording changed mid-flight is really two campaigns
  // wearing one name. Rather than hide that, break the recipients down
  // by the version they actually received and report each separately.
  // Version comes off the send row, never off the campaign, because the
  // campaign only remembers its latest draft.
  const versionOf = {};
  (sends || []).forEach((s) => {
    const d = campDay(s.sent_at);
    const v = s.message_version || 1;
    // Match the recipient anchor: the version of their FIRST send.
    if (!versionOf[s.guest_id] || d < versionOf[s.guest_id].day)
      versionOf[s.guest_id] = { day: d, version: v };
  });
  const versionAgg = {};
  treated.forEach((t) => {
    const v = versionOf[t.guest_id]?.version || 1;
    const a = (versionAgg[v] = versionAgg[v] || { version: v, n: 0, x: 0, revenue: 0 });
    a.n++;
    if (t.returned) {
      a.x++;
      a.revenue += t.spend;
    }
  });
  const versions = Object.values(versionAgg).sort((a, b) => a.version - b.version);
  versions.forEach((v) => (v.rate = v.n ? v.x / v.n : null));

  const z = campZScore(x1, n1, x2, n2);
  const significant = z !== null && Math.abs(z) >= 1.96;
  const tooSmall = n1 < CAMP_MIN_SAMPLE || n2 < CAMP_MIN_SAMPLE;

  // ── Money ──
  // avgPerReturner is what the extra visits were actually worth.
  // incrementalRevenue is the honest headline: only the returners we
  // would NOT have got anyway. It can go negative, and when it does
  // the report shows it rather than clamping to zero — a campaign
  // that underperforms its own control group is exactly the finding
  // marketing needs.
  const avgPerReturner = x1 ? treatedRevenue / x1 : 0;
  const extraReturners = lift !== null ? lift * n1 : null;
  const incrementalRevenue =
    extraReturners !== null ? extraReturners * avgPerReturner : null;

  return {
    campaign,
    n1,
    x1,
    n2,
    x2,
    rateTreated,
    rateControl,
    lift,
    z,
    significant,
    tooSmall,
    mature,
    daysLeft,
    matureOn,
    medianDay,
    lastSendDay,
    audienceTotal: (audience || []).length,
    controlSkippedNoWa,
    controlSkippedContaminated,
    versions,
    treatedRevenue,
    avgPerReturner,
    extraReturners,
    incrementalRevenue,
    returners: returners.sort((a, b) => b.spend - a.spend),
  };
}

// ============================================================
// PROMO LINK ({link} placeholder)
// ============================================================
// wa.me cannot attach an image. What WhatsApp will do is fetch a URL
// found in the message and draw a preview card using that page's og:
// tags — so a promo picture reaches the guest as a link preview.
// See promo/README.md; the pages live in promo/ as plain static files
// because WhatsApp's crawler does not run JavaScript.

// Accept only our own promo pages. A typo'd or foreign URL in a
// broadcast is worse than no image: it either 404s in front of the
// guest or, worse, sends restaurant customers somewhere unintended.
// Both path forms are accepted: /p/ is what the app generates now,
// /promo/ is the older shape that still works and may be pasted from a
// link already sent to guests.
// PRODUCTISED 2026-08-21: this used to hardcode one restaurant's domain.
// Each client runs on their own host, so the accepted host is now derived
// from wherever the app itself is served, with an override for the case
// where the app and the promo pages are split across two hosts.
const CAMP_PROMO_HOST =
  (typeof PROMO_HOST !== "undefined" && PROMO_HOST) ||
  (typeof location !== "undefined" && location.host) ||
  "your-site.example";

function campPromoRe() {
  const h = String(CAMP_PROMO_HOST)
    .replace(/^www\./, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "^https:\\/\\/(?:www\\.)?" + h + "\\/(p|promo)\\/[a-z0-9-]+$",
    "i",
  );
}

function campValidatePromoUrl(url) {
  const u = (url || "").trim();
  if (!u) return null; // optional
  if (!/^https:\/\//i.test(u))
    return "Link promo harus diawali https:// dan disalin utuh dari browser.";
  if (/\.html$/i.test(u))
    return 'Hapus ".html" di akhir link — alamat yang benar berakhir di nama promonya saja.';
  if (!campPromoRe().test(u))
    return (
      "Link promo harus halaman promo milik restoran sendiri, bentuknya https://" +
      CAMP_PROMO_HOST +
      "/p/nama-promo"
    );
  // Netlify serves paths case-sensitively, so /p/Burger would 404 in
  // front of a guest even though the page exists. Catch it here rather
  // than after 30 messages have gone out.
  const slug = u.split(/\/(?:p|promo)\//)[1];
  if (slug !== slug.toLowerCase())
    return `Nama promo di link harus huruf kecil semua — coba "${slug.toLowerCase()}".`;
  return null;
}

// Fill {link}, or remove it cleanly when the campaign has no promo page.
// Removing the placeholder alone would leave a stranded blank line where
// the link used to sit, so the surrounding whitespace goes with it.
function campApplyLink(body, url) {
  const text = String(body || "");
  if (!url) return text.replace(/\n*[ \t]*\{link\}[ \t]*/g, "").trimEnd();
  return text.replace(/\{link\}/g, url);
}

// Plain-Indonesian verdict. One sentence a marketing person can
// repeat in a meeting without misquoting it.
function campVerdict(r) {
  if (!r.n1)
    return {
      tone: "neutral",
      text: "Belum ada pesan yang dikirim di campaign ini.",
    };
  if (!r.n2)
    return {
      tone: "neutral",
      text:
        "Semua guest di segmen ini dikirimi pesan, jadi tidak ada pembanding. " +
        "Angka di bawah cuma bisa dibaca apa adanya, bukan sebagai bukti campaign-nya berhasil.",
    };
  const pt = Math.round(r.rateTreated * 100);
  const pc = Math.round(r.rateControl * 100);
  const diff = Math.round(r.lift * 100);

  if (r.tooSmall)
    return {
      tone: "neutral",
      text:
        `${pt}% yang dikirimi kembali, dibanding ${pc}% yang tidak dikirimi. ` +
        `Tapi jumlah datanya masih kecil (${r.n1} vs ${r.n2} guest) — selisih ini belum bisa dijadikan kesimpulan. ` +
        `Perlu beberapa campaign lagi sebelum polanya kelihatan.`,
    };
  if (r.significant && r.lift > 0)
    return {
      tone: "good",
      text:
        `${pt}% guest yang dikirimi pesan kembali dalam ${CAMP_ATTRIBUTION_DAYS} hari, ` +
        `dibanding ${pc}% guest serupa yang tidak dikirimi — selisih ${diff} poin. ` +
        `Campaign ini kelihatannya benar-benar berpengaruh.`,
    };
  if (r.significant && r.lift < 0)
    return {
      tone: "bad",
      text:
        `Guest yang dikirimi pesan justru lebih jarang kembali (${pt}%) dibanding yang tidak dikirimi (${pc}%). ` +
        `Ini perlu dicek: mungkin isi pesannya kurang pas, atau yang dipilih untuk dikirimi memang guest yang paling sulit diajak kembali.`,
    };
  return {
    tone: "neutral",
    text:
      `${pt}% yang dikirimi kembali, dibanding ${pc}% yang tidak dikirimi. ` +
      `Selisihnya masih dalam batas kebetulan — belum ada bukti campaign ini menambah kunjungan.`,
  };
}

// ============================================================
// TAB BAR — Kirim / Hasil / Kelola Template
// ============================================================
// The Broadcast page had two hidden sibling divs already; this makes
// it three and gives them a visible switch. Deliberately NOT a new
// sidebar entry: the nav is already crowded and the whole point is
// that results belong next to the thing that produced them.
// 2026-08-01 rework: "Kirim" is gone as a standalone destination.
// Sending now happens inside a campaign, because a broadcast with no
// campaign behind it can never appear in the effectiveness report —
// there is no frozen audience to compare it against. One way to do it
// beats two.
let bcTab = "campaign";

function bcShowTab(tab) {
  bcTab = tab;
  const views = {
    campaign: "bc-view-campaign",
    hasil: "bc-view-results",
    template: "bc-view-editor",
  };
  Object.entries(views).forEach(([k, id]) => {
    document.getElementById(id)?.classList.toggle("hidden", k !== tab);
  });
  const activeCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-[color:var(--brand-ink)] text-white transition";
  const idleCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-white text-[#555] border border-[#E6E2DC] hover:bg-[#F8F6F2] transition";
  const tabs = [
    ["campaign", "Campaign"],
    ["hasil", "Hasil"],
    ["template", "Template"],
  ];
  const bar = document.getElementById("bc-tabs");
  if (bar)
    bar.innerHTML = `<div class="flex flex-wrap items-center gap-2">${tabs
      .map(
        ([k, label]) =>
          `<button onclick="bcShowTab('${k}')" class="${k === tab ? activeCls : idleCls}" data-i18n-skip>${label}</button>`,
      )
      .join("")}</div>`;

  if (tab === "template") bcRenderEditor();
  if (tab === "hasil") campLoadResults();
  if (tab === "campaign" && !ceCampaign) ceLoadList();
}

// ============================================================
// SHARED HELPERS
// ============================================================
// The old "active campaign bar + start modal" lived here. Superseded
// 2026-08-01 by the campaign workspace in campaign-editor.js, which
// owns creating, editing and running a campaign. Only the formatting
// helpers the results tab still needs were kept.

function campRp(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function campSegmentLabel(segment, tag) {
  if (segment === "tag") return `Tag "${tag || "-"}"`;
  return BC_SEGMENTS[segment]?.label || segment;
}

function campFmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ============================================================
// RESULTS TAB
// ============================================================

async function campLoadResults(force = false) {
  const el = document.getElementById("camp-results");
  if (!el) return;
  if (campLoaded && !force) return campRenderResults();
  el.innerHTML = `<div class="p-8 text-center text-sm text-[#999]">Menghitung hasil campaign...</div>`;

  const { data: campaigns, error } = await supabaseQuery(
    () =>
      db.from("wa_campaigns").select("*").order("started_at", { ascending: false }),
    "Gagal memuat campaign",
  );
  if (error) return;
  campList = campaigns || [];
  if (!campList.length) {
    campLoaded = true;
    return campRenderResults();
  }

  const ids = campList.map((c) => c.id);
  // Only fetch visits from the earliest campaign onwards — the whole
  // visits table is ~470 rows today but this page must not become the
  // next egress problem when it is 5,000.
  const earliest = campList
    .map((c) => campDay(c.started_at))
    .sort()[0];
  const visitFloor = campAddDays(earliest, -1);

  const [audRes, sendRes, bcastRes, visitRes, guestRes] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("wa_campaign_audience")
          .select("campaign_id, guest_id, has_wa")
          .in("campaign_id", ids),
      "Gagal memuat audience campaign",
    ),
    supabaseQuery(
      () =>
        db
          .from("wa_outreach_log")
          .select("campaign_id, guest_id, sent_at, message_version")
          .in("campaign_id", ids),
      "Gagal memuat riwayat kirim",
    ),
    // Every broadcast send, campaign or not — used to spot control
    // guests who were contaminated by a different blast.
    supabaseQuery(
      () =>
        db
          .from("wa_outreach_log")
          .select("campaign_id, guest_id, sent_at")
          .eq("is_broadcast", true),
      "Gagal memuat riwayat broadcast",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("guest_id, visit_date, spend_amount, notes, pax")
          .is("voided_at", null)
          .gte("visit_date", visitFloor),
      "Gagal memuat kunjungan",
    ),
    supabaseQuery(
      () => db.from("guests").select("id, name, phone"),
      "Gagal memuat guest",
    ),
  ]);

  const audByCampaign = {};
  (audRes.data || []).forEach((a) => {
    (audByCampaign[a.campaign_id] = audByCampaign[a.campaign_id] || []).push(a);
  });
  const sendsByCampaign = {};
  (sendRes.data || []).forEach((s) => {
    if (!s.campaign_id) return;
    (sendsByCampaign[s.campaign_id] = sendsByCampaign[s.campaign_id] || []).push(
      s,
    );
  });
  const visitsByGuest = {};
  (visitRes.data || []).forEach((v) => {
    if (!v.guest_id || !v.visit_date) return;
    (visitsByGuest[v.guest_id] = visitsByGuest[v.guest_id] || []).push({
      date: v.visit_date,
      spend: v.spend_amount || 0,
      notes: v.notes || "",
      pax: v.pax || null,
    });
  });
  campGuestNames = {};
  (guestRes.data || []).forEach((g) => {
    campGuestNames[g.id] = g.name || "";
  });

  const todayDay = TODAY;
  campResults = {};
  campList.forEach((c) => {
    // Broadcasts this guest got from OTHER campaigns (or none at all),
    // for the contamination check.
    const otherBc = {};
    (bcastRes.data || []).forEach((r) => {
      if (r.campaign_id === c.id) return;
      (otherBc[r.guest_id] = otherBc[r.guest_id] || []).push(campDay(r.sent_at));
    });
    campResults[c.id] = campComputeResult(
      c,
      audByCampaign[c.id] || [],
      sendsByCampaign[c.id] || [],
      visitsByGuest,
      otherBc,
      todayDay,
    );
  });

  campLoaded = true;
  campRenderResults();
}

function campToggleDetail(id) {
  campExpanded[id] = !campExpanded[id];
  campRenderResults();
}

function campPct(v) {
  return v === null || v === undefined ? "—" : Math.round(v * 100) + "%";
}

function campRenderResults() {
  const el = document.getElementById("camp-results");
  if (!el) return;

  if (!campList.length) {
    el.innerHTML = `<div class="bg-white rounded-2xl border border-[#E7E4DE] p-8 text-center">
      <p class="text-sm text-[#555] font-medium" data-i18n-skip>Belum ada campaign sama sekali.</p>
      <p class="text-xs text-[#999] mt-2 max-w-md mx-auto leading-relaxed" data-i18n-skip>
        Buka tab Kirim, pilih segmen dan template, lalu tekan "Mulai Campaign"
        sebelum mengirim pesan. Hasilnya muncul di sini dan mulai bisa dibaca
        sekitar ${CAMP_ATTRIBUTION_DAYS} hari setelah pesan terakhir dikirim.
      </p>
    </div>`;
    return;
  }

  el.innerHTML = campList
    .map((c) => campRenderCard(campResults[c.id]))
    .join("");
}

function campRenderCard(r) {
  if (!r) return "";
  const c = r.campaign;
  const v = campVerdict(r);
  const toneBg = {
    good: "background:#F0F8F3;border:1px solid #CBE6D6",
    bad: "background:#FDF3F2;border:1px solid #F2D5D1",
    neutral: "background:#F8F6F2;border:1px solid #E7E4DE",
  }[v.tone];

  const open = !!campExpanded[c.id];
  const running = !c.ended_at;

  // Maturity banner. Reading a 3-day-old campaign as a verdict is the
  // single easiest way to draw the wrong conclusion from this page.
  const maturity = !r.n1
    ? ""
    : !r.mature
      ? `<div class="text-xs text-[#C77700] font-medium mb-3" data-i18n-skip>
           Masih berjalan — angka ini belum final. Guest terakhir dikirimi
           ${campFmtDate(r.lastSendDay)}, jadi hasil lengkapnya baru bisa dibaca
           ${campFmtDate(r.matureOn)}${r.daysLeft ? ` (${r.daysLeft} hari lagi)` : ""}.
         </div>`
      : "";

  const returnerRows = r.returners
    .map((ret) => {
      const name = waCleanGuestName(campGuestNames[ret.guest_id] || "") || "-";
      const notes = ret.visits
        .map((x) => x.notes)
        .filter(Boolean)
        .join(" / ");
      return `<tr class="border-b border-[#F0EDE7]">
        <td class="px-3 py-2 text-sm text-[#333]">${escapeHtml(name)}</td>
        <td class="px-3 py-2 text-sm text-[#555] whitespace-nowrap">${ret.visits.map((x) => campFmtDate(x.date + "T00:00:00")).join(", ")}</td>
        <td class="px-3 py-2 text-sm text-[#555] whitespace-nowrap">${ret.spend ? campRp(ret.spend) : "—"}</td>
        <td class="px-3 py-2 text-xs text-[#777]">${escapeHtml(notes || "—")}</td>
      </tr>`;
    })
    .join("");

  return `<div class="bg-white rounded-2xl border border-[#E7E4DE] p-5 mb-4">
    <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div>
        <h3 class="text-lg font-semibold text-[color:var(--brand-ink)]" data-i18n-skip>${escapeHtml(c.name)}</h3>
        <p class="text-xs text-[#999] mt-1" data-i18n-skip>
          ${escapeHtml(campSegmentLabel(c.segment, c.segment_tag))}
          &middot; ${campFmtDate(c.started_at)}${c.ended_at ? " – " + campFmtDate(c.ended_at) : ""}
          ${c.created_by ? "&middot; oleh " + escapeHtml(c.created_by) : ""}
        </p>
        ${c.note ? `<p class="text-xs text-[#555] mt-1 italic" data-i18n-skip>${escapeHtml(c.note)}</p>` : ""}
      </div>
      ${
        running
          ? `<span class="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full bg-[#1FAF5E] text-white" data-i18n-skip>Berjalan</span>`
          : ""
      }
    </div>

    ${maturity}

    <div class="rounded-xl p-4 mb-4" style="${toneBg}">
      <p class="text-sm text-[#333] leading-relaxed" data-i18n-skip>${escapeHtml(v.text)}</p>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      ${campStat("Dikirimi pesan", `${r.n1} guest`, `dari ${r.audienceTotal} di segmen ini`)}
      ${campStat("Kembali dalam " + CAMP_ATTRIBUTION_DAYS + " hari", `${r.x1} guest`, campPct(r.rateTreated))}
      ${campStat("Pembanding (tidak dikirimi)", `${r.x2} dari ${r.n2}`, campPct(r.rateControl))}
      ${campStat("Belanja dari yang kembali", campRp(r.treatedRevenue), r.x1 ? `rata-rata ${campRp(Math.round(r.avgPerReturner))}/guest` : "—")}
    </div>

    ${
      r.incrementalRevenue !== null && !r.tooSmall
        ? `<p class="text-xs text-[#555] mb-3 leading-relaxed" data-i18n-skip>
             <strong>Perkiraan tambahan dari campaign ini:</strong>
             ${r.extraReturners >= 0 ? "+" : ""}${Math.round(r.extraReturners * 10) / 10} guest
             (${r.incrementalRevenue >= 0 ? "+" : "−"}${campRp(Math.abs(Math.round(r.incrementalRevenue)))}).
             Ini kunjungan yang kemungkinan besar TIDAK terjadi kalau pesannya tidak dikirim —
             bukan total belanja semua yang kembali.
           </p>`
        : ""
    }

    ${
      r.versions.length > 1
        ? `<div class="rounded-xl p-4 mb-4" style="background:#FFF8EC;border:1px solid var(--accent-tint2)">
             <p class="text-sm font-semibold text-[#333] mb-1" data-i18n-skip>
               Pesannya sempat diubah di tengah campaign
             </p>
             <p class="text-xs text-[#555] mb-3 leading-relaxed" data-i18n-skip>
               Tiap orang dihitung menurut versi yang benar-benar mereka terima.
               Kalau perbedaannya besar, kemungkinan isi pesannya yang berpengaruh —
               tapi jumlah per versi biasanya kecil, jadi baca ini sebagai petunjuk saja.
             </p>
             <table class="w-full text-sm">
               <thead><tr class="text-left text-[10px] uppercase tracking-wider text-[#999]">
                 <th class="pb-1">Versi</th><th class="pb-1">Dikirimi</th>
                 <th class="pb-1">Kembali</th><th class="pb-1">Belanja</th>
               </tr></thead>
               <tbody>${r.versions
                 .map(
                   (v) => `<tr>
                     <td class="py-1 text-[#555]">Versi ${v.version}</td>
                     <td class="py-1 text-[#555]">${v.n}</td>
                     <td class="py-1 text-[#555]">${v.x} (${campPct(v.rate)})</td>
                     <td class="py-1 text-[#555]">${v.revenue ? campRp(v.revenue) : "—"}</td>
                   </tr>`,
                 )
                 .join("")}</tbody>
             </table>
           </div>`
        : ""
    }

    <details class="mb-3">
      <summary class="text-xs text-[color:var(--brand-ink)] cursor-pointer hover:underline" data-i18n-skip>Isi pesan versi terakhir</summary>
      <div class="text-sm text-[#555] bg-[#F8F6F2] rounded-lg p-3 mt-2 whitespace-pre-wrap">${escapeHtml(campApplyLink(c.message_body || "", c.promo_url))}</div>
      ${
        c.promo_url
          ? `<p class="text-[11px] text-[#999] mt-2" data-i18n-skip>
               Gambar promo dikirim sebagai preview dari
               <a href="${escapeHtml(c.promo_url)}" target="_blank" rel="noopener" class="text-[color:var(--brand-ink)] hover:underline">${escapeHtml(c.promo_url)}</a>
             </p>`
          : ""
      }
    </details>

    ${
      r.returners.length
        ? `<button onclick="campToggleDetail('${c.id}')" class="text-xs text-[color:var(--brand-ink)] font-medium hover:underline" data-i18n-skip>
             ${open ? "Sembunyikan" : "Lihat"} ${r.returners.length} guest yang kembali
           </button>
           ${
             open
               ? `<div class="mt-3 overflow-x-auto border border-[#E7E4DE] rounded-xl">
                    <table class="w-full">
                      <thead><tr class="text-left text-[11px] uppercase tracking-wider text-[#999] border-b border-[#E7E4DE]">
                        <th class="px-3 py-2">Nama</th><th class="px-3 py-2">Tanggal kembali</th>
                        <th class="px-3 py-2">Belanja</th><th class="px-3 py-2">Catatan kunjungan</th>
                      </tr></thead>
                      <tbody>${returnerRows}</tbody>
                    </table>
                  </div>`
               : ""
           }`
        : ""
    }

    <p class="text-[11px] text-[#AAA] mt-4 leading-relaxed" data-i18n-skip>
      Cara hitung: kunjungan dihitung kalau terjadi setelah tanggal kirim dan dalam
      ${CAMP_ATTRIBUTION_DAYS} hari. Pembanding = guest yang masuk segmen yang sama,
      punya nomor WA, tapi tidak jadi dikirimi, diukur dari tanggal kirim tengah campaign.
      ${r.controlSkippedContaminated ? `${r.controlSkippedContaminated} guest dikeluarkan dari pembanding karena dapat broadcast lain. ` : ""}
      ${r.controlSkippedNoWa ? `${r.controlSkippedNoWa} tanpa nomor WA valid tidak dihitung. ` : ""}
      Perlu diingat: staf memilih sendiri siapa yang dikirimi (biasanya dari urutan teratas),
      jadi kedua kelompok tidak dibagi acak — angka ini petunjuk kuat, bukan bukti mutlak.
    </p>
  </div>`;
}

function campStat(label, value, sub) {
  return `<div class="rounded-xl border border-[#E7E4DE] p-3">
    <p class="text-[10px] uppercase tracking-wider text-[#999]" data-i18n-skip>${escapeHtml(label)}</p>
    <p class="text-lg font-semibold text-[#333] mt-1" data-i18n-skip>${escapeHtml(String(value))}</p>
    <p class="text-[11px] text-[#999]" data-i18n-skip>${escapeHtml(String(sub))}</p>
  </div>`;
}

// Exported for the node test harness; harmless in the browser.
// The render functions are exported too so the harness can check the
// actual card markup against real data, rather than a reimplementation
// of it that would quietly drift out of sync.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    campComputeResult,
    campVerdict,
    campMedianDay,
    campVisitsInWindow,
    campContaminated,
    campZScore,
    campAddDays,
    campApplyLink,
    campValidatePromoUrl,
    campRenderCard,
    campToggleDetail,
    campSegmentLabel,
    campFmtDate,
    campRp,
    CAMP_ATTRIBUTION_DAYS,
    CAMP_MIN_SAMPLE,
    // Test seam: campGuestNames is populated by campLoadResults() in the
    // browser, which the harness never runs.
    setGuestNames: (m) => {
      campGuestNames = m;
    },
  };
}
