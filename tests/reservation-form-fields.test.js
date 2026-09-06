// Settings > Reservation Form > Fields on the Form.
//
// Four controls over app_settings.reservation_form. Three of the failures
// this guards against are silent, which is why they are worth a suite:
//
//   1. A default drifting. The booking page treats an ABSENT key as
//      notes-on / company-off / capacity-off. If this screen ever saves a
//      different shape, every unconfigured restaurant changes overnight and
//      nobody is told.
//   2. The row being rebuilt instead of spread. That has already cost this
//      key family its data once (CLAUDE.md, reservation_hours).
//   3. A write that reports success over nothing. With no staff auth every
//      request is the anon role, and a write no policy permits updates zero
//      rows and answers 204. Only .select() can tell the two apart.
//
// No jsdom here on purpose: this runs everywhere, including the device
// bridge, unlike tests/settings-screens.test.js.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(ROOT, "js", "config.template.js"), "utf8");
const cfgBuilt = fs.readFileSync(path.join(ROOT, "js", "config.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const reserveTpl = fs.readFileSync(path.join(ROOT, "reserve.template.html"), "utf8");

let pass = 0,
  fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    console.log("  FAIL  " + label + (detail ? "  -> " + detail : ""));
  }
}
const eq = (label, got, want) =>
  ok(label, got === want, JSON.stringify({ got, want }));

function lift(src, name, where) {
  const re = new RegExp("^(?:async )?function " + name + "\\([\\s\\S]*?^}", "m");
  const m = src.match(re);
  if (!m) throw new Error("could not find function " + name + "() in " + where);
  return m[0];
}
function grab(src, decl, where) {
  const re = new RegExp("^const " + decl + "[\\s\\S]*?^};", "m");
  const m = src.match(re);
  if (!m) throw new Error("could not find const " + decl + " in " + where);
  return m[0];
}

const WELCOME_MAX = Number(appSrc.match(/const RESERVATION_WELCOME_MAX = (\d+);/)[1]);

// -- Markup ------------------------------------------------------------
console.log("\nThe card exists and offers exactly the four movable fields");
const card = html.slice(
  html.indexOf("Fields on the Form"),
  html.indexOf("Signature Dishes"),
);
ok("card is present in Settings > Reservation Form", card.length > 200);
for (const id of ["rff-show-notes", "rff-show-company", "rff-show-capacity", "rff-welcome"])
  ok("control " + id + " exists", new RegExp('id="' + id + '"').test(card));
ok("Save button calls the save function", /saveReservationFormFields\(\)/.test(card));
ok("Save button is manager-only", /manager-only-ui[\s\S]{0,80}Save Fields/.test(card));

// The whole point of the constraint: a switch that cannot be turned off is a
// settings screen that lies. Name and phone create and match the guest record;
// pax is what every capacity rule is checked against.
console.log("\nNothing that cannot actually be switched off is offered");
for (const forbidden of ["show_name", "show_phone", "show_date", "show_time", "show_pax"])
  ok("no " + forbidden + " control", !new RegExp(forbidden).test(card));
const boxes = (card.match(/type="checkbox"/g) || []).length;
// Four since 2026-09-06: the three field switches plus the guest-page
// ID/EN switch. The count is pinned so a fifth cannot appear unnoticed.
ok("exactly four checkboxes", boxes === 4, String(boxes));

console.log("\nThe screen is wired into the settings page load");
ok(
  "renderReservationFormFields() runs when settings-menu opens",
  /page === "settings-menu"[\s\S]{0,300}renderReservationFormFields\(\)/.test(appSrc),
);
ok("index.html cache-buster covers app.js", /js\/app\.js\?v=32/.test(html));
ok("index.html cache-buster covers config.js", /js\/config\.js\?v=20/.test(html));

