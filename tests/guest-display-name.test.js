// Guest name display: the honorific/date cleaner as it is actually
// wired into the app, not as it behaves in isolation.
//
// app.js cannot be loaded standalone (it touches the DOM at top level),
// so the four functions under test are lifted out of the real file by
// name. If any of them is renamed or deleted, this test fails loudly
// rather than silently passing on a stale copy.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS = path.join(__dirname, "..", "js");
const appSrc = fs.readFileSync(path.join(JS, "app.js"), "utf8");
const waSrc = fs.readFileSync(path.join(JS, "wa.js"), "utf8");

function lift(name) {
  // Grab `function name(...) { ... }` up to the closing brace in
  // column 0 — the file's own formatting convention.
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not find function ${name}() in app.js`);
  return m[0];
}

let hintEl = { textContent: "", classes: new Set(["hidden"]) };
const ctx = {
  console,
  document: {
    getElementById: (id) =>
      id === "g-name-hint"
        ? {
            get textContent() {
              return hintEl.textContent;
            },
            set textContent(v) {
              hintEl.textContent = v;
            },
            classList: {
              add: (c) => hintEl.classes.add(c),
              remove: (c) => hintEl.classes.delete(c),
            },
          }
        : null,
  },
  window: {},
};
vm.createContext(ctx);
vm.runInContext(waSrc, ctx);
vm.runInContext(
  `function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
   ${lift("guestAliasSuffix")}
   ${lift("guestReadingName")}
   ${lift("guestDisplayName")}
   ${lift("formatGuestName")}
   ${lift("updateGuestNameHint")}`,
  ctx,
);

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

console.log("\n── formatGuestName: what staff read in every list ──");
{
  const f = ctx.formatGuestName;
  eq("honorific dropped", f({ name: "Ibu Alia" }), "Alia");
  eq("doctor kept, normalised", f({ name: "Dokter Asa" }), "dr. Asa");
  eq("plain name untouched", f({ name: "Budi Santoso" }), "Budi Santoso");

  // ── THE RULE THAT MATTERS: the title goes, nothing after it does ──
  // Rere, 2026-08-09: "we wont change anything after the name, so only
  // honorific is okay, we dont touch what comes after the name at all".
  // These notes are how the host tells four different Sintas apart at
  // the door. If any of these start failing, staff have quietly lost
  // the information they use to avoid the July wrong-guest incident.
  eq("visit date SURVIVES", f({ name: "Bpk Troy 17 Jul" }), "Troy 17 Jul");
  eq("full date survives", f({ name: "Ibu Hesti 8 Agust 26" }), "Hesti 8 Agust 26");
  eq("company note survives", f({ name: "Bp. Rouf PT. Interbat" }), "Rouf PT. Interbat");
  eq("paren note survives", f({ name: "Ibu Clara (Loyal Cust)" }), "Clara (Loyal Cust)");
  eq("paren date survives", f({ name: "Ibu Arki (12 Juni)" }), "Arki (12 Juni)");
  eq("untitled name is byte-identical", f({ name: "Rini ( Kalbe )" }), "Rini ( Kalbe )");
  eq("untitled name with date", f({ name: "Sinta 23 jul 26" }), "Sinta 23 jul 26");
  eq("date-only name is left alone", f({ name: "13 Jul 26" }), "13 Jul 26");
  eq("title-only name falls back to raw", f({ name: "Dr" }), "Dr");

  // Missing / malformed guests must never throw mid-render.
  eq("null guest", f(null), "Unknown Guest");
  eq("no name", f({}), "Unknown Guest");
  eq("empty name", f({ name: "" }), "Unknown Guest");

  // XSS: the cleaner runs BEFORE escaping, so escaping must still bite.
  // Note the "(1)" also disappears — the parenthetical rule predates
  // this change and eats it. Harmless here; what matters is that no
  // raw "<" survives into innerHTML.
  const evil = f({ name: "Ibu <script>alert(1)</script>" });
  eq("no raw angle bracket reaches the DOM", /[<>]/.test(evil), false);
  eq("script tag is escaped", evil, "&lt;script&gt;alert(1)&lt;/script&gt;");
}

console.log("\n── booking alias must not duplicate the cleaned name ──");
{
  const f = ctx.formatGuestName;
  // The bug this guards: staff hold "Ibu Rere", the guest books online
  // as "Rere". Display is now "Rere", so without comparing the CLEANED
  // name the row reads "Rere (Rere)".
  eq(
    "alias equal to the cleaned name is suppressed",
    f({ name: "Ibu Rere", booking_alias: "Rere" }),
    "Rere",
  );
  eq(
    "alias equal to the raw name is still suppressed",
    f({ name: "Rere", booking_alias: "Rere" }),
    "Rere",
  );
  eq(
    "case and spacing differences still count as equal",
    f({ name: "Ibu  Rere", booking_alias: "rere" }),
    "Rere",
  );
  // A genuinely different alias must survive — that is the whole point
  // of the feature (Ops request 2026-07-26).
  const both = f({ name: "Ibu Rere", booking_alias: "Retno" });
  eq("different alias is kept", both.includes("(Retno)"), true);
  eq("cleaned name leads", both.startsWith("Rere"), true);
}

console.log("\n── the two rules must stay different ──");
{
  // waStripHonorific = staff screens. waCleanGuestName = WhatsApp.
  // The whole point of the split is that these disagree.
  const s = ctx.waStripHonorific;
  const c = ctx.waCleanGuestName;
  eq("screen keeps the date", s("Ibu Hesti 8 Agust 26"), "Hesti 8 Agust 26");
  eq("WhatsApp drops the date", c("Ibu Hesti 8 Agust 26"), "Hesti");
  eq("screen keeps the note", s("Ibu Clara (Loyal Cust)"), "Clara (Loyal Cust)");
  eq("WhatsApp drops the note", c("Ibu Clara (Loyal Cust)"), "Clara");
  eq("both agree on a plain titled name", s("Ibu Alia"), c("Ibu Alia"));

  // The dangerous direction, checked on the narrow rule too — this is
  // the one app.js now runs over all 520 guests on every render.
  eq("Budi is not 'Bu'", s("Budi"), "Budi");
  eq("Bunga is not 'Bu'", s("Bunga 8 Jul 26"), "Bunga 8 Jul 26");
  eq("Masayu is not 'Mas'", s("Masayu"), "Masayu");
  eq("Ibrahim is not 'Ib'", s("Ibrahim"), "Ibrahim");
  eq("Mbah is not 'Mba'", s("Mbah Karyo"), "Mbah Karyo");
  eq("Drajat is not 'Dr'", s("Drajat"), "Drajat");
  eq("Drs is not 'Dr'", s("Drs Bambang"), "Drs Bambang");
  eq("only the leading title goes", s("Bp Rosi Bu Dina"), "Rosi Bu Dina");
  eq("degenerate input", s(null), "");
}

console.log("\n── guestDisplayName (exports, sorting, WhatsApp) ──");
{
  const d = ctx.guestDisplayName;
  eq("plain text, no markup", d({ name: "Ibu Alia" }), "Alia");
  eq("keeps a real alias", d({ name: "Ibu Rere", booking_alias: "Retno" }), "Rere (Retno)");
  eq("null guest", d(null), "Unknown Guest");
}

console.log("\n── the save-time nudge is quiet unless it has something to say ──");
{
  const u = ctx.updateGuestNameHint;
  const reset = () => (hintEl = { textContent: "", classes: new Set(["hidden"]) });

  reset();
  u("Budi Santoso");
  eq("clean name shows no hint", hintEl.classes.has("hidden"), true);

  reset();
  u("");
  eq("empty field shows no hint", hintEl.classes.has("hidden"), true);

  reset();
  u("Dr");
  eq("title-only name shows no hint", hintEl.classes.has("hidden"), true);

  reset();
  u("Sinta 23 jul 26");
  eq("a date alone is not worth a hint", hintEl.classes.has("hidden"), true);

  reset();
  u("Ibu Alia 8 Agust 26");
  eq("titled name shows the hint", hintEl.classes.has("hidden"), false);
  // The hint must promise the SAME thing the list will show — including
  // the date it does NOT remove.
  eq("hint quotes the real result", hintEl.textContent.includes('"Alia 8 Agust 26"'), true);
  eq("hint is in Indonesian", hintEl.textContent.startsWith("Akan tampil"), true);

  reset();
  u("Dokter Lucky");
  eq("doctor hint shows the normalised title", hintEl.textContent.includes('"dr. Lucky"'), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
