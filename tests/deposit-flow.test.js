// The deposit flow: Incoming, expiry, and the three staff actions.
//
// WHY THIS EXISTS
// Spec: DEPOSIT_FLOW_SPEC.md. Almost every failure mode here is SILENT — the
// screen looks fine and the wrong thing happens to a table or to money:
//
//   - Incoming left out of the held-seat lists  -> the room is oversold while
//     the first guest is still transferring
//   - Waitlist put INTO them                    -> a queue of unpaid requests
//     blocks the real bookings behind it
//   - the two status constraints disagreeing    -> a re-run over a database
//     holding Incoming rows aborts partway
//   - the sweep expiring a part-paid booking    -> somebody who sent money
//     loses their table
//   - status and payment written separately     -> paid-but-still-Incoming
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(ROOT, "migrations", "ALL_IN_ONE.sql"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}
// The booking function is defined more than once. Anchor to the LAST one and
// bound it at its own terminator, or the confirm block gets swept in.
function fnBody(name) {
  // Anchor on the DEFINITION, not the last mention: `grant execute on function
  // public.<name>` appears AFTER it, so lastIndexOf("function public.<name>")
  // finds the grant and slices from the wrong place. Every assertion below then
  // fails against an empty string, which looks like a code bug and is not.
  const start = sql.toLowerCase().lastIndexOf(`create or replace function public.${name}`);
  if (start === -1) return "";
  const end = sql.indexOf("$function$;", start);
  return sql.slice(start, end === -1 ? undefined : end);
}
const booking = fnBody("create_public_reservation");
const avail = fnBody("area_availability");

console.log("\nIncoming exists in BOTH status constraints");
// ALL_IN_ONE re-asserts this ~3700 lines before the deposit section. If the two
// disagree, a re-run over a database holding Incoming rows is violated by its
// own existing rows and aborts. This has already happened once, with Waitlist.
// Scoped to the RESERVATIONS status list. Other tables have their own status
// CHECKs (visits: Active/Done, invoices: draft/issued/void) which legitimately
// know nothing about Incoming; an unscoped match flags those as failures.
const constraints = [...sql.matchAll(/CHECK \(status IN \(([^)]*)\)/gi)]
  .filter((c) => c[1].includes("'Reserved'"));
ok("at least three definitions exist", constraints.length >= 3,
   "One on CREATE TABLE and two ALTERs. All three must agree.");
ok("every one of them allows Incoming",
   constraints.every((c) => c[1].includes("Incoming")),
   `${constraints.filter((c) => !c[1].includes("Incoming")).length} definition(s) missing it.`);

console.log("\nIncoming holds a seat, Waitlist does not");
for (const [label, body] of [["the booking gate", booking], ["area_availability", avail]]) {
  ok(`${label} counts Incoming as held`, /'Reserved','Confirmed','Incoming','Arrived'/.test(body));
  ok(`${label} does not count Waitlist`, !/status in \([^)]*Waitlist/i.test(body));
}

console.log("\nThe deadline is the booking itself");
ok("due date is built from the reservation date and time",
   /v_due_at\s*:=\s*\(p_date \+ p_time\)/.test(booking));
ok("no grace-period setting crept back in", !/deposit_grace_hours/.test(sql),
   "Deleted by decision: it needed a setting, a min() and a special case to say " +
   "something less obvious than 'pay before you eat'.");
ok("Waitlist beats Incoming", /if v_status = 'Reserved' and v_dep_req then/.test(booking),
   "A booking nobody has agreed to must not start a deposit clock.");
ok("the deadline is stored on the row", /deposit_due_at\)/.test(booking) && /v_due_at\)/.test(booking));

console.log("\nRecording a payment and locking the booking are one transaction");
const rec = fnBody("record_deposit_payment");
ok("it exists", rec.length > 0);
ok("clearing the balance sets Reserved", /v_paid >= v_expected[\s\S]{0,200}status = 'Reserved'/.test(rec));
ok("a partial payment does NOT lock it", /'locked', false/.test(rec));
ok("a partial payment does not touch the deadline", !/deposit_due_at\s*=/.test(rec),
   "Otherwise a guest holds a table forever by sending Rp 1.000 a day.");
ok("a zero payment is refused", /p_amount = 0/.test(rec));

console.log("\nWaiving needs a reason, and keeps the money that arrived");
const waive = fnBody("waive_deposit");
ok("it exists", waive.length > 0);
ok("an empty reason is refused", /reason_required/.test(waive));
ok("it records who, when and why", /Waived by %s on %s: %s/.test(waive));
ok("it clears the deadline so the sweep ignores it", /deposit_due_at\s*=\s*null/.test(waive));
ok("it never deletes payment rows", !/delete from invoice_payments/i.test(waive),
   "Money that arrived is a fact; a waiver only changes what is still owed.");

console.log("\nThe sweep is careful about who it cancels");
const sweep = fnBody("expire_unpaid_deposits");
ok("it exists", sweep.length > 0);
ok("it only touches Incoming", /r\.status = 'Incoming'/.test(sweep));
ok("it never expires a booking with any payment",
   /not exists \(\s*\n?\s*select 1 from invoice_payments/.test(sweep),
   "Someone who has sent money is a conversation, not a cleanup job.");
ok("it records that the SYSTEM cancelled it", /deposit_expired_at = now\(\)/.test(sweep),
   "Otherwise an expiry is indistinguishable from a staff cancellation.");
ok("it voids the invoice so the payment link goes dead", /set status = 'void'/.test(sweep));

console.log("\nThe public invoice link exposes one invoice and nothing else");
const byToken = fnBody("deposit_invoice_by_token");
ok("it is SECURITY DEFINER", /security definer/i.test(byToken));
ok("it looks up by token, not by reservation id", /where i\.token = p_token/.test(byToken));
ok("a voided invoice returns nothing", /i\.status = 'issued'/.test(byToken));
ok("it returns no phone number or guest row", !/phone/i.test(byToken) && !/from guests/i.test(byToken));
ok("the token defaults to random bytes, not an id",
   /token\s+text not null unique default encode\(gen_random_bytes/.test(sql));

console.log("\nThe scheduler is optional, not assumed");
// A bare reference to cron.job fails to PLAN when pg_cron is absent, so the
// `where exists` guard never runs. Dynamic SQL defers the lookup to runtime.
ok("job counting goes through the dynamic helper", /function public\.cron_job_count/.test(sql));
// The only permitted mention is inside the helper's dynamic SQL string, which
// Postgres does not resolve until the statement actually runs. Strip quoted
// strings and comments first, then nothing should be left.
{
  const live = sql
    .replace(/execute\s+'[^']*'/gi, "")   // dynamic SQL
    .replace(/--[^\n]*/g, "");            // comments
  // The invariant is specifically about SELECTING FROM it, which is what fails
  // to plan. `to_regclass('cron.job')` is a string evaluated at runtime and
  // returns null when the extension is absent, which is the safe idiom.
  ok("nothing selects FROM cron.job outside dynamic SQL", !/from\s+cron\.job/i.test(live),
     (live.match(/.{0,60}from\s+cron\.job.{0,30}/i) || [""])[0].trim());
}
ok("scheduling is wrapped in an extension check",
   /if exists \(select 1 from pg_extension where extname = 'pg_cron'\)/.test(sql));
ok("the app-side fallback is granted too",
   /grant execute on function public\.expire_unpaid_deposits\(\) to anon/.test(sql));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
