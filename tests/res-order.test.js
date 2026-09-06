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
new Function("ctx", setSrc + "\nctx.isCancelledRes=isCancelledRes;ctx.sortReservationsByStatus=sortReservationsByStatus;ctx.resStatusSortRank=resStatusSortRank;ctx.CANCELLED_RES_STATUSES=CANCELLED_RES_STATUSES;")(sandbox);
const { isCancelledRes, sortReservationsByStatus, resStatusSortRank, CANCELLED_RES_STATUSES } = sandbox;

// Dashboard rank, extracted the same way.
const dashStart = src.indexOf("const rank = (r) =>", grab("function renderDashboardReservations"));
assert.ok(dashStart > -1, "dashboard rank not found in app.js");
const dashSrc = src.slice(dashStart, grab("dashboardResData = [...data]"));
const dash = {};
new Function("ctx", "isCancelledRes", "resStatusSortRank", dashSrc + "\nctx.rank=rank;")(
  dash,
  isCancelledRes,
  resStatusSortRank,
);
const rank = dash.rank;

let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass++; console.log("  ok  " + n); } catch (e) { fail++; console.log("  FAIL " + n + " :: " + e.message); } };

const r = (name, time, status) => ({ name, reservation_time: time, status });

check("all three cancelled statuses in the DB constraint are covered", () => {
  ["Cancelled", "Cancelled (No Show)", "No Show"].forEach((s) =>
    assert.ok(isCancelledRes(s), s + " should sink"));
});

check("active and completed statuses do not sink", () => {
  ["Reserved", "Confirmed", "Incoming", "Arrived", "Completed"].forEach((s) =>
    assert.ok(!isCancelledRes(s), s + " should NOT sink"));
});

check("Deleted is deliberately excluded", () => {
  assert.ok(!CANCELLED_RES_STATUSES.has("Deleted"));
});

check("day list: status groups sort in service priority order", () => {
  // Mirrors the 9 Aug screenshot.
  const day = [
    r("Ibu Ari", "11:00", "Completed"),
    r("Rian", "15:15", "Completed"),
    r("Febrianing", "18:00", "Cancelled"),
    r("Walked in", "19:00", "Arrived"),
    r("Deposit", "20:00", "Incoming"),
    r("Anindya", "18:30", "Reserved"),
  ];
  assert.deepStrictEqual(
    sortReservationsByStatus(day).map((x) => x.name),
    ["Deposit", "Anindya", "Walked in", "Ibu Ari", "Rian", "Febrianing"],
  );
});

check("day list: status sort keeps time order inside a group", () => {
  const day = [
    r("early-reserved", "18:00", "Reserved"),
    r("deposit-needed", "21:00", "Incoming"),
    r("cancelled", "17:00", "Cancelled"),
    r("late-reserved", "22:00", "Reserved"),
  ];
  assert.deepStrictEqual(
    sortReservationsByStatus(day).map((x) => x.name),
    ["deposit-needed", "early-reserved", "late-reserved", "cancelled"]);
});

check("day list: no-show sinks too (the bug being fixed)", () => {
  const day = [
    r("A", "10:00", "Cancelled (No Show)"),
    r("B", "11:00", "Reserved"),
    r("C", "12:00", "No Show"),
    r("D", "13:00", "Arrived"),
  ];
  assert.deepStrictEqual(
    sortReservationsByStatus(day).map((x) => x.name), ["B", "D", "A", "C"]);
});

check("multiple cancelled keep their relative time order at the bottom", () => {
  const day = [
    r("early-cancel", "09:00", "Cancelled"),
    r("late-cancel", "20:00", "Cancelled"),
    r("live", "12:00", "Reserved"),
  ];
  assert.deepStrictEqual(
    sortReservationsByStatus(day).map((x) => x.name),
    ["live", "early-cancel", "late-cancel"]);
});

check("sort does not mutate the caller's array", () => {
  const day = [r("A", "10:00", "Cancelled"), r("B", "11:00", "Reserved")];
  const copy = day.slice();
  sortReservationsByStatus(day);
  assert.deepStrictEqual(day, copy);
});

check("handles empty / null input", () => {
  assert.deepStrictEqual(sortReservationsByStatus([]), []);
  assert.deepStrictEqual(sortReservationsByStatus(null), []);
  assert.deepStrictEqual(sortReservationsByStatus(undefined), []);
});

check("all-cancelled list (Cancelled chip) is a no-op", () => {
  const day = [r("A", "09:00", "Cancelled"), r("B", "10:00", "Cancelled (No Show)")];
  assert.deepStrictEqual(sortReservationsByStatus(day).map((x) => x.name), ["A", "B"]);
});

check("status ranks match the requested service priority", () => {
  assert.ok(resStatusSortRank("Incoming") < resStatusSortRank("Reserved"));
  assert.ok(resStatusSortRank("Reserved") < resStatusSortRank("Arrived"));
  assert.ok(resStatusSortRank("Arrived") < resStatusSortRank("Completed"));
  assert.ok(resStatusSortRank("Completed") < resStatusSortRank("Cancelled"));
  assert.ok(resStatusSortRank("Cancelled") < resStatusSortRank("Deleted"));
});

check("dashboard order follows the same status rank", () => {
  const rows = [
    r("Reserved", "18:00", "Reserved"),
    r("Incoming", "21:00", "Incoming"),
    r("Arrived", "19:00", "Arrived"),
    r("Completed", "17:00", "Completed"),
  ];
  assert.deepStrictEqual(
    [...rows].sort((a, b) => rank(a) - rank(b)).map((x) => x.name),
    ["Incoming", "Reserved", "Arrived", "Completed"]);
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
  assert.ok(src.slice(i, i + 3000).includes("allReservations = sortReservationsByStatus(data)"));
});

check("old incomplete TERMINAL_RES set is gone", () => {
  assert.ok(!src.includes('new Set(["Completed", "No Show", "Cancelled"])'));
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
