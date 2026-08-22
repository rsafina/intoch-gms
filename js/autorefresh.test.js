// Extracts isSafeToAutoReload + attemptAutoReload from the patched app.js
// and exercises them against a fake DOM + fake clock.
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("/tmp/bh/app.js", "utf8");
const start = src.indexOf("function isSafeToAutoReload()");
const endMark = "\nfunction setupRealtimeUpdates()";
const end = src.indexOf(endMark);
if (start < 0 || end < 0) throw new Error("could not slice auto-refresh block");
const block = src.slice(start, end);
if (!/AUTO_REFRESH_MAX_DEFER_MS/.test(block)) throw new Error("patch missing from slice");

let pass = 0,
  fail = 0;
function eq(label, got, want) {
  if (got === want) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + " → got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  }
}

// world: modalOpen, qwName, qwPhone, activeElement
function makeCtx(world) {
  const timers = [];
  let nowMs = 1000000;
  const ctx = {
    console: { log: () => {} },
    Date: { now: () => nowMs },
    document: {
      querySelector: (sel) =>
        sel === ".modal-overlay:not(.hidden)" && world.modalOpen ? {} : null,
      getElementById: (id) => {
        if (id === "qw-name") return { value: world.qwName || "" };
        if (id === "qw-phone") return { value: world.qwPhone || "" };
        return null;
      },
      get activeElement() {
        return world.activeElement || null;
      },
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, at: nowMs + ms });
      return timers.length;
    },
    location: {
      reloads: 0,
      reload() {
        this.reloads++;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  ctx.__advance = (ms) => {
    nowMs += ms;
    const due = timers.filter((t) => t.at <= nowMs);
    due.forEach((t) => {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    });
  };
  ctx.__pendingTimers = () => timers.length;
  ctx.__setNow = (ms) => {
    nowMs = ms;
  };
  return ctx;
}

console.log("\n[1] Idle page reloads immediately");
{
  const c = makeCtx({});
  c.attemptAutoReload("test");
  eq("reloaded", c.location.reloads, 1);
}

console.log("\n[2] THE BUG: empty focused search box must NOT block");
{
  const c = makeCtx({ activeElement: { tagName: "INPUT", value: "" } });
  eq("isSafeToAutoReload", c.isSafeToAutoReload(), true);
  c.attemptAutoReload("test");
  eq("reloaded despite focus", c.location.reloads, 1);
}
{
  const c = makeCtx({ activeElement: { tagName: "INPUT", value: "   " } });
  eq("whitespace-only also safe", c.isSafeToAutoReload(), true);
}

console.log("\n[3] Genuinely typed content still blocks");
{
  const c = makeCtx({ activeElement: { tagName: "INPUT", value: "Budi" } });
  eq("not safe", c.isSafeToAutoReload(), false);
  c.attemptAutoReload("test");
  eq("did not reload", c.location.reloads, 0);
}
{
  const c = makeCtx({ activeElement: { tagName: "TEXTAREA", value: "catatan" } });
  eq("textarea with text blocks", c.isSafeToAutoReload(), false);
}
{
  const c = makeCtx({ modalOpen: true });
  eq("open modal blocks", c.isSafeToAutoReload(), false);
}
{
  const c = makeCtx({ qwName: "Sari" });
  eq("quick walk-in name blocks", c.isSafeToAutoReload(), false);
}

console.log("\n[4] Focused SELECT must not become a permanent blocker");
{
  const c = makeCtx({ activeElement: { tagName: "SELECT", value: "Reserved" } });
  eq("select alone is safe", c.isSafeToAutoReload(), true);
}
{
  const c = makeCtx({ modalOpen: true, activeElement: { tagName: "SELECT", value: "x" } });
  eq("select inside a modal still blocks", c.isSafeToAutoReload(), false);
}

console.log("\n[5] Deferral chains must not multiply (the watcher fires every 60s)");
{
  const c = makeCtx({ modalOpen: true });
  for (let i = 0; i < 10; i++) c.attemptAutoReload("day changed");
  eq("only one retry timer outstanding", c.__pendingTimers(), 1);
  eq("no reload while blocked", c.location.reloads, 0);
}

console.log("\n[6] Blocked tab recovers as soon as staff finish");
{
  const world = { modalOpen: true };
  const c = makeCtx(world);
  c.attemptAutoReload("day changed");
  eq("deferred", c.location.reloads, 0);
  world.modalOpen = false; // staff closed the modal
  c.__advance(2 * 60 * 1000);
  eq("reloaded on retry", c.location.reloads, 1);
}

console.log("\n[7] 30-minute ceiling: a tab left blocked reloads anyway");
{
  const c = makeCtx({ activeElement: { tagName: "INPUT", value: "abandoned" } });
  c.attemptAutoReload("day changed");
  eq("deferred at t=0", c.location.reloads, 0);
  for (let i = 0; i < 14; i++) c.__advance(2 * 60 * 1000); // 28 min
  eq("still deferred at 28 min", c.location.reloads, 0);
  c.__advance(2 * 60 * 1000); // 30 min
  eq("forced reload at 30 min", c.location.reloads, 1);
}

console.log("\n[8] Ceiling measured from FIRST defer, so a re-firing watcher cannot push it back");
{
  const c = makeCtx({ modalOpen: true });
  c.attemptAutoReload("day changed");
  for (let i = 0; i < 29; i++) {
    c.__advance(60 * 1000);
    c.attemptAutoReload("day changed"); // watcher re-fires every minute
  }
  eq("no reload before the ceiling", c.location.reloads, 0);
  c.__advance(60 * 1000);
  c.attemptAutoReload("day changed");
  eq("reloaded exactly once at 30 min despite constant re-triggering", c.location.reloads, 1);
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