// -- The defaults, run for real ----------------------------------------
const ctx = {
  console,
  APP_SETTINGS: {},
  document: { getElementById: () => null },
  isManagerOrAdmin: () => true,
};
vm.createContext(ctx);
vm.runInContext(
  grab(appSrc, "RESERVATION_FORM_DEFAULTS", "app.js") +
    "\n" +
    lift(appSrc, "reservationFormSettings", "app.js") +
    "\nglobalThis.T = { reservationFormSettings, setSettings: (v) => { APP_SETTINGS = v; } };",
  ctx,
);
const T = ctx.T;

console.log("\nAn unconfigured restaurant sees exactly what it sees today");
T.setSettings({});
let cfg = T.reservationFormSettings();
eq("notes default on", cfg.show_notes, true);
eq("company default off", cfg.show_company, false);
eq("capacity default off", cfg.show_capacity, false);
eq("welcome default null", cfg.welcome_text, null);

console.log("\nA partly-filled row keeps the defaults for what it omits");
T.setSettings({ reservation_form: { show_company: true } });
cfg = T.reservationFormSettings();
eq("company honoured", cfg.show_company, true);
eq("notes still defaults on", cfg.show_notes, true);
eq("capacity still defaults off", cfg.show_capacity, false);

// -- The save, run against a fake db -----------------------------------
function harness(opts) {
  const rows = opts && "rows" in opts ? opts.rows : [{}];
  const error = (opts && opts.error) || null;
  const seen = { payload: null, opts: null, selected: false, toasts: [] };
  const c = {
    console,
    APP_SETTINGS: {},
    t: (s) => s,
    toast: (m, kind) => seen.toasts.push([m, kind || "ok"]),
    loader: () => {},
    isManagerOrAdmin: () => true,
    supabaseQuery: async (fn) => {
      const r = await fn();
      return { data: r.data, error: r.error };
    },
    db: {
      from: () => ({
        upsert: (payload, upsertOpts) => {
          seen.payload = payload;
          seen.opts = upsertOpts;
          return {
            select: () => {
              seen.selected = true;
              return Promise.resolve({
                data: error ? null : rows.map(() => ({ value: payload.value })),
                error,
              });
            },
            // Without .select() the builder itself is awaited and a 204 reads
            // as success. If the code ever stops calling .select(), the
            // "asked for its row back" assertion below fails instead of the
            // whole suite crashing.
            then: (res) => res({ data: null, error: null }),
          };
        },
      }),
    },
    values: {
      "rff-show-notes": { checked: true },
      "rff-show-company": { checked: false },
      "rff-show-capacity": { checked: false },
      "rff-welcome": { value: "" },
      "rff-welcome-count": { textContent: "" },
    },
  };
  c.document = { getElementById: (id) => c.values[id] || null };
  vm.createContext(c);
  vm.runInContext(
    grab(appSrc, "RESERVATION_FORM_DEFAULTS", "app.js") +
      "\nconst RESERVATION_WELCOME_MAX = " +
      WELCOME_MAX +
      ";\n" +
      lift(appSrc, "reservationFormSettings", "app.js") +
      "\n" +
      lift(appSrc, "renderReservationFormFields", "app.js") +
      "\n" +
      lift(appSrc, "onReservationWelcomeInput", "app.js") +
      "\n" +
      lift(appSrc, "saveReservationFormFields", "app.js") +
      "\nglobalThis.T = { save: saveReservationFormFields," +
      " setSettings: (v) => { APP_SETTINGS = v; }, getSettings: () => APP_SETTINGS };",
    c,
  );
  return { c, seen, T: c.T };
}

