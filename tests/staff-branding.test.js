// Settings > Staff and Settings > Branding: the rules that must not break.
//
// These two screens are the ones where a mistake is expensive rather than
// annoying. Locking every admin out of a client's own system needs somebody
// to open the SQL editor for them, and a half-saved logo URL puts a broken
// image on the page a guest books from.
//
// Neither app.js nor config.template.js can be loaded standalone (both touch
// the DOM at top level), so the functions under test are lifted out of the
// real files by name. Rename or delete one and this test fails loudly instead
// of quietly passing against a stale copy.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS = path.join(__dirname, "..", "js");
const appSrc = fs.readFileSync(path.join(JS, "app.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(JS, "config.template.js"), "utf8");

function lift(src, name, where) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find function ${name}() in ${where}`);
  return m[0];
}

const ctx = { console, document: { getElementById: () => null }, window: {} };
vm.createContext(ctx);
vm.runInContext(
  `${lift(cfgSrc, "brandUrlOk", "config.template.js")}
   ${lift(cfgSrc, "brandAsset", "config.template.js")}
   ${lift(appSrc, "isWeakPin", "app.js")}
   ${lift(appSrc, "activeAdminCount", "app.js")}
   const BRAND_FALLBACK = { full: "assets/full-logo.png", small: "assets/small-logo.png", voucher: "assets/voucher-bg.jpg" };
   const BRAND_KEYS = { full: "logo_url", small: "small_logo_url", voucher: "voucher_bg_url" };
   let BRANDING = null;
   let allStaffUsers = [];
   globalThis.T = {
     brandUrlOk, brandAsset, isWeakPin, activeAdminCount,
     setBranding: (v) => { BRANDING = v; },
     setStaff: (v) => { allStaffUsers = v; },
   };`,
  ctx,
);
const T = ctx.T;

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

// ── Branding URLs ─────────────────────────────────────────────────────
console.log("\nBranding: only an absolute http(s) URL is usable");
eq("https accepted", T.brandUrlOk("https://x.supabase.co/a.png"), true);
eq("http accepted", T.brandUrlOk("http://x.test/a.png"), true);
eq("null rejected", T.brandUrlOk(null), false);
eq("empty string rejected", T.brandUrlOk(""), false);
eq("whitespace rejected", T.brandUrlOk("   "), false);
// A relative path would resolve against whatever page is showing it, which
// on the guest pages is a different directory than in the staff app.
eq("relative path rejected", T.brandUrlOk("assets/logo.png"), false);
// The bucket refuses SVG, but a URL can be typed into the database by hand.
eq("javascript: rejected", T.brandUrlOk("javascript:alert(1)"), false);
eq("data: rejected", T.brandUrlOk("data:image/png;base64,AAA"), false);
eq("number rejected", T.brandUrlOk(12345), false);

console.log("\nBranding: falls back to the bundled asset, never to nothing");
T.setBranding(null); // not loaded yet
eq("not loaded → bundled", T.brandAsset("full"), "assets/full-logo.png");
T.setBranding({}); // loaded, client uploaded nothing
eq("empty row → bundled", T.brandAsset("full"), "assets/full-logo.png");
eq("empty row → bundled mark", T.brandAsset("small"), "assets/small-logo.png");
eq("empty row → bundled voucher", T.brandAsset("voucher"), "assets/voucher-bg.jpg");
T.setBranding({ logo_url: "https://x.supabase.co/logo.png" });
eq("custom logo wins", T.brandAsset("full"), "https://x.supabase.co/logo.png");
eq("other slots untouched", T.brandAsset("small"), "assets/small-logo.png");
T.setBranding({ logo_url: "  https://x.supabase.co/logo.png  " });
eq("whitespace trimmed", T.brandAsset("full"), "https://x.supabase.co/logo.png");
// A half-written value must not render a broken image on a guest page.
T.setBranding({ logo_url: "not a url" });
eq("garbage → bundled", T.brandAsset("full"), "assets/full-logo.png");
T.setBranding({ logo_url: "https://x/a.png" });
eq("unknown slot → null", T.brandAsset("nope"), null);

// ── PIN strength ──────────────────────────────────────────────────────
console.log("\nPINs: the guessable ones get a warning");
eq("0000 weak", T.isWeakPin("0000"), true);
eq("1111 weak", T.isWeakPin("1111"), true);
eq("1234 weak", T.isWeakPin("1234"), true);
eq("4321 weak", T.isWeakPin("4321"), true);
eq("6789 weak", T.isWeakPin("6789"), true);
eq("2580 fine", T.isWeakPin("2580"), false);
eq("1357 fine", T.isWeakPin("1357"), false);
eq("1235 fine", T.isWeakPin("1235"), false);
// 0123 IS sequential and must be caught: a leading zero is not a free pass.
eq("0123 weak", T.isWeakPin("0123"), true);

// ── Never zero admins ─────────────────────────────────────────────────
// The UI check. The database trigger checks again, because this one runs in
// public JavaScript that anyone can edit.
console.log("\nStaff: counting the admins who can still log in");
const owner = { id: "a1", role: "admin", is_active: true };
const secondAdmin = { id: "a2", role: "admin", is_active: true };
const retiredAdmin = { id: "a3", role: "admin", is_active: false };
const manager = { id: "m1", role: "manager", is_active: true };

T.setStaff([owner, manager]);
eq("sole admin, excluding self → 0", T.activeAdminCount("a1"), 0);
eq("sole admin, excluding nobody → 1", T.activeAdminCount(null), 1);

T.setStaff([owner, secondAdmin, manager]);
eq("two admins, excluding one → 1", T.activeAdminCount("a1"), 1);

// A deactivated admin cannot log in, so they do not count as cover.
T.setStaff([owner, retiredAdmin]);
eq("inactive admin is not cover", T.activeAdminCount("a1"), 0);

// A manager is not cover either: managers cannot reach the Staff screen.
T.setStaff([owner, manager]);
eq("manager is not cover", T.activeAdminCount("a1"), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
