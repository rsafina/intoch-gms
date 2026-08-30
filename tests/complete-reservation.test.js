// Completing a reservation must never lose the spend, and must never invent
// a visit for a guest who did not come.
//
// Ported from blueheron-gms 2026-08-30, where both failures were found in
// live data. Intoch ships to restaurants that will have the same
// closing-time habit, so the fix travels with the suite that proves it.
//
// Runs the REAL confirmCompleteVisit() out of js/app.js (sliced, not
// retyped) against a fake DOM and a fake Supabase, because the bug this
// guards against was invisible: staff typed a spend, the app said
// "Visit completed", and nothing was written anywhere.
//
// Before 2026-08-30, going Reserved -> Completed without clicking Arrived
// left no visit row, so the `if (linkedVisit)` block was skipped in
// silence. Four online-form bookings lost their money that way.
//
// The first fix auto-created the visit, which was wrong in the other
// direction: front desk uses Completed to clear no-shows off the board at
// closing time, and auto-creating would have invented arrivals for guests
// who never walked in. The app cannot tell the two apart, so it asks.
// These cases exist to stop either failure coming back.
//
//   node tests/complete-reservation.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Line endings are normalised on read. Rere works across two machines and
// one of them saves these files with CRLF, which silently broke every test
// that matches source text containing "\n" (2026-08-30, after a rebase
// pulled CRLF copies of app.js/config.js/notify.js in). Normalising here
// keeps the suite honest on either machine without a repo-wide reformat.
const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8").replace(/\r\n/g, "\n");
const START = "async function confirmCompleteVisit() {";
const END = "\n// ============================================================\n// REPORTS";
const a = src.indexOf(START);
const b = src.indexOf(END, a);
if (a < 0 || b <= a) {
  console.error("FAIL: could not slice confirmCompleteVisit out of app.js");
  process.exit(1);
}
const block = src.slice(a, b);

const RES_ID = "res-1";