(async () => {
  console.log("\nThe save asks for its row back and reads it");
  let h = harness();
  await h.T.save();
  ok("upsert called .select()", h.seen.selected);
  eq("keyed on the settings row", h.seen.payload.key, "reservation_form");
  eq("upsert conflicts on key", h.seen.opts && h.seen.opts.onConflict, "key");
  ok(
    "success toast",
    h.seen.toasts.length === 1 && h.seen.toasts[0][1] === "ok",
    JSON.stringify(h.seen.toasts),
  );

  console.log("\nA write that changed nothing is a failure, not a save");
  h = harness({ rows: [] });
  h.c.values["rff-show-capacity"].checked = true;
  await h.T.save();
  ok(
    "error toast on an empty result",
    h.seen.toasts.some((x) => x[1] === "error"),
    JSON.stringify(h.seen.toasts),
  );
  ok(
    "the local cache is NOT updated on an empty result",
    h.T.getSettings().reservation_form === undefined,
  );

  console.log("\nThe row is spread, never rebuilt");
  h = harness();
  h.T.setSettings({
    reservation_form: { show_notes: true, some_future_key: "keep me" },
  });
  await h.T.save();
  eq("an unknown key survives the save", h.seen.payload.value.some_future_key, "keep me");

  console.log("\nThe three switches reach the payload as real booleans");
  h = harness();
  h.c.values["rff-show-notes"].checked = false;
  h.c.values["rff-show-company"].checked = true;
  h.c.values["rff-show-capacity"].checked = true;
  await h.T.save();
  eq("notes off", h.seen.payload.value.show_notes, false);
  eq("company on", h.seen.payload.value.show_company, true);
  eq("capacity on", h.seen.payload.value.show_capacity, true);

  console.log("\nThe welcome line");
  h = harness();
  h.c.values["rff-welcome"].value = "   ";
  await h.T.save();
  eq("blank is stored as null, not an empty string", h.seen.payload.value.welcome_text, null);

  h = harness();
  h.c.values["rff-welcome"].value = "x".repeat(WELCOME_MAX + 40);
  await h.T.save();
  eq("capped on write", h.seen.payload.value.welcome_text.length, WELCOME_MAX);

  h = harness();
  h.c.values["rff-welcome"].value = '  <b>Selamat datang</b> & "hi"  ';
  await h.T.save();
  // Stored verbatim on purpose. The booking page prints it with textContent,
  // so it reaches the guest as characters. Escaping it here would store the
  // entities and show a guest "&amp;".
  eq(
    "stored verbatim, trimmed",
    h.seen.payload.value.welcome_text,
    '<b>Selamat datang</b> & "hi"',
  );

  console.log("\nThe booking page reads it the way this screen writes it");
  ok(
    "welcome line is printed with textContent, never innerHTML",
    /welcome-line"\)[\s\S]{0,240}line\.textContent = w/.test(reserveTpl),
  );
  ok(
    "the public page caps it too",
    /welcome_text \|\| ""\)\.trim\(\)\.slice\(0, WELCOME_MAX\)/.test(reserveTpl),
  );
  eq(
    "both caps are the same number",
    Number(reserveTpl.match(/const WELCOME_MAX = (\d+);/)[1]),
    WELCOME_MAX,
  );
  ok("notes hide only on an explicit false", /v\.show_notes === false/.test(reserveTpl));
  ok("company shows only on an explicit true", /v\.show_company === true/.test(reserveTpl));
  ok("capacity shows only on an explicit true", /v\.show_capacity === true/.test(reserveTpl));

  console.log("\nThe client's own words are never translated");
  // Every visible label on this card is in ID_DICT. The welcome text is not,
  // and must never be: it is the restaurant's sentence, in whatever language
  // they wrote it.
  for (const s of [
    "Fields on the Form",
    "Notes box",
    "Company box",
    "Show how full each area is",
    "Welcome line under the page title",
    "Save Fields",
    "Form fields saved",
    "Nothing was saved. Check with your administrator.",
  ]) {
    ok('"' + s + '" is translated', cfgSrc.includes('"' + s + '":'));
    ok('"' + s + '" is in the built config too', cfgBuilt.includes('"' + s + '":'));
  }
  ok(
    "the welcome value never goes through t()",
    !/(?:^|[^A-Za-z0-9_.])t\(\s*(?:raw|welcome_text|cfg\.welcome_text)/m.test(appSrc),
  );

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
