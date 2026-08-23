// The logout/login cycle, run against the REAL @supabase/supabase-js client.
//
// RUN AS:  node tests/realtime-lifecycle.test.js
//
// This is a regression test for a production failure reported 2026-08-23:
// notifications, the new-booking chime and the overnight auto-refresh all
// stopped working until the page was refreshed.
//
// The cause was not in any of those features. logoutStaff() reset
// appInitialized but left the realtime channels open, so the NEXT login called
// db.channel() with a topic that already existed, got the same already
// subscribed channel back, and .on() threw. The throw escaped
// initializeApplication() and every line after it never ran.
//
// A stub would not have caught this: the behaviour under test is a rule inside
// the Supabase client, so the real client is what this loads. If the library
// ever relaxes that rule, the "reproduces the original bug" case below fails
// loudly and this file can be simplified rather than quietly protecting
// against nothing.
const fs = require("fs");
const path = require("path");

let createClient;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (_) {
  console.log("SKIP  (needs @supabase/supabase-js: npm install)");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const notifySrc = fs.readFileSync(path.join(ROOT, "js", "notify.js"), "utf8");

let pass = 0,
  fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "  → " + detail : ""}`);
  }
}

// No network is opened: subscribe() starts a socket attempt that we never
// wait on, and the assertions are all about client-side channel state.
const db = createClient("https://example.supabase.co", "eyJhbGciOiJIUzI1NiJ9.e30.x");

// ── 1. The original bug still exists in the library ───────────────────
console.log("\nThe library rule this bug was built on");
{
  const c1 = db.channel("probe-topic");
  c1.on("postgres_changes", { event: "INSERT", schema: "public", table: "x" }, () => {});
  c1.subscribe();
  const c2 = db.channel("probe-topic");
  ok("channel() hands back the SAME channel for a topic already open", c1 === c2);
  let threw = null;
  try {
    c2.on("postgres_changes", { event: "UPDATE", schema: "public", table: "x" }, () => {});
  } catch (e) {
    threw = e.message;
  }
  ok(
    "adding a listener after subscribe() throws",
    threw && /after `subscribe\(\)`/.test(threw),
    threw || "did not throw",
  );
  db.removeChannel(c1);
}

// ── 2. removeChannel makes the topic reusable ─────────────────────────
console.log("\nremoveChannel is what makes a second login survivable");
{
  const a = db.channel("cycle-topic");
  a.on("postgres_changes", { event: "INSERT", schema: "public", table: "x" }, () => {});
  a.subscribe();
  db.removeChannel(a);
  const b = db.channel("cycle-topic");
  ok("a fresh channel object comes back after removal", a !== b);
  let threw = null;
  try {
    b.on("postgres_changes", { event: "INSERT", schema: "public", table: "x" }, () => {});
  } catch (e) {
    threw = e.message;
  }
  ok("and it accepts listeners again", threw === null, threw);
  db.removeChannel(b);
}

// ── 3. The app actually wires the teardown up ─────────────────────────
// Source assertions, because the real functions cannot be lifted out of
// app.js without dragging the whole DOM in. These are the four connections
// that, if any one is dropped, bring the bug straight back.
console.log("\nThe app wires teardown into logout");
ok(
  "app.js holds a reference to the channel",
  /_rtTodayChannel = db\.channel\("rt-today-updates"\)/.test(appSrc),
);
ok(
  "teardownRealtimeUpdates removes it",
  /function teardownRealtimeUpdates\(\)[\s\S]*?db\.removeChannel\(_rtTodayChannel\)/.test(appSrc),
);
ok(
  "logoutStaff calls the teardown",
  /function logoutStaff\(\)[\s\S]*?teardownRealtimeUpdates\(\)[\s\S]*?appInitialized = false/.test(appSrc),
);
ok(
  "logoutStaff also tears down the bell",
  /function logoutStaff\(\)[\s\S]*?teardownOnlineResNotify[\s\S]*?appInitialized = false/.test(appSrc),
);
// Belt and braces: even a future throw in here must not cost us the bell.
ok(
  "setupRealtimeUpdates is called inside its own try",
  /try \{\s*setupRealtimeUpdates\(\);\s*\} catch/.test(appSrc),
);
ok(
  "the bell setup has a SEPARATE try, so one failure cannot cost the other",
  /try \{\s*if \(typeof setupOnlineResNotify === "function"\) setupOnlineResNotify\(\);\s*\} catch/.test(appSrc),
);
// Re-running setup must be safe on its own, not only via logout.
ok(
  "setupRealtimeUpdates tears down before it subscribes",
  /function setupRealtimeUpdates\(\)[\s\S]*?teardownRealtimeUpdates\(\);[\s\S]*?_rtTodayChannel = db\.channel/.test(appSrc),
);

console.log("\nThe bell can restart after a logout");
ok(
  "notify.js holds its channel",
  /_resNotifyChannel = db\.channel\("rt-online-res-bell"\)/.test(notifySrc),
);
ok(
  "teardown clears the poll timer",
  /function teardownOnlineResNotify\(\)[\s\S]*?clearInterval\(_resNotifyPollTimer\)/.test(notifySrc),
);
// setupOnlineResNotify() returns early if _resNotifyStarted is set. Without
// clearing it the crash is traded for a permanently silent bell, which is
// worse: nothing on screen says anything is wrong.
ok(
  "teardown clears the once-only guard so the bell can start again",
  /function teardownOnlineResNotify\(\)[\s\S]*?_resNotifyStarted = false/.test(notifySrc),
);
// A new shift must be chimed for bookings the previous shift already saw.
ok(
  "teardown forgets which bookings were already chimed for",
  /function teardownOnlineResNotify\(\)[\s\S]*?_resNotifySeenPending = new Set\(\)/.test(notifySrc),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