// ---- fake Supabase: records every write, answers selects from state ----
function makeDb(state) {
  const calls = [];
  const table = (name) => {
    const q = {
      _table: name,
      _op: null,
      _payload: null,
      _filters: {},
      select() {
        if (!q._op) q._op = "select";
        return q;
      },
      insert(payload) {
        q._op = "insert";
        q._payload = payload;
        return q;
      },
      update(payload) {
        q._op = "update";
        q._payload = payload;
        return q;
      },
      eq(col, val) {
        q._filters[col] = val;
        return q;
      },
      single() {
        return q._run();
      },
      maybeSingle() {
        return q._run();
      },
      _run() {
        calls.push({
          table: name,
          op: q._op,
          payload: q._payload,
          filters: { ...q._filters },
        });
        if (q._op === "insert" && name === "visits") {
          state.visit = { id: "visit-new", ...q._payload };
          return Promise.resolve({ data: { id: "visit-new", guest_id: q._payload.guest_id }, error: null });
        }
        if (q._op === "update" && name === "visits") {
          if (state.visit) Object.assign(state.visit, q._payload);
          return Promise.resolve({ data: null, error: state.visitUpdateError || null });
        }
        if (q._op === "update" && name === "reservations") {
          state.reservation.status = q._payload.status;
          return Promise.resolve({ data: null, error: null });
        }
        if (name === "visits") {
          // select on visits: the linked-visit lookup
          if (q._filters.reservation_id) {
            return Promise.resolve({ data: state.visit || null, error: null });
          }
          return Promise.resolve({ data: state.visit || null, error: null });
        }
        if (name === "reservations") {
          return Promise.resolve({ data: state.reservation, error: null });
        }
        if (name === "guests") {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(res) {
        // supports `await db.from(x).update(y).eq(...)` with no .single()
        return q._run().then(res);
      },
    };
    return q;
  };
  return { from: table, _calls: calls };
}

// arrived: "yes" | "no" | null (asked, nothing picked) | undefined (not asked)
function makeCtx(state, arrived) {
  const cls = () => {
    let hidden = true;
    return {
      _isHidden: () => hidden,
      add: (c) => {
        if (c === "hidden") hidden = true;
      },
      remove: (c) => {
        if (c === "hidden") hidden = false;
      },
      contains: (c) => (c === "hidden" ? hidden : false),
      toggle() {},
    };
  };
  const askClasses = cls();
  if (arrived !== undefined) askClasses.remove("hidden");
  const errClasses = cls();
  const fields = {
    "complete-visit-id": { value: RES_ID },
    "complete-type": { value: "reservation" },
    "complete-spend": { value: "450000", focus() {} },
    "complete-notes": { value: "" },
    "complete-favorite-menu": { value: "" },
    "complete-spend-error": { classList: cls() },
    "complete-arrived-ask": { classList: askClasses },
    "complete-arrived-yes": { checked: arrived === "yes" },
    "complete-arrived-no": { checked: arrived === "no" },
    "complete-arrived-error": { classList: errClasses },
  };
  const _askErrorShown = () => !errClasses._isHidden();
  const toasts = [];
  const db = makeDb(state);
  const ctx = {
    console,
    document: { getElementById: (id) => fields[id] || null },
    db,
    _toasts: toasts,
    _db: db,
    _askErrorShown,
    toast: (m, t) => toasts.push({ m, t }),
    loader() {},
    hideModal() {},
    cleanNumericInput: (v) => String(v).replace(/[^\d.]/g, ""),
    currentStaffId: () => "staff-1",
    getNowTime: () => "19:30",
    async supabaseQuery(fn) {
      try {
        const { data, error } = await fn();
        return error ? { data: null, error } : { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    async updateGuestSpendingTier() {},
    async maybeAwardMembershipSticker(...args) {
      state.stickerArgs = args;
    },
    invalidateVisitCountCache() {},
    invalidateGuestVisitHistoryCache() {},
    isViewingStaffDashboard: () => false,
    async loadDashboard() {},
    async loadWalkIns() {},
    async loadReservations() {},
    async renderAreas() {},
    async loadTodaySpendingSummary() {},
    currentPage: "reservations",
    _tierRefreshLastRun: 1,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(block + "\nglobalThis.__run = confirmCompleteVisit;", ctx);
  return ctx;
}

let pass = 0;
let fail = 0;
function ok(label, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? "  → " + extra : ""));
  }
}

(async () => {
  console.log("\n[1] No Arrived click, staff answer \"yes, they came\"");
  {
    const state = {
      reservation: {
        id: RES_ID,
        guest_id: "guest-1",
        reservation_date: "2026-08-30",
        pax: 4,
        assigned_area: "area-1",
        table_id: null,
        status: "Reserved",
      },
      visit: null,
    };
    const ctx = makeCtx(state, "yes");
    await ctx.__run();

    ok("a visit row is created", !!state.visit, JSON.stringify(state.visit));
    ok("the visit is linked to the reservation", state.visit && state.visit.reservation_id === RES_ID);
    ok("it is dated the reservation date, not today", state.visit && state.visit.visit_date === "2026-08-30");
    ok("pax carries over from the booking", state.visit && state.visit.pax === 4);
    ok("SPEND IS SAVED", state.visit && Number(state.visit.spend_amount) === 450000,
       state.visit ? String(state.visit.spend_amount) : "no visit");
    ok("the visit is marked Done", state.visit && state.visit.status === "Done");
    ok("the reservation ends Completed", state.reservation.status === "Completed");
    ok("membership sticker is still awarded", Array.isArray(state.stickerArgs) && state.stickerArgs[1] === 450000);
    ok("no error toast", !ctx._toasts.some((t) => t.t === "error"), JSON.stringify(ctx._toasts));
  }

  console.log("\n[2] The normal path (Arrived first) is unchanged");
  {
    const state = {
      reservation: {
        id: RES_ID,
        guest_id: "guest-1",
        reservation_date: "2026-08-30",
        pax: 2,
        assigned_area: null,
        table_id: null,
        status: "Arrived",
      },
      visit: { id: "visit-existing", guest_id: "guest-1", reservation_id: RES_ID },
    };
    const ctx = makeCtx(state);
    await ctx.__run();

    ok("the existing visit is reused, not duplicated", state.visit.id === "visit-existing");
    ok("spend lands on it", Number(state.visit.spend_amount) === 450000);
    ok("reservation Completed", state.reservation.status === "Completed");
  }

  console.log("\n[3] If the visit cannot be saved, the status rolls back and says so");
  {
    const state = {
      reservation: {
        id: RES_ID,
        guest_id: "guest-1",
        reservation_date: "2026-08-30",
        pax: 2,
        assigned_area: null,
        table_id: null,
        status: "Arrived",
      },
      visit: { id: "visit-existing", guest_id: "guest-1", reservation_id: RES_ID },
      visitUpdateError: { message: "boom" },
    };
    const ctx = makeCtx(state);
    await ctx.__run();

    ok("reservation is NOT left Completed", state.reservation.status !== "Completed", state.reservation.status);
    ok("staff are told", ctx._toasts.some((t) => t.t === "error"), JSON.stringify(ctx._toasts));
  }

  console.log("\n[4] No Arrived click, staff answer \"no, they did not come\"");
  {
    const state = {
      reservation: {
        id: RES_ID,
        guest_id: "guest-1",
        reservation_date: "2026-08-30",
        pax: 3,
        assigned_area: null,
        table_id: null,
        status: "Reserved",
      },
      visit: null,
    };
    const ctx = makeCtx(state, "no");
    await ctx.__run();

    ok("NO phantom visit is invented", state.visit === null, JSON.stringify(state.visit));
    ok("booking lands in Cancelled (No Show)", state.reservation.status === "Cancelled (No Show)",
       state.reservation.status);
    ok("it is NOT marked Completed", state.reservation.status !== "Completed");
    ok("no membership sticker", !state.stickerArgs);
    ok("staff get a confirmation", ctx._toasts.some((t) => t.t !== "error"));
  }

  console.log("\n[5] Asked but nothing picked: refuse, do not guess");
  {
    const state = {
      reservation: {
        id: RES_ID,
        guest_id: "guest-1",
        reservation_date: "2026-08-30",
        pax: 3,
        assigned_area: null,
        table_id: null,
        status: "Reserved",
      },
      visit: null,
    };
    const ctx = makeCtx(state, null);
    await ctx.__run();

    ok("nothing is written at all", state.visit === null && state.reservation.status === "Reserved",
       state.reservation.status);
    ok("the inline error is shown", ctx._askErrorShown());
  }

  console.log("\n[6] A spend of 0 on a real arrival still records the visit");
  {
    const state = {
      reservation: {
        id: RES_ID,
        guest_id: "guest-1",
        reservation_date: "2026-08-30",
        pax: 2,
        assigned_area: null,
        table_id: null,
        status: "Reserved",
      },
      visit: null,
    };
    const ctx = makeCtx(state, "yes");
    ctx.document.getElementById("complete-spend").value = "0";
    await ctx.__run();

    ok("visit exists", !!state.visit);
    ok("spend is 0, not dropped", state.visit && Number(state.visit.spend_amount) === 0);
    ok("reservation Completed", state.reservation.status === "Completed");
  }

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
