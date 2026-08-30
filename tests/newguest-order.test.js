// The order of the New Reservation form when a NEW guest is being created.
//
// Rere's ask: name, then phone, then the booking itself (date, time, pax,
// area). Gender and company are not what anyone needs while a guest is on the
// phone, so they sit at the very bottom.
//
// The assertions are on DOM ORDER via compareDocumentPosition, not on where
// the strings happen to fall in the file. Markup order and visual order are
// the same thing here only because nothing reorders these with CSS, and this
// test is what would catch it if a grid or a flex `order` were ever added.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

const doc = new JSDOM(html).window.document;

let pass = 0,
  fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "  → " + detail : ""}`);
  }
}

const el = (id) => doc.getElementById(id);
// DOCUMENT_POSITION_FOLLOWING === 4
const before = (a, b) =>
  !!(el(a)?.compareDocumentPosition(el(b)) & 4);

const modal = el("modal-reservation");

console.log("\nField order");
ok("name comes before phone", before("res-name", "res-new-guest-phone"));
ok("phone comes before the date", before("res-new-guest-phone", "res-date"));
ok("date, time, pax and area stay together", before("res-date", "res-time") && before("res-time", "res-pax"));
ok("gender is below the booking details", before("res-pax", "res-gender"));
ok("company is below the booking details", before("res-pax", "res-company"));

// The point of the change: gender and company are the LAST thing in the form,
// not merely somewhere after the date.
const inputs = [...modal.querySelectorAll("input, select, textarea")].map((n) => n.id);
const tail = inputs.slice(-2).sort();
ok(
  "they are the final two fields in the modal",
  tail[0] === "res-company" && tail[1] === "res-gender",
  "last fields are: " + inputs.slice(-4).join(", "),
);

console.log("\nThe removed section");
ok(
  "the 'New Guest Profile' heading is gone",
  !modal.innerHTML.includes("New Guest Profile"),
);

console.log("\nBoth new-guest blocks are toggled together");
// Gender and company are read only by saveReservation()'s new-guest branch.
// Showing them for an EXISTING guest would offer two fields that are silently
// discarded on save, which is worse than not showing them at all.
ok("the extra block exists", !!el("res-new-guest-extra"));
ok("it ships hidden", el("res-new-guest-extra")?.classList.contains("hidden"));
ok(
  "the helper toggles both blocks",
  /function setResNewGuestVisible[\s\S]{0,400}?"res-new-guest"[\s\S]{0,200}?"res-new-guest-extra"/.test(
    appSrc,
  ),
);
// The only classList touch on #res-new-guest should be the one inside
// setResNewGuestVisible() itself. A second one somewhere else is how the two
// blocks drift apart and gender/company end up visible on their own.
const strayToggles = (
  appSrc.match(/getElementById\("res-new-guest"\)\??\.classList/g) || []
).length;
ok(
  "nothing toggles #res-new-guest behind the helper's back",
  strayToggles === 1,
  strayToggles + " direct classList calls, expected exactly 1 (the helper)",
);
// Guards a real trap: the walk-in form shares selectGuestFromSearch() through
// a `${prefix}-new-guest` template literal. If the reservation branch were
// dropped, picking an existing guest would hide name+phone and leave gender
// and company stranded on screen.
ok(
  "the shared prefix path special-cases the reservation form",
  /prefix === "res"\)\s*\{\s*setResNewGuestVisible\(false\);/.test(appSrc),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
