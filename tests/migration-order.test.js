// Ordering rules inside migrations/ALL_IN_ONE.sql that an empty-database run
// cannot check.
//
// WHY THIS EXISTS
// The file is verified by building it onto an empty Postgres. That proves it
// is syntactically sound and re-runnable, and it proves nothing about a
// database with rows in it, because every backfill in the file is a WHERE
// that matches nothing when there is no data.
//
// One such backfill fired a trigger that called a function whose partner had
// been redefined with a different return shape 500 lines earlier. Result: a
// guest row stringified to `(medium_spender,)` and the whole migration
// aborted, on a real database, after passing every empty-database run.
//
// These assertions are cheap, they are about ordering rather than behaviour,
// and they would have caught it.
const fs = require("fs");
const path = require("path");

const sql = fs
  .readFileSync(path.join(__dirname, "..", "migrations", "ALL_IN_ONE.sql"), "utf8")
  .replace(/\r\n/g, "\n");
const lines = sql.split("\n");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// 1-indexed line numbers of every line matching a pattern.
const linesMatching = (re) =>
  lines.reduce((acc, l, i) => (re.test(l) ? acc.concat(i + 1) : acc), []);

console.log("\nThe spending tier function pair stays together");

const calcDefs = linesMatching(
  /^create or replace function\s+(public\.)?calculate_guest_spending_tier/i,
);
const recalcDefs = linesMatching(
  /^create or replace function\s+(public\.)?recalculate_guest_spending_tier/i,
);

ok("both functions are defined", calcDefs.length > 0 && recalcDefs.length > 0);

const lastCalc = Math.max(...calcDefs);
const lastRecalc = Math.max(...recalcDefs);

ok(
  "recalculate_ is defined AFTER the last calculate_",
  lastRecalc > lastCalc,
  `last calculate_ at line ${lastCalc}, last recalculate_ at line ${lastRecalc}. ` +
    "The pair must agree on the return shape before anything writes to visits or reservations.",
);

// The final recalculate_ must read the TABLE-returning function with FROM.
// `SELECT calculate_guest_spending_tier(id) INTO a_text_var` is the bug: it
// stringifies the whole row instead of failing.
const finalRecalcBody = lines.slice(lastRecalc - 1, lastRecalc + 40).join("\n");
ok(
  "the final recalculate_ reads its partner with FROM, not SELECT INTO",
  /from\s+calculate_guest_spending_tier\s*\(/i.test(finalRecalcBody),
  "selecting a TABLE-returning function into a text variable silently yields `(value,)`",
);

console.log("\nNothing writes to visits or reservations before the pair agrees");

// Only top-level DML counts. A write inside a function body executes when the
// app calls it, not while the migration runs.
const bodyRanges = [];
{
  let open = null;
  lines.forEach((l, i) => {
    const dollars = (l.match(/\$\$/g) || []).length;
    for (let d = 0; d < dollars; d++) {
      if (open === null) open = i + 1;
      else { bodyRanges.push([open, i + 1]); open = null; }
    }
  });
}
const insideFunctionBody = (n) => bodyRanges.some(([a, b]) => n > a && n < b);

const writes = linesMatching(
  /^\s*(update|insert into|delete from)\s+(public\.)?(visits|reservations)\b/i,
).filter((n) => !insideFunctionBody(n));

console.log(`  (${writes.length} top-level write(s) to visits/reservations)`);
for (const n of writes) {
  ok(
    `line ${n} runs after the function pair is consistent`,
    n > lastRecalc,
    `${lines[n - 1].trim().slice(0, 70)}\n        This fires the tier trigger. ` +
      `recalculate_ is only correct from line ${lastRecalc} onward.`,
  );
}

console.log("\nThe file stays re-runnable and non-destructive");
const destructive = linesMatching(
  /^\s*(truncate|drop\s+table(?!\s+if\s+exists\s+__)|drop\s+database)/i,
);
ok("no TRUNCATE or DROP TABLE at top level", destructive.length === 0,
  destructive.length ? `lines: ${destructive.join(", ")}` : "");

const deletes = linesMatching(/^\s*delete\s+from\s+/i).filter((n) => !insideFunctionBody(n));
ok("no top-level DELETE against real data", deletes.length === 0,
  deletes.length ? `lines: ${deletes.join(", ")}` : "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
