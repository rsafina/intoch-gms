// Node test harness for the campaign attribution math.
// Run: node campaign.test.js
// Loads the real js/campaign.js — no copy-pasted logic, so a drift
// between this file and production is impossible.

global.ymd = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const C = require("./campaign.js");

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? "  → " + JSON.stringify(extra) : ""));
  }
}
function eq(name, a, b) {
  ok(name, a === b, { got: a, want: b });
}
function near(name, a, b, tol = 1e-6) {
  ok(name, Math.abs(a - b) <= tol, { got: a, want: b });
}

const CAMP = {
  id: "c1",
  name: "Promo Burger",
  segment: "medium_spender",
  template_key: "medium_spender",
  message_body: "Halo",
  started_at: "2026-07-01T03:00:00Z",
  ended_at: null,
};

// Helper builders
const send = (g, day) => ({ guest_id: g, sent_at: day + "T05:00:00+07:00" });
const aud = (g, has_wa = true) => ({ guest_id: g, has_wa });
const visit = (date, spend = 100000, notes = "") => ({ date, spend, notes });

console.log("\n── date helpers ──");
eq("addDays forward", C.campAddDays("2026-07-01", 14), "2026-07-15");
eq("addDays across month", C.campAddDays("2026-07-25", 14), "2026-08-08");
eq("addDays backward", C.campAddDays("2026-08-01", -14), "2026-07-18");
eq("addDays across year", C.campAddDays("2026-12-28", 14), "2027-01-11");
eq("median odd", C.campMedianDay(["2026-07-03", "2026-07-01", "2026-07-02"]), "2026-07-02");
eq("median even picks lower", C.campMedianDay(["2026-07-01", "2026-07-04"]), "2026-07-01");
eq("median empty", C.campMedianDay([]), null);

console.log("\n── window rules ──");
{
  const v = [visit("2026-07-01"), visit("2026-07-02"), visit("2026-07-15"), visit("2026-07-16")];
  const got = C.campVisitsInWindow(v, "2026-07-01", 14).map((x) => x.date);
  ok("same-day visit excluded", !got.includes("2026-07-01"), got);
  ok("day+1 included", got.includes("2026-07-02"), got);
  ok("day+14 included (inclusive end)", got.includes("2026-07-15"), got);
  ok("day+15 excluded", !got.includes("2026-07-16"), got);
}
{
  ok(
    "contamination inside window",
    C.campContaminated(["2026-07-05"], "2026-07-01", 14) === true,
  );
  ok(
    "contamination before window counts",
    C.campContaminated(["2026-06-25"], "2026-07-01", 14) === true,
  );
  ok(
    "contamination far outside ignored",
    C.campContaminated(["2026-05-01"], "2026-07-01", 14) === false,
  );
  ok("no other broadcasts", C.campContaminated(undefined, "2026-07-01", 14) === false);
}

console.log("\n── headline case: broadcast that worked ──");
{
  // 30 messaged (18 return), 40 not messaged (8 return)
  const sends = [];
  const audience = [];
  const visits = {};
  for (let i = 0; i < 30; i++) {
    const g = "t" + i;
    audience.push(aud(g));
    sends.push(send(g, "2026-07-01"));
    if (i < 18) visits[g] = [visit("2026-07-05", 200000, "Steak")];
  }
  for (let i = 0; i < 40; i++) {
    const g = "c" + i;
    audience.push(aud(g));
    if (i < 8) visits[g] = [visit("2026-07-06", 150000)];
  }
  const r = C.campComputeResult(CAMP, audience, sends, visits, {}, "2026-08-01");
  eq("recipients", r.n1, 30);
  eq("recipient returners", r.x1, 18);
  eq("control size", r.n2, 40);
  eq("control returners", r.x2, 8);
  near("treated rate", r.rateTreated, 0.6);
  near("control rate", r.rateControl, 0.2);
  near("lift", r.lift, 0.4);
  ok("significant", r.significant === true, { z: r.z });
  ok("not flagged too small", r.tooSmall === false);
  ok("mature (14d elapsed)", r.mature === true);
  eq("revenue", r.treatedRevenue, 18 * 200000);
  near("avg per returner", r.avgPerReturner, 200000);
  near("extra returners", r.extraReturners, 12);
  near("incremental revenue", r.incrementalRevenue, 12 * 200000);
  const v = C.campVerdict(r);
  eq("verdict tone", v.tone, "good");
  ok("verdict names both rates", /60%/.test(v.text) && /20%/.test(v.text), v.text);
  eq("returner detail rows", r.returners.length, 18);
  ok("returner carries visit notes", r.returners[0].visits[0].notes === "Steak");
}

