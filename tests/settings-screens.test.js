// Settings > Staff and Settings > Branding, loaded as a real DOM.
//
// The pure-logic suite (tests/staff-branding.test.js) cannot catch the
// failure mode that actually bites here: markup and code drifting apart. An
// id renamed in one file and not the other produces a screen that renders
// fine and quietly does nothing, which is exactly what happened to the
// Blue Heron `t` shadowing bug that unit tests missed.
//
// So this loads the real index.html, wires the real functions to it, and
// asserts the wiring holds.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(ROOT, "js", "config.template.js"), "utf8");

const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
const w = dom.window;
global.window = w;
global.document = w.document;

function lift(src, name, where) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find function ${name}() in ${where}`);
  return m[0];
}

w.eval(`
  ${lift(cfgSrc, "brandUrlOk", "config.template.js")}
  ${lift(cfgSrc, "brandAsset", "config.template.js")}
  ${lift(cfgSrc, "applyBranding", "config.template.js")}
  ${lift(appSrc, "staffRoleLabel", "app.js")}
  ${lift(appSrc, "renderStaffUsers", "app.js")}
  ${lift(appSrc, "escapeHtml", "app.js")}
  var BRAND_FALLBACK = { full: "assets/full-logo.png", small: "assets/small-logo.png", voucher: "assets/voucher-bg.jpg" };
  var BRAND_KEYS = { full: "logo_url", small: "small_logo_url", voucher: "voucher_bg_url" };
  var BRANDING = null;
  var allStaffUsers = [];
  var t = (s) => s;                 // i18n pass-through
  var currentStaffId = () => "a1";
`);

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

// ── The two sections exist and are wired into the tab bar ─────────────
console.log("\nMarkup: the new settings screens are present");
["page-settings-branding", "page-settings-staff"].forEach((id) => {
  const el = w.document.getElementById(id);
  ok(`#${id} exists`, !!el);
  ok(`#${id} has a tab bar`, !!el && !!el.querySelector("[data-settings-tabs]"));
  // Every settings subpage is a .page-section, or navigateTo() cannot show it.
  ok(`#${id} is a .page-section`, !!el && el.classList.contains("page-section"));
});

// SETTINGS_SUBPAGES must list them, or the tab bar never renders and the
// "last settings tab" restore sends the user somewhere else.
const subpages = appSrc.match(/const SETTINGS_SUBPAGES = \[[\s\S]*?\];/)[0];
ok("SETTINGS_SUBPAGES lists branding", /"settings-branding"/.test(subpages));
ok("SETTINGS_SUBPAGES lists staff", /"settings-staff"/.test(subpages));
// Staff must ALSO be in ADMIN_ONLY_PAGES, or hasAccess() lets a manager in.
ok(
  "settings-staff is admin-only",
  /const ADMIN_ONLY_PAGES = new Set\(\[[^\]]*"settings-staff"/.test(cfgSrc),
);

// ── The staff modal fields the code reads actually exist ──────────────
console.log("\nMarkup: every id saveStaffUser() reads is in the modal");
[
  "modal-staff",
  "staff-form-id",
  "staff-form-name",
  "staff-form-username",
  "staff-form-pin",
  "staff-form-role",
  "staff-form-pin-hint",
  "staff-form-username-note",
  "staff-form-role-self-note",
  "staff-modal-title",
  "staff-save-button",
  "staff-list",
].forEach((id) => ok(`#${id} exists`, !!w.document.getElementById(id)));

// The sidebar already owns #staff-display-name (the logged-in person's
// name). A modal field reusing that id would silently overwrite the sidebar
// on every keystroke.
const sidebarName = w.document.getElementById("staff-display-name");
ok("sidebar #staff-display-name still exists", !!sidebarName);
ok(
  "modal does not reuse the sidebar id",
  !w.document.querySelector("#modal-staff #staff-display-name"),
);

// The role select must offer exactly the roles the CHECK constraint allows.
const roleValues = [...w.document.querySelectorAll("#staff-form-role option")].map(
  (o) => o.value,
);
ok(
  "role options match the DB constraint",
  JSON.stringify(roleValues) === JSON.stringify(["staff", "manager", "admin"]),
  JSON.stringify(roleValues),
);

// ── Branding markup matches BRAND_SLOTS ───────────────────────────────
console.log("\nMarkup: every branding slot has its full set of controls");
["full", "small", "voucher"].forEach((slot) => {
  ["brand-file-", "brand-upload-", "brand-reset-", "brand-preview-", "brand-state-"].forEach(
    (prefix) => ok(`#${prefix}${slot} exists`, !!w.document.getElementById(prefix + slot)),
  );
});

// ── applyBranding() actually swaps what is on the page ────────────────
console.log("\nBehaviour: applyBranding() swaps every marked logo");
const marked = w.document.querySelectorAll('[data-brand-logo="full"]');
ok("at least three full-logo slots are marked", marked.length >= 3, `${marked.length}`);

w.eval('BRANDING = { logo_url: "https://x.supabase.co/mine.png" }; applyBranding();');
const allSwapped = [...w.document.querySelectorAll('[data-brand-logo="full"]')].every(
  (el) => el.getAttribute("src") === "https://x.supabase.co/mine.png",
);
ok("every full-logo img took the custom URL", allSwapped);
ok(
  "favicon followed the small mark",
  w.document.querySelector('link[rel="icon"]').getAttribute("href") ===
    "assets/small-logo.png",
);

// A bad value must put the bundled file back, not leave the broken one.
w.eval('BRANDING = { logo_url: "oops" }; applyBranding();');
const allRestored = [...w.document.querySelectorAll('[data-brand-logo="full"]')].every(
  (el) => el.getAttribute("src") === "assets/full-logo.png",
);
ok("a garbage URL falls back to the bundled logo", allRestored);

// ── The staff list renders ────────────────────────────────────────────
console.log("\nBehaviour: the staff list renders what it is given");
w.eval(`allStaffUsers = [
  { id: "a1", username: "rere", display_name: "Rere", role: "admin", is_active: true },
  { id: "s1", username: "rina", display_name: "Rina", role: "staff", is_active: false },
];
renderStaffUsers();`);
const listHtml = w.document.getElementById("staff-list").innerHTML;
ok("names rendered", /Rere/.test(listHtml) && /Rina/.test(listHtml));
ok("the logged-in admin is marked", /\(you\)/.test(listHtml));
ok("the inactive account is marked", /Inactive/.test(listHtml));
ok("inactive row offers Activate", /Activate/.test(listHtml));
ok("active row offers Deactivate", /Deactivate/.test(listHtml));
// No delete button, by design: staff ids are foreign keys on a year of history.
ok("no delete button anywhere", !/Delete/.test(listHtml));

// A name with markup in it must not become markup.
w.eval(`allStaffUsers = [
  { id: "x", username: "x", display_name: "<img src=x onerror=1>", role: "staff", is_active: true },
];
renderStaffUsers();`);
ok(
  "display names are escaped",
  !w.document.querySelector("#staff-list img"),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
