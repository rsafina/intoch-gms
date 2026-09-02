// Reservation export to Excel: the row builder, the date builder, and the
// wiring that decides WHICH reservations end up in the file.
//
// Run under TZ=Asia/Jakarta (run-tests.js forces it). The date assertions
// only fail in a UTC+ zone, which is exactly where the client runs.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
// Normalise endings on read: a checkout with core.autocrlf=true is CRLF and
// every source slice below would silently stop matching. See CLAUDE.md.
const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};

// Lift the pure helpers out of the real file by name, so a rename fails
// this test rather than letting it pass against a stale copy.
function lift(name) {
  const m = src.match(new RegExp("^(?:async )?function " + name + "\\([\\s\\S]*?^}", "m"));
  if (!m) throw new Error("could not slice " + name + " out of app.js");
  return m[0];
}

const ctx = {
  console,
  // A vm context gets its OWN Date constructor, so a Date built inside it
  // fails `instanceof Date` out here and inside resExportRowAsText. Hand it
  // the host one so both realms agree.
  Date,
  guestDisplayName: (g) => (g && g.name ? String(g.name).replace(/^Ibu /, "") : "Unknown Guest"),
  ymd: (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
};
vm.createContext(ctx);
vm.runInContext([lift("resExportDateTime"), lift("resExportRow"), lift("resExportRowAsText")].join("\n"), ctx);
const { resExportDateTime, resExportRow, resExportRowAsText } = ctx;

console.log("\nDate Time is a real local datetime, never a UTC-shifted one");

check("date and time combine into the right local instant", () => {
  const d = resExportDateTime("2026-09-01", "19:30");
  assert.ok(d instanceof Date, "not a Date");
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 8); // September
  assert.strictEqual(d.getDate(), 1);
  assert.strictEqual(d.getHours(), 19);
  assert.strictEqual(d.getMinutes(), 30);
});

check("the date does NOT slip to the previous day", () => {
  // new Date("2026-09-01") parses as UTC and is 31 Aug 17:00 at UTC-7 /
  // still 1 Sep at UTC+7 but midnight-fragile. Building from parts is the
  // whole point. This is the ymd() trap from CLAUDE.md.
  const d = resExportDateTime("2026-09-01", "00:00");
  assert.strictEqual(d.getDate(), 1, "midnight booking slipped a day");
  assert.strictEqual(d.getMonth(), 8);
});

check("a missing time is midnight, not an Invalid Date", () => {
  const d = resExportDateTime("2026-09-01", null);
  assert.ok(!Number.isNaN(d.getTime()), "Invalid Date");
  assert.strictEqual(d.getHours(), 0);
});

check("seconds on the time are tolerated", () => {
  const d = resExportDateTime("2026-09-01", "19:30:00");
  assert.strictEqual(d.getHours(), 19);
  assert.strictEqual(d.getMinutes(), 30);
});

check("a missing or malformed date exports blank, not Invalid Date", () => {
  assert.strictEqual(resExportDateTime("", "19:30"), "");
  assert.strictEqual(resExportDateTime(null, "19:30"), "");
  assert.strictEqual(resExportDateTime("not-a-date", "19:30"), "");
});

console.log("\nThe row is the five agreed columns, in order");

check("a full row maps to Name, Phone, Date Time, Notes, Status", () => {
  const row = resExportRow({
    reservation_date: "2026-09-01",
    reservation_time: "19:30",
    notes: "Window seat",
    status: "Reserved",
    guests: { name: "Ibu Alia", phone: "081234567890" },
  });
  assert.strictEqual(row.length, 5);
  assert.strictEqual(row[0], "Alia");
  assert.strictEqual(row[1], "081234567890");
  assert.ok(row[2] instanceof Date);
  assert.strictEqual(row[3], "Window seat");
  assert.strictEqual(row[4], "Reserved");
});

check("a reservation with no linked guest still exports a row", () => {
  const row = resExportRow({ reservation_date: "2026-09-01", reservation_time: "19:30", status: "Reserved" });
  assert.strictEqual(row[0], "");
  assert.strictEqual(row[1], "");
  assert.strictEqual(row[3], "", "null notes must be blank, not the string null");
});

