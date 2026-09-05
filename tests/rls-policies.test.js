// Every table that switches ON row level security must also be given a rule
// the app can actually satisfy.
//
// WHY THIS EXISTS
// On 2026-09-05 every area edit in production had been silently failing.
// `areas` had RLS enabled with two rules: "Public read" for SELECT, and
// "Authenticated full access" for everything else, tested with
// `auth.role() = 'authenticated'`.
//
// The staff app has no Supabase Auth at all. It logs in by looking up a
// username and PIN in the staff_users table, in JavaScript. Every request it
// makes is therefore the `anon` role, and that authenticated test is false on
// every single one. Postgres does not raise an error for a write no policy
// permits: it updates zero rows, and PostgREST answers 204 No Content, which
// is byte-identical to a successful write. So the app cheerfully reported
// "Area updated" over a save that did nothing, for days.
//
// Six comparable tables (guests, reservations, visits, prizes,
// spin_submissions, saved_segments) already had a permissive "Public full
// access" rule. areas was simply left out of it.
//
// This test pins the invariant that failure exposed: while the app has no
// database identity, ANY table with RLS enabled needs a write rule that a
// caller with no identity can satisfy. When real staff auth lands, this test
// is the thing to rewrite, deliberately, rather than something to delete
// quietly to make a red build go green.
const fs = require("fs");
const path = require("path");

const sql = fs
  .readFileSync(path.join(__dirname, "..", "migrations", "ALL_IN_ONE.sql"), "utf8")
  .replace(/\r\n/g, "\n");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// Tables the file switches RLS on for.
const rlsTables = [
  ...new Set(
    [...sql.matchAll(/alter\s+table\s+(?:public\.)?(\w+)\s+enable\s+row\s+level\s+security/gi)]
      .map((m) => m[1].toLowerCase()),
  ),
];

console.log("\nEvery RLS table is switched on somewhere");
ok("the file enables RLS on at least one table", rlsTables.length > 0);

// A rule the anon role can satisfy: FOR ALL, with USING (true) and
// WITH CHECK (true). Anything narrower is a rule the current app cannot meet.
function hasPermissiveWriteRule(table) {
  const re = new RegExp(
    `create\\s+policy\\s+"[^"]*"\\s+on\\s+(?:public\\.)?${table}\\s+for\\s+all\\s+` +
      `using\\s*\\(\\s*true\\s*\\)\\s*with\\s+check\\s*\\(\\s*true\\s*\\)`,
    "i",
  );
  return re.test(sql);
}

console.log("\nEvery RLS table has a write rule the app can satisfy");
for (const table of rlsTables.slice().sort()) {
  ok(
    `${table} has a FOR ALL policy with USING (true) WITH CHECK (true)`,
    hasPermissiveWriteRule(table),
    `${table} has row level security on but no rule an unauthenticated caller ` +
      `can satisfy. Writes to it will return 204 and change nothing. Either add ` +
      `the permissive rule, or take RLS off ${table} until real staff auth exists.`,
  );
}

console.log("\nA read-only rule is never the only rule on a table staff edit");
// The exact shape that broke areas: a SELECT rule present, and no FOR ALL
// permissive rule beside it.
for (const table of rlsTables.slice().sort()) {
  const readOnly = new RegExp(
    `create\\s+policy\\s+"[^"]*"\\s+on\\s+(?:public\\.)?${table}\\s+for\\s+select`,
    "i",
  ).test(sql);
  if (!readOnly) continue;
  ok(
    `${table} is not read-only-plus-authenticated (the areas trap)`,
    hasPermissiveWriteRule(table),
    `${table} can be read by anyone and written by nobody the app can be. ` +
      `This is exactly the shape that made every area edit fail silently.`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
