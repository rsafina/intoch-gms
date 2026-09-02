// The schema reference scanner, tested on the shapes that fooled it.
//
// This matters more than it looks. scripts/schema-check.js is the thing that
// decides whether a new client's database is complete, and it is trusted
// without a human re-reading the SQL. A scanner that invents a column wastes
// a day; a scanner that MISSES one ships a client a screen that 400s. Both
// failures were live during development, so both are pinned here.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { collect, stripComments, blankLiterals } = require("../scripts/schema-refs.js");

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

// Write a throwaway source tree and scan it.
function scan(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-refs-"));
  fs.mkdirSync(path.join(dir, "js"));
  for (const [name, body] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), body);
  return collect(dir);
}

console.log("\nColumns are attributed to the right table");
{
  const r = scan({
    "js/a.js": `
      db.from("guests").select("id, name, phone").eq("do_not_contact", false);
      db.from("visits").select("id, spend_amount").order("visit_date");
    `,
  });
  ok("guests gets its own columns", ["do_not_contact", "id", "name", "phone"].every((c) => r.tables.guests.includes(c)));
  ok("visits gets its own columns", r.tables.visits.includes("spend_amount") && r.tables.visits.includes("visit_date"));
  ok("guests did not absorb visits columns", !r.tables.guests.includes("spend_amount"));
}

console.log("\nEmbedded relations belong to the related table, not this one");
{
  const r = scan({
    "js/a.js": `db.from("visits").select("id, guests(name, phone), areas(name)");`,
  });
  ok("visits keeps only its own column", r.tables.visits.join(",") === "id");
  ok("the relation name is not read as a column", !r.tables.visits.includes("guests"));
}

console.log("\nA colon inside a string is not a column name");
{
  // The exact live false positive: `Reservation deleted: ${reason}` was read
  // as a column "deleted" on visits, which does not exist. A non-greedy brace
  // match stops at the } of ${reason}, leaving the literal unterminated.
  const r = scan({
    "js/a.js": `
      db.from("visits").update({
        voided_at: new Date().toISOString(),
        void_reason: \`Reservation deleted: \${reason}\`,
      }).in("id", ids);
    `,
  });
  ok("real keys are collected", r.tables.visits.includes("voided_at") && r.tables.visits.includes("void_reason"));
  ok("the interpolated message is not a column", !r.tables.visits.includes("deleted"));
}

console.log("\nES6 shorthand keys are columns too");
{
  // The live miss: `.update({ member_number, nickname })` named two real
  // columns and the scanner saw neither, because neither is followed by a
  // colon. schema-check would then pass a client database missing the
  // column, which is a screen that 400s on their first day.
  const r = scan({
    "js/a.js": `
      db.from("members").update({ member_number, nickname }).eq("id", id);
      db.from("areas").insert({ name, capacity, is_active: true });
    `,
  });
  ok("both shorthand keys are collected", r.tables.members.includes("member_number") && r.tables.members.includes("nickname"));
  ok("shorthand and normal keys mix", ["capacity", "is_active", "name"].every((c) => r.tables.areas.includes(c)));
}

console.log("\nShorthand reading must not invent columns");
{
  const r = scan({
    "js/a.js": `
      db.from("visits").insert({ guest_id: id, meta: { source, channel } });
      db.from("guests").update({ ...patch, name: n });
    `,
  });
  // meta is jsonb. Its keys describe the value, not the table.
  ok("a nested object's keys are not columns", !r.tables.visits.includes("source") && !r.tables.visits.includes("channel"));
  ok("the real column survives the nesting", r.tables.visits.includes("guest_id"));
  ok("a spread is not a column", !r.tables.guests.includes("patch"));
  ok("the key beside the spread survives", r.tables.guests.includes("name"));
}

console.log("\nComments are prose, not queries");
{
  const r = scan({
    "js/a.js": `
      // We used to read from("old_table") here before the rework.
      /* .from("older_table") is long gone */
      db.from("guests").select("id");
    `,
  });
  ok("a table named only in a comment is ignored", !("old_table" in r.tables) && !("older_table" in r.tables));
  ok("the real table survives", "guests" in r.tables);
}

console.log("\nA URL inside a string does not look like a comment");
{
  const src = `const u = "https://example.com/x"; // trailing`;
  ok("stripComments keeps the URL", stripComments(src).includes("https://example.com/x"));
  ok("stripComments drops the trailing comment", !stripComments(src).includes("trailing"));
}

console.log("\nRPCs and their named arguments");
{
  const r = scan({
    "js/a.js": `
      db.rpc("recalc_all_tiers");
      db.rpc("add_member_transaction", { p_member_id: id, p_amount: amt, p_visit_id: v });
    `,
  });
  ok("no-argument rpc is found", "recalc_all_tiers" in r.rpcs);
  ok("named arguments are collected", ["p_amount", "p_member_id", "p_visit_id"].every((a) => r.rpcs.add_member_transaction.includes(a)));
}

console.log("\nStorage buckets, inline and via a constant");
{
  const r = scan({
    "js/a.js": `
      const DISH_IMAGE_BUCKET = "dish-images";
      db.storage.from("promo-images").upload(p, blob);
      db.storage.from(DISH_IMAGE_BUCKET).upload(p, blob);
    `,
  });
  ok("an inline bucket name is found", r.buckets.includes("promo-images"));
  ok("a bucket held in a constant is found", r.buckets.includes("dish-images"));
  ok("a bucket is not mistaken for a table", !("promo-images" in r.tables));
}

console.log("\nArray.from is not a database call");
{
  const r = scan({ "js/a.js": `const xs = Array.from(document.querySelectorAll("li"));` });
  ok("Array.from is ignored", Object.keys(r.tables).length === 0);
}

console.log("\nA CRLF checkout scans identically to an LF one");
{
  const body = `db.from("guests").select("id, name").eq("phone", p);`;
  const lf = scan({ "js/a.js": body });
  const crlf = scan({ "js/a.js": body.replace(/\n/g, "\r\n") });
  ok("same columns either way", JSON.stringify(lf.tables) === JSON.stringify(crlf.tables));
}

console.log("\nAn unreadable payload is reported, and does not fail the run");
{
  const r = scan({
    "js/a.js": `
      const payload = { name: n, phone: p };
      db.from("guests").update(payload).eq("id", id);
      db.from("visits").insert({ guest_id: g });
    `,
  });
  // The whole point: this is the shape half the codebase uses, so it must be
  // VISIBLE without turning schema-check permanently red.
  ok("the variable payload is listed", r.unreadable.length === 1 && r.unreadable[0].includes("update(payload)"));
  ok("it is not counted as a dynamic .from()", r.dynamic.length === 0);
  ok("a literal payload beside it is still read", r.tables.visits.includes("guest_id"));
  ok("the table itself is still recorded", "guests" in r.tables);
}

console.log("\nA runtime table name is reported, never silently passed");
{
  const r = scan({ "js/a.js": `db.from(tableName).select("id");` });
  ok("dynamic .from() is flagged", r.dynamic.length === 1);
}

console.log("\nblankLiterals keeps structure while emptying content");
{
  const out = blankLiterals('{ a: "x: y", b: `p: ${q}` }');
  ok("braces survive", out.includes("{") && out.includes("}"));
  ok("string content is gone", !out.includes("x: y"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
