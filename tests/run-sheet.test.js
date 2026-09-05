// Day run sheet (2026-09-04).
//
// Two halves. The first exercises the pure builders with fixtures. The
// second asserts the WIRING, because the failure this feature can actually
// suffer is not a wrong number, it is a sheet that renders beautifully on
// screen and prints the whole app, or a row silently missing because a
// status list drifted.
//
// The status-list assertion is the important one. `Confirmed` was missing
// from RES_OCCUPANCY_STATUSES until this change; nothing set it, so nothing
// broke. It would have started dropping every paid booking off this sheet
// the moment a recorded deposit promoted a booking to Confirmed.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const rsSrc = fs.readFileSync(path.join(ROOT, "js", "runsheet.js"), "utf8");
const cfgSrc = fs.readFileSync(
  path.join(ROOT, "js", "config.template.js"),
  "utf8",
);

let pass = 0;
let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
function ok(label, cond) {
  eq(label, !!cond, true);
}

// ── Lift the pure builders, anchored to their own function bodies ──
// A bare indexOf on the file would happily slice from the wrong place if a
// name ever appears in a comment above its definition.
function lift(src, name) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find function ${name}() in runsheet.js`);
  return m[0];
}

const sandbox = {};
const load = new Function(
  "sandbox",
  `
  var CURRENT_LANG = "en";
  var t = function (s) { return s; };
  var allAreas = [];
  function formatGuestName(g) { return g && g.name ? g.name : "—"; }
  ${lift(rsSrc, "runSheetEscape")}
  ${lift(rsSrc, "runSheetRupiah")}
  ${lift(rsSrc, "runSheetNote")}
  ${lift(rsSrc, "runSheetAreaSummary")}
  ${lift(rsSrc, "runSheetDepositCell")}
  ${lift(rsSrc, "runSheetRow")}
  var RUN_SHEET_NOTE_MAX = ${/RUN_SHEET_NOTE_MAX = (\d+)/.exec(rsSrc)[1]};
  sandbox.setAreas = function (a) { allAreas = a; };
  sandbox.runSheetEscape = runSheetEscape;
  sandbox.runSheetNote = runSheetNote;
  sandbox.runSheetAreaSummary = runSheetAreaSummary;
  sandbox.runSheetDepositCell = runSheetDepositCell;
  sandbox.runSheetRow = runSheetRow;
  sandbox.runSheetRupiah = runSheetRupiah;
