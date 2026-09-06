// Online reservation availability: the weekly grid, the derived flat pair,
// and the guest form's mirror of the database rule.
//
// The two things pinned hardest here are the ones whose failure is SILENT:
// a missing weekday entry must not mean closed, and saving must not wipe the
// fields the save function does not know about.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const app = rd("js/app.js");
const html = rd("index.html");
const reserve = rd("reserve.template.html");
const sql = rd("migrations/ALL_IN_ONE.sql");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};
// Functions in index.html/reserve.template.html live inside <script> and are
// INDENTED, so an anchor of "^function" only ever matches js/app.js. Capture
// the indent and require the closing brace at the same depth.
function lift(src, name) {
  const m = src.match(
    new RegExp("^([ \\t]*)(?:async )?function " + name + "\\([\\s\\S]*?^\\1}", "m"),
  );
  if (!m) throw new Error("could not slice " + name + " out of the source");
  return m[0];
}

// ALL_IN_ONE.sql mixes CREATE and create across its sections, so every lookup
// into it is case-insensitive. Searching for the uppercase spelling silently
// "passed" nothing on the first run of this file.
//
// LAST, not first. The file is a stack of migration sections in order, so a
// function redefined by a later section appears TWICE and only the last
// definition is what a database ends up with. Slicing the first one tests
// code that is overwritten seconds later — which is exactly what this test
// did on its first run, and it reported a missing feature that was present.
function sqlLastIndexOf(needle) {
  return sql.toLowerCase().lastIndexOf(needle.toLowerCase());
}

// A tiny DOM: only the ids readReservationWeek touches.
function weekContext(days) {
  const els = {};
  for (const key of ["0", "1", "2", "3", "4", "5", "6"]) {
    const d = days[key] || { open: true, from: "10:00", to: "21:30" };
    els[`set-res-open-${key}`] = { checked: d.open };
    els[`set-res-from-${key}`] = { value: d.from ?? "" };
    els[`set-res-to-${key}`] = { value: d.to ?? "" };
  }
  const toasts = [];
  const ctx = {
    console,
    document: { getElementById: (id) => els[id] || null },
    t: (s) => s,
    toast: (m, k) => toasts.push([m, k]),
    toasts,
  };
  vm.createContext(ctx);
  vm.runInContext((app.match(/^const RES_WEEKDAYS = \[[\s\S]*?\];/m) || [""])[0], ctx);
  vm.runInContext(lift(app, "readReservationWeek"), ctx);
  return ctx;
}

console.log("\nThe flat open/close pair is the WIDEST window across open days");

check("widest window is derived, not copied from one day", () => {
  const ctx = weekContext({
    "1": { open: true, from: "11:00", to: "20:00" },
    "6": { open: true, from: "09:00", to: "22:30" },
  });
  const out = ctx.readReservationWeek();
  assert.ok(out, "refused a valid grid");
  assert.strictEqual(out.open, "09:00", "not the earliest opening");
  assert.strictEqual(out.close, "22:30", "not the latest last-booking");
});

check("a closed day does not drag the widest window", () => {
  // Sunday closed with stale 06:00 in its inputs must not become the open time.
  const ctx = weekContext({ "0": { open: false, from: "06:00", to: "23:59" } });
  const out = ctx.readReservationWeek();
  assert.strictEqual(out.open, "10:00");
  assert.strictEqual(out.close, "21:30");
  // JSON, not deepStrictEqual: the object is built inside a vm realm and has
  // a different Object prototype, so reference-equality of prototypes fails.
  assert.strictEqual(JSON.stringify(out.weekly["0"]), JSON.stringify({ closed: true }));
});

console.log("\nThe grid refuses what would break silently");

check("all seven days closed is refused", () => {
  const days = {};
  for (const k of ["0", "1", "2", "3", "4", "5", "6"]) days[k] = { open: false };
  const ctx = weekContext(days);
  assert.strictEqual(ctx.readReservationWeek(), null, "accepted an all-closed week");
  assert.ok(/all seven/i.test(ctx.toasts[0][0]), "did not say why");
});

check("last booking before opening is refused", () => {
  const ctx = weekContext({ "3": { open: true, from: "21:00", to: "10:00" } });
  assert.strictEqual(ctx.readReservationWeek(), null);
  assert.ok(/after opening/i.test(ctx.toasts[0][0]));
});

check("a half-filled day is refused rather than saved blank", () => {
  const ctx = weekContext({ "4": { open: true, from: "10:00", to: "" } });
  assert.strictEqual(ctx.readReservationWeek(), null);
});

console.log("\nSaving must not wipe fields it does not know about");

check("the reservation_hours write spreads the existing value first", () => {
  const i = app.indexOf('key: "reservation_hours"');
  assert.ok(i > -1, "reservation_hours is no longer written");
  const body = app.slice(i, i + 700);
  assert.ok(
    body.includes("...(APP_SETTINGS.reservation_hours || {})"),
    "writes a fresh object, so any future field added to this key is wiped on every save",
  );
  for (const f of ["weekly", "min_lead_days", "online_paused", "pause_message"]) {
    assert.ok(body.includes(f), "save drops " + f);
  }
});

console.log("\nA missing weekday entry is never treated as closed");