console.log("\n── broadcast that did nothing ──");
{
  const sends = [], audience = [], visits = {};
  for (let i = 0; i < 40; i++) {
    const g = "t" + i;
    audience.push(aud(g)); sends.push(send(g, "2026-07-01"));
    if (i < 12) visits[g] = [visit("2026-07-05")];
  }
  for (let i = 0; i < 40; i++) {
    const g = "c" + i;
    audience.push(aud(g));
    if (i < 11) visits[g] = [visit("2026-07-05")];
  }
  const r = C.campComputeResult(CAMP, audience, sends, visits, {}, "2026-08-01");
  ok("not significant", r.significant === false, { z: r.z });
  eq("verdict tone neutral", C.campVerdict(r).tone, "neutral");
  ok("verdict says kebetulan", /kebetulan/.test(C.campVerdict(r).text));
}

console.log("\n── broadcast that backfired ──");
{
  const sends = [], audience = [], visits = {};
  for (let i = 0; i < 60; i++) {
    const g = "t" + i;
    audience.push(aud(g)); sends.push(send(g, "2026-07-01"));
    if (i < 6) visits[g] = [visit("2026-07-05")];
  }
  for (let i = 0; i < 60; i++) {
    const g = "c" + i;
    audience.push(aud(g));
    if (i < 24) visits[g] = [visit("2026-07-05")];
  }
  const r = C.campComputeResult(CAMP, audience, sends, visits, {}, "2026-08-01");
  ok("negative lift", r.lift < 0, r.lift);
  eq("verdict tone bad", C.campVerdict(r).tone, "bad");
  ok("incremental revenue negative", r.incrementalRevenue < 0, r.incrementalRevenue);
}

console.log("\n── small sample is refused, not reported ──");
{
  const sends = [], audience = [], visits = {};
  for (let i = 0; i < 6; i++) {
    const g = "t" + i;
    audience.push(aud(g)); sends.push(send(g, "2026-07-01"));
    if (i < 5) visits[g] = [visit("2026-07-05")];
  }
  for (let i = 0; i < 6; i++) audience.push(aud("c" + i));
  const r = C.campComputeResult(CAMP, audience, sends, visits, {}, "2026-08-01");
  ok("flagged too small", r.tooSmall === true);
  const v = C.campVerdict(r);
  eq("tone neutral despite 83% vs 0%", v.tone, "neutral");
  ok("verdict says data kecil", /masih kecil/.test(v.text), v.text);
}

console.log("\n── dedupe, anchoring, contamination, reachability ──");
{
  const audience = [aud("g1"), aud("g2"), aud("g3", false), aud("g4"), aud("g5")];
  const sends = [
    send("g1", "2026-07-10"),
    send("g1", "2026-07-03"), // earlier resend — should become the anchor
    send("g2", "2026-07-04"),
  ];
  const visits = {
    g1: [visit("2026-07-09")], // in window only if anchored to 03 Jul (not 10 Jul)
    g4: [visit("2026-07-06")],
    g5: [visit("2026-07-06")],
  };
  const otherBc = { g4: ["2026-07-02"] }; // g4 got a different blast
  const r = C.campComputeResult(CAMP, audience, sends, visits, otherBc, "2026-08-01");
  eq("duplicate send counts once", r.n1, 2);
  eq("anchored to earliest send", r.x1, 1);
  eq("control excludes sent + no-wa + contaminated", r.n2, 1);
  eq("control returner", r.x2, 1);
  eq("no-wa skipped count", r.controlSkippedNoWa, 1);
  eq("contaminated skipped count", r.controlSkippedContaminated, 1);
  eq("median of 03/04 Jul", r.medianDay, "2026-07-03");
  eq("audience total unchanged", r.audienceTotal, 5);
}

console.log("\n── maturity ──");
{
  const audience = [aud("t1"), aud("c1")];
  const sends = [send("t1", "2026-07-28")];
  const r = C.campComputeResult(CAMP, audience, sends, {}, {}, "2026-08-01");
  ok("not mature yet", r.mature === false);
  eq("matures on send+14", r.matureOn, "2026-08-11");
  eq("days left", r.daysLeft, 10);
  const r2 = C.campComputeResult(CAMP, audience, sends, {}, {}, "2026-08-11");
  ok("mature on the day", r2.mature === true);
  eq("days left zero", r2.daysLeft, 0);
}
{
  // A campaign still open with a late straggler send must reset maturity
  const audience = [aud("t1"), aud("t2"), aud("c1")];
  const sends = [send("t1", "2026-07-01"), send("t2", "2026-07-30")];
  const r = C.campComputeResult(CAMP, audience, sends, {}, {}, "2026-08-01");
  ok("last send drives maturity", r.mature === false);
  eq("lastSendDay", r.lastSendDay, "2026-07-30");
}