`,
);
load(sandbox);

sandbox.setAreas([
  { id: "a1", name: "Indoor", capacity: 40 },
  { id: "a2", name: "Outdoor Smoking", capacity: 20 },
  { id: "a3", name: "VIP Room", capacity: 12 },
]);

// ── Notes ──────────────────────────────────────────────────────────
eq("short note untouched", sandbox.runSheetNote("Birthday, needs cake"), "Birthday, needs cake");
eq("blank note becomes empty", sandbox.runSheetNote(null), "");
eq(
  "newlines and runs of spaces collapse to one space",
  sandbox.runSheetNote("Ulang   tahun\n\nbawa kue"),
  "Ulang tahun bawa kue",
);
const long = "x".repeat(200);
const cut = sandbox.runSheetNote(long);
eq("long note truncated to the cap", cut.length, 70);
ok("truncated note ends with an ellipsis", cut.endsWith("…"));

// ── Area summary ───────────────────────────────────────────────────
const rows = [
  { pax: 4, assigned_area: "a1" },
  { pax: 6, assigned_area: "a1" },
  { pax: 30, assigned_area: "a2" },
  { pax: 2, assigned_area: null },
  { pax: 3, assigned_area: null },
];
const summary = sandbox.runSheetAreaSummary(rows);
ok("Indoor shows its summed pax", summary.includes("10 pax · 2"));
ok("Outdoor Smoking shows its own line", summary.includes("30 pax · 1"));
ok("an area with no bookings is omitted entirely", !summary.includes("VIP Room"));
ok("unplaced bookings get their own cell", summary.includes("Not yet placed"));
ok("unplaced pax are summed separately", summary.includes("5 pax · 2"));

// The number staff will cross-check by eye: every booking is counted once,
// either against an area or against Not yet placed, and never both.
const counted = [...summary.matchAll(/(\d+) pax · (\d+)</g)].reduce(
  (acc, m) => ({ pax: acc.pax + Number(m[1]), count: acc.count + Number(m[2]) }),
  { pax: 0, count: 0 },
);
eq("summary pax equals the day's pax", counted.pax, 45);
eq("summary count equals the day's bookings", counted.count, rows.length);

eq("an empty day produces an empty summary, not a row of zeros", sandbox.runSheetAreaSummary([]), "");

// ── Deposit column, before phase 1 exists ──────────────────────────
eq(
  "a row with no deposit columns at all prints a dash",
  sandbox.runSheetDepositCell({ pax: 2 }),
  "—",
);
eq(
  "deposit_required false prints a dash",
  sandbox.runSheetDepositCell({ deposit_required: false, deposit_expected: 500000 }),
  "—",
);
eq(
  "deposit_required true prints the amount",
  sandbox.runSheetDepositCell({ deposit_required: true, deposit_expected: 500000 }),
  "DP Rp 500.000",
);
eq(
  "deposit required with no amount still prints the marker",
  sandbox.runSheetDepositCell({ deposit_required: true, deposit_expected: null }),
  "DP",
);

// ── Escaping ───────────────────────────────────────────────────────
const nastyRow = sandbox.runSheetRow({
  reservation_time: "19:30:00",
  pax: 4,
  notes: '<script>alert(1)</script>',
  guests: { name: 'Ibu <b>Anung</b>' },
  areas: { name: "Indoor" },
  tables: { name: "T4" },
});
ok("guest name is escaped", !nastyRow.includes("<b>Anung"));
ok("notes are escaped", !nastyRow.includes("<script>"));
ok("time is trimmed to HH:MM", nastyRow.includes(">19:30<"));

// ── Wiring ─────────────────────────────────────────────────────────
const statusLine = /const RES_OCCUPANCY_STATUSES = \[([^\]]*)\]/.exec(appSrc);
ok("RES_OCCUPANCY_STATUSES still exists in app.js", !!statusLine);
ok('occupancy statuses include "Confirmed"', /"Confirmed"/.test(statusLine[1]));
ok('occupancy statuses include "Reserved"', /"Reserved"/.test(statusLine[1]));

// The run sheet must never grow its own idea of who is still expected.
ok(
  "runsheet.js defines no status list of its own",
  !/\[\s*"Reserved"/.test(rsSrc),
);
ok("runsheet.js reads the shared constant", rsSrc.includes("RES_OCCUPANCY_STATUSES"));

// The print rule hides body's other children by selector, so the container
// has to be a direct child of body or printing produces a blank page.
// The print rule hides body's other children by selector, so the container
// has to be a DIRECT child of body or printing produces a blank page.
// Parsed as a real DOM rather than matched as a string: a string heuristic
// here would pass on markup that the browser nests differently.
const { JSDOM } = require("jsdom");
const doc = new JSDOM(html).window.document;
const rootEl = doc.getElementById("run-sheet-root");
ok("run-sheet-root exists in the parsed DOM", !!rootEl);
eq(
  "run-sheet-root's parent is body",
  rootEl && rootEl.parentElement && rootEl.parentElement.tagName,
  "BODY",
);
ok(
  "run-sheet-root starts hidden",
  rootEl && rootEl.classList.contains("hidden"),
);

ok(
  "the print rule that hides the app is present",
  html.includes('body.run-sheet-open > *:not(#run-sheet-root)'),
);
ok("rows are kept off page breaks", html.includes("page-break-inside: avoid"));
ok("runsheet.js is loaded by index.html", /<script src="js\/runsheet\.js/.test(html));
ok("the Run Sheet button calls openRunSheet", html.includes('onclick="openRunSheet()"'));

// ── Every visible string is translatable ───────────────────────────
// The app is authored in English and translated by walking the DOM against
// ID_DICT. A string with no entry silently stays English on an Indonesian
// sheet, which is exactly the sheet handed to security.
//
// SAME_IN_BOTH is not laziness: these words are identical in Indonesian, and
// an identity entry in ID_DICT is actively harmful. i18nTranslate() returns a
// value for any key it finds, i18nTranslateTree() assigns it to nodeValue,
// and the MutationObserver in i18n.js reschedules a full re-translate on any
// mutation. An identity mapping therefore rewrites a node with the value it
// already had, forever, with no fixpoint to settle on.
const SAME_IN_BOTH = new Set(["Pax", "Area", "Deposit", "DP"]);

const dictBody = cfgSrc.slice(cfgSrc.indexOf("const ID_DICT = {"));
function dictHas(key) {
  const quoted = `"${key}":`;
  const bare = new RegExp(
    `(?:^|[{,\\s])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`,
    "m",
  );
  return dictBody.includes(quoted) || bare.test(dictBody);
}

const missing = [];
for (const m of rsSrc.matchAll(/\bt\("([^"]+)"\)/g)) {
  const key = m[1];
  if (SAME_IN_BOTH.has(key)) continue;
  if (!dictHas(key)) missing.push(key);
}
eq("every t() string in runsheet.js has an ID_DICT entry", missing, []);
ok('the static "Run Sheet" button label is translatable', dictHas("Run Sheet"));
eq(
  "no word we call identical is also in the dictionary",
  [...SAME_IN_BOTH].filter(dictHas),
  [],
);

// ── No NEW identity mappings ───────────────────────────────────────
// Twelve already existed before this feature and are grandfathered rather
// than fixed here, because unpicking them is its own change with its own
// verification. This assertion exists so the count can only go down.
const GRANDFATHERED = [
  "Follow Up", "Branding", "Username *", "Thresholds", "Signature Dishes",
  "Via walk-in", "Total pax", "vs", "WhatsApp", "Instagram", "Status",
  "Total Pax",
];
const entryRe =
  /(?:^|\n)\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const identity = [];
for (const m of dictBody.matchAll(entryRe)) {
  const key = m[1] !== undefined ? m[1] : m[2];
  if (key === m[3]) identity.push(key);
}
eq(
  "no identity mapping beyond the twelve that predate this feature",
  identity.filter((k) => !GRANDFATHERED.includes(k)),
  [],
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
