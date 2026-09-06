// Phase 1 of the managed-event flow: a party too big to book online is handed
// to WhatsApp instead of becoming a reservation.
//
// The rule, decided 2026-09-06: above reservation_hours.max_pax the form
// creates NOTHING and shows a WhatsApp button. It replaces the waitlist for
// that one reason only — a party below min_pax, or an area over its capacity,
// still waitlists exactly as before. One number, one meaning.
//
// The gate is CLOSED only when the restaurant has both ticked the box and
// filled in a number. Ticking the box alone would otherwise make every large
// booking impossible with no way for the guest to tell anyone, which is worse
// than the behaviour it replaced.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");

const form = read("reserve.template.html");
const app = read("js/app.js");
const html = read("index.html");
const guestDict = read("js/guest-i18n.js");
const cfgTpl = read("js/config.template.js");
const cfgOut = read("js/config.js");
const sql = read("migrations/ALL_IN_ONE.sql");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// ── The retired hard cap ──────────────────────────────────────────────────
console.log("\nThe retired 20-pax cap is really gone");
// Comments stripped first. The function carries a comment explaining what the
// old "n <= 20" did, and grepping the raw text flagged that explanation as the
// very bug it documents.
const stripComments = (src) => src.replace(/\/\/[^\n]*/g, "");
const readPax = stripComments(
  form.slice(form.indexOf("function readPax()"), form.indexOf("function clampPax")),
);
ok(
  "readPax no longer rejects a party of 21",
  !/n <= 20/.test(readPax),
  "This line survived the 2026-09-05 change that replaced the hard cap with " +
    "max_pax, sitting three lines above the comment announcing the cap was " +
    "gone. It rejected, in the browser, exactly the large parties the " +
    "waitlist and this handoff exist to catch.",
);
ok(
  "readPax and clampPax agree on the upper bound",
  /n <= 999/.test(readPax) && /999/.test(stripComments(form.slice(form.indexOf("function clampPax"), form.indexOf("function paxStep")))),
  "A value clampPax happily writes into the field and readPax then calls " +
    "invalid is an unfixable error message: the guest is told the number is " +
    "wrong and the form keeps showing it.",
);

// ── The gate ──────────────────────────────────────────────────────────────
console.log("\nThe gate closes only when there is somewhere to send them");
const gate = form.slice(form.indexOf("function largePartyGate()"), form.indexOf("function largePartyWaLink"));
ok("largePartyGate exists", gate.length > 50);
ok(
  "the toggle alone is not enough",
  /LARGE_PARTY_WA &&/.test(gate) && /LARGE_PARTY_WA_NUMBER/.test(gate),
  "With the box ticked and no number, a large party could neither book nor " +
    "message anyone.",
);
ok("it only applies above max_pax", /MAX_PAX/.test(gate) && />\s*MAX_PAX/.test(gate));
ok(
  "a nonsense number is treated as no number",
  /LARGE_PARTY_WA_NUMBER\.length < 8/.test(form),
  'A wa.me link built from "0" opens a broken chat, which reads to the guest ' +
    "as the restaurant ignoring them.",
);
ok(
  "the number is reduced to digits before it reaches a wa.me URL",
  /large_party_wa_number \|\| ""\)\.replace\(\/\\D\/g, ""\)/.test(form),
);

// ── Nothing is created ────────────────────────────────────────────────────
console.log("\nA gated party creates nothing");
const submit = form.slice(form.indexOf("$(\"res-form\").addEventListener"), form.indexOf("create_public_reservation"));
ok(
  "submit refuses before it reaches the booking call",
  /largePartyGate\(\)/.test(submit),
  "A row created 'just in case' is a table held for a booking nobody agreed " +
    "to, and it lands in the normal list where staff will treat it as one.",
);
ok(
  "the guard is in submit, not only on the button",
  form.indexOf("largePartyGate()", form.indexOf("$(\"res-form\").addEventListener")) <
    form.indexOf("db.rpc(\"create_public_reservation\""),
  "This form submits on Enter in any field, so hiding the button guards " +
    "nothing.",
);
ok(
  "the submit button is hidden while the gate is closed, so the two agree",
  /btn-submit[\s\S]{0,120}gate \? "none" : ""/.test(form),
);