console.log("\n── degenerate inputs ──");
{
  const r = C.campComputeResult(CAMP, [aud("a"), aud("b")], [], {}, {}, "2026-08-01");
  eq("no sends → n1 0", r.n1, 0);
  eq("no sends → no control measured", r.n2, 0);
  eq("no sends → lift null", r.lift, null);
  eq("verdict", C.campVerdict(r).text, "Belum ada pesan yang dikirim di campaign ini.");
}
{
  // Everyone in the segment got messaged — no control group exists
  const audience = [aud("t1"), aud("t2")];
  const sends = [send("t1", "2026-07-01"), send("t2", "2026-07-01")];
  const r = C.campComputeResult(CAMP, audience, sends, { t1: [visit("2026-07-03")] }, {}, "2026-08-01");
  eq("no control", r.n2, 0);
  eq("control rate null", r.rateControl, null);
  eq("lift null", r.lift, null);
  eq("incremental null", r.incrementalRevenue, null);
  ok("verdict warns no comparison", /tidak ada pembanding/.test(C.campVerdict(r).text));
}
{
  // Missing audience snapshot (insert failed at campaign start)
  const sends = [send("t1", "2026-07-01")];
  const r = C.campComputeResult(CAMP, [], sends, { t1: [visit("2026-07-03", 50000)] }, {}, "2026-08-01");
  eq("still counts the send", r.n1, 1);
  eq("still counts the return", r.x1, 1);
  eq("revenue survives", r.treatedRevenue, 50000);
  eq("no control", r.n2, 0);
}
{
  // Guest returned multiple times in the window — one returner, all spend
  const r = C.campComputeResult(
    CAMP, [aud("t1")], [send("t1", "2026-07-01")],
    { t1: [visit("2026-07-03", 100000), visit("2026-07-10", 250000), visit("2026-07-20", 999999)] },
    {}, "2026-08-01",
  );
  eq("one returner", r.x1, 1);
  eq("both in-window visits counted", r.treatedRevenue, 350000);
  eq("out-of-window visit excluded", r.returners[0].visits.length, 2);
}
{
  // Zero-spend visit still counts as a return
  const r = C.campComputeResult(
    CAMP, [aud("t1"), aud("c1")], [send("t1", "2026-07-01")],
    { t1: [visit("2026-07-03", 0)] }, {}, "2026-08-01",
  );
  eq("zero-spend return counted", r.x1, 1);
  eq("revenue zero", r.treatedRevenue, 0);
  eq("avg per returner zero, no NaN", r.avgPerReturner, 0);
}

console.log("\n── message versions ──");
{
  // 20 got version 1 (6 returned), 20 got version 2 (14 returned)
  const sends = [], audience = [], visits = {};
  const mk = (prefix, version, n, returners) => {
    for (let i = 0; i < n; i++) {
      const g = prefix + i;
      audience.push(aud(g));
      sends.push({ ...send(g, "2026-07-01"), message_version: version });
      if (i < returners) visits[g] = [visit("2026-07-05", 300000)];
    }
  };
  mk("v1-", 1, 20, 6);
  mk("v2-", 2, 20, 14);
  for (let i = 0; i < 40; i++) audience.push(aud("c" + i));

  const r = C.campComputeResult(CAMP, audience, sends, visits, {}, "2026-08-01");
  eq("two versions detected", r.versions.length, 2);
  eq("v1 recipients", r.versions[0].n, 20);
  eq("v1 returners", r.versions[0].x, 6);
  eq("v2 recipients", r.versions[1].n, 20);
  eq("v2 returners", r.versions[1].x, 14);
  near("v1 rate", r.versions[0].rate, 0.3);
  near("v2 rate", r.versions[1].rate, 0.7);
  eq("v2 revenue", r.versions[1].revenue, 14 * 300000);
  eq("versions sum to the headline", r.versions.reduce((s, v) => s + v.n, 0), r.n1);
  eq("returners sum to the headline", r.versions.reduce((s, v) => s + v.x, 0), r.x1);
}
{
  // A resend on a NEWER version must not move the guest: they are
  // anchored to the version they first received.
  const audience = [aud("g1"), aud("c1")];
  const sends = [
    { ...send("g1", "2026-07-10"), message_version: 2 },
    { ...send("g1", "2026-07-02"), message_version: 1 },
  ];
  const r = C.campComputeResult(CAMP, audience, sends, {}, {}, "2026-08-01");
  eq("one recipient", r.n1, 1);
  eq("one version bucket", r.versions.length, 1);
  eq("anchored to the first version received", r.versions[0].version, 1);
}
{
  // Sends written before message_version existed default to 1 rather
  // than vanishing from the breakdown.
  const audience = [aud("g1"), aud("g2"), aud("c1")];
  const sends = [send("g1", "2026-07-01"), send("g2", "2026-07-01")];
  const r = C.campComputeResult(CAMP, audience, sends, {}, {}, "2026-08-01");
  eq("legacy sends bucket into version 1", r.versions[0].version, 1);
  eq("all counted", r.versions[0].n, 2);
  eq("single version means no breakdown shown", r.versions.length, 1);
}

