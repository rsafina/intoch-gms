// Membership page name display. Same rule as the guest list: drop the
// leading title, keep everything after the name.
//
// membership.js cannot be loaded standalone, so memberReadingName is
// lifted out of the real file by name — a rename fails this test rather
// than silently passing on a stale copy.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS = path.join(__dirname, "..", "js");
const memSrc = fs.readFileSync(path.join(JS, "membership.js"), "utf8");
const waSrc = fs.readFileSync(path.join(JS, "wa.js"), "utf8");

const m = memSrc.match(/^function memberReadingName\([\s\S]*?^}/m);
if (!m) throw new Error("could not find memberReadingName() in membership.js");

const ctx = { console, document: { getElementById: () => null }, window: {} };
vm.createContext(ctx);
vm.runInContext(waSrc, ctx);
vm.runInContext(m[0], ctx);
const r = ctx.memberReadingName;

let pass = 0,
  fail = 0;
function eq(label, got, want) {
  if (got === want) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  → ${JSON.stringify({ got, want })}`);
  }
}

console.log("\n── every titled member in prod, 2026-08-09 ──");
{
  // All 26 real member full_names that carried a title, verbatim.
  const cases = [
    ["Bapak Ali", "Ali"],
    ["Bapak Andre", "Andre"],
    ["Bapak Dito", "Dito"],
    ["Bapak Nanang Tanabe", "Nanang Tanabe"],
    ["Bapak Prasetyo", "Prasetyo"],
    ["Bapak Reza", "Reza"],
    ["Bpk Hendi", "Hendi"],
    ["Dokter Asa", "dr. Asa"],
    ["Dokter Lucky", "dr. Lucky"],
    ["Ibu Alia", "Alia"],
    ["Ibu Ari", "Ari"],
    ["Ibu Diana", "Diana"],
    ["Ibu Ellen", "Ellen"],
    ["Ibu Gea", "Gea"],
    ["Ibu Ica", "Ica"],
    ["Ibu Jati", "Jati"],
    ["Ibu Lala", "Lala"],
    ["Ibu Meita", "Meita"],
    ["Ibu Monica", "Monica"],
    ["Ibu Nanik", "Nanik"],
    ["Ibu Ratna", "Ratna"],
    ["Ibu Riri", "Riri"],
    ["Ibu Salsa", "Salsa"],
    // The note stays — it is how staff tell members apart, same rule
    // as the guest list.
    ["Ibu Septi (Kesya)", "Septi (Kesya)"],
    ["Ibu Widya", "Widya"],
    ["Pak Yock", "Yock"],
  ];
  for (const [raw, want] of cases) eq(raw, r({ full_name: raw }), want);
}

console.log("\n── the untitled members must come through untouched ──");
{
  // These 8 are the rest of the prod member list. None should move.
  for (const n of [
    "Putri PT. Interbat",
    "Lanang PT Sintesa",
    "Puskopak DIY",
    "Bapa Tommy PT. Lapi",
    "Noel ( Loyal Cust )",
    "Mima (18 Jun 26)",
    "Anna Dewi ( Loyal Cust )",
    "Daniel ( Great Easttern Life )",
  ])
    eq(n, r({ full_name: n }), n);

  // "Bapa" is not in the strip list — it is one letter off "Bapak" and
  // could just as easily be a real name. Left alone on purpose.
  eq("'Bapa' is deliberately not stripped", r({ full_name: "Bapa Tommy PT. Lapi" }), "Bapa Tommy PT. Lapi");
}

console.log("\n── degenerate input must never blank a row ──");
{
  eq("null member", r(null), "");
  eq("no full_name", r({}), "");
  eq("empty name", r({ full_name: "" }), "");
  eq("title-only name survives", r({ full_name: "Ibu" }), "Ibu");
  eq("bare Dr survives", r({ full_name: "Dr" }), "Dr");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
