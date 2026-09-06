// The booking form's hour picker: pills, whole hours, snapped inwards.
//
// The thing worth pinning is the snapping. A restaurant closing at 20:30 must
// be offered 20:00 and nothing later: rounding the close UP puts a slot on the
// form that the database rule then refuses, and the guest is told "outside
// opening hours" about an hour the form itself just offered them.
//
// Second, the hidden input. The submit path reads $("f-time").value and always
// did; the pills only write into it. A chosen hour that the newly picked date
// does not offer must be CLEARED, or the form silently submits yesterday's
// choice against today's opening hours.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const reserve = rd("reserve.template.html");
// The REAL dictionary, not a stub. The pills print translated text, and a
// stubbed gt() would prove only that the harness can spell.
const dict = rd("js/guest-i18n.js");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};

// Same slicer the other reserve-form tests use: these functions live indented
// inside <script>, so "^function" never matches them.
function lift(src, name) {
  const m = src.match(
    new RegExp("^([ \\t]*)(?:async )?function " + name + "\\([\\s\\S]*?^\\1}", "m"),
  );
  if (!m) throw new Error("could not slice " + name + " out of the source");
  return m[0];
}

// A DOM small enough to reason about: only the three elements the picker
// touches, plus enough of createElement/appendChild for the pill loop.
function run({ open, close, closed, reason, date, today, nowHM, prevTime, lang }) {
  const el = (id) => ({ id, value: "", children: [], innerHTML: "" });
  const els = {
    "f-date": { ...el("f-date"), value: date },
    "f-time": { ...el("f-time"), value: prevTime || "" },
    "time-pills": {
      ...el("time-pills"),
      set innerHTML(v) { this.children.length = 0; },
      get innerHTML() { return ""; },
      appendChild(node) { this.children.push(node); },
    },
  };
  const errors = [];
  const [nh, nm] = (nowHM || "00:00").split(":").map(Number);

  const src = [
    "const SLOT_MINUTES = 60;",
    "let TIME_SLOTS = [];",
    "let TIMES_EXPANDED = false;",
    dict,
    'GUEST_LANG = "' + (lang || "id") + '";',
    // Read out of the page rather than hardcoded: a harness that pins its own
    // 8 would keep passing after someone changed the real threshold.
    reserve.match(/const TIME_COLLAPSE_AT = \d+;/)[0],
    lift(reserve, "buildTimeSlots"),
    lift(reserve, "setTime"),
    lift(reserve, "renderTimePills"),
    "globalThis.T = { buildTimeSlots, get TIME_SLOTS() { return TIME_SLOTS; } };",
  ].join("\n\n");

  const ctx = {
    console,
    $: (id) => els[id] || null,
    todayLocal: () => today,
    hoursForDate: () => ({ closed: !!closed, open, close, reason }),
    SAME_DAY_LEAD_MIN: 60,
    toMin: (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)),
    pad: (n) => String(n).padStart(2, "0"),
    showError: (m) => errors.push(m),
    hideError: () => {},
    Date: class extends Date {
      constructor(...a) { super(...a); }
      getHours() { return nh; }
      getMinutes() { return nm; }
    },
    document: {
      createElement: (tag) => ({
        tag,
        className: "",
        textContent: "",
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
      }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx.T.buildTimeSlots();
  // The box is re-rendered in place on every tap, so these read the CURRENT
  // children rather than a snapshot taken before the tap.
  const kids = () => Array.from(els["time-pills"].children);
  const api = {
    // Array.from: the vm realm's Array has a different prototype, and
    // deepStrictEqual compares those.
    slots: Array.from(ctx.T.TIME_SLOTS),
    errors,
    get chosen() { return els["f-time"].value; },
    get pills() { return kids().filter((n) => "aria-pressed" in n.attrs); },
    get labels() { return api.pills.map((p) => p.textContent); },
    get more() { return kids().find((n) => n.className === "times-more") || null; },
    get emptyNote() { return kids().find((n) => n.className === "times-empty") || null; },
    tapMore() { api.more.onclick(); },
    tap(label) { api.pills.find((p) => p.textContent === label).onclick(); },
    rebuild() { ctx.T.buildTimeSlots(); },
  };
  return api;
}

const OPEN_DAY = {
  open: "11:00", close: "20:30", date: "2026-09-20", today: "2026-09-06",
};

console.log("reservation time pills");

check("a 20:30 close offers 20:00 and stops", () => {
  const r = run(OPEN_DAY);
  assert.deepStrictEqual(r.slots, [
    "11:00", "12:00", "13:00", "14:00", "15:00",
    "16:00", "17:00", "18:00", "19:00", "20:00",
  ]);
});

check("a 22:00 close offers 22:00 itself", () => {
  const r = run({ ...OPEN_DAY, close: "22:00" });
  assert.strictEqual(r.slots[r.slots.length - 1], "22:00");
});

check("an 11:30 open starts at 12:00, never 11:30", () => {
  const r = run({ ...OPEN_DAY, open: "11:30" });
  assert.strictEqual(r.slots[0], "12:00");
  assert.ok(!r.slots.includes("11:30"), "half-hour slot leaked through");
});

check("every slot is on the hour", () => {
  const r = run({ ...OPEN_DAY, open: "10:15", close: "23:45" });
  assert.ok(r.slots.every((s) => s.endsWith(":00")), r.slots.join(" "));
});

check("the chosen hour is the only pressed one", () => {
  const r = run({ ...OPEN_DAY, prevTime: "19:00" });
  assert.deepStrictEqual(
    r.pills.filter((p) => p.attrs["aria-pressed"] === "true").map((p) => p.textContent),
    ["19:00"],
  );
});

// ---- Collapsing a long day ----
//
// A restaurant open 10:00 to 23:00 offers fourteen hours. Shown whole they
// push the area picker, the conditions panel and the submit button off a
// phone screen, and the deposit is the one thing phase 1 settled must be
// visible before submitting.

check("eight hours or fewer show whole, with no toggle", () => {
  const r = run({ ...OPEN_DAY, open: "13:00", close: "20:30" });
  assert.strictEqual(r.slots.length, 8);
  assert.strictEqual(r.pills.length, 8);
  assert.strictEqual(r.more, null, "a toggle appeared with nothing to hide");
});

check("a longer day collapses to eight and counts the rest", () => {
  const r = run({ ...OPEN_DAY, open: "10:00", close: "23:00" });
  assert.strictEqual(r.slots.length, 14);
  assert.strictEqual(r.pills.length, 8);
  assert.deepStrictEqual(r.labels[7], "17:00");
  assert.strictEqual(r.more.textContent, "+6 jam lainnya");
});

check("the toggle opens the rest of the day and closes it again", () => {
  const r = run({ ...OPEN_DAY, open: "10:00", close: "23:00" });
  r.tapMore();
  assert.strictEqual(r.pills.length, 14);
  assert.strictEqual(r.more.textContent, "Tampilkan lebih sedikit");
  r.tapMore();
  assert.strictEqual(r.pills.length, 8);
});

check("picking a late hour keeps it visible", () => {
  const r = run({ ...OPEN_DAY, open: "10:00", close: "23:00" });
  r.tapMore();
  r.tap("22:00");
  assert.strictEqual(r.chosen, "22:00");
  assert.ok(
    r.labels.includes("22:00"),
    "the chosen hour was collapsed out of sight while still selected",
  );
  assert.strictEqual(
    r.more,
    null,
    'a "show fewer" that hides the chosen hour would read as nothing being picked',
  );
});

check("a new date collapses the list again", () => {
  const r = run({ ...OPEN_DAY, open: "10:00", close: "23:00" });
  r.tapMore();
  assert.strictEqual(r.pills.length, 14);
  r.rebuild();
  assert.strictEqual(r.pills.length, 8, "the list stayed open across a date change");
});

check("today drops the hours already gone, plus the lead time", () => {
  const r = run({ ...OPEN_DAY, date: "2026-09-06", nowHM: "17:10" });
  // 17:10 + 60 minutes of lead = nothing before 18:10, so 18:00 is out too.
  assert.deepStrictEqual(r.slots, ["19:00", "20:00"]);
});

check("a chosen hour the new date does not offer is cleared", () => {
  const r = run({ ...OPEN_DAY, date: "2026-09-06", nowHM: "17:10", prevTime: "12:00" });
  assert.strictEqual(r.chosen, "", "stale time survived the rebuild");
});

check("a chosen hour the new date still offers is kept", () => {
  const r = run({ ...OPEN_DAY, prevTime: "19:00" });
  assert.strictEqual(r.chosen, "19:00");
});

check("a closed date clears the time and says why", () => {
  const r = run({ ...OPEN_DAY, closed: true, reason: "Libur Idul Fitri", prevTime: "19:00" });
  assert.strictEqual(r.chosen, "");
  assert.strictEqual(r.pills.length, 0, "a closed date still drew hours");
  assert.ok(r.emptyNote, "a closed date leaves the picker silently empty");
  assert.ok(r.errors.join(" ").includes("Libur Idul Fitri"), r.errors.join(" "));
});

check("no slots left today is an error, not an empty silent picker", () => {
  const r = run({ ...OPEN_DAY, date: "2026-09-06", nowHM: "23:30" });
  assert.deepStrictEqual(r.slots, []);
  assert.ok(r.errors.length === 1, "expected exactly one message, got " + r.errors.length);
});

// ---- Both languages ----
//
// The pills themselves are clock times and say the same thing either way; the
// words around them are the ones a guest reads when nothing fits.

check("the toggle is Indonesian by default", () => {
  const r = run({ ...OPEN_DAY, open: "10:00", close: "23:00" });
  assert.strictEqual(r.more.textContent, "+6 jam lainnya");
});

check("and English when the guest has switched", () => {
  const r = run({ ...OPEN_DAY, open: "10:00", close: "23:00", lang: "en" });
  assert.strictEqual(r.more.textContent, "+6 more hours");
  r.tapMore();
  assert.strictEqual(r.more.textContent, "Show fewer");
});

check("a closed date explains itself in the chosen language", () => {
  const id = run({ ...OPEN_DAY, closed: true });
  const en = run({ ...OPEN_DAY, closed: true, lang: "en" });
  assert.strictEqual(
    id.errors[0],
    "Kami tutup pada tanggal ini. Mohon pilih tanggal lain.",
  );
  assert.strictEqual(
    en.errors[0],
    "We are closed on this date. Please pick another one.",
  );
});

check("a staff-written closure reason is never translated", () => {
  const r = run({ ...OPEN_DAY, closed: true, reason: "Libur Idul Fitri" });
  assert.ok(
    r.errors[0].endsWith("Libur Idul Fitri"),
    "the reason staff typed was rewritten: " + r.errors[0],
  );
});

check("the form no longer carries a time <select>", () => {
  assert.ok(
    !/<select[^>]*id="f-time"/.test(reserve),
    "the dropdown is still in the markup; two controls would both claim f-time",
  );
  assert.ok(
    /<input id="f-time" type="hidden"/.test(reserve),
    "the hidden input the submit path reads is missing",
  );
});

check("the slot step is a whole hour", () => {
  assert.ok(
    /const SLOT_MINUTES = 60;/.test(reserve),
    "SLOT_MINUTES is no longer 60, so the pills are not hourly",
  );
});

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
