// Phase 2 of the managed-event flow: an invoice that is saved, attached to a
// booking, and visible to whoever is on shift.
//
// The decision this file exists to protect, taken with Rere on 2026-09-06:
// EXTEND the invoices table rather than add a reservation_invoices one beside
// it. Deposits already write to invoices. Two tables would put deposit money in
// one and event billing in the other, and every question about what a booking
// owes would have to read both and hope they agree.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");

const sql = read("migrations/ALL_IN_ONE.sql");
const invoiceJs = read("js/invoice.js");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// Comments stripped wherever a check looks for the ABSENCE of something: this
// section explains at length what it deliberately does not do, and grepping the
// raw text would keep flagging the explanations as the thing they warn against.
const stripSqlComments = (s) => s.replace(/--[^\n]*/g, "");

console.log("\nOne table, not two");
ok(
  "no second invoice table was created",
  !/create table[^;]*reservation_invoices/i.test(stripSqlComments(sql)),
  "A reservation_invoices table beside invoices splits money across two " +
    "places, and invoice_payments rows would point at the wrong one.",
);
ok(
  "the existing invoices table is extended instead",
  /alter table public\.invoices[\s\S]{0,900}add column if not exists doc jsonb/.test(sql),
);
for (const col of ["doc", "invoice_no", "subtotal", "deposit_applied", "amount_due"]) {
  ok(`invoices gains ${col}`, new RegExp("add column if not exists " + col + "\\b").test(sql));
}

console.log("\nThe document is stored whole, in the shape the generator already speaks");
ok(
  "the generator has a snapshot function to store",
  /function invSnapshot\(\)/.test(invoiceJs),
);
ok(
  "and a restore function to read it back",
  /function invApplySnapshot\(/.test(invoiceJs),
  "Reopening a saved invoice must reuse the function the local history " +
    "already uses, not new rendering code that drifts from the live form.",
);
ok(
  "the snapshot carries the per-field lock flags",
  /locked: \{ \.\.\.invLocked \}/.test(invoiceJs),
  "Without them, reopening an invoice recalculates from items and " +
    "percentages and silently rewrites a total a guest already agreed to.",
);
ok(
  "the schema comment names the function that actually exists",
  /invApplySnapshot/.test(sql) && !/invRestore/.test(sql),
  "A comment naming a function nobody wrote costs the next person an hour.",
);
ok(
  "the schema comment says the document is the authority",
  /comment on column public\.invoices\.doc is[\s\S]{0,400}if they ever disagree/i.test(sql),
);

console.log("\nNumbering is allocated by the database");
const numFn = sql.slice(
  sql.indexOf("create or replace function public.next_invoice_no"),
  sql.indexOf("grant execute on function public.next_invoice_no"),
);
ok("next_invoice_no exists", numFn.length > 100);
ok(
  "it does NOT use FOR UPDATE beside an aggregate",
  !/for update/i.test(stripSqlComments(numFn)),
  "Postgres refuses that combination at RUN time, not at CREATE time, so the " +
    "definition looks healthy until the first invoice anyone saves. This was " +
    "caught on a throwaway Postgres 16 before it reached a real database.",
);
ok(
  "it takes a lock, so two staff saving at once cannot both take the same number",
  /pg_advisory_xact_lock/.test(numFn),
);
ok("numbers are unique where set", /idx_invoices_invoice_no[\s\S]{0,120}where invoice_no is not null/.test(sql));
ok("the year is Jakarta's, not the server's", /Asia\/Jakarta/.test(numFn));

console.log("\nkind is constrained");
ok(
  "only deposit, settlement and general are accepted",
  /invoices_kind_check check \(kind in \('deposit', 'settlement', 'general'\)\)/.test(sql),
  'Without this a typo ("settlment") creates a row every screen filters out ' +
    "and nobody can find again.",
);

console.log("\nPaid is derived, never stored");
ok("invoice_balances exists", /create view public\.invoice_balances as/.test(sql));
ok(
  "status keeps its three values and never gains 'paid'",
  /invoices_status_check check \(status in \('draft','issued','void'\)\)/.test(sql),
  "A stored paid flag is a second truth that drifts the moment somebody " +
    "corrects a payment row, exactly like the deposit status column this " +
    "schema deliberately does not have.",
);
ok(
  "the confirm block checks no payment status column crept in",
  /no stored payment status on invoices/.test(sql),
);

console.log("\nMoney is counted once, and never hidden");
const money = sql.slice(
  sql.indexOf("create view public.reservation_money as"),
  sql.indexOf("comment on view public.reservation_money"),
);
ok("reservation_money exists", money.length > 200);
ok(
  "it adds reservation-attached and invoice-attached payments",
  /p\.reservation_id = r\.id/.test(money) && /i\.id = p\.invoice_id/.test(money),
  "invoice_payments attaches to one parent or the other, never both. A " +
    "screen adding them by hand is how one gets forgotten or counted twice.",
);
ok(
  "voiding an invoice does NOT remove its payments from the total",
  !/paid_total[\s\S]{0,40}status <> 'void'/.test(money) &&
    !/status <> 'void'\), 0\)\s*as paid_on_invoices/.test(money),
  "The rehearsal showed what excluding them does: void a part-paid invoice " +
    "and the booking reports 3.000.000 paid when 13.000.000 had arrived. " +
    "Voiding is a billing decision and moves no money, the same as cancelling " +
    "a paid booking.",
);
ok(
  "money against a voided invoice is surfaced separately",
  /paid_on_void_invoices/.test(money),
  "It almost always means a refund is owed, so it must be visible rather " +
    "than buried in a total.",
);
ok(
  "settlement_total counts only an ISSUED settlement invoice",
  /kind = 'settlement'[\s\S]{0,80}status = 'issued'/.test(money),
  "That figure is what the guest actually spent. A deposit is money " +
    "received, not revenue, and a voided invoice is not a bill.",
);

console.log("\nThe deposit flow is untouched");
ok(
  "reservation_deposit_balances still exists",
  /create view public\.reservation_deposit_balances as/.test(sql),
);
ok(
  "deposit payments still attach to the reservation, not to an invoice",
  /insert into invoice_payments\s*\n\s*\(reservation_id, amount/.test(sql),
  "The deposit flow issues no invoice on purpose. Changing that would " +
    "invalidate every deposit link already sent.",
);

console.log("\nThe confirm block covers the new objects");
for (const row of [
  "invoices.doc (the stored document)",
  "invoices billing columns",
  "kind is constrained to the three we handle",
  "invoice numbers are unique",
  "numbering does not use FOR UPDATE with an aggregate",
  "invoice_balances exists",
  "reservation_money exists",
  "voiding an invoice does not hide money received",
]) {
  ok(`confirm row: ${row}`, sql.includes(row));
}
ok(
  "the expect line was updated alongside them",
  /then the saved-invoice rows/.test(sql),
  "A confirm block whose expected values are stale is worse than none: it " +
    "trains whoever runs it to ignore the mismatch.",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
