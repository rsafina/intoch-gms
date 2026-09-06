// Phase 3 of the deposit flow: what staff can and cannot do to a booking that
// owes money. See DEPOSIT_FLOW_SPEC.md.
//
// These assert RULES, not spellings. Three times in this project a test was
// written against the exact text of a line, passed happily while the rule it
// was meant to protect was broken elsewhere, and had to be rewritten. Where a
// check here does look at source text it looks for the SHAPE of the mistake
// (a write with no .select(), a status list missing a value) rather than for
// one particular way of writing it right.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");

const app = read("js/app.js");
const wa = read("js/wa.js");
const notify = read("js/notify.js");
const html = read("index.html");
const sql = read("migrations/ALL_IN_ONE.sql");
const cfgTpl = read("js/config.template.js");
const cfgOut = read("js/config.js");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// The deposit module, sliced out so a match somewhere else in a 15k-line file
// cannot make one of these pass by accident.
const modStart = app.indexOf("// DEPOSITS: chasing, recording, waiving");
const modEnd = app.indexOf("async function cancelReservation", modStart);
const mod = modStart >= 0 && modEnd > modStart ? app.slice(modStart, modEnd) : "";

console.log("\nThe module is where the rest of these tests think it is");
ok("the deposit module exists in js/app.js", mod.length > 1000);

// ── An Incoming booking holds its table ───────────────────────────────────
console.log("\nAn Incoming booking holds its table");
const holds = /const RES_HOLDS_SEAT_STATUSES = \[([^\]]*)\]/.exec(app);
const holdList = holds
  ? holds[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
  : [];
ok(
  "RES_HOLDS_SEAT_STATUSES contains Incoming",
  holdList.includes("Incoming"),
  "Without it the capacity cards and the VIP conflict check treat a table " +
    "somebody is paying for as free, and the app sells it twice.",
);
ok(
  "RES_HOLDS_SEAT_STATUSES does NOT contain Waitlist",
  !holdList.includes("Waitlist"),
  "A waitlisted party has not been agreed to. Holding a seat for them blocks " +
    "the bookings behind them.",
);

// The same list is spelled out inline in two SQL places. All three must agree
// or the room is oversold in exactly the one nobody is looking at.
// A `status in (...)` list mentioning Incoming is either a seat-holding check
// or the CHECK constraint that enumerates every status there is. Told apart by
// a rule rather than by position in the file: a list of statuses that hold a
// seat can never contain a cancelled or deleted booking.
const sqlStatusLists = [...sql.matchAll(/status in \(([^)]*'Incoming'[^)]*)\)/g)]
  .map((m) => m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")))
  .filter((list) => !list.some((s) => /^(Cancelled|Deleted)/.test(s)));
ok(
  "the SQL spells out a seat-holding list including Incoming at least twice",
  sqlStatusLists.length >= 2,
  "Expected date_full inside create_public_reservation and area_availability() " +
    "to both include Incoming. Found " + sqlStatusLists.length + ".",
);
sqlStatusLists.forEach((list, i) => {
  ok(
    `SQL seat-holding list ${i + 1} agrees with the JavaScript one`,
    holdList.every((s) => list.includes(s)) && list.every((s) => holdList.includes(s)),
    `SQL has [${list.join(", ")}], JS has [${holdList.join(", ")}].`,
  );
});

// ── Incoming is visible and cannot be mistaken for Reserved ───────────────
console.log("\nIncoming is visible and cannot be mistaken for Reserved");
for (const [label, cfg] of [["config.template.js", cfgTpl], ["config.js", cfgOut]]) {
  const colors = /const STATUS_COLORS = \{([\s\S]*?)\n\};/.exec(cfg);
  const body = colors ? colors[1] : "";
  const entry = /\n\s*Incoming:\s*\{([^}]*)\}/.exec(body);
  const reserved = /\n\s*Reserved:\s*\{([^}]*)\}/.exec(body);
  ok(`${label} gives Incoming its own status colour`, !!entry,
     "statusBadge() falls back to Reserved, so a missing entry makes an " +
     "unpaid booking look like a secure one.");
  ok(`${label} does not colour Incoming the same as Reserved`,
     !!entry && !!reserved && entry[1].trim() !== reserved[1].trim());
  ok(`${label} has an Indonesian label for Incoming`, /\n\s*Incoming:\s*"/.test(cfg));
}
ok(
  "the reservations list has an Incoming filter chip",
  /data-status="Incoming"/.test(html) && /filterResByStatus\('Incoming'\)/.test(html),
);
ok(
  "the reservations row renders the deposit badge next to the status badge",
  /statusBadge\(r\.status\) \+\s*\n\s*depositRowBadge\(r\)/.test(app),
);
ok(
  "Incoming rows are sorted above ordinary reservations",
  /Incoming:\s*0/.test(app) && /resStatusSortRank\(a\.status\)/.test(app),
  "The deposit queue should not sit below later ordinary bookings.",
);
ok(
  "the dashboard query carries deposit fields",
  /loadDashboardReservations[\s\S]{0,1200}deposit_required, deposit_expected, deposit_due_at/.test(app),
  "Without these, the dashboard cannot show the deposit badge or invoice follow-up action.",
);
ok(
  "the dashboard renders the deposit badge beside status",
  /statusBadge\(r\.status\)\}\$\{depositRowBadge\(r\)\}/.test(app),
);
ok(
  "Incoming deposit rows expose invoice follow-up beside Update",
  /res\.status === "Incoming"[\s\S]{0,180}openDepositInvoice\('\$\{res\.id\}'\)[\s\S]{0,120}Invoice Followup/.test(wa),
  "Staff should not have to open Update Reservation just to chase a deposit.",
);
ok(
  "Reserved rows keep the ordinary WA follow-up",
  /res\.status === "Reserved"[\s\S]{0,120}waSendFollowUpReservation\('\$\{res\.id\}'\)[\s\S]{0,120}WA Follow Up/.test(wa),
);

