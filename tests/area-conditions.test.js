// Area booking conditions and the two booking limits (phase 1, 2026-09-04).
//
// Deliberately no JSDOM. The failures this feature can actually suffer are
// not rendering failures, they are "the update path was patched and the
// insert path was forgotten", and "a cleared settings box silently takes
// online booking offline". Both are visible in the source.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cfgSrc = fs.readFileSync(path.join(ROOT, "js", "config.template.js"), "utf8");
const sqlSrc = fs.readFileSync(path.join(ROOT, "migrations", "ALL_IN_ONE.sql"), "utf8");

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}
const ok = (label, cond) => eq(label, !!cond, true);

// Anchored to the enclosing function, never a bare indexOf: a name that
// appears in a comment above its definition would slice from the wrong place.
function lift(name) {
  const re = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m");
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not find function ${name}() in app.js`);
  return m[0];
}
function body(name) {
  return lift(name);
}

const sandbox = {};
new Function("sandbox", `
  ${lift("areaParseRupiah")}
  ${lift("areaFormatRupiah")}
  sandbox.areaParseRupiah = areaParseRupiah;
  sandbox.areaFormatRupiah = areaFormatRupiah;
`)(sandbox);

console.log("\nRupiah is typed four different ways and all of them mean the same thing");
for (const input of ["1500000", "1.500.000", "Rp 1.500.000", "1,500,000", " Rp1500000 "]) {
  eq(`"${input}"`, sandbox.areaParseRupiah(input), 1500000);
}
eq("an empty box is no rule, not zero", sandbox.areaParseRupiah(""), null);
eq("null is no rule", sandbox.areaParseRupiah(null), null);
eq("zero typed on purpose is zero", sandbox.areaParseRupiah("0"), 0);
eq("formatting is the inverse", sandbox.areaFormatRupiah(1500000), "1.500.000");
eq("formatting nothing gives nothing", sandbox.areaFormatRupiah(null), "");

console.log("\nBoth save paths carry the new columns");
const save = body("saveArea");
for (const col of ["is_bookable_online", "min_pax", "min_spend", "deposit_pct"]) {
  // Twice: once in the update branch, once in the insert branch. Patching
  // only the update is the classic version of this bug, and it looks fine
  // until somebody creates a NEW area.
  eq(`${col} appears in both the update and the insert`, (save.match(new RegExp(col, "g")) || []).length >= 2, true);
}
ok("the save reads the bookable switch", save.includes('getElementById("area-bookable")'));
ok("rupiah goes through the shared parser", save.includes("areaParseRupiah("));

console.log("\nRules that cannot be satisfied are refused before they are saved");
ok(
  "a deposit percent with no minimum spend is blocked",
  /depPct !== null && minSpend === null/.test(save),
);
ok(
  "a minimum above the area's own capacity is blocked",
  /minPax !== null && capacity > 0 && minPax > capacity/.test(save),
);
ok("out-of-range deposit percent is blocked", /depPct < 0 \|\| depPct > 100/.test(save));

console.log("\nThe modal fills in what is already stored");
const open = body("openAreaModal");
for (const id of ["area-min-pax", "area-min-spend", "area-deposit-pct", "area-bookable"]) {
  ok(`${id} is populated when editing`, open.includes(id));
}
ok("stored rupiah is formatted for display", open.includes("areaFormatRupiah("));

console.log("\nThe booking limits fall back to the old hardcoded numbers");
// A cleared box must not become 0. `max_pax: 0` means no party may be larger
// than nobody, which takes online booking offline with nothing on screen
// saying why.
ok("largest party falls back to 20, not 0", /set-res-max-pax[\s\S]{0,200}\|\| 20/.test(appSrc));
ok("horizon falls back to 90, not 0", /set-res-max-days[\s\S]{0,200}\|\| 90/.test(appSrc));
ok("largest party is clamped to at least 1", /Math\.max\(\s*1,[\s\S]{0,160}set-res-max-pax/.test(appSrc));

console.log("\nThe settings row is still spread, not rebuilt");
// This key has already lost data once by being written as a fresh object.
const idx = appSrc.indexOf('key: "reservation_hours"');
const settingsBlock = appSrc.slice(idx, idx + 900);
ok("the existing value is spread first", settingsBlock.includes("...(APP_SETTINGS.reservation_hours || {})"));
ok("max_pax is saved", settingsBlock.includes("max_pax:"));
ok("max_days_ahead is saved", settingsBlock.includes("max_days_ahead:"));
ok("the weekly grid is still written", settingsBlock.includes("weekly:"));
ok("the pause switch is still written", settingsBlock.includes("online_paused:"));

console.log("\nThe screen has the fields the code reads");
for (const id of [
  "set-res-max-pax", "set-res-max-days",
  "area-bookable", "area-min-pax", "area-min-spend", "area-deposit-pct",
  "area-conditions-wrap",
]) {
  ok(`#${id} exists in index.html`, html.includes(`id="${id}"`));
}
ok(
  "the conditions block starts hidden",
  /id="area-conditions-wrap"[^>]*class="[^"]*hidden/.test(html),
);
ok("the switch is wired to the toggle", html.includes('onchange="onAreaBookableToggle()"'));

console.log("\nThe database agrees with the screen");
// The app writing a column the migration never created fails at runtime with
// a message nobody reading the UI would connect to a migration.
for (const col of ["min_pax", "min_spend", "deposit_pct", "is_bookable_online"]) {
  ok(`areas.${col} is created by the migration`, new RegExp(`add column if not exists ${col}\\b`, "i").test(sqlSrc));
}
for (const col of ["deposit_required", "deposit_expected", "deposit_rule_note"]) {
  ok(`reservations.${col} is created by the migration`, new RegExp(`add column if not exists ${col}\\b`, "i").test(sqlSrc));
}
ok(
  "the old booking function is dropped before the new one is created",
  /drop function if exists public\.create_public_reservation\(/i.test(sqlSrc),
);
ok(
  "is_bookable_online defaults to false so applying the file publishes nothing",
  /is_bookable_online boolean not null default false/i.test(sqlSrc),
);
ok(
  "the settings keys are merged, not assigned",
  /value \? 'max_pax'/.test(sqlSrc) && /value \? 'max_days_ahead'/.test(sqlSrc),
);

console.log("\nEvery new phrase is translatable, and none of them loop");
const dict = cfgSrc.slice(cfgSrc.indexOf("const ID_DICT = {"));
for (const phrase of [
  "Booking limits", "Largest party", "Guests can book this area online",
  "Minimum guests", "Minimum spend (Rp)", "Deposit (% of minimum spend)",
  "Bookable online", "Minimum guests must be 1 or more",
  "A deposit percentage needs a minimum spend to calculate from",
]) {
  ok(`"${phrase}" has an Indonesian entry`, dict.includes(`"${phrase}":`));
}
const GRANDFATHERED = [
  "Follow Up", "Branding", "Username *", "Thresholds", "Signature Dishes",
  "Via walk-in", "Total pax", "vs", "WhatsApp", "Instagram", "Status", "Total Pax",
];
const entryRe = /(?:^|\n)\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const identity = [];
for (const m of dict.matchAll(entryRe)) {
  const key = m[1] !== undefined ? m[1] : m[2];
  if (key === m[3]) identity.push(key);
}
eq("no new identity mapping", identity.filter((k) => !GRANDFATHERED.includes(k)), []);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