// ── The waitlist keeps its other reasons ──────────────────────────────────
console.log("\nThe waitlist still catches everything else");
ok(
  "the server still waitlists on min_pax and capacity",
  /below_min_pax/.test(sql) && /over_capacity/.test(sql),
  "The handoff replaces the over-max_pax reason only. Removing the others " +
    "would silently accept bookings no area can seat.",
);
ok(
  "the server rule is untouched by this change",
  /over_max_pax/.test(sql),
  "A restaurant that leaves the toggle off must behave exactly as it did " +
    "yesterday, which means the server path stays.",
);

// ── Settings ──────────────────────────────────────────────────────────────
console.log("\nThe setting exists on both sides and is spelled the same");
for (const key of ["large_party_wa", "large_party_wa_number"]) {
  ok(`${key} is a documented default in js/app.js`, new RegExp("\\b" + key + ":").test(app));
  ok(`${key} is read by the booking page`, new RegExp("v\\." + key).test(form));
  ok(`${key} is written by the settings save`, new RegExp(key + ":").test(app));
}
for (const id of ["rff-large-party-wa", "rff-large-party-wa-number"]) {
  ok(`#${id} exists in index.html`, new RegExp('id="' + id + '"').test(html));
}
ok(
  "the number field is disabled while the toggle is off",
  /function renderLargePartyWaState/.test(app) &&
    /el\.disabled = !on/.test(app.slice(app.indexOf("function renderLargePartyWaState"))),
  "A field that accepts typing nobody will ever read is a settings screen " +
    "that lies.",
);

// ── Every new phrase is translatable ──────────────────────────────────────
console.log("\nEvery new phrase is translatable");
const guestKeys = [
  "Parties of more than {n} are arranged with us directly. Tap below and we will help you plan it.",
  "Hello, I would like to arrange a booking for {n} guests.",
  "My name is {name}, for {date} at {time}.",
  "Chat with us on WhatsApp",
];
for (const k of guestKeys) {
  ok(`the guest dictionary has ${JSON.stringify(k.slice(0, 40))}…`, guestDict.includes(JSON.stringify(k)));
}
ok(
  "the WhatsApp message is built from whole sentences, not word fragments",
  !/gt\("Name"\)/.test(form) && !/gt\("Date"\)/.test(form) && !/gt\("Time"\)/.test(form),
  'Building it as gt("Name") + ": " + value gives a translator three words ' +
    "with no grammar, and Indonesian does not use the English order.",
);
const staffKeys = [
  "Send large parties to WhatsApp",
  "Country code first, no plus sign. Leave empty to keep the normal request flow.",
];
for (const [label, cfg] of [["config.template.js", cfgTpl], ["config.js", cfgOut]]) {
  for (const k of staffKeys) {
    ok(`${label} translates ${JSON.stringify(k.slice(0, 32))}…`, cfg.includes(JSON.stringify(k)));
  }
}

// ── The handoff never looks like a booking ────────────────────────────────
console.log("\nThe handoff never looks like a booking");
ok(
  "the WhatsApp button is not styled as the submit button",
  /id="pax-wa-btn"[\s\S]{0,200}class="btn-wa"/.test(form) &&
    !/id="pax-wa-btn"[\s\S]{0,200}class="[^"]*btn-submit/.test(form),
  "A guest who reads it as Submit will believe they have a reservation.",
);
ok(
  "the note tells them it is arranged directly, not that it is a request",
  /arranged with us directly/.test(form),
  "The waitlist wording ('goes in as a request') would promise a row that " +
    "this path deliberately never creates.",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