check("the database resolver falls back to the flat pair", () => {
  const i = sqlLastIndexOf("create or replace function public.reservation_hours_for");
  const j = sql.indexOf("$fn$;", i);
  assert.ok(i > -1 && j > i, "reservation_hours_for is missing from ALL_IN_ONE.sql");
  const body = sql.slice(i, j);
  const nullBranch = body.indexOf("if v_day is null then");
  assert.ok(nullBranch > -1, "no missing-weekday branch");
  const branch = body.slice(nullBranch, nullBranch + 320);
  assert.ok(branch.includes("'closed', false"), "a missing weekday resolves to CLOSED");
  assert.ok(branch.includes("'flat'"), "missing weekday does not fall back to the flat pair");
});

check("the guest form falls back the same way", () => {
  const body = lift(reserve, "hoursForDate");
  assert.ok(body.includes("if (!day) return { closed: false"), "form treats a missing weekday as closed");
});

console.log("\nA closed date keeps the code outside_hours");

check("closed days do not invent a new rejection code", () => {
  // The guest page maps an unrecognised code to "connection problem, try
  // again", which would have a guest retrying against a day that never opens.
  const i = sqlLastIndexOf("create or replace function public.create_public_reservation");
  const body = sql.slice(i, sql.indexOf("$function$;", i));
  const closedBranch = body.indexOf("v_hours->>'closed'");
  assert.ok(closedBranch > -1, "no closed-day branch in the booking gate");
  const branch = body.slice(closedBranch, closedBranch + 500);
  assert.ok(branch.includes("'code', 'outside_hours'"), "closed day returns a non-standard code");
  assert.ok(branch.includes("closed_all_day"), "no closed_all_day detail for newer clients");
});

check("every code the gate can return has guest-facing copy", () => {
  const i = sqlLastIndexOf("create or replace function public.create_public_reservation");
  const body = sql.slice(i, sql.indexOf("$function$;", i));
  const codes = [...body.matchAll(/'code',\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(codes.length >= 8, "found only " + codes.length + " codes, the slice is probably wrong");
  // ERR_EN since 2026-09-06: the messages are authored in English and
  // translated by gt() when they are shown. A code with no entry still
  // falls through to "connection problem", and the guest retries forever
  // against a refusal that will never change.
  const errBlock = reserve.slice(reserve.indexOf("const ERR_EN = {"), reserve.indexOf("};", reserve.indexOf("const ERR_EN = {")));
  for (const c of new Set(codes)) {
    assert.ok(new RegExp("\\b" + c + ":").test(errBlock), `code "${c}" has no ERR_EN entry, so guests see "connection problem"`);
  }
  // And every one of those English sentences needs a translation, or an
  // Indonesian guest reads an English refusal.
  const dict = fs.readFileSync(path.join(ROOT, "js", "guest-i18n.js"), "utf8");
  // Comments stripped first: the block explains itself in prose that also
  // contains quoted English, and a comment needs no translation.
  const errCode = errBlock.replace(/^\s*\/\/.*$/gm, "");
  for (const m of errCode.matchAll(/"([^"]{12,})"/g))
    assert.ok(
      dict.includes(JSON.stringify(m[1])),
      "no Indonesian for the refusal: " + m[1],
    );
});

console.log("\nThe lead time reaches the guest form, not just the server");

check("the form asks for min_lead_days and uses it as the date floor", () => {
  assert.ok(reserve.includes("min_lead_days"), "form never reads the setting");
  const body = lift(reserve, "earliestDate");
  assert.ok(body.includes("MIN_LEAD_DAYS"), "earliestDate ignores the lead time");
  assert.ok(reserve.includes("dateEl.min = earliestDate()"), "the date picker floor is still today");
});

check("a closed date is skipped rather than offered", () => {
  assert.ok(reserve.includes("dateEl.value = nextOpenDate(earliestDate())"), "form can open on a closed date");
  assert.ok(lift(reserve, "nextOpenDate").includes("hoursForDate"), "nextOpenDate ignores closures");
});

check("pausing disables the submit button, not just the message", () => {
  const i = reserve.indexOf("online_paused");
  const body = reserve.slice(i, i + 400);
  assert.ok(body.includes('$("btn-submit").disabled = true'), "paused form still submits");
  assert.ok(html.indexOf('id="btn-submit"') === -1, "sanity: btn-submit belongs to reserve, not index");
  assert.ok(reserve.includes('id="btn-submit"'), "btn-submit id does not exist on the form");
});

console.log("\nThe settings screen exposes all four controls");

check("every control has an element and a handler", () => {
  for (const id of ["set-res-paused", "set-res-pause-msg", "set-res-lead-days", "set-res-week", "set-exc-date", "set-exc-list"]) {
    assert.ok(html.includes(`id="${id}"`), "missing " + id);
  }
  for (const fn of ["renderReservationAvailability", "readReservationWeek", "saveReservationException", "deleteReservationException", "loadReservationExceptions"]) {
    assert.ok(app.includes("function " + fn), "missing " + fn);
  }
});

check("time inputs in the weekly grid do not rely on Tailwind beating .form-input", () => {
  // .form-input is width:100% in this file's own <style>. A w-32 utility only
  // wins by injection order. The grid uses a dedicated class instead.
  assert.ok(html.includes("input.form-input-inline"), "form-input-inline rule is missing");
  const i = app.indexOf('id="set-res-from-');
  const row = app.slice(i - 200, i + 200);
  assert.ok(!/class="form-input w-\d/.test(row), "weekly grid is back on a Tailwind width");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