check("the dashboard fallback date is used when the row has none", () => {
  // The dashboard query filters on reservation_date and never selects it,
  // so without the fallback every dashboard export has a blank Date Time.
  const row = resExportRow({ reservation_time: "19:30", status: "Reserved" }, "2026-09-03");
  assert.ok(row[2] instanceof Date);
  assert.strictEqual(row[2].getDate(), 3);
});

check("a row's own date beats the fallback", () => {
  const row = resExportRow({ reservation_date: "2026-09-01", reservation_time: "19:30" }, "2026-09-03");
  assert.strictEqual(row[2].getDate(), 1);
});

console.log("\nThe CSV fallback flattens the Date instead of writing [object Object]");

check("a Date becomes a sortable yyyy-mm-dd hh:mm string", () => {
  const out = resExportRowAsText(resExportRow({
    reservation_date: "2026-09-01",
    reservation_time: "09:05",
    status: "Reserved",
    guests: { name: "Alia", phone: "0812" },
  }));
  assert.strictEqual(out[2], "2026-09-01 09:05", "got " + out[2]);
  assert.ok(!String(out[2]).includes("object"), "Date leaked into the CSV");
});

check("a blank Date Time survives the flattening", () => {
  assert.strictEqual(resExportRowAsText(["a", "b", "", "d", "e"])[2], "");
});

console.log("\nWhat gets exported is what is on screen");

check("the list export follows an active search, and says so in the name", () => {
  const body = src.slice(src.indexOf("function exportReservations()"), src.indexOf("function exportReservations()") + 900);
  assert.ok(body.includes("allReservations.map"), "not exporting allReservations");
  assert.ok(body.includes("resSearchActive"), "does not follow the search");
  assert.ok(body.includes("resSelectedDate"), "filename ignores the viewed day");
});

check("the dashboard export takes the whole day, not the visible page", () => {
  const i = src.indexOf("function exportDashboardReservations()");
  assert.ok(i > -1, "exportDashboardReservations missing");
  // Slice to the function's own closing brace: 500 characters runs on into
  // dashResNextPage, which legitimately mentions dashboardResPage, and the
  // page-leak assertion below would then never be able to fail.
  const body = src.slice(i).match(/^function exportDashboardReservations\([\s\S]*?^}/m)[0];
  assert.ok(body.includes("dashboardResData"), "not exporting the day's data");
  assert.ok(!body.includes("dashboardResPage"), "exporting only the visible page");
  assert.ok(body.includes("getDashboardDate(dashboardReservationOffset)"), "wrong day for the selected tab");
});

check("both buttons exist and are wired to the right function", () => {
  // The label matters as much as the wiring: a button that still says
  // "Export CSV" while handing back an .xlsx is a support call. This caught
  // a real half-applied edit on 2026-09-01.
  for (const fn of ["exportReservations", "exportDashboardReservations"]) {
    const i = html.indexOf(`onclick="${fn}()"`);
    assert.ok(i > -1, fn + " button missing");
    const btn = html.slice(i, html.indexOf("</button>", i));
    assert.ok(btn.includes("Export Excel"), fn + " button is not labelled Export Excel");
  }
  assert.ok(!/Export CSV[\s\S]{0,200}exportReservations\(\)/.test(html), "a stale Export CSV label still points at the reservation export");
});

console.log("\nThe writer degrades instead of doing nothing");

check("an empty list is refused before SheetJS is fetched", () => {
  const i = src.indexOf("async function downloadReservationSheet");
  const body = src.slice(i, i + 400);
  assert.ok(body.indexOf("if (!rows.length)") < body.indexOf("loadSheetJs"), "loads the CDN before checking for rows");
});

check("a CDN failure falls back to CSV rather than failing silently", () => {
  const i = src.indexOf("async function downloadReservationSheet");
  const body = src.slice(i, i + 1200);
  assert.ok(body.includes("catch"), "no catch around loadSheetJs");
  assert.ok(body.includes("downloadCsv("), "no CSV fallback");
  assert.ok(body.includes("resExportRowAsText"), "fallback would write [object Object]");
});

check("the header row is the agreed five and nothing else", () => {
  const m = src.match(/const RES_EXPORT_HEADERS = \[([^\]]*)\]/);
  assert.ok(m, "RES_EXPORT_HEADERS missing");
  const cols = m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert.deepStrictEqual(cols, ["Name", "Phone Number", "Date Time", "Notes", "Status"]);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
