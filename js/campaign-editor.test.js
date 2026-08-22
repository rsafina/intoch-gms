// Tests for the campaign workspace logic that does not touch the DOM.
// Run: node js/campaign-editor.test.js
//
// campaign-editor.js is a browser script with no module.exports, so it is
// evaluated in a vm context with the globals it expects. That way the
// tests exercise the real functions rather than a copy of them.

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const DIR = __dirname;

let pass = 0,
  fail = 0;
const ok = (n, c, x) => {
  c
    ? (pass++, console.log("  PASS  " + n))
    : (fail++, console.log("  FAIL  " + n + (x ? "  → " + JSON.stringify(x) : "")));
};
const eq = (n, a, b) => ok(n, a === b, { got: a, want: b });

// ── Minimal browser-ish context ──
const ctx = {
  console,
  Date,
  Math,
  Object,
  Number,
  String,
  JSON,
  Set,
  Array,
  isNaN,
  parseInt,
  location: { origin: "https://your-site.example" },
  document: { getElementById: () => null, querySelectorAll: () => [] },
  SUPABASE_URL: "https://YOUR_SUPABASE_PROJECT_REF.supabase.co",
  escapeHtml: (v) => String(v == null ? "" : v),
  // Lives in app.js, which is not part of the bundle evaluated below; the
  // recipient table renders each guest's spending tier through it.
  formatSpendingTierBadge: (tier) =>
    `<span>${
      tier === "high_spender"
        ? "High Spender"
        : tier === "medium_spender"
          ? "Medium Spender"
          : "None"
    }</span>`,
  toast: () => {},
  ymd: (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);

// All four files are evaluated as ONE script. Separate vm.runInContext
// calls each get their own scope, so a top-level `let` in one is
// invisible to the next — and invisible to the test, which needs to set
// module state like ceAudience. The footer hands back setters.
const SRC = ["wa.js", "broadcast.js", "campaign.js", "campaign-editor.js"]
  .map((f) => fs.readFileSync(path.join(DIR, f), "utf8"))
  .join("\n;\n");
vm.runInContext(
  SRC +
    `
  ;globalThis.T = {
    setAudience: (v) => { ceAudience = v; },
    setGuests:   (v) => { bcGuests = v; },
    setRowView:  (f, q) => { ceRowFilter = f; ceSearch = q; },
    setSpendSort:(v) => { ceSpendSort = v; },
    getSpendSort:() => ceSpendSort,
    setVisitSort:(v) => { ceVisitSort = v; },
    getVisitSort:() => ceVisitSort,
    setCreate:   (s, t) => { ceCreateSegment = s; ceCreateTag = t; },
    setBc:       (s, t) => { bcSegment = s; bcTag = t; },
    getBc:       () => ({ bcSegment, bcTag }),
  };
  // Top-level const/let are not reachable as context properties the way
  // function declarations are, so hand this one over explicitly.
  globalThis.WA_DEFAULT_TEMPLATES = WA_DEFAULT_TEMPLATES;
  globalThis.CE_RESERVED_SLUGS = CE_RESERVED_SLUGS;
  globalThis.CE_TARGET_BYTES = CE_TARGET_BYTES;
  globalThis.CE_HARD_LIMIT_BYTES = CE_HARD_LIMIT_BYTES;
  globalThis.CE_MAX_IMAGE_BYTES = CE_MAX_IMAGE_BYTES;
  globalThis.CE_CARD_W = CE_CARD_W;
  globalThis.CE_CARD_H = CE_CARD_H;`,
  ctx,
);
const T = ctx.T;

console.log("\n── slug generation ──");
eq("basic", ctx.ceSlugify("Promo Burger"), "promo-burger");
eq("punctuation collapses", ctx.ceSlugify("At Risk (>60 hari) — Agustus!"), "at-risk-60-hari-agustus");
eq("leading/trailing hyphens trimmed", ctx.ceSlugify("  --Promo--  "), "promo");
eq("empty falls back", ctx.ceSlugify(""), "promo");
eq("null falls back", ctx.ceSlugify(null), "promo");
ok("capped at 40 chars", ctx.ceSlugify("a".repeat(80)).length === 40);
eq("non-latin falls back rather than producing junk", ctx.ceSlugify("促销"), "promo");

console.log("\n── promo urls ──");
eq(
  "campaign link",
  ctx.cePromoUrl({ slug: "promo-burger-a1b2c3" }),
  "https://your-site.example/p/promo-burger-a1b2c3",
);
eq("no slug → empty", ctx.cePromoUrl({}), "");
eq("null campaign → empty", ctx.cePromoUrl(null), "");
eq(
  "image url points at the public bucket",
  ctx.cePromoImageUrl({ promo_image_path: "burger/1754000.jpg" }),
  "https://YOUR_SUPABASE_PROJECT_REF.supabase.co/storage/v1/object/public/promo-images/burger/1754000.jpg",
);
eq("no image → empty", ctx.cePromoImageUrl({ slug: "x" }), "");

console.log("\n── progress counting ──");
{
  const rows = [
    { status: "pending" }, { status: "pending" },
    { status: "sent" }, { status: "sent" }, { status: "sent" },
    { status: "skipped" },
    { status: "done" },
  ];
  const p = ctx.ceProgress(rows);
  eq("total", p.total, 7);
  eq("pending", p.pending, 2);
  eq("sent", p.sent, 3);
  eq("skipped", p.skipped, 1);
  eq("done", p.done, 1);
  eq("handled excludes pending", p.handled, 5);
  const empty = ctx.ceProgress([]);
  eq("empty total", empty.total, 0);
  eq("empty handled", empty.handled, 0);
}

console.log("\n── recipient sorting and filtering ──");
{
  T.setAudience([
    { guest_id: "1", name: "Zulfa 3 Jul 26", status: "sent", send_count: 1, phone: "081234567890", waPhone: "6281234567890" },
    { guest_id: "2", name: "Andini", status: "pending", send_count: 0, phone: "081111111111", waPhone: "6281111111111" },
    { guest_id: "3", name: "Budi (VIP)", status: "skipped", send_count: 0, phone: "", waPhone: null },
    { guest_id: "4", name: "Citra", status: "done", send_count: 0, phone: "082222222222", waPhone: "6282222222222" },
    { guest_id: "5", name: "Ali", status: "pending", send_count: 0, phone: "083333333333", waPhone: "6283333333333" },
  ]);
  T.setRowView("all", "");
  let rows = ctx.ceVisibleRows();
  eq("all rows", rows.length, 5);
  eq("pending sorts first", rows[0].status, "pending");
  eq("pending sorted by cleaned name", rows[0].name, "Ali");
  eq("second pending", rows[1].name, "Andini");
  eq("skipped sorts last", rows[rows.length - 1].status, "skipped");

  T.setRowView("pending", "");
  eq("filter pending", ctx.ceVisibleRows().length, 2);
  T.setRowView("sent", "");
  eq("filter sent", ctx.ceVisibleRows().length, 1);
  T.setRowView("skipped", "");
  eq("filter skipped", ctx.ceVisibleRows().length, 1);

  T.setRowView("all", "andini");
  eq("search by name", ctx.ceVisibleRows().length, 1);
  T.setRowView("all", "zulfa");
  eq("search matches cleaned name", ctx.ceVisibleRows().length, 1);
  T.setRowView("all", "0812");
  eq("search by phone prefix", ctx.ceVisibleRows().length, 1);
  T.setRowView("all", "6283");
  eq("search by international form", ctx.ceVisibleRows().length, 1);
  T.setRowView("all", "12");
  eq("under 3 digits does not phone-match", ctx.ceVisibleRows().length, 0);
  T.setRowView("all", "tidakada");
  eq("no match", ctx.ceVisibleRows().length, 0);
  T.setRowView("all", "");
}

console.log("\n── status pill wording ──");
{
  ok("pending", ctx.ceStatusPill("pending", 0).includes("Belum dikirim"));
  ok("sent once says Terkirim", ctx.ceStatusPill("sent", 1).includes(">Terkirim<"));
  ok("sent twice shows the count", ctx.ceStatusPill("sent", 2).includes("Terkirim 2x"));
  ok("sent five times", ctx.ceStatusPill("sent", 5).includes("Terkirim 5x"));
  ok("skipped", ctx.ceStatusPill("skipped", 0).includes("Dilewati"));
  ok("done", ctx.ceStatusPill("done", 0).includes("Selesai"));
  ok("unknown falls back to pending", ctx.ceStatusPill("nonsense", 0).includes("Belum dikirim"));
}

console.log("\n── audience snapshot uses the shared segment rules ──");
{
  const today = new Date();
  const daysAgo = (n) => ctx.ymd(new Date(today.getTime() - n * 864e5));
  T.setGuests([
    // lapsed, reachable → at risk
    { id: "a", name: "Lapsed", tags: [], waPhone: "628111", do_not_contact: false,
      lastVisit: daysAgo(90), firstVisit: daysAgo(200), created_at: daysAgo(200), tier: "medium_spender" },
    // visited last week → not at risk
    { id: "b", name: "Recent", tags: [], waPhone: "628222", do_not_contact: false,
      lastVisit: daysAgo(5), firstVisit: daysAgo(200), created_at: daysAgo(200), tier: "medium_spender" },
    // lapsed but opted out → must never be in an audience
    { id: "c", name: "OptedOut", tags: [], waPhone: "628333", do_not_contact: true,
      lastVisit: daysAgo(90), firstVisit: daysAgo(200), created_at: daysAgo(200), tier: "high_spender" },
    // lapsed, no usable number → included but flagged unreachable
    { id: "d", name: "NoPhone", tags: [], waPhone: null, do_not_contact: false,
      lastVisit: daysAgo(120), firstVisit: daysAgo(300), created_at: daysAgo(300), tier: "medium_spender" },
  ]);

  T.setCreate("at_risk", "");
  const aud = ctx.ceCreateAudience();
  const ids = aud.map((g) => g.id).sort();
  eq("at-risk audience", ids.join(","), "a,d");
  ok("opted-out guest excluded", !ids.includes("c"));
  ok("recent visitor excluded", !ids.includes("b"));

  T.setCreate("high_spender", "");
  eq("tier segment respects opt-out too", ctx.ceCreateAudience().length, 0);

  T.setCreate("medium_spender", "");
  eq("medium spenders", ctx.ceCreateAudience().length, 3);

  // The global filter state must be left exactly as it was found —
  // ceCreateAudience borrows bcSegment/bcTag and has to put them back.
  T.setBc("first_timer", "vip");
  T.setCreate("at_risk", "");
  ctx.ceCreateAudience();
  eq("bcSegment restored", T.getBc().bcSegment, "first_timer");
  eq("bcTag restored", T.getBc().bcTag, "vip");
}

// ============================================================
// THE LINKLESS-BROADCAST BUG (2026-08-01)
// ------------------------------------------------------------
// Three real campaigns went out with a promo image uploaded and no
// {link} in the body, so every guest received plain text and the image
// was never delivered. Two independent things were wrong and both are
// pinned here, because either one alone reintroduces the bug:
//   1. no broadcast template shipped with {link} in it
//   2. nothing between upload and send noticed the mismatch
// ============================================================

console.log("\n── every broadcast template carries {link} ──");
{
  const tpl = ctx.WA_DEFAULT_TEMPLATES;
  const broadcast = Object.keys(tpl).filter((k) => tpl[k].is_broadcast);
  ok("there are broadcast templates to check", broadcast.length >= 6);
  broadcast.forEach((k) => {
    ok(`${k} contains {link}`, tpl[k].body.includes("{link}"));
  });

  // The flip side matters just as much: a thank-you or a voucher
  // belongs to no campaign, so it has no promo page to point at and
  // {link} would render as a dead placeholder or get stripped.
  const transactional = Object.keys(tpl).filter((k) => !tpl[k].is_broadcast);
  transactional.forEach((k) => {
    ok(`${k} (transactional) has no {link}`, !tpl[k].body.includes("{link}"));
  });
}

console.log("\n── ceLinkGuard ──");
{
  const g = ctx.ceLinkGuard;

  // The failure that actually shipped.
  const bad = g({ message_body: "Halo {nama}!", promo_image_path: "c/1.png" });
  ok("image + no {link} is blocked", !!bad);
  ok("the reason names {link}", (bad || "").includes("{link}"));

  eq(
    "image + {link} passes",
    g({ message_body: "Halo {nama}!\n\n{link}", promo_image_path: "c/1.png" }),
    null,
  );
  eq(
    "no image, no {link} passes — nothing is being lost",
    g({ message_body: "Halo {nama}!", promo_image_path: null }),
    null,
  );
  eq(
    "no image but {link} present passes — that case is only a warning",
    g({ message_body: "Halo {nama}!\n\n{link}", promo_image_path: null }),
    null,
  );

  // An empty body is a different, earlier error; the guard must not
  // steal that message and send ops looking for the wrong problem.
  eq(
    "empty body defers to the empty-body check",
    g({ message_body: "", promo_image_path: "c/1.png" }),
    null,
  );
  eq(
    "whitespace-only body defers too",
    g({ message_body: "   \n  ", promo_image_path: "c/1.png" }),
    null,
  );

  eq("null campaign is safe", g(null), null);
  eq("undefined campaign is safe", g(undefined), null);
  eq("campaign with no fields is safe", g({}), null);

  // {link} anywhere in the body counts, not just at the end.
  eq(
    "{link} mid-message counts",
    g({ message_body: "Lihat {link} ya, promo baru!", promo_image_path: "c/1.png" }),
    null,
  );

  // A near-miss placeholder is still a broken campaign: campApplyLink
  // matches {link} exactly, so {linked} would ship to the guest as
  // literal text and the image would still be lost.
  ok(
    "a lookalike placeholder does not satisfy the guard",
    !!g({ message_body: "Halo {linked}!", promo_image_path: "c/1.png" }),
  );
  ok(
    "the word 'link' in prose is not enough",
    !!g({ message_body: "Klik link di bawah ini", promo_image_path: "c/1.png" }),
  );
}

console.log("\n── the default templates survive the guard end to end ──");
{
  // A campaign created today from any broadcast template, with an image
  // uploaded, must be sendable without ops editing anything.
  const tpl = ctx.WA_DEFAULT_TEMPLATES;
  Object.keys(tpl)
    .filter((k) => tpl[k].is_broadcast)
    .forEach((k) => {
      eq(
        `${k} campaign + image passes the guard untouched`,
        ctx.ceLinkGuard({ message_body: tpl[k].body, promo_image_path: "c/1.png" }),
        null,
      );
    });
}

console.log("\n── the rendered message actually contains the URL ──");
{
  // campApplyLink is what turns {link} into the promo URL. The bug was
  // upstream of it, but pin the whole chain so a template regression
  // shows up as a missing URL, which is what the guest would see.
  const c = { slug: "burger-agustus-ab12cd", message_body: ctx.WA_DEFAULT_TEMPLATES.acquisition.body };
  const url = ctx.cePromoUrl(c);
  eq(
    "promo URL is built from the slug",
    url,
    "https://your-site.example/p/burger-agustus-ab12cd",
  );

  const rendered = ctx.campApplyLink(c.message_body, url);
  ok("rendered message contains the real URL", rendered.includes(url));
  ok("no placeholder is left behind", !rendered.includes("{link}"));

  // And the no-URL path still cleans up after itself rather than
  // shipping a literal "{link}" to a guest.
  const stripped = ctx.campApplyLink(c.message_body, "");
  ok("stripped message has no placeholder", !stripped.includes("{link}"));
  ok("stripped message does not end in blank lines", stripped === stripped.trimEnd());
  ok("stripped message keeps the actual copy", stripped.includes("Terima kasih"));
}

// ============================================================
// SEARCH BOX FOCUS BUG (2026-08-01)
// ------------------------------------------------------------
// Typing one letter into the recipient search re-rendered the whole
// workspace, which replaced the <input> being typed into and threw
// away focus and caret — every character needed a fresh click.
//
// The fix is structural, not logical, so these tests pin the structure:
// the search input must be rendered OUTSIDE the container that gets
// redrawn on each keystroke. A logic-only test cannot see this bug.
// ============================================================

console.log("\n── recipient search does not re-render its own input ──");
{
  const c = { status: "draft", name: "Steak" };
  const p = ctx.ceProgress([]);

  T.setAudience([
    { guest_id: "1", name: "Rere", phone: "0812", waPhone: "62812", status: "pending", send_count: 0 },
    { guest_id: "2", name: "Budi", phone: "0813", waPhone: "62813", status: "pending", send_count: 0 },
  ]);
  T.setRowView("all", "");

  const full = ctx.ceRenderPenerima(c, p);
  ok("the search input exists", full.includes('id="ce-row-search"'));
  ok("rows live in their own container", full.includes('id="ce-rows-body"'));
  ok("chips live in their own container", full.includes('id="ce-row-chips"'));

  // THE ACTUAL REGRESSION GUARD. ceRenderRowsBody is what gets written
  // into ce-rows-body on every keystroke. If the input ever appears in
  // it again, typing will destroy the element the user is typing into.
  const rowsOnly = ctx.ceRenderRowsBody(c);
  ok(
    "the redrawn fragment does NOT contain the search input",
    !rowsOnly.includes("ce-row-search") && !rowsOnly.includes('type="search"'),
  );
  ok(
    "the redrawn fragment does NOT contain the filter chips",
    !rowsOnly.includes("ceSetRowFilter"),
  );
  ok("the redrawn fragment does contain rows", rowsOnly.includes("Rere"));
}

console.log("\n── search still filters correctly after the split ──");
{
  const c = { status: "draft" };
  T.setRowView("all", "r");
  ok("searching 'r' matches Rere", ctx.ceRenderRowsBody(c).includes("Rere"));
  ok("searching 'r' excludes Budi", !ctx.ceRenderRowsBody(c).includes("Budi"));

  T.setRowView("all", "bu");
  ok("searching 'bu' matches Budi", ctx.ceRenderRowsBody(c).includes("Budi"));

  // Typing a second character used to be impossible without re-clicking;
  // make sure progressively longer queries still narrow rather than reset.
  T.setRowView("all", "bud");
  ok("three characters still match", ctx.ceRenderRowsBody(c).includes("Budi"));

  T.setRowView("all", "zzz");
  const none = ctx.ceRenderRowsBody(c);
  ok("no match shows the empty state", none.includes("Tidak ada yang cocok"));
  ok("the empty state quotes what was typed", none.includes("zzz"));

  T.setRowView("all", "");
  ok("clearing brings everyone back", ctx.ceRenderRowsBody(c).includes("Rere"));
}

console.log("\n── last visit cell ──");
{
  const days = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  ok(
    "a guest with no visits reads 'Belum pernah'",
    ctx.ceLastVisitCell(null).includes("Belum pernah"),
  );
  ok("a visit today reads 'hari ini'", ctx.ceLastVisitCell(days(0)).includes("hari ini"));
  ok("the gap is spelled out", ctx.ceLastVisitCell(days(65)).includes("65 hari lalu"));
  ok(
    "the date itself is still shown",
    ctx.ceLastVisitCell("2026-06-01").includes("2026"),
  );
}

console.log("\n── spending column sort ──");
{
  const c = { status: "draft" };
  const order = () =>
    ctx
      .ceVisibleRows()
      .map((r) => r.name)
      .join(",");

  // Deliberately mixed: tier and status disagree, so the tests can tell
  // which key actually won rather than both pointing the same way.
  T.setAudience([
    { guest_id: "1", name: "Nina", phone: "0812", waPhone: "62812", status: "pending", send_count: 0, tier: null },
    { guest_id: "2", name: "Hasan", phone: "0813", waPhone: "62813", status: "sent", send_count: 1, tier: "high_spender" },
    { guest_id: "3", name: "Mira", phone: "0814", waPhone: "62814", status: "pending", send_count: 0, tier: "medium_spender" },
  ]);
  T.setRowView("all", "");

  T.setSpendSort(null);
  eq("off keeps the send order (pending first)", order(), "Mira,Nina,Hasan");

  T.setSpendSort("desc");
  eq("desc puts High Spender on top, ahead of status", order(), "Hasan,Mira,Nina");

  T.setSpendSort("asc");
  eq("asc puts the no-spend guests on top", order(), "Nina,Mira,Hasan");

  // Within one tier the old keys still apply, so the list stays workable.
  T.setAudience([
    { guest_id: "1", name: "Zaki", phone: "0812", waPhone: "62812", status: "pending", send_count: 0, tier: "high_spender" },
    { guest_id: "2", name: "Adi", phone: "0813", waPhone: "62813", status: "sent", send_count: 1, tier: "high_spender" },
    { guest_id: "3", name: "Bayu", phone: "0814", waPhone: "62814", status: "pending", send_count: 0, tier: "high_spender" },
  ]);
  T.setSpendSort("desc");
  eq("ties fall back to status then name", order(), "Bayu,Zaki,Adi");

  // An unknown tier must not outrank High Spender if a third tier is ever added.
  T.setAudience([
    { guest_id: "1", name: "Ratu", phone: "0812", waPhone: "62812", status: "pending", send_count: 0, tier: "platinum_spender" },
    { guest_id: "2", name: "Sari", phone: "0813", waPhone: "62813", status: "pending", send_count: 0, tier: "high_spender" },
  ]);
  eq("unknown tier sorts with the no-spend rows", order(), "Sari,Ratu");

  T.setSpendSort(null);
  ctx.ceToggleSpendSort();
  eq("first click sorts High first", T.getSpendSort(), "desc");
  ctx.ceToggleSpendSort();
  eq("second click reverses", T.getSpendSort(), "asc");
  ctx.ceToggleSpendSort();
  eq("third click restores the send order", T.getSpendSort(), null);

  T.setSpendSort("desc");
  ok(
    "the header carries the sort control",
    ctx.ceRenderRowsBody(c).includes("ceToggleSpendSort()"),
  );
  T.setSpendSort(null);
}

console.log("\n── last visit sort, alone and combined with spending ──");
{
  const order = () =>
    ctx
      .ceVisibleRows()
      .map((r) => r.name)
      .join(",");
  const row = (id, name, tier, lastVisit, status = "pending") => ({
    guest_id: id, name, phone: "081" + id, waPhone: "6281" + id,
    status, send_count: 0, tier, lastVisit,
  });

  T.setRowView("all", "");
  T.setSpendSort(null);

  T.setAudience([
    row("1", "Baru", "medium_spender", "2026-08-01"),
    row("2", "Lama", "high_spender", "2026-01-05"),
    row("3", "Tengah", null, "2026-05-20"),
    row("4", "Nihil", "high_spender", null),
  ]);

  T.setVisitSort("asc");
  eq("asc puts the longest-gone first", order(), "Lama,Tengah,Baru,Nihil");

  T.setVisitSort("desc");
  eq("desc puts the most recent first", order(), "Baru,Tengah,Lama,Nihil");
  ok(
    "never-visited stays at the bottom in both directions",
    order().endsWith("Nihil"),
  );

  // THE POINT OF THE FEATURE: tier groups the list, recency orders inside
  // each group — "which Medium Spender has not been in for ages".
  T.setAudience([
    row("1", "MidBaru", "medium_spender", "2026-08-01"),
    row("2", "MidLama", "medium_spender", "2026-02-01"),
    row("3", "HighBaru", "high_spender", "2026-07-01"),
    row("4", "HighLama", "high_spender", "2026-03-01"),
  ]);
  T.setSpendSort("desc");
  T.setVisitSort("asc");
  eq(
    "spending groups, visit orders within the group",
    order(),
    "HighLama,HighBaru,MidLama,MidBaru",
  );

  T.setVisitSort("desc");
  eq(
    "flipping the visit direction keeps the tier grouping",
    order(),
    "HighBaru,HighLama,MidBaru,MidLama",
  );

  T.setSpendSort(null);
  T.setVisitSort(null);
  ctx.ceToggleVisitSort();
  eq("first click is the at-risk direction", T.getVisitSort(), "asc");
  ctx.ceToggleVisitSort();
  eq("second click flips to most recent", T.getVisitSort(), "desc");
  ctx.ceToggleVisitSort();
  eq("third click restores the send order", T.getVisitSort(), null);

  ok(
    "the header carries the visit sort control",
    ctx.ceRenderRowsBody({ status: "draft" }).includes("ceToggleVisitSort()"),
  );

  T.setSpendSort("desc");
  T.setVisitSort("asc");
  ok(
    "both sorts on explains the precedence",
    ctx.ceRenderRowsBody({ status: "draft" }).includes("Diurutkan per kelompok belanja"),
  );
  T.setSpendSort(null);
  T.setVisitSort(null);
  ok(
    "the note is gone when only one sort is on",
    !ctx.ceRenderRowsBody({ status: "draft" }).includes("Diurutkan per kelompok belanja"),
  );
}

// ============================================================
// GUEST-FACING LINK SHAPE (2026-08-01)
// ------------------------------------------------------------
// This URL is the only part of the system a customer ever sees, in a
// chat, on a phone. It was /promo/testing-rere-1-kbce21 — a path, a
// campaign name and a random suffix, all of it noise to the reader.
// ============================================================

// ============================================================
// PROMO CARD WORDING (2026-08-01)
// ------------------------------------------------------------
// Five real test campaigns went out with promo_title and
// promo_description both null, so every card read the generic
// "Blue Heron — Promo". On the large card the title is the biggest
// text in the whole message — bigger than the message body.
// ============================================================

// ============================================================
// GUEST NAMES CARRY THE VISIT DATE (2026-08-01)
// ------------------------------------------------------------
// Front Desk writes the visit date into the guest name and has said
// they are not changing that habit. 305 of 457 real prod names carry
// one. Every case below is taken from actual production data, so this
// is a record of what staff really type, not what we imagine.
//
// The greeting is the first thing a guest reads. "Halo Bapak/Ibu Reni
// 1 Agust 26!" tells them they are a row in a spreadsheet.
// ============================================================

console.log("\n── waCleanGuestName: real prod names ──");
{
  const c = ctx.waCleanGuestName;

  // AGUSTUS, spelled four different ways by four different people.
  eq("Agus", c("Dedi 1 Agus 26"), "Dedi");
  eq("Agust", c("Elisabeth 6 Agust 26"), "Elisabeth");
  eq("Agustus", c("Sinta 1 Agustus 26"), "Sinta");
  eq("Agt", c("Rina 17 Agt 26"), "Rina");
  eq("leading zero on the day", c("Febrianing 09 Agus 26"), "Febrianing");
  eq("multi-word name kept intact", c("Ratih PT Regenesis 6 Agust 26"), "Ratih PT Regenesis");

  // Year omitted entirely — five real cases.
  eq("no year, short month", c("Bpk Troy 17 Jul"), "Troy");
  eq("no year, long month", c("Iky 25 Juli"), "Iky");
  eq("slash in the name survives", c("Julia/Dimas 21 Jul"), "Julia/Dimas");

  // Curly and straight apostrophe before a 2-digit year.
  eq("curly apostrophe", c("Dewi 22 Des’24"), "Dewi");
  eq("straight apostrophe", c("Yani 9 Nov'25"), "Yani");

  // Parenthetical dates, with and without padding.
  eq("date in parens", c("Acha (4 Jun 26)"), "Acha");
  eq("padded parens", c("Agusti Nurul ( 8 Jun 26 )"), "Agusti Nurul");
  eq("paren note plus trailing date", c("Arum (Yusuf) 7 Jul 26"), "Arum");
  eq("whole paren removed", c("Elly (Gerald 16 jun 25)"), "Elly");

  eq("lowercase input", c("aria 29 jul 26"), "aria");
  eq("Indonesian long month", c("Fatih 14 Maret 26"), "Fatih");

  // ── Honorifics are STRIPPED (2026-08-09) ──
  // Every string below is a real prod name. Front Desk types the
  // title; the list should show the person.
  eq("Ibu", c("Ibu Alia"), "Alia");
  eq("Ibu, lowercase i", c("ibu Dwita"), "Dwita");
  eq("Ibu + trailing date", c("Ibu Hesti 8 Agust 26"), "Hesti");
  eq("Ibu + paren note", c("Ibu Clara (Loyal Cust)"), "Clara");
  eq("Ibu + paren date, padded", c("Ibu Asa ( 12 Jun 26 )"), "Asa");
  eq("Bapak", c("Bapak Ali"), "Ali");
  eq("Bapak + two-word name", c("Bapak Nanang Tanabe"), "Nanang Tanabe");
  eq("Bpk", c("Bpk Frenky"), "Frenky");
  eq("Bp without the dot", c("Bp Wibowo"), "Wibowo");
  eq("Bp. with the dot", c("Bp. Rouf PT. Interbat"), "Rouf PT. Interbat");
  eq("Bp. + date", c("Bp. Sentanu 9 Jul 26"), "Sentanu");
  eq("Pak", c("Pak Yock"), "Yock");
  eq("Mas", c("Mas Kenny"), "Kenny");
  eq("Kak", c("Kak Bila"), "Bila");
  eq("Mr. with a space", c("Mr. Ben 13 Jul 26"), "Ben");
  eq("Mr. with NO space", c("Mr.Lee 17 Jul 26"), "Lee");
  eq("Mrs.", c("Mrs. Tara 30 Jul 26"), "Tara");
  // Asked for by Rere, not yet seen in prod — cover them anyway.
  eq("Ib", c("Ib Ratna"), "Ratna");
  eq("Mba", c("Mba Sari"), "Sari");
  eq("Mb", c("Mb Sari"), "Sari");
  eq("Kakak", c("Kakak Vina"), "Vina");
  eq("Mbak", c("Mbak Ayu"), "Ayu");
  eq("Bu", c("Bu Ani"), "Ani");
  eq("Bunda", c("Bunda Sari"), "Sari");

  // ── Doctors KEEP the title, normalised to a lowercase "dr." ──
  eq("dr. already correct", c("dr. Suma 2 Jul 26"), "dr. Suma");
  eq("Dr. capitalised", c("Dr. Mitta Prana"), "dr. Mitta Prana");
  eq("Dr without the dot", c("Dr Erryl (Loyal Cust)"), "dr. Erryl");
  eq("dr lowercase, no dot", c("dr Dea ( Loyal Cust )"), "dr. Dea");
  eq("Dokter spelled out", c("Dokter Asa"), "dr. Asa");
  eq("Dok", c("Dok Lucky"), "dr. Lucky");
  eq("Ibu in front of a doctor", c("Ibu dr. Sinta"), "dr. Sinta");

  // ── Flagged for manual fixing, so they must come out UNCHANGED ──
  // One prod guest is recorded as literally "Dr". Stripping it would
  // leave a blank name, which loses the only identifier the row has.
  eq("bare Dr is left alone", c("Dr"), "Dr");
  eq("bare Ibu is left alone", c("Ibu"), "Ibu");
  // Two people in one field. Only the LEADING honorific goes —
  // guessing at the second one is how a real name gets deleted.
  eq("two people, only the first title goes", c("Bp Rosi Bu Dina"), "Rosi Bu Dina");

  // ── The dangerous direction ──
  // Juni, Mei, Desi and Agus are ordinary Indonesian names. The rule is
  // only safe because a digit day is required in front of the month.
  // If any of these ever start failing, the regex has become greedy and
  // is eating real names.
  eq("Juni is a name, not a month", c("Juni"), "Juni");
  eq("Mei is a name", c("Mei Ling"), "Mei Ling");
  eq("Desi is a name", c("Desi"), "Desi");
  eq("Agus is a name", c("Agus"), "Agus");
  eq("Agustina is a name", c("Agustina"), "Agustina");
  eq("Ibu Juni keeps the name Juni", c("Ibu Juni"), "Juni");
  eq("Julia is a name", c("Julia"), "Julia");

  // The dangerous direction for the HONORIFIC rule: these all start
  // with the letters of a title. The [\s.] guard is the only thing
  // keeping them whole. If any of these fail, real guests are being
  // renamed and nothing in the UI would show it.
  eq("Budi is not 'Bu'", c("Budi"), "Budi");
  eq("Bunga is not 'Bu'", c("Bunga"), "Bunga");
  eq("Masayu is not 'Mas'", c("Masayu"), "Masayu");
  eq("Ibrahim is not 'Ib'", c("Ibrahim"), "Ibrahim");
  eq("Ibunda is not 'Ibu'", c("Ibunda Rara"), "Ibunda Rara");
  eq("Bpk-like name is not 'Bp'", c("Bpandi"), "Bpandi");
  eq("Pakis is not 'Pak'", c("Pakis Dewi"), "Pakis Dewi");
  eq("Kakan is not 'Kak'", c("Kakan Wijaya"), "Kakan Wijaya");
  eq("Mbah is not 'Mba'", c("Mbah Karyo"), "Mbah Karyo");
  eq("Drajat is not 'Dr'", c("Drajat"), "Drajat");
  eq("Drs is not 'Dr'", c("Drs Bambang"), "Drs Bambang");
  eq("Dokterandi is not 'Dokter'", c("Dokterandi"), "Dokterandi");

  // Numeric date forms.
  eq("slashes", c("Tono 13/7/26"), "Tono");
  eq("hyphens with full year", c("Tini 13-07-2026"), "Tini");
  eq("day and month only", c("Toni 13/07"), "Toni");

  // Degenerate input must never throw.
  eq("empty", c(""), "");
  eq("null", c(null), "");
  eq("undefined", c(undefined), "");
  eq("only a date leaves nothing", c("13 Jul 26"), "");
}

console.log("\n── the greeting a guest actually reads ──");
{
  const g = ctx.waGreetName;
  eq("date stripped before greeting", g("Reni 1 Agust 26"), "Bapak/Ibu Reni");
  eq("plain name gets the honorific", g("Andini 13 Jul 26"), "Bapak/Ibu Andini");
  eq("empty name falls back", g(""), "Bapak/Ibu");
  eq("name that is only a date falls back", g("13 Jul 26"), "Bapak/Ibu");

  // Since 2026-08-09 the honorific is stripped by waCleanGuestName,
  // so every guest gets ONE consistent "Bapak/Ibu" here instead of
  // whatever title Front Desk happened to type. The old behaviour
  // ("Halo Bpk Troy") was correct but inconsistent — three spellings
  // of the same title reached three guests on the same broadcast.
  eq("Bpk", g("Bpk Troy 17 Jul"), "Bapak/Ibu Troy");
  eq("Bp.", g("Bp. Sentanu 9 Jul 26"), "Bapak/Ibu Sentanu");
  eq("Bp without the dot", g("Bp Yanto 2 Jul 26"), "Bapak/Ibu Yanto");
  eq("Ibu (40 real guests)", g("Ibu Arki 12 Juni"), "Bapak/Ibu Arki");
  eq("Bapak (10 real guests)", g("Bapak Nurul 15 Jun 26"), "Bapak/Ibu Nurul");
  eq("Kak", g("Kak Vina 3 Jul 26"), "Bapak/Ibu Vina");
  eq("Mas", g("Mas Adi 4 Jul 26"), "Bapak/Ibu Adi");
  eq("Mrs.", g("Mrs. Lee 5 Jul 26"), "Bapak/Ibu Lee");
  eq("already Bapak/Ibu is not doubled", g("Bapak/Ibu Rangga"), "Bapak/Ibu Rangga");

  // Doctors keep their title and must NOT also get "Bapak/Ibu" —
  // "Halo Bapak/Ibu dr. Suma" is exactly the stiffness this avoids.
  eq("dr. (6 real guests)", g("dr. Suma 2 Jul 26"), "dr. Suma");
  eq("Dokter normalised then greeted", g("Dokter Asa"), "dr. Asa");
  eq("Dr without the dot", g("Dr Erryl (Loyal Cust)"), "dr. Erryl");
  // The bare "Dr" row is left for manual fixing, so it must still
  // produce a sane greeting rather than a blank or a dangling "dr.".
  eq("bare Dr still greets", g("Dr"), "Dr");

  // The dangerous direction again: an honorific must not swallow a
  // real name that merely starts with the same letters.
  eq("Budi is not 'Bu'", g("Budi 6 Jul 26"), "Bapak/Ibu Budi");
  eq("Masayu is not 'Mas'", g("Masayu 7 Jul 26"), "Bapak/Ibu Masayu");
  eq("Bunga is not 'Bu'", g("Bunga 8 Jul 26"), "Bapak/Ibu Bunga");
  eq("Irma is not 'Ir'", g("Irma 9 Jul 26"), "Bapak/Ibu Irma");
  eq("Omar is not 'Om'", g("Omar 10 Jul 26"), "Bapak/Ibu Omar");
  eq("Bunda is stripped like the rest", g("Bunda Sari 11 Jul 26"), "Bapak/Ibu Sari");
}

console.log("\n── ceCardTextGuard ──");
{
  const g = ctx.ceCardTextGuard;
  const IMG = "c/1.jpg";

  // The failure that actually shipped, five times.
  const noTitle = g({ promo_image_path: IMG, promo_title: null, promo_description: "x" });
  ok("image + no title is blocked", !!noTitle);
  // Was asserting the literal "Blue Heron". The fallback title is now
  // per-deployment, so assert the guard explains WHY instead of naming
  // one restaurant.
  ok(
    "the reason points at the default title",
    /judul default/i.test(noTitle || ""),
  );

  ok(
    "image + title but no description is blocked",
    !!g({ promo_image_path: IMG, promo_title: "Promo Burger", promo_description: null }),
  );
  eq(
    "image + both filled passes",
    g({ promo_image_path: IMG, promo_title: "Promo Burger", promo_description: "Sampai 15 Agustus" }),
    null,
  );

  // No image means no card, so there is nothing to title. Requiring it
  // there would block plain-text campaigns for no reason.
  eq("no image, no title needed", g({ promo_image_path: null }), null);
  eq("no image with empty strings still fine", g({ promo_image_path: "", promo_title: "" }), null);
  eq("null campaign is safe", g(null), null);
  eq("undefined campaign is safe", g(undefined), null);
  eq("empty object is safe", g({}), null);

  // Whitespace is not a title. Ops pressing space to dismiss a required
  // field is exactly the kind of thing that ships a blank card.
  ok(
    "whitespace-only title rejected",
    !!g({ promo_image_path: IMG, promo_title: "   ", promo_description: "x" }),
  );
  ok(
    "whitespace-only description rejected",
    !!g({ promo_image_path: IMG, promo_title: "x", promo_description: "\n\t " }),
  );

  // Title is checked before description, so ops fixes the more
  // important field first rather than being sent back twice.
  const both = g({ promo_image_path: IMG, promo_title: "", promo_description: "" });
  ok("title error takes priority over description", (both || "").includes("Judul"));
}

console.log("\n── short promo path ──");
{
  eq(
    "uses /p/ not /promo/",
    ctx.cePromoUrl({ slug: "steak-agustus" }),
    "https://your-site.example/p/steak-agustus",
  );
  ok(
    "no random suffix when the slug is clean",
    !/-[a-z0-9]{6}$/.test(ctx.cePromoUrl({ slug: "steak-agustus" })),
  );

  // Slugs still have to survive being a URL path segment.
  eq("spaces become hyphens", ctx.ceSlugify("Steak Agustus"), "steak-agustus");
  eq("accents and symbols stripped", ctx.ceSlugify("Promo Spesial! 50%"), "promo-spesial-50");
  ok("always lowercase", ctx.ceSlugify("STEAK") === "steak");
  ok(
    "no leading or trailing hyphen ever reaches a URL",
    !/^-|-$/.test(ctx.ceSlugify("--Steak--")),
  );
}

console.log("\n── reserved slugs cannot hijack a real page ──");
{
  // A campaign named "Reserve" must not generate /p/reserve and shadow
  // the booking form. ceUniqueSlug is async and hits the DB, so this
  // tests the list it consults rather than the function itself.
  const reserved = ctx.CE_RESERVED_SLUGS;
  ok("reserved list exists", Array.isArray(reserved) && reserved.length > 0);
  ["reserve", "promo", "p", "spin", "admin"].forEach((s) => {
    ok(`${s} is reserved`, reserved.includes(s));
  });
  ok("a normal campaign name is not reserved", !reserved.includes("steak-agustus"));
}

// ============================================================
// WHATSAPP IMAGE LIMITS (2026-08-01)
// ------------------------------------------------------------
// A 2 MB PNG rendered as a tiny thumbnail instead of the full-width
// card. WhatsApp drops or degrades previews over 600 KB. The app used
// to allow 3 MB — five times what WhatsApp would actually render.
// ============================================================

console.log("\n── promo image size constants ──");
{
  const WHATSAPP_CLIFF = 600 * 1024;

  ok(
    "target is comfortably under WhatsApp's 600 KB cliff",
    ctx.CE_TARGET_BYTES < WHATSAPP_CLIFF,
  );
  eq("hard limit matches WhatsApp's documented cliff", ctx.CE_HARD_LIMIT_BYTES, WHATSAPP_CLIFF);
  ok(
    "there is real headroom, not a few bytes",
    WHATSAPP_CLIFF - ctx.CE_TARGET_BYTES >= 200 * 1024,
  );

  // The card must be wide enough for the LARGE preview. WhatsApp gives
  // a small thumbnail between 100 and 299 px and nothing below 100.
  ok("card width triggers the large preview", ctx.CE_CARD_W >= 300);
  ok("card height clears the 100 px floor", ctx.CE_CARD_H >= 100);
  eq("card is the standard 1200x630", `${ctx.CE_CARD_W}x${ctx.CE_CARD_H}`, "1200x630");

  // 1.91:1 is what the og: tags claim, so the canvas must actually
  // produce it or the tags are lying again.
  const ratio = ctx.CE_CARD_W / ctx.CE_CARD_H;
  ok("aspect ratio is ~1.91:1", Math.abs(ratio - 1.91) < 0.02, ratio);

  // The upload gate is now about catching mis-clicks, not about
  // WhatsApp — compression handles WhatsApp. But it must still be a
  // real ceiling.
  ok("upload ceiling still exists", ctx.CE_MAX_IMAGE_BYTES > 0);
  ok(
    "upload ceiling is larger than the output target, since we compress",
    ctx.CE_MAX_IMAGE_BYTES > ctx.CE_TARGET_BYTES,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