// ── The one blocked transition ────────────────────────────────────────────
console.log("\nAn Incoming booking cannot be set to Reserved by hand");
const grid = app.slice(app.indexOf("const STATUSES = ["), app.indexOf("Assign Table"));
ok(
  "the status grid refuses Reserved while the booking is Incoming",
  /s === "Reserved" && res\.status === "Incoming"/.test(grid) &&
    /explainIncomingLock\(\)/.test(grid),
  "Otherwise a click locks a table with neither money against it nor a " +
    "reason, and nobody can later tell that from a real payment.",
);
ok(
  "Cancelled is still reachable from Incoming",
  /"Cancelled"/.test(grid) && !/s === "Cancelled" && res\.status === "Incoming"/.test(grid),
  "A guest backing out before paying is the most ordinary thing that happens " +
    "to an Incoming booking. It must not need a payment first.",
);
ok("explainIncomingLock exists and names both legitimate doors",
   /function explainIncomingLock/.test(app) &&
   /waive/i.test(app.slice(app.indexOf("function explainIncomingLock"), app.indexOf("function explainIncomingLock") + 400)));

console.log("\nIncoming deposit bookings are in the bell");
ok(
  "notify.js fetches Incoming online reservations",
  /\.in\("status", \["Reserved", "Confirmed", "Incoming", "Arrived", "Completed"\]\)/.test(notify),
);
ok(
  "notify.js classifies deposit Incoming separately from arrival reminders",
  /return "deposit"/.test(notify) && /Perlu invoice DP/.test(notify),
);
ok(
  "the bell gives deposit rows the same invoice action",
  /openDepositInvoice\('\$\{it\.id\}'\)[\s\S]{0,120}Invoice Followup/.test(notify),
);

