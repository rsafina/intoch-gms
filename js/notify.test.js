// Harness: load notify.js with stubs, freeze "now", exercise classification.
//
// RUN AS:  TZ=Asia/Jakarta node js/notify.test.js
//
// The timezone is not incidental. The bell's D-1 and D-day boundaries are
// computed from the BROWSER's local clock, so these expectations only hold
// in the timezone the front desk actually runs in. Under UTC, five of them
// fail — correctly. That is also the operational warning: a front-desk PC
// set to the wrong timezone will shift the reminder windows by a day.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

if (!/Jakarta/.test(process.env.TZ || "")) {
  console.error(
    "Refusing to run: set TZ=Asia/Jakarta (got " + (process.env.TZ || "unset") + ").",
  );
  process.exit(2);
}

// Was an absolute /tmp scratch path (see the same fix in autorefresh.test.js).
const src = fs.readFileSync(path.join(__dirname, "notify.js"), "utf8");

function makeCtx(nowIso, openTime) {
  const RealDate = Date;
  const fixed = new RealDate(nowIso).getTime();
  class FakeDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(fixed);
      else super(...a);
    }
    static now() {
      return fixed;
    }
  }
  const ctx = {
    Date: FakeDate,
    console,
    document: {
      getElementById: () => null,
      addEventListener: () => {},
    },
    window: {},
    setInterval: () => null,
    db: null,
    APP_SETTINGS: { reservation_hours: { open: openTime } },
    escapeHtml: (s) => s,
    toast: () => {},
    currentStaffId: () => null,
    IS_DEV: true,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

let pass = 0,
  fail = 0;
function eq(label, got, want) {
  if (got === want) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + " → got " + got + ", want " + want);
  }
}

// Real prod rows as of 2026-08-21, all Online Form / Reserved / not followed up
const prod = [
  { id: "danila", date: "2026-08-22", time: "18:00", pax: 2, done: false, d1Ack: false, ddayAck: false },
  { id: "yoshia", date: "2026-08-23", time: "19:00", pax: 2, done: false, d1Ack: false, ddayAck: false },
  { id: "rere", date: "2026-09-02", time: "13:00", pax: 2, done: false, d1Ack: false, ddayAck: false },
];

console.log("\n[1] The reported bug: three future bookings, none followed up");
{
  const c = makeCtx("2026-08-21T20:45:00+07:00", "10:00");
  prod.forEach((r) => eq(r.id + " shows as pending", c._resNotifyClassify(r), "pending"));
}

console.log("\n[2] Goal 2 — booked 00:30, PC off, opened 09:00 next morning");
{
  const c = makeCtx("2026-08-22T09:00:00+07:00", "10:00");
  eq(
    "overnight booking still pending",
    c._resNotifyClassify({ date: "2026-08-25", done: false, d1Ack: false, ddayAck: false }),
    "pending",
  );
  eq(
    "…and stays pending even once its date passes",
    c._resNotifyClassify({ date: "2026-08-10", done: false, d1Ack: false, ddayAck: false }),
    "pending",
  );
}

console.log("\n[3] Goal 3 — D-1 opens at opening time, not at midnight");
{
  const early = makeCtx("2026-08-21T07:30:00+07:00", "10:00");
  eq(
    "07:30, booking for tomorrow → quiet (before opening)",
    early._resNotifyClassify({ date: "2026-08-22", done: true, d1Ack: false, ddayAck: false }),
    "quiet",
  );
  const open = makeCtx("2026-08-21T10:00:00+07:00", "10:00");
  eq(
    "10:00 exactly → incoming",
    open._resNotifyClassify({ date: "2026-08-22", done: true, d1Ack: false, ddayAck: false }),
    "incoming",
  );
  const later = makeCtx("2026-08-21T15:00:00+07:00", "10:00");
  eq(
    "15:00 → incoming",
    later._resNotifyClassify({ date: "2026-08-22", done: true, d1Ack: false, ddayAck: false }),
    "incoming",
  );
  const shifted = makeCtx("2026-08-21T10:30:00+07:00", "11:00");
  eq(
    "manager moved opening to 11:00 → still quiet at 10:30",
    shifted._resNotifyClassify({ date: "2026-08-22", done: true, d1Ack: false, ddayAck: false }),
    "quiet",
  );
}

