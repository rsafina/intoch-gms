// The public booking form after the waitlist change (2026-09-05).
//
// WHY THIS EXISTS
// The migration made `create_public_reservation` return `ok: true` for a
// booking that is NOT confirmed. Every failure mode below is silent: the form
// looks like it worked and the guest is misled rather than shown an error.
//
//   - a waitlisted booking reported as "Reservation Created"
//   - a guest asked for a deposit on a booking nobody has accepted
//   - a new refusal code with no Indonesian copy, which the page maps to
//     "connection problem, try again" so the guest retries forever
//   - the form reading `reservations` to render an availability percentage,
//     which is a public page reading every guest's booking
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const form = fs.readFileSync(path.join(ROOT, "reserve.template.html"), "utf8");
const created = fs.readFileSync(path.join(ROOT, "reservation-created.template.html"), "utf8");
const sql = fs.readFileSync(path.join(ROOT, "migrations", "ALL_IN_ONE.sql"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// The function is defined more than once in ALL_IN_ONE.sql. Anchor to the LAST
// one and bound it at its own terminator, or the confirm block gets swept in.
const fnStart = sql.toLowerCase().lastIndexOf("create or replace function public.create_public_reservation");
const fnEnd = sql.indexOf("$function$;", fnStart);
const fn = sql.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

console.log("\nEvery code the booking function can return has guest copy");
const codes = [...fn.matchAll(/'code',\s*'([a-z_]+)'/g)].map((m) => m[1]);
ok("the function returns at least one refusal code", codes.length > 0);
for (const c of [...new Set(codes)]) {
  ok(`"${c}" has an ERR_ID entry`, new RegExp(`\\b${c}\\s*:`).test(form),
     `Without it the page falls through to ERR_ID.network, "connection problem, ` +
     `try again", and the guest retries against a refusal that never changes.`);
}

console.log("\nA large party is no longer refused by the form itself");
// max_pax became the size above which a human decides. A client-side clamp
// would silently prevent the very bookings the waitlist exists to catch.
ok("no hardcoded clamp to 20 survives", !/Math\.min\(20,/.test(form));
ok("the pax input is not capped at 20", !/id="pax-value"[\s\S]{0,200}max="20"/.test(form));
ok("max_pax is read from settings", /MAX_PAX\s*=\s*Math\.max\(1,\s*\+data\.value\.max_pax\)/.test(form));
ok("a big party is warned BEFORE submitting", /function renderPaxNote/.test(form) &&
   form.includes("masuk sebagai permintaan"));

console.log("\nThe area picker keeps the inherited fallback");
ok("no bookable area means no picker at all",
   /if \(!AREAS\.length\)[\s\S]{0,120}display = "none"/.test(form));
ok("area is mandatory only once one exists",
   /if \(AREAS\.length && !AREA_ID\)/.test(form));
ok("the area and company reach the RPC",
   /p_area_id:\s*AREA_ID/.test(form) && /p_company:\s*company \|\| null/.test(form));

console.log("\nAvailability never reads the reservations table");
// A public page must not select every guest's booking to draw a percentage.
ok("availability comes from the RPC", /db\.rpc\("area_availability"/.test(form));
ok("the form never selects from reservations", !/from\("reservations"\)/.test(form));
ok("the RPC is SECURITY DEFINER and returns no guest data", (() => {
  const i = sql.indexOf("create or replace function public.area_availability");
  const body = sql.slice(i, sql.indexOf("$function$;", i));
  return /security definer/i.test(body) && !/guests/i.test(body);
})());

console.log("\nA waitlisted booking is not dressed up as a confirmation");
ok("the form passes the waitlist flag on", /waitlisted:\s*data\.waitlisted === true/.test(created) ||
   /waitlisted:\s*data\.waitlisted === true/.test(fs.readFileSync(path.join(ROOT, "reserve.template.html"), "utf8")));
ok("the confirmation page branches on it", /if \(r\.waitlisted\)/.test(created));
ok("the title is rewritten, not just a note added", /created-title[\s\S]{0,120}Permintaan Terkirim/.test(created));
ok("it says plainly that this is not confirmed", created.includes("belum menjadi reservasi yang terkonfirmasi"));
ok("each waitlist reason has its own wording",
   ["over_capacity", "below_min_pax", "over_max_pax"].every((r) => created.includes(r)));

console.log("\nNobody is asked for money for a booking that was not accepted");
ok("the deposit block is an ELSE of the waitlist branch",
   /if \(r\.waitlisted\)[\s\S]{0,1400}\} else if \(r\.deposit_required/.test(created));
ok("the function reports no deposit due on a waitlisted booking",
   /'deposit_required',\s*\(v_dep_req and v_status <> 'Waitlist'\)/.test(fn));
ok("and stores the same thing it reported",
   /\(v_dep_req and v_status <> 'Waitlist'\), v_dep_amt/.test(fn));

console.log("\nWaitlist holds no seat");
// If it ever counts, a run of requests silently blocks the real bookings behind
// them and the area reports itself full when it is not.
ok("the date-full check counts only held statuses",
   /status in \('Reserved','Confirmed','Arrived'\)/.test(fn));
ok("Waitlist is not in that list", !/status in \([^)]*Waitlist/.test(fn));
ok("the availability function excludes it too", (() => {
  const i = sql.indexOf("create or replace function public.area_availability");
  const body = sql.slice(i, sql.indexOf("$function$;", i));
  return /'Reserved','Confirmed','Arrived'/.test(body) && !/Waitlist/.test(body);
})());

console.log("\nThe status constraint agrees with itself");
// ALL_IN_ONE re-asserts this constraint 3700 lines before the waitlist section.
// If the two disagree, a re-run over a database holding waitlisted rows aborts.
const constraints = [...sql.matchAll(/ADD CONSTRAINT reservations_status_check\s*\n?\s*CHECK \(status IN \(([^)]*)\)/gi)];
ok("every definition of the status constraint includes Waitlist",
   constraints.length > 0 && constraints.every((c) => c[1].includes("Waitlist")),
   `${constraints.length} definition(s) found; one without 'Waitlist' aborts a re-run.`);

console.log("\nStaff can actually see a waitlisted booking");
// A booking nobody sees is worse than a refusal: the guest is waiting for an
// answer that will never come.
const cfg = fs.readFileSync(path.join(ROOT, "js", "config.template.js"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
// statusBadge() falls back to Reserved for an unknown status, so without its
// own entry a waitlisted booking is visually a confirmed one.
ok("Waitlist has its own badge colour", /Waitlist:\s*\{\s*bg:/.test(cfg));
ok("and does not fall through to the Reserved styling",
   /const c = STATUS_COLORS\[status\] \|\| STATUS_COLORS\["Reserved"\]/.test(cfg) &&
   /Waitlist:\s*\{/.test(cfg));
ok("Confirmed has one too", /Confirmed:\s*\{\s*bg:/.test(cfg));
ok("Waitlist has an Indonesian label", /Waitlist:\s*"Daftar Tunggu"/.test(cfg));
for (const reason of ["over_capacity", "below_min_pax", "over_max_pax"]) {
  ok(`the reason "${reason}" reads as words, not a code`,
     new RegExp(`${reason}:\\s*"`).test(cfg));
}
ok("the row shows why it is waiting", /r\.status === "Waitlist"/.test(app) &&
   /waitlist_reason/.test(app));
ok("there is a Waitlist filter chip", /filterResByStatus\('Waitlist'\)/.test(html));
// "All" only excludes Deleted, so Waitlist is included there by construction.
ok("the All filter still only excludes Deleted",
   /resStatusFilter === "all"[\s\S]{0,400}neq\("status", "Deleted"\)/.test(app));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
