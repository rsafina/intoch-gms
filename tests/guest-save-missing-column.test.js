// A client database that has not had the latest ALL_IN_ONE run is missing
// whichever column this app version added last, and PostgREST rejects the
// WHOLE update for one unknown column. The guest form then silently stops
// saving anything.
//
// This is not hypothetical. On 2026-09-02, hours after guests.last_order was
// added to the guest payload, an allergy typed into the guest form never
// reached the database and the reservation card showed no allergy. The form
// looked like it worked.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs
  .readFileSync(path.join(__dirname, "..", "js/app.js"), "utf8")
  .replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};

const m = src.match(/^function guestMissingColumnFrom\([\s\S]*?^}/m);
if (!m) throw new Error("could not slice guestMissingColumnFrom out of app.js");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(m[0], ctx);
const detect = ctx.guestMissingColumnFrom;

const payload = {
  name: "Alia",
  food_allergy: "Kacang",
  favorite_menu: "Nasi Goreng",
  last_order: "Sate Ayam",
};

console.log("\nThe missing column is identified from either error shape");

check("PGRST204 schema-cache wording", () => {
  const e = { code: "PGRST204", message: "Could not find the 'last_order' column of 'guests' in the schema cache" };
  assert.strictEqual(detect(e, payload), "last_order");
});

check("Postgres 42703 wording", () => {
  const e = { code: "42703", message: 'column "last_order" of relation "guests" does not exist' };
  assert.strictEqual(detect(e, payload), "last_order");
});

check("it finds whichever column is named, not always the newest", () => {
  const e = { code: "PGRST204", message: "Could not find the 'favorite_menu' column of 'guests' in the schema cache" };
  assert.strictEqual(detect(e, payload), "favorite_menu");
});

console.log("\nIt never quietly deletes a field for an unrelated failure");

check("a network error drops nothing", () => {
  assert.strictEqual(detect({ message: "Failed to fetch" }, payload), null);
});

check("a permission error drops nothing", () => {
  assert.strictEqual(detect({ code: "42501", message: "new row violates row-level security policy" }, payload), null);
});

check("a column error naming something we did NOT send drops nothing", () => {
  // Otherwise a constraint elsewhere could silently strip a real edit.
  const e = { code: "42703", message: 'column "store_id" of relation "guests" does not exist' };
  assert.strictEqual(detect(e, payload), null);
});

check("no error at all", () => {
  assert.strictEqual(detect(null, payload), null);
});

console.log("\nsaveGuest retries once and says what was skipped");

check("the retry drops only the offending key and re-saves", () => {
  const i = src.indexOf("async function saveGuest");
  const body = src.slice(i, src.indexOf("\n}", src.indexOf("hideModal(\"modal-guest\")", i)));
  assert.ok(body.includes("guestMissingColumnFrom"), "no detection in saveGuest");
  assert.ok(body.includes("delete retryPayload[missingColumn]"), "does not drop the column before retrying");
  assert.ok(/ALL_IN_ONE\.sql/.test(body), "the message does not say how to fix it");
  // One retry, not a loop: a second missing column is a database that is far
  // enough behind that the operator needs to run the migration, not an app
  // that should keep whittling the payload down.
  // Two CALLS: the first attempt and exactly one retry. The helper is defined
  // as `const saveGuestRow = (body) =>`, which this pattern does not match.
  assert.strictEqual((body.match(/saveGuestRow\(/g) || []).length, 2, "expected one call plus one retry, not a loop");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
