// Money against a booking: rows, not columns, and no stored status.
//
// WHY THIS EXISTS
// Rere, 2026-08-23: "the payment itself vary between each restaurant anyway,
// so we cant put exact writing format for this". That one sentence rules out
// `dp_amount` / `balance` / `deposit_paid` columns, because they encode one
// restaurant's habit as a schema and break on the next client who takes a flat
// fee, or full prepayment, or three instalments, or nothing.
//
// Two shapes are easy to reintroduce by accident and both are wrong:
//   1. a `deposit_paid` boolean, which cannot express a partial payment and
//      goes stale the moment a payment row is edited or deleted
//   2. an enum on `method`, which this schema has already taken an outage from
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(ROOT, "migrations", "ALL_IN_ONE.sql"), "utf8");
const spec = fs.readFileSync(path.join(ROOT, "RESERVATION_INVOICE_SPEC.md"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

const tbl = sql.slice(
  sql.indexOf("create table if not exists public.invoice_payments"),
  sql.indexOf("create index if not exists idx_invoice_payments_reservation"),
);

console.log("\nPayments are rows");
ok("the table exists", tbl.length > 0);
ok("amount is numeric and required", /amount\s+numeric not null/.test(tbl));
// The failure this guards is a positive-only constraint on amount, which would
// force refunds into a second table with its own everything to reconcile. My
// first pattern also matched the legitimate `amount <> 0` check, so it is
// pinned to the actual mistake instead.
ok("a refund is expressible",
   !/amount\s*>\s*0/.test(tbl) && !/amount\s*>=\s*0/.test(tbl),
   "A positive-only CHECK would force refunds into a second table.");
ok("zero is refused", /amount <> 0/.test(tbl));

console.log("\nmethod is free text, deliberately");
ok("method has no enum or CHECK", /method\s+text/.test(tbl) && !/method[^,]*check/i.test(tbl),
   "Constraining method is the same mistake as constraining the deposit shape.");

console.log("\nA payment has exactly one parent");
// The deposit flow issues no invoice, so a required invoice_id would mean
// inventing paperwork to satisfy a foreign key.
ok("invoice_id is nullable", /invoice_id\s+uuid,/.test(tbl));
ok("reservation_id exists and cascades",
   /reservation_id uuid references public\.reservations\(id\) on delete cascade/.test(tbl));
ok("a CHECK enforces exactly one",
   /invoice_payments_one_parent[\s\S]{0,220}invoice_id is not null and reservation_id is null[\s\S]{0,120}invoice_id is null and reservation_id is not null/i.test(tbl));

console.log("\nNothing stores a payment status");
for (const banned of ["deposit_paid", "deposit_status", "payment_status", "is_paid"]) {
  ok(`no ${banned} column is created`,
     !new RegExp(`add column if not exists ${banned}\\b`, "i").test(sql) &&
     !new RegExp(`\\n\\s+${banned}\\s+(boolean|text)`, "i").test(sql),
     `A stored status is a second truth that drifts when a payment row changes.`);
}
ok("state is derived in a view instead",
   /create view public\.reservation_deposit_balances/.test(sql));
const view = sql.slice(
  sql.indexOf("create view public.reservation_deposit_balances"),
  sql.indexOf("comment on view public.reservation_deposit_balances"),
);
ok("the view sums payments rather than reading a flag", /sum\(p\.amount\)/.test(view));
ok("it distinguishes none / unpaid / partial / paid",
   ["'none'", "'unpaid'", "'partial'", "'paid'"].every((s) => view.includes(s)));
ok("a soft-deleted booking is excluded", /r\.deleted_at is null/.test(view));
ok("the view is readable by the app", /grant select on public\.reservation_deposit_balances/.test(sql));

console.log("\nThe confirm block proves all of it on a real database");
for (const row of ["invoice_payments exists", "a payment has exactly one parent",
                   "the deposit balances view exists", "no deposit status column was added"]) {
  ok(`confirm row: "${row}"`, sql.includes(row));
}

console.log("\nThe decision is written down, not just implemented");
// So the next person does not re-derive it, or quietly reverse it.
ok("decision 5 records that payments need no invoice", /A payment with no invoice/.test(spec));
ok("decision 6 records the accepted RLS risk", /Building this before RLS/.test(spec));
ok("the risk section says what the acceptance does NOT cover",
   /does NOT extend to shipping invoices to\s*\n?a paying client|does NOT extend to/i.test(spec));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
