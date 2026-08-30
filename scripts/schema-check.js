#!/usr/bin/env node
// Compare what the app asks the database for against what a database
// actually contains, and list what is missing.
//
// HOW TO USE IT
//
//   1. Open the target project in the Supabase SQL Editor. For a NEW client
//      that means: run migrations/ALL_IN_ONE.sql there first, on the empty
//      project, exactly as the client setup does.
//   2. Run scripts/schema-dump.sql in the same editor. It returns one row,
//      one column, containing JSON.
//   3. Save that JSON to a file, e.g. catalog.json.
//   4. node scripts/schema-check.js catalog.json
//
// Exit code 0 means no missing object. Non-zero means the app references
// something the database does not have, which for a client is a screen that
// 400s. See scripts/schema-refs.js for what this does and does not cover.
//
// This does NOT need Postgres installed locally. The SQL editor does the
// database half; Node does the source half.

const fs = require("fs");
const path = require("path");
const { collect } = require("./schema-refs.js");

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/schema-check.js <catalog.json>");
  console.error("       (produce catalog.json by running scripts/schema-dump.sql)");
  process.exit(2);
}

let catalog;
try {
  const raw = fs.readFileSync(arg, "utf8").trim();
  // The SQL editor's "copy as JSON" wraps the row in an array, and its
  // plain copy sometimes brings the column header along. Accept all three
  // shapes rather than make the operator reformat by hand at the exact
  // moment they are trying to stand up a client.
  const parsed = JSON.parse(raw.startsWith("[") || raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{")));
  catalog = Array.isArray(parsed) ? parsed[0] : parsed;
  if (catalog && catalog.catalog) catalog = catalog.catalog; // column alias kept
} catch (e) {
  console.error(`Could not read ${arg} as JSON: ${e.message}`);
  process.exit(2);
}

for (const key of ["relations", "functions", "buckets"]) {
  if (!catalog || !(key in catalog)) {
    console.error(`${arg} is missing "${key}". Was it produced by scripts/schema-dump.sql?`);
    process.exit(2);
  }
}

const refs = collect(path.join(__dirname, ".."));
const gaps = [];

for (const [table, cols] of Object.entries(refs.tables)) {
  const built = catalog.relations[table];
  if (!built) {
    gaps.push({ kind: "relation", name: table, detail: "table or view does not exist" });
    continue;
  }
  for (const c of cols)
    if (!built.includes(c))
      gaps.push({ kind: "column", name: `${table}.${c}`, detail: "column does not exist" });
}

for (const [fn, args] of Object.entries(refs.rpcs)) {
  const built = catalog.functions[fn];
  if (!built) {
    gaps.push({ kind: "function", name: fn, detail: "function does not exist" });
    continue;
  }
  const sig = [].concat(built).join(" | ");
  for (const a of args)
    if (!new RegExp(`\\b${a}\\b`).test(sig))
      gaps.push({
        kind: "argument",
        name: `${fn}(${a})`,
        detail: `not in the deployed signature: ${sig}`,
      });
}

for (const b of refs.buckets)
  if (!catalog.buckets.includes(b))
    gaps.push({ kind: "bucket", name: b, detail: "storage bucket does not exist" });

console.log(
  `Checked ${Object.keys(refs.tables).length} relations, ` +
    `${Object.values(refs.tables).reduce((n, c) => n + c.length, 0)} columns, ` +
    `${Object.keys(refs.rpcs).length} functions, ` +
    `${refs.buckets.length} buckets.\n`,
);

// A table name built at runtime is invisible to a static scan, so a green
// run would be a lie. Report it as loudly as a real gap.
if (refs.dynamic.length) {
  console.log("WARNING: .from() called with a non-literal. This check cannot see these:");
  for (const d of refs.dynamic) console.log(`  ${d}`);
  console.log("");
}

if (!gaps.length) {
  console.log("No missing objects.");
  process.exit(refs.dynamic.length ? 1 : 0);
}

console.log(`${gaps.length} missing object${gaps.length === 1 ? "" : "s"}:\n`);
for (const g of gaps) console.log(`  ${g.kind.padEnd(9)} ${g.name.padEnd(38)} ${g.detail}`);
console.log(
  "\nEach of these is a screen that returns 400 for the client. Add them to " +
    "migrations/ALL_IN_ONE.sql, then rebuild an empty project and re-run this.",
);
process.exit(1);
