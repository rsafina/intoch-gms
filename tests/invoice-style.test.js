// Invoice appearance: the validation, the derived bar text, and the footer.
//
// The invoice is a document a guest receives, so the failure that matters is
// not "it looks a bit off" — it is an unreadable Total line, a colour that
// silently falls back to black in the exported PDF, or a footer that ships
// with a placeholder still in it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const invSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "invoice.js"),
  "utf8",
);

function lift(name) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = invSrc.match(re);
  if (!m) throw new Error(`could not find function ${name}() in invoice.js`);
  return m[0];
}

function grab(decl) {
  const re = new RegExp(`^const ${decl}[\\s\\S]*?^};`, "m");
  const m = invSrc.match(re);
  if (!m) throw new Error(`could not find const ${decl} in invoice.js`);
  return m[0];
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  `${grab("INVOICE_STYLE_DEFAULTS")}
   const INVOICE_LOGO_MIN = 80, INVOICE_LOGO_MAX = 320;
   const INVOICE_MARK_MIN = 24, INVOICE_MARK_MAX = 140;
   let INVOICE_STYLE = null;
   ${lift("invStyle")}
   ${lift("invLuminance")}
   ${lift("invBarTextColor")}
   ${lift("invStyleCss")}
   ${lift("invFooterText")}
   globalThis.T = {
     invStyle, invBarTextColor, invStyleCss, invFooterText,
     set: (v) => { INVOICE_STYLE = v; },
   };`,
  ctx,
);
const T = ctx.T;

let pass = 0,
  fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  → got ${g}, want ${w}`);
  }
}
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "  → " + detail : ""}`);
  }
}

console.log("\nColours fall back per field, not wholesale");
T.set(null);
eq("nothing saved gives the built-in sheet", T.invStyle().ink, "#28547C");
T.set({ ink: "#1B2A3A" });
eq("one field set", T.invStyle().ink, "#1B2A3A");
eq("the rest keep their defaults", T.invStyle().accent, "#3E8FCB");
// A half-typed hex from the text box must not reach the sheet.
T.set({ ink: "#1B2", accent: "#C8A96B" });
eq("a broken colour falls back alone", T.invStyle().ink, "#28547C");
eq("the good one beside it survives", T.invStyle().accent, "#C8A96B");
T.set({ ink: "navy" });
eq("a colour name is rejected", T.invStyle().ink, "#28547C");

console.log("\nLogo sizes are clamped to what fits an A4 sheet");
T.set({ logo_width: 200 });
eq("in range is kept", T.invStyle().logo_width, 200);
// The sheet is 794px wide; a 900px logo would run off the page and out of
// the exported PDF.
T.set({ logo_width: 900 });
eq("absurdly wide falls back", T.invStyle().logo_width, 172);
T.set({ logo_width: 0 });
eq("zero falls back", T.invStyle().logo_width, 172);
T.set({ mark_width: 500 });
eq("the footer mark is clamped too", T.invStyle().mark_width, 62);
T.set({ logo_width: "220" });
eq("a numeric string is accepted", T.invStyle().logo_width, 220);

console.log("\nBar text picks itself, so a Total line is never invisible");
// This is the reason bar text is NOT one of the five settings.
eq("white on the default blue bar", T.invBarTextColor("#3E8FCB", "#28547C"), "#FFFFFF");
eq("white on a dark bar", T.invBarTextColor("#1B2A3A", "#28547C"), "#FFFFFF");
// A client picking a pale brand colour is exactly the case that would
// otherwise print white-on-cream.
eq("ink on a pale bar", T.invBarTextColor("#F4EDE3", "#28547C"), "#28547C");
eq("ink on near-white", T.invBarTextColor("#FFFFFF", "#28547C"), "#28547C");
eq("ink on the default row fill", T.invBarTextColor("#CFE4F5", "#28547C"), "#28547C");

console.log("\nThe generated CSS is literal, because html2canvas needs it to be");
T.set(null);
const css = T.invStyleCss(T.invStyle());
// If a var() ever creeps in here, the PDF can silently lose the colour while
// the screen looks perfect. That is the failure this whole approach avoids.
ok("no CSS variables in the output", !/var\(/.test(css), css.match(/var\([^)]*\)/g));
ok("colours are written as literal hex", /background: #3E8FCB/.test(css));
ok("the logo width is a real px value", /\.inv-logo \{ width: 172px/.test(css));
ok("every rule is scoped to the sheet", css.trim().split("\n").every((l) => !l.trim() || l.includes("#inv-sheet")));

console.log("\nThe footer drops empty fields rather than printing gaps");
eq("all three", T.invFooterText({ address: "Jl. Mawar 1", phone: "0812", instagram: "resto" }),
   "Jl. Mawar 1. Reservation: 0812. Instagram: @resto");
eq("an @ already typed is not doubled",
   T.invFooterText({ address: "", phone: "", instagram: "@resto" }), "Instagram: @resto");
eq("address only, no dangling separators",
   T.invFooterText({ address: "Jl. Mawar 1", phone: "", instagram: "" }), "Jl. Mawar 1");
eq("phone only", T.invFooterText({ address: "", phone: "0812", instagram: "" }),
   "Reservation: 0812");
// A brand new client has filled in nothing. Blank is correct; a template with
// "[nomor telepon]" still in it, which is what shipped before, is not.
eq("nothing filled in gives an empty footer",
   T.invFooterText({ address: "", phone: "", instagram: "" }), "");

console.log("\nFooter fields survive the colour reset path");
// invResetStyle keeps address/phone/instagram deliberately: they are the
// client's own details, not a design choice.
ok(
  "invResetStyle preserves the address fields",
  /invResetStyle[\s\S]*?address: keep\.address[\s\S]*?phone: keep\.phone[\s\S]*?instagram: keep\.instagram/.test(invSrc),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