// ── Issuing an invoice ────────────────────────────────────────────────────
console.log("\nIssuing an invoice");
const openInv = mod.slice(mod.indexOf("async function openDepositInvoice"), mod.indexOf("async function submitDepositInvoice"));
const subInv = mod.slice(mod.indexOf("async function submitDepositInvoice"), mod.indexOf("async function openRecordDepositPayment"));
ok("openDepositInvoice is manager-gated", /isManagerOrAdmin\(\)/.test(openInv));
ok(
  "submitDepositInvoice re-checks the manager gate",
  /isManagerOrAdmin\(\)/.test(subInv),
  "The opener's check only hides a button. This function is reachable from " +
    "the console, and a hidden button is not an access control.",
);
ok(
  "it refuses when neither bank details nor a QRIS image is configured",
  /bank_details/.test(openInv) && /qris_url/.test(openInv) && /!hasBank && !hasQris/.test(openInv),
  "Sending a guest a payment page with nothing to pay into wastes the one " +
    "message they will actually open.",
);
ok(
  "it refuses a booking with no deposit",
  /deposit_required/.test(openInv) && /deposit_expected/.test(openInv),
);
ok(
  "it refuses a guest with no phone number",
  /phone/.test(openInv),
  "The invoice link only ever reaches the guest through WhatsApp.",
);
ok(
  "the preview link is built from the page's own URL, not a configured base",
  /new URL\("deposit-invoice\.html/.test(mod) && !/SITE_URL/.test(mod),
  "A wrong configured base produces a link that 404s in a guest's phone and " +
    "nowhere that anyone here would see it.",
);
ok(
  "the invoice token is what identifies the link, never the reservation id",
  /token/.test(subInv) && !/deposit-invoice\.html\?t=" \+ res(Id|\.id)/.test(mod),
);
ok(
  "sending is recorded on the booking",
  /deposit_asked_at/.test(subInv),
  "Chasing a guest twice because nobody could tell it had been done once is " +
    "the failure this column exists to prevent.",
);
ok(
  "a second invoice for the same amount is reused, not minted again",
  /Number\(i\.total\) === expected/.test(subInv),
  "Two live tokens is two versions of the truth, and the guest opens " +
    "whichever one they happened to scroll to.",
);

// ── The 204 trap ──────────────────────────────────────────────────────────
// PostgREST answers 204 No Content for an UPDATE that matched zero rows,
// byte-identical to a successful one. This cost days of silently failing area
// saves in September 2026. Every write in this module must ask for the row
// back and treat an empty result as failure.
console.log("\nNo write in this module can succeed silently");
const writes = [...mod.matchAll(/\.(update|insert)\(/g)];
ok("the module does write to the database", writes.length > 0);
const writeStatements = mod.split(/\.(?:update|insert)\(/).slice(1);
writeStatements.forEach((tail, i) => {
  ok(
    `write ${i + 1} asks for the row back with .select()`,
    /\.select\(/.test(tail.slice(0, 600)),
    "A write with no .select() cannot tell 'saved' from 'RLS silently " +
      "matched nothing'. Both are 204.",
  );
});
ok(
  "the invoice insert refuses to claim success on an empty result",
  /!ins \|\| !ins\.length/.test(subInv),
);
ok(
  "the cancellation refuses to claim success on an empty result",
  /!upd \|\| !upd\.length/.test(mod.slice(mod.indexOf("submitDepositRefundAck"))),
);

// ── Money and status move together ────────────────────────────────────────
console.log("\nMoney and status move together");
const subPay = mod.slice(mod.indexOf("async function submitDepositPayment"), mod.indexOf("async function openWaiveDeposit"));
ok(
  "recording a payment goes through the RPC, not two client calls",
  /db\.rpc\("record_deposit_payment"/.test(subPay) &&
    !/from\("invoice_payments"\)[\s\S]{0,200}\.insert/.test(subPay),
  "Two calls can half-succeed, and the half that fails leaves a guest who " +
    "has paid holding a table the app is still selling.",
);
ok(
  "a false ok in the RPC payload is treated as a failure",
  /data\.ok !== true/.test(subPay),
  "record_deposit_payment reports its refusals in the payload rather than " +
    "raising, so an unchecked call reads every refusal as success.",
);

// ── Waiving ───────────────────────────────────────────────────────────────
console.log("\nWaiving needs a reason");
const subWaive = mod.slice(mod.indexOf("async function submitWaiveDeposit"), mod.indexOf("async function depositRefundGate"));
ok("the client refuses an empty reason", /if \(!reason\)/.test(subWaive));
ok("the database is still the one that decides", /db\.rpc\("waive_deposit"/.test(subWaive));
ok("a false ok in the payload is treated as a failure", /data\.ok !== true/.test(subWaive));
ok(
  "waive_deposit in SQL also refuses an empty reason",
  /reason_required/.test(sql),
  "The client check is a courtesy. This one is the rule.",
);

// ── Cancelling something that has been paid ───────────────────────────────
console.log("\nCancelling a paid booking asks about the refund");
const gate = mod.slice(mod.indexOf("async function depositRefundGate"), mod.indexOf("async function submitDepositRefundAck"));
ok(
  "cancelReservation consults the gate before its plain confirm()",
  /await depositRefundGate\(resId\)[\s\S]{0,200}confirm\(/.test(app),
  "The other order asks 'cancel this?' first, and a staff member who clicks " +
    "OK has already cancelled a paid booking before being asked anything.",
);
ok(
  "a failed payments lookup stops rather than falling through",
  /if \(error\) \{[\s\S]{0,200}return false/.test(gate),
  "Falling through to the plain confirm when we cannot tell whether money " +
    "arrived is exactly how a paid booking gets cancelled with nobody asked.",
);
ok("only a positive balance triggers the modal", /total <= 0\) return true/.test(gate));
const refundModal = html.slice(html.indexOf('id="modal-deposit-refund"'), html.indexOf('id="modal-deposit-refund"') + 2500);
ok(
  "the refund modal cannot be dismissed by clicking the background",
  html.indexOf('id="modal-deposit-refund"') > 0 &&
    !/modal-deposit-refund"[^>]*\n?[^>]*onclick=/.test(
      html.slice(html.indexOf('id="modal-deposit-refund"') - 200, html.indexOf('id="modal-deposit-refund"') + 200),
    ),
  "Every other modal in the app closes on a background click. This one is " +
    "the question itself, so a stray click must not answer it.",
);
ok(
  "neither refund answer is preselected in the markup",
  !/id="dep-refund-(yes|no)"[^>]*checked/.test(refundModal),
  "An unanswered question that defaults to 'yes, refunded' is worse than no " +
    "question at all.",
);
ok(
  "an unanswered refund question blocks the cancellation",
  /!yes && !no/.test(mod.slice(mod.indexOf("submitDepositRefundAck"))),
);
ok(
  "the answer is written where staff will actually see it",
  /notes/.test(mod.slice(mod.indexOf("submitDepositRefundAck"))),
);

// ── The expiry sweep ──────────────────────────────────────────────────────
console.log("\nThe expiry sweep");
const sweep = mod.slice(mod.indexOf("async function sweepExpiredDeposits"), mod.indexOf("// ── 1."));
ok("the staff app calls expire_unpaid_deposits", /db\.rpc\("expire_unpaid_deposits"\)/.test(sweep));
ok(
  "the once-per-session guard is set before the await",
  sweep.indexOf("depositSweepDone = true") < sweep.indexOf("await supabaseQuery"),
  "Set after, two loads firing together both sweep.",
);
ok("loadReservations triggers it", /await sweepExpiredDeposits\(\)/.test(app));
ok(
  "pg_cron schedules the same function rather than a second implementation",
  /expire_unpaid_deposits/.test(sql) && /cron/.test(sql),
);

// ── Every element the module reads exists in the page ─────────────────────
console.log("\nEvery element the module touches exists in index.html");
const ids = [...new Set([...mod.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]))];
ok("the module reads at least one element", ids.length > 0);
for (const id of ids.sort()) {
  ok(`#${id} exists in index.html`, new RegExp(`id="${id}"`).test(html),
     "A typo here is invisible: getElementById returns null, the optional " +
     "chain swallows it, and the field is simply never read.");
}
const modals = [...new Set([...mod.matchAll(/(?:show|hide)Modal\("([^"]+)"\)/g)].map((m) => m[1]))];
for (const m of modals.sort()) {
  ok(`modal #${m} exists in index.html`, new RegExp(`id="${m}"`).test(html));
}

// ── Every phrase the module shows has an Indonesian translation ───────────
console.log("\nEvery phrase the module shows is translatable");
const keys = [...new Set([...mod.matchAll(/\bt\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]))];
ok("the module puts its text through t()", keys.length > 10);
for (const [label, cfg] of [["config.template.js", cfgTpl], ["config.js", cfgOut]]) {
  // Words the project has decided read the same in both languages. An ID_DICT
  // entry for one of these is actively harmful, not merely redundant: i18n's
  // MutationObserver re-translates on every mutation, so a key that maps to
  // itself rewrites a node with the value it already had, with no fixpoint.
  // Kept in step with SAME_IN_BOTH in tests/run-sheet.test.js.
  const SAME_IN_BOTH = new Set(["Pax", "Area", "Deposit", "DP"]);
  const missing = keys.filter(
    (k) => !SAME_IN_BOTH.has(k) && !cfg.includes(JSON.stringify(k)) && !cfg.includes("\n  " + k + ":"),
  );
  ok(
    `${label} translates every phrase the deposit module shows`,
    missing.length === 0,
    "Missing: " + missing.map((m) => JSON.stringify(m)).join(", "),
  );
}
ok(
  "config.js and config.template.js differ only in the build placeholders",
  (() => {
    const strip = (s) =>
      s.replace(/const SUPABASE_URL = "[^"]*";/, "").replace(/"(__SUPABASE_ANON_KEY__|sb_[^"]*)"/, "");
    return strip(cfgTpl) === strip(cfgOut);
  })(),
  "config.js is a build artefact. An edit to only one of the pair is either " +
    "wiped by the next build or never reaches the browser.",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