console.log("\n── promo link: {link} placeholder ──");
{
  const body = "Halo {nama}!\n\nAda promo burger.\n\n{link}\n\nDitunggu ya!";
  const url = "https://your-site.example/p/burger-agustus";
  ok("link substituted", C.campApplyLink(body, url).includes(url));
  ok(
    "only one link in message",
    (C.campApplyLink(body, url).match(/https:/g) || []).length === 1,
  );
  const stripped = C.campApplyLink(body, null);
  ok("placeholder gone when no url", !stripped.includes("{link}"));
  ok("no stranded blank gap", !/\n\n\n/.test(stripped), stripped);
  ok("rest of message intact", stripped.includes("Ada promo burger.") && stripped.includes("Ditunggu ya!"));
  eq("trailing {link} leaves no trailing blank line",
     C.campApplyLink("Halo!\n\n{link}", null), "Halo!");
  eq("body without placeholder untouched",
     C.campApplyLink("Halo {nama}!", url), "Halo {nama}!");
  eq("empty body safe", C.campApplyLink("", url), "");
  eq("null body safe", C.campApplyLink(null, null), "");
}

console.log("\n── promo link: URL validation ──");
{
  const good = "https://your-site.example/p/burger-agustus";
  eq("valid short promo url", C.campValidatePromoUrl(good), null);
  eq("empty is allowed (optional)", C.campValidatePromoUrl(""), null);
  eq("whitespace only is allowed", C.campValidatePromoUrl("   "), null);
  ok("http rejected", /https:\/\//.test(C.campValidatePromoUrl("http://your-site.example/p/x")));
  ok("trailing .html caught with its own message",
     /\.html/.test(C.campValidatePromoUrl(good + ".html")));
  ok("foreign domain rejected",
     C.campValidatePromoUrl("https://evil.example.com/p/burger") !== null);
  ok("non-promo path on our own domain rejected",
     C.campValidatePromoUrl("https://your-site.example/reserve") !== null);
  ok("bare domain rejected",
     C.campValidatePromoUrl("https://your-site.example") !== null);
  ok("uppercase slug rejected (Netlify paths are case-sensitive)",
     /huruf kecil/.test(C.campValidatePromoUrl("https://your-site.example/p/Burger") || ""));
  ok("query string rejected",
     C.campValidatePromoUrl(good + "?utm=x") !== null);
  ok("nested path rejected",
     C.campValidatePromoUrl("https://your-site.example/p/a/b") !== null);

  // OLD LINKS MUST KEEP VALIDATING. Guests have /promo/ URLs sitting in
  // their WhatsApp history; if ops pastes one back in, rejecting it
  // would be wrong — the redirect still serves those.
  eq("legacy /promo/ url still valid",
     C.campValidatePromoUrl("https://your-site.example/promo/burger-agustus"), null);
  eq("legacy domain still valid",
     C.campValidatePromoUrl("https://your-site.example/p/burger-agustus"), null);
  ok("legacy uppercase slug still caught",
     /huruf kecil/.test(C.campValidatePromoUrl("https://your-site.example/promo/Burger") || ""));

  // A path that merely starts with p must not sneak through.
  ok("/pages/ rejected",
     C.campValidatePromoUrl("https://your-site.example/pages/burger") !== null);
  ok("/private/ rejected",
     C.campValidatePromoUrl("https://your-site.example/private/burger") !== null);
}

console.log("\n── z-score guards ──");
eq("empty group → null", C.campZScore(0, 0, 3, 10), null);
eq("nobody returned anywhere → null", C.campZScore(0, 10, 0, 10), null);
eq("everybody returned → null", C.campZScore(10, 10, 10, 10), null);
ok("symmetric", Math.abs(C.campZScore(18, 30, 8, 40) + C.campZScore(8, 40, 18, 30)) < 1e-9);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
