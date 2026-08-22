// Node test harness for the reservation total / total-pax math (2026-08-06).
// Run: node tests/pax-totals.test.js
//
// app.js is a browser script with no module exports, so this file slices the
// two pure functions straight out of the real source and evaluates them.
// Nothing is copy-pasted, so the test cannot silently drift from production.

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "js", "app.js"),
  "utf8",
);

function extractFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name}() not found in js/app.js`);
  // Walk braces from the first { after the signature to find the body end.
  const open = SRC.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`Could not find end of ${name}()`);
}

// RES_OCCUPANCY_STATUSES is read straight from app.js too, so if someone
// changes the status scope there these tests follow it.
const statusLine = SRC.match(/const RES_OCCUPANCY_STATUSES = (\[[^\]]*\]);/);
if (!statusLine) throw new Error("RES_OCCUPANCY_STATUSES not found");

const sandbox = {};
// eslint-disable-next-line no-eval
const load = new Function(
  `${statusLine[0]}
   ${extractFunction("computeUnplacedStats")}
   ${extractFunction("bucketReservationTotals")}
   return { RES_OCCUPANCY_STATUSES, computeUnplacedStats, bucketReservationTotals };`,
);
Object.assign(sandbox, load());

const { computeUnplacedStats, bucketReservationTotals } = sandbox;

let pass = 0,
  fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got),
    b = JSON.stringify(want);
  if (a === b) {
    pass += 1;
    console.log("  PASS  " + name);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}  → got ${a}, want ${b}`);
  }
}

// ── computeUnplacedStats ────────────────────────────────────────────
console.log("\ncomputeUnplacedStats()");

eq("empty day", computeUnplacedStats([]), { count: 0, pax: 0 });

eq(
  "counts only rows with no assigned_area",
  computeUnplacedStats([
    { pax: 4, assigned_area: null },
    { pax: 8, assigned_area: "area-indoor" },
    { pax: 9, assigned_area: undefined },
    { pax: 2, assigned_area: "" },
  ]),
  { count: 3, pax: 15 },
);

eq(
  "null / string / missing pax never produces NaN",
  computeUnplacedStats([
    { pax: null, assigned_area: null },
    { pax: "6", assigned_area: null },
    { assigned_area: null },
  ]),
  { count: 3, pax: 6 },
);

eq(
  "everything placed → zero, so the UI line stays hidden",
  computeUnplacedStats([
    { pax: 4, assigned_area: "a" },
    { pax: 2, assigned_area: "b" },
  ]),
  { count: 2 - 2, pax: 0 },
);

// ── bucketReservationTotals ─────────────────────────────────────────
console.log("\nbucketReservationTotals()");

const DATES = ["2026-08-06", "2026-08-07", "2026-08-08"];

eq(
  "empty result set → three zeroed buckets",
  bucketReservationTotals([], DATES),
  [0, 1, 2].map(() => ({
    count: 0,
    activeCount: 0,
    pax: 0,
    excluded: 0,
    unplacedCount: 0,
    unplacedPax: 0,
  })),
);

const rows = [
  // day 0 — a normal mix
  { reservation_date: DATES[0], pax: 4, status: "Reserved", assigned_area: null },
  { reservation_date: DATES[0], pax: 8, status: "Arrived", assigned_area: "indoor" },
  { reservation_date: DATES[0], pax: 6, status: "Completed", assigned_area: "indoor" },
  { reservation_date: DATES[0], pax: 10, status: "Cancelled", assigned_area: null },
  { reservation_date: DATES[0], pax: 5, status: "Cancelled (No Show)", assigned_area: "indoor" },
  { reservation_date: DATES[0], pax: 3, status: "Deleted", assigned_area: null },
  // day 1 — everything still unplaced
  { reservation_date: DATES[1], pax: 9, status: "Reserved", assigned_area: null },
  { reservation_date: DATES[1], pax: 2, status: "Reserved", assigned_area: null },
  // a date outside the three tabs must be ignored entirely
  { reservation_date: "2026-08-20", pax: 50, status: "Reserved", assigned_area: null },
];

const totals = bucketReservationTotals(rows, DATES);

eq("day 0 — tab count includes every row for the date", totals[0].count, 6);
eq("day 0 — active count excludes cancelled/no-show/deleted", totals[0].activeCount, 3);
eq("day 0 — pax is 4+8+6, cancelled 10 and no-show 5 excluded", totals[0].pax, 18);
eq("day 0 — excluded counts cancelled + no-show but NOT deleted", totals[0].excluded, 2);
eq("day 0 — unplaced counts only the active unassigned row", totals[0].unplacedCount, 1);
eq("day 0 — unplaced pax ignores the cancelled unassigned party", totals[0].unplacedPax, 4);

eq("day 1 — all unplaced", totals[1], {
  count: 2,
  activeCount: 2,
  pax: 11,
  excluded: 0,
  unplacedCount: 2,
  unplacedPax: 11,
});

eq("day 2 — untouched by out-of-range rows", totals[2].pax, 0);
eq("out-of-range row never lands in a bucket", totals.reduce((s, b) => s + b.count, 0), 8);

// Regression guard for the bug this feature fixes: the visible area cards
// only count placed reservations, so total pax must be >= their sum and the
// gap must be exactly the unplaced pax.
const placedPax = rows
  .filter(
    (r) =>
      r.reservation_date === DATES[0] &&
      sandbox.RES_OCCUPANCY_STATUSES.includes(r.status) &&
      r.assigned_area,
  )
  .reduce((s, r) => s + r.pax, 0);
eq(
  "total pax − area-card pax === unplaced pax",
  totals[0].pax - placedPax,
  totals[0].unplacedPax,
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
