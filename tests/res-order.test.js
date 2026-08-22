// Ordering rules for the reservation lists.
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync("js/app.js", "utf8");

// Pull the real implementations out of app.js so the test can't drift
// from the shipped code.
const grab = (name) => {
  const i = src.indexOf(name);
  assert.ok(i > -1, name + " not found in app.js");
  return i;
};
const setSrc = src.slice(grab("const CANCELLED_RES_STATUSES"), grab("function renderDashboardReservations"));
const sandbox = {};
new Function("ctx", setSrc + "\nctx.isCancelledRes=isCancelledRes;ctx.sortResCancelledLast=sortResCancelledLast;ctx.CANCELLED_RES_STATUSES=CANCELLED_RES_STATUSES;")(sandbox);
const { isCancelledRes, sortResCancelledLast, CANCELLED_RES_STATUSES } = sandbox;

// Dashboard rank, extracted the same way.
const dashSrc = src.slice(grab("const rank = (r) =>"), grab("dashboardResData = [...data]"));
const dash = {};
new Function("ctx", "isCancelledRes", dashSrc + "\nctx.rank=rank;")(dash, isCancelledRes);
const rank = dash.rank;

let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass++; console.log("  ok  " + n); } catch (e) { fail++; console.log("  FAIL " + n + " :: " + e.message); } };

const r = (name, time, status) => ({ name, reservation_time: time, status });

check("all three cancelled statuses in the DB constraint are covered", () => {
  ["Cancelled", "Cancelled (No Show)", "No Show"].forEach((s) =>
    assert.ok(isCancelledRes(s), s + " should sink"));
});

check("active and completed statuses do not sink", () => {
  ["Reserved", "Confirmed", "Arrived", "Completed"].forEach((s) =>
    assert.ok(!isCancelledRes(s), s + " should NOT sink"));
});

check("Deleted is deliberately excluded", () => {
  assert.ok(!CANCELLED_RES_STATUSES.has("Deleted"));
});

check("day list: cancelled sink, everything else keeps time order", () => {
  // Mirrors the 9 Aug screenshot.
  const day = [
    r("Ibu Ari", "11:00", "Completed"),
    r("Rian", "15:15", "Completed"),
    r("Febrianing", "18:00", "Cancelled"),
    r("Anindya", "18:30", "Reserved"),
  ];
  assert.deepStrictEqual(
    sortResCancelledLast(day).map((x) => x.name),
    ["Ibu Ari", "Rian", "Anindya", "Febrianing"],
  );
});

check("day list: no-show sinks too (the bug being fixed)", () => {
  const day = [
    r("A", "10:00", "Cancelled (No Show)"),
    r("B", "11:00", "Reserved"),
    r("C", "12:00", "No Show"),
    r("D", "13:00", "Arrived"),
  ];
  assert.deepStrictEqual(
    sortResCancelledLast(day).map((x) => x.name), ["B", "D", "A", "C"]);
});

check("multiple cancelled keep their relative time order at the bottom", () => {
  const day = [
    r("early-cancel", "09:00", "Cancelled"),
    r("late-cancel", "20:00", "Cancelled"),
    r("live", "12:00", "Reserved"),
  ];
  assert.deepStrictEqual(
    sortResCancelledLast(day).map((x) => x.name),
    ["live", "early-cancel", "late-cancel"]);
});

check("sort does not mutate the caller's array", () => {
  const day = [r("A", "10:00", "Cancelled"), r("B", "11:00", "Reserved")];
  const copy = day.slice();
  sortResCancelledLast(day);
  assert.deepStrictEqual(day, copy);
});

check("handles empty / null input", () => {
  assert.deepStrictEqual(sortResCancelledLast([]), []);
  assert.deepStrictEqual(sortResCancelledLast(null), []);
  assert.deepStrictEqual(sortResCancelledLast(undefined), []);
});

check("all-cancelled list (Cancelled chip) is a no-op", () => {
  const day = [r("A", "09:00", "Cancelled"), r("B", "10:00", "Cancelled (No Show)")];
  assert.deepStrictEqual(sortResCancelledLast(day).map((x) => x.name), ["A", "B"]);
});

check("dashboard uses three tiers: active < completed < cancelled", () => {
  assert.strictEqual(rank(r("", "", "Reserved")), 0);
  assert.strictEqual(rank(r("", "", "Arrived")), 0);
  assert.strictEqual(rank(r("", "", "Completed")), 1);
  assert.strictEqual(rank(r("", "", "Cancelled")), 2);
  assert.strictEqual(rank(r("", "", "Cancelled (No Show)")), 2);
  assert.strictEqual(rank(r("", "", "No Show")), 2);
});

check("dashboard order matches the 9 Aug screenshot expectation", () => {
  const rows = [
    r("Ibu Ari", "11:00", "Completed"),
    r("Rian", "15:15", "Completed"),
    r("Febrianing", "18:00", "Cancelled"),
    r("Anindya", "18:30", "Reserved"),
  ];
  assert.deepStrictEqual(
    [...rows].sort((a, b) => rank(a) - rank(b)).map((x) => x.name),
    ["Anindya", "Ibu Ari", "Rian", "Febrianing"]);
});

check("day list sort is actually wired into loadReservations", () => {
  const i = src.indexOf("async function loadReservations()");
  assert.ok(src.slice(i, i + 3000).includes("allReservations = sortResCancelledLast(data)"));
});

check("old incomplete TERMINAL_RES set is gone", () => {
  assert.ok(!src.includes('new Set(["Completed", "No Show", "Cancelled"])'));
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
