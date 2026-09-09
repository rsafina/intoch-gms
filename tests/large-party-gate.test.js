// The managed-event flow: a party too big to book online is SAVED as a
// waitlist request with optional WhatsApp contact after confirmation.
//
// The rule, decided 2026-09-07, replacing the 2026-09-06 one: above
// reservation_hours.max_pax the form switches to a short handoff (name, phone,
// pax, area, date, rough time), saves the row — the server marks it
// Waitlist / over_max_pax, so it holds no table — and then shows confirmation with an optional WhatsApp button.
//
// The reversal is deliberate. Creating nothing meant that a guest who never
// sent the message left no trace at all, and staff had nobody to chase.
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

// ── Saved, then handed over ───────────────────────────────────────────────
console.log("\nA large party is saved AND handed over");
const submitFn = form.slice(form.indexOf("$(\"res-form\").addEventListener"));
ok(
  "the WhatsApp link is built before the booking call",
  submitFn.indexOf("largePartyWaLink()") > -1 &&
    submitFn.indexOf("largePartyWaLink()") <
      submitFn.indexOf("create_public_reservation"),
  "The link reads the form fields. Building it after the redirect has " +
    "started gives a message with empty name, date and time.",
);
ok(
  "submit no longer returns early for a large party",
  !/if \(largePartyGate\(\)\) \{\s*openLargePartyWa\(\);\s*return;/.test(form),
  "That was the 2026-09-06 rule. Keeping it would mean the row this flow now " +
    "depends on is never written.",
);
ok(
  "submitting never opens WhatsApp automatically",
  !/window\.open\(/.test(submitFn) && !/openLargePartyWa/.test(form),
);
ok(
  "success navigates to the confirmation page",
  /window\.location\.href = "reservation-created.html"/.test(submitFn),
);
ok(
  "the confirmation button uses the saved representative link",
  /bhPublicResWa/.test(form) && /wa\.href = handoff/.test(read("reservation-created.template.html")),
);
ok(
  "the submit button describes saving a request",
  /submit\.dataset\.i18nEn = big \|\| areaTimeBlocked\([^\n]+\) \? "Submit request"/.test(form),
);

// ── The waitlist keeps its other reasons ──────────────────────────────────
console.log("\nThe waitlist still catches everything else");
ok(
  "the server still waitlists on min_pax and capacity",
  /below_min_pax/.test(sql) && /over_capacity/.test(sql),
  "Large parties are only one reason a booking waits for a human. Removing " +
    "the others would silently accept bookings no area can seat.",
);
ok(
  "the server rule is what makes the saved row a request",
  /over_max_pax/.test(sql),
  "The page saves an ordinary booking and the server downgrades it. If this " +
    "went, every large party would be written as a confirmed reservation.",
);
ok(
  "the confirmation page already words over_max_pax for a guest",
  /over_max_pax/.test(read("reservation-created.template.html")),
  "The row is a request, and the page the guest lands on must say so rather " +
    "than 'Reservation Created'.",
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
  "For larger parties, submit your request first. You can then contact our representative on WhatsApp from the confirmation page.",
  "Submit request",
  "Preferred time (we will confirm)",
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
  "the time picker is kept, and relabelled so it does not read as booked",
  /Preferred time \(we will confirm\)/.test(form) &&
    !/time-field[\s\S]{0,80}gate \? "none"/.test(form),
  "reservation_time cannot be null. Hiding the picker would mean inventing " +
    "an hour, and a made-up hour is indistinguishable from a real one in the " +
    "day view.",
);
ok(
  "the optional boxes are restored to what the RESTAURANT configured",
  /SHOW_NOTES && !gate/.test(form) && /SHOW_COMPANY && !gate/.test(form),
  "Restoring them to 'shown' would switch on a Company field the restaurant " +
    "deliberately turned off, the moment a guest tried 20 and went back to 4.",
);
ok(
  "area is still asked for",
  !/area-field[\s\S]{0,80}gate \? "none"/.test(form),
  "Whether 20 people fit indoors is the first thing the person answering " +
    "WhatsApp needs to know.",
);

ok(
  "the stored link is cleared on an ordinary booking",
  /removeItem\("bhPublicResWa"\)/.test(form),
  "sessionStorage outlives the page. A guest who tried 25, then booked for " +
    "4, would otherwise land on a confirmation whose WhatsApp button carries " +
    "the earlier party's message to the events desk.",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
