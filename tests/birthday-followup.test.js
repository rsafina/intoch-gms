// Birthday follow-up: the badge rule, and the three ways it goes wrong.
//
// RUN AS:  TZ=Asia/Jakarta node tests/birthday-followup.test.js
//
// The timezone matters. computeDaysUntilBirthday() reads the browser's local
// clock, and "is this birthday today" is a different answer at UTC+7 than at
// UTC for seven hours of every day.
//
// The clock is frozen so "today" is a known date. Without that, this suite
// would pass all year and then fail on 31 December.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

if (!/Jakarta/.test(process.env.TZ || "")) {
  console.error(
    "Refusing to run: set TZ=Asia/Jakarta (got " + (process.env.TZ || "unset") + ").",
  );
  process.exit(2);
}

const appSrc = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

function lift(name) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not find function ${name}() in app.js`);
  return m[0];
}

// Freeze "today" at 15 August 2026, local time. Mid-month on purpose: it
// puts birthdays both behind and ahead inside the same month, which is the
// only arrangement that can catch the passed-birthday rule.
const FIXED = new Date(2026, 7, 15, 10, 0, 0); // month is 0-based: 7 = August
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED.getTime());
    else super(...args);
  }
  static now() {
    return FIXED.getTime();
  }
}

const rendered = [];
const ctx = {
  console,
  Date: FakeDate,
  // Every renderer is stubbed out: this suite is about the RULE, and a DOM
  // is covered separately by tests/settings-screens.test.js.
  document: { getElementById: () => null, querySelectorAll: () => [] },
  t: (s) => s,
  formatGuestName: (g) => g.name,
  escapeHtml: (s) => String(s),
  fmt: { phone: (p) => p || "" },
  CURRENT_LANG: "en",
};
vm.createContext(ctx);
vm.runInContext(
  `let birthdayAlertData = [];
   let birthdayGreetedKeys = new Set();
   ${lift("computeDaysUntilBirthday")}
   ${lift("birthdayGreetKey")}
   ${lift("isBirthdayGreeted")}
   ${lift("birthdayHasPassed")}
   ${lift("birthdayNeedsFollowUp")}
   ${lift("computeBirthdayAlerts")}
   ${lift("birthdayDueCount")}
   ${lift("birthdayDayLabel")}
   function renderBirthdayAlertBadge() {}
   function renderBirthdayAlertPanel() {}
   function updateBirthdayReportBadge() {}
   function updateBirthdayNavDots() {}
   globalThis.T = {
     computeBirthdayAlerts, birthdayDueCount, birthdayDayLabel,
     birthdayNeedsFollowUp, isBirthdayGreeted, birthdayHasPassed,
     greet: (id, year) => birthdayGreetedKeys.add(birthdayGreetKey(id, year)),
     ungreet: (id, year) => birthdayGreetedKeys.delete(birthdayGreetKey(id, year)),
     clearGreetings: () => { birthdayGreetedKeys = new Set(); },
     alerts: () => birthdayAlertData,
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

const YEAR = 2026;
// Today is 15 August 2026.
const GUESTS = [
  { id: "today", name: "Birthday Today", phone: "08111", birthday: "1990-08-15" },
  { id: "soon", name: "In Three Days", phone: "08222", birthday: "1985-08-18" },
  { id: "late", name: "End Of Month", phone: "08333", birthday: "1992-08-31" },
  { id: "passed", name: "Earlier This Month", phone: "08444", birthday: "1988-08-03" },
  { id: "nophone", name: "No Phone", phone: null, birthday: "1991-08-20" },
  { id: "nextmonth", name: "September", phone: "08555", birthday: "1990-09-04" },
  { id: "lastmonth", name: "July", phone: "08666", birthday: "1990-07-09" },
];

console.log("\nThe month list: this month only, everyone in it");
T.clearGreetings();
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
const ids = T.alerts().map((g) => g.id);
eq("six guests are not in August", ids.length, 5);
eq("September is excluded", ids.includes("nextmonth"), false);
eq("July is excluded", ids.includes("lastmonth"), false);
eq("the passed birthday is still listed", ids.includes("passed"), true);
eq("the guest with no phone is still listed", ids.includes("nophone"), true);

console.log("\nThe red count: only what the front desk can still act on");
// today + soon + late = 3. Not `passed` (cannot be un-missed), not `nophone`
// (cannot be WhatsApped, so it would be a task nobody can finish).
eq("three still to greet", T.birthdayDueCount(), 3);

console.log("\nGreeting someone takes them out of the count, not the list");
T.greet("today", YEAR);
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
eq("count drops to two", T.birthdayDueCount(), 2);
eq("but they are still in the list", T.alerts().map((g) => g.id).includes("today"), true);
eq("and the row knows it", T.alerts().find((g) => g.id === "today").greeted, true);

T.greet("soon", YEAR);
T.greet("late", YEAR);
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
eq("badge clears when everyone actionable is done", T.birthdayDueCount(), 0);
eq("the list is still five people", T.alerts().length, 5);

console.log("\nUndo puts them back");
T.ungreet("soon", YEAR);
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
eq("count goes back up", T.birthdayDueCount(), 1);

console.log("\nA greeting belongs to one year only");
T.clearGreetings();
T.greet("today", 2025); // greeted last year, not this one
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
eq("last year's greeting does not count for this year", T.birthdayDueCount(), 3);
eq("2025 is still recorded", T.isBirthdayGreeted("today", 2025), true);
eq("2026 is not", T.isBirthdayGreeted("today", 2026), false);

console.log("\nBrowsing another month must not clear the badge");
// This is the failure the guard exists for: a manager opens the birthday
// report, clicks forward to December, and the loader hands December's guests
// to the same function that owns the badge.
T.clearGreetings();
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
eq("August badge is three", T.birthdayDueCount(), 3);
T.computeBirthdayAlerts([{ id: "dec", name: "Dec", phone: "08999", birthday: "1990-12-02" }], 12, YEAR);
eq("December's data left the badge alone", T.birthdayDueCount(), 3);
eq("and did not replace the list", T.alerts().length, 5);
// Same guard for a future year of the current month.
T.computeBirthdayAlerts([], 8, YEAR + 1);
eq("next August left the badge alone too", T.birthdayDueCount(), 3);

console.log("\nOrdering: what still needs doing comes first");
T.clearGreetings();
T.computeBirthdayAlerts(GUESTS, 8, YEAR);
const order = T.alerts().map((g) => g.id);
eq("today is first", order[0], "today");
eq("then the 18th", order[1], "soon");
eq("then the 31st", order[2], "late");
// passed and nophone are not actionable, so they sink below the three above.
eq("the non-actionable two are last", order.slice(3).sort().join(","), "nophone,passed");

console.log("\nDay labels");
const byId = (id) => T.alerts().find((g) => g.id === id);
eq("today reads Today", T.birthdayDayLabel(byId("today")).text, "Today");
eq("the 18th reads in 3 days", T.birthdayDayLabel(byId("soon")).text, "in 3 days");
// computeDaysUntilBirthday rolls a past date to NEXT year, so this one comes
// back as ~353 days. Reporting that would be nonsense; it must say "passed".
eq("the 3rd reads passed", T.birthdayDayLabel(byId("passed")).text, "passed");

console.log("\nbirthdayNeedsFollowUp on its own");
T.clearGreetings();
const today = new FakeDate();
eq("today, phone, not greeted", T.birthdayNeedsFollowUp(GUESTS[0], YEAR, today), true);
eq("no phone is never due", T.birthdayNeedsFollowUp(GUESTS[4], YEAR, today), false);
eq("a passed birthday is not due", T.birthdayNeedsFollowUp(GUESTS[3], YEAR, today), false);
eq("no birthday on file is not due", T.birthdayNeedsFollowUp({ id: "x", phone: "08" }, YEAR, today), false);
eq("undefined guest is not due", T.birthdayNeedsFollowUp(null, YEAR, today), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