console.log("\n[4] Goal 3 — acking D-1 must NOT silence D-day");
{
  const d1 = makeCtx("2026-08-21T14:00:00+07:00", "10:00");
  const row = { date: "2026-08-22", done: true, d1Ack: false, ddayAck: false };
  eq("D-1: incoming", d1._resNotifyClassify(row), "incoming");
  row.d1Ack = true;
  eq("D-1 after ack: quiet", d1._resNotifyClassify(row), "quiet");
  const dday = makeCtx("2026-08-22T09:00:00+07:00", "10:00");
  eq("next day, same row, d1 acked: incoming again", dday._resNotifyClassify(row), "incoming");
  row.ddayAck = true;
  eq("D-day after ack: quiet", dday._resNotifyClassify(row), "quiet");
}

console.log("\n[5] D-day reminder ignores opening time (guest could be a 10:00 booking)");
{
  const c = makeCtx("2026-08-22T06:00:00+07:00", "10:00");
  eq(
    "06:00 on the day itself → incoming",
    c._resNotifyClassify({ date: "2026-08-22", done: true, d1Ack: true, ddayAck: false }),
    "incoming",
  );
}

console.log("\n[6] Pending outranks incoming (never ask to re-check what was never contacted)");
{
  const c = makeCtx("2026-08-22T14:00:00+07:00", "10:00");
  eq(
    "unfollowed booking for today",
    c._resNotifyClassify({ date: "2026-08-22", done: false, d1Ack: false, ddayAck: false }),
    "pending",
  );
}

console.log("\n[7] Done + far future → hidden, so the panel is not an archive");
{
  const c = makeCtx("2026-08-21T14:00:00+07:00", "10:00");
  eq(
    "done booking for December",
    c._resNotifyClassify({ date: "2026-12-12", done: true, d1Ack: false, ddayAck: false }),
    "quiet",
  );
}

console.log("\n[8] Local-date helpers must not drift to UTC");
{
  // 07:30 WIB is 00:30 UTC — the classic toISOString() off-by-one window
  const c = makeCtx("2026-08-22T07:30:00+07:00", "10:00");
  eq("today is 22 Aug, not 21", c._resNotifyToday(), "2026-08-22");
  eq("tomorrow is 23 Aug", c._resNotifyTomorrow(), "2026-08-23");
  // 23:30 WIB is 16:30 UTC same day — safe direction, check anyway
  const c2 = makeCtx("2026-08-22T23:30:00+07:00", "10:00");
  eq("late night still 22 Aug", c2._resNotifyToday(), "2026-08-22");
  // month boundary
  const c3 = makeCtx("2026-08-31T23:00:00+07:00", "10:00");
  eq("month rollover tomorrow = 1 Sep", c3._resNotifyTomorrow(), "2026-09-01");
}

console.log("\n[9] Missing/garbage opening time falls back to 10:00");
{
  const c = makeCtx("2026-08-21T09:00:00+07:00", "10:00");
  eq("default", c._resNotifyOpenMinutes(), 600);
  const bad = makeCtx("2026-08-21T09:00:00+07:00", "abc");
  eq("garbage → 10:00", bad._resNotifyOpenMinutes(), 600);
}

console.log("\n[10] Slot detection used by the follow-up guardrail");
{
  const c = makeCtx("2026-08-21T14:00:00+07:00", "10:00");
  eq("today → dday", c._resNotifySlot("2026-08-21"), "dday");
  eq("tomorrow after open → d1", c._resNotifySlot("2026-08-22"), "d1");
  eq("day after tomorrow → null", c._resNotifySlot("2026-08-23"), null);
  eq("yesterday → null", c._resNotifySlot("2026-08-20"), null);
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
