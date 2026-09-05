// ============================================================
// INTOCH — Main Application Logic
// ============================================================

let currentPage = "dashboard";
let allGuests = [];
let allAreas = [];
let allTables = [];
let allReservations = [];
// Tracks occupied table IDs and skip-occupancy flag per modal prefix (wi / res)
const tablePickerContext = {};
let dashboardReservationOffset = 0;
let dashboardReservationCounts = [0, 0, 0];
// Per-day {count, activeCount, pax, excluded, unplacedCount, unplacedPax}
// for the three Upcoming Reservations tabs. null = not loaded yet.
let dashboardReservationTotals = [null, null, null];
let dashboardResPage = 0; // current page index for reservations (0-based)
let dashboardResData = []; // full reservations dataset for current tab
let dashboardWalkinPage = 0; // current page index for walk-ins (0-based)
let dashboardWalkinData = []; // full walk-ins dataset
let dashboardPrizePage = 0; // current page index for prize redemptions (0-based)
let currentWiGuestId = null;
let currentWiEditId = null;
let wiModalOriginalGuestId = null; // guest the walk-in belonged to when the edit modal was opened
let currentResGuestId = null;
let resModalOriginalPhone = null; // phone of the guest loaded into the edit modal (guards against duplicating it on "create new guest")
let resSelectedDate = null; // YYYY-MM-DD string for the currently viewed reservations day, null = today
let resStatusFilter = "all";
let guestTierFilter = "all";
let guestTagFilter = "";
let guestMinVisits = 0;
let guestLastVisitFrom = "";
let guestLastVisitTo = "";
let guestSortKey = "lastVisit"; // 'name' | 'visits' | 'lastVisit'
let guestSortDir = "desc"; // 'asc' | 'desc'
let wiSpendingTierFilter = "medium_spender";
let wiSelectedDate = TODAY; // YYYY-MM-DD string for the currently selected walk-in date
let summarySelectedDate = TODAY; // YYYY-MM-DD string for spending summary date navigation
const GUEST_PAGE_SIZE = 15;
let guestPage = 1;
let appInitialized = false;
let allPrizes = [];
let _voidReasonContext = null; // { type: 'reservation'|'visit', id } — set by openDeleteReservation/openVoidWalkIn, consumed by confirmVoidReason
let wiShowVoided = false; // toggle: include voided walk-ins in the list (manager audit view)

function formatSpendingTierLabel(tier) {
  if (!tier) return t("None");
  // "High Spender" / "Medium Spender" are fixed exception terms — always
  // shown in English per product decision, so no t() wrapper here.
  if (tier === "high_spender") return "High Spender";
  if (tier === "medium_spender") return "Medium Spender";
  return t("None");
}

function formatSpendingTierBadge(tier) {
  const label = formatSpendingTierLabel(tier);
  let style = "background:#F5F3F0;color:#777;";
  if (tier === "high_spender") style = "background:#EFF7EC;color:#3F6C3F;";
  if (tier === "medium_spender") style = "background:#EEF4FD;color:#1F4E79;";
  return `<span class="guest-badge whitespace-nowrap" style="${style}">${label}</span>`;
}

// ============================================================
// SPENDING TIER CLASSIFICATION
// Business rules:
//   High   — any single visit: spend >= 1,000,000 OR spend/pax >= 300,000
//             Status is STICKY for 90 days after the most recent qualifying visit.
//   Medium — has any spend history and does not currently qualify as High.
//   None   — no spend records exist.
// ============================================================

let HIGH_SPEND_THRESHOLD = 1000000; // per-visit total (default; overridden by app_settings)
let HIGH_SPEND_PER_PAX = 300000; // per-visit spend/pax (default; overridden by app_settings)
let HIGH_SPENDER_STICKY_DAYS = 90; // days High status is retained (default; overridden by app_settings)

// Loaded from the app_settings table at startup (same keys as Sirkel/
// gms-proto). Falls back to the defaults above if the row is missing —
// the DB functions use identical fallbacks, so JS and DB always agree.
let APP_SETTINGS = {};
async function loadAppSettings() {
  const { data, error } = await supabaseQuery(
    () => db.from("app_settings").select("key, value"),
    "Failed to load app settings",
  );
  if (error || !data) return; // keep defaults
  APP_SETTINGS = Object.fromEntries(data.map((r) => [r.key, r.value]));
  const st = APP_SETTINGS.spending_tier || {};
  if (st.high_visit_total > 0)
    HIGH_SPEND_THRESHOLD = Number(st.high_visit_total);
  if (st.high_per_pax > 0) HIGH_SPEND_PER_PAX = Number(st.high_per_pax);
  if (st.sticky_days > 0) HIGH_SPENDER_STICKY_DAYS = Number(st.sticky_days);
  if (typeof applyMembershipSettings === "function") applyMembershipSettings();
  // The staff app already has every app_settings row in hand here, so hand
  // the branding row straight to the branding module instead of making it
  // run a second query for a row we just fetched.
  if (typeof initBranding === "function") initBranding(APP_SETTINGS.branding);
  if (typeof loadReserveAppearance === "function")
    loadReserveAppearance(APP_SETTINGS.reserve_appearance || {});
  if (typeof vcLoadStyle === "function")
    vcLoadStyle(APP_SETTINGS.voucher_style || {});
  if (typeof invLoadStyle === "function") {
    invLoadStyle(APP_SETTINGS.invoice_style || {});
    if (typeof applyInvoiceStyle === "function") applyInvoiceStyle();
  }
}

/**
 * Returns true if a single visit record qualifies for High Spender.
 */
function visitQualifiesHigh(visit) {
  const spend = Number(visit.spend_amount) || 0;
  const pax = Number(visit.pax) || 1;
  return spend >= HIGH_SPEND_THRESHOLD || spend / pax >= HIGH_SPEND_PER_PAX;
}

/**
 * Determines the new spending tier and the updated high_spender_qualified_at value.
 *
 * @param {Array}  visits                 - All valid spend visits (spend_amount > 0)
 * @param {string|null} currentQualifiedAt - guests.high_spender_qualified_at (ISO string or null)
 * @returns {{ tier: string|null, qualifiedAt: string|null }}
 */
function determineSpendingTier(visits, currentQualifiedAt) {
  const validVisits = (visits || []).filter(
    (v) => (Number(v.spend_amount) || 0) > 0,
  );

  // No spend history → None
  if (!validVisits.length) return { tier: null, qualifiedAt: null };

  const now = new Date();
  const stickyWindow = new Date(
    now.getTime() - HIGH_SPENDER_STICKY_DAYS * 86400000,
  );

  // Find the most recent qualifying visit across all history
  let latestQualifyingDate = null;
  for (const v of validVisits) {
    if (visitQualifiesHigh(v)) {
      const vDate = new Date(v.visit_date || v.created_at || now);
      if (!latestQualifyingDate || vDate > latestQualifyingDate) {
        latestQualifyingDate = vDate;
      }
    }
  }

  // The effective qualified-at is whichever is more recent: a new qualifying visit
  // found in this recalc, or the previously stored value (sticky from last save).
  let effectiveQualifiedAt = currentQualifiedAt
    ? new Date(currentQualifiedAt)
    : null;
  if (
    latestQualifyingDate &&
    (!effectiveQualifiedAt || latestQualifyingDate > effectiveQualifiedAt)
  ) {
    effectiveQualifiedAt = latestQualifyingDate;
  }

  // High: sticky window still active
  if (effectiveQualifiedAt && effectiveQualifiedAt >= stickyWindow) {
    return {
      tier: "high_spender",
      qualifiedAt: effectiveQualifiedAt.toISOString(),
    };
  }

  // Medium: has spend but High window expired (or never qualified)
  return {
    tier: "medium_spender",
    qualifiedAt: effectiveQualifiedAt?.toISOString() || null,
  };
}

async function updateGuestSpendingTier(guestId, force = false) {
  if (!guestId) return;

  const { data: guest, error: guestError } = await supabaseQuery(
    () =>
      db
        .from("guests")
        .select("id, spending_tier, tier_source, high_spender_qualified_at")
        .eq("id", guestId)
        .single(),
    "Failed to load guest tier info",
  );
  if (guestError || !guest) return;
  if (guest.tier_source === "manual" && !force) return;

  const { data: visits, error: visitError } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("guest_id, spend_amount, pax, visit_date")
        .eq("guest_id", guestId)
        .not("spend_amount", "is", null)
        .gt("spend_amount", 0)
        .is("voided_at", null),
    "Failed to load guest visits for tier calculation",
  );
  if (visitError) return;

  const { tier: newTier, qualifiedAt: newQualifiedAt } = determineSpendingTier(
    visits || [],
    guest.high_spender_qualified_at,
  );

  if (!force && guest.spending_tier === newTier && guest.tier_source === "auto")
    return;

  await supabaseQuery(
    () =>
      db
        .from("guests")
        .update({
          spending_tier: newTier,
          tier_source: "auto",
          tier_last_calculated_at: new Date().toISOString(),
          high_spender_qualified_at: newQualifiedAt,
        })
        .eq("id", guestId),
    "Failed to update guest spending tier",
  );
}

// Throttle: tier recalc is expensive (1 query per loadGuests). Only run once
// per 10 minutes unless explicitly forced by a visit/save action.
let _tierRefreshLastRun = 0;
const TIER_REFRESH_TTL = 10 * 60 * 1000; // 10 minutes

async function refreshAutoGuestTiers(guests, force = false) {
  if (!guests?.length) return;
  const now = Date.now();
  if (!force && now - _tierRefreshLastRun < TIER_REFRESH_TTL) return;
  _tierRefreshLastRun = now;

  const autoGuests = guests.filter((g) => g.tier_source !== "manual");
  if (!autoGuests.length) return;
  const guestIds = autoGuests.map((g) => g.id);

  const { data: visits, error: visitError } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("guest_id, spend_amount, pax, visit_date")
        .in("guest_id", guestIds)
        .not("spend_amount", "is", null)
        .gt("spend_amount", 0)
        .is("voided_at", null),
    "Failed to load guest visits for tier refresh",
  );
  if (visitError) return;

  const grouped = {};
  (visits || []).forEach((v) => {
    if (!v.guest_id) return;
    if (!grouped[v.guest_id]) grouped[v.guest_id] = [];
    grouped[v.guest_id].push(v);
  });

  const updates = [];
  for (const guest of autoGuests) {
    const guestVisits = grouped[guest.id] || [];
    const { tier: newTier, qualifiedAt: newQualifiedAt } =
      determineSpendingTier(guestVisits, guest.high_spender_qualified_at);

    if (guest.spending_tier !== newTier || guest.tier_source !== "auto") {
      updates.push({
        id: guest.id,
        payload: {
          spending_tier: newTier,
          tier_source: "auto",
          tier_last_calculated_at: new Date().toISOString(),
          high_spender_qualified_at: newQualifiedAt,
        },
      });
      guest.spending_tier = newTier;
      guest.tier_source = "auto";
    }
  }

  await Promise.all(
    updates.map((u) =>
      supabaseQuery(
        () => db.from("guests").update(u.payload).eq("id", u.id),
        "Failed to refresh guest spending tier",
      ),
    ),
  );
}

// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  const resDateEl = document.getElementById("res-date-filter");
  if (resDateEl) resDateEl.value = TODAY;

  const pinEl = document.getElementById("login-pin");
  if (pinEl) {
    pinEl.addEventListener("input", () => {
      pinEl.value = pinEl.value.replace(/\D/g, "").slice(0, 4);
    });
  }

  if (!getStaffSession()) {
    showLoginPage();
    return;
  }

  const wiDateEl = document.getElementById("wi-date-filter");
  if (wiDateEl) wiDateEl.value = TODAY;
  updateWiDateNavLabel();

  await initializeApplication();
});

async function initializeApplication() {
  showAppShell();
  const staff = getStaffSession();
  const staffNameEl = document.getElementById("staff-display-name");
  if (staffNameEl)
    staffNameEl.textContent = staff?.display_name || staff?.username || "Staff";
  applyRoleToNav();

  if (appInitialized) {
    navigateTo("dashboard");
    return;
  }

  const connected = await testSupabaseConnection();
  if (!connected) return;

  await loadAppSettings();
  await loadAreas();
  await loadTables();
  populateAreaSelects();
  setupSpinResultsActions();

  // Admin does not land on page-dashboard, so skip its queries at boot —
  // avoids the extra reads for a page that will not render (we already got
  // burned by unnecessary polling once, see the refreshAutoGuestTiers egress
  // incident). Admin CAN still open it on demand via the Staff Dashboard nav
  // entry, which loads it lazily in navigateTo().
  if (currentStaffRole() !== "admin") {
    await loadDashboard();
    setStaffDashboardDateLabel();
  }
  appInitialized = true;

  // ── Restore last visited page (persists across refresh) ──
  const lastPage = localStorage.getItem("lastPage") || "dashboard";
  navigateTo(lastPage);

  // ── Realtime: refresh today-sensitive UI on any reservation/visit change ──
  //
  // Each in its OWN try/catch, and not merged into one. These are two
  // independent enhancements over an app that already works on its own
  // timers, and a single try around both would still let a failure in the
  // first one silently cost you the second. That is exactly the bug this
  // replaces: one throw here left the front desk with no bell and no chime
  // for a whole shift, with nothing on screen to say so.
  try {
    setupRealtimeUpdates();
  } catch (e) {
    console.error("realtime setup failed — live refresh is off", e);
  }
  try {
    if (typeof setupOnlineResNotify === "function") setupOnlineResNotify();
  } catch (e) {
    console.error("online reservation bell setup failed", e);
  }

  // ── Auto-refresh: prevents a PC left on overnight from silently logging
  // walk-ins/reservations against yesterday's date ──
  setupAutoRefresh();

  // Build freshness: tells staff when a newer deploy exists, instead of
  // making them wait up to 6 hours for the safety-net reload.
  if (typeof setupVersionCheck === "function") setupVersionCheck();
}

// ============================================================
// AUTO-REFRESH
// TODAY (config.js) is computed once when the page loads. If a front-desk
// PC is left open overnight without anyone reloading, TODAY never advances
// past midnight — staff registering a walk-in the next morning silently
// get it logged against yesterday's date (real incident, 2026-07-15).
//
// Two mechanisms:
//   1. A 1-minute date-watch that reloads as soon as the calendar day has
//      actually changed — fixes the reported bug within a minute, not up
//      to 6 hours later.
//   2. A flat 6-hour safety-net reload, as requested, in case of any other
//      long-session staleness (stale cached data, long shift with no
//      midnight crossing, etc.).
// Both defer (retry in 2 min) rather than reload if a modal is open or
// staff is actively typing, so nobody loses in-progress data entry.
// ============================================================
const AUTO_REFRESH_SAFETY_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const AUTO_REFRESH_DATE_WATCH_INTERVAL = 60 * 1000; // 1 minute

function getCurrentLocalDateString() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function isSafeToAutoReload() {
  // Any open modal (walk-in, reservation, edit, etc.) = staff mid-task.
  if (document.querySelector(".modal-overlay:not(.hidden)")) return false;

  // Quick Walk-In lives inline on the dashboard, not in a modal — check it
  // separately so a half-typed name/phone there doesn't get wiped either.
  const qwName = document.getElementById("qw-name")?.value?.trim();
  const qwPhone = document.getElementById("qw-phone")?.value?.trim();
  if (qwName || qwPhone) return false;

  // A focused field only counts as mid-task if something is actually
  // TYPED in it.
  //
  // The old check blocked on focus alone. document.activeElement stays
  // on an input until someone clicks elsewhere, so the everyday front
  // desk move of clicking the reservation search box, reading the
  // result, then walking away left an empty focused input blocking
  // every reload attempt indefinitely. That is how a tab ends up
  // running all-day-old code and never picking up a deployed fix.
  //
  // SELECT is deliberately not checked here: a select almost always
  // reports a non-empty value (its first option), so it would recreate
  // the permanent blocker this fix removes. Selects inside a form that
  // matters are already covered by the modal check above.
  const active = document.activeElement;
  if (
    active &&
    ["INPUT", "TEXTAREA"].includes(active.tagName) &&
    String(active.value || "").trim() !== ""
  ) {
    return false;
  }

  return true;
}

// Deferral used to be unbounded AND self-multiplying. Two separate bugs:
//
//   1. Every call spawned its own fresh 2-minute retry chain, and the
//      day-watcher calls this once a MINUTE while the date is stale, so
//      an hour of deferring left ~60 overlapping chains racing to reload.
//      _autoReloadPending collapses them into one.
//
//   2. Nothing ever gave up. Combined with the old focus check above, a
//      PC with the cursor parked in a search box would defer forever and
//      never pick up a deployed fix. AUTO_REFRESH_MAX_DEFER_MS is the
//      ceiling: after that we reload regardless.
//
// The ceiling is measured from the FIRST deferral, not the last, so a
// repeatedly-retriggering watcher cannot keep pushing it back.
const AUTO_REFRESH_MAX_DEFER_MS = 30 * 60 * 1000; // 30 min
let _autoReloadPending = false;
let _autoReloadDeferredSince = null;
let _autoReloadFired = false;

// location.reload() begins a navigation, so a second call is normally
// inert — but the day-watcher and an outstanding retry chain can land in
// the same tick, and "normally inert" is not a thing to rely on. One
// latch, one reload.
function _doAutoReload(msg) {
  if (_autoReloadFired) return;
  _autoReloadFired = true;
  console.log(msg);
  location.reload();
}

function attemptAutoReload(reason) {
  if (_autoReloadFired) return;

  if (isSafeToAutoReload()) {
    _doAutoReload(`[auto-refresh] Reloading (${reason})`);
    return;
  }

  const now = Date.now();
  if (_autoReloadDeferredSince === null) _autoReloadDeferredSince = now;

  if (now - _autoReloadDeferredSince >= AUTO_REFRESH_MAX_DEFER_MS) {
    _doAutoReload(
      `[auto-refresh] Deferred over 30 min (${reason}) — reloading anyway`,
    );
    return;
  }

  if (_autoReloadPending) return; // a retry chain is already running
  _autoReloadPending = true;
  console.log(
    `[auto-refresh] Deferred (${reason}) — staff appears mid-task, retrying in 2 min`,
  );
  setTimeout(() => {
    _autoReloadPending = false;
    attemptAutoReload(reason);
  }, 2 * 60 * 1000);
}

let _autoRefreshStarted = false;
function setupAutoRefresh() {
  if (typeof IS_DEV !== "undefined" && IS_DEV) return; // dev: no auto-reload timers
  if (_autoRefreshStarted) return; // guard against double-init (e.g. re-login without a full page reload)
  _autoRefreshStarted = true;

  setInterval(() => {
    if (getCurrentLocalDateString() !== TODAY) {
      attemptAutoReload("calendar day changed since page load");
    }
  }, AUTO_REFRESH_DATE_WATCH_INTERVAL);

  setInterval(() => {
    attemptAutoReload("6-hour periodic refresh");
  }, AUTO_REFRESH_SAFETY_INTERVAL);
}

// Held so logout can tear it down. Without this, logging out and back in
// produced a hard failure: db.channel() returns the EXISTING channel when one
// with that topic is already open, and calling .on() on a channel that has
// already been subscribed THROWS
//
//   cannot add `postgres_changes` callbacks for realtime:rt-today-updates
//   after `subscribe()`
//
// which propagated out of initializeApplication() and killed every line after
// it — the online-reservation bell, its chime, and the overnight auto-refresh.
// Reported by Rere 2026-08-23 as "notifications and reservation updates don't
// work unless I refresh the page". A page refresh cured it because a fresh
// load starts with no channel. Reproduced against @supabase/supabase-js.
let _rtTodayChannel = null;

function teardownRealtimeUpdates() {
  if (!_rtTodayChannel) return;
  try {
    db.removeChannel(_rtTodayChannel);
  } catch (e) {
    console.warn("realtime teardown failed", e);
  }
  _rtTodayChannel = null;
}

function setupRealtimeUpdates() {
  if (typeof IS_DEV !== "undefined" && IS_DEV) return; // dev: no realtime — saves a persistent connection + refetch bursts
  // Idempotent by construction. Even with the logout teardown in place, this
  // must never be the thing that throws: it runs in the middle of app boot
  // and takes everything after it down with it.
  teardownRealtimeUpdates();
  // Single channel for both tables — coalesces rapid bursts with a 1.5s debounce
  let _rtTimer = null;
  function scheduleRefresh() {
    clearTimeout(_rtTimer);
    _rtTimer = setTimeout(async () => {
      // Only refresh views that show today's live data. Admin normally sees
      // page-admin-dashboard, so a plain "dashboard" page for that role has
      // nothing on screen consuming this — but an admin who opened the Staff
      // Dashboard IS looking at page-dashboard and must get live updates like
      // anyone else, otherwise the owner watches a frozen floor view.
      if (isViewingStaffDashboard()) {
        await loadDashboard();
        return;
      }
      // If on ops reports, refresh just the live/forecast sections (not the full report)
      if (currentPage === "reports") {
        await loadDashboardReservationCounts(); // updates today's res + cancel cards
        await loadOpsForecast(); // updates this week / next week / next month
        await reloadPeakTrafficOnly(); // updates today's bar in peak chart
      }
    }, 1500);
  }

  _rtTodayChannel = db.channel("rt-today-updates");
  _rtTodayChannel
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reservations" },
      scheduleRefresh,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "reservations" },
      scheduleRefresh,
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "visits" },
      scheduleRefresh,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "visits" },
      scheduleRefresh,
    )
    .subscribe();
}

function showLoginPage() {
  document.getElementById("login-page")?.classList.remove("hidden");
  document.getElementById("app-sidebar")?.classList.add("hidden");
  document.getElementById("app-main")?.classList.add("hidden");
  document.getElementById("bd-alert-wrap")?.classList.add("hidden");
  setTimeout(() => document.getElementById("login-username")?.focus(), 50);
}

function showAppShell() {
  document.getElementById("login-page")?.classList.add("hidden");
  document.getElementById("app-sidebar")?.classList.remove("hidden");
  document.getElementById("app-main")?.classList.remove("hidden");
  document.getElementById("bd-alert-wrap")?.classList.remove("hidden");
  // Sidebar/nav text only exists in the DOM once the shell is shown, so
  // cache + apply the current language right after it becomes visible.
  initI18nCache();
  translateStaticDOM();
}

function formatNumberWithCommas(value) {
  if (value === null || value === undefined || value === "") return "";
  const parts = String(value).replace(/,/g, "").split(".");
  const integerPart = parts[0].replace(/^0+(?=\d)/, "");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.length > 1
    ? `${formattedInteger}.${parts[1]}`
    : formattedInteger;
}

function cleanNumericInput(value) {
  // Strip ALL non-digits: staff may type 450.000 (id-ID) or 450,000.
  // IDR has no decimals, so digits-only is always safe.
  return String(value).replace(/\D/g, "").trim();
}

function normalizePhone(value) {
  if (!value) return "";
  const s = String(value)
    .trim()
    .replace(/[\s\-().]/g, "");
  if (s.startsWith("+62")) return "0" + s.slice(3);
  if (s.startsWith("62") && s.length >= 10) return "0" + s.slice(2);
  return s;
}

function truncateNotes(text, maxChars = 200) {
  // Named `trimmed`, not `t`: `t` is the translation helper, and a local
  // binding of that name turns every t("...") in the same scope into
  // "TypeError: t is not a function". See CLAUDE.md, "Never declare a local
  // variable named t". Harmless here today, a landmine the moment somebody
  // adds a translated string to this function.
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars) + "…";
}

function formatSpendInput(element) {
  const raw = String(element.value || "");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    parts.length = 2;
  }
  parts[0] = parts[0].replace(/^0+(?=\d)/, "");
  const formatted = `${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${parts[1] !== undefined ? "." + parts[1] : ""}`;
  element.value = formatted;
}

async function loginStaff(event) {
  event?.preventDefault();

  const username = document.getElementById("login-username")?.value.trim();
  const pin = document.getElementById("login-pin")?.value.trim();
  const errorEl = document.getElementById("login-error");
  if (errorEl) errorEl.classList.add("hidden");

  if (!username || !/^\d{4}$/.test(pin || "")) {
    if (errorEl) errorEl.classList.remove("hidden");
    return;
  }

  loader(true);
  const { data: user, error } = await supabaseQuery(
    () =>
      db
        .from("staff_users")
        .select("id, username, display_name, pin, is_active, role")
        .eq("username", username)
        .eq("pin", pin)
        .eq("is_active", true)
        .single(),
    "Staff login failed",
  );
  loader(false);

  if (error || !user) {
    if (errorEl) errorEl.classList.remove("hidden");
    return;
  }

  setStaffSession(user);
  document.getElementById("login-pin").value = "";
  await initializeApplication();
  applyRoleToNav();
  navigateTo("dashboard");
}

function logoutStaff() {
  clearStaffSession();
  localStorage.removeItem("lastPage");
  // Tear the live connections down BEFORE clearing appInitialized. That flag
  // is what lets the next login re-run the whole boot sequence, and without
  // this the second login hits an already-subscribed channel and throws.
  teardownRealtimeUpdates();
  if (typeof teardownOnlineResNotify === "function") teardownOnlineResNotify();
  appInitialized = false;
  currentPage = "dashboard";
  document
    .querySelectorAll(".page-section")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById("page-dashboard")?.classList.add("active");
  document
    .querySelectorAll("[data-nav]")
    .forEach((btn) =>
      btn.classList.toggle("nav-active", btn.dataset.nav === "dashboard"),
    );
  showLoginPage();
}

function startClock() {
  const update = () => {
    const now = new Date();
    const clockEl = document.getElementById("clock");
    const dateEl = document.getElementById("clock-date");
    if (clockEl)
      clockEl.textContent = now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (dateEl)
      dateEl.textContent = now.toLocaleDateString(
        CURRENT_LANG === "id" ? "id-ID" : "en-GB",
        {
          weekday: "short",
          day: "numeric",
          month: "short",
        },
      );
  };
  update();
  setInterval(update, 30000);
}

// ============================================================
// NAVIGATION
// ============================================================
// Settings is a group of subpages sharing one sidebar entry + tab bar.
// Areas and Prizes moved here from the main nav (2026-07-21); their
// section ids and load functions are unchanged.
const SETTINGS_SUBPAGES = [
  "areas",
  "prizes",
  "settings-menu",
  "settings-thresholds",
  "settings-branding",
  "settings-staff",
];

function defaultSettingsTab() {
  const last = localStorage.getItem("lastSettingsTab");
  if (last && SETTINGS_SUBPAGES.includes(last) && hasAccess(last)) return last;
  return "areas"; // every role can see Areas
}

function navigateTo(page) {
  // "settings" resolves to the last-used (allowed) settings tab
  if (page === "settings") page = defaultSettingsTab();

  // Role enforcement: redirect unauthorized access to dashboard
  if (!hasAccess(page)) {
    toast("Access restricted. Contact a manager.", "error");
    page = "dashboard";
  }

  // Admin (owner/head-chef) sees a different dashboard section — everything
  // else renders exactly like it does for manager/staff.
  const isAdminDashboard = page === "dashboard" && currentStaffRole() === "admin";
  // "staff-dashboard" is the owner looking at the front-desk view. It is a
  // separate nav entry rather than a toggle so the sidebar highlight, the
  // browser back/forward behaviour and the lastPage restore all keep working
  // without special cases. It renders the SAME #page-dashboard section staff
  // see — there is no second copy of that markup to drift out of sync.
  const isStaffDashboardView = page === "staff-dashboard";
  const sectionId = isAdminDashboard
    ? "admin-dashboard"
    : isStaffDashboardView
      ? "dashboard"
      : page;

  document
    .querySelectorAll(".page-section")
    .forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(`page-${sectionId}`);
  if (el) el.classList.add("active");

  // Settings subpages highlight the single "Settings" sidebar entry
  const inSettings = SETTINGS_SUBPAGES.includes(page);
  const navKey = inSettings ? "settings" : page;
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("nav-active", btn.dataset.nav === navKey);
  });
  if (inSettings) {
    localStorage.setItem("lastSettingsTab", page);
    renderSettingsTabs(page);
  }

  currentPage = page;
  localStorage.setItem("lastPage", page);

  if (page === "guests") {
    guestPage = 1;
    loadGuests();
  }
  if (page === "reservations") {
    // Leaving and re-entering the page is a fresh start — a stale search
    // silently hiding the day's list is the worst failure mode here.
    clearResSearch(true);
    loadReservations();
  }
  if (page === "walkins") loadWalkIns();
  if (page === "areas") renderAreas();
  if (page === "reports") {
    loadReports();
    loadOperationsReports();
    initBirthdayView();
  }
  if (page === "prizes") loadPrizeAdmin();
  // Invoice is a self-contained document generator: no data load, but the
  // preview must be re-fitted every time the section becomes visible —
  // a hidden section has zero width, so the first fit would scale to 0.
  if (page === "invoice") initInvoice();
  // Unlike Invoice, this page reads from the database every time it is
  // opened: a voucher may have been redeemed at another till a minute
  // ago, and a stale list here is how one gets redeemed twice.
  if (page === "vouchers") initVouchers();
  if (page === "settings-menu") {
    loadFeaturedDishes();
    renderFullMenuLink();
    renderReserveAppearanceSettings();
  }
  if (page === "settings-thresholds") renderThresholdSettings();
  if (page === "settings-branding") renderBrandingSettings();
  // Always re-read from the database rather than trusting a cached list:
  // this screen is the one place where "who can log in" is decided, and a
  // stale list is how two people end up editing the same account.
  if (page === "settings-staff") loadStaffUsers();
  if (page === "membership") loadMembership();
  if (page === "broadcast") loadBroadcast();
  if (isAdminDashboard) loadAdminDashboard();
  if (isStaffDashboardView) {
    loadDashboard();
    setStaffDashboardDateLabel();
    // Banner is injected here rather than living in index.html because
    // #page-dashboard is shared with staff, who must never see it.
    renderStaffViewBanner();
  } else {
    document.getElementById("staff-view-banner")?.remove();
  }
}

// True when #page-dashboard (the front-desk view) is the section currently on
// screen — for staff/manager that is the "dashboard" page, for an admin it is
// the separate "staff-dashboard" entry. Post-action refreshes must use this
// rather than comparing currentPage to "dashboard", or an admin working in the
// staff view saves a walk-in and watches the list not update.
function isViewingStaffDashboard() {
  return (
    currentPage === "staff-dashboard" ||
    (currentPage === "dashboard" && currentStaffRole() !== "admin")
  );
}

// The front-desk dashboard's date subtitle. Extracted 2026-07-26 because it
// used to be written only during boot for non-admin roles; now that an admin
// can open this page on demand, both entry points need it or the owner sees
// an empty date under the heading.
function setStaffDashboardDateLabel() {
  const el = document.getElementById("dashboard-date-label");
  if (!el) return;
  el.textContent = new Date().toLocaleDateString(
    CURRENT_LANG === "id" ? "id-ID" : "en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );
}

// "You are looking at the front-desk view" notice, shown only when an admin
// opens the staff dashboard. Without it the owner sees a page headed
// "Dashboard" that looks nothing like their own and reasonably wonders
// whether something broke. It also warns that Quick Walk-In on this page
// writes real records — this is the live app, not a preview.
function renderStaffViewBanner() {
  const section = document.getElementById("page-dashboard");
  if (!section || document.getElementById("staff-view-banner")) return;
  const el = document.createElement("div");
  el.id = "staff-view-banner";
  el.className = "rounded-2xl px-5 py-4 mb-6 flex items-start gap-3";
  el.style.cssText = "background:#F4F8FB;border:1px solid #D7E5F2";
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
         fill="none" stroke="#2C6FA8" stroke-width="2" stroke-linecap="round"
         style="flex:none;margin-top:1px">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
    </svg>
    <div class="flex-1">
      <p class="text-sm font-semibold mb-0.5" style="color:#1F5480">${t("You are viewing the front desk dashboard")}</p>
      <p class="text-xs leading-relaxed" style="color:#3C6E96">${t("This is exactly what your staff see. Anything you save here — including Quick Walk-In — is recorded for real.")}</p>
    </div>
    <button onclick="navigateTo('dashboard')"
            class="text-xs font-semibold whitespace-nowrap px-3 py-2 rounded-lg"
            style="background:#fff;color:#1F5480;border:1px solid #C3DAEE">
      ${t("Back to my dashboard")} →
    </button>`;
  section.firstElementChild?.prepend(el);
}

// Admin dashboard — built independently from the Reports page instead of
// reusing loadReports()/loadOperationsReports(), since those are tightly
// coupled to specific report-page DOM ids and internal filter state.
// Retention definitions (new/returning/loyal/VIP thresholds, at-risk
// 60/90-day windows) are kept IDENTICAL to loadReports() on purpose, so
// the owner never sees a different "new guests" number here vs Reports.
// ══════════════════════════════════════════════════════════════
// OWNER DASHBOARD
// ══════════════════════════════════════════════════════════════
// Design intent (2026-07-26 rebuild): the previous version was eight
// equal-weight card rows, so nothing stood out and the owner had to
// read all of it to learn anything. This version answers ONE question
// at the top — "are we doing better than last period, and what needs
// me?" — then supports it with detail below.
//
// Every headline number carries a like-for-like comparison. Comparison
// windows are equal-length and phase-aligned (month-to-date vs the same
// day-range last month), never a partial period against a full one.
//
// HONESTY GUARDRAIL: visit history starts 2026-05-16. A comparison
// window that reaches back before there is real history produces
// meaningless deltas (e.g. "repeat rate up from 0%" is an artifact of
// having no earlier visits to repeat from, not an improvement). When
// that happens we render "no baseline" instead of a fake percentage.
// See adminBaselineOk().

let adminRangeKey = "mtd"; // 'week' | 'mtd' | '30d'
let adminEarliestVisitDate = null; // ISO string, cached per session

const ADMIN_ATTENTION_THRESHOLDS = {
  noShowPct: 5, // flag if > 5% of bookings no-showed
  cancelPct: 12, // flag if > 12% of bookings cancelled
  repeatRatePct: 15, // flag if repeat rate falls below this
  birthdayLookaheadDays: 7,
  atRiskDays: 90,
};

// Alias kept for readability at the dashboard call sites; ymd() in
// config.js is the single implementation.
const adminPad = ymd;

// Returns the selected window plus its phase-aligned comparison window.
//   week → Monday..today, compared to the same weekdays last week
//   mtd  → 1st..today,    compared to 1st..same day-of-month last month
//   30d  → last 30 days,  compared to the 30 days immediately before
function getAdminRange() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const to = new Date(now);

  if (adminRangeKey === "week") {
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const from = new Date(now);
    from.setDate(from.getDate() - dow);
    const prevTo = new Date(to);
    prevTo.setDate(prevTo.getDate() - 7);
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - 7);
    return { from, to, prevFrom, prevTo, unit: "week" };
  }

  if (adminRangeKey === "30d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - 29);
    return { from, to, prevFrom, prevTo, unit: "30d" };
  }

  // month to date
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayOffset = Math.round((to - from) / 86400000);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevTo = new Date(prevFrom);
  prevTo.setDate(prevTo.getDate() + dayOffset);
  // Guard: if last month is shorter (e.g. 31 Mar → 31 Feb doesn't exist),
  // Date rolls forward into the next month. Clamp to that month's last day.
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  if (prevTo > prevMonthEnd) prevTo.setTime(prevMonthEnd.getTime());
  return { from, to, prevFrom, prevTo, unit: "mtd" };
}

function setAdminRange(key) {
  adminRangeKey = key;
  ["week", "mtd", "30d"].forEach((k) => {
    const btn = document.getElementById(`admin-range-${k}`);
    if (!btn) return;
    const on = k === key;
    btn.classList.toggle("bg-white", on);
    btn.classList.toggle("text-[#28547C]", on);
    btn.classList.toggle("text-[#555]", !on);
  });
  loadAdminDashboard();
}

// True when the comparison window sits far enough after the first visit
// on record that its numbers mean something. 14 days of run-up is the
// minimum we'll trust for a period comparison.
function adminBaselineOk(prevFrom) {
  if (!adminEarliestVisitDate) return true; // unknown → don't over-suppress
  const earliest = new Date(`${adminEarliestVisitDate}T00:00:00`);
  return (prevFrom - earliest) / 86400000 >= 14;
}

// Renders the delta chip under a headline number.
//   goodUp=false inverts the colours (for no-show / cancellation style
//   metrics where a rise is bad).
function adminDeltaChip(current, previous, opts = {}) {
  const { goodUp = true, baselineOk = true, suffix = "" } = opts;

  if (!baselineOk) {
    return `<span class="text-[10px] text-[#bbb]">${t("No comparable earlier period")}</span>`;
  }
  if (previous === 0 || previous === null || previous === undefined) {
    // Dividing by zero would render "Infinity%". Say what we actually know.
    return current > 0
      ? `<span class="text-[10px] text-[#999]">${t("New — nothing to compare")}</span>`
      : `<span class="text-[10px] text-[#bbb]">${t("No change")}</span>`;
  }

  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return `<span class="text-[10px] text-[#999]">${t("Flat vs previous")}${suffix}</span>`;
  }
  const up = pct > 0;
  const good = up === goodUp;
  const colour = good ? "#2F7D5B" : "#C0392B";
  const arrow = up ? "▲" : "▼";
  return `<span class="text-[11px] font-medium" style="color:${colour}">
      ${arrow} ${Math.abs(pct)}%
    </span>
    <span class="text-[10px] text-[#bbb]">${t("vs previous")}${suffix}</span>`;
}

function setAdminHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function toggleAdminSpendTiers() {
  const body = document.getElementById("admin-spend-tiers-body");
  const chev = document.getElementById("admin-spend-chevron");
  if (!body) return;
  const open = body.classList.toggle("hidden") === false;
  if (chev) chev.style.transform = open ? "rotate(180deg)" : "";
}

// Jumps straight to the channel report the dashboard tile summarises.
function goToOpsChannelReport() {
  navigateTo("reports");
  setReportsTab("operations");
  setTimeout(() => {
    document
      .getElementById("ops-channel-block")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 250);
}

// Compact range formatter: collapses the repeated month/year so a range
// reads "1 – 26 Jul 2026" instead of "1 Jul 2026 – 26 Jul 2026". Two of these
// sit side by side in the comparison pill, so halving their length is what
// makes the comparison scannable rather than a wall of dates.
function formatRangeCompact(fromStr, toStr) {
  const locale = CURRENT_LANG === "id" ? "id-ID" : "en-GB";
  const a = new Date(`${fromStr}T00:00:00`);
  const b = new Date(`${toStr}T00:00:00`);
  if (isNaN(a) || isNaN(b)) return "—";

  const day = (d) => d.getDate();
  const mon = (d) => d.toLocaleDateString(locale, { month: "short" });
  const yr = (d) => d.getFullYear();

  if (fromStr === toStr) return `${day(a)} ${mon(a)} ${yr(a)}`;
  if (yr(a) === yr(b)) {
    return a.getMonth() === b.getMonth()
      ? `${day(a)} – ${day(b)} ${mon(b)} ${yr(b)}`
      : `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${yr(b)}`;
  }
  return `${day(a)} ${mon(a)} ${yr(a)} – ${day(b)} ${mon(b)} ${yr(b)}`;
}

// The comparison pill under the period switcher.
//
// Structure carries the meaning: current period in the primary blue and
// medium weight, an explicit "vs" chip, then the baseline period in muted
// grey. Reading left to right you cannot miss that two periods are being
// compared, which is the whole basis of every delta on the page.
function renderAdminRangePill(fromStr, toStr, prevFromStr, prevToStr) {
  const cur = formatRangeCompact(fromStr, toStr);
  const prev = formatRangeCompact(prevFromStr, prevToStr);
  setAdminHTML(
    "admin-range-label",
    `<div class="inline-flex items-center gap-2.5 rounded-full pl-3 pr-3.5 py-1.5"
          style="background:#F4F1EA;border:1px solid #E1DACB"
          title="${t("All changes on this page compare these two periods")}">
       <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="#28547C" stroke-width="2" stroke-linecap="round"
            style="flex:none">
         <rect x="3" y="4" width="18" height="18" rx="2"/>
         <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
         <line x1="3" y1="10" x2="21" y2="10"/>
       </svg>
       <span class="text-[12px] font-semibold" style="color:#28547C">${escapeHtml(cur)}</span>
       <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
             style="background:#28547C;color:#fff;letter-spacing:.06em">${t("vs")}</span>
       <span class="text-[12px] font-medium" style="color:#8A8578">${escapeHtml(prev)}</span>
     </div>`,
  );
}

async function loadAdminDashboard() {
  const { from, to, prevFrom, prevTo } = getAdminRange();
  // NAMING GUARDRAIL: never declare a local variable called "t" in this
  // file. "t" is the global translation helper from config.js, and shadowing
  // it turns every t("...") call in the same scope into a TypeError. This
  // function originally used short names (f / t / pf / pt) for the date
  // bounds; when translation was wired in on 2026-07-26 the local "t" broke
  // the entire dashboard, which sat on its loading placeholders forever.
  // Hence the deliberately verbose names below.
  const fromStr = adminPad(from),
    toStr = adminPad(to),
    prevFromStr = adminPad(prevFrom),
    prevToStr = adminPad(prevTo);
  const todayStr = adminPad(new Date());

  const dateLabel = document.getElementById("admin-dashboard-date-label");
  if (dateLabel) {
    dateLabel.textContent = new Date().toLocaleDateString(
      CURRENT_LANG === "id" ? "id-ID" : "en-US",
      { weekday: "long", year: "numeric", month: "long", day: "numeric" },
    );
  }
  renderAdminRangePill(fromStr, toStr, prevFromStr, prevToStr);

  // One batch. Every query is scoped — nothing pulls a whole table.
  const [
    periodVisitsRes,
    prevVisitsRes,
    priorGuestsRes, // guests with any visit BEFORE the current window
    priorGuestsPrevRes, // ...and before the comparison window
    periodResRes,
    lastVisitRes,
    onlineRes,
    sourceCoverageRes,
    earliestRes,
  ] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("guest_id, pax, spend_amount, visit_date")
          .is("voided_at", null)
          .gte("visit_date", fromStr)
          .lte("visit_date", toStr),
      "Failed to load dashboard period visits",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("guest_id, pax, spend_amount, visit_date")
          .is("voided_at", null)
          .gte("visit_date", prevFromStr)
          .lte("visit_date", prevToStr),
      "Failed to load dashboard comparison visits",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("guest_id")
          .is("voided_at", null)
          .lt("visit_date", fromStr),
      "Failed to load prior visit history",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("guest_id")
          .is("voided_at", null)
          .lt("visit_date", prevFromStr),
      "Failed to load prior visit history (comparison)",
    ),
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("status, pax")
          .is("deleted_at", null)
          .gte("reservation_date", fromStr)
          .lte("reservation_date", toStr),
      "Failed to load dashboard reservations",
    ),
    supabaseQuery(
      () =>
        db
          .from("guest_last_visit")
          .select("guest_id, last_visit_date")
          .order("last_visit_date", { ascending: true }),
      "Failed to load at-risk data",
    ),
    supabaseQuery(
      () =>
        db
          .from("online_reservation_performance")
          .select("reservation_id, status, arrived, spend_amount, booked_pax")
          .gte("reservation_date", fromStr)
          .lte("reservation_date", toStr),
      "Failed to load online form performance",
    ),
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("reservation_source")
          .is("deleted_at", null)
          .gte("reservation_date", fromStr)
          .lte("reservation_date", toStr),
      "Failed to load source coverage",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_date")
          .is("voided_at", null)
          .order("visit_date", { ascending: true })
          .limit(1),
      "Failed to load earliest visit",
    ),
  ]);

  adminEarliestVisitDate =
    earliestRes.data?.[0]?.visit_date || adminEarliestVisitDate;
  const baselineOk = adminBaselineOk(prevFrom);

  // ── BAND 1: the verdict ───────────────────────────────────────
  const sumSpend = (rows) =>
    (rows || []).reduce((s, v) => s + Number(v.spend_amount || 0), 0);
  const sumPax = (rows) => (rows || []).reduce((s, v) => s + (v.pax || 0), 0);

  const cur = periodVisitsRes.data || [];
  const prev = prevVisitsRes.data || [];

  const curSpend = sumSpend(cur);
  const prevSpend = sumSpend(prev);
  const curCovers = sumPax(cur);
  const prevCovers = sumPax(prev);
  // Per-cover, not per-visit: a table of 6 spending 1.2M is not a big
  // spender, it's six average ones. Guard against /0 on an empty period.
  const curAvg = curCovers ? Math.round(curSpend / curCovers) : 0;
  const prevAvg = prevCovers ? Math.round(prevSpend / prevCovers) : 0;

  setText("admin-kpi-spend", fmt.currency(curSpend));
  setAdminHTML(
    "admin-kpi-spend-delta",
    adminDeltaChip(curSpend, prevSpend, { baselineOk }),
  );
  setText("admin-kpi-covers", curCovers.toLocaleString("id-ID"));
  setAdminHTML(
    "admin-kpi-covers-delta",
    adminDeltaChip(curCovers, prevCovers, { baselineOk }),
  );
  setText("admin-kpi-avg", fmt.currency(curAvg));
  setAdminHTML(
    "admin-kpi-avg-delta",
    adminDeltaChip(curAvg, prevAvg, { baselineOk }),
  );

  // Repeat rate = of the distinct guests who came in this window, what
  // share had ALREADY visited us at some point before the window opened.
  // This is the number that tells the owner whether the restaurant is
  // building a base or just churning through first-timers.
  const priorSet = new Set(
    (priorGuestsRes.data || []).map((r) => r.guest_id).filter(Boolean),
  );
  const priorSetPrev = new Set(
    (priorGuestsPrevRes.data || []).map((r) => r.guest_id).filter(Boolean),
  );
  const repeatRate = (rows, prior) => {
    const guests = new Set(
      (rows || []).map((v) => v.guest_id).filter(Boolean),
    );
    if (!guests.size) return { pct: 0, repeat: 0, total: 0 };
    let repeat = 0;
    guests.forEach((id) => {
      if (prior.has(id)) repeat += 1;
    });
    return {
      pct: Math.round((repeat / guests.size) * 100),
      repeat,
      total: guests.size,
    };
  };
  const curRepeat = repeatRate(cur, priorSet);
  const prevRepeat = repeatRate(prev, priorSetPrev);

  // Of the first-timers this period, how many have NOT come back?
  // total - repeat gives everyone whose first visit was in the period, but
  // some of those already returned within it — they are a success, not an
  // outreach target, and calling them "belum kembali" is simply false.
  // Rere caught this on 2026-07-26 via a 2-visit guest in the Broadcast list.
  // Must stay in lockstep with bcIsFirstTimer() in broadcast.js, including
  // the same-day rule: two visits on one day is not a return visit.
  const periodSpan = new Map(); // guest_id -> {first, last} within the period
  cur.forEach((v) => {
    if (!v.guest_id || !v.visit_date) return;
    const e = periodSpan.get(v.guest_id);
    if (!e) periodSpan.set(v.guest_id, { first: v.visit_date, last: v.visit_date });
    else {
      if (v.visit_date < e.first) e.first = v.visit_date;
      if (v.visit_date > e.last) e.last = v.visit_date;
    }
  });
  let newNotReturned = 0;
  periodSpan.forEach((span, id) => {
    if (priorSet.has(id)) return; // not a first-timer
    if (span.last === span.first) newNotReturned += 1;
  });

  setText("admin-kpi-repeat", `${curRepeat.pct}%`);
  setAdminHTML(
    "admin-kpi-repeat-delta",
    `<span class="text-[10px] text-[#999] block">${curRepeat.repeat} ${t("of")} ${curRepeat.total} ${t("guests had been before")}</span>
     ${adminDeltaChip(curRepeat.pct, prevRepeat.pct, { baselineOk })}`,
  );

  setText(
    "admin-kpi-footnote",
    t(
      "Spend is recorded per visit at checkout — treat as guest spend, not audited revenue. Voided visits and deleted bookings are excluded throughout.",
    ),
  );

  // ── BAND 2: needs your attention ──────────────────────────────
  const attention = [];
  const bookings = periodResRes.data || [];
  const totalBookings = bookings.length;
  const noShows = bookings.filter(
    (r) => r.status === "Cancelled (No Show)" || r.status === "No Show",
  );
  const cancels = bookings.filter((r) => r.status === "Cancelled");
  const noShowPct = totalBookings
    ? Math.round((noShows.length / totalBookings) * 100)
    : 0;
  const cancelPct = totalBookings
    ? Math.round((cancels.length / totalBookings) * 100)
    : 0;

  if (noShowPct > ADMIN_ATTENTION_THRESHOLDS.noShowPct) {
    const lostPax = noShows.reduce((s, r) => s + (r.pax || 0), 0);
    attention.push({
      tone: "bad",
      metric: `${noShowPct}%`,
      text: `${t("No-show rate")} — ${noShows.length} ${t("bookings")}, ${lostPax} ${t("pax of unsold covers")}`,
      action: { label: t("See bookings"), fn: "navigateTo('reservations')" },
    });
  }
  if (cancelPct > ADMIN_ATTENTION_THRESHOLDS.cancelPct) {
    attention.push({
      tone: "warn",
      metric: `${cancelPct}%`,
      text: `${t("Cancellation rate")} — ${cancels.length} ${t("of")} ${totalBookings} ${t("bookings")}`,
      action: { label: t("See bookings"), fn: "navigateTo('reservations')" },
    });
  }
  if (
    curRepeat.total >= 20 &&
    curRepeat.pct < ADMIN_ATTENTION_THRESHOLDS.repeatRatePct
  ) {
    attention.push({
      tone: "warn",
      metric: `${curRepeat.pct}%`,
      text: `${t("of guests had visited before")} — ${newNotReturned} ${t("first-time guests have not come back")}`,
      // Hands the exact same population to Broadcast rather than dropping
      // the user on an unfiltered guest list. The date window is passed so
      // the list length matches the number shown on this card.
      action: {
        label: t("Plan outreach"),
        fn: `bcOpenFirstTimers('${fromStr}','${toStr}')`,
      },
    });
  }

  // At-risk HIGH SPENDERS specifically. "300 guests haven'toStr been back"
  // is not actionable; "6 of your best guests have gone quiet" is.
  const atRiskCut = new Date();
  atRiskCut.setDate(
    atRiskCut.getDate() - ADMIN_ATTENTION_THRESHOLDS.atRiskDays,
  );
  const atRiskIds = (lastVisitRes.data || [])
    .filter((g) => new Date(`${g.last_visit_date}T00:00:00`) < atRiskCut)
    .map((g) => g.guest_id);

  if (atRiskIds.length) {
    // Only ask the DB about the guests we already know are quiet, and only
    // for the tier we care about — keeps this cheap as the guest list grows.
    const { data: quietVips } = await supabaseQuery(
      () =>
        db
          .from("guests")
          .select("id, name")
          .eq("spending_tier", "high_spender")
          .in("id", atRiskIds.slice(0, 500)),
      "Failed to load at-risk high spenders",
    );
    if (quietVips?.length) {
      attention.push({
        tone: "bad",
        metric: `${quietVips.length}`,
        text: `${t("high spenders not seen in")} ${ADMIN_ATTENTION_THRESHOLDS.atRiskDays}+ ${t("days")} — ${quietVips
          .slice(0, 3)
          .map((g) => formatGuestName(g))
          .join(", ")}${quietVips.length > 3 ? ` +${quietVips.length - 3} ${t("more")}` : ""}`,
        action: { label: t("Win them back"), fn: "navigateTo('broadcast')" },
      });
    }
    attention.push({
      tone: "info",
      metric: `${atRiskIds.length}`,
      text: `${t("guests in total have not visited in")} ${ADMIN_ATTENTION_THRESHOLDS.atRiskDays}+ ${t("days")}`,
      action: { label: t("Open reports"), fn: "navigateTo('reports')" },
    });
  }

  // Birthdays inside the actionable window (next 7 days), not "this month"
  // — a birthday 3 weeks out is not something to act on today.
  const { data: bdays } = await supabaseQuery(
    () =>
      db.from("guests").select("name, phone, birthday").not("birthday", "is", null),
    "Failed to load birthdays",
  );
  const soon = (bdays || []).filter((g) => {
    const d = new Date(`${g.birthday}T00:00:00`);
    if (isNaN(d)) return false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    // Compare month/day only, and handle the year-end wrap (Dec 28 → Jan 3).
    const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    if (next < now) next.setFullYear(next.getFullYear() + 1);
    const days = Math.round((next - now) / 86400000);
    return days <= ADMIN_ATTENTION_THRESHOLDS.birthdayLookaheadDays;
  });
  if (soon.length) {
    attention.push({
      tone: "good",
      metric: `${soon.length}`,
      text: `${t("guest birthdays in the next")} ${ADMIN_ATTENTION_THRESHOLDS.birthdayLookaheadDays} ${t("days")} — ${soon
        .slice(0, 3)
        .map((g) => formatGuestName(g))
        .join(", ")}${soon.length > 3 ? ` +${soon.length - 3} ${t("more")}` : ""}`,
      action: { label: t("Send greetings"), fn: "navigateTo('broadcast')" },
    });
  }

  renderAdminAttention(attention);

  // ── BAND 4: online form tile ──────────────────────────────────
  const online = onlineRes.data || [];
  const onlineBookings = new Set(online.map((r) => r.reservation_id)).size;
  const onlineArrived = online.filter((r) => r.arrived).length;
  const onlineSpend = online.reduce(
    (s, r) => s + Number(r.spend_amount || 0),
    0,
  );
  const onlineConv = onlineBookings
    ? Math.round((onlineArrived / onlineBookings) * 100)
    : 0;

  setAdminHTML(
    "admin-online-summary",
    onlineBookings
      ? `<span class="font-semibold text-[#28547C]">${onlineBookings}</span> ${t("bookings")}
         · <span class="font-semibold text-[#28547C]">${onlineArrived}</span> ${t("showed up")} (${onlineConv}%)
         · <span class="font-semibold text-[#28547C]">${fmt.currency(onlineSpend)}</span> ${t("spend")}`
      : `<span class="text-[#999]">${t("No online form bookings in this period")}</span>`,
  );

  // Coverage warning. reservation_source is optional, so a channel
  // percentage computed over all bookings would understate every channel.
  // Say plainly how much of the denominator is unknown.
  const srcRows = sourceCoverageRes.data || [];
  const known = srcRows.filter((r) => (r.reservation_source || "").trim()).length;
  setText(
    "admin-source-coverage",
    srcRows.length
      ? `${t("Booking source recorded for")} ${known} ${t("of")} ${srcRows.length} ${t("bookings")} (${Math.round((known / srcRows.length) * 100)}%). ${t("Channel shares reflect recorded bookings only.")}`
      : t("No bookings in this period."),
  );

  await loadAdminTraffic();
  await loadAdminSpendSegments();
  await loadAdminBirthdays();
}

// Renders the attention list.
//
// Two deliberate choices, both from Rere's 2026-07-26 feedback that the
// band was too easy to scroll past:
//
// 1. METRIC FIRST. Each item leads with its number at 22px in the severity
//    colour, then the sentence explains it. "16% — Cancellation rate" is
//    scannable in a way that a paragraph containing "16%" is not.
// 2. SEVERITY DRIVES THE WHOLE CARD. The top rule, header tint and header
//    icon all take the worst item's colour, so the block is visually loud
//    only when something is actually wrong. An all-clear state goes calm
//    green — that keeps the loudness meaningful instead of decorative.
//
// Every string here goes through t() so ID_DICT/ID_DICT_PATTERNS can
// translate it; the numbers are interpolated OUTSIDE the translated text
// wherever possible so the dictionary keys stay static and exact-matchable.
function renderAdminAttention(items) {
  const el = document.getElementById("admin-attention-list");
  const headerEl = document.getElementById("admin-attention-header");
  const cardEl = document.getElementById("admin-attention-card");
  if (!el) return;

  const TONES = {
    bad: { key: "#C0392B", bg: "#FDF3F2", head: "#FBE3E1", text: "#8E2A20" },
    warn: { key: "#BA7517", bg: "#FCF8F0", head: "#F9EFD9", text: "#7A4B0C" },
    info: { key: "#2C6FA8", bg: "#F4F8FB", head: "#E4EEF7", text: "#1F5480" },
    good: { key: "#2F7D5B", bg: "#F3F9F5", head: "#E3F1E9", text: "#1F5C41" },
  };
  const ICONS = {
    // alert-triangle
    bad: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    // alert-circle
    warn: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    // info
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    // gift
    good: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/>',
  };
  const svg = (tone, size, colour) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none">${ICONS[tone]}</svg>`;

  // Worst first — the owner should never have to hunt for the bad news.
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  const sorted = [...items].sort((a, b) => order[a.tone] - order[b.tone]);

  // Actionable = anything that is not merely informational or celebratory.
  const actionable = sorted.filter((i) => i.tone === "bad" || i.tone === "warn");
  const worst = sorted.length ? TONES[sorted[0].tone] || TONES.info : TONES.good;
  const worstTone = sorted.length ? sorted[0].tone : "good";

  setText("admin-attention-count", "");
  if (cardEl) cardEl.style.borderTopColor = worst.key;

  // ── Header: icon + title + count pill, all in the severity colour ──
  if (headerEl) {
    const countLabel = actionable.length
      ? `${actionable.length} ${actionable.length === 1 ? t("item needs action") : t("items need action")}`
      : t("All clear");
    headerEl.className =
      "flex items-center gap-2.5 px-5 py-3.5 mb-1 rounded-t-xl";
    headerEl.style.background = worst.head;
    headerEl.innerHTML = `
      ${svg(worstTone, 19, worst.key)}
      <span class="font-display text-base font-semibold" style="color:${worst.text}">${t("Needs Your Attention")}</span>
      <span class="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style="background:${worst.key};color:#fff;letter-spacing:.02em">${countLabel}</span>`;
  }

  if (!sorted.length) {
    el.innerHTML = `
      <div class="flex items-start gap-3 px-4 py-4 rounded-xl" style="background:${TONES.good.bg}">
        ${svg("good", 18, TONES.good.key)}
        <p class="text-sm leading-snug" style="color:${TONES.good.text}">${t("Nothing needs action right now — no no-shows, no regulars gone quiet, no birthdays this week.")}</p>
      </div>`;
    return;
  }

  el.innerHTML = sorted
    .map((it) => {
      const tone = TONES[it.tone] || TONES.info;
      return `
      <div class="flex items-center gap-3.5 px-4 py-3.5 mb-1.5 last:mb-0"
           style="background:${tone.bg};border-left:3px solid ${tone.key};border-radius:0 12px 12px 0">
        ${svg(it.tone, 18, tone.key)}
        ${
          it.metric
            ? `<span class="font-display font-semibold leading-none" style="color:${tone.key};font-size:22px;flex:none;min-width:2.5rem">${it.metric}</span>`
            : ""
        }
        <p class="text-[13px] flex-1 leading-snug" style="color:${tone.text}">${it.text}</p>
        ${
          it.action
            ? `<button onclick="${it.action.fn}"
                 class="text-[11px] font-semibold whitespace-nowrap px-3 py-2 rounded-lg transition-colors"
                 style="background:#fff;color:${tone.text};border:1px solid ${tone.key}33">${it.action.label} →</button>`
            : ""
        }
      </div>`;
    })
    .join("");
}

// Birthdays this month — sorted by day, phone shown for quick outreach
// (per Rere's call: this-month window + phone number visible).
async function loadAdminBirthdays() {
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("guests")
        // `id` added 2026-08-23: the follow-up tick is keyed by guest id, and
        // this is the only birthday query an admin's session runs (the
        // front-desk dashboard is skipped at boot for admins to save egress),
        // so without it the owner's birthday badge never lights up.
        .select("id, name, phone, birthday")
        .not("birthday", "is", null),
    "Failed to load admin dashboard birthdays",
  );
  const listEl = document.getElementById("admin-birthdays-list");
  if (!listEl) return;
  if (error) {
    listEl.innerHTML = '<p class="text-[#bbb]">Couldn\'t load birthdays</p>';
    return;
  }

  const now = new Date();
  const thisMonth = now.getMonth();
  const matches = (data || [])
    .filter((g) => {
      const d = new Date(`${g.birthday}T00:00:00`);
      return !isNaN(d) && d.getMonth() === thisMonth;
    })
    .map((g) => ({
      ...g,
      day: new Date(`${g.birthday}T00:00:00`).getDate(),
    }))
    .sort((a, b) => a.day - b.day);

  // Feeds the birthday badge for the OWNER. Her session skips the front-desk
  // dashboard at boot (see initializeApplication), so this is the only
  // birthday query she runs and without it her bell stays dark all day —
  // which would make the notification useless to the person who asked for it.
  const year = now.getFullYear();
  await loadBirthdayGreetings(matches.map((g) => g.id), year);
  computeBirthdayAlerts(data, thisMonth + 1, year);

  listEl.innerHTML = matches.length
    ? matches
        .map((g) => {
          const greeted = isBirthdayGreeted(g.id, year);
          return `
      <div class="flex justify-between items-center gap-3 py-1.5 border-b border-[#F2EFE9] last:border-0 ${greeted ? "opacity-60" : ""}">
        <span class="min-w-0 truncate">${formatGuestName(g)} <span class="text-[#999] text-xs">— ${monthNameLong(thisMonth + 1).slice(0, 3)} ${g.day}</span></span>
        <span class="flex items-center gap-2 shrink-0">
          <span class="text-[#999] text-xs">${escapeHtml(g.phone || "—")}</span>
          ${birthdayFollowUpControls(g, year, "admin")}
        </span>
      </div>`;
        })
        .join("")
    : '<p class="text-[#bbb]">No birthdays this month</p>';
}

// ── Spend segments + top guests ──────────────────────────────────
// Thresholds (300k/person avg, 1jt total) match the existing Walk-in
// Insights report exactly, per Rere's call to reuse them as-is. "Medium"
// is tier-based (guests.spending_tier === 'medium_spender', DB-computed by
// triggers), "High" is threshold-based on the aggregated numbers below —
// same split the Walk-in Insights page uses.
let adminSpendData = { month: null, all: null };
let adminSpendPeriod = "month";
let adminSpendTier = "medium";

async function loadAdminSpendSegments() {
  const pad = ymd;
  const now = new Date();
  const monthStart = pad(new Date(now.getFullYear(), now.getMonth(), 1));
  const todayStr = pad(now);

  const baseQuery = () =>
    db
      .from("visits")
      .select(
        "guest_id, spend_amount, pax, visit_date, guests(name, phone, spending_tier)",
      )
      .eq("status", "Done")
      .is("voided_at", null);

  const [monthResult, allResult] = await Promise.all([
    supabaseQuery(
      () => baseQuery().gte("visit_date", monthStart).lte("visit_date", todayStr),
      "Failed to load admin spend segments (month)",
    ),
    supabaseQuery(
      () => baseQuery(),
      "Failed to load admin spend segments (all-time)",
    ),
  ]);

  adminSpendData.month = monthResult.error ? [] : monthResult.data || [];
  adminSpendData.all = allResult.error ? [] : allResult.data || [];
  renderAdminSpendSegments();
}

function aggregateGuestSpend(rows) {
  const map = new Map();
  (rows || []).forEach((v) => {
    if (!v.guest_id) return;
    const g = v.guests || {};
    const entry =
      map.get(v.guest_id) ||
      {
        name: g.name || "Unknown",
        phone: g.phone || "",
        spendingTier: g.spending_tier || null,
        totalSpend: 0,
        totalPax: 0,
        visitCount: 0,
      };
    entry.totalSpend += Number(v.spend_amount || 0);
    entry.totalPax += Number(v.pax || 0);
    entry.visitCount += 1;
    map.set(v.guest_id, entry);
  });
  return Array.from(map.values()).map((e) => ({
    ...e,
    avgSpendPerPerson: e.totalPax ? Math.round(e.totalSpend / e.totalPax) : 0,
  }));
}

function setAdminSpendTier(tier) {
  adminSpendTier = tier;
  document
    .getElementById("admin-tier-tab-medium")
    ?.classList.toggle("bg-[#5596CE]", tier === "medium");
  document
    .getElementById("admin-tier-tab-medium")
    ?.classList.toggle("bg-[#F8F6F2]", tier !== "medium");
  document
    .getElementById("admin-tier-tab-medium")
    ?.classList.toggle("text-white", tier === "medium");
  document
    .getElementById("admin-tier-tab-medium")
    ?.classList.toggle("text-[#5596CE]", tier !== "medium");
  document
    .getElementById("admin-tier-tab-high")
    ?.classList.toggle("bg-[#5596CE]", tier === "high");
  document
    .getElementById("admin-tier-tab-high")
    ?.classList.toggle("bg-[#F8F6F2]", tier !== "high");
  document
    .getElementById("admin-tier-tab-high")
    ?.classList.toggle("text-white", tier === "high");
  document
    .getElementById("admin-tier-tab-high")
    ?.classList.toggle("text-[#5596CE]", tier !== "high");
  renderAdminSpendSegments();
}

function setAdminSpendPeriod(period) {
  adminSpendPeriod = period;
  renderAdminSpendSegments();
}

function renderAdminSpendSegments() {
  const rows = adminSpendData[adminSpendPeriod] || [];
  const guests = aggregateGuestSpend(rows);
  const isMedium = adminSpendTier === "medium";

  const byAvg = guests
    .filter((g) =>
      isMedium
        ? g.spendingTier === "medium_spender"
        : g.totalPax > 0 && g.avgSpendPerPerson > HIGH_SPEND_PER_PAX,
    )
    .sort((a, b) => b.avgSpendPerPerson - a.avgSpendPerPerson);

  const byTotal = guests
    .filter((g) =>
      isMedium
        ? g.spendingTier === "medium_spender"
        : g.totalSpend >= HIGH_SPEND_THRESHOLD,
    )
    .sort((a, b) => b.totalSpend - a.totalSpend);

  // Titles/descriptions use the EXACT same strings as the Reports page so
  // the existing ID_DICT entries translate them — do not reword casually.
  setText(
    "admin-spend-a-title",
    isMedium ? "Medium Average Spend Per Person" : "High Average Spend Per Person",
  );
  setText(
    "admin-spend-a-desc",
    isMedium
      ? "Completed walk-ins from medium spender guests, ranked by average spend per guest"
      : `Groups spending more than Rp ${HIGH_SPEND_PER_PAX.toLocaleString("id-ID")} per guest`,
  );
  setText("admin-spend-a-count", byAvg.length);
  setText(
    "admin-spend-a-highest",
    fmt.currency(byAvg.length ? byAvg[0].avgSpendPerPerson : 0),
  );
  setText(
    "admin-spend-a-avg",
    fmt.currency(
      byAvg.length
        ? Math.round(byAvg.reduce((s, g) => s + g.avgSpendPerPerson, 0) / byAvg.length)
        : 0,
    ),
  );
  setText(
    "admin-spend-a-revenue",
    fmt.currency(byAvg.reduce((s, g) => s + g.totalSpend, 0)),
  );

  setText(
    "admin-spend-b-title",
    isMedium ? "Medium Total Spending" : "High Total Spending",
  );
  setText(
    "admin-spend-b-desc",
    isMedium
      ? "Completed walk-ins from medium spender guests, ranked by total spend"
      : `Groups with total spend of Rp ${HIGH_SPEND_THRESHOLD.toLocaleString("id-ID")} or more`,
  );
  setText("admin-spend-b-count", byTotal.length);
  setText(
    "admin-spend-b-highest",
    fmt.currency(byTotal.length ? byTotal[0].totalSpend : 0),
  );
  setText(
    "admin-spend-b-avg",
    fmt.currency(
      byTotal.length
        ? Math.round(byTotal.reduce((s, g) => s + g.totalSpend, 0) / byTotal.length)
        : 0,
    ),
  );
  setText(
    "admin-spend-b-revenue",
    fmt.currency(byTotal.reduce((s, g) => s + g.totalSpend, 0)),
  );

  // Top guests — independent of the medium/high tab, just overall ranking
  const topSpenders = [...guests]
    .filter((g) => g.totalSpend > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 5);
  const topVisitors = [...guests]
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, 5);

  // Make the counting window explicit — "2 kunjungan" here vs "6 visits" in
  // the guest DB confused the owner once: these cards follow the period
  // dropdown and count only completed (Done), non-voided visits.
  const isID = typeof CURRENT_LANG !== "undefined" && CURRENT_LANG === "id";
  const periodLabel =
    adminSpendPeriod === "month"
      ? isID ? "Bulan ini · hanya kunjungan selesai" : "This month · completed visits only"
      : isID ? "Semua waktu · hanya kunjungan selesai" : "All time · completed visits only";
  setText("admin-top-spenders-period", periodLabel);
  setText("admin-top-visitors-period", periodLabel);

  const spendersEl = document.getElementById("admin-top-spenders");
  if (spendersEl) {
    spendersEl.innerHTML = topSpenders.length
      ? topSpenders
          .map(
            (g) => `
        <div class="flex justify-between items-center py-1 border-b border-[#F2EFE9] last:border-0">
          <span>${formatGuestName(g)}</span>
          <span class="text-[#999] text-xs">${fmt.currency(g.totalSpend)} · ${g.visitCount} visit${g.visitCount !== 1 ? "s" : ""}</span>
        </div>`,
          )
          .join("")
      : '<p class="text-[#bbb]">No data for this period</p>';
  }

  const visitorsEl = document.getElementById("admin-top-visitors");
  if (visitorsEl) {
    visitorsEl.innerHTML = topVisitors.length
      ? topVisitors
          .map(
            (g) => `
        <div class="flex justify-between items-center py-1 border-b border-[#F2EFE9] last:border-0">
          <span>${formatGuestName(g)}</span>
          <span class="text-[#999] text-xs">${g.visitCount} visit${g.visitCount !== 1 ? "s" : ""} · ${fmt.currency(g.totalSpend)}</span>
        </div>`,
          )
          .join("")
      : '<p class="text-[#bbb]">No data for this period</p>';
  }
}

// Live today snapshot + 7-day forecast + 14-day peak traffic — one shared
// reservations query covers all three (today-7 .. today+6), same window
// convention as Reports > Operations > Peak Traffic's default range.
async function loadAdminTraffic() {
  const pad = ymd;
  const now = new Date();
  const todayStr = pad(now);
  // This one fetch feeds three things with different appetites:
  //   - peak traffic chart → PEAK_DAYS_BACK back .. PEAK_DAYS_AHEAD ahead
  //   - "next 7 days" strip → today .. today+6
  //   - today's cards      → today only
  // So fetch the UNION of all three and let each consumer slice it. Fetching
  // less than the chart's window is what produces phantom empty columns
  // (the 18 Jul bug); the extra rows here cost nothing at this data volume.
  const winStart = new Date(now);
  winStart.setDate(winStart.getDate() - PEAK_DAYS_BACK);
  const winEnd = new Date(now);
  winEnd.setDate(winEnd.getDate() + Math.max(PEAK_DAYS_AHEAD, 6));
  const from = pad(winStart);
  const to = pad(winEnd);

  const [resResult, walkInResult] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("reservation_date, pax, status")
          .gte("reservation_date", from)
          .lte("reservation_date", to),
      "Failed to load admin dashboard traffic",
    ),
    // All visit types, not just walk-ins: the peak-traffic chart needs
    // walk-ins only, but the "Today" band needs walk-in pax AND total
    // spend across every visit closed out today. One query serves both.
    // voided_at filter added 2026-07-26 — mis-entered walk-ins were
    // previously inflating the peak-traffic bars.
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_date, visit_type, pax, spend_amount, status")
          .is("voided_at", null)
          .gte("visit_date", from)
          .lte("visit_date", to),
      "Failed to load admin dashboard walk-ins",
    ),
  ]);

  if (resResult.error || walkInResult.error) return;

  const reservations = resResult.data || [];
  const allVisits = walkInResult.data || [];
  // renderOpsPeakTraffic counts walk-in rows, so keep that list walk-in only.
  const walkIns = allVisits.filter((v) => v.visit_type === "Walk-In");

  // Active = not cancelled and not a no-show — same definition used
  // throughout Reports/Operations.
  const activeByDate = {};
  const activePaxByDate = {};
  const cancelledByDate = {};
  const cancelledPaxByDate = {};
  reservations.forEach((r) => {
    const d = r.reservation_date;
    const isCancelledPlain = r.status === "Cancelled";
    const isNoShow = r.status === "Cancelled (No Show)";
    if (!isCancelledPlain && !isNoShow) {
      activeByDate[d] = (activeByDate[d] || 0) + 1;
      activePaxByDate[d] = (activePaxByDate[d] || 0) + (r.pax || 0);
    } else if (isCancelledPlain) {
      cancelledByDate[d] = (cancelledByDate[d] || 0) + 1;
      cancelledPaxByDate[d] = (cancelledPaxByDate[d] || 0) + (r.pax || 0);
    }
  });
  const walkInByDate = {};
  walkIns.forEach((w) => {
    const d = (w.visit_date || "").slice(0, 10);
    walkInByDate[d] = (walkInByDate[d] || 0) + 1;
  });

  // Today — walk-ins seated and money taken so far.
  // Spend counts EVERY visit type closed out today (walk-in + reservation
  // arrivals), because the owner asking "how much have we made today" does
  // not care how the guest got in. Still-seated tables have no spend yet,
  // so the subline says how many are already closed out — otherwise the
  // number looks wrong to anyone standing in a full dining room.
  const todaysVisits = allVisits.filter(
    (v) => (v.visit_date || "").slice(0, 10) === todayStr,
  );
  const todayWalkIns = todaysVisits.filter((v) => v.visit_type === "Walk-In");
  const todaySpend = todaysVisits.reduce(
    (s, v) => s + Number(v.spend_amount || 0),
    0,
  );
  const todayClosed = todaysVisits.filter((v) => Number(v.spend_amount) > 0)
    .length;

  setText("admin-today-walkin-count", todayWalkIns.length);
  setText(
    "admin-today-walkin-pax",
    `${todayWalkIns.reduce((s, v) => s + (v.pax || 0), 0)} ${t("pax seated")}`,
  );
  setText("admin-today-spend", todaySpend ? fmt.currency(todaySpend) : "Rp 0");
  setText(
    "admin-today-spend-sub",
    todaysVisits.length
      ? `${todayClosed} ${t("of")} ${todaysVisits.length} ${t("visits closed out")}`
      : t("No visits recorded yet"),
  );

  // Live — today
  setText("admin-today-res-count", activeByDate[todayStr] || 0);
  setText(
    "admin-today-res-pax",
    `${activePaxByDate[todayStr] || 0} pax expected`,
  );
  setText("admin-today-cancel-count", cancelledByDate[todayStr] || 0);
  setText(
    "admin-today-cancel-pax",
    `${cancelledPaxByDate[todayStr] || 0} pax released`,
  );

  // Next 7 days strip (today .. today+6)
  const stripEl = document.getElementById("admin-7day-strip");
  if (stripEl) {
    let html = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const key = pad(d);
      const label = d.toLocaleDateString(
        CURRENT_LANG === "id" ? "id-ID" : "en-GB",
        { weekday: "short", day: "numeric" },
      );
      const count = activeByDate[key] || 0;
      const pax = activePaxByDate[key] || 0;
      html += `
        <div class="text-center border border-[#EDE9E3] rounded-lg py-2 px-1">
          <p class="text-[10px] text-[#999]">${label}</p>
          <p class="font-display text-lg font-semibold text-[#28547C]">${count}</p>
          <p class="text-[10px] text-[#999]">${pax} pax</p>
        </div>`;
    }
    stripEl.innerHTML = html;
  }

  // 14-day peak traffic chart — reuses the Reports page renderer (same
  // bars, count labels, weekday labels, and peak legend) pointed at the
  // admin containers. peakStartDate is a Reports-page global (custom
  // window picker); pin the admin chart to the default today-7..today+6
  // window so a custom window chosen on Reports never skews this chart
  // against the data we actually fetched.
  const savedPeakStart = peakStartDate;
  peakStartDate = null;
  renderOpsPeakTraffic(
    reservations.filter(
      (r) => !["Cancelled", "Cancelled (No Show)"].includes(r.status),
    ),
    walkIns,
    {
      peakDay: "admin-peak-day",
      bars: "admin-peak-bars",
      legend: "admin-peak-legend",
    },
  );
  peakStartDate = savedPeakStart;
}

// Small helper — sets textContent only if the element exists, since admin
// dashboard elements only render for the admin role.
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ============================================================
// Natural sort helper — sorts "M2" before "M10", "O1" before "O2", etc.
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// AREA MANAGEMENT
// ============================================================
async function loadAreas() {
  const { data, error } = await supabaseQuery(
    () => db.from("areas").select("*").order("name"),
    "Failed to load areas",
  );
  if (error) return;
  allAreas = data || [];
}

async function loadTables() {
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("tables")
        .select("id, name, area_id, capacity, description, is_active")
        .order("name"),
    "Failed to load tables",
  );
  if (error) return;
  allTables = (data || []).sort((a, b) => naturalSort(a.name, b.name));
}

function populateAreaSelects() {
  const selects = ["wi-area", "res-area"];
  selects.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">No preference</option>';
    allAreas.forEach((a) => {
      el.innerHTML += `<option value="${a.id}">${a.name}</option>`;
    });
  });
}

function populateTableAreaSelects() {
  const el = document.getElementById("table-area");
  if (!el) return;
  el.innerHTML = '<option value="">Select area</option>';
  allAreas.forEach((a) => {
    el.innerHTML += `<option value="${a.id}">${escapeHtml(a.name)}</option>`;
  });
}

function getTableById(id) {
  return allTables.find((t) => t.id === id) || null;
}

// Fetch currently occupied table IDs for today (active visits + arrived reservations).
// Excludes the record being edited (selfId) so its own table doesn't show as occupied.
async function fetchOccupiedTableIds(selfId = null, selfType = "visit") {
  const occupiedIds = new Set();

  const { data: activeVisits } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("id, table_id")
        .eq("visit_date", TODAY)
        .neq("status", "Done")
        .not("table_id", "is", null)
        .is("voided_at", null),
    "Failed to fetch occupied tables",
  );
  (activeVisits || []).forEach((v) => {
    if (v.table_id && !(selfType === "visit" && v.id === selfId)) {
      occupiedIds.add(v.table_id);
    }
  });

  const { data: arrivedRes } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("id, table_id")
        .eq("reservation_date", TODAY)
        .eq("status", "Arrived")
        .not("table_id", "is", null),
    "Failed to fetch arrived reservations",
  );
  (arrivedRes || []).forEach((r) => {
    if (r.table_id && !(selfType === "reservation" && r.id === selfId)) {
      occupiedIds.add(r.table_id);
    }
  });

  return occupiedIds;
}

// Re-evaluates table occupancy for the reservation modal based on the
// chosen DATE. Called on modal open and whenever res-date changes.
async function refreshResTableOccupancy() {
  const targetDate = document.getElementById("res-date")?.value || TODAY;
  const selfId = document.getElementById("res-edit-id")?.value || null;
  const selectedId = document.getElementById("res-table-id")?.value || "";

  if (targetDate !== TODAY) {
    // Future (or past) date: nobody is physically at a table on that date,
    // so all tables are selectable. Double-booking a future date is left
    // to staff judgment, same as before.
    tablePickerContext["res"] = { skipOccupancy: true, occupiedIds: new Set() };
    renderTableSelection("res", selectedId);
    updateResVipTimeRange();
    return;
  }

  tablePickerContext["res"] = { skipOccupancy: false, occupiedIds: new Set() };
  renderTableSelection("res", selectedId);
  const ids = await fetchOccupiedTableIds(selfId, "reservation");
  tablePickerContext["res"] = { skipOccupancy: false, occupiedIds: ids };
  renderTableSelection("res", document.getElementById("res-table-id").value);
  updateResVipTimeRange();
}

function renderTableSelection(prefix, selectedId = "") {
  const container = document.getElementById(`${prefix}-table-picker`);
  const hiddenInput = document.getElementById(`${prefix}-table-id`);
  const areaSelect = document.getElementById(`${prefix}-area`);
  if (!container || !hiddenInput || !areaSelect) return;

  selectedId = selectedId || hiddenInput.value || "";

  // Read occupancy context stored for this prefix
  const ctx = tablePickerContext[prefix] || {};
  const occupiedIds = ctx.occupiedIds || new Set();
  const skipOccupancy = ctx.skipOccupancy || false;

  const tablesToShow = allTables.filter(
    (t) => t.is_active || t.id === selectedId,
  );
  const rows = allAreas
    .map((area) => {
      const groupTables = tablesToShow.filter((t) => t.area_id === area.id);
      if (!groupTables.length) return "";

      return `
      <div class="mb-4">
        <p class="text-xs text-[#555] font-semibold mb-2">${escapeHtml(area.name)}</p>
        <div class="flex flex-wrap gap-2">
          ${groupTables
            .map((table) => {
              const isSelected = table.id === selectedId;
              const inactive = !table.is_active;
              const isOccupied =
                !skipOccupancy && !isSelected && occupiedIds.has(table.id);
              const btnClass = isSelected
                ? "bg-[#28547C] text-white border border-[#28547C]"
                : inactive
                  ? "bg-[#F5F3F0] text-[#999] border border-[#E2DFDA] cursor-not-allowed"
                  : isOccupied
                    ? "bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] cursor-not-allowed"
                    : "bg-[#F8F6F2] text-[#555] border border-[#E6E2DC] hover:bg-[#EEF3F7]";
              const label = inactive ? " (Archived)" : "";
              return {
                isOccupied,
                html: `
            <button type="button" data-table-id="${table.id}" onclick="selectTable('${prefix}','${table.id}')" class="px-3 py-2 rounded-full text-xs font-semibold transition ${btnClass}" ${(inactive || isOccupied) && !isSelected ? "disabled" : ""}>
              ${escapeHtml(table.name)}${table.capacity ? ` • ${table.capacity}` : ""}${label}
            </button>`,
              };
            })
            .sort((a, b) => a.isOccupied - b.isOccupied)
            .map((t) => t.html)
            .join("")}
        </div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = `
    <div class="mb-3 flex items-center justify-between gap-3">
      <label class="block text-xs font-medium text-[#555]">Table</label>
      ${selectedId ? '<button type="button" onclick="clearTableSelection(\'' + prefix + '\')" class="text-xs text-[#C8A96B] hover:underline">Clear selection</button>' : ""}
    </div>
    ${rows || '<p class="text-xs text-[#999]">No active tables configured for the selected areas.</p>'}
  `;

  hiddenInput.value = selectedId;

  const selectedTable = getTableById(selectedId);
  if (selectedTable) {
    areaSelect.value = selectedTable.area_id || "";
    areaSelect.disabled = true;
  } else {
    areaSelect.disabled = false;
  }
}

function selectTable(prefix, tableId) {
  const hiddenInput = document.getElementById(`${prefix}-table-id`);
  const areaSelect = document.getElementById(`${prefix}-area`);
  if (!hiddenInput || !areaSelect) return;

  const table = getTableById(tableId);
  if (!table || (!table.is_active && hiddenInput.value !== tableId)) return;

  if (hiddenInput.value === tableId) {
    clearTableSelection(prefix);
    return;
  }

  hiddenInput.value = table.id;
  areaSelect.value = table.area_id || "";
  areaSelect.disabled = true;
  renderTableSelection(prefix, table.id);
  if (prefix === "res") updateResVipTimeRange();
}

function clearTableSelection(prefix) {
  const hiddenInput = document.getElementById(`${prefix}-table-id`);
  const areaSelect = document.getElementById(`${prefix}-area`);
  if (!hiddenInput || !areaSelect) return;

  hiddenInput.value = "";
  areaSelect.disabled = false;
  renderTableSelection(prefix, "");
  if (prefix === "res") updateResVipTimeRange();
}

// ============================================================
// VIP HOUR-RANGE BOOKING
// VIP Room has one table, but two parties can book the same day
// at different hours. When a VIP table is selected, an end-time
// field appears and overlapping bookings are blocked on save.
// ============================================================
const LEGACY_BOOKING_HOURS = 3; // assumed duration for bookings saved without end_time

function isVipTableId(tableId) {
  const t = getTableById(tableId);
  if (!t) return false;
  const area = allAreas.find((a) => a.id === t.area_id);
  return !!area && /^vip/i.test((area.name || "").trim());
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":");
  return parseInt(h) * 60 + parseInt(m || 0);
}

function updateResVipTimeRange() {
  const wrap = document.getElementById("res-endtime-wrap");
  if (!wrap) return;

  const tableId = document.getElementById("res-table-id")?.value || "";
  const isVip = tableId && isVipTableId(tableId);
  wrap.classList.toggle("hidden", !isVip);
  if (!isVip) return;

  // "from" mirrors the main reservation time; "to" starts EMPTY —
  // it's optional and staff can fill it in later by editing.
  const fromEl = document.getElementById("res-vip-from");
  const startVal = document.getElementById("res-time")?.value;
  if (fromEl && startVal) fromEl.value = startVal;

  // Clear any previous conflict message when the range context changes
  const vipErrEl = document.getElementById("res-vip-conflict");
  if (vipErrEl) {
    vipErrEl.classList.add("hidden");
    vipErrEl.textContent = "";
  }
}

// Editing the VIP "from" field updates the main reservation time too
function syncVipFromTime() {
  const fromVal = document.getElementById("res-vip-from")?.value;
  const timeEl = document.getElementById("res-time");
  if (fromVal && timeEl) timeEl.value = fromVal;
}

// A booking in one of these statuses is HOLDING something right now: a seat in
// its area, or the table it was given. Deliberately NOT RES_OCCUPANCY_STATUSES,
// which also contains "Completed" — a guest who has already left still belongs
// on the run sheet, but their seat is free and their table can be re-let.
//
// "Confirmed" was missing from both places that used to spell this list out by
// hand. Nothing sets that status today, so it cost nothing; the deposit flow
// promotes a paid booking to Confirmed, at which point every paid booking would
// have vanished from the capacity cards and stopped blocking its own table.
const RES_HOLDS_SEAT_STATUSES = ["Reserved", "Confirmed", "Arrived"];

// Returns conflicting booking description, or null if the slot is free.
async function findVipTimeConflict(tableId, date, startTime, endTime, excludeResId) {
  let q = db
    .from("reservations")
    .select("id, reservation_time, end_time, guests(name)")
    .eq("table_id", tableId)
    .eq("reservation_date", date)
    .in("status", RES_HOLDS_SEAT_STATUSES);
  if (excludeResId) q = q.neq("id", excludeResId);
  const { data: existing, error } = await supabaseQuery(() => q, "Failed to check VIP availability");
  if (error) return "could-not-check";

  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);
  for (const b of existing || []) {
    const bStart = timeToMinutes(b.reservation_time);
    const bEnd = b.end_time ? timeToMinutes(b.end_time) : bStart + LEGACY_BOOKING_HOURS * 60;
    if (newStart < bEnd && bStart < newEnd) {
      return `${String(b.reservation_time).slice(0, 5)}–${b.end_time ? String(b.end_time).slice(0, 5) : "±" + LEGACY_BOOKING_HOURS + "h"} (${b.guests?.name || "guest"})`;
    }
  }
  return null;
}

// One line under an area name saying what a guest would be told. Without it
// the only way to know whether an area is live is to open each one in turn,
// which is how a restaurant ends up with a rule it forgot it set.
function areaConditionsLine(area) {
  if (!area || !area.is_bookable_online) return "";
  const bits = [];
  if (area.min_pax != null) bits.push(`${t("min")} ${area.min_pax} ${t("pax")}`);
  if (area.min_spend != null)
    bits.push(`${t("min")} Rp ${Number(area.min_spend).toLocaleString("id-ID")}`);
  if (area.deposit_amount != null && Number(area.deposit_amount) > 0)
    bits.push(`${t("DP")} Rp ${Number(area.deposit_amount).toLocaleString("id-ID")}`);
  const detail = bits.length ? ` &middot; ${bits.join(" &middot; ")}` : "";
  return `<p class="text-[11px] text-[#5F8D4E] mt-0.5">${t("Bookable online")}${detail}</p>`;
}

// A chip is a label, never area-supplied text, so the only thing that reaches
// it is a number or a translated string.
function areaChip(label, bg, fg) {
  return `<span class="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style="background:${bg};color:${fg}">${escapeHtml(String(label))}</span>`;
}

function renderTableManagement() {
  const section = document.getElementById("area-tables-section");
  if (!section) return;

  section.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-5 gap-3">
      <div>
        <h2 class="font-heading text-2xl font-semibold text-[#28547C]">${t("Areas & Tables")}</h2>
        <p class="text-sm text-[#999] mt-1">${t("Create the rooms and sections first, then add the tables inside each one.")}</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="openImportModal()" class="btn-ghost text-sm px-4 py-2 manager-only-ui">${t("Import")}</button>
        <button onclick="openAreaModal()" class="btn-primary px-4 py-2 manager-only-ui">${t("Add Area")}</button>
      </div>
    </div>
    ${
      allAreas.length
        ? ""
        : `<div class="card p-8 text-center">
             <p class="text-sm text-[#777] mb-1">${t("No areas yet.")}</p>
             <p class="text-xs text-[#999] mb-4">${t("An area is a room or section of the restaurant: Indoor, Terrace, VIP Room. Tables belong to one.")}</p>
             <button onclick="openAreaModal()" class="btn-primary px-5 py-2 manager-only-ui">${t("Add the first area")}</button>
           </div>`
    }
    <div class="grid gap-4">
      ${allAreas
        .map((area) => {
          const areaTables = allTables.filter((t) => t.area_id === area.id);
          return `
          <div class="card p-5">
            <div class="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 class="font-semibold text-[#28547C]">${escapeHtml(area.name)}</h3>
                <p class="text-xs text-[#777]">${areaTables.length} table${areaTables.length === 1 ? "" : "s"} &middot; ${t("seats")} ${area.capacity || 0}
                  <button onclick="openAreaModal('${area.id}')" class="text-[#28547C] hover:underline ml-2 manager-only-ui">${t("Edit")}</button>
                  <button onclick="deleteArea('${area.id}')" class="text-[#B23B3B] hover:underline ml-1 manager-only-ui">${t("Remove")}</button>
                </p>
                ${areaConditionsLine(area)}
              </div>
              <button type="button" onclick="openTableModal(null, '${area.id}')" class="text-xs text-[#5596CE] hover:underline">Add to area</button>
            </div>
            ${
              areaTables.length
                ? areaTables
                    .map(
                      (table) => `
              <div class="flex items-center justify-between gap-3 mb-3 p-3 rounded-10 border border-[#E7E4DE] ${table.is_active ? "" : "opacity-70"}">
                <div>
                  <p class="font-medium text-sm text-[#222]">${escapeHtml(table.name)}</p>
                  <p class="text-xs text-[#777]">Capacity: ${table.capacity || "—"}${table.description ? ` · ${escapeHtml(table.description)}` : ""}</p>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" onclick="openTableModal('${table.id}')" class="text-xs text-[#C8A96B] hover:underline">Edit</button>
                  <button type="button" onclick="toggleTableActive('${table.id}', ${table.is_active ? "false" : "true"})" class="text-xs ${table.is_active ? "text-[#E05252] hover:text-[#B43B3B]" : "text-[#5F8D4E] hover:text-[#3E6D3F]"}">
                    ${table.is_active ? "Archive" : "Restore"}
                  </button>
                </div>
              </div>
            `,
                    )
                    .join("")
                : '<p class="text-xs text-[#999]">No tables configured for this area.</p>'
            }
          </div>
        `;
        })
        .join("")}
    </div>
  `;

  // Fix placeholder buttons after rendered content
  section
    .querySelectorAll('button[onclick*="AREA_TABLE_PLACEHOLDER"]')
    .forEach((btn) => {
      const areaName =
        btn.closest(".card")?.querySelector("h3")?.textContent || "";
      const area = allAreas.find((a) => a.name === areaName);
      if (area) {
        btn.setAttribute(
          "onclick",
          `openTableModal({ area_id: '${area.id}' })`,
        );
      }
    });
}

function openTableModal(table = null, areaId = null) {
  let record = null;
  if (typeof table === "string") {
    record = getTableById(table);
  } else if (table && typeof table === "object" && table.id) {
    record = table;
  }
  document.getElementById("table-edit-id").value = record?.id || "";
  document.getElementById("table-name").value = record?.name || "";
  document.getElementById("table-capacity").value = record?.capacity || "";
  document.getElementById("table-description").value =
    record?.description || "";
  document.getElementById("table-active").checked = record?.is_active !== false;
  populateTableAreaSelects();
  document.getElementById("table-area").value = record?.area_id || areaId || "";
  document.getElementById("table-modal-title").textContent = record
    ? "Edit Table"
    : "Create Table";
  document.getElementById("table-save-button").textContent = record
    ? "Save Changes"
    : "Create Table";
  showModal("modal-table");
}

async function saveTable() {
  const id = document.getElementById("table-edit-id").value;
  const name = document.getElementById("table-name").value.trim();
  const area_id = document.getElementById("table-area").value;
  const capacity = parseInt(
    document.getElementById("table-capacity").value,
    10,
  );
  const description =
    document.getElementById("table-description").value.trim() || null;
  const is_active = document.getElementById("table-active").checked;

  if (!name || !area_id) {
    toast("Table name and area are required", "error");
    return;
  }

  const payload = {
    name,
    area_id,
    capacity: Number.isNaN(capacity) ? null : capacity,
    description,
    is_active,
  };

  loader(true);
  const { error } = await supabaseQuery(
    () =>
      id
        ? db.from("tables").update(payload).eq("id", id)
        : db.from("tables").insert(payload),
    id ? "Failed to update table" : "Failed to create table",
  );
  loader(false);

  if (error) {
    toast(error.message || "Unable to save table", "error");
    return;
  }

  toast(id ? "Table updated" : "Table created");
  await loadTables();
  populateAreaSelects();
  // Preserve existing occupancy context when refreshing after table management
  renderTableSelection("wi");
  renderTableSelection("res");
  renderAreas();
  hideModal("modal-table");
}

async function toggleTableActive(tableId, isActive) {
  loader(true);
  const { error } = await supabaseQuery(
    () => db.from("tables").update({ is_active: isActive }).eq("id", tableId),
    "Failed to update table status",
  );
  loader(false);

  if (error) {
    toast(error.message || "Unable to update table status", "error");
    return;
  }

  await loadTables();
  renderTableManagement();
  renderTableSelection("wi");
  renderTableSelection("res");
  toast(isActive ? "Table restored" : "Table archived");
}

async function renderAreas() {
  const grid = document.getElementById("areas-grid");
  if (!grid) return;

  const { data: todayRes, error: todayResError } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("assigned_area, pax, status")
        .eq("reservation_date", TODAY)
        .in("status", RES_HOLDS_SEAT_STATUSES),
    "Failed to load area reservations",
  );

  const { data: todayWi, error: todayWiError } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("assigned_area, pax, status, completed_at")
        .eq("visit_date", TODAY)
        .eq("visit_type", "Walk-In")
        .neq("status", "Done")
        .is("completed_at", null)
        .is("voided_at", null),
    "Failed to load walk-ins for area view",
  );

  if (todayResError || todayWiError) {
    toast("Unable to load area occupancy", "error");
  }

  const reservedByArea = {};
  (todayRes || []).forEach((r) => {
    if (r.assigned_area)
      reservedByArea[r.assigned_area] =
        (reservedByArea[r.assigned_area] || 0) + r.pax;
  });
  (todayWi || []).forEach((w) => {
    if (w.assigned_area)
      reservedByArea[w.assigned_area] =
        (reservedByArea[w.assigned_area] || 0) + w.pax;
  });

  const colorMap = {
    "Indoor Dining": { bg: "#EFF7EC", bar: "#5F8D4E", icon: "🍽️" },
    "Outdoor Dining": { bg: "#EEF7FF", bar: "#3B82F6", icon: "🌿" },
    "VIP Room A": { bg: "#FBF8EE", bar: "#C8A96B", icon: "⭐" },
    "VIP Room B": { bg: "#FBF3EE", bar: "#E8835A", icon: "✨" },
  };

  grid.innerHTML = allAreas
    .map((area) => {
      const reserved = reservedByArea[area.id] || 0;
      const remaining = Math.max(0, area.capacity - reserved);
      const pct = Math.min(100, Math.round((reserved / area.capacity) * 100));
      const c = colorMap[area.name] || {
        bg: "#F8F6F2",
        bar: "#5596CE",
        icon: "📍",
      };
      const statusColor =
        pct >= 90 ? "#E05252" : pct >= 70 ? "#D4A017" : "#5F8D4E";

      // The rules, at a glance. Deliberately NOT expressed as a card
      // background colour: the bar already carries the per-area colour and
      // the big number already carries occupancy, so a third colour meaning
      // on the same card would leave none of them readable. Bookable areas
      // get a left edge and a faint tint, the rules themselves get chips.
      const bookable = !!area.is_bookable_online;
      const depositAmt =
        area.deposit_amount != null && Number(area.deposit_amount) > 0
          ? Number(area.deposit_amount)
          : null;
      const chips = [];
      if (bookable) {
        chips.push(areaChip(t("Bookable online"), "#EAF3E5", "#4A7A3A"));
        if (area.min_pax != null)
          chips.push(
            areaChip(`${t("min")} ${area.min_pax} ${t("pax")}`, "#F1EFE9", "#6B6459"),
          );
        if (area.min_spend != null)
          chips.push(
            areaChip(
              `${t("min")} Rp ${Number(area.min_spend).toLocaleString("id-ID")}`,
              "#F1EFE9",
              "#6B6459",
            ),
          );
        // Called out separately from the other conditions, because it is the
        // only rule that asks the guest for money before they arrive.
        if (depositAmt !== null)
          chips.push(
            areaChip(
              `${t("Needs deposit")} · Rp ${depositAmt.toLocaleString("id-ID")}`,
              "#FBF0D9",
              "#96701A",
            ),
          );
      } else {
        chips.push(areaChip(t("Staff only"), "#F1EFE9", "#8A8375"));
      }

      return `
      <div class="card p-6" style="${bookable ? "background:#FCFDFA;border-left:3px solid #5F8D4E;" : ""}">
        <div class="flex items-start justify-between mb-2">
          <div>
            <span class="text-2xl mb-2 block">${c.icon}</span>
            <h3 class="font-heading text-xl font-semibold text-[#28547C]">${area.name}</h3>
          </div>
          <span class="text-2xl font-display font-semibold" style="color:${statusColor}">${remaining}</span>
        </div>
        <div class="flex flex-wrap gap-1 mb-4">${chips.join("")}</div>
        <div class="flex justify-between text-xs text-[#999] mb-2">
          <span>Capacity: ${area.capacity}</span>
          <span>Reserved: ${reserved}</span>
        </div>
        <div style="height:6px;background:#EDE9E3;border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${c.bar};border-radius:3px;transition:width .5s;"></div>
        </div>
        <p class="text-xs mt-2" style="color:${statusColor}">${remaining} seats remaining · ${pct}% occupied</p>
      </div>
    `;
    })
    .join("");
  renderTableManagement();
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  try {
    const [walkins, reservations] = await Promise.all([
      supabaseQuery(
        () =>
          db
            .from("visits")
            .select(
              "id, guest_id, pax, assigned_area, table_id, visit_time, spend_amount, status, completed_at, notes, guests(name, phone, booking_alias, spending_tier, tag, food_allergy, notes, favorite_menu), areas(name), tables(name)",
            )
            .eq("visit_date", TODAY)
            .eq("visit_type", "Walk-In")
            .is("voided_at", null)
            .order("visit_time", { ascending: false }),
        "Failed to load walk-ins",
      ),
      supabaseQuery(
        () =>
          db
            .from("reservations")
            .select(
              "id, pax, status, guest_id, reservation_time, occasion, reservation_source, assigned_area, table_id, notes, guests(name,phone,booking_alias,spending_tier,tag,food_allergy,notes,favorite_menu), tables(name)",
            )
            .eq("reservation_date", TODAY)
            .order("reservation_time"),
        "Failed to load reservations",
      ),
    ]);

    if (walkins.error || reservations.error) {
      toast("Some dashboard data failed to load.", "error");
      return;
    }

    const walkInCount = walkins.data?.length || 0;
    const walkInPax = (walkins.data || []).reduce((s, v) => s + v.pax, 0);
    const resData = reservations.data || [];
    const resPax = resData
      .filter((r) => !["Cancelled", "Cancelled (No Show)"].includes(r.status))
      .reduce((s, r) => s + r.pax, 0);

    document.getElementById("stat-walkins").textContent = walkInCount;
    document.getElementById("stat-reservations").textContent = resData.length;
    document.getElementById("stat-expected").textContent = resData.filter((r) =>
      ["Reserved"].includes(r.status),
    ).length;
    document.getElementById("stat-pax").textContent = walkInPax + resPax;

    renderDashboardAreaOccupancy(resData, walkins.data || []);
    await attachGuestVisitCounts(walkins.data || []);
    renderDashboardWalkIns(walkins.data || []);
    await loadDashboardReservationCounts();
    updateDashboardReservationTabs();
    await loadDashboardReservations(dashboardReservationOffset, resData);
    loadDashboardPrizeRedemptions();
    loadDashboardBirthdays();
  } catch (error) {
    console.error("Dashboard load failed", error);
    toast("Dashboard load failed", "error");
  }
}

function getDashboardDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return ymd(date);
}

async function loadDashboardReservationCounts() {
  const dates = [getDashboardDate(0), getDashboardDate(1), getDashboardDate(2)];
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("reservation_date, pax, status, assigned_area")
        .in("reservation_date", dates),
    "Failed to load reservation counts",
  );

  if (error) {
    dashboardReservationCounts = [0, 0, 0];
    dashboardReservationTotals = [null, null, null];
    return;
  }

  const totals = bucketReservationTotals(data || [], dates);
  dashboardReservationCounts = totals.map((b) => b.count);
  dashboardReservationTotals = totals;
}

// Per-day totals behind the Upcoming Reservations tabs. `count` is every row
// for that date, so the tab number keeps matching the list underneath.
// `activeCount`/`pax` use RES_OCCUPANCY_STATUSES — Reserved/Arrived/Completed
// — so a cancelled party of 10 never inflates the number of guests the
// kitchen prepares for. `unplaced*` counts the active bookings that still
// have no area assigned, which are invisible in every capacity card.
// Pure function so it can be unit tested (tests/pax-totals.test.js).
function bucketReservationTotals(rows, dates) {
  const totals = dates.map(() => ({
    count: 0,
    activeCount: 0,
    pax: 0,
    excluded: 0,
    unplacedCount: 0,
    unplacedPax: 0,
  }));
  rows.forEach((r) => {
    const idx = dates.indexOf(r.reservation_date);
    if (idx < 0) return;
    const bucket = totals[idx];
    bucket.count += 1;
    if (RES_OCCUPANCY_STATUSES.includes(r.status)) {
      const pax = Number(r.pax) || 0;
      bucket.activeCount += 1;
      bucket.pax += pax;
      if (!r.assigned_area) {
        bucket.unplacedCount += 1;
        bucket.unplacedPax += pax;
      }
    } else if (r.status !== "Deleted") {
      bucket.excluded += 1;
    }
  });
  return totals;
}

// Weekday and day-month for the SELECTED day tab (not necessarily today —
// staff can view +2 days). Split into two parts so the strip can show the
// weekday small above a larger date, which is how the front desk reads it.
function getDashboardDateParts(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const locale = CURRENT_LANG === "id" ? "id-ID" : "en-GB";
  return {
    weekday: date.toLocaleDateString(locale, { weekday: "long" }),
    dayMonth: date.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
    }),
  };
}

// Totals strip under the Upcoming Reservations tabs. Answers the two
// questions the front desk actually asks when they click a day tab: how many
// bookings, and how many people are we expecting — including the ones that
// have no table or area assigned yet.
// Layout: the selected day's date sits on the left (it replaces the old
// "Showing reservations for …" sub-header, which said the same thing in a
// smaller font), the two compact metric cards are pushed to the right edge.
function renderDashboardReservationTotals() {
  const el = document.getElementById("dashboard-reservation-totals");
  if (!el) return;
  const totals = (dashboardReservationTotals || [])[
    dashboardReservationOffset
  ];
  if (!totals) {
    el.innerHTML = "";
    return;
  }

  const { weekday, dayMonth } = getDashboardDateParts(
    dashboardReservationOffset,
  );

  // Borderless on a tinted strip — the surrounding box already separates this
  // from the list below, so card borders would just add visual noise.
  const miniCard = (label, value, color) => `
    <div class="rounded-lg bg-white px-3 py-1.5 text-right min-w-[86px]">
      <p class="text-[9px] text-[#999] uppercase tracking-wider font-medium leading-tight">${label}</p>
      <p class="font-display text-xl font-semibold leading-tight" style="color:${color}">${value}</p>
    </div>`;

  const unplacedHtml = totals.unplacedCount
    ? `<span class="text-[11px] text-[#8a8a8a]">
         <span class="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1" style="background:#C8A96B"></span>
         ${totals.unplacedCount} ${t("reservations")} · ${totals.unplacedPax} ${t("pax")} ${t("not yet placed")}
       </span>`
    : "";
  const excludedHtml = totals.excluded
    ? `<span class="text-[11px] text-[#a8a29a]">${totals.excluded} ${t("cancelled / no-show, not counted")}</span>`
    : "";
  const notesHtml =
    unplacedHtml || excludedHtml
      ? `<div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-2">${unplacedHtml}${excludedHtml}</div>`
      : "";

  el.innerHTML = `
    <div class="rounded-xl bg-[#FBF9F6] px-4 py-3 mb-5">
      <div class="flex items-end justify-between gap-4 flex-wrap">
        <div class="leading-tight">
          <p class="text-[11px] text-[#999] uppercase tracking-wider font-medium">${escapeHtml(weekday)}</p>
          <p class="font-display text-2xl font-semibold text-[#28547C]">${escapeHtml(dayMonth)}</p>
        </div>
        <div class="flex items-stretch gap-2 ml-auto">
          ${miniCard(t("Total Reservations"), totals.activeCount, "#28547C")}
          ${miniCard(t("Expected Pax"), totals.pax, "#C8A96B")}
        </div>
      </div>
      ${notesHtml}
    </div>`;
}

function formatDashboardTabLabel(offset, count = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const label = date.toLocaleDateString(
    CURRENT_LANG === "id" ? "id-ID" : "en-GB",
    {
      weekday: "short",
      day: "numeric",
      month: "short",
    },
  );
  if (offset === 0) return `Today (${count}), ${label}`;
  if (offset === 1) return `Tomorrow (${count}), ${label}`;
  return `+2 Days (${count}), ${label}`;
}

function formatDashboardDateHeader(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString(
    CURRENT_LANG === "id" ? "id-ID" : "en-GB",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
    },
  );
}

function updateDashboardReservationTabs() {
  for (let i = 0; i < 3; i += 1) {
    const btn = document.getElementById(`dashboard-reservation-tab-${i}`);
    if (!btn) continue;
    const active = i === dashboardReservationOffset;
    btn.classList.toggle("bg-[#5596CE]", active);
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("bg-[#F8F6F2]", !active);
    btn.classList.toggle("text-[#5596CE]", !active);
    btn.classList.toggle("border-[#D8D2C4]", true);
    btn.textContent = formatDashboardTabLabel(
      i,
      dashboardReservationCounts[i] || 0,
    );
  }

  renderDashboardReservationTotals();
}

async function loadDashboardReservations(offset = 0, initialData = null) {
  dashboardReservationOffset = offset;
  updateDashboardReservationTabs();

  const date = getDashboardDate(offset);
  let data = initialData;

  if (!data || offset !== 0) {
    const result = await supabaseQuery(
      () =>
        db
          .from("reservations")
          .select(
            "id, pax, status, guest_id, reservation_time, occasion, reservation_source, assigned_area, notes, guests(name,phone,booking_alias,spending_tier,tag,food_allergy,notes,favorite_menu,last_order), areas(name), tables(name)",
          )
          .eq("reservation_date", date)
          .order("reservation_time"),
      "Failed to load dashboard reservations",
    );

    if (result.error) {
      toast("Unable to load reservations for the selected date", "error");
      data = [];
    } else {
      data = result.data || [];
    }
  }

  await attachGuestVisitCounts(data);
  renderDashboardReservations(data);
}

function setDashboardReservationTab(offset) {
  if (dashboardReservationOffset === offset) return;
  dashboardReservationOffset = offset;
  loadDashboardReservations(offset);
}

function renderDashboardAreaOccupancy(reservations, walkins) {
  const el = document.getElementById("dashboard-area-occupancy");
  if (!el) return;

  const groups = [
    { name: "Indoor Dining", match: (area) => area.name === "Indoor Dining" },
    { name: "Outdoor Dining", match: (area) => area.name === "Outdoor Dining" },
    { name: "VIP Room", match: (area) => area.name.startsWith("VIP Room") },
  ];

  const activeReservations = reservations.filter(
    (r) =>
      !["Cancelled", "Cancelled (No Show)", "Completed"].includes(r.status),
  );
  // Exclude checked-out walk-ins from occupancy — only count guests still present
  const activeWalkins = walkins.filter(
    (w) => w.status !== "Done" && !w.completed_at,
  );

  el.innerHTML = groups
    .map((group) => {
      const areas = allAreas.filter(group.match);
      const areaIds = new Set(areas.map((a) => a.id));
      const capacity = areas.reduce(
        (sum, area) => sum + (area.capacity || 0),
        0,
      );
      const reservedPax =
        activeReservations
          .filter((r) => areaIds.has(r.assigned_area))
          .reduce((sum, r) => sum + (r.pax || 0), 0) +
        activeWalkins
          .filter((w) => areaIds.has(w.assigned_area))
          .reduce((sum, w) => sum + (w.pax || 0), 0);
      const remaining = Math.max(0, capacity - reservedPax);
      const pct = capacity
        ? Math.min(100, Math.round((reservedPax / capacity) * 100))
        : 0;
      const statusColor =
        pct >= 81 ? "#D4573A" : pct >= 61 ? "#C8A96B" : "#5596CE";

      return `
      <div class="stat-card py-4 px-5">
        <div class="flex items-start justify-between gap-3 mb-3">
          <p class="font-display text-lg font-semibold text-[#28547C] leading-tight">${group.name}</p>
          <span class="text-xs font-semibold" style="color:${statusColor}">${pct}%</span>
        </div>
        <p class="text-sm font-medium text-[#222] mb-1">${reservedPax} / ${capacity} pax</p>
        <p class="text-xs text-[#999] mb-2">${remaining} seats remaining</p>
        <p class="text-[11px] font-medium mb-2" style="color:${statusColor}">${pct}% Occupied</p>
        <div style="height:5px;background:#EDE9E3;border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${statusColor};border-radius:3px;transition:width .4s;"></div>
        </div>
      </div>
    `;
    })
    .join("");
}

// Fetch lifetime visit counts for the guests in a set of rows (reservations or
// visits) and attach a `_visitCount` field to each row for rendering.
// Cache for guest visit counts — invalidated when a visit is saved/updated.
// This avoids re-fetching all-time visit history on every Realtime dashboard refresh.
let _visitCountCache = null; // Map<guestId, count> | null
let _visitCountCacheTime = 0;
const VISIT_COUNT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function invalidateVisitCountCache() {
  _visitCountCache = null;
  _visitCountCacheTime = 0;
}

async function attachGuestVisitCounts(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const ids = [...new Set(rows.map((r) => r.guest_id).filter(Boolean))];
  if (!ids.length) {
    rows.forEach((r) => {
      r._visitCount = 0;
    });
    return;
  }

  const now = Date.now();
  const cacheValid =
    _visitCountCache &&
    now - _visitCountCacheTime < VISIT_COUNT_CACHE_TTL &&
    ids.every((id) => _visitCountCache.has(id));

  if (!cacheValid) {
    // Only fetch counts for IDs not already cached (or full refresh if cache expired)
    const idsToFetch =
      _visitCountCache && now - _visitCountCacheTime < VISIT_COUNT_CACHE_TTL
        ? ids.filter((id) => !_visitCountCache.has(id))
        : ids;

    if (idsToFetch.length > 0) {
      const { data } = await supabaseQuery(
        () =>
          db
            .from("visits")
            .select("guest_id")
            .in("guest_id", idsToFetch)
            .is("voided_at", null),
        "Failed to load guest visit counts",
      );
      if (
        !_visitCountCache ||
        now - _visitCountCacheTime >= VISIT_COUNT_CACHE_TTL
      ) {
        _visitCountCache = new Map();
        _visitCountCacheTime = now;
      }
      (data || []).forEach((v) => {
        _visitCountCache.set(
          v.guest_id,
          (_visitCountCache.get(v.guest_id) || 0) + 1,
        );
      });
      // Ensure all requested IDs exist in cache (0 if no visits)
      idsToFetch.forEach((id) => {
        if (!_visitCountCache.has(id)) _visitCountCache.set(id, 0);
      });
    }
  }

  rows.forEach((r) => {
    r._visitCount = r.guest_id ? _visitCountCache?.get(r.guest_id) || 0 : 0;
  });
}

// Which column of this payload the database does not have, or null.
//
// PostgREST reports it two ways depending on version and on whether the
// schema cache or Postgres itself rejected it:
//   PGRST204  "Could not find the 'last_order' column of 'guests' ..."
//   42703     'column "last_order" of relation "guests" does not exist'
// The name is only trusted when it is actually a key we sent, so an
// unrelated error can never quietly delete a field from someone's edit.
function guestMissingColumnFrom(error, payload) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  if (!/PGRST204/.test(text) && !/42703/.test(text) && !/column/i.test(text)) return null;
  for (const key of Object.keys(payload || {})) {
    if (new RegExp(`['"\`]${key}['"\`]`).test(text)) return key;
  }
  return null;
}

// Render the guest-level extras (total visits, allergies, notes) shown under
// each guest on the dashboard reservation and walk-in cards.
function renderGuestExtras(guest, visitCount) {
  if (!guest) return "";
  const count = visitCount || 0;
  const parts = [
    `<span class="inline-flex items-center gap-1 text-[11px] text-[#28547C]">🔁 ${count} visit${count === 1 ? "" : "s"}</span>`,
  ];
  if (guest.food_allergy) {
    parts.push(
      `<span class="text-[11px] text-red-500">⚠️ ${escapeHtml(guest.food_allergy)}</span>`,
    );
  }
  if (guest.notes) {
    parts.push(
      `<span class="text-[11px] text-[#888]">📝 ${escapeHtml(guest.notes)}</span>`,
    );
  }
  // Favorite menu / recent order — show whenever the guest has at least
  // one prior visit on record. "count" here is prior completed visits,
  // not including today's/this reservation's own visit row, so a guest
  // with 1 past visit who is now reserving again (2nd occasion overall)
  // already counts as "revisiting" and should see their saved order.
  if (guest.favorite_menu && count >= 1) {
    parts.push(
      `<span class="text-[11px] text-[#8A6D3B]">🍽️ ${escapeHtml(guest.favorite_menu)}</span>`,
    );
  }
  return `<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">${parts.join("")}</div>`;
}

// ============================================================
// DASHBOARD PAGINATION HELPERS
// ============================================================
const DASH_PAGE_SIZE = 5;

function renderPaginationControls(
  containerId,
  currentPage,
  totalItems,
  onPrev,
  onNext,
) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.ceil(totalItems / DASH_PAGE_SIZE);
  if (totalPages <= 1) {
    el.innerHTML = "";
    return;
  }
  const start = currentPage * DASH_PAGE_SIZE + 1;
  const end = Math.min((currentPage + 1) * DASH_PAGE_SIZE, totalItems);
  const btnBase =
    "inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors";
  const btnActive = `${btnBase} bg-[#28547C] border-[#28547C] text-white hover:bg-[#1e3f5e]`;
  const btnDisabled = `${btnBase} bg-[#F0EDE8] border-[#E0DAD2] text-[#C0BAB0] cursor-not-allowed`;
  el.innerHTML = `
    <span class="text-[11px] text-[#999] mr-1">${start}–${end} of ${totalItems}</span>
    <button
      onclick="${onPrev}()"
      ${currentPage === 0 ? "disabled" : ""}
      class="${currentPage === 0 ? btnDisabled : btnActive}"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Prev
    </button>
    <button
      onclick="${onNext}()"
      ${currentPage >= totalPages - 1 ? "disabled" : ""}
      class="${currentPage >= totalPages - 1 ? btnDisabled : btnActive}"
    >
      Next
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  `;
}

// The dashboard list is paginated, but the export is the whole selected
// day, not the visible page. Exporting page 2 of 4 would be a bug report.
function exportDashboardReservations() {
  const date = getDashboardDate(dashboardReservationOffset);
  return downloadReservationSheet(
    `export-reservations-${date}`,
    (dashboardResData || []).map((r) => resExportRow(r, date)),
    date,
  );
}

function dashResNextPage() {
  const totalPages = Math.ceil(dashboardResData.length / DASH_PAGE_SIZE);
  if (dashboardResPage < totalPages - 1) {
    dashboardResPage++;
    renderDashboardReservations(dashboardResData);
  }
}

function dashResPrevPage() {
  if (dashboardResPage > 0) {
    dashboardResPage--;
    renderDashboardReservations(dashboardResData);
  }
}

function dashWalkinNextPage() {
  const totalPages = Math.ceil(dashboardWalkinData.length / DASH_PAGE_SIZE);
  if (dashboardWalkinPage < totalPages - 1) {
    dashboardWalkinPage++;
    renderDashboardWalkIns(dashboardWalkinData);
  }
}

function dashWalkinPrevPage() {
  if (dashboardWalkinPage > 0) {
    dashboardWalkinPage--;
    renderDashboardWalkIns(dashboardWalkinData);
  }
}

function dashPrizeNextPage() {
  const totalPages = Math.ceil(dashboardPrizeAllData.length / DASH_PAGE_SIZE);
  if (dashboardPrizePage < totalPages - 1) {
    dashboardPrizePage++;
    renderDashboardPrizeTable();
  }
}

function dashPrizePrevPage() {
  if (dashboardPrizePage > 0) {
    dashboardPrizePage--;
    renderDashboardPrizeTable();
  }
}

// ============================================================
// RESERVATION LIST ORDERING
// ============================================================
// A cancelled booking is dead weight on an operational list: staff scan
// these to know who is still coming, and a cancelled row sitting in the
// middle of the timeline costs a double-take every time. So cancelled
// rows sink to the bottom while everything else keeps its natural order.
//
// The three cancelled statuses are listed explicitly because the DB
// check constraint allows all three and they arrived at different times:
// 'Cancelled' (guest backed out), 'Cancelled (No Show)' (what the No Show
// chip actually writes), and the legacy 'No Show'. Missing the middle one
// is exactly the bug this set replaces — no-shows were sorting as if they
// were still expected.
// 'Deleted' is not here on purpose: it's a data-entry mistake, hidden
// from every list except the manager audit chip, where its own ordering
// doesn't matter.
const CANCELLED_RES_STATUSES = new Set([
  "Cancelled",
  "Cancelled (No Show)",
  "No Show",
]);

function isCancelledRes(status) {
  return CANCELLED_RES_STATUSES.has(status);
}

// Returns a NEW array — callers keep whatever order the DB gave them
// within each group, so this is a stable "sink the cancelled ones" pass
// rather than a re-sort. Array.prototype.sort is stable in every browser
// we support, so equal-rank rows hold their existing time order.
function sortResCancelledLast(rows) {
  return [...(rows || [])].sort(
    (a, b) => (isCancelledRes(a.status) ? 1 : 0) - (isCancelledRes(b.status) ? 1 : 0),
  );
}

function renderDashboardReservations(data) {
  // Store full dataset and reset page when new data arrives
  if (data !== dashboardResData) {
    // Dashboard keeps its extra tier: Completed also drops below the
    // still-active bookings (that behaviour predates this change and is
    // what makes the "who's still coming today" glance work), with
    // cancelled below that again.
    const rank = (r) =>
      isCancelledRes(r.status) ? 2 : r.status === "Completed" ? 1 : 0;
    dashboardResData = [...data].sort((a, b) => rank(a) - rank(b));
    dashboardResPage = 0;
  }

  const el = document.getElementById("dashboard-reservations-list");
  if (!el) return;

  if (!dashboardResData.length) {
    el.innerHTML =
      '<p class="text-center text-[#bbb] text-sm py-6">No reservations for this day</p>';
    renderPaginationControls(
      "res-pagination-controls",
      0,
      0,
      "dashResPrevPage",
      "dashResNextPage",
    );
    return;
  }

  renderPaginationControls(
    "res-pagination-controls",
    dashboardResPage,
    dashboardResData.length,
    "dashResPrevPage",
    "dashResNextPage",
  );

  const page = dashboardResData.slice(
    dashboardResPage * DASH_PAGE_SIZE,
    (dashboardResPage + 1) * DASH_PAGE_SIZE,
  );

  el.innerHTML = page
    .map((r) => {
      const areaName =
        r.areas?.name ||
        allAreas.find((a) => a.id === r.assigned_area)?.name ||
        "—";
      const tableName = r.tables?.name || "—";
      const notesDisplay = r.notes ? truncateNotes(r.notes) : "";
      return `
      <div class="py-3 border-b border-[#F0EDE8] last:border-0">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-4">
            <div class="text-center min-w-[52px]">
              <p class="font-display text-lg text-[#28547C] leading-none">${fmt.time(r.reservation_time)}</p>
            </div>
            <div>
              <p class="font-medium text-sm text-[#222] flex flex-wrap items-center gap-1.5">
                <span>${r.guests ? formatGuestName(r.guests) : "—"} ${memberBadge(r.guest_id)}</span>
                ${(() => {
                  const tier = r.guests?.spending_tier;
                  const tag = r.guests?.tag
                    ? r.guests.tag
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(-1)[0]
                    : null;
                  return `${tier ? formatSpendingTierBadge(tier) : ""}${tag ? `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F3F4F6] text-[#555]">${escapeHtml(tag)}</span>` : ""}`;
                })()}
              </p>
              <p class="text-xs text-[#999] mt-1.5">${fmt.pax(r.pax)} · ${areaName}${tableName ? " · " + tableName : ""}${r.occasion ? " · " + r.occasion : ""}${r.reservation_source ? " · " + escapeHtml(r.reservation_source) : ""}</p>
              ${renderGuestExtras(r.guests, r._visitCount)}
              ${notesDisplay ? `<p class="text-xs text-[#999] mt-1 flex items-start gap-1"><span>📝</span><span>${escapeHtml(notesDisplay)}</span></p>` : ""}
            </div>
          </div>
          <div class="flex items-center gap-3">
            ${statusBadge(r.status)}
            <a href="reservation-confirmation.html?id=${r.id}" target="_blank" title="View confirmation page" class="text-xs text-[#5596CE] hover:underline flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Link
            </a>
            <button onclick="openResActions('${r.id}')" class="text-xs text-[#C8A96B] hover:underline">Update</button>
            ${waReservationBtns(r)}
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function renderDashboardWalkIns(data) {
  // Store full dataset and reset page when new data arrives
  if (data !== dashboardWalkinData) {
    dashboardWalkinData = [...data].sort((a, b) => {
      const aTerminal = a.status === "Done" ? 1 : 0;
      const bTerminal = b.status === "Done" ? 1 : 0;
      return aTerminal - bTerminal; // active first, preserve DB time order within each group
    });
    dashboardWalkinPage = 0;
  }

  const el = document.getElementById("dashboard-walkins-list");
  const label = document.getElementById("dashboard-walkins-list-date");
  if (label) {
    const n = dashboardWalkinData.length;
    const countLabel =
      CURRENT_LANG === "id"
        ? `${n} tamu tanpa reservasi`
        : n === 1
          ? "1 walk-in"
          : `${n} walk-ins`;
    label.textContent =
      CURRENT_LANG === "id"
        ? `${countLabel} pada ${formatDashboardDateHeader(0)}`
        : `${countLabel} on ${formatDashboardDateHeader(0)}`;
  }
  if (!el) return;

  if (!dashboardWalkinData.length) {
    el.innerHTML =
      '<p class="text-center text-[#bbb] text-sm py-6">No walk-ins for today</p>';
    renderPaginationControls(
      "walkin-pagination-controls",
      0,
      0,
      "dashWalkinPrevPage",
      "dashWalkinNextPage",
    );
    return;
  }

  renderPaginationControls(
    "walkin-pagination-controls",
    dashboardWalkinPage,
    dashboardWalkinData.length,
    "dashWalkinPrevPage",
    "dashWalkinNextPage",
  );

  const page = dashboardWalkinData.slice(
    dashboardWalkinPage * DASH_PAGE_SIZE,
    (dashboardWalkinPage + 1) * DASH_PAGE_SIZE,
  );

  el.innerHTML = page
    .map((v) => {
      const areaName =
        v.areas?.name ||
        allAreas.find((a) => a.id === v.assigned_area)?.name ||
        "—";
      const tableName = v.tables?.name || "—";
      const isCompleted = v.status === "Done" || !!v.completed_at;
      const notesDisplay = v.notes ? truncateNotes(v.notes) : "";
      return `
      <div class="py-3 border-b border-[#F0EDE8] last:border-0">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-4">
            <div class="text-center min-w-[52px]">
              <p class="font-display text-lg text-[#28547C] leading-none">${fmt.time(v.visit_time)}</p>
            </div>
            <div>
              <p class="font-medium text-sm text-[#222] flex flex-wrap items-center gap-1.5">
                <span>${v.guests ? formatGuestName(v.guests) : "—"} ${memberBadge(v.guest_id)}</span>
                ${(() => {
                  const tier = v.guests?.spending_tier;
                  const tag = v.guests?.tag
                    ? v.guests.tag
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(-1)[0]
                    : null;
                  return `${tier ? formatSpendingTierBadge(tier) : ""}${tag ? `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F3F4F6] text-[#555]">${escapeHtml(tag)}</span>` : ""}`;
                })()}
              </p>
              <p class="text-xs text-[#999] mt-1.5">${fmt.pax(v.pax)} · ${areaName}${tableName ? " · " + tableName : ""}</p>
              ${renderGuestExtras(v.guests, v._visitCount)}
              ${notesDisplay ? `<p class="text-xs text-[#999] mt-1 flex items-start gap-1"><span>📝</span><span>${escapeHtml(notesDisplay)}</span></p>` : ""}
            </div>
          </div>
          <div class="flex items-center gap-3">
            ${
              isCompleted
                ? '<span class="text-xs text-[#5F8D4E]">✓ Done</span>'
                : '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700"><span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Active</span>'
            }
            <button onclick="openEditWalkIn('${v.id}')" class="text-xs text-[#C8A96B] hover:underline">Edit</button>
            ${!isCompleted ? `<button onclick="openCompleteVisit('${v.id}','visit')" class="text-xs text-[#C8A96B] hover:underline">Complete</button>` : ""}
            ${waThankYouVisitBtn(v)}
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

// ============================================================
// GUEST MANAGEMENT
// ============================================================

// Cache for guest-page visit history (counts + last visit dates).
// Shared across all loadGuests() calls; invalidated when a visit is saved.
let _guestVisitHistoryCache = null; // { countMap, lastVisitMap } | null
let _guestVisitHistoryCacheTime = 0;
const GUEST_VISIT_HISTORY_TTL = 5 * 60 * 1000; // 5 minutes

function invalidateGuestVisitHistoryCache() {
  _guestVisitHistoryCache = null;
  _guestVisitHistoryCacheTime = 0;
}

async function loadGuests(search = "") {
  try {
    let query = db
      .from("guests")
      .select(
        "id, name, phone, company, gender, created_at, spending_tier, tier_source, tag, booking_alias",
      );

    if (search) {
      const s = search.toLowerCase();
      query = query.or(
        `name.ilike.%${s}%,phone.ilike.%${s}%,company.ilike.%${s}%`,
      );
    }

    if (guestTierFilter === "none") {
      query = query.is("spending_tier", null);
    } else if (guestTierFilter !== "all") {
      query = query.eq("spending_tier", guestTierFilter);
    }

    const { data, error } = await query.order("name");
    if (error) {
      throw error;
    }
    allGuests = data || [];
    // EGRESS FIX: bulk client-side tier recalculation removed. The database
    // triggers (visits_recalculate_guest_spending_tier) already keep tiers
    // correct on every visit change. The old code re-downloaded ALL spend
    // visits for ALL guests every 10 minutes — the main egress hog.
    await renderGuestsTable(allGuests);
  } catch (error) {
    console.error("Failed to load guests", error);
    toast("Failed to load guests", "error");
  }
}

function toggleGuestSort(key) {
  console.log("test");
  if (guestSortKey === key) {
    guestSortDir = guestSortDir === "asc" ? "desc" : "asc";
  } else {
    guestSortKey = key;
    guestSortDir = key === "lastVisit" ? "desc" : "asc"; // sensible defaults
  }
  updateGuestSortIcons();
  guestPage = 1;
  loadGuests(document.getElementById("guest-search")?.value || "");
}

function updateGuestSortIcons() {
  const keys = ["name", "visits", "lastVisit"];
  const up = "▲";
  const down = "▼";
  keys.forEach((k) => {
    const el = document.getElementById(`sort-icon-${k}`);
    if (!el) return;
    if (k === guestSortKey) {
      el.textContent = guestSortDir === "asc" ? up : down;
      el.className = "text-[#C8A96B]"; // gold — active
    } else {
      el.textContent = el.textContent ? "⬦" : ""; // subtle inactive hint
      el.textContent = "⬦";
      el.className = "text-[#CCC] text-[10px]"; // grey — inactive
    }
  });
}

async function renderGuestsTable(guests) {
  const tbody = document.getElementById("guests-tbody");
  if (!tbody) return;

  // Get visit counts + last visit — use cache to avoid re-fetching on every
  // loadGuests() call (search, filter, sort, page change). Cache TTL = 5 min.
  const now = Date.now();
  if (
    !_guestVisitHistoryCache ||
    now - _guestVisitHistoryCacheTime >= GUEST_VISIT_HISTORY_TTL
  ) {
    // EGRESS FIX: counting + last-visit-date now happens server-side via
    // RPC instead of downloading every row of the visits table.
    const { data: visitSummary, error: visitCountError } = await supabaseQuery(
      () => db.rpc("get_guest_visit_summary"),
      "Failed to load visit counts",
    );

    if (visitCountError) toast("Unable to load guest visit history", "error");

    const countMap = {};
    const lastVisitMap = {};
    (visitSummary || []).forEach((v) => {
      countMap[v.guest_id] = Number(v.visit_count);
      lastVisitMap[v.guest_id] = v.last_visit_date;
    });
    _guestVisitHistoryCache = { countMap, lastVisitMap };
    _guestVisitHistoryCacheTime = now;
  }

  const { countMap, lastVisitMap } = _guestVisitHistoryCache;

  // Populate tag dropdown from all loaded guests (before filtering)
  const tagDropdown = document.getElementById("guest-tag-filter");
  if (tagDropdown) {
    const allTags = [
      ...new Set(
        guests.flatMap((g) =>
          g.tag
            ? g.tag
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
        ),
      ),
    ].sort();
    const currentTagVal = tagDropdown.value;
    tagDropdown.innerHTML =
      `<option value="">All Tags</option>` +
      allTags
        .map(
          (t) =>
            `<option value="${escapeHtml(t)}" ${currentTagVal === t ? "selected" : ""}>${escapeHtml(t)}</option>`,
        )
        .join("");
  }

  // Apply client-side filters (visit count, tag, last visit date range)
  let filtered = guests.filter((g) => {
    const visits = countMap[g.id] || 0;
    const lastVisit = lastVisitMap[g.id] || null;

    // Min visits filter
    if (guestMinVisits > 0 && visits < guestMinVisits) return false;

    // Tag filter
    if (guestTagFilter) {
      const guestTags = g.tag
        ? g.tag.split(",").map((t) => t.trim().toLowerCase())
        : [];
      if (!guestTags.includes(guestTagFilter.toLowerCase())) return false;
    }

    // Last visit date range
    if (guestLastVisitFrom && (!lastVisit || lastVisit < guestLastVisitFrom))
      return false;
    if (guestLastVisitTo && (!lastVisit || lastVisit > guestLastVisitTo))
      return false;

    return true;
  });

  // Reset to page 1 if the current page exceeds the filtered results
  const totalPages = Math.ceil(filtered.length / GUEST_PAGE_SIZE) || 1;
  if (guestPage > totalPages) guestPage = totalPages;

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="px-5 py-8 text-center text-[#bbb] text-sm">No guests match the current filters</td></tr>';
    renderGuestPagination(0);
    return;
  }

  // Apply sort
  filtered.sort((a, b) => {
    let valA, valB;
    if (guestSortKey === "name") {
      valA = (a.name || "").toLowerCase();
      valB = (b.name || "").toLowerCase();
      return guestSortDir === "asc"
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
    }
    if (guestSortKey === "visits") {
      valA = countMap[a.id] || 0;
      valB = countMap[b.id] || 0;
    } else if (guestSortKey === "lastVisit") {
      valA = lastVisitMap[a.id] || "";
      valB = lastVisitMap[b.id] || "";
    }
    if (valA < valB) return guestSortDir === "asc" ? -1 : 1;
    if (valA > valB) return guestSortDir === "asc" ? 1 : -1;
    return 0;
  });

  // Refresh sort icons in case table was re-rendered without toggleGuestSort
  updateGuestSortIcons();

  // Paginate
  const start = (guestPage - 1) * GUEST_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + GUEST_PAGE_SIZE);

  tbody.innerHTML = pageRows
    .map((g) => {
      const visits = countMap[g.id] || 0;
      const lastVisit = lastVisitMap[g.id];
      return `
      <tr class="table-row border-b border-[#F5F3EF]">
        <td class="px-5 py-3.5">
          <div class="flex items-center gap-3">
            <div style="width:32px;height:32px;background:#EEF3F7;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#28547C;">
              ${g.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p class="font-medium text-sm text-[#222]">${formatGuestName(g)} ${memberBadge(g.id)}</p>
              ${visits > 1 ? '<span class="text-[10px] text-[#C8A96B] font-medium uppercase tracking-wide">Returning</span>' : ""}
            </div>
          </div>
        </td>
        <td class="px-5 py-3.5 text-sm text-[#555]">${g.phone || "—"}</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">${g.company || "—"}</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden">${
          g.tag
            ? g.tag
                .split(",")
                .map(
                  (t) =>
                    `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F3F4F6] text-[#555] mr-1">${escapeHtml(t.trim())}</span>`,
                )
                .join("")
            : "—"
        }</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">${formatSpendingTierBadge(g.spending_tier)}</td>
        <td class="px-5 py-3.5 hidden md:table-cell">
          <span class="font-display text-lg text-[#28547C]">${visits}</span>
        </td>
        <td class="px-5 py-3.5 text-sm text-[#999]">${fmt.date(lastVisit)}</td>
        <td class="px-5 py-3.5 text-right">
          <div class="flex items-center justify-end gap-1">
            <button onclick="event.stopPropagation(); viewGuestProfile('${g.id}')" title="View guest profile" class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#EEF3F7] text-[#999] hover:text-[#5596CE] transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button onclick="event.stopPropagation(); editGuest('${g.id}')" title="Edit guest" class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#FBF8EE] text-[#999] hover:text-[#C8A96B] transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
                </td>
      </tr>
    `;
    })
    .join("");

  renderGuestPagination(filtered.length);
}

function renderGuestPagination(totalFiltered) {
  const pagerEl = document.getElementById("guests-pager");
  if (!pagerEl) return;

  if (totalFiltered === 0) {
    pagerEl.innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(totalFiltered / GUEST_PAGE_SIZE);
  if (totalPages <= 1) {
    pagerEl.innerHTML = "";
    return;
  }

  const start = (guestPage - 1) * GUEST_PAGE_SIZE + 1;
  const end = Math.min(guestPage * GUEST_PAGE_SIZE, totalFiltered);

  pagerEl.innerHTML = `
    <div class="flex items-center justify-between px-5 py-3 text-xs text-[#999]">
      <span>${start}–${end} of ${totalFiltered} guests</span>
      <div class="flex items-center gap-1.5">
        <button onclick="goGuestPage(${guestPage - 1})"
          class="w-7 h-7 flex items-center justify-center rounded-lg border border-[#EDE9E3] transition-colors ${guestPage <= 1 ? "opacity-30 cursor-not-allowed" : "hover:border-[#5596CE] hover:text-[#5596CE]"}"
          ${guestPage <= 1 ? "disabled" : ""} title="Previous">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="px-2 text-[#28547C] font-medium">${guestPage} / ${totalPages}</span>
        <button onclick="goGuestPage(${guestPage + 1})"
          class="w-7 h-7 flex items-center justify-center rounded-lg border border-[#EDE9E3] transition-colors ${guestPage >= totalPages ? "opacity-30 cursor-not-allowed" : "hover:border-[#5596CE] hover:text-[#5596CE]"}"
          ${guestPage >= totalPages ? "disabled" : ""} title="Next">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  `;
}

function goGuestPage(page) {
  guestPage = page;
  loadGuests(document.getElementById("guest-search")?.value || "");
}

// ============================================================
// KEBAB PORTAL MENU
// A single floating menu appended to <body> to escape overflow:hidden parents.
// ============================================================
let _kebabPortal = null;
let _kebabCloseHandler = null;

function _getOrCreateKebabPortal() {
  if (!_kebabPortal) {
    _kebabPortal = document.createElement("div");
    _kebabPortal.id = "kebab-portal";
    _kebabPortal.style.cssText =
      "position:fixed;z-index:9999;display:none;background:white;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);border:1px solid #EDE9E3;min-width:130px;overflow:hidden;";
    document.body.appendChild(_kebabPortal);
  }
  return _kebabPortal;
}

function closeKebabPortal() {
  const portal = _getOrCreateKebabPortal();
  portal.style.display = "none";
  portal.innerHTML = "";
  if (_kebabCloseHandler) {
    document.removeEventListener("click", _kebabCloseHandler, true);
    _kebabCloseHandler = null;
  }
}

function toggleKebab(btn) {
  const portal = _getOrCreateKebabPortal();

  // If already open for this button, close it
  if (portal.style.display !== "none" && portal._anchorBtn === btn) {
    closeKebabPortal();
    return;
  }

  // Read innerHTML from the hidden sibling template
  const template = btn.nextElementSibling;
  if (!template) return;
  portal.innerHTML = template.innerHTML;
  portal._anchorBtn = btn;

  // Position: anchor to button, flip up if near bottom
  const rect = btn.getBoundingClientRect();
  const menuHeight = portal.childElementCount * 44 || 90;
  const spaceBelow = window.innerHeight - rect.bottom;

  portal.style.display = "block";
  portal.style.right = window.innerWidth - rect.right + "px";
  portal.style.left = "auto";

  if (spaceBelow < menuHeight + 8) {
    portal.style.top = "auto";
    portal.style.bottom = window.innerHeight - rect.top + 4 + "px";
  } else {
    portal.style.bottom = "auto";
    portal.style.top = rect.bottom + 4 + "px";
  }

  // Close on next click anywhere
  setTimeout(() => {
    _kebabCloseHandler = function (e) {
      if (!portal.contains(e.target) && e.target !== btn) {
        closeKebabPortal();
      }
    };
    document.addEventListener("click", _kebabCloseHandler, true);
  }, 0);
}

let searchTimeout;
function searchGuests(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    guestPage = 1;
    loadGuests(val);
  }, 300);
}

// Spending Insights tag filters
let wiTagFilters = [];
let wiTagFilterMode = "any"; // 'any' | 'latest'

function renderWiTagPills() {
  const wrap = document.getElementById("wi-tag-pills");
  if (!wrap) return;
  wrap.innerHTML = "";
  (wiTagFilters || []).forEach((t, i) => {
    const span = document.createElement("span");
    span.className = "tag-pill";
    span.innerHTML = `${escapeHtml(t)} <button type="button" onclick="removeWiTag(${i})" aria-label="Remove tag"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 10 10" fill="none"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="white" stroke-width="1.8" stroke-linecap="round"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    wrap.appendChild(span);
  });
}

function addWiTag(tag) {
  if (!tag) return;
  tag = String(tag).trim();
  if (!tag) return;
  if (wiTagFilters.find((t) => t.toLowerCase() === tag.toLowerCase())) return;
  wiTagFilters.push(tag);
  renderWiTagPills();
  loadWalkInSpendingInsights();
}

function removeWiTag(index) {
  wiTagFilters = (wiTagFilters || []).filter((_, i) => i !== index);
  renderWiTagPills();
  loadWalkInSpendingInsights();
}

function handleWiTagKey(e) {
  const input = e.target;
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addWiTag(input.value);
    input.value = "";
    const sugg = document.getElementById("wi-tag-suggestions");
    if (sugg) sugg.classList.add("hidden");
  } else if (e.key === "Backspace" && input.value === "") {
    if (wiTagFilters.length) removeWiTag(wiTagFilters.length - 1);
  }
}

function updateWiTagSuggestions(q) {
  const container = document.getElementById("wi-tag-suggestions");
  if (!container) return;
  q = (q || "").trim();
  if (!q) {
    container.classList.add("hidden");
    return;
  }
  const existing = (wiTagFilters || []).map((t) => t.toLowerCase());
  const filtered = (window.guestTagSuggestions || [])
    .filter(
      (t) =>
        t.toLowerCase().includes(q.toLowerCase()) &&
        !existing.includes(t.toLowerCase()),
    )
    .slice(0, 8);
  if (!filtered.length) {
    container.classList.add("hidden");
    return;
  }
  container.innerHTML = filtered
    .map(
      (t) =>
        `<div class="tag-suggestion-item" onclick="(function(){ addWiTag(decodeURIComponent('${encodeURIComponent(t)}')); const c=document.getElementById(\'wi-tag-suggestions\'); if(c)c.classList.add('hidden'); document.getElementById('wi-tag-input').value=''; })()">${escapeHtml(t)}</div>`,
    )
    .join("");
  container.classList.remove("hidden");
}

function updateWiTagFilterMode(v) {
  wiTagFilterMode = v === "latest" ? "latest" : "any";
  loadWalkInSpendingInsights();
}

async function exportSpendingInsights() {
  const { from, to } = getWiReportDateRange();
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select(
          "id, visit_date, pax, spend_amount, guest_id, status, completed_at, guests(id,name,phone,spending_tier,tag)",
        )
        .eq("visit_type", "Walk-In")
        .gt("spend_amount", 0)
        .gte("visit_date", from)
        .lte("visit_date", to)
        .or("status.eq.Done,completed_at.not.is.null")
        .neq("pax", 0)
        .is("voided_at", null),
    "Failed to load visits for export",
  );

  if (error || !data) {
    toast("Failed to prepare export", "error");
    return;
  }

  // apply same filters: spending tier and tags
  const isMediumTier = wiSpendingTierFilter === "medium_spender";
  const rows = (data || []).filter(
    (v) =>
      wiSpendingTierFilter === "all" ||
      v.guests?.spending_tier === wiSpendingTierFilter,
  );
  const tagFilters = (wiTagFilters || []).map((t) => t.toLowerCase());
  function matchTags(guest) {
    if (!tagFilters.length) return true;
    const tags = (guest?.tag || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    if (!tags.length) return false;
    if (wiTagFilterMode === "latest") {
      const latest = tags[tags.length - 1];
      return tagFilters.includes(latest);
    }
    return tags.some((t) => tagFilters.includes(t));
  }

  const filtered = rows.filter((r) => matchTags(r.guests || {}));

  // aggregate per guest
  const map = new Map();
  (filtered || []).forEach((v) => {
    const g = v.guests;
    if (!g) return;
    const id = g.id || v.guest_id || "unknown-" + (g.phone || "");
    const entry = map.get(id) || {
      guestName: g.name || "",
      phone: g.phone || "",
      tags: g.tag || "",
      spendingTier: g.spending_tier || "",
      visitCount: 0,
      totalSpend: 0,
      totalPax: 0,
      lastVisit: null,
    };
    entry.visitCount += 1;
    entry.totalSpend += Number(v.spend_amount || 0);
    entry.totalPax += Number(v.pax || 0);
    if (
      !entry.lastVisit ||
      (v.visit_date && new Date(v.visit_date) > new Date(entry.lastVisit))
    )
      entry.lastVisit = v.visit_date;
    map.set(id, entry);
  });

  const rowsOut = Array.from(map.values()).map((e) => ({
    guestName: e.guestName,
    phone: e.phone,
    latestTag: e.tags
      ? e.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(-1)[0] || ""
      : "",
    allTags: e.tags || "",
    visitCount: e.visitCount,
    avgSpendPerPerson: e.totalPax ? Math.round(e.totalSpend / e.totalPax) : 0,
    totalSpend: e.totalSpend,
    lastVisit: e.lastVisit ? fmt.date(e.lastVisit) : "",
    spendingSegment: e.spendingTier || "",
  }));

  // CSV
  const headers = [
    "Guest Name",
    "Phone Number",
    "Latest Tag",
    "All Tags",
    "Visit Count",
    "Average Spend Per Person",
    "Total Spend",
    "Last Visit Date",
    "Spending Segment",
  ];
  const csv = [headers.join(",")]
    .concat(
      rowsOut.map((r) =>
        [
          r.guestName,
          r.phone,
          r.latestTag,
          `"${r.allTags}"`,
          r.visitCount,
          r.avgSpendPerPerson,
          r.totalSpend,
          r.lastVisit,
          r.spendingSegment,
        ].join(","),
      ),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spending-insights-export-${TODAY}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Export started");
}

function applyGuestFilters() {
  guestTierFilter =
    document.getElementById("guest-tier-filter")?.value || "all";
  guestTagFilter = document.getElementById("guest-tag-filter")?.value || "";
  guestMinVisits = parseInt(
    document.getElementById("guest-visits-filter")?.value || "0",
    10,
  );
  guestLastVisitFrom =
    document.getElementById("guest-lastvisit-from")?.value || "";
  guestLastVisitTo = document.getElementById("guest-lastvisit-to")?.value || "";
  guestPage = 1;
  loadGuests(document.getElementById("guest-search")?.value || "");
}

function filterGuestsByTier(value) {
  guestTierFilter = value || "all";
  guestPage = 1;
  loadGuests(document.getElementById("guest-search")?.value || "");
}

function resetGuestFilters() {
  guestTierFilter = "all";
  guestTagFilter = "";
  guestMinVisits = 0;
  guestLastVisitFrom = "";
  guestLastVisitTo = "";
  const search = document.getElementById("guest-search");
  const tier = document.getElementById("guest-tier-filter");
  const tag = document.getElementById("guest-tag-filter");
  const visits = document.getElementById("guest-visits-filter");
  const from = document.getElementById("guest-lastvisit-from");
  const to = document.getElementById("guest-lastvisit-to");
  if (search) search.value = "";
  if (tier) tier.value = "all";
  if (tag) tag.value = "";
  if (visits) visits.value = "0";
  if (from) from.value = "";
  if (to) to.value = "";
  guestPage = 1;
  loadGuests("");
}

function openGuestModal(guest = null) {
  document.getElementById("guest-modal-title").textContent = guest
    ? "Edit Guest"
    : "New Guest";
  document.getElementById("guest-edit-id").value = guest?.id || "";
  // Raw, not cleaned — prefilling the cleaned name would make the next
  // save silently rewrite the record.
  document.getElementById("g-name").value = guest?.name || "";
  updateGuestNameHint(guest?.name || "");
  document.getElementById("g-phone").value = guest?.phone || "";
  document.getElementById("g-gender").value = guest?.gender || "";
  document.getElementById("g-birthday").value = guest?.birthday || "";
  document.getElementById("g-company").value = guest?.company || "";
  document.getElementById("g-allergy").value = guest?.food_allergy || "";
  document.getElementById("g-last-order").value = guest?.last_order || "";
  document.getElementById("g-preference").value = guest?.preference || "";
  document.getElementById("g-favorite-menu").value =
    guest?.favorite_menu || "";
  // initialize modal tags (stored as comma-separated string in DB)
  window.modalGuestTags = [];
  if (guest?.tag) {
    window.modalGuestTags = guest.tag
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  renderGuestModalTags();
  loadGuestTagSuggestions();
  document.getElementById("g-notes").value = guest?.notes || "";
  const dncEl = document.getElementById("g-do-not-contact");
  if (dncEl) dncEl.checked = !!guest?.do_not_contact;
  const tierSelect = document.getElementById("g-spending-tier");
  if (tierSelect) {
    if (guest?.tier_source === "manual") {
      tierSelect.value = guest?.spending_tier || "none";
    } else {
      tierSelect.value = "auto";
    }
  }
  showModal("modal-guest");
}

async function editGuest(id) {
  // If the guest profile panel is open, close it before opening the edit form
  hideModal("modal-profile");

  const { data, error } = await supabaseQuery(
    () => db.from("guests").select("*").eq("id", id).single(),
    "Failed to load guest details",
  );
  if (error) return;
  if (data) openGuestModal(data);
}

// =========================
// Guest Tag UI helpers
// =========================
window.modalGuestTags = window.modalGuestTags || [];
window.guestTagSuggestions = window.guestTagSuggestions || [];

function renderGuestModalTags() {
  const pills = document.getElementById("g-tag-pills");
  const input = document.getElementById("g-tag-input");
  if (!pills || !input) return;
  pills.innerHTML = "";
  (window.modalGuestTags || []).forEach((t, i) => {
    const span = document.createElement("span");
    span.className = "tag-pill";
    span.innerHTML = `${escapeHtml(t)} <button type="button" onclick="removeModalTag(${i})" aria-label="Remove tag"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 10 10" fill="none"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="white" stroke-width="1.8" stroke-linecap="round"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    pills.appendChild(span);
  });
  input.value = "";
  const sugg = document.getElementById("g-tag-suggestions");
  if (sugg) sugg.classList.add("hidden");
}

function addModalTag(tag) {
  if (!tag) return;
  tag = String(tag).trim();
  if (!tag) return;
  const list = window.modalGuestTags || [];
  if (list.find((t) => t.toLowerCase() === tag.toLowerCase())) return;
  list.push(tag);
  window.modalGuestTags = list;
  renderGuestModalTags();
}

function removeModalTag(index) {
  window.modalGuestTags = (window.modalGuestTags || []).filter(
    (_, i) => i !== index,
  );
  renderGuestModalTags();
}

function handleTagKey(e) {
  const input = e.target;
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addModalTag(input.value);
  } else if (e.key === "Backspace" && input.value === "") {
    const list = window.modalGuestTags || [];
    if (list.length) {
      removeModalTag(list.length - 1);
    }
  }
}

function selectTagSuggestion(tag) {
  addModalTag(tag);
  const sugg = document.getElementById("g-tag-suggestions");
  if (sugg) sugg.classList.add("hidden");
  const input = document.getElementById("g-tag-input");
  if (input) input.focus();
}

function updateTagSuggestions(q) {
  const container = document.getElementById("g-tag-suggestions");
  if (!container) return;
  q = (q || "").trim();
  if (!q) {
    container.classList.add("hidden");
    return;
  }
  const existing = (window.modalGuestTags || []).map((t) => t.toLowerCase());
  const filtered = (window.guestTagSuggestions || [])
    .filter(
      (t) =>
        t.toLowerCase().includes(q.toLowerCase()) &&
        !existing.includes(t.toLowerCase()),
    )
    .slice(0, 8);
  if (!filtered.length) {
    container.classList.add("hidden");
    return;
  }
  container.innerHTML = filtered
    .map(
      (t) =>
        `<div class="tag-suggestion-item" onclick="selectTagSuggestion(decodeURIComponent('${encodeURIComponent(t)}'))">${escapeHtml(t)}</div>`,
    )
    .join("");
  container.classList.remove("hidden");
}

async function loadGuestTagSuggestions() {
  if (window.guestTagSuggestionsLoaded) return;
  try {
    const { data, error } = await supabaseQuery(
      () => db.from("guests").select("tag").not("tag", "is", null),
      "Failed to load tag suggestions",
    );
    if (error || !data) return;
    const set = new Set(window.guestTagSuggestions || []);
    data.forEach((r) => {
      if (!r.tag) return;
      r.tag
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((t) => set.add(t));
    });
    window.guestTagSuggestions = Array.from(set);
    window.guestTagSuggestionsLoaded = true;
  } catch (err) {
    console.error("Tag suggestions load failed", err);
  }
}

async function saveGuest() {
  const id = document.getElementById("guest-edit-id").value;
  const tierEl = document.getElementById("g-spending-tier");
  // Only fall back to 'auto' for NEW guests; for edits, keep existing tier if dropdown is somehow empty
  const tierSelection = tierEl?.value || (id ? null : "auto");
  const rawPhone = document.getElementById("g-phone").value.trim();
  const payload = {
    name: document.getElementById("g-name").value.trim(),
    phone: normalizePhone(rawPhone) || null,
    tag:
      window.modalGuestTags && window.modalGuestTags.length
        ? window.modalGuestTags.join(",")
        : null,
    gender: document.getElementById("g-gender").value || null,
    birthday: document.getElementById("g-birthday").value || null,
    company: document.getElementById("g-company").value.trim() || null,
    food_allergy: document.getElementById("g-allergy").value.trim() || null,
    last_order: document.getElementById("g-last-order").value.trim() || null,
    preference: document.getElementById("g-preference").value.trim() || null,
    favorite_menu:
      document.getElementById("g-favorite-menu").value.trim() || null,
    notes: document.getElementById("g-notes").value.trim() || null,
    do_not_contact:
      document.getElementById("g-do-not-contact")?.checked || false,
  };

  if (tierSelection === "auto") {
    payload.spending_tier = null;
    payload.tier_source = "auto";
    payload.tier_last_calculated_at = null;
  } else if (tierSelection === "none") {
    payload.spending_tier = null;
    payload.tier_source = "manual";
    payload.tier_last_calculated_at = new Date().toISOString();
  } else if (tierSelection) {
    payload.spending_tier = tierSelection;
    payload.tier_source = "manual";
    payload.tier_last_calculated_at = new Date().toISOString();
  }
  // if tierSelection is null (fallback safety), don't touch tier fields at all

  if (!id) payload.created_by = currentStaffId();

  if (!payload.name) {
    toast("Guest name is required", "error");
    return;
  }

  loader(true);
  const saveGuestRow = (body) =>
    supabaseQuery(
      () =>
        id
          ? db.from("guests").update(body).eq("id", id)
          : db.from("guests").insert(body),
      id ? "Failed to update guest" : "Failed to create guest",
    );

  let { error } = await saveGuestRow(payload);

  // A client database that has not had the latest migrations_ALL_IN_ONE run
  // is missing whichever column this app version added most recently, and
  // PostgREST rejects the WHOLE update for one unknown column. So a form that
  // was working yesterday silently stops saving anything — including the food
  // allergy, which is the field that matters most.
  //
  // This happened for real on 2026-09-02, hours after guests.last_order was
  // added to this payload: an allergy typed into the guest form never reached
  // the database and nobody could see why.
  //
  // Rather than lose the whole edit, drop the column the database does not
  // have, save the rest, and say plainly what is missing and how to fix it.
  const missingColumn = error && guestMissingColumnFrom(error, payload);
  if (missingColumn) {
    const retryPayload = { ...payload };
    delete retryPayload[missingColumn];
    ({ error } = await saveGuestRow(retryPayload));
    if (!error) {
      toast(
        `Saved, but "${missingColumn}" was skipped: this database is missing that column. Run migrations/ALL_IN_ONE.sql.`,
        "error",
      );
    }
  }
  loader(false);

  if (error) {
    toast(error.message || "Failed to save guest", "error");
    return;
  }
  if (tierSelection === "auto") await updateGuestSpendingTier(id || null);
  // Note: if tierSelection is null (safety fallback), we skip recalc to preserve existing tier
  toast(id ? "Guest updated" : "Guest created");
  hideModal("modal-guest");
  guestPage = 1;
  loadGuests();
}

async function viewGuestProfile(guestId) {
  const { data: guest, error: guestError } = await supabaseQuery(
    () => db.from("guests").select("*").eq("id", guestId).single(),
    "Failed to load guest profile",
  );
  const { data: visits, error: visitError } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("*, areas(name)")
        .eq("guest_id", guestId)
        .is("voided_at", null)
        .order("visit_date", { ascending: false })
        .limit(10),
    "Failed to load guest visits",
  );

  // Average spend must reflect ALL of the guest's completed visits, not
  // just the 10 shown in the history list below — otherwise a loyal guest
  // with a long history would show a skewed "recent 10" average instead of
  // their true lifetime average. Only spend_amount is fetched (lightweight).
  const { data: spendRows } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("spend_amount")
        .eq("guest_id", guestId)
        .is("voided_at", null)
        .not("spend_amount", "is", null)
        .gt("spend_amount", 0),
    "Failed to load guest spend history",
  );
  const validSpends = (spendRows || []).map((v) => v.spend_amount);
  const avgSpend = validSpends.length
    ? Math.round(
        validSpends.reduce((sum, v) => sum + v, 0) / validSpends.length,
      )
    : null;

  if (guestError) return;

  const content = document.getElementById("profile-content");
  if (!guest) return;

  content.innerHTML = `
    <div class="flex items-start gap-4 mb-6">
      <div style="width:52px;height:52px;background:#EEF3F7;border-radius:50%;display:flex;align-items:center;justify-content:center;font-display;font-size:22px;font-weight:600;color:#28547C;flex-shrink:0;">
        ${guest.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <h3 class="font-display text-2xl font-semibold text-[#28547C]">${guest.name}</h3>
        <p class="text-sm text-[#666]">${guest.phone}${guest.company ? " · " + guest.company : ""}</p>
        ${
          memberBadgeMap[guest.id]
            ? `<div class="mt-2 flex flex-wrap items-center gap-2">${memberBadge(guest.id)}
                 <span class="text-xs text-[#777]">${memberBadgeMap[guest.id].total_stickers} sticker${memberBadgeMap[guest.id].total_stickers === 1 ? "" : "s"}${memberBadgeMap[guest.id].available_vouchers > 0 ? ` · ${memberBadgeMap[guest.id].available_vouchers} voucher${memberBadgeMap[guest.id].available_vouchers > 1 ? "s" : ""} available` : ""}</span>
                 <button onclick="hideModal('modal-profile');viewMemberDetail(${memberBadgeMap[guest.id].id})" class="text-xs text-[#28547C] underline">Open member card</button>
               </div>`
            : ""
        }
        ${
          guest.tag
            ? `<div class="mt-2">${guest.tag
                .split(",")
                .map(
                  (t) =>
                    `<span class="inline-block text-sm text-[#666] bg-[#F3F6F8] px-3 py-1 rounded-full mr-2">${escapeHtml(t.trim())}</span>`,
                )
                .join("")}</div>`
            : ""
        }
        <div class="mt-2 flex flex-wrap items-center gap-2">
          ${formatSpendingTierBadge(guest.spending_tier)}
          ${guest.tier_source === "manual" ? '<span class="text-[11px] text-[#999]">Manual override</span>' : '<span class="text-[11px] text-[#999]">Auto-calculated</span>'}
        </div>
        <p class="text-xs text-[#999] mt-1">Member since ${fmt.date(guest.created_at)}</p>
      </div>
      <button onclick="editGuest('${guest.id}')" class="btn-ghost text-xs ml-auto">Edit</button>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="p-3 bg-[#EEF3F7] rounded-10 border border-[#D6E3EE]">
        <p class="text-[10px] text-[#5596CE] uppercase tracking-wider mb-1">Average Spend</p>
        <p class="font-display text-lg text-[#28547C]">${avgSpend !== null ? fmt.currency(avgSpend) : "—"}</p>
        <p class="text-[10px] text-[#999] mt-0.5">${validSpends.length ? `across ${validSpends.length} visit${validSpends.length === 1 ? "" : "s"} with spend recorded` : "no spend recorded yet"}</p>
      </div>
      <div class="p-3 bg-[#FBF8EE] rounded-10 border border-[#E8E0D0]" id="fav-menu-card-${guest.id}">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[10px] text-[#C8A96B] uppercase tracking-wider">Favorite</p>
          <button onclick="startEditFavoriteMenu('${guest.id}')" class="text-[#999] hover:text-[#28547C] transition-colors" title="Edit favorite menu">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
        <div id="fav-menu-view-${guest.id}">
          <p class="text-sm text-[#333]" id="fav-menu-text-${guest.id}">${guest.favorite_menu ? escapeHtml(guest.favorite_menu) : "—"}</p>
          <!-- The old caption said "from last recorded visit", which was true
               of the field when it held both meanings and is a lie now.
               Favorite only changes when someone changes it. -->
          <p class="text-[10px] text-[#999] mt-0.5">${
            guest.last_order
              ? `${t("Last order")}: ${escapeHtml(guest.last_order)}`
              : t("no order recorded yet")
          }</p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-5 text-sm">
      ${guest.food_allergy ? `<div class="p-3 bg-red-50 rounded-10 border border-red-100"><p class="text-[10px] text-red-400 uppercase tracking-wider mb-1">Allergy</p><p class="text-[#333]">${guest.food_allergy}</p></div>` : ""}
      ${guest.preference ? `<div class="p-3 bg-[#FBF8EE] rounded-10 border border-[#E8E0D0]"><p class="text-[10px] text-[#C8A96B] uppercase tracking-wider mb-1">Preference</p><p class="text-[#333]">${guest.preference}</p></div>` : ""}
      ${guest.notes ? `<div class="p-3 bg-[#F8F6F2] rounded-10 border border-[#EDE9E3] col-span-2"><p class="text-[10px] text-[#999] uppercase tracking-wider mb-1">Notes</p><p class="text-[#333]">${guest.notes}</p></div>` : ""}
    </div>

    <div class="divider mb-4"></div>
    <p class="text-xs text-[#999] uppercase tracking-wider mb-3 font-medium">Visit History (${visits?.length || 0} visits)</p>
    <div class="space-y-2 max-h-64 overflow-y-auto">
      ${
        (visits || [])
          .map((v) => {
            const isCompleted = v.status === "Done" || !!v.completed_at;
            return `
        <div class="flex items-center justify-between py-2 border-b border-[#F5F3EF] last:border-0" id="visit-row-${v.id}">
          <div>
            <p class="text-sm font-medium text-[#222]">${fmt.date(v.visit_date)}</p>
            <p class="text-xs text-[#999]">${v.visit_type} · ${fmt.pax(v.pax)} · ${v.areas?.name || "—"}</p>
          </div>
          <div class="flex items-center gap-2">
            <p class="text-sm text-[#28547C] font-medium" id="visit-spend-display-${v.id}">${fmt.currency(v.spend_amount)}</p>
            ${
              isCompleted
                ? `<button onclick="startEditVisitSpend('${v.id}', ${v.spend_amount || 0}, '${guestId}')" class="text-[#999] hover:text-[#28547C] transition-colors" title="Edit spending amount">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>`
                : ""
            }
          </div>
        </div>`;
          })
          .join("") ||
        '<p class="text-sm text-[#bbb] text-center py-4">No visits yet</p>'
      }
    </div>
  `;
  showModal("modal-profile");
}

// Lets staff/managers edit a guest's saved favorite menu / recent order
// directly from the Guest Profile — covers both correcting old data and
// updating it any time, not just at Complete Visit.
function startEditFavoriteMenu(guestId) {
  const viewEl = document.getElementById(`fav-menu-view-${guestId}`);
  const textEl = document.getElementById(`fav-menu-text-${guestId}`);
  if (!viewEl) return;
  const currentValue =
    textEl?.textContent === "—" ? "" : textEl?.textContent || "";

  // Give the card the full modal width while editing — it normally shares
  // a 2-column grid with "Average Spend", which left almost no room for
  // the input once Save/✕ sat next to it.
  document
    .getElementById(`fav-menu-card-${guestId}`)
    ?.classList.add("col-span-2");

  viewEl.innerHTML = `
    <div class="flex flex-col gap-2">
      <input
        id="fav-menu-input-${guestId}"
        type="text"
        value="${escapeHtml(currentValue)}"
        placeholder="e.g. Nasi Goreng, Es Teh Manis"
        class="w-full text-sm border border-[#D0DCE8] rounded-8 px-2.5 py-1.5 focus:outline-none focus:border-[#28547C] text-[#222]"
        onkeydown="if(event.key==='Enter')saveFavoriteMenu('${guestId}');if(event.key==='Escape')cancelEditFavoriteMenu('${guestId}','${escapeHtml(currentValue).replace(/'/g, "\\'")}');"
      />
      <div class="flex items-center justify-end gap-2">
        <button onclick="cancelEditFavoriteMenu('${guestId}','${escapeHtml(currentValue).replace(/'/g, "\\'")}')" class="text-xs font-medium text-[#999] hover:text-[#555] px-2 py-1.5 transition-colors">${t("Cancel")}</button>
        <button onclick="saveFavoriteMenu('${guestId}')" class="text-xs font-medium text-white bg-[#28547C] hover:bg-[#1f4060] px-3 py-1.5 rounded-6 transition-colors">${t("Save")}</button>
      </div>
    </div>
  `;
  setTimeout(() => {
    const input = document.getElementById(`fav-menu-input-${guestId}`);
    if (input) {
      input.focus();
      input.select();
    }
  }, 30);
}

function cancelEditFavoriteMenu(guestId, originalValue) {
  const viewEl = document.getElementById(`fav-menu-view-${guestId}`);
  if (!viewEl) return;
  document
    .getElementById(`fav-menu-card-${guestId}`)
    ?.classList.remove("col-span-2");
  viewEl.innerHTML = `
    <p class="text-sm text-[#333]" id="fav-menu-text-${guestId}">${originalValue ? escapeHtml(originalValue) : "—"}</p>
    <p class="text-[10px] text-[#999] mt-0.5">${originalValue ? "from last recorded visit" : "recorded at next Complete Visit"}</p>
  `;
}

async function saveFavoriteMenu(guestId) {
  const input = document.getElementById(`fav-menu-input-${guestId}`);
  if (!input) return;
  const newValue = input.value.trim();

  const saveBtn = input.parentElement?.querySelector("button");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "…";
  }

  const { error } = await supabaseQuery(
    () =>
      db
        .from("guests")
        .update({ favorite_menu: newValue || null })
        .eq("id", guestId),
    "Failed to save favorite menu",
  );

  if (error) {
    toast("Failed to save favorite menu. Please try again.", "error");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = t("Save");
    }
    return;
  }

  cancelEditFavoriteMenu(guestId, newValue);
  toast("Favorite menu updated");

  // Keep the dashboard's cached guest data in sync so rows showing this
  // guest immediately reflect the new value without a full reload.
  [dashboardResData, dashboardWalkinData].forEach((dataset) => {
    (dataset || []).forEach((row) => {
      if (row.guest_id === guestId && row.guests) {
        row.guests.favorite_menu = newValue || null;
      }
    });
  });
}

function startEditVisitSpend(visitId, currentAmount, guestId) {
  const row = document.getElementById(`visit-row-${visitId}`);
  if (!row) return;
  const displayEl = document.getElementById(`visit-spend-display-${visitId}`);
  const editBtn = row.querySelector('button[title="Edit spending amount"]');
  if (displayEl) displayEl.classList.add("hidden");
  if (editBtn) editBtn.classList.add("hidden");

  const wrapper = document.createElement("div");
  wrapper.id = `visit-spend-edit-${visitId}`;
  wrapper.className = "flex items-center gap-1.5";
  wrapper.innerHTML = `
    <span class="text-xs text-[#999]">Rp</span>
    <input
      id="visit-spend-input-${visitId}"
      type="number"
      min="0"
      step="1000"
      value="${currentAmount || ""}"
      class="w-28 text-right text-sm border border-[#D0DCE8] rounded-8 px-2 py-1 focus:outline-none focus:border-[#28547C] text-[#222]"
      onkeydown="if(event.key==='Enter')saveVisitSpend('${visitId}','${guestId}');if(event.key==='Escape')cancelEditVisitSpend('${visitId}',${currentAmount || 0});"
    />
    <button onclick="saveVisitSpend('${visitId}','${guestId}')" class="text-xs font-medium text-white bg-[#28547C] hover:bg-[#1f4060] px-2 py-1 rounded-6 transition-colors">Save</button>
    <button onclick="cancelEditVisitSpend('${visitId}',${currentAmount || 0})" class="text-xs font-medium text-[#999] hover:text-[#555] px-1 py-1 transition-colors">✕</button>
  `;

  const rightCol =
    displayEl?.parentElement || row.querySelector(".flex.items-center.gap-2");
  if (rightCol) rightCol.appendChild(wrapper);

  setTimeout(() => {
    const input = document.getElementById(`visit-spend-input-${visitId}`);
    if (input) {
      input.focus();
      input.select();
    }
  }, 30);
}

function cancelEditVisitSpend(visitId, originalAmount) {
  const wrapper = document.getElementById(`visit-spend-edit-${visitId}`);
  if (wrapper) wrapper.remove();
  const displayEl = document.getElementById(`visit-spend-display-${visitId}`);
  const row = document.getElementById(`visit-row-${visitId}`);
  const editBtn = row?.querySelector('button[title="Edit spending amount"]');
  if (displayEl) displayEl.classList.remove("hidden");
  if (editBtn) editBtn.classList.remove("hidden");
}

async function saveVisitSpend(visitId, guestId) {
  const input = document.getElementById(`visit-spend-input-${visitId}`);
  if (!input) return;
  const newAmount = parseFloat(input.value);
  if (isNaN(newAmount) || newAmount < 0) {
    toast("Please enter a valid spending amount", "error");
    input.focus();
    return;
  }

  const saveBtn = input.parentElement?.querySelector("button");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "…";
  }

  const { error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .update({
          spend_amount: newAmount,
          spend_updated_at: new Date().toISOString(),
          spend_updated_by: currentStaffId(),
        })
        .eq("id", visitId),
    "Failed to update spending amount",
  );

  if (error) {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
    return;
  }

  // Tier recalculates in DB via trigger; also refresh client-side immediately
  await updateGuestSpendingTier(guestId, true);

  // Membership: award sticker if guest is a member and this visit
  // hasn't been recorded yet (DB enforces once-per-visit).
  await maybeAwardMembershipSticker(guestId, newAmount, visitId);

  toast("Spending updated", "success");
  // Re-render the full profile to reflect new amount and any tier change
  await viewGuestProfile(guestId);
}

// ============================================================
// GUEST LOOKUP (shared for walk-in & reservation)
// ============================================================
// SHARED GUEST SEARCH COMPONENT
// ============================================================
let guestSearchTimeout = {};

async function searchGuestByNameOrPhone(prefix) {
  clearTimeout(guestSearchTimeout[prefix]);

  const nameEl = document.getElementById(`${prefix}-guest-search`);
  const resultsEl = document.getElementById(`${prefix}-guest-search-results`);

  if (!nameEl || !resultsEl) return;

  const searchTerm = cleanSearchTerm(nameEl.value);
  const normalizedSearch = normalizePhone(searchTerm) || searchTerm;

  if (searchTerm.length < 2) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML =
    '<div class="text-xs text-[#999] p-2">Searching...</div>';

  guestSearchTimeout[prefix] = setTimeout(async () => {
    const filters = [
      `name.ilike.%${searchTerm}%`,
      `phone.ilike.%${normalizedSearch}%`,
    ];

    const { data: guests, error } = await supabaseQuery(
      () =>
        db
          .from("guests")
          .select("id, name, phone, company")
          .or(filters.join(","))
          .order("name")
          .limit(8),
      "Failed to search guests",
    );

    if (error || !guests?.length) {
      renderGuestSearchResults(prefix, [], searchTerm);
      return;
    }

    // For walk-in, fetch visit counts
    if (prefix === "wi") {
      const { data: visits, error: visitError } = await supabaseQuery(
        () =>
          db
            .from("visits")
            .select("guest_id, visit_date")
            .in(
              "guest_id",
              guests.map((g) => g.id),
            )
            .is("voided_at", null)
            .order("visit_date", { ascending: false }),
        "Failed to load guest visit history",
      );

      if (!visitError && visits) {
        const countMap = {};
        (visits || []).forEach((v) => {
          countMap[v.guest_id] = (countMap[v.guest_id] || 0) + 1;
        });
        guests.forEach((g) => (g.visitCount = countMap[g.id] || 0));
      }
    }

    renderGuestSearchResults(prefix, guests, searchTerm);
  }, 300);
}

function renderGuestSearchResults(prefix, guests, searchTerm) {
  const resultsEl = document.getElementById(`${prefix}-guest-search-results`);
  if (!resultsEl) return;

  if (!guests.length) {
    resultsEl.innerHTML = `
      <div class="rounded-10 border border-[#E0DDD7] bg-white overflow-hidden">
        <div class="text-xs text-[#999] p-3 border-b border-[#F0EDE8]">
          No guests found
        </div>
        <button type="button" onclick="createNewGuestFromSearch('${prefix}')" class="w-full text-left px-3 py-2.5 bg-[#FAFAF8] text-xs text-[#C8A96B] font-medium hover:bg-[#F8F6F2]">
          + Create new guest
        </button>
      </div>
    `;
    return;
  }

  resultsEl.innerHTML = `
    <div class="rounded-10 border border-[#E0DDD7] bg-white overflow-hidden max-h-[200px] overflow-y-auto">
      ${guests
        .map(
          (g) => `
        <button type="button" 
          onclick="selectGuestFromSearch('${g.id}', '${prefix}')" 
          class="w-full text-left px-3 py-2 border-b border-[#F0EDE8] last:border-0 hover:bg-[#F8F6F2] transition-colors">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-medium text-[#222] truncate">${formatGuestName(g)} ${memberBadge(g.id)}</p>
              <p class="text-xs text-[#999] truncate">${g.phone ? escapeHtml(g.phone) : ""}${g.phone && g.company ? " · " : ""}${g.company ? escapeHtml(g.company) : ""}</p>
            </div>
            ${g.visitCount ? `<span class="text-xs text-[#999] shrink-0">${g.visitCount} visit${g.visitCount !== 1 ? "s" : ""}</span>` : ""}
          </div>
        </button>
      `,
        )
        .join("")}
      <button type="button" onclick="createNewGuestFromSearch('${prefix}')" class="w-full text-left px-3 py-2.5 bg-[#FAFAF8] text-xs text-[#C8A96B] font-medium hover:bg-[#F8F6F2] border-t border-[#F0EDE8]">
        + Create new guest
      </button>
    </div>
  `;
}

// Enables or disables the rest of the New Reservation form, and shows the
// hint that explains why it is greyed out.
//
// Gating survives a re-render of anything inside the fieldset (the table
// picker repaints on every date change), because `disabled` on a fieldset
// applies to descendants added after it was set.
function setResDetailsEnabled(enabled) {
  const fs = document.getElementById("res-details-fields");
  if (fs) fs.disabled = !enabled;
  document.getElementById("res-gate-hint")?.classList.toggle("hidden", enabled);
}

// Shows or hides the new-guest fields. There are TWO blocks, not one:
// name and phone sit directly under the guest search where they are typed,
// and gender and company sit at the very bottom because nobody taking a
// booking over the phone needs them before the date and the party size.
//
// Always toggle both through here. They describe the guest rather than the
// reservation, and saveReservation() only reads them when creating a new
// guest, so leaving either visible for an EXISTING guest offers a field that
// is silently ignored.
function setResNewGuestVisible(visible) {
  document.getElementById("res-new-guest")?.classList.toggle("hidden", !visible);
  document.getElementById("res-new-guest-extra")?.classList.toggle("hidden", !visible);
}

function createNewGuestFromSearch(prefix) {
  const resultsEl = document.getElementById(`${prefix}-guest-search-results`);
  if (resultsEl) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
  }

  if (prefix === "res") {
    setResNewGuestVisible(true);
    setResDetailsEnabled(true);
    document.getElementById("res-guest-info")?.classList.add("hidden");
    currentResGuestId = null;
    document.getElementById("res-guest-id").value = "";
    // Carry the name the staff already typed in the search box into the
    // new-guest form (fix: "guest name is required" after typing the name)
    document.getElementById("res-name").value =
      document.getElementById("res-guest-search")?.value.trim() || "";
    document.getElementById("res-new-guest-phone").value = "";
    populateAreaSelects();
  }
}

async function selectGuestFromSearch(guestId, prefix) {
  const { data: guest, error } = await supabaseQuery(
    () => db.from("guests").select("*").eq("id", guestId).single(),
    "Failed to load guest",
  );

  if (error || !guest) return;

  // Update the search input
  const searchEl = document.getElementById(`${prefix}-guest-search`);
  if (searchEl) searchEl.value = guest.name;

  // Hide results
  const resultsEl = document.getElementById(`${prefix}-guest-search-results`);
  if (resultsEl) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
  }

  // Update hidden guest ID
  const guestIdEl = document.getElementById(`${prefix}-guest-id`);
  if (guestIdEl) guestIdEl.value = guest.id;

  // Update phone input
  const phoneEl = document.getElementById(`${prefix}-phone`);
  if (phoneEl) phoneEl.value = guest.phone || "";

  // Show guest info
  const guestInfoEl = document.getElementById(`${prefix}-guest-info`);
  if (guestInfoEl) {
    guestInfoEl.classList.remove("hidden");
    guestInfoEl.innerHTML = `
      <div class="returning-badge">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-semibold text-[#C8A96B] uppercase tracking-widest">Existing Guest</span>
          ${memberBadge(guest.id)}
        </div>
        <p class="font-display text-lg font-semibold text-[#28547C] mb-1">${formatGuestName(guest)}</p>
        ${guest.phone ? `<p class="text-xs text-[#999]">${escapeHtml(guest.phone)}</p>` : ""}
        ${guest.preference ? `<p class="text-xs text-[#C8A96B] mt-1.5">⭐ ${escapeHtml(guest.preference)}</p>` : ""}
        ${guest.food_allergy ? `<p class="text-xs text-red-500 mt-1">⚠️ Allergy: ${escapeHtml(guest.food_allergy)}</p>` : ""}
      </div>
    `;
  }

  // Set current guest ID based on prefix
  if (prefix === "wi") currentWiGuestId = guest.id;
  if (prefix === "res") currentResGuestId = guest.id;

  // Show reservation details fields if this is a reservation
  if (prefix === "res") {
    setResDetailsEnabled(true);
    populateAreaSelects();
  }

  if (prefix === "res") {
    setResNewGuestVisible(false);
  } else {
    const newGuestEl = document.getElementById(`${prefix}-new-guest`);
    if (newGuestEl) newGuestEl.classList.add("hidden");
  }
}

function clearGuestSelection(prefix) {
  const searchEl = document.getElementById(`${prefix}-guest-search`);
  if (searchEl) searchEl.value = "";

  const guestIdEl = document.getElementById(`${prefix}-guest-id`);
  if (guestIdEl) guestIdEl.value = "";

  const phoneEl = document.getElementById(`${prefix}-phone`);
  if (phoneEl) phoneEl.value = "";

  const guestInfoEl = document.getElementById(`${prefix}-guest-info`);
  if (guestInfoEl) {
    guestInfoEl.classList.add("hidden");
    guestInfoEl.innerHTML = "";
  }

  const resultsEl = document.getElementById(`${prefix}-guest-search-results`);
  if (resultsEl) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
  }

  if (prefix === "wi") currentWiGuestId = null;
  if (prefix === "res") {
    currentResGuestId = null;
    // Re-gate. Without this, clearing the guest leaves a fully editable form
    // that cannot be saved, and the failure only shows up at the save button.
    setResDetailsEnabled(false);
    setResNewGuestVisible(false);
  }
}

// Legacy lookup functions (keeping for compatibility)
let lookupTimeout;
function lookupGuest(phone, prefix) {
  clearTimeout(lookupTimeout);
  if (phone.length < 8) return;
  lookupTimeout = setTimeout(() => lookupGuestManual(prefix), 600);
}

async function lookupGuestManual(prefix) {
  const phoneEl = document.getElementById(`${prefix}-phone`);
  const phone = normalizePhone(phoneEl?.value);
  if (!phone) return;

  loader(true);
  const { data: guest, error: guestError } = await supabaseQuery(
    () => db.from("guests").select("*").eq("phone", phone).single(),
    "Guest lookup failed",
  );
  loader(false);

  if (guestError) return;

  const guestInfoEl = document.getElementById(`${prefix}-guest-info`);
  const newGuestEl = document.getElementById(`${prefix}-new-guest`);
  const visitFieldsEl =
    document.getElementById(`${prefix}-visit-fields`) ||
    document.getElementById(`${prefix}-details-fields`);

  if (guest) {
    const { data: visits, error: visitError } = await supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_date")
          .eq("guest_id", guest.id)
          .order("visit_date", { ascending: false })
          .limit(1),
      "Failed to load last visit",
    );
    const lastVisit = visits?.[0]?.visit_date;
    const { data: visitCountData, error: visitCountError } =
      await supabaseQuery(
        () =>
          db
            .from("visits")
            .select("id", { count: "exact", head: true })
            .eq("guest_id", guest.id),
        "Failed to load guest visit count",
      );
    const totalVisits = visitCountData?.count || 0;

    if (prefix === "wi") currentWiGuestId = guest.id;
    if (prefix === "res") {
      currentResGuestId = guest.id;
      document.getElementById("res-guest-id").value = guest.id;
    }

    guestInfoEl.classList.remove("hidden");
    guestInfoEl.innerHTML = `
      <div class="returning-badge">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-semibold text-[#C8A96B] uppercase tracking-widest">Welcome Back</span>
          ${totalVisits > 0 ? `<span class="bg-[#C8A96B] text-white text-[10px] px-2 py-0.5 rounded-full">${totalVisits} visits</span>` : ""}
          ${memberBadge(guest.id)}
        </div>
        <p class="font-display text-xl font-semibold text-[#28547C] mb-1">${guest.name}</p>
        ${lastVisit ? `<p class="text-xs text-[#999]">Last visit: ${fmt.date(lastVisit)}</p>` : ""}
        ${guest.preference ? `<p class="text-xs text-[#C8A96B] mt-1.5">⭐ ${guest.preference}</p>` : ""}
        ${guest.food_allergy ? `<p class="text-xs text-red-500 mt-1">⚠️ Allergy: ${guest.food_allergy}</p>` : ""}
        ${guest.notes ? `<p class="text-xs text-[#888] mt-1">📝 ${guest.notes}</p>` : ""}
      </div>
    `;
    newGuestEl?.classList.add("hidden");
    visitFieldsEl?.classList.remove("hidden");
    if (prefix === "res") populateAreaSelects();
  } else {
    // New guest
    if (prefix === "wi") currentWiGuestId = null;
    if (prefix === "res") {
      currentResGuestId = null;
      document.getElementById("res-guest-id").value = "";
    }

    guestInfoEl.classList.remove("hidden");
    guestInfoEl.innerHTML = `
      <div class="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-10 border border-blue-100">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span class="text-xs text-blue-700 font-medium">New guest — please fill in profile below</span>
      </div>
    `;
    newGuestEl?.classList.remove("hidden");
    visitFieldsEl?.classList.remove("hidden");
    if (prefix === "res") populateAreaSelects();
    if (prefix === "wi")
      document.getElementById("wi-phone") &&
        (document.getElementById("wi-phone").value = phone);
    if (prefix === "res")
      document.getElementById("res-phone") &&
        (document.getElementById("res-phone").value = phone);
  }
}

// ============================================================
// WALK-IN
// ============================================================
let walkInSearchTimeout;
let walkInSearchRequest = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanSearchTerm(value) {
  return value.trim().replace(/[%,]/g, "");
}

async function openWalkInModal(visit = null) {
  currentWiGuestId = null;
  currentWiEditId = null;
  clearGuestSelection("wi");

  document.getElementById("wi-guest-search").value = visit?.guests?.name || "";
  document.getElementById("wi-phone").value = visit?.guests?.phone || "";
  document.getElementById("wi-guest-info").classList.add("hidden");
  document.getElementById("wi-guest-info").innerHTML = "";
  document.getElementById("wi-guest-search-results").classList.add("hidden");
  document.getElementById("wi-guest-search-results").innerHTML = "";
  document.getElementById("wi-pax").value = visit?.pax || 2;
  document.getElementById("wi-notes").value = visit?.notes || "";
  document.getElementById("wi-edit-id").value = visit?.id || "";
  currentWiEditId = visit?.id || null;
  currentWiGuestId = visit?.guest_id || null;
  wiModalOriginalGuestId = visit?.guest_id || null;
  // Reset the persistent guardrail error from any previous edit session
  const wiBlockEl = document.getElementById("wi-block-error");
  if (wiBlockEl) {
    wiBlockEl.classList.add("hidden");
    wiBlockEl.textContent = "";
  }
  populateAreaSelects();
  document.getElementById("wi-area").value = visit?.assigned_area || "";
  document.getElementById("wi-table-id").value = visit?.table_id || "";

  // Completed walk-ins: skip occupancy (historical edit, tables status unknown)
  // Active or new: fetch today's occupied tables, exclude self
  const wiIsCompleted = visit?.status === "Done" || !!visit?.completed_at;
  if (wiIsCompleted) {
    tablePickerContext["wi"] = { skipOccupancy: true, occupiedIds: new Set() };
    renderTableSelection("wi", visit?.table_id || "");
  } else {
    tablePickerContext["wi"] = { skipOccupancy: false, occupiedIds: new Set() };
    renderTableSelection("wi", visit?.table_id || "");
    fetchOccupiedTableIds(visit?.id || null, "visit").then((ids) => {
      tablePickerContext["wi"] = { skipOccupancy: false, occupiedIds: ids };
      renderTableSelection("wi", document.getElementById("wi-table-id").value);
    });
  }

  document.getElementById("wi-modal-title").textContent = visit
    ? "Edit Walk-In"
    : "Register Walk-In";
  document.getElementById("wi-save-button").textContent = visit
    ? "Save Changes"
    : "Confirm Walk-In";

  // If editing an existing walk-in with guest, show guest info
  if (visit?.guest_id) {
    const guestInfoEl = document.getElementById("wi-guest-info");
    guestInfoEl.classList.remove("hidden");
    guestInfoEl.innerHTML = `
      <div class="returning-badge">
        <p class="font-display text-lg text-[#28547C]">${visit.guests ? formatGuestName(visit.guests) : "—"} ${memberBadge(visit.guest_id)}</p>
        <p class="text-xs text-[#999]">${escapeHtml(visit.guests?.phone || "")}</p>
      </div>
    `;
  }

  showModal("modal-walkin");
  setTimeout(() => document.getElementById("wi-guest-search")?.focus(), 100);
}

async function openEditWalkIn(id) {
  const { data: visit, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("*, guests(name, phone, booking_alias), areas(name), tables(name)")
        .eq("id", id)
        .single(),
    "Failed to load walk-in for editing",
  );
  if (error || !visit) {
    toast(error?.message || "Could not load walk-in data", "error");
    return;
  }
  openWalkInModal(visit);
}

async function saveWalkIn() {
  const visitId = document.getElementById("wi-edit-id").value;
  const name = document.getElementById("wi-guest-search").value.trim();
  const phone = normalizePhone(document.getElementById("wi-phone").value);
  if (!name) {
    toast("Guest name is required", "error");
    return;
  }

  const pax = parseInt(document.getElementById("wi-pax").value, 10) || 1;
  const selectedTableId = document.getElementById("wi-table-id")?.value || null;
  const selectedTable = selectedTableId ? getTableById(selectedTableId) : null;
  const area =
    selectedTable?.area_id || document.getElementById("wi-area").value || null;
  const notes = document.getElementById("wi-notes").value.trim() || null;

  // Walk-In modal does not contain a #wi-spend field.
  // Only read spend_amount if the field exists, to avoid overwriting
  // existing spend_amount with null during edits.
  const wiSpendEl = document.getElementById("wi-spend");
  const spendAmount = wiSpendEl
    ? (() => {
        const spend = cleanNumericInput(wiSpendEl.value || "");
        return spend === "" ? null : parseFloat(spend);
      })()
    : undefined;

  loader(true);

  if (visitId) {
    // Staff picked a DIFFERENT guest from the search dropdown while editing:
    // reassign the visit to that guest. Do NOT rename/update that guest —
    // the typed text was used for searching, not for correcting their name.
    const guestChanged =
      !!currentWiGuestId &&
      !!wiModalOriginalGuestId &&
      currentWiGuestId !== wiModalOriginalGuestId;

    // GUARDRAIL: a visit that already generated a membership transaction
    // (sticker) must NOT be moved to another guest — the spend would move
    // but the sticker would stay on the old member's card, splitting the
    // records. Block the save and tell staff to escalate to the ops manager.
    if (guestChanged) {
      const { data: memberTxns, error: txnCheckError } = await supabaseQuery(
        () =>
          db
            .from("member_transactions")
            .select("id")
            .eq("visit_id", visitId)
            .limit(1),
        "Failed to check membership transactions for visit",
      );
      // Fail SAFE: if the check itself errors, block rather than risk it
      if (txnCheckError || (memberTxns && memberTxns.length > 0)) {
        loader(false);
        const blockEl = document.getElementById("wi-block-error");
        const msg = txnCheckError
          ? "Tidak bisa memeriksa data membership untuk kunjungan ini. Periksa koneksi dan coba lagi. Jika masih gagal, mohon screenshot pesan ini dan laporkan ke ops manager."
          : "Walk-in ini TIDAK BISA dipindahkan ke guest lain: kunjungan ini sudah tercatat di kartu membership (sticker/transaksi). Memindahkannya akan membuat data membership tidak cocok. Mohon screenshot pesan ini dan laporkan ke ops manager.";
        if (blockEl) {
          blockEl.textContent = "⚠️ " + msg;
          blockEl.classList.remove("hidden");
          blockEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          toast(msg, "error");
        }
        return;
      }
    }

    if (currentWiGuestId && !guestChanged) {
      const guestPayload = { name };
      if (phone) guestPayload.phone = phone;
      const { error: guestError } = await supabaseQuery(
        () => db.from("guests").update(guestPayload).eq("id", currentWiGuestId),
        "Failed to update guest information",
      );
      if (guestError) {
        loader(false);
        if (guestError.code === "23505") {
          // Unique violation — phone already belongs to another guest
          toast(
            "Nomor telepon sudah terdaftar atas guest lain. Periksa kembali nomornya.",
            "error",
          );
        } else {
          toast(
            guestError.message || "Failed to update guest information",
            "error",
          );
        }
        return;
      }
      // Keep the member card name in sync (no-op if guest is not a member)
      await supabaseQuery(
        () =>
          db
            .from("members")
            .update({ full_name: name })
            .eq("guest_id", currentWiGuestId),
        "Failed to sync member name",
      );
    }

    const visitPayload = {
      pax,
      assigned_area: area || null,
      table_id: selectedTableId,
      notes,
      updated_at: new Date().toISOString(),
    };
    if (guestChanged) {
      visitPayload.guest_id = currentWiGuestId;
    }
    // Only include spend_amount when the field exists (i.e., when spending edit is supported)
    if (spendAmount !== undefined) {
      visitPayload.spend_amount = spendAmount;
    }

    const { error: visitError } = await supabaseQuery(
      () => db.from("visits").update(visitPayload).eq("id", visitId),
      "Failed to update walk-in",
    );
    loader(false);

    if (visitError) {
      toast(visitError.message || "Failed to update walk-in", "error");
      return;
    }

    await updateGuestSpendingTier(currentWiGuestId);
    if (guestChanged) {
      // Visit (and any spend on it) moved away from the original guest —
      // their spending tier may need to drop back down.
      await updateGuestSpendingTier(wiModalOriginalGuestId);
      toast("Walk-in dipindahkan ke guest yang dipilih");
    } else {
      toast("Walk-in updated!");
    }
  } else {
    let guestId = currentWiGuestId;
    if (!guestId) {
      const guestPayload = { name, created_by: currentStaffId() };
      if (phone) guestPayload.phone = phone;
      const { data: newGuest, error: guestError } = await supabaseQuery(
        () => db.from("guests").insert(guestPayload).select().single(),
        "Failed to create guest for walk-in",
      );
      if (guestError) {
        loader(false);
        toast(guestError.message || "Failed to create guest", "error");
        return;
      }
      guestId = newGuest.id;
    }

    const { error: visitError } = await supabaseQuery(
      () =>
        db.from("visits").insert({
          guest_id: guestId,
          visit_type: "Walk-In",
          visit_date: TODAY,
          visit_time: getNowTime(),
          pax,
          assigned_area: area || null,
          table_id: selectedTableId,
          spend_amount: spendAmount ?? null,
          notes,
          created_by: currentStaffId(),
        }),
      "Failed to save walk-in",
    );
    loader(false);

    if (visitError) {
      toast(visitError.message || "Failed to save walk-in", "error");
      return;
    }

    await updateGuestSpendingTier(guestId);
    toast("Walk-in registered!");
  }

  invalidateVisitCountCache(); // new visit created — bust count cache
  invalidateGuestVisitHistoryCache();
  _tierRefreshLastRun = 0; // force tier recalc next loadGuests
  hideModal("modal-walkin");
  if (isViewingStaffDashboard()) loadDashboard();
  if (currentPage === "walkins") loadWalkIns();
  // Sync today's spending summary if on reports tab
  const reportsWalkinsView = document.getElementById(
    "reports-walkins-insights-view",
  );
  if (reportsWalkinsView && !reportsWalkinsView.classList.contains("hidden")) {
    loadTodaySpendingSummary();
  }
}

async function loadWalkIns() {
  const dateEl = document.getElementById("wi-date-filter");
  // Use wiSelectedDate if available, otherwise fall back to date input or TODAY
  const date = wiSelectedDate || dateEl?.value || TODAY;
  const label = document.getElementById("walkins-date-label");

  // Sync the date input with wiSelectedDate
  if (dateEl && wiSelectedDate) {
    dateEl.value = wiSelectedDate;
  }

  let wiQuery = db
    .from("visits")
    .select(
      "*, guests(name, phone, company, booking_alias, spending_tier, tag), areas(name), tables(name)",
    )
    .eq("visit_date", date)
    .eq("visit_type", "Walk-In")
    .order("visit_time", { ascending: false });

  // Voided walk-ins (manager-deleted duplicates/mistakes) are hidden from
  // the normal view by default. Managers can flip wiShowVoided to audit them —
  // the row and guest history are never actually gone, just filtered out.
  if (!wiShowVoided) {
    wiQuery = wiQuery.is("voided_at", null);
  }

  const { data, error } = await supabaseQuery(
    () => wiQuery,
    "Failed to load walk-ins",
  );

  const tbody = document.getElementById("walkins-tbody");
  if (label) {
    if (error || !data) {
      label.textContent =
        CURRENT_LANG === "id"
          ? `Tamu tanpa reservasi untuk ${fmt.date(date)}`
          : `Walk-ins for ${fmt.date(date)}`;
    } else {
      label.textContent =
        CURRENT_LANG === "id"
          ? `${data.length || 0} tamu tanpa reservasi pada ${fmt.date(date)}`
          : `${data.length || 0} walk-ins on ${fmt.date(date)}`;
    }
  }
  if (!tbody) return;

  if (error) {
    toast(error.message || "Failed to load walk-ins", "error");
    return;
  }

  if (!data?.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="px-5 py-8 text-center text-[#bbb] text-sm">No walk-ins for this day</td></tr>';
    return;
  }

  await attachGuestVisitCounts(data);

  tbody.innerHTML = data
    .map((v) => {
      const isCompleted = v.status === "Done" || !!v.completed_at;
      const isVoided = !!v.voided_at;
      const notesDisplay = v.notes ? truncateNotes(v.notes) : "";
      const tierBadge = formatSpendingTierBadge(v.guests?.spending_tier);
      const visitCount = v._visitCount || 0;
      return `
      <tr class="table-row border-b border-[#F5F3EF] ${isVoided ? "opacity-50" : ""}">
        <td class="px-5 py-3.5 font-display text-[#28547C]">${fmt.time(v.visit_time)}</td>
        <td class="px-5 py-3.5">
          <p class="font-medium text-sm text-[#222]">${v.guests ? formatGuestName(v.guests) : "—"}</p>
          ${v.guests?.phone ? `<p class="text-xs text-[#999] mt-0.5">${v.guests.phone}</p>` : ""}
          ${tierBadge || memberBadge(v.guest_id) ? `<div class="mt-1.5 flex flex-wrap items-center gap-1.5">${tierBadge}${memberBadge(v.guest_id)}</div>` : ""}
          ${isVoided ? `<p class="text-xs text-red-400 italic mt-1">Voided${v.void_reason ? `: ${escapeHtml(v.void_reason)}` : ""}</p>` : ""}
        </td>
        <td class="px-5 py-3.5 text-sm text-[#555]">${fmt.pax(v.pax)}</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">${v.tables?.name || "—"}</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">${v.areas?.name || "—"}</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">${fmt.currency(v.spend_amount)}</td>
        <td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">${visitCount > 0 ? visitCount : "—"}</td>
        <td class="px-5 py-3.5">
          <div class="flex items-center flex-wrap gap-3">
            ${
              isVoided
                ? '<span class="text-xs text-[#999]">—</span>'
                : `
              <button onclick="openEditWalkIn('${v.id}')" class="text-xs text-[#28547C] hover:underline">Edit</button>
              ${
                isCompleted
                  ? '<span class="text-xs text-[#5F8D4E]">✓ Done</span>'
                  : `<button onclick="openCompleteVisit('${v.id}','visit')" class="text-xs text-[#C8A96B] hover:underline">Complete</button>`
              }
              ${waThankYouVisitBtn(v)}
              <button onclick="openVoidWalkIn('${v.id}')" class="manager-only-ui text-xs text-red-400 hover:text-red-600">Void</button>
            `
            }
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  applyManagerOnlyUI();
}

// ── Void Walk-In (manager-only, soft-delete) ─────────────────────────────
// Same reasoning as openDeleteReservation: staff double-entered a walk-in
// (e.g. also made a reservation for the same guest/visit). We never hard-
// delete the visit row — guest history, reports, and spending-tier math
// must stay accurate for everything that DIDN'T get voided.
async function openVoidWalkIn(visitId) {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can void a walk-in", "error");
    return;
  }

  const { data: visit } = await supabaseQuery(
    () =>
      db.from("visits").select("id, spend_amount").eq("id", visitId).single(),
    "Failed to load walk-in before void",
  );
  if (!visit) {
    toast("Could not load this walk-in", "error");
    return;
  }

  if (visit.spend_amount != null && visit.spend_amount > 0) {
    toast(
      "Can't void: this walk-in has recorded spend. Edit/clear the spend amount first if it was entered by mistake, then void.",
      "error",
    );
    return;
  }

  const { data: txns } = await supabaseQuery(
    () => db.from("member_transactions").select("id").eq("visit_id", visitId),
    "Failed to check membership transactions before void",
  );
  if (txns?.length) {
    toast(
      "Can't void: this walk-in has a membership transaction (sticker/points) attached. Resolve that first.",
      "error",
    );
    return;
  }

  _voidReasonContext = { type: "visit", id: visitId };
  document.getElementById("void-reason-title").textContent = "Void Walk-In";
  document.getElementById("void-reason-summary").textContent =
    "This hides the walk-in from the normal view. The guest profile is kept, and it stays visible in the audit view.";
  document.getElementById("void-reason-select").value = "Duplicate entry";
  document.getElementById("void-reason-notes").value = "";
  document.getElementById("void-reason-warning").classList.add("hidden");
  showModal("modal-void-reason");
}

function toggleWiShowVoided() {
  wiShowVoided = !wiShowVoided;
  const btn = document.getElementById("wi-show-voided-btn");
  const label = document.getElementById("wi-show-voided-label");
  if (label)
    label.textContent = wiShowVoided ? t("Hide voided") : t("Show voided");
  if (btn) {
    // Active state reads as a "filter applied" hint (gold, matching the
    // rest of the manager/audit accents) instead of just static grey text.
    btn.classList.toggle("text-[#C8A96B]", wiShowVoided);
    btn.classList.toggle("font-medium", wiShowVoided);
    btn.classList.toggle("text-[#999]", !wiShowVoided);
  }
  loadWalkIns();
}

// ── Walk-In Date Navigation ──────────────────────────────────

function updateWiDateNavLabel() {
  const navLabel = document.getElementById("wi-date-nav-label");
  if (navLabel) {
    const dateStr = wiSelectedDate || TODAY;
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      navLabel.textContent = "Today";
    } else {
      navLabel.textContent = date.toLocaleDateString(
        CURRENT_LANG === "id" ? "id-ID" : "en-GB",
        {
          day: "numeric",
          month: "short",
        },
      );
    }
  }
}

function moveWiDay(dir) {
  // dir: -1 for previous day, +1 for next day
  const [y, m, d] = (wiSelectedDate || TODAY).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + dir);
  wiSelectedDate =
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0");

  // Sync the date filter input
  const dateEl = document.getElementById("wi-date-filter");
  if (dateEl) dateEl.value = wiSelectedDate;

  updateWiDateNavLabel();
  loadWalkIns();
}

function onWiDateChanged() {
  const dateEl = document.getElementById("wi-date-filter");
  if (dateEl?.value) {
    wiSelectedDate = dateEl.value;
    updateWiDateNavLabel();
    loadWalkIns();
  }
}

// ============================================================
// RESERVATIONS
// ============================================================
function openReservationModal(res = null) {
  currentResGuestId = null;
  clearGuestSelection("res");

  document.getElementById("res-modal-title").textContent = res
    ? "Edit Reservation"
    : "New Reservation";
  document.getElementById("res-edit-id").value = res?.id || "";
  document.getElementById("res-guest-id").value = res?.guest_id || "";
  document.getElementById("res-phone").value = res?.guests?.phone || "";
  resModalOriginalPhone = res?.guests?.phone || null;
  document.getElementById("res-guest-search").value = res?.guests?.name || "";
  document.getElementById("res-guest-info").classList.add("hidden");
  setResNewGuestVisible(false);
  // Opens gated. The edit path below re-enables it, because an existing
  // reservation already has a guest and there is nothing to choose.
  setResDetailsEnabled(false);
  document.getElementById("res-date").value = res?.reservation_date || TODAY;
  document.getElementById("res-time").value =
    res?.reservation_time?.slice(0, 5) || "19:00";
  document.getElementById("res-pax").value = res?.pax || 2;
  document.getElementById("res-occasion").value = res?.occasion || "";
  document.getElementById("res-status").value = res?.status || "Reserved";
  setResSourceValue(res?.reservation_source || "");
  document.getElementById("res-notes").value = res?.notes || "";

  populateAreaSelects();
  document.getElementById("res-table-id").value = res?.table_id || "";
  const endTimeEl = document.getElementById("res-end-time");
  if (endTimeEl) endTimeEl.value = res?.end_time?.slice(0, 5) || "";
  if (res?.assigned_area)
    document.getElementById("res-area").value = res.assigned_area;

  // Completed reservations: skip occupancy (historical edit).
  // Otherwise occupancy is DATE-AWARE: today's physical occupancy only
  // matters when the reservation is FOR today. Future dates are freely
  // selectable (fixes: "cancelled VIP but still can't rebook VIP").
  const resIsCompleted = res?.status === "Completed";
  if (resIsCompleted) {
    tablePickerContext["res"] = { skipOccupancy: true, occupiedIds: new Set() };
    renderTableSelection("res", res?.table_id || "");
  } else {
    refreshResTableOccupancy();
  }

  if (res?.guest_id) {
    currentResGuestId = res.guest_id;
    // Show guest info
    document.getElementById("res-guest-info").classList.remove("hidden");
    document.getElementById("res-guest-info").innerHTML = `
      <div class="returning-badge">
        <p class="font-display text-lg text-[#28547C]" id="res-guest-info-name">${res.guests ? formatGuestName(res.guests) : "—"} ${memberBadge(res.guest_id)}</p>
        <p class="text-xs text-[#999]">${escapeHtml(res.guests?.phone || "")}</p>
        <button type="button" onclick="renameReservationGuest()" class="text-xs text-[#5596CE] underline mt-1">✏️ Perbaiki nama guest</button>
      </div>
    `;
    setResDetailsEnabled(true);
  }

  showModal("modal-reservation");
}

async function saveReservation() {
  let guestId =
    currentResGuestId || document.getElementById("res-guest-id").value;

  if (!guestId) {
    const name = document.getElementById("res-name")?.value.trim();
    // Prefer the explicitly typed new-guest phone. Only fall back to res-phone
    // if it is NOT the phone of the guest that was loaded into this modal —
    // otherwise "create new guest" during an edit would try to insert a
    // duplicate phone and hit the guests_phone_key unique constraint.
    let phone = normalizePhone(
      document.getElementById("res-new-guest-phone")?.value || "",
    );
    if (!phone) {
      const fallback = normalizePhone(
        document.getElementById("res-phone").value,
      );
      if (fallback && fallback !== normalizePhone(resModalOriginalPhone || ""))
        phone = fallback;
    }
    if (!name) {
      toast("Guest name is required", "error");
      return;
    }

    loader(true);
    const resGuestPayload = {
      name,
      gender: document.getElementById("res-gender")?.value || null,
      company: document.getElementById("res-company")?.value.trim() || null,
      created_by: currentStaffId(),
    };
    if (phone) resGuestPayload.phone = phone;
    const { data: newGuest, error: guestError } = await supabaseQuery(
      () => db.from("guests").insert(resGuestPayload).select().single(),
      "Failed to create guest for reservation",
    );
    loader(false);

    if (guestError) {
      if (guestError.code === "23505") {
        // Unique violation — phone already belongs to an existing guest
        toast(
          "Nomor telepon sudah terdaftar atas guest lain. Cari nomor/nama tersebut dan pilih guest dari hasil pencarian.",
          "error",
        );
      } else {
        toast(guestError.message || "Failed to create guest", "error");
      }
      return;
    }
    guestId = newGuest.id;
  }

  const date = document.getElementById("res-date").value;
  const time = document.getElementById("res-time").value;
  const pax = parseInt(document.getElementById("res-pax").value) || 1;

  if (!date || !time || !pax) {
    toast("Date, time, and pax are required", "error");
    return;
  }

  const selectedTableId =
    document.getElementById("res-table-id")?.value || null;
  const selectedTable = selectedTableId ? getTableById(selectedTableId) : null;
  const assignedArea =
    selectedTable?.area_id || document.getElementById("res-area").value || null;

  // VIP hour-range: end time is OPTIONAL (staff can add it later by
  // editing the reservation). Overlaps are still checked — bookings
  // without an end time are assumed to last LEGACY_BOOKING_HOURS.
  let endTime = null;
  const editIdForCheck = document.getElementById("res-edit-id").value || null;
  const vipErrEl = document.getElementById("res-vip-conflict");
  const showVipError = (msg) => {
    if (vipErrEl) {
      vipErrEl.textContent = msg;
      vipErrEl.classList.remove("hidden");
    } else {
      toast(msg, "error");
    }
  };
  if (vipErrEl) {
    vipErrEl.classList.add("hidden");
    vipErrEl.textContent = "";
  }
  if (selectedTableId && isVipTableId(selectedTableId)) {
    endTime = document.getElementById("res-end-time")?.value || null;
    if (endTime && timeToMinutes(endTime) <= timeToMinutes(time)) {
      showVipError("Jam selesai harus setelah jam mulai.");
      return;
    }
    const effEndMins =
      (endTime ? timeToMinutes(endTime) : timeToMinutes(time) + LEGACY_BOOKING_HOURS * 60) % 1440;
    const effEnd = `${String(Math.floor(effEndMins / 60)).padStart(2, "0")}:${String(effEndMins % 60).padStart(2, "0")}`;
    const conflict = await findVipTimeConflict(
      selectedTableId, date, time, effEnd, editIdForCheck,
    );
    if (conflict === "could-not-check") {
      showVipError("Tidak bisa cek ketersediaan VIP. Coba lagi.");
      return;
    }
    if (conflict) {
      showVipError(`Bentrok: VIP sudah dibooking jam ${conflict}. Pilih jam lain.`);
      return;
    }
  }

  const payload = {
    guest_id: guestId,
    reservation_date: date,
    reservation_time: time,
    pax,
    occasion: document.getElementById("res-occasion").value || null,
    reservation_source: readResSourceValue(),
    assigned_area: assignedArea,
    table_id: selectedTableId,
    end_time: endTime,
    status: document.getElementById("res-status").value,
    notes: document.getElementById("res-notes").value.trim() || null,
  };

  const editId = document.getElementById("res-edit-id").value;
  if (!editId) payload.created_by = currentStaffId();
  loader(true);
  const { error } = await supabaseQuery(
    () =>
      editId
        ? db.from("reservations").update(payload).eq("id", editId)
        : db.from("reservations").insert(payload),
    editId ? "Failed to update reservation" : "Failed to create reservation",
  );
  loader(false);

  if (error) {
    toast(error.message || "Failed to save reservation", "error");
    return;
  }
  toast(editId ? "Reservation updated" : "Reservation created");
  await updateGuestSpendingTier(guestId);
  hideModal("modal-reservation");
  // A brand-new reservation is usually for a different guest than the one
  // being searched, so it would silently vanish from the result list.
  // Editing an existing row is the opposite: staff want to stay put.
  if (!editId) clearResSearch(true);
  loadReservations();
  if (isViewingStaffDashboard()) loadDashboard();
}

async function loadReservations() {
  // A guest search is date-independent, so it owns the table while it's
  // active. Every "reload the list" path in the app funnels through
  // loadReservations() (status update, table assignment, delete, rename,
  // complete-visit…), so delegating here is what keeps staff on their
  // search results after they act on a row instead of being bounced back
  // to whichever day the picker happens to hold.
  if (resSearchActive) return renderResSearchResults();

  if (!resSelectedDate) {
    resSelectedDate = TODAY;
  }
  const date = resSelectedDate;

  // Strong, high-visibility subtitle under the "Reservations" heading —
  // this is the single most-glanced-at piece of the page (staff need to
  // confirm at a glance which day they're looking at), so it renders
  // bigger/bolder than a normal subtitle rather than muted grey.
  const label = document.getElementById("res-date-label");
  if (label) {
    label.textContent = new Date(date + "T00:00:00").toLocaleDateString(
      CURRENT_LANG === "id" ? "id-ID" : "en-GB",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    );
  }

  // Native date input between Prev/Next — clicking it opens the browser's
  // own calendar dropdown (same pattern as the rest of the app; see the
  // input[type=date] + showPicker() binding at the bottom of index.html).
  const dateInput = document.getElementById("res-date-input");
  if (dateInput) dateInput.value = date;

  let query = db
    .from("reservations")
    .select(
      "*, guests(name, phone, company, booking_alias, spending_tier, tag, food_allergy, favorite_menu, last_order), areas(name), tables(name)",
    )
    .eq("reservation_date", date)
    .order("reservation_time");

  if (resStatusFilter === "all") {
    // "All" excludes manager-deleted reservations by default — those are
    // staff mistakes (duplicate input), not part of normal operating view.
    // They're still fully recoverable via the "Deleted" filter chip (manager only).
    query = query.neq("status", "Deleted");
  } else {
    query = query.eq("status", resStatusFilter);
  }

  const { data, error } = await supabaseQuery(
    () => query,
    "Failed to load reservations",
  );
  if (error) return;
  // Time order from the DB is preserved inside each group; cancelled rows
  // just move to the end so the top of the list is only people who are
  // actually still expected.
  allReservations = sortResCancelledLast(data);
  await renderReservationsTable(allReservations);

  // Occupancy summary always reflects the FULL day regardless of the
  // active status filter/chip — a manager filtering to "Cancelled" to
  // audit no-shows shouldn't see the occupancy card go to zero.
  await renderResOccupancySummary(date);
}

// Shifts the reservations page by `dir` days (-1 = Previous, 1 = Next).
function moveResDay(dir) {
  clearResSearch(true); // any day navigation means "take me back to the day view"
  const [y, m, d] = resSelectedDate.split("-").map(Number);
  const next = new Date(y, m - 1, d); // local date constructor
  next.setDate(next.getDate() + dir);
  resSelectedDate =
    next.getFullYear() +
    "-" +
    String(next.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(next.getDate()).padStart(2, "0");
  loadReservations();
}

// Jumps straight to a date chosen from the native calendar dropdown.
function goToResDate(dateStr) {
  if (!dateStr) return;
  clearResSearch(true);
  resSelectedDate = dateStr;
  loadReservations();
}

// Jumps back to today — exposed for a "Today" shortcut next to the date input.
function goToResToday() {
  clearResSearch(true);
  resSelectedDate = TODAY;
  loadReservations();
}

function filterResByStatus(status) {
  // Status chips are day-view controls. Search results intentionally span
  // every status (except Deleted) — a guest looking for "my booking" is
  // just as likely to have cancelled it. So picking a chip exits search
  // rather than trying to combine the two, which would produce
  // confusing empty results ("Cancelled" chip + a guest who never
  // cancelled = blank screen with no obvious cause).
  clearResSearch(true);
  resStatusFilter = status;
  document.querySelectorAll(".status-filter-btn").forEach((btn) => {
    const isActive = btn.dataset.status === status;
    btn.className = isActive
      ? "status-filter-btn btn-primary text-xs px-3 py-1.5"
      : "status-filter-btn btn-ghost text-xs px-3 py-1.5";
  });
  loadReservations();
}

// ============================================================
// RESERVATION GUEST SEARCH
// ============================================================
// Two-step by design: type → pick a guest from the dropdown → results.
// Guest names in production are messy (front desk types visit dates into
// the name field, and the same person can exist under slight spelling
// variants), so resolving to a concrete guest_id BEFORE listing
// reservations is what makes the result list trustworthy. Pressing Enter
// without picking anything falls back to a broader "every guest matching
// this text" search so staff are never forced through the dropdown.
//
// Matching covers name and phone: digits typed by staff go through
// normalizePhone() first so "+62812…", "62812…" and "0812…" all hit the
// same stored value.
// ============================================================

// null = day view. Otherwise { label, guestIds } — guestIds is resolved
// once at search time and reused on every reload so acting on a row
// (status update, delete…) doesn't re-run the guest lookup.
let resSearchActive = null;
let resSearchTimeout = null;
let resSuggestItems = []; // guests currently in the dropdown
let resSuggestIndex = -1; // keyboard highlight, -1 = nothing highlighted

const RES_SEARCH_MIN_CHARS = 2;
const RES_SEARCH_GUEST_LIMIT = 50; // free-text fallback breadth
const RES_SEARCH_ROW_LIMIT = 200; // safety cap on the result table

function resSearchEls() {
  return {
    input: document.getElementById("res-search-input"),
    suggest: document.getElementById("res-search-suggest"),
    chip: document.getElementById("res-search-chip"),
    clearX: document.getElementById("res-search-clear-x"),
    occupancy: document.getElementById("res-occupancy-summary"),
  };
}

function hideResSuggest() {
  const { suggest } = resSearchEls();
  if (suggest) {
    suggest.classList.add("hidden");
    suggest.innerHTML = "";
  }
  resSuggestItems = [];
  resSuggestIndex = -1;
}

function onResSearchInput() {
  const { input, clearX } = resSearchEls();
  if (!input) return;
  const raw = input.value;
  if (clearX) clearX.classList.toggle("hidden", !raw);

  clearTimeout(resSearchTimeout);
  const term = cleanSearchTerm(raw);

  // Emptying the box returns to the day view immediately — staff clear
  // the field expecting the day back, not a stale result set.
  if (!term) {
    hideResSuggest();
    if (resSearchActive) clearResSearch();
    return;
  }
  if (term.length < RES_SEARCH_MIN_CHARS) {
    hideResSuggest();
    return;
  }

  const { suggest } = resSearchEls();
  if (suggest) {
    suggest.classList.remove("hidden");
    suggest.innerHTML =
      '<div class="rounded-10 border border-[#E0DDD7] bg-white shadow-sm text-xs text-[#999] p-3">Searching...</div>';
  }

  resSearchTimeout = setTimeout(() => suggestResGuests(term), 300);
}

async function suggestResGuests(term) {
  const guests = await lookupResGuests(term, 8);
  const { input, suggest } = resSearchEls();
  if (!suggest || !input) return;
  // The box may have been cleared/retyped while the query was in flight.
  if (cleanSearchTerm(input.value) !== term) return;

  resSuggestItems = guests;
  resSuggestIndex = -1;

  if (!guests.length) {
    suggest.classList.remove("hidden");
    suggest.innerHTML =
      '<div class="rounded-10 border border-[#E0DDD7] bg-white shadow-sm text-xs text-[#999] p-3">No guests found</div>';
    return;
  }

  suggest.classList.remove("hidden");
  suggest.innerHTML = `
    <div class="rounded-10 border border-[#E0DDD7] bg-white shadow-sm overflow-hidden max-h-[260px] overflow-y-auto">
      ${guests
        .map(
          (g, i) => `
        <button type="button"
          data-res-suggest-index="${i}"
          onclick="pickResSearchGuest('${g.id}')"
          class="res-suggest-item w-full text-left px-3 py-2 border-b border-[#F0EDE8] last:border-0 hover:bg-[#F8F6F2] transition-colors">
          <p class="text-sm font-medium text-[#222] truncate">${formatGuestName(g)} ${memberBadge(g.id)}</p>
          <p class="text-xs text-[#999] truncate">${g.phone ? escapeHtml(g.phone) : "—"}${g.company ? " · " + escapeHtml(g.company) : ""}</p>
        </button>`,
        )
        .join("")}
    </div>`;
}

// Shared guest matcher for both the dropdown and the Enter fallback.
async function lookupResGuests(term, limit) {
  const phoneTerm = normalizePhone(term) || term;
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("guests")
        .select("id, name, phone, company, booking_alias")
        .or(`name.ilike.%${term}%,phone.ilike.%${phoneTerm}%`)
        .order("name")
        .limit(limit),
    "Failed to search guests",
  );
  return error ? [] : data || [];
}

function onResSearchKeydown(e) {
  const hasSuggestions = resSuggestItems.length > 0;

  if (e.key === "Escape") {
    e.preventDefault();
    if (hasSuggestions) hideResSuggest();
    else clearResSearch();
    return;
  }
  if (e.key === "ArrowDown" && hasSuggestions) {
    e.preventDefault();
    resSuggestIndex = (resSuggestIndex + 1) % resSuggestItems.length;
    highlightResSuggest();
    return;
  }
  if (e.key === "ArrowUp" && hasSuggestions) {
    e.preventDefault();
    resSuggestIndex =
      (resSuggestIndex - 1 + resSuggestItems.length) % resSuggestItems.length;
    highlightResSuggest();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(resSearchTimeout); // don't let a pending suggest reopen the dropdown
    if (hasSuggestions && resSuggestIndex >= 0) {
      pickResSearchGuest(resSuggestItems[resSuggestIndex].id);
    } else {
      runResSearch();
    }
  }
}

function highlightResSuggest() {
  document.querySelectorAll(".res-suggest-item").forEach((el) => {
    const on = Number(el.dataset.resSuggestIndex) === resSuggestIndex;
    el.classList.toggle("bg-[#F8F6F2]", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
}

// Dropdown click / Enter-on-highlight: search one specific guest.
function pickResSearchGuest(guestId) {
  const guest = resSuggestItems.find((g) => g.id === guestId);
  const { input } = resSearchEls();
  if (guest && input) input.value = guest.name || "";
  hideResSuggest();
  runResSearch(guest ? { id: guest.id, name: guest.name } : null);
}

// Enter without a selection: search every guest matching the text.
async function runResSearch(guest = null) {
  const { input, clearX } = resSearchEls();
  if (!input) return;
  const term = cleanSearchTerm(input.value);
  if (clearX) clearX.classList.toggle("hidden", !input.value);
  hideResSuggest();

  if (!guest && term.length < RES_SEARCH_MIN_CHARS) {
    toast("Type at least 2 characters to search", "error");
    return;
  }

  let guestIds;
  let label;
  if (guest) {
    guestIds = [guest.id];
    label = guest.name || term;
  } else {
    const matches = await lookupResGuests(term, RES_SEARCH_GUEST_LIMIT);
    guestIds = matches.map((g) => g.id);
    label = term;
  }

  resSearchActive = { label, guestIds };
  await renderResSearchResults();
}

async function renderResSearchResults() {
  if (!resSearchActive) return;
  const { occupancy } = resSearchEls();
  // The occupancy card and VIP timeline describe a single day; they'd be
  // meaningless above a cross-date result list, so they step aside.
  if (occupancy) occupancy.classList.add("hidden");
  renderResSearchChip(0, true);

  let rows = [];
  if (resSearchActive.guestIds.length) {
    const { data, error } = await supabaseQuery(
      () =>
        db
          .from("reservations")
          .select(
            "*, guests(name, phone, company, booking_alias, spending_tier, tag, food_allergy, favorite_menu, last_order), areas(name), tables(name)",
          )
          .in("guest_id", resSearchActive.guestIds)
          // Deleted = staff data-entry mistake. It stays out of search for
          // the same reason it stays out of the "All" chip; the manager
          // Deleted chip is still the way to audit those.
          .neq("status", "Deleted")
          .order("reservation_date", { ascending: false })
          .order("reservation_time", { ascending: true })
          .limit(RES_SEARCH_ROW_LIMIT),
      "Failed to search reservations",
    );
    if (error) {
      // Don't leave the banner stuck on "Searching..." — drop back to the
      // day view so staff always have a usable list in front of them.
      clearResSearch();
      return;
    }
    rows = data || [];
  }

  allReservations = rows;
  await renderReservationsTable(rows);
  renderResSearchChip(rows.length, false);
}

function renderResSearchChip(count, loading) {
  const { chip } = resSearchEls();
  if (!chip || !resSearchActive) return;
  const label = escapeHtml(resSearchActive.label);
  const summary = loading
    ? "Searching..."
    : count === 0
      ? "No reservations found"
      : count === 1
        ? "1 reservation found"
        : `${count} reservations found`;
  chip.classList.remove("hidden");
  chip.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 rounded-10 border border-[#E3D9C4] bg-[#FBF7EF] px-3 py-2">
      <span class="text-xs text-[#8A7645]">Search results for</span>
      <span class="text-xs font-medium text-[#28547C]">"${label}"</span>
      <span class="text-xs text-[#8A7645]">·</span>
      <span class="text-xs text-[#8A7645]">${summary}</span>
      <span class="text-xs text-[#8A7645]">·</span>
      <span class="text-xs text-[#8A7645]">all dates</span>
      <button type="button" onclick="clearResSearch()"
        class="ml-auto text-xs text-[#C8A96B] hover:underline font-medium">
        Back to day view
      </button>
    </div>`;
}

// skipReload is for callers that are about to load the day view
// themselves (date nav, status chips) — avoids a double query.
function clearResSearch(skipReload) {
  const wasActive = !!resSearchActive;
  resSearchActive = null;
  clearTimeout(resSearchTimeout);
  hideResSuggest();

  const { input, chip, clearX, occupancy } = resSearchEls();
  if (input) input.value = "";
  if (clearX) clearX.classList.add("hidden");
  if (chip) {
    chip.classList.add("hidden");
    chip.innerHTML = "";
  }
  if (occupancy) occupancy.classList.remove("hidden");

  if (!skipReload && wasActive) loadReservations();
}

// Clicking anywhere outside the search box dismisses the dropdown but
// leaves an already-running search alone — dismissing suggestions is not
// the same intent as abandoning the results.
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("res-search-wrap");
  const suggest = document.getElementById("res-search-suggest");
  if (!wrap || !suggest || suggest.classList.contains("hidden")) return;
  if (!wrap.contains(e.target)) hideResSuggest();
});

// ============================================================
// DAY OCCUPANCY SUMMARY
// Always computed from Reserved + Arrived + Completed for the selected
// day, independent of whichever status chip the user has active — a
// manager filtering to "Cancelled" to audit no-shows shouldn't watch the
// occupancy card drop to zero. VIP tables are pulled out of the general
// table count and shown as their own timeline instead, since one VIP
// table can serve several parties in a day at different hours (regular
// tables can't — see LEGACY_BOOKING_HOURS/isVipTableId above).
// ============================================================
// "Confirmed" is a legal status in the reservations CHECK constraint and the
// reports at getResOutcome()/upcoming already count it as an upcoming
// booking, but it was missing here until 2026-09-04. Nothing sets it yet,
// so the gap was invisible. It stops being invisible the moment a recorded
// deposit payment promotes a booking to Confirmed: every paid booking would
// have vanished from the occupancy summary and from the day run sheet, both
// of which read this list. Added before the feature that would have exposed
// it, which is why adding it changes nothing observable today.
const RES_OCCUPANCY_STATUSES = ["Reserved", "Confirmed", "Arrived", "Completed"];
const VIP_TIMELINE_START_MIN = 10 * 60; // 10:00
const VIP_TIMELINE_END_MIN = 21 * 60; // 21:00

function minutesToHHMM(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Pax-vs-capacity stats for a single named dining area (exact area-name
// match — "Indoor Dining" / "Outdoor Dining"), same math as the front-desk
// dashboard's renderDashboardAreaOccupancy() so the two views agree.
// Deliberately separate from the VIP timeline below: VIP tables can serve
// several parties at different hours in a day, so a capacity/pax number
// doesn't mean the same thing there — see renderVipTableTimeline.
function computeDiningAreaCapacity(areaName, rows) {
  const areas = allAreas.filter((a) => a.name === areaName);
  const areaIds = new Set(areas.map((a) => a.id));
  const capacity = areas.reduce((sum, a) => sum + (a.capacity || 0), 0);
  const reservedPax = rows
    .filter((r) => areaIds.has(r.assigned_area))
    .reduce((sum, r) => sum + (Number(r.pax) || 0), 0);
  const remaining = Math.max(0, capacity - reservedPax);
  const pct = capacity ? Math.min(100, Math.round((reservedPax / capacity) * 100)) : 0;
  const statusColor = pct >= 81 ? "#D4573A" : pct >= 61 ? "#C8A96B" : "#5596CE";
  return { capacity, reservedPax, remaining, pct, statusColor };
}

// Reservations that have no `assigned_area` yet. These are real, expected
// guests but they belong to no area, so they are invisible in every
// capacity card above (computeDiningAreaCapacity filters by area id).
// Surfaced as their own line so the front desk can see how much of the
// day's load still needs to be placed, without guessing an area for them.
function computeUnplacedStats(rows) {
  const unplaced = rows.filter((r) => !r.assigned_area);
  return {
    count: unplaced.length,
    pax: unplaced.reduce((sum, r) => sum + (Number(r.pax) || 0), 0),
  };
}

// Compact capacity card for the Reservations-day occupancy summary —
// visually echoes the dashboard's stat-card (%, pax/capacity, seats
// remaining, progress bar) but sized to sit inside this page's summary
// card rather than as its own standalone tile.
function renderDiningAreaCard(label, stats) {
  return `
    <div>
      <div class="flex items-center justify-between">
        <p class="text-[10px] text-[#999] uppercase tracking-wider font-medium">${label}</p>
        <span class="text-xs font-semibold" style="color:${stats.statusColor}">${stats.pct}%</span>
      </div>
      <p class="font-display text-2xl font-semibold text-[#28547C] mt-0.5">${stats.reservedPax}<span class="text-sm text-[#bbb] font-normal"> / ${stats.capacity} pax</span></p>
      <p class="text-[11px] text-[#999] mt-1">${stats.remaining} ${t("seats remaining")}</p>
      <div style="height:5px;background:#EDE9E3;border-radius:3px;overflow:hidden;margin-top:6px;">
        <div style="width:${stats.pct}%;height:100%;background:${stats.statusColor};border-radius:3px;transition:width .4s;"></div>
      </div>
    </div>`;
}

async function renderResOccupancySummary(date) {
  const container = document.getElementById("res-occupancy-summary");
  if (!container) return;

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("id, pax, reservation_time, end_time, table_id, assigned_area, guests(name)")
        .eq("reservation_date", date)
        .in("status", RES_OCCUPANCY_STATUSES),
    "Failed to load occupancy summary",
  );
  if (error) {
    container.innerHTML = "";
    return;
  }
  const rows = data || [];

  if (!allTables.length) await loadTables();
  if (!allAreas.length) await loadAreas();

  const totalReservations = rows.length;
  // Expected pax for the day across ALL reservations in RES_OCCUPANCY_STATUSES,
  // whether or not an area/table has been assigned. Deliberately NOT the sum of
  // the area cards below — those only count reservations already placed in an
  // area, so on a normal booking day they add up to less than this number.
  const totalPax = rows.reduce((sum, r) => sum + (Number(r.pax) || 0), 0);
  const unplaced = computeUnplacedStats(rows);

  const vipAreaIds = new Set(
    allAreas
      .filter((a) => /^vip/i.test((a.name || "").trim()))
      .map((a) => a.id),
  );
  const vipTables = allTables.filter(
    (t) => t.is_active !== false && vipAreaIds.has(t.area_id),
  );

  // Pax-vs-capacity style, matching the existing front-desk dashboard area
  // card (renderDashboardAreaOccupancy) so staff see the same "X/Y pax,
  // Z% occupied" language in both places instead of two different ways of
  // describing occupancy. Grouped by `assigned_area` (the area chosen at
  // booking time), not `table_id` — a reservation counts toward its area's
  // capacity as soon as it's booked, even before a specific table is
  // assigned.
  const indoorStats = computeDiningAreaCapacity("Indoor Dining", rows);
  const outdoorStats = computeDiningAreaCapacity("Outdoor Dining", rows);

  const unplacedHtml = unplaced.count
    ? `<div class="mt-4 pt-3 border-t border-[#EDE9E3] flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full" style="background:#C8A96B"></span>
        <p class="text-[11px] text-[#8a8a8a]">
          <span class="font-semibold text-[#28547C]">${t("Not yet placed")}:</span>
          ${unplaced.count} ${t("reservations")} · ${unplaced.pax} ${t("pax")}
          <span class="text-[#bbb]">— ${t("not counted in the area figures above")}</span>
        </p>
      </div>`
    : "";

  const summaryCardsHtml = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div>
        <p class="text-[10px] text-[#999] uppercase tracking-wider font-medium">${t("Reservations Today")}</p>
        <p class="font-display text-2xl font-semibold text-[#28547C] mt-0.5">${totalReservations}</p>
      </div>
      <div>
        <p class="text-[10px] text-[#999] uppercase tracking-wider font-medium">${t("Total Pax")}</p>
        <p class="font-display text-2xl font-semibold text-[#C8A96B] mt-0.5">${totalPax}</p>
        <p class="text-[11px] text-[#999] mt-1">${t("all reservations, placed or not")}</p>
      </div>
      ${renderDiningAreaCard(t("Indoor Dining"), indoorStats)}
      ${renderDiningAreaCard(t("Outdoor Dining"), outdoorStats)}
    </div>
    ${unplacedHtml}`;

  const vipHtml = vipTables.length
    ? `<div class="mt-5 pt-5 border-t border-[#EDE9E3]">
        <p class="text-[10px] text-[#999] uppercase tracking-wider font-medium mb-3">
          ${t("VIP Room Availability")} <span class="normal-case">(${minutesToHHMM(VIP_TIMELINE_START_MIN)}–${minutesToHHMM(VIP_TIMELINE_END_MIN)})</span>
        </p>
        ${vipTables.map((vt) => renderVipTableTimeline(vt, rows)).join("")}
      </div>`
    : "";

  container.innerHTML = `<div class="card p-5 mb-5">${summaryCardsHtml}${vipHtml}</div>`;
}

// Builds one VIP table's booked/free timeline for the fixed display
// window. Bookings are clamped and merged in start-time order so that
// overlapping data (e.g. a manual DB edit that slipped past
// findVipTimeConflict) still renders a sane, non-negative-width bar
// instead of breaking the layout.
function renderVipTableTimeline(table, rows) {
  const areaName =
    allAreas.find((a) => a.id === table.area_id)?.name || "";
  const bookingsRaw = rows
    .filter((r) => r.table_id === table.id)
    .map((r) => {
      const start = timeToMinutes(r.reservation_time);
      const end = r.end_time
        ? timeToMinutes(r.end_time)
        : start + LEGACY_BOOKING_HOURS * 60;
      return { start, end, guest: r.guests?.name || t("Guest") };
    })
    .sort((a, b) => a.start - b.start);

  const outsideWindow = bookingsRaw.filter(
    (b) => b.end <= VIP_TIMELINE_START_MIN || b.start >= VIP_TIMELINE_END_MIN,
  ).length;

  const segments = [];
  let cursor = VIP_TIMELINE_START_MIN;
  bookingsRaw.forEach((b) => {
    const s = Math.max(b.start, VIP_TIMELINE_START_MIN, cursor);
    const e = Math.min(b.end, VIP_TIMELINE_END_MIN);
    if (e <= cursor || e <= VIP_TIMELINE_START_MIN || s >= VIP_TIMELINE_END_MIN) return; // fully outside window or already covered
    if (s > cursor) {
      segments.push({ type: "free", start: cursor, end: s });
    }
    segments.push({ type: "booked", start: s, end: e, guest: b.guest });
    cursor = Math.max(cursor, e);
  });
  if (cursor < VIP_TIMELINE_END_MIN) {
    segments.push({ type: "free", start: cursor, end: VIP_TIMELINE_END_MIN });
  }

  const totalMin = VIP_TIMELINE_END_MIN - VIP_TIMELINE_START_MIN;
  const barHtml = segments
    .map((seg) => {
      const pct = (100 * (seg.end - seg.start)) / totalMin;
      const label = `${minutesToHHMM(seg.start)}–${minutesToHHMM(seg.end)}`;
      if (seg.type === "booked") {
        return `<div class="h-full flex items-center justify-center text-[10px] font-medium text-white truncate px-1" style="width:${pct}%;background:#C8A96B" title="${escapeHtml(t("Booked"))} ${label} — ${escapeHtml(seg.guest)}">${label}</div>`;
      }
      return `<div class="h-full flex items-center justify-center text-[10px] text-[#bbb] truncate px-1" style="width:${pct}%;background:#FAFAF8" title="${escapeHtml(t("Free"))} ${label}">${pct > 8 ? t("Free") : ""}</div>`;
    })
    .join("");

  const detailHtml = segments
    .map((seg) => {
      const label = `${minutesToHHMM(seg.start)}–${minutesToHHMM(seg.end)}`;
      return seg.type === "booked"
        ? `<span class="text-[11px]"><span class="inline-block w-2 h-2 rounded-full align-middle mr-1" style="background:#C8A96B"></span>${label} — ${escapeHtml(seg.guest)}</span>`
        : `<span class="text-[11px] text-[#bbb]"><span class="inline-block w-2 h-2 rounded-full align-middle mr-1" style="background:#FAFAF8;border:1px solid #E0DDD7"></span>${label} ${t("free")}</span>`;
    })
    .join('<span class="text-[#e0ddd7]">·</span>');

  return `
    <div class="mb-4 last:mb-0">
      <p class="text-xs font-semibold text-[#28547C] mb-1.5">⭐ ${escapeHtml(table.name)}${areaName ? ` <span class="font-normal text-[#999]">(${escapeHtml(areaName)})</span>` : ""}</p>
      <div class="flex h-6 rounded-lg overflow-hidden border border-[#EDE9E3]">${barHtml}</div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">${detailHtml}</div>
      ${outsideWindow ? `<p class="text-[10px] text-[#bbb] mt-1">${outsideWindow} ${t("booking(s) fall outside the displayed window")}</p>` : ""}
    </div>`;
}

async function renderReservationsTable(data) {
  const tbody = document.getElementById("reservations-tbody");
  if (!tbody) return;

  if (!data.length) {
    // Different empty states: "this day" is wrong (and confusing) when
    // the table is showing cross-date search results.
    const msg = resSearchActive
      ? "No reservations found for this guest"
      : "No reservations found for this day";
    tbody.innerHTML =
      '<tr><td colspan="9" class="px-5 py-8 text-center text-[#bbb] text-sm">' +
      msg +
      "</td></tr>";
    return;
  }

  // Attach visit counts
  const allGuestIds = data.map((r) => ({ guest_id: r.guest_id }));
  if (allGuestIds.length) {
    await attachGuestVisitCounts(allGuestIds);
  }
  const visitMap = {};
  data.forEach((r) => {
    if (r.guest_id) visitMap[r.guest_id] = r._visitCount || 0;
  });

  tbody.innerHTML = data
    .map((r) => {
      const visits = r.guest_id ? visitMap[r.guest_id] || 0 : 0;
      const tierBadge = formatSpendingTierBadge(r.guests?.spending_tier);
      const latestTag = r.guests?.tag
        ? r.guests.tag
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(-1)[0]
        : null;
      const latestTagHtml = latestTag
        ? '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#F3F4F6] text-[#555]">' +
          escapeHtml(latestTag) +
          "</span>"
        : "";
      const mbrBadge = memberBadge(r.guest_id);
      const extras =
        tierBadge || latestTagHtml || mbrBadge
          ? '<div class="flex flex-wrap items-center gap-1.5 mt-1.5">' +
            tierBadge +
            mbrBadge +
            latestTagHtml +
            "</div>"
          : "";
      const dateLabel = new Date(
        r.reservation_date + "T00:00:00",
      ).toLocaleDateString(CURRENT_LANG === "id" ? "id-ID" : "en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      return (
        '<tr class="table-row border-b border-[#F5F3EF]">' +
        '<td class="px-5 py-3.5 text-sm text-[#555]">' +
        dateLabel +
        "</td>" +
        '<td class="px-5 py-3.5 font-display text-[#28547C]">' +
        fmt.time(r.reservation_time) +
        "</td>" +
        '<td class="px-5 py-3.5">' +
        '<p class="font-medium text-sm text-[#222]">' +
        (r.guests?.name || "—") +
        "</p>" +
        (r.guests?.phone
          ? '<p class="text-xs text-[#999] mt-0.5">' + r.guests.phone + "</p>"
          : "") +
        extras +
        "</td>" +
        '<td class="px-5 py-3.5 text-sm text-[#555]">' +
        fmt.pax(r.pax) +
        "</td>" +
        '<td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell">' +
        (r.tables?.name || "—") +
        "</td>" +
        // Area column removed 2026-07-17 — freed horizontal space so the
        // WA action buttons stay visible without scrolling.
        (function () {
          const MAX = 30;
          const raw = r.notes || "";
          const truncated = raw.length > MAX;
          const display = truncated ? raw.slice(0, MAX) + "…" : raw;
          const cell = raw
            ? truncated
              ? '<span class="relative group cursor-default">' +
                '<span class="block text-xs leading-snug whitespace-normal break-words" style="max-width:110px">' +
                escapeHtml(display) +
                "</span>" +
                '<span class="pointer-events-none absolute z-50 left-0 top-full mt-1 w-56 rounded-lg bg-[#1C2B3A] text-white text-xs px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-pre-wrap break-words" style="min-width:140px">' +
                escapeHtml(raw) +
                "</span>" +
                "</span>"
              : '<span class="block text-xs leading-snug whitespace-normal break-words" style="max-width:110px">' +
                escapeHtml(display) +
                "</span>"
            : "—";
          return (
            '<td class="px-5 py-3.5 text-sm text-[#555] hidden md:table-cell align-top">' +
            cell +
            "</td>"
          );
        })() +
        '<td class="px-5 py-3.5 hidden md:table-cell"><span class="font-display text-lg text-[#28547C]">' +
        (visits || "—") +
        "</span></td>" +
        '<td class="px-5 py-3.5">' +
        statusBadge(r.status) +
        "</td>" +
        '<td class="px-5 py-3.5"><div class="flex items-center gap-3"><a href="reservation-confirmation.html?id=' +
        r.id +
        '" target="_blank" class="text-xs text-[#5596CE] hover:underline flex items-center gap-1"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/><polyline points=\"15 3 21 3 21 9\"/><line x1=\"10\" y1=\"14\" x2=\"21\" y2=\"3\"/></svg>Link</a><button onclick="openResActions(\'' +
        r.id +
        '\')" class="text-xs text-[#C8A96B] hover:underline">Update</button>' +
        waReservationBtns(r) +
        "</div></td>" +
        "</tr>"
      );
    })
    .join("");
}

async function openResActions(resId) {
  const { data: res, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("*, guests(name,phone,booking_alias), tables(name)")
        .eq("id", resId)
        .single(),
    "Failed to load reservation actions",
  );
  if (error || !res) return;

  const STATUSES = [
    "Reserved",
    "Arrived",
    "Completed",
    "Cancelled",
    "Cancelled (No Show)",
  ];
  const content = document.getElementById("res-actions-content");

  content.innerHTML = `
    <div class="mb-4 p-3 bg-[#F8F6F2] rounded-10">
      <p class="font-medium text-[#222]">${res.guests ? formatGuestName(res.guests) : "—"} ${memberBadge(res.guest_id)}</p>
      <p class="text-xs text-[#999]">${fmt.time(res.reservation_time)} · ${fmt.pax(res.pax)}</p>
      ${res.reservation_source ? `<p class="text-xs text-[#999] mt-1">Source: ${escapeHtml(res.reservation_source)}</p>` : ""}
    </div>
    <p class="text-xs text-[#999] uppercase tracking-wider mb-3 font-medium">Update Status</p>
    <div class="grid grid-cols-2 gap-2 mb-4">
      ${STATUSES.map(
        (s) => `
        <button onclick="${s === "Completed" ? `openCompleteReservation('${res.id}')` : `updateResStatus('${res.id}','${s}')`}" 
          class="text-sm py-2.5 px-3 rounded-10 border transition-all text-left font-medium ${res.status === s ? "border-[#5596CE] bg-[#EEF3F7] text-[#5596CE]" : "border-[#E0DDD7] text-[#555] hover:border-[#5596CE]"}">
          ${s}
        </button>
      `,
      ).join("")}
    </div>
    <div class="divider my-3"></div>
    <p class="text-xs text-[#999] uppercase tracking-wider mb-2 font-medium">Assign Table</p>
    <div class="space-y-2 mb-4">
      <select id="res-action-area" class="form-input text-sm w-full" onchange="onResActionAreaChange('${res.id}')">
        <option value="">— Area —</option>
        ${allAreas.map((a) => `<option value="${a.id}" ${res.assigned_area === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
      </select>
      <div id="res-action-table-wrap" class="grid grid-cols-3 gap-1.5"></div>
    </div>
    <button onclick="saveResActionTable('${res.id}')" class="btn-primary w-full justify-center text-sm mb-2">Save Table Assignment</button>
    <div class="divider my-3"></div>
    <div class="space-y-2">
      <button onclick="editReservation('${res.id}')" class="btn-ghost text-xs w-full justify-center">Edit Full Details</button>
      ${
        res.status === "Deleted"
          ? ""
          : `<button onclick="cancelReservation('${res.id}')" class="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 rounded-10 px-3 py-2 transition-colors w-full">Cancel Reservation</button>`
      }
      ${
        res.status === "Deleted"
          ? `<p class="text-xs text-[#999] text-center italic">Deleted${res.delete_reason ? `: ${escapeHtml(res.delete_reason)}` : ""}</p>`
          : `<button onclick="openDeleteReservation('${res.id}')" class="manager-only-ui text-xs text-white bg-red-500 hover:bg-red-600 rounded-10 px-3 py-2 transition-colors w-full font-medium">
              Delete Reservation (Manager)
            </button>`
      }
    </div>
  `;
  showModal("modal-res-actions");
  applyManagerOnlyUI();

  // Render initial table grid for current area
  renderResActionTableGrid(res.assigned_area, res.table_id);
}

// ── Delete Reservation (manager-only, soft-delete) ──────────────────────
// Distinct from Cancel: Cancelled = guest backed out (reporting signal).
// Deleted = staff made a data-entry mistake (e.g. duplicate reservation +
// walk-in for the same visit) and wants it out of the normal view. The
// reservation row, the guest, and any linked visit history are NEVER
// hard-deleted — only marked and hidden from the default list.
async function openDeleteReservation(resId) {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can delete a reservation", "error");
    return;
  }

  // Guardrail: if a linked visit already has recorded spend or a membership
  // transaction, block and tell the manager to resolve that first — we
  // don't want financial/membership history disappearing from view silently.
  const { data: linkedVisits } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("id, spend_amount")
        .eq("reservation_id", resId)
        .is("voided_at", null),
    "Failed to check linked visits before delete",
  );

  const visitIds = (linkedVisits || []).map((v) => v.id);
  const hasSpend = (linkedVisits || []).some(
    (v) => v.spend_amount != null && v.spend_amount > 0,
  );

  let hasMemberTxn = false;
  if (visitIds.length) {
    const { data: txns } = await supabaseQuery(
      () => db.from("member_transactions").select("id").in("visit_id", visitIds),
      "Failed to check membership transactions before delete",
    );
    hasMemberTxn = !!txns?.length;
  }

  if (hasSpend || hasMemberTxn) {
    toast(
      "Can't delete: this visit has recorded spend or a membership transaction. Resolve that first (e.g. edit the spend/transaction), then delete.",
      "error",
    );
    return;
  }

  _voidReasonContext = { type: "reservation", id: resId };
  document.getElementById("void-reason-title").textContent = "Delete Reservation";
  document.getElementById("void-reason-summary").textContent =
    "This hides the reservation from the normal view. The guest profile and any completed visit history are kept.";
  document.getElementById("void-reason-select").value = "Duplicate entry";
  document.getElementById("void-reason-notes").value = "";
  document.getElementById("void-reason-warning").classList.add("hidden");
  hideModal("modal-res-actions");
  showModal("modal-void-reason");
}

let _resActionSelectedTable = null;

function renderResActionTableGrid(areaId, currentTableId) {
  _resActionSelectedTable = currentTableId || null;
  const wrap = document.getElementById("res-action-table-wrap");
  if (!wrap) return;
  const tables = allTables.filter((t) => t.area_id === areaId);
  if (!tables.length) {
    wrap.innerHTML =
      '<p class="text-xs text-[#bbb] col-span-3">No tables in this area</p>';
    return;
  }
  wrap.innerHTML = tables
    .map((t) => {
      const isSelected = t.id === _resActionSelectedTable;
      return `<button onclick="selectResActionTable('${t.id}')"
      id="res-action-tbl-${t.id}"
      class="text-xs py-2 px-2 rounded-lg border transition-all font-medium text-center
        ${isSelected ? "border-[#5596CE] bg-[#EEF3F7] text-[#5596CE]" : "border-[#E0DDD7] text-[#555] hover:border-[#5596CE]"}">
      ${escapeHtml(t.name)}
    </button>`;
    })
    .join("");
}

function selectResActionTable(tableId) {
  _resActionSelectedTable =
    _resActionSelectedTable === tableId ? null : tableId;
  // Re-highlight buttons
  const wrap = document.getElementById("res-action-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll("button").forEach((btn) => {
    const tid = btn.id.replace("res-action-tbl-", "");
    const active = tid === _resActionSelectedTable;
    btn.className = `text-xs py-2 px-2 rounded-lg border transition-all font-medium text-center ${active ? "border-[#5596CE] bg-[#EEF3F7] text-[#5596CE]" : "border-[#E0DDD7] text-[#555] hover:border-[#5596CE]"}`;
  });
}

function onResActionAreaChange(resId) {
  const areaId = document.getElementById("res-action-area")?.value || null;
  _resActionSelectedTable = null;
  renderResActionTableGrid(areaId, null);
}

async function saveResActionTable(resId) {
  const areaId = document.getElementById("res-action-area")?.value || null;
  const tableId = _resActionSelectedTable || null;
  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .update({
          assigned_area: areaId || null,
          table_id: tableId || null,
        })
        .eq("id", resId),
    "Failed to assign table",
  );
  loader(false);
  if (error) {
    toast(error.message || "Failed to assign table", "error");
    return;
  }
  toast("Table assigned successfully");
  hideModal("modal-res-actions");
  loadReservations();
  if (isViewingStaffDashboard()) loadDashboard();
}

async function updateResStatus(resId, status) {
  // No Show is stored as Cancelled (No Show) — auto-convert
  const dbStatus = status === "No Show" ? "Cancelled (No Show)" : status;
  loader(true);
  const { error } = await supabaseQuery(
    () => db.from("reservations").update({ status: dbStatus }).eq("id", resId),
    "Failed to update reservation status",
  );
  loader(false);

  if (error) {
    toast(error.message || "Failed to update reservation status", "error");
    return;
  }

  if (status === "Arrived") {
    const { data: res, error: resFetchError } = await supabaseQuery(
      () => db.from("reservations").select("*").eq("id", resId).single(),
      "Failed to load reservation for visit",
    );
    if (!res || resFetchError) {
      toast(
        "Reservation status updated, but could not record arrival visit",
        "error",
      );
    } else {
      const { error: visitError } = await supabaseQuery(
        () =>
          db.from("visits").insert({
            guest_id: res.guest_id,
            reservation_id: resId,
            visit_type: "Reservation",
            visit_date: res.reservation_date,
            visit_time: getNowTime(),
            pax: res.pax,
            assigned_area: res.assigned_area,
            table_id: res.table_id || null,
            created_by: currentStaffId(),
          }),
        "Failed to record arrival visit",
      );
      if (visitError) {
        toast("Status updated, but arrival visit could not be saved", "error");
      } else {
        await updateGuestSpendingTier(res.guest_id);
      }
    }
  }

  // Cancelling a reservation must also clean up its linked visit,
  // otherwise the guest stays "Active" (occupying area/table) forever.
  if (dbStatus === "Cancelled" || dbStatus === "Cancelled (No Show)") {
    const { data: linkedVisits } = await supabaseQuery(
      () =>
        db
          .from("visits")
          .select("id, spend_amount")
          .eq("reservation_id", resId)
          .eq("status", "Active"),
      "Failed to check linked visits",
    );
    for (const v of linkedVisits || []) {
      if (v.spend_amount == null) {
        // No spend recorded — the visit effectively didn't happen
        await supabaseQuery(
          () => db.from("visits").delete().eq("id", v.id),
          "Failed to remove cancelled visit",
        );
      } else {
        // Spend exists — keep the record but close it out
        await supabaseQuery(
          () =>
            db
              .from("visits")
              .update({
                status: "Done",
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", v.id),
          "Failed to close cancelled visit",
        );
      }
    }
  }

  toast(`Status updated to ${status}`);
  hideModal("modal-res-actions");
  loadReservations();
  if (isViewingStaffDashboard()) loadDashboard();
}

// ── Shared reason-capture handler for delete-reservation / void-walkin ──
// _voidReasonContext.type tells us which finalize function to call.
async function confirmVoidReason() {
  if (!_voidReasonContext) {
    hideModal("modal-void-reason");
    return;
  }
  if (!isManagerOrAdmin()) {
    // Defense in depth — the button is already manager-only-ui, but a stale
    // session or role change mid-session shouldn't let this slip through.
    toast("Only a manager can do this", "error");
    hideModal("modal-void-reason");
    _voidReasonContext = null;
    return;
  }

  const reasonSelect = document.getElementById("void-reason-select")?.value;
  const notes = document.getElementById("void-reason-notes")?.value.trim();
  const warningEl = document.getElementById("void-reason-warning");

  if (reasonSelect === "Other" && !notes) {
    warningEl.textContent = "Please add a short detail for \"Other\".";
    warningEl.classList.remove("hidden");
    return;
  }
  const reason = notes ? `${reasonSelect}: ${notes}` : reasonSelect;

  const { type, id } = _voidReasonContext;
  loader(true);
  const ok =
    type === "reservation"
      ? await finalizeDeleteReservation(id, reason)
      : await finalizeVoidVisit(id, reason);
  loader(false);

  if (ok) {
    hideModal("modal-void-reason");
    _voidReasonContext = null;
  }
}

async function finalizeDeleteReservation(resId, reason) {
  const { error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .update({
          status: "Deleted",
          deleted_at: new Date().toISOString(),
          deleted_by: currentStaffId(),
          delete_reason: reason,
        })
        .eq("id", resId),
    "Failed to delete reservation",
  );
  if (error) {
    toast(error.message || "Failed to delete reservation", "error");
    return false;
  }

  // A reservation the guest actually arrived for has a linked visit row
  // (visit_type='Reservation', reservation_id=resId). Deleting the
  // reservation without voiding that visit would leave it counting toward
  // the guest's visit total AND, if a table was assigned, keep that table
  // marked "occupied" forever — same class of bug the Cancel flow already
  // guards against (see updateResStatus). openDeleteReservation's guardrail
  // already confirmed none of these have spend or a membership transaction,
  // so it's safe to auto-void them here with the same reason.
  const { data: linkedVisits } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("id")
        .eq("reservation_id", resId)
        .is("voided_at", null),
    "Failed to check linked visits after delete",
  );
  if (linkedVisits?.length) {
    await supabaseQuery(
      () =>
        db
          .from("visits")
          .update({
            voided_at: new Date().toISOString(),
            voided_by: currentStaffId(),
            void_reason: `Reservation deleted: ${reason}`,
            updated_at: new Date().toISOString(),
          })
          .in(
            "id",
            linkedVisits.map((v) => v.id),
          ),
      "Failed to void visit linked to deleted reservation",
    );
  }

  toast("Reservation deleted");
  loadReservations();
  if (isViewingStaffDashboard()) loadDashboard();
  return true;
}

async function finalizeVoidVisit(visitId, reason) {
  const { error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .update({
          voided_at: new Date().toISOString(),
          voided_by: currentStaffId(),
          void_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", visitId),
    "Failed to void walk-in",
  );
  if (error) {
    toast(error.message || "Failed to void walk-in", "error");
    return false;
  }
  toast("Walk-in removed");
  loadWalkIns();
  if (isViewingStaffDashboard()) loadDashboard();
  return true;
}

// Fix a spelling mistake in the guest's name directly from the reservation
// edit modal. Updates the guests record (and linked member card, if any) —
// the reservation keeps pointing at the SAME guest, so visit history,
// stickers and spending tier are untouched.
async function renameReservationGuest() {
  const guestId =
    currentResGuestId || document.getElementById("res-guest-id")?.value;
  if (!guestId) return;

  const currentName =
    document.getElementById("res-guest-search")?.value.trim() || "";
  const input = prompt("Perbaiki nama guest:", currentName);
  if (input === null) return; // staff cancelled
  const newName = input.trim();
  if (!newName) {
    toast("Nama guest tidak boleh kosong", "error");
    return;
  }
  if (newName === currentName) return;

  loader(true);
  const { error } = await supabaseQuery(
    () => db.from("guests").update({ name: newName }).eq("id", guestId),
    "Failed to rename guest",
  );
  if (error) {
    loader(false);
    toast(error.message || "Gagal memperbarui nama guest", "error");
    return;
  }
  // Keep the member card name in sync (no-op if guest is not a member)
  await supabaseQuery(
    () =>
      db.from("members").update({ full_name: newName }).eq("guest_id", guestId),
    "Failed to sync member name",
  );
  loader(false);

  const searchEl = document.getElementById("res-guest-search");
  if (searchEl) searchEl.value = newName;
  const nameEl = document.getElementById("res-guest-info-name");
  if (nameEl)
    nameEl.innerHTML = `${escapeHtml(newName)} ${memberBadge(guestId)}`;

  toast("Nama guest diperbarui");
  loadReservations();
  if (isViewingStaffDashboard()) loadDashboard();
}

async function editReservation(resId) {
  hideModal("modal-res-actions");
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select("*, guests(name,phone,booking_alias), tables(name)")
        .eq("id", resId)
        .single(),
    "Failed to load reservation for edit",
  );
  if (error) return;
  if (data) openReservationModal(data);
}

async function cancelReservation(resId) {
  if (!confirm("Cancel this reservation?")) return;
  await updateResStatus(resId, "Cancelled");
}

function exportReservations() {
  // While a search is active `allReservations` holds the (cross-date)
  // result set, so the export follows what's on screen. The filename says
  // so — otherwise a search export is indistinguishable from a day export.
  const slug = resSearchActive
    ? "search-" +
      (resSearchActive.label || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40)
    : resSelectedDate || TODAY;
  return downloadReservationSheet(
    `export-reservations-${slug || TODAY}`,
    allReservations.map((r) => resExportRow(r)),
    resSearchActive ? "Search results" : slug || TODAY,
  );
}

function exportReservationSources() {
  const sources = currentOpsReservationSources || [];
  if (!sources.length) {
    toast("No reservation sources to export", "error");
    return;
  }

  downloadCsv(
    `export-reservation-sources-${TODAY}.csv`,
    ["Reservation Source", "Reservations"],
    sources.map((s) => [s.label, s.count]),
  );
  toast("Reservation sources exported");
}

// ============================================================
// COMPLETE VISIT
// ============================================================
// The arrival question belongs to reservations only, and only when there is
// no visit row. Both open* functions reset it, so it can never be left over
// from a previous open.
function resetCompleteArrivedAsk() {
  const ask = document.getElementById("complete-arrived-ask");
  if (ask) ask.classList.add("hidden");
  const yes = document.getElementById("complete-arrived-yes");
  const no = document.getElementById("complete-arrived-no");
  if (yes) yes.checked = false;
  if (no) no.checked = false;
  document.getElementById("complete-arrived-error")?.classList.add("hidden");
  document.getElementById("complete-spend-block")?.classList.remove("hidden");
  document.getElementById("complete-favmenu-block")?.classList.remove("hidden");
  const btn = document.getElementById("complete-submit-btn");
  if (btn) btn.textContent = t("Complete & Save");
}

// Picking "no" turns this modal into a no-show form: nothing to spend, no
// favourite menu to record. Notes stay, because "booked, never called to
// cancel" is worth writing down.
function onCompleteArrivedChange() {
  const came = document.getElementById("complete-arrived-yes")?.checked;
  document.getElementById("complete-arrived-error")?.classList.add("hidden");
  document
    .getElementById("complete-spend-block")
    ?.classList.toggle("hidden", !came);
  document
    .getElementById("complete-favmenu-block")
    ?.classList.toggle("hidden", !came);
  const btn = document.getElementById("complete-submit-btn");
  if (btn) btn.textContent = came ? t("Complete & Save") : t("Mark as No Show");
}

async function openCompleteVisit(id, type) {
  resetCompleteArrivedAsk();
  document.getElementById("complete-visit-id").value = id;
  document.getElementById("complete-type").value = type;
  document.getElementById("complete-spend").value = "";
  document.getElementById("complete-notes").value = "";
  resetCompleteOrderFields();
  document.getElementById("complete-spend-error")?.classList.add("hidden");
  showModal("modal-complete-visit");

  // Pre-populate existing spend if this visit was already completed, and
  // the guest's currently saved favorite menu / recent order (if any).
  const { data: existing } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("spend_amount, notes, guest_id, guests(favorite_menu, last_order)")
        .eq("id", id)
        .single(),
    "Failed to load visit spend",
  );
  if (existing?.spend_amount != null) {
    document.getElementById("complete-spend").value = existing.spend_amount;
  }
  if (existing?.notes) {
    document.getElementById("complete-notes").value = existing.notes;
  }
  fillCompleteOrderFields(existing?.guests);
}

async function openCompleteReservation(resId) {
  resetCompleteArrivedAsk();
  document.getElementById("complete-visit-id").value = resId;
  document.getElementById("complete-type").value = "reservation";
  document.getElementById("complete-spend").value = "";
  document.getElementById("complete-notes").value = "";
  resetCompleteOrderFields();
  document.getElementById("complete-spend-error")?.classList.add("hidden");
  hideModal("modal-res-actions");
  showModal("modal-complete-visit");

  // Pre-populate spend from linked visit if already completed, and the
  // guest's currently saved favorite menu / recent order (if any).
  const { data: linkedVisit } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("spend_amount, notes, guest_id, guests(favorite_menu, last_order)")
        .eq("reservation_id", resId)
        .maybeSingle(),
    "Failed to load linked visit spend",
  );

  // No visit row means nobody clicked Arrived, so the app genuinely does not
  // know whether this table showed up. Ask rather than guess: guessing "they
  // came" invents a visit for a no-show, and guessing "they didn't" throws
  // away real money. Both were live bugs at Blue Heron.
  if (!linkedVisit) {
    document.getElementById("complete-arrived-ask")?.classList.remove("hidden");
  }
  if (linkedVisit?.spend_amount != null) {
    document.getElementById("complete-spend").value = linkedVisit.spend_amount;
  }
  if (linkedVisit?.notes) {
    document.getElementById("complete-notes").value = linkedVisit.notes;
  }
  fillCompleteOrderFields(linkedVisit?.guests);
}

// The box starts EMPTY, not pre-filled with the last order. Pre-filling means
// a staff member who just presses Complete re-saves last week's dish as if it
// were tonight's, and the field stops meaning anything. Blank plus "leave
// blank to keep what's saved" is the honest default.
function resetCompleteOrderFields() {
  const el = document.getElementById("complete-last-order");
  if (el) el.value = "";
  const tick = document.getElementById("complete-set-favorite");
  if (tick) tick.checked = false;
  setText("complete-current-favorite", "");
}

// Shows the favorite the guest already has, so ticking the box is a decision
// about replacing something specific rather than a blind toggle.
function fillCompleteOrderFields(guest) {
  const fav = (guest && guest.favorite_menu) || "";
  setText(
    "complete-current-favorite",
    fav ? `${t("Currently")}: ${fav}` : t("No favorite saved yet"),
  );
}

async function confirmCompleteVisit() {
  const id = document.getElementById("complete-visit-id").value;
  const type = document.getElementById("complete-type").value;
  const spend = cleanNumericInput(
    document.getElementById("complete-spend").value,
  );
  const spendAmount = spend === "" ? null : parseFloat(spend);
  const notes = document.getElementById("complete-notes").value.trim() || null;
  const lastOrderInput = document
    .getElementById("complete-last-order")
    .value.trim();
  const alsoSetFavorite = !!document.getElementById("complete-set-favorite")
    ?.checked;

  // ── The guest never came ────────────────────────────────────────────
  // This branch runs BEFORE the spend check on purpose: a no-show has no
  // spend to enter, and demanding one is what pushed staff into completing
  // no-shows with a fake number in the first place.
  //
  // The booking goes to Cancelled (No Show), which is the status that has
  // always existed for exactly this and which the reports already
  // understand. No visit row is created, so the guest's history stays
  // honest and the channel reports stop crediting arrivals that never
  // happened.
  const arrivedAsk = document.getElementById("complete-arrived-ask");
  const askVisible = arrivedAsk && !arrivedAsk.classList.contains("hidden");
  if (type === "reservation" && askVisible) {
    const came = document.getElementById("complete-arrived-yes")?.checked;
    const didNot = document.getElementById("complete-arrived-no")?.checked;
    if (!came && !didNot) {
      document
        .getElementById("complete-arrived-error")
        ?.classList.remove("hidden");
      return;
    }
    if (didNot) {
      loader(true);
      const { error: noShowError } = await supabaseQuery(
        () =>
          db
            .from("reservations")
            .update({
              status: "Cancelled (No Show)",
              updated_at: new Date().toISOString(),
            })
            .eq("id", id),
        "Failed to mark reservation as no show",
      );
      loader(false);
      if (noShowError) {
        toast("Failed to save. Please try again.", "error");
        return;
      }
      toast("Marked as no show");
      hideModal("modal-complete-visit");
      if (isViewingStaffDashboard()) loadDashboard();
      if (currentPage === "reservations") loadReservations();
      return;
    }
  }

  // Spend is mandatory — show inline error and abort if missing
  if (spendAmount === null || isNaN(spendAmount)) {
    const errEl = document.getElementById("complete-spend-error");
    if (errEl) errEl.classList.remove("hidden");
    document.getElementById("complete-spend")?.focus();
    return;
  }

  loader(true);
  const completePayload = { notes, updated_at: new Date().toISOString() };

  let guestIdForTier = null;
  let visitIdForMembership = null;

  if (type === "visit") {
    completePayload.spend_amount = spendAmount;
    completePayload.completed_at = new Date().toISOString();
    completePayload.status = "Done";
    const { error } = await supabaseQuery(
      () => db.from("visits").update(completePayload).eq("id", id),
      "Failed to complete visit",
    );
    loader(false);
    if (error) {
      toast("Failed to save — visit not completed. Please try again.", "error");
      return;
    }

    // Verify the write actually landed with the spend amount
    const { data: saved } = await supabaseQuery(
      () =>
        db
          .from("visits")
          .select("guest_id, spend_amount, status")
          .eq("id", id)
          .single(),
      "Failed to verify visit",
    );
    if (!saved || saved.status !== "Done" || saved.spend_amount === null) {
      toast("Spend amount did not save correctly. Please try again.", "error");
      // Roll back the status so the visit isn't silently stuck as Done without spend
      await supabaseQuery(
        () =>
          db
            .from("visits")
            .update({
              status: "Arrived",
              completed_at: null,
              spend_amount: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id),
        "Failed to rollback visit status",
      );
      return;
    }
    guestIdForTier = saved.guest_id;
    visitIdForMembership = id;
  } else if (type === "reservation") {
    // 1. Mark reservation as Completed
    const { error: resError } = await supabaseQuery(
      () =>
        db
          .from("reservations")
          .update({ status: "Completed", updated_at: new Date().toISOString() })
          .eq("id", id),
      "Failed to complete reservation",
    );
    if (resError) {
      loader(false);
      toast(
        "Failed to save — reservation not completed. Please try again.",
        "error",
      );
      return;
    }

    // 2. Find the linked visit (created when guest Arrived) and save spend + mark Done
    let { data: linkedVisit } = await supabaseQuery(
      () =>
        db
          .from("visits")
          .select("id, guest_id")
          .eq("reservation_id", id)
          .maybeSingle(),
      "Failed to find linked visit",
    );

    // No linked visit means staff went Reserved -> Completed without ever
    // clicking Arrived. Two completely different things cause that, and this
    // branch used to do nothing at all for either of them: the reservation
    // flipped to Completed, no visit row was written, the spend staff had
    // just typed was discarded, and the toast still said "Visit completed".
    //
    // Measured at Blue Heron 2026-08-30: 15 reservations, 7.7% of every
    // completed booking, 91 pax. Every one flipped on the reservation day
    // between 16:00 and 21:30, which is front desk clearing the board at
    // closing. Some of those guests ate; some never came.
    //
    // So the app asks (see the arrival question in openCompleteReservation)
    // and only reaches this point when staff said the guest DID come. Same
    // insert shape as updateResStatus("Arrived") - keep the two in step.
    if (!linkedVisit) {
      const { data: resRow } = await supabaseQuery(
        () =>
          db
            .from("reservations")
            .select("guest_id, reservation_date, pax, assigned_area, table_id")
            .eq("id", id)
            .single(),
        "Failed to load reservation for visit",
      );
      if (resRow) {
        const { data: createdVisit } = await supabaseQuery(
          () =>
            db
              .from("visits")
              .insert({
                guest_id: resRow.guest_id,
                reservation_id: id,
                visit_type: "Reservation",
                visit_date: resRow.reservation_date,
                visit_time: getNowTime(),
                pax: resRow.pax,
                assigned_area: resRow.assigned_area,
                table_id: resRow.table_id || null,
                created_by: currentStaffId(),
              })
              .select("id, guest_id")
              .single(),
          "Failed to record visit for completed reservation",
        );
        if (createdVisit) linkedVisit = createdVisit;
      }
    }

    if (linkedVisit) {
      const { error: visitError } = await supabaseQuery(
        () =>
          db
            .from("visits")
            .update({
              spend_amount: spendAmount,
              notes: notes || undefined,
              completed_at: new Date().toISOString(),
              status: "Done",
              updated_at: new Date().toISOString(),
            })
            .eq("id", linkedVisit.id),
        "Failed to save spend on reservation visit",
      );
      if (visitError) {
        loader(false);
        toast(
          "Spend amount did not save correctly. Please try again.",
          "error",
        );
        // Roll back reservation status
        await supabaseQuery(
          () =>
            db
              .from("reservations")
              .update({
                status: "Arrived",
                updated_at: new Date().toISOString(),
              })
              .eq("id", id),
          "Failed to rollback reservation status",
        );
        return;
      }
      guestIdForTier = linkedVisit.guest_id;
      visitIdForMembership = linkedVisit.id;
    } else {
      // The visit could not be found AND could not be created. Leaving the
      // reservation Completed here would recreate exactly the silent
      // data-loss this block exists to remove, so roll the status back and
      // say so out loud. Reserved, not Arrived: there is no visit row, so
      // the guest was never marked arrived in the first place.
      await supabaseQuery(
        () =>
          db
            .from("reservations")
            .update({ status: "Reserved", updated_at: new Date().toISOString() })
            .eq("id", id),
        "Failed to rollback reservation status",
      );
      loader(false);
      toast(
        "Could not save the visit. Spend was not recorded, please try again.",
        "error",
      );
      return;
    }
    loader(false);
  }

  if (guestIdForTier) await updateGuestSpendingTier(guestIdForTier);

  // Favorite menu / recent order is optional and overwrites the guest's
  // saved value only when staff actually typed something — leave existing
  // value untouched if the field was left blank.
  // What they ate always lands in last_order. It only becomes their favorite
  // when the tick says so, which is the whole point of splitting the two.
  if (guestIdForTier && lastOrderInput) {
    const guestUpdate = { last_order: lastOrderInput };
    if (alsoSetFavorite) guestUpdate.favorite_menu = lastOrderInput;
    await supabaseQuery(
      () => db.from("guests").update(guestUpdate).eq("id", guestIdForTier),
      "Failed to save the order",
    );
  }

  // Membership: if this guest is a member, award sticker for this visit's
  // spend (DB skips silently if this visit was already recorded).
  if (guestIdForTier && spendAmount > 0) {
    await maybeAwardMembershipSticker(
      guestIdForTier,
      spendAmount,
      visitIdForMembership,
    );
  }

  toast("Visit completed");
  invalidateVisitCountCache(); // visit completed — bust count cache
  invalidateGuestVisitHistoryCache();
  _tierRefreshLastRun = 0; // force tier recalc next loadGuests
  hideModal("modal-complete-visit");
  if (isViewingStaffDashboard()) loadDashboard();
  if (currentPage === "walkins") loadWalkIns();
  if (currentPage === "reservations") loadReservations();
  if (currentPage === "areas") renderAreas();
  // Sync area occupancy silently so it's accurate when staff next visits that page
  if (currentPage !== "areas") renderAreas().catch(() => {});
  // Sync today's spending summary if on reports tab
  const reportsWalkinsView = document.getElementById(
    "reports-walkins-insights-view",
  );
  if (reportsWalkinsView && !reportsWalkinsView.classList.contains("hidden")) {
    loadTodaySpendingSummary();
  }
}

// ============================================================
// REPORTS
// ============================================================
let currentReportSegments = {};
let currentReportsTab = "marketing";
let currentWiReportRange = "week";
let currentMarketingRange = "month";
let currentOpsReservationSources = [];
let currentOpsReportRange = "week";

const REPORT_AREA_GROUPS = [
  {
    id: "indoor",
    name: "Indoor Dining",
    match: (area) => area.name === "Indoor Dining",
  },
  {
    id: "outdoor",
    name: "Outdoor Dining",
    match: (area) => area.name === "Outdoor Dining",
  },
  {
    id: "vip",
    name: "VIP Room",
    match: (area) => area.name.startsWith("VIP Room"),
  },
];

function setReportsTab(tab) {
  currentReportsTab = tab;
  const isMarketing = tab === "marketing";
  const isOperations = tab === "operations";
  const isWalkins = tab === "walkins";

  document
    .getElementById("reports-marketing-view")
    ?.classList.toggle("hidden", !isMarketing);
  document
    .getElementById("reports-operations-view")
    ?.classList.toggle("hidden", !isOperations);
  document
    .getElementById("reports-walkins-insights-view")
    ?.classList.toggle("hidden", !isWalkins);

  const marketingBtn = document.getElementById("reports-tab-marketing");
  const operationsBtn = document.getElementById("reports-tab-operations");
  const walkinsBtn = document.getElementById("reports-tab-walkins");

  [marketingBtn, operationsBtn, walkinsBtn].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("bg-white", "text-[#28547C]");
    btn.classList.add("text-[#555]");
  });

  const activeBtn = isMarketing
    ? marketingBtn
    : isOperations
      ? operationsBtn
      : walkinsBtn;
  if (activeBtn) {
    activeBtn.classList.add("bg-white", "text-[#28547C]");
    activeBtn.classList.remove("text-[#555]");
  }

  // when opening Spending Insights, ensure tag suggestions are loaded
  if (isWalkins) {
    loadGuestTagSuggestions();
    renderWiTagPills();
    loadTodaySpendingSummary();
  }

  const desc = document.getElementById("reports-tab-desc");
  if (desc) {
    desc.textContent = t(
      isMarketing
        ? "Guest retention, loyalty insights and marketing audiences"
        : isOperations
          ? "Reservation demand, utilization and operational performance"
          : "High-value guest identification and spending behavior analysis",
    );
  }

  if (isWalkins) {
    setWiReportRange(currentWiReportRange);
  }
  if (isMarketing) {
    loadReports();
    initBirthdayView();
  }
  if (isOperations) {
    loadOperationsReports();
  }
}

async function setOpsReportRange(range) {
  currentOpsReportRange = range;
  const fromInput = document.getElementById("ops-report-from-date");
  const toInput = document.getElementById("ops-report-to-date");
  const customDatesDiv = document.getElementById("ops-custom-dates");

  const buttons = ["today", "week", "month", "custom"];
  buttons.forEach((key) => {
    const btn = document.getElementById(`ops-report-range-${key}`);
    if (btn) {
      btn.classList.toggle("bg-white", currentOpsReportRange === key);
      btn.classList.toggle("font-semibold", currentOpsReportRange === key);
      btn.classList.toggle("border-[#28547C]", currentOpsReportRange === key);
      btn.classList.toggle("text-[#28547C]", currentOpsReportRange === key);
    }
  });

  if (range !== "custom") {
    const { from, to } = getOpsReportDateRange(range);
    if (fromInput) fromInput.value = from;
    if (toInput) toInput.value = to;
    if (customDatesDiv) customDatesDiv.classList.add("hidden");
  } else {
    if (customDatesDiv) customDatesDiv.classList.remove("hidden");
  }

  await updateOpsReportDateRange();

  // Re-load the In Period report sections with the new date range
  await loadOperationsReports();
}

function getOpsReportDateRange(value = currentOpsReportRange) {
  const today = new Date();
  const padded = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (value === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { from: padded(start), to: padded(today) };
  }

  if (value === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: padded(start), to: padded(today) };
  }

  if (value === "custom") {
    const from =
      document.getElementById("ops-report-from-date")?.value || TODAY;
    const to = document.getElementById("ops-report-to-date")?.value || TODAY;
    return { from, to };
  }

  return { from: TODAY, to: TODAY };
}

async function updateOpsReportDateRange() {
  const rangeLabel = document.getElementById("ops-report-range-label");
  const { from, to } = getOpsReportDateRange();
  if (rangeLabel) {
    rangeLabel.textContent =
      from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`;
  }
}

// ══════════════════════════════════════════════════════════════
// RESERVATION SOURCE (controlled list + safe legacy handling)
// ══════════════════════════════════════════════════════════════
// The field was free text until 2026-07-26, so existing rows hold
// values like "by Mba Sherina" that match no option. Loading such a
// row must NOT quietly reset the select to "Not recorded", or simply
// opening and saving a booking would destroy its source. Anything
// unrecognised is routed into the "Other" text box and round-trips
// unchanged.

function onResSourceChange() {
  const sel = document.getElementById("res-source");
  const other = document.getElementById("res-source-other");
  if (!sel || !other) return;
  const isOther = sel.value === "__other__";
  other.classList.toggle("hidden", !isOther);
  if (isOther) other.focus();
  else other.value = "";
}

function setResSourceValue(value) {
  const sel = document.getElementById("res-source");
  const other = document.getElementById("res-source-other");
  if (!sel) return;
  const v = (value || "").trim();
  const known = Array.from(sel.options).some(
    (o) => o.value === v && o.value !== "__other__",
  );
  if (!v) {
    sel.value = "";
  } else if (known) {
    sel.value = v;
  } else {
    sel.value = "__other__";
    if (other) other.value = v;
  }
  onResSourceChangeKeepValue();
}

// Same visibility logic as onResSourceChange but without clearing the
// text box — used when populating the form from an existing record.
function onResSourceChangeKeepValue() {
  const sel = document.getElementById("res-source");
  const other = document.getElementById("res-source-other");
  if (!sel || !other) return;
  other.classList.toggle("hidden", sel.value !== "__other__");
}

function readResSourceValue() {
  const sel = document.getElementById("res-source");
  if (!sel) return null;
  if (sel.value === "__other__") {
    return document.getElementById("res-source-other")?.value.trim() || null;
  }
  return sel.value.trim() || null;
}

// ══════════════════════════════════════════════════════════════
// GUEST DISPLAY NAME + BOOKING ALIAS
// ══════════════════════════════════════════════════════════════
// Ops request 2026-07-26: when a returning guest books the online form
// under a different name than the one we hold, show both —
// "Rere (Retno)" — so the host recognises them at the door either way.
//
// The guest's canonical name (guests.name) is staff-owned and is NEVER
// overwritten by a booking. The alias is a separate column refreshed by
// create_public_reservation and it follows the MOST RECENT online
// booking, so it changes if the guest changes what they type.
//
// Both helpers tolerate a missing booking_alias field entirely, so any
// query that hasn't been widened to select it simply renders the plain
// name instead of throwing.

function guestAliasSuffix(guest) {
  const alias = (guest?.booking_alias || "").trim();
  if (!alias) return "";
  const canonical = (guest?.name || "").trim();
  // Belt-and-braces: the RPC already suppresses a matching alias, but a
  // staff rename afterwards could make them equal again. Don't render
  // "Rere (Rere)".
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ");
  if (norm(alias) === norm(canonical)) return "";
  // Since 2026-08-09 the name is displayed with the honorific stripped,
  // so "Ibu Rere" with alias "Rere" now reads "Rere (Rere)" unless the
  // CLEANED name is compared too. The guest typed their own name into
  // the online form without a title — that is the normal case, not an
  // edge case.
  if (norm(alias) === norm(guestReadingName(guest))) return "";
  return ` (${alias})`;
}

// Reading name: the honorific Front Desk typed in front of the name is
// dropped for DISPLAY ONLY. The DB still holds exactly what staff typed.
//
// THE TITLE IS ALL THAT GOES. Everything after the name stays exactly
// as typed — Rere's rule, 2026-08-09. The visit date and the notes
// ("Rini ( Kalbe )", "Ali ( Mas Arya )") are how the host tells four
// different Sintas apart at the door. waCleanGuestName strips those too,
// which is right for a WhatsApp greeting and wrong for a staff screen,
// so this deliberately calls the narrower waStripHonorific instead.
// Do not "simplify" these two into one.
//
// TWO THINGS THIS MUST NEVER DO:
//   1. Return empty — a blank row in the walk-in list is worse than a
//      messy one. Hence the `|| raw` fallback.
//   2. Reach an <input value="...">. Prefilling an edit field with the
//      stripped name means the next save silently rewrites the record,
//      which is the auto-strip behaviour Rere explicitly did not want.
//      Use guest.name directly for inputs.
//
// wa.js loads after app.js in index.html, so the typeof guard is not
// decoration — it keeps this safe if a render ever runs early.
function guestReadingName(guest) {
  const raw = (guest && guest.name) || "";
  if (typeof waStripHonorific !== "function") return raw;
  return waStripHonorific(raw) || raw;
}

// Plain text — use for exports, WhatsApp messages, sorting.
// NOT for input values: see the warning above.
function guestDisplayName(guest) {
  if (!guest || !guest.name) return "Unknown Guest";
  return `${guestReadingName(guest)}${guestAliasSuffix(guest)}`;
}

// Escaped HTML — use inside template literals rendered into the DOM.
// The alias is dimmed so the canonical name stays the primary read.
function formatGuestName(guest) {
  if (!guest || !guest.name) return "Unknown Guest";
  const name = guestReadingName(guest);
  const suffix = guestAliasSuffix(guest);
  if (!suffix) return escapeHtml(name);
  return `${escapeHtml(name)}<span class="text-[#999] font-normal" title="Booked online as ${escapeHtml(guest.booking_alias)}">${escapeHtml(suffix)}</span>`;
}

// Save-time nudge, deliberately NON-BLOCKING.
//
// Front Desk has been asked twice to stop typing titles and dates into
// the name field and has not stopped, so a hard validation would just
// be worked around mid-service ("Ibu Alia" → "Ibu  Alia"). This instead
// shows what the app will actually display. The habit changes because
// staff see the difference, not because they were told off.
//
// It never blocks the save and never rewrites the field.
//
// The hint must show what the GUEST LIST will show, so it uses the same
// waStripHonorific the list uses. Showing the WhatsApp version here
// would promise that the visit date disappears, and it does not.
function updateGuestNameHint(rawName) {
  const el = document.getElementById("g-name-hint");
  if (!el) return;
  const raw = (rawName || "").trim();
  const shown =
    raw && typeof waStripHonorific === "function" ? waStripHonorific(raw) : raw;
  // Only speak up when something actually changes. A hint on every
  // keystroke is noise, and noise gets ignored.
  if (!raw || !shown || shown === raw) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = `Akan tampil sebagai "${shown}" — sapaan seperti Bapak/Ibu tidak perlu diketik.`;
  el.classList.remove("hidden");
}

function formatGuestPhone(guest) {
  return guest?.phone ? escapeHtml(guest.phone) : "—";
}

function renderOpsSpendRow(row, isAverageReport) {
  const guest = row.guests || {};
  const avgSpend = row.pax ? Math.round(row.spend_amount / row.pax) : 0;
  return `
    <tr class="border-b border-[#F5F3EF]">
      <td class="px-4 py-3 text-[#555]">${formatGuestName(guest)}</td>
      <td class="px-4 py-3 text-[#555]">${formatGuestPhone(guest)}</td>
      <td class="px-4 py-3 text-[#555]">${formatSpendingTierBadge(guest.spending_tier)}</td>
      <td class="px-4 py-3 text-[#555]">${fmt.date(row.visit_date)}</td>
      <td class="px-4 py-3 text-right text-[#555]">${fmt.pax(row.pax)}</td>
      <td class="px-4 py-3 text-right text-[#28547C] font-medium">${fmt.currency(row.spend_amount)}</td>
      ${isAverageReport ? `<td class="px-4 py-3 text-right text-[#28547C] font-medium">${fmt.currency(avgSpend)}</td>` : ""}
    </tr>
  `;
}

async function loadOperationsSpendingInsights() {
  const { from, to } = getOpsReportDateRange();
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select(
          "id, visit_date, pax, spend_amount, guest_id, status, completed_at, guests(name, phone, booking_alias, spending_tier, tag)",
        )
        .gt("spend_amount", 0)
        .gte("visit_date", from)
        .lte("visit_date", to)
        .or("status.eq.Done,completed_at.not.is.null")
        .neq("pax", 0)
        .order("spend_amount", { ascending: false }),
    "Failed to load spending insights",
  );

  const highTotalBody = document.getElementById("ops-spend-b-body");
  const highAverageBody = document.getElementById("ops-spend-a-body");
  const totalA = document.getElementById("ops-spend-a-total");
  const highestA = document.getElementById("ops-spend-a-highest");
  const averageA = document.getElementById("ops-spend-a-average");
  const totalB = document.getElementById("ops-spend-b-total");
  const highestB = document.getElementById("ops-spend-b-highest");
  const averageB = document.getElementById("ops-spend-b-average");

  if (error || !data) {
    toast(
      error?.message || "Unable to load walk-in spending insights",
      "error",
    );
    if (highTotalBody)
      highTotalBody.innerHTML =
        '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No walk-in guests matched the selected spending criteria during this period.</td></tr>';
    if (highAverageBody)
      highAverageBody.innerHTML =
        '<tr><td colspan="7" class="px-4 py-8 text-center text-[#bbb] text-sm">No walk-in guests matched the selected spending criteria during this period.</td></tr>';
    return;
  }

  const rows = data || [];
  const highAverage = rows
    .filter((v) => v.pax > 0 && v.spend_amount / v.pax > HIGH_SPEND_PER_PAX)
    .map((v) => ({ ...v, avgSpend: Math.round(v.spend_amount / v.pax) }))
    .sort((a, b) => b.avgSpend - a.avgSpend);
  const highTotal = rows
    .filter((v) => v.spend_amount >= HIGH_SPEND_THRESHOLD)
    .sort((a, b) => b.spend_amount - a.spend_amount);

  if (totalA) totalA.textContent = highAverage.length;
  if (highestA)
    highestA.textContent = highAverage.length
      ? fmt.currency(highAverage[0].avgSpend)
      : fmt.currency(0);
  if (averageA) {
    const avgValue = highAverage.length
      ? Math.round(
          highAverage.reduce((sum, v) => sum + v.avgSpend, 0) /
            highAverage.length,
        )
      : 0;
    averageA.textContent = fmt.currency(avgValue);
  }

  if (totalB) totalB.textContent = highTotal.length;
  if (highestB)
    highestB.textContent = highTotal.length
      ? fmt.currency(highTotal[0].spend_amount)
      : fmt.currency(0);
  if (averageB) {
    const avgValue = highTotal.length
      ? Math.round(
          highTotal.reduce((sum, v) => sum + v.spend_amount, 0) /
            highTotal.length,
        )
      : 0;
    averageB.textContent = fmt.currency(avgValue);
  }

  if (highAverageBody) {
    if (!highAverage.length) {
      highAverageBody.innerHTML =
        '<tr><td colspan="7" class="px-4 py-8 text-center text-[#bbb] text-sm">No walk-in guests matched the selected spending criteria during this period.</td></tr>';
    } else {
      highAverageBody.innerHTML = highAverage
        .map((v) => renderOpsSpendRow(v, true))
        .join("");
    }
  }

  if (highTotalBody) {
    if (!highTotal.length) {
      highTotalBody.innerHTML =
        '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No walk-in guests matched the selected spending criteria during this period.</td></tr>';
    } else {
      highTotalBody.innerHTML = highTotal
        .map((v) => renderOpsSpendRow(v, false))
        .join("");
    }
  }
}

async function setWiReportRange(range) {
  currentWiReportRange = range;
  const customDatesDiv = document.getElementById("wi-report-custom-dates");

  const buttons = ["today", "week", "month", "custom"];
  buttons.forEach((key) => {
    const btn = document.getElementById(`wi-report-range-${key}`);
    if (btn) btn.classList.toggle("bg-white", currentWiReportRange === key);
  });

  if (range !== "custom") {
    const { from, to } = getWiReportDateRange(range);
    if (customDatesDiv) customDatesDiv.classList.add("hidden");
    const fromInput = document.getElementById("wi-report-from-date");
    const toInput = document.getElementById("wi-report-to-date");
    if (fromInput) fromInput.value = from;
    if (toInput) toInput.value = to;
  } else {
    if (customDatesDiv) customDatesDiv.classList.remove("hidden");
  }

  await updateWiReportDateRange();
}

function getWiReportDateRange(value = currentWiReportRange) {
  const today = new Date();
  const padded = ymd;
  const TODAY = padded(today);

  if (value === "today") {
    return { from: TODAY, to: TODAY };
  }

  if (value === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { from: padded(start), to: padded(today) };
  }

  if (value === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: padded(start), to: padded(today) };
  }

  if (value === "custom") {
    const from = document.getElementById("wi-report-from-date")?.value || TODAY;
    const to = document.getElementById("wi-report-to-date")?.value || TODAY;
    return { from, to };
  }

  return { from: TODAY, to: TODAY };
}

async function updateWiReportDateRange() {
  const rangeLabel = document.getElementById("wi-report-range-label");
  const { from, to } = getWiReportDateRange();
  if (rangeLabel) {
    rangeLabel.textContent =
      from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`;
  }
  await loadWalkInSpendingInsights();
}

function renderWiGuestRow(guest, reportType, rank) {
  // guest: { name, phone, spendingTier, tag, visitCount, totalSpend, totalPax, lastVisit, avgSpendPerPerson, tagList }
  // reportType: 'average' | 'total'
  const isTop3 = rank >= 1 && rank <= 3;
  const rankSymbol = ["★", "★", "★"][rank - 1] || "";
  const rowClass = isTop3
    ? "bg-[#FBF8F3] border-l-4 border-l-[#C8A96B]"
    : "border-b border-[#F5F3EF]";

  const latestTag =
    guest.tagList && guest.tagList.length > 0
      ? guest.tagList[guest.tagList.length - 1]
      : "";
  const allTagsText =
    guest.tagList && guest.tagList.length > 0 ? guest.tagList.join(", ") : "";

  const rankCell = `<td class="px-3 py-3 text-[#555] text-sm">${rankSymbol ? `<span class="text-[#C8A96B] font-semibold">${rankSymbol}</span>` : rank}</td>`;
  const nameCell = `<td class="px-3 py-3 text-[#555] text-sm">${formatGuestName(guest)} ${memberBadge(guest.guestId)}</td>`;
  const latestTagCell = `<td class="px-3 py-3 text-sm"><span class="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-[#EDEDED] text-[#555]">${latestTag ? escapeHtml(latestTag) : "—"}</span></td>`;
  const allTagsCell = `<td class="px-3 py-3 text-[#666] text-xs">${allTagsText ? escapeHtml(allTagsText) : "—"}</td>`;

  if (reportType === "average") {
    return `
      <tr class="${rowClass}">
        ${rankCell}
        ${nameCell}
        ${latestTagCell}
        ${allTagsCell}
        <td class="px-3 py-3 text-right text-[#28547C] font-medium text-sm">${fmt.currency(guest.avgSpendPerPerson)}</td>
        <td class="px-3 py-3 text-right text-[#555] text-sm">${guest.visitCount}</td>
        <td class="px-3 py-3 text-right text-[#28547C] font-medium text-sm">${fmt.currency(guest.totalSpend)}</td>
        <td class="px-3 py-3 text-left text-[#555] text-sm">${guest.lastVisit ? fmt.date(guest.lastVisit) : "—"}</td>
      </tr>
    `;
  } else {
    // reportType === 'total'
    return `
      <tr class="${rowClass}">
        ${rankCell}
        ${nameCell}
        ${latestTagCell}
        ${allTagsCell}
        <td class="px-3 py-3 text-right text-[#28547C] font-medium text-sm">${fmt.currency(guest.totalSpend)}</td>
        <td class="px-3 py-3 text-right text-[#555] text-sm">${guest.visitCount}</td>
                <td class="px-3 py-3 text-right text-[#28547C] font-medium text-sm">${fmt.currency(guest.avgSpendPerPerson)}</td>
        <td class="px-3 py-3 text-left text-[#555] text-sm">${guest.lastVisit ? fmt.date(guest.lastVisit) : "—"}</td>
      </tr>
    `;
  }
}

// ── Spending Summary ─────────────────────────────────────────
async function loadTodaySpendingSummary() {
  const dateStr = summarySelectedDate || TODAY;

  // Set the displayed date
  const dateLabel = document.getElementById("today-summary-date");
  if (dateLabel) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      dateLabel.textContent = "Today";
    } else {
      dateLabel.textContent = date.toLocaleDateString(
        CURRENT_LANG === "id" ? "id-ID" : "en-GB",
        {
          day: "numeric",
          month: "short",
          year: "numeric",
        },
      );
    }
  }

  // Disable next button when viewing today
  const nextBtn = document.getElementById("btn-summary-next");
  if (nextBtn) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    nextBtn.disabled = isToday;
    nextBtn.classList.toggle("opacity-30", isToday);
    nextBtn.classList.toggle("cursor-not-allowed", isToday);
  }

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("visit_type, spend_amount")
        .eq("visit_date", dateStr)
        .not("spend_amount", "is", null)
        .gt("spend_amount", 0),
    "Failed to load spending summary",
  );

  const walkinEl = document.getElementById("today-walkin-spend");
  const reservationEl = document.getElementById("today-reservation-spend");
  const totalEl = document.getElementById("today-total-spend");

  if (error || !data) {
    if (walkinEl) walkinEl.textContent = fmt.currency(0);
    if (reservationEl) reservationEl.textContent = fmt.currency(0);
    if (totalEl) totalEl.textContent = fmt.currency(0);
    return;
  }

  let walkInTotal = 0;
  let reservationTotal = 0;

  data.forEach((v) => {
    const amount = Number(v.spend_amount) || 0;
    if (v.visit_type === "Walk-In") {
      walkInTotal += amount;
    } else if (v.visit_type === "Reservation") {
      reservationTotal += amount;
    }
  });

  const grandTotal = walkInTotal + reservationTotal;

  if (walkinEl) walkinEl.textContent = fmt.currency(walkInTotal);
  if (reservationEl) reservationEl.textContent = fmt.currency(reservationTotal);
  if (totalEl) totalEl.textContent = fmt.currency(grandTotal);
}

function moveSummaryDay(dir) {
  const [y, m, d] = (summarySelectedDate || TODAY).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + dir);
  summarySelectedDate =
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0");
  loadTodaySpendingSummary();
}
// ── End Spending Summary ─────────────────────────────────────

async function loadWalkInSpendingInsights() {
  const { from, to } = getWiReportDateRange();
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select(
          "id, visit_date, pax, spend_amount, guest_id, status, completed_at, guests(id, name, phone, spending_tier, tag)",
        )
        .gt("spend_amount", 0)
        .gte("visit_date", from)
        .lte("visit_date", to)
        .or("status.eq.Done,completed_at.not.is.null")
        .neq("pax", 0)
        .order("spend_amount", { ascending: false }),
    "Failed to load spending insights",
  );

  const highTotalBody = document.getElementById("wi-spend-b-body");
  const highAverageBody = document.getElementById("wi-spend-a-body");
  const highAverageEmpty = document.getElementById("wi-spend-a-empty");
  const highAverageTable = document.getElementById("wi-spend-a-table-wrapper");
  const highTotalEmpty = document.getElementById("wi-spend-b-empty");
  const highTotalTable = document.getElementById("wi-spend-b-table-wrapper");
  const averageTitle = document.getElementById("wi-spend-a-title");
  const averageDescription = document.getElementById("wi-spend-a-description");
  const totalTitle = document.getElementById("wi-spend-b-title");
  const totalDescription = document.getElementById("wi-spend-b-description");

  const totalA = document.getElementById("wi-spend-a-total");
  const highestA = document.getElementById("wi-spend-a-highest");
  const averageA = document.getElementById("wi-spend-a-average");
  const revenueA = document.getElementById("wi-spend-a-revenue");
  const totalB = document.getElementById("wi-spend-b-total");
  const highestB = document.getElementById("wi-spend-b-highest");
  const averageB = document.getElementById("wi-spend-b-average");
  const revenueB = document.getElementById("wi-spend-b-revenue");

  if (error || !data) {
    toast(
      error?.message || "Unable to load walk-in spending insights",
      "error",
    );
    if (highAverageEmpty) highAverageEmpty.classList.remove("hidden");
    if (highAverageTable) highAverageTable.classList.add("hidden");
    if (highTotalEmpty) highTotalEmpty.classList.remove("hidden");
    if (highTotalTable) highTotalTable.classList.add("hidden");
    return;
  }

  const isMediumTier = wiSpendingTierFilter === "medium_spender";
  const rows = (data || []).filter(
    (v) =>
      wiSpendingTierFilter === "all" ||
      v.guests?.spending_tier === wiSpendingTierFilter,
  );
  // apply tag filters (if any)
  const tagFilters = (wiTagFilters || []).map((t) => t.toLowerCase());
  function guestMatchesTagFilters(guest) {
    if (!tagFilters.length) return true;
    const tagString = guest?.tag || "";
    const tags = tagString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    if (!tags.length) return false;
    if (wiTagFilterMode === "latest") {
      const latest = tags[tags.length - 1];
      return tagFilters.includes(latest);
    }
    // any mode: at least one matching tag
    return tags.some((t) => tagFilters.includes(t));
  }

  const filteredRows = rows.filter((r) =>
    guestMatchesTagFilters(r.guests || {}),
  );

  // --- Aggregate per guest ---
  const guestMap = new Map();
  (filteredRows || []).forEach((v) => {
    const g = v.guests || {};
    const gid = g.id || v.guest_id || g.phone || JSON.stringify(g);
    const entry = guestMap.get(gid) || {
      guestId: gid,
      name: g.name || "",
      phone: g.phone || "",
      spendingTier: g.spending_tier || "",
      tag: g.tag || "",
      visitCount: 0,
      totalSpend: 0,
      totalPax: 0,
      lastVisit: null,
    };
    entry.visitCount += 1;
    entry.totalSpend += Number(v.spend_amount || 0);
    entry.totalPax += Number(v.pax || 0);
    if (
      !entry.lastVisit ||
      (v.visit_date && new Date(v.visit_date) > new Date(entry.lastVisit))
    )
      entry.lastVisit = v.visit_date;
    guestMap.set(gid, entry);
  });
  const guestList = Array.from(guestMap.values()).map((e) => ({
    ...e,
    avgSpendPerPerson: e.totalPax ? Math.round(e.totalSpend / e.totalPax) : 0,
    tagList: (e.tag || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }));

  // --- Tag distribution: unique guests across filteredRows ---
  try {
    const tagCountsA = new Map();
    const tagCountsB = new Map();
    const dotColors = [
      "#5596CE",
      "#C8A96B",
      "#7BAE7F",
      "#E07B6A",
      "#A07BC8",
      "#6AB8C8",
    ];

    guestList.forEach((g) => {
      g.tagList.forEach((t) => {
        tagCountsA.set(t, (tagCountsA.get(t) || 0) + 1);
        tagCountsB.set(t, (tagCountsB.get(t) || 0) + 1);
      });
    });

    const totalGuests = guestList.length;

    // Render both tag distributions
    [
      { id: "wi-spend-a-tagdist", counts: tagCountsA },
      { id: "wi-spend-b-tagdist", counts: tagCountsB },
    ].forEach(({ id, counts }) => {
      const distEl = document.getElementById(id);
      if (distEl) {
        if (!counts.size || !totalGuests) {
          distEl.innerHTML =
            '<p class="text-sm text-[#999]">No tags in current result set</p>';
        } else {
          const sorted = Array.from(counts.entries()).sort(
            (a, b) => b[1] - a[1],
          );
          const topN = 5;
          const top = sorted.slice(0, topN);
          const otherCount = sorted.slice(topN).reduce((s, [, c]) => s + c, 0);
          const items = top
            .map(([tag, count], i) => {
              const pct = totalGuests
                ? ((count / totalGuests) * 100).toFixed(1)
                : 0;
              const color = dotColors[i % dotColors.length];
              return `<div class="flex items-center justify-between gap-2 py-0.5 text-sm">
              <div class="flex items-center gap-2 min-w-0">
                <span class="wi-tag-dist-dot flex-shrink-0" style="background:${color}"></span>
                <span class="truncate">${escapeHtml(tag)}</span>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-[#999] flex-shrink-0">
                <span>${count}</span>
                <span class="w-10 text-right">(${pct}%)</span>
              </div>
            </div>`;
            })
            .join("");
          const otherHtml =
            otherCount > 0
              ? `<div class="flex items-center justify-between gap-2 py-0.5 text-sm">
            <div class="flex items-center gap-2"><span class="wi-tag-dist-dot" style="background:#ccc"></span><span>Other Tags</span></div>
            <div class="flex items-center gap-1.5 text-xs text-[#999] flex-shrink-0"><span>${otherCount}</span><span class="w-10 text-right">(${totalGuests ? ((otherCount / totalGuests) * 100).toFixed(1) : 0}%)</span></div>
          </div>`
              : "";
          distEl.innerHTML = `${items}${otherHtml}<div class="mt-3 pt-2.5 border-t border-[#EDE9E3] flex justify-between text-xs text-[#999] font-medium"><span>Total</span><span>${totalGuests}</span></div>`;
        }
      }
    });
  } catch (err) {
    console.error("Tag distribution error", err);
  }

  // Section A: ranked by avgSpendPerPerson (threshold from Settings)
  const highAverage = guestList
    .filter(
      (g) =>
        g.totalPax > 0 &&
        (isMediumTier || g.avgSpendPerPerson > HIGH_SPEND_PER_PAX),
    )
    .sort((a, b) => b.avgSpendPerPerson - a.avgSpendPerPerson);

  // Section B: ranked by totalSpend (threshold from Settings)
  const highTotal = guestList
    .filter((g) => isMediumTier || g.totalSpend >= HIGH_SPEND_THRESHOLD)
    .sort((a, b) => b.totalSpend - a.totalSpend);

  if (averageTitle)
    averageTitle.textContent = isMediumTier
      ? "Medium Average Spend Per Person"
      : "High Average Spend Per Person";
  if (averageDescription) {
    averageDescription.textContent = isMediumTier
      ? "Completed walk-ins from medium spender guests, ranked by average spend per guest"
      : `Groups spending more than Rp ${HIGH_SPEND_PER_PAX.toLocaleString("id-ID")} per guest`;
  }
  if (totalTitle)
    totalTitle.textContent = isMediumTier
      ? "Medium Total Spending"
      : "High Total Spending";
  if (totalDescription) {
    totalDescription.textContent = isMediumTier
      ? "Completed walk-ins from medium spender guests, ranked by total spend"
      : `Groups with total spend of Rp ${HIGH_SPEND_THRESHOLD.toLocaleString("id-ID")} or more`;
  }

  // KPI Section A
  if (totalA) totalA.textContent = highAverage.length;
  if (highestA)
    highestA.textContent = highAverage.length
      ? fmt.currency(highAverage[0].avgSpendPerPerson)
      : fmt.currency(0);
  if (averageA) {
    const avgValue = highAverage.length
      ? Math.round(
          highAverage.reduce((s, g) => s + g.avgSpendPerPerson, 0) /
            highAverage.length,
        )
      : 0;
    averageA.textContent = fmt.currency(avgValue);
  }
  if (revenueA) {
    revenueA.textContent = fmt.currency(
      highAverage.reduce((s, g) => s + g.totalSpend, 0),
    );
  }

  // KPI Section B
  if (totalB) totalB.textContent = highTotal.length;
  if (highestB)
    highestB.textContent = highTotal.length
      ? fmt.currency(highTotal[0].totalSpend)
      : fmt.currency(0);
  if (averageB) {
    const avgValue = highTotal.length
      ? Math.round(
          highTotal.reduce((s, g) => s + g.totalSpend, 0) / highTotal.length,
        )
      : 0;
    averageB.textContent = fmt.currency(avgValue);
  }
  if (revenueB) {
    revenueB.textContent = fmt.currency(
      highTotal.reduce((s, g) => s + g.totalSpend, 0),
    );
  }

  if (highAverageBody) {
    if (!highAverage.length) {
      if (highAverageEmpty) highAverageEmpty.classList.remove("hidden");
      if (highAverageTable) highAverageTable.classList.add("hidden");
      // Render the EMPTY result rather than just hiding the table. Skipping
      // this leaves the pager showing the previous result set — the screen
      // said "No guests matched" and "6-10 of 30" at the same time, and the
      // stale _spendData meant clicking a page number would have paged
      // through guests from the last date range.
      renderSpendPage("average", [], 1);
    } else {
      if (highAverageEmpty) highAverageEmpty.classList.add("hidden");
      if (highAverageTable) highAverageTable.classList.remove("hidden");
      renderSpendPage("average", highAverage, 1);
    }
  }

  if (highTotalBody) {
    if (!highTotal.length) {
      if (highTotalEmpty) highTotalEmpty.classList.remove("hidden");
      if (highTotalTable) highTotalTable.classList.add("hidden");
      renderSpendPage("total", [], 1); // same stale-pager bug as section A
    } else {
      if (highTotalEmpty) highTotalEmpty.classList.add("hidden");
      if (highTotalTable) highTotalTable.classList.remove("hidden");
      renderSpendPage("total", highTotal, 1);
    }
  }
}

function filterWalkInInsightsByTier(value) {
  wiSpendingTierFilter = value || "medium_spender";
  loadWalkInSpendingInsights();
}

// ── Spending Insights Pagination ─────────────────────────────
const SPEND_PAGE_SIZE = 5;
const _spendData = { average: [], total: [] };
const _spendPage = { average: 1, total: 1 };

function renderSpendPage(type, data, page) {
  // Store latest data so goSpendPage can reference it without re-fetching.
  // `data != null`, not `data`: an EMPTY array is the meaningful "this filter
  // matched nothing" answer and must replace the previous result set, or the
  // pager keeps offering pages of guests that are no longer on screen.
  if (data != null) _spendData[type] = data;
  const allRows = _spendData[type];
  _spendPage[type] = page;

  const totalPages = Math.ceil(allRows.length / SPEND_PAGE_SIZE);
  const start = (page - 1) * SPEND_PAGE_SIZE;
  const pageRows = allRows.slice(start, start + SPEND_PAGE_SIZE);

  const bodyId = type === "average" ? "wi-spend-a-body" : "wi-spend-b-body";
  const pagerId = type === "average" ? "wi-spend-a-pager" : "wi-spend-b-pager";

  const tbody = document.getElementById(bodyId);
  if (tbody) {
    tbody.innerHTML = pageRows
      .map((g, idx) => renderWiGuestRow(g, type, start + idx + 1))
      .join("");
  }

  // Render or clear pager
  let pager = document.getElementById(pagerId);
  if (!pager) {
    // Create pager element right after the table wrapper
    const wrapperId =
      type === "average"
        ? "wi-spend-a-table-wrapper"
        : "wi-spend-b-table-wrapper";
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) {
      pager = document.createElement("div");
      pager.id = pagerId;
      wrapper.insertAdjacentElement("afterend", pager);
    }
  }

  if (pager) {
    if (totalPages <= 1) {
      pager.innerHTML = "";
    } else {
      const showing = `${start + 1}–${Math.min(start + SPEND_PAGE_SIZE, allRows.length)} of ${allRows.length}`;
      pager.className =
        "flex items-center justify-between px-1 pt-3 pb-1 text-xs text-[#999]";
      pager.innerHTML = `
        <span>${showing}</span>
        <div class="flex items-center gap-1">
          <button onclick="goSpendPage('${type}', ${page - 1})"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-[#EDE9E3] transition-colors ${page <= 1 ? "opacity-30 cursor-not-allowed" : "hover:border-[#5596CE] hover:text-[#5596CE]"}"
            ${page <= 1 ? "disabled" : ""}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          ${Array.from({ length: totalPages }, (_, i) => i + 1)
            .map(
              (p) => `
            <button onclick="goSpendPage('${type}', ${p})"
              class="w-7 h-7 flex items-center justify-center rounded-lg border transition-colors text-xs font-medium
                ${p === page ? "border-[#5596CE] bg-[#EEF3F7] text-[#5596CE]" : "border-[#EDE9E3] hover:border-[#5596CE] hover:text-[#5596CE]"}">
              ${p}
            </button>
          `,
            )
            .join("")}
          <button onclick="goSpendPage('${type}', ${page + 1})"
            class="w-7 h-7 flex items-center justify-center rounded-lg border border-[#EDE9E3] transition-colors ${page >= totalPages ? "opacity-30 cursor-not-allowed" : "hover:border-[#5596CE] hover:text-[#5596CE]"}"
            ${page >= totalPages ? "disabled" : ""}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      `;
    }
  }
}

function goSpendPage(type, page) {
  const totalPages = Math.ceil(_spendData[type].length / SPEND_PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  renderSpendPage(type, null, page);
}

function bookingLeadTimeDays(createdAt, reservationDate) {
  if (!createdAt || !reservationDate) return null;
  const created = new Date(createdAt);
  const reserved = new Date(`${reservationDate}T00:00:00`);
  created.setHours(0, 0, 0, 0);
  reserved.setHours(0, 0, 0, 0);
  return Math.round((reserved - created) / 86400000);
}

function aggregateReservationSources(reservations) {
  const counts = new Map();
  (reservations || []).forEach((r) => {
    const source = String(r.reservation_source || "").trim();
    if (!source) return;
    const key = source.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label: source, count: 1 });
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

// `totalBookings` is EVERY booking in the period, including the ones with
// no source recorded. Shares are computed over the recorded subset only,
// and the gap is stated explicitly above the table — publishing
// "Online Form: 3%" when 94% of bookings have no source at all would be
// actively misleading to whoever reads it.
function renderOpsReservationSources(sources, totalBookings = 0) {
  currentOpsReservationSources = sources;
  const body = document.getElementById("ops-reservation-sources-body");
  const coverageEl = document.getElementById("ops-source-coverage");
  const recorded = sources.reduce((sum, s) => sum + s.count, 0);

  if (coverageEl) {
    const missing = Math.max(0, totalBookings - recorded);
    if (!totalBookings) {
      coverageEl.classList.add("hidden");
    } else if (missing > 0) {
      const pct = Math.round((recorded / totalBookings) * 100);
      coverageEl.classList.remove("hidden");
      coverageEl.innerHTML =
        `<strong>${t("Source recorded for")} ${recorded} ${t("of")} ${totalBookings} ${t("bookings")} (${pct}%).</strong> ` +
        `${t("The remaining")} ${missing} ${t("were saved without a source, so the shares below describe recorded bookings only — not all bookings. Picking a source when taking a booking is what closes this gap.")}`;
    } else {
      coverageEl.classList.remove("hidden");
      coverageEl.style.background = "#f3f9f5";
      coverageEl.style.color = "#2F7D5B";
      coverageEl.innerHTML = `<strong>${t("Source recorded for all")} ${totalBookings} ${t("bookings")}.</strong> ${t("Shares below are complete.")}`;
    }
  }

  if (!body) return;

  if (!sources.length) {
    body.innerHTML =
      `<tr><td colspan="3" class="px-3 py-8 text-center text-[#bbb]">${t("No source recorded on any booking in this period")}</td></tr>`;
    return;
  }

  body.innerHTML = sources
    .map(
      (source) => `
    <tr class="border-b border-[#F5F3EF]">
      <td class="px-3 py-2 text-[#555]">${escapeHtml(source.label)}</td>
      <td class="px-3 py-2 text-right text-[#28547C] font-medium">${source.count}</td>
      <td class="px-3 py-2 text-right text-[#999]">${recorded ? Math.round((source.count / recorded) * 100) : 0}%</td>
    </tr>
  `,
    )
    .join("");
}

// ══════════════════════════════════════════════════════════════
// OPS — ONLINE FORM EFFECTIVENESS
// ══════════════════════════════════════════════════════════════
// Ops Manager, 2026-07-26: "how many people book under online
// reservation, and how much spending do they have?"
//
// Reads the online_reservation_performance view (one row per online
// booking, left-joined to the visit it produced). Deliberately shows
// bookings AND outcome, because a booking that never turns up has
// negative value — counting raw submissions would flatter the channel.
//
// Spend attribution rule: a booking gets credit only for the visit
// linked to it (visits.reservation_id). If the guest walked in on a
// different day that spend belongs to the walk-in, not the form.

let currentOnlineFormRows = [];

// "Booked On" vs "Booked For". Added 2026-08-30 after the Blue Heron owner
// read this report as an arrival log and could not find two bookings she knew
// existed: they came in on 26 Aug FOR 28 Aug, and the table only showed the
// 28th. Lead time is the ops-relevant part (a booking made two days ahead is
// a different animal from one made 40 minutes ahead), so it rides along as
// H-n rather than as its own column.
function _ofBookedOn(r) {
  if (!r.created_at) return "\u2014";
  const d = new Date(r.created_at);
  if (isNaN(d)) return "\u2014";
  const when =
    fmt.date(d) +
    " \u00b7 " +
    d.toLocaleTimeString(CURRENT_LANG === "id" ? "id-ID" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  // Lead is measured in LOCAL calendar days via ymd(), never toISOString():
  // a 23:30 Jakarta booking serialises as the previous day in UTC and would
  // report H-1 on a same-day walk-up.
  let lead = "";
  if (r.reservation_date) {
    const madeOn = ymd(d);
    const days = Math.round(
      (new Date(r.reservation_date + "T00:00:00") -
        new Date(madeOn + "T00:00:00")) /
        86400000,
    );
    if (days >= 0) lead = ` \u00b7 H-${days}`;
  }
  return (
    escapeHtml(when) + (lead ? `<span class="text-[#bbb]">${lead}</span>` : "")
  );
}

async function loadOpsOnlineFormReport() {
  const { from, to } = getOpsReportDateRange();

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("online_reservation_performance")
        .select("*")
        .gte("reservation_date", from)
        .lte("reservation_date", to)
        .order("reservation_date", { ascending: false }),
    "Failed to load online form report",
  );

  const body = document.getElementById("ops-of-table-body");
  if (error) {
    if (body) {
      body.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-[#bbb]">${t("Could not load online form data")}</td></tr>`;
    }
    return;
  }

  const rows = data || [];
  currentOnlineFormRows = rows;

  // One row per booking (the view is already 1:1 unless a booking somehow
  // produced two visits — dedupe defensively so counts can't double up).
  const byBooking = new Map();
  rows.forEach((r) => {
    const existing = byBooking.get(r.reservation_id);
    if (!existing || (!existing.arrived && r.arrived)) {
      byBooking.set(r.reservation_id, r);
    } else if (existing && r.arrived) {
      existing.spend_amount =
        Number(existing.spend_amount || 0) + Number(r.spend_amount || 0);
    }
  });
  const bookings = Array.from(byBooking.values());

  const arrived = bookings.filter((r) => r.arrived);
  const lost = bookings.filter(
    (r) =>
      !r.arrived &&
      ["Cancelled", "Cancelled (No Show)", "No Show"].includes(r.status),
  );
  const pending = bookings.filter(
    (r) => !r.arrived && ["Reserved", "Confirmed"].includes(r.status),
  );
  const totalSpend = bookings.reduce(
    (s, r) => s + Number(r.spend_amount || 0),
    0,
  );
  const bookedPax = bookings.reduce((s, r) => s + (r.booked_pax || 0), 0);
  const arrivedPax = arrived.reduce(
    (s, r) => s + (r.actual_pax || r.booked_pax || 0),
    0,
  );

  setText("ops-of-bookings", bookings.length);
  setText("ops-of-pax", `${bookedPax} ${t("pax booked")}`);
  setText("ops-of-arrived", arrived.length);
  setText(
    "ops-of-conversion",
    bookings.length
      ? `${Math.round((arrived.length / bookings.length) * 100)}% ${t("turned up")}`
      : "—",
  );
  setText("ops-of-lost", lost.length);
  setText(
    "ops-of-lost-sub",
    pending.length
      ? `${t("cancelled / no-show")} · ${pending.length} ${t("still upcoming")}`
      : t("cancelled / no-show"),
  );
  setText("ops-of-spend", totalSpend ? fmt.currency(totalSpend) : "Rp 0");
  setText(
    "ops-of-spend-sub",
    arrivedPax
      ? `${fmt.currency(Math.round(totalSpend / arrivedPax))} ${t("per guest who arrived")}`
      : t("no arrivals yet"),
  );

  setText(
    "ops-of-footnote",
    t(
      'Spend is credited to a booking only via the visit linked to it. Bookings still in the future count as "upcoming", not as lost. Staff-deleted bookings are excluded.',
    ),
  );

  if (!body) return;
  if (!bookings.length) {
    body.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-[#bbb]">${t("No online form bookings in this period")}</td></tr>`;
    return;
  }

  const OUTCOME = {
    arrived: { label: t("Arrived"), colour: "#2F7D5B" },
    upcoming: { label: t("Upcoming"), colour: "#5596CE" },
    cancelled: { label: t("Cancelled"), colour: "#C0392B" },
    noshow: { label: t("No show"), colour: "#C0392B" },
    unknown: { label: t("Did not arrive"), colour: "#999" },
  };
  const outcomeOf = (r) => {
    if (r.arrived) return OUTCOME.arrived;
    if (["Reserved", "Confirmed"].includes(r.status)) return OUTCOME.upcoming;
    if (r.status === "Cancelled") return OUTCOME.cancelled;
    if (["Cancelled (No Show)", "No Show"].includes(r.status))
      return OUTCOME.noshow;
    return OUTCOME.unknown;
  };

  body.innerHTML = bookings
    .map((r) => {
      const o = outcomeOf(r);
      // The view carries booking_alias so the alias shows here too — this
      // is exactly the screen where "Rere (Retno)" matters most.
      const nameHtml = formatGuestName({
        name: r.guest_name,
        booking_alias: r.booking_alias,
      });
      return `
      <tr class="border-b border-[#F5F3EF]">
        <td class="px-3 py-2 text-[#555]">${nameHtml}</td>
        <td class="px-3 py-2 text-[#999] text-xs">${escapeHtml(r.guest_phone || "—")}</td>
        <td class="px-3 py-2 text-[#999] text-xs">${_ofBookedOn(r)}</td>
        <td class="px-3 py-2 text-[#555] text-xs">${fmt.date(r.reservation_date)}${r.reservation_time ? ` · ${fmt.time(r.reservation_time)}` : ""}</td>
        <td class="px-3 py-2 text-right text-[#555]">${r.actual_pax || r.booked_pax || 0}</td>
        <td class="px-3 py-2 text-xs font-medium" style="color:${o.colour}">${o.label}</td>
        <td class="px-3 py-2 text-right text-[#28547C] font-medium">${Number(r.spend_amount) > 0 ? fmt.currency(r.spend_amount) : "—"}</td>
      </tr>`;
    })
    .join("");
}

function exportOnlineFormReport() {
  if (!currentOnlineFormRows.length) {
    toast("No online form bookings to export", "error");
    return;
  }
  downloadCsv(
    `export-online-form-${TODAY}.csv`,
    [
      "Guest Name",
      "Booking Alias",
      "Name Typed On Form",
      "Phone",
      "Booked On",
      "Reservation Date",
      "Reservation Time",
      "Booked Pax",
      "Actual Pax",
      "Status",
      "Arrived",
      "Visit Date",
      "Spend",
    ],
    currentOnlineFormRows.map((r) => [
      r.guest_name,
      r.booking_alias || "",
      r.booking_name || "",
      r.guest_phone,
      r.created_at || "",
      r.reservation_date,
      r.reservation_time,
      r.booked_pax,
      r.actual_pax || "",
      r.status,
      r.arrived ? "Yes" : "No",
      r.visit_date || "",
      r.spend_amount,
    ]),
  );
  toast("Online form report exported");
}

// ══════════════════════════════════════════════════════════════
// OPS — REPEAT GUESTS
// ══════════════════════════════════════════════════════════════
// Ops Manager, 2026-07-26: "if the person visits more than once, can we
// see how much they spent and how many visits?"
//
// Lifetime figures on purpose, NOT filtered by the reporting period.
// A repeat guest's value is the whole relationship; slicing it to
// "this month" would show a 6-visit regular as a 1-visit guest and
// defeat the point of the table.

let opsRepeatMinVisits = 2;
let currentOpsRepeatRows = [];
let opsRepeatPage = 1;
const OPS_REPEAT_PAGE_SIZE = 15;

function setOpsRepeatMin(min) {
  opsRepeatMinVisits = min;
  [2, 3, 5].forEach((m) => {
    const btn = document.getElementById(`ops-repeat-min-${m}`);
    if (!btn) return;
    const on = m === min;
    btn.classList.toggle("bg-[#5596CE]", on);
    btn.classList.toggle("text-white", on);
    btn.classList.toggle("bg-[#F8F6F2]", !on);
    btn.classList.toggle("text-[#5596CE]", !on);
  });
  opsRepeatPage = 1;
  renderOpsRepeatGuests();
}

async function loadOpsRepeatGuests() {
  // Filter server-side on visit_count so we never pull the ~330 one-visit
  // guests the browser would immediately throw away. Uses the minimum of
  // the three available thresholds so switching 2+/3+/5+ needs no refetch.
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("guest_visit_stats")
        .select("*")
        .gte("visit_count", 2)
        .order("total_spend", { ascending: false }),
    "Failed to load repeat guests",
  );

  const body = document.getElementById("ops-repeat-table-body");
  if (error || !data) {
    if (body) {
      body.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-[#bbb]">${t("Could not load repeat guests")}</td></tr>`;
    }
    return;
  }

  if (!data.length) {
    currentOpsRepeatRows = [];
    renderOpsRepeatGuests();
    return;
  }

  // The view has no guest name (it aggregates visits), so hydrate names
  // for just these guests rather than joining the whole guest table.
  const ids = data.map((r) => r.guest_id).filter(Boolean);
  const { data: guests } = await supabaseQuery(
    () =>
      db
        .from("guests")
        .select("id, name, phone, booking_alias, spending_tier")
        .in("id", ids),
    "Failed to load repeat guest details",
  );
  const guestById = new Map((guests || []).map((g) => [g.id, g]));

  currentOpsRepeatRows = data
    .map((r) => {
      const g = guestById.get(r.guest_id);
      if (!g) return null; // guest hard-deleted: nothing sensible to show
      return {
        ...r,
        name: g.name,
        phone: g.phone,
        booking_alias: g.booking_alias,
        spending_tier: g.spending_tier,
        avgPerVisit: r.visit_count
          ? Math.round(Number(r.total_spend) / r.visit_count)
          : 0,
      };
    })
    .filter(Boolean);

  renderOpsRepeatGuests();
}

function renderOpsRepeatGuests() {
  const body = document.getElementById("ops-repeat-table-body");
  if (!body) return;

  const rows = currentOpsRepeatRows.filter(
    (r) => r.visit_count >= opsRepeatMinVisits,
  );
  const totalSpend = rows.reduce((s, r) => s + Number(r.total_spend || 0), 0);

  setText(
    "ops-repeat-summary",
    rows.length
      ? `${rows.length} ${t("guests")} · ${fmt.currency(totalSpend)} ${t("lifetime spend")}`
      : "",
  );

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="px-3 py-8 text-center text-[#bbb]">${t("No guests yet with at least")} ${opsRepeatMinVisits} ${t("visits")}</td></tr>`;
    setAdminHTML("ops-repeat-pagination", "");
    return;
  }

  const totalPages = Math.ceil(rows.length / OPS_REPEAT_PAGE_SIZE);
  if (opsRepeatPage > totalPages) opsRepeatPage = 1;
  const start = (opsRepeatPage - 1) * OPS_REPEAT_PAGE_SIZE;
  const page = rows.slice(start, start + OPS_REPEAT_PAGE_SIZE);

  body.innerHTML = page
    .map(
      (r) => `
    <tr class="border-b border-[#F5F3EF]">
      <td class="px-3 py-2 text-[#555]">${formatGuestName(r)} ${formatSpendingTierBadge(r.spending_tier)}</td>
      <td class="px-3 py-2 text-[#999] text-xs">${escapeHtml(r.phone || "—")}</td>
      <td class="px-3 py-2 text-right text-[#28547C] font-semibold">${r.visit_count}</td>
      <td class="px-3 py-2 text-right text-[#28547C] font-medium">${Number(r.total_spend) > 0 ? fmt.currency(r.total_spend) : "—"}</td>
      <td class="px-3 py-2 text-right text-[#555]">${r.avgPerVisit ? fmt.currency(r.avgPerVisit) : "—"}</td>
      <td class="px-3 py-2 text-[#999] text-xs">${fmt.date(r.first_visit_date)}</td>
      <td class="px-3 py-2 text-[#999] text-xs">${fmt.date(r.last_visit_date)}</td>
    </tr>`,
    )
    .join("");

  setAdminHTML(
    "ops-repeat-pagination",
    totalPages <= 1
      ? ""
      : `<div class="flex items-center justify-between px-1 pt-3 text-xs text-[#999]">
           <span>${start + 1}–${Math.min(start + OPS_REPEAT_PAGE_SIZE, rows.length)} of ${rows.length}</span>
           <div class="flex items-center gap-1">
             <button onclick="goOpsRepeatPage(${opsRepeatPage - 1})"
               class="px-2 py-1 rounded-lg border border-[#EDE9E3] ${opsRepeatPage <= 1 ? "opacity-30 cursor-not-allowed" : "hover:border-[#5596CE]"}"
               ${opsRepeatPage <= 1 ? "disabled" : ""}>${t("Prev")}</button>
             <span class="px-2">${opsRepeatPage} / ${totalPages}</span>
             <button onclick="goOpsRepeatPage(${opsRepeatPage + 1})"
               class="px-2 py-1 rounded-lg border border-[#EDE9E3] ${opsRepeatPage >= totalPages ? "opacity-30 cursor-not-allowed" : "hover:border-[#5596CE]"}"
               ${opsRepeatPage >= totalPages ? "disabled" : ""}>${t("Next")}</button>
           </div>
         </div>`,
  );
}

function goOpsRepeatPage(page) {
  const rows = currentOpsRepeatRows.filter(
    (r) => r.visit_count >= opsRepeatMinVisits,
  );
  const totalPages = Math.ceil(rows.length / OPS_REPEAT_PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  opsRepeatPage = page;
  renderOpsRepeatGuests();
}

function exportRepeatGuests() {
  const rows = currentOpsRepeatRows.filter(
    (r) => r.visit_count >= opsRepeatMinVisits,
  );
  if (!rows.length) {
    toast("No repeat guests to export", "error");
    return;
  }
  downloadCsv(
    `export-repeat-guests-${TODAY}.csv`,
    [
      "Guest Name",
      "Booking Alias",
      "Phone",
      "Visits",
      "Total Spend",
      "Avg Per Visit",
      "Total Pax",
      "First Visit",
      "Last Visit",
      "Spending Tier",
    ],
    rows.map((r) => [
      r.name,
      r.booking_alias || "",
      r.phone,
      r.visit_count,
      r.total_spend,
      r.avgPerVisit,
      r.total_pax,
      r.first_visit_date,
      r.last_visit_date,
      r.spending_tier || "",
    ]),
  );
  toast("Repeat guests exported");
}

function renderOpsAreaUtilization(reservations, walkins) {
  const activeReservations = reservations.filter(
    (r) => !["Cancelled", "Cancelled (No Show)"].includes(r.status),
  );

  REPORT_AREA_GROUPS.forEach((group) => {
    const areas = allAreas.filter(group.match);
    const areaIds = new Set(areas.map((a) => a.id));
    const capacity = areas.reduce((sum, area) => sum + (area.capacity || 0), 0);
    const usedPax =
      activeReservations
        .filter((r) => areaIds.has(r.assigned_area))
        .reduce((sum, r) => sum + (r.pax || 0), 0) +
      walkins
        .filter((w) => areaIds.has(w.assigned_area))
        .reduce((sum, w) => sum + (w.pax || 0), 0);
    const pct = capacity
      ? Math.min(100, Math.round((usedPax / capacity) * 100))
      : 0;

    document.getElementById(`ops-area-${group.id}`).textContent = `${pct}%`;
    document.getElementById(`ops-area-${group.id}-detail`).textContent =
      `${usedPax} / ${capacity} pax used`;
  });
}

// ============================================================
// PEAK TRAFFIC — CUSTOM 14-DAY DATE PICKER
// ============================================================

// Default peak-traffic window shape. 14 columns total, weighted to the past
// because walk-in data only exists in the past. See getPeakDateWindow().
const PEAK_DAYS_BACK = 10;
const PEAK_DAYS_AHEAD = 3;
let peakStartDate = null; // YYYY-MM-DD string, null = the rolling default above
let peakCalViewYear = null;
let peakCalViewMonth = null;
let _peakTrafficInterval = null; // auto-refresh timer ID

/** Start (or restart) a 4-hour auto-refresh for peak traffic data */
function startPeakTrafficAutoRefresh() {
  if (typeof IS_DEV !== "undefined" && IS_DEV) return; // dev: no 4h refresh timer
  if (_peakTrafficInterval) clearInterval(_peakTrafficInterval);
  _peakTrafficInterval = setInterval(
    () => {
      const opsView = document.getElementById("reports-operations-view");
      if (opsView && !opsView.classList.contains("hidden")) {
        reloadPeakTrafficOnly();
      }
    },
    4 * 60 * 60 * 1000,
  );
}

/** Stop the peak traffic auto-refresh timer */
function stopPeakTrafficAutoRefresh() {
  if (_peakTrafficInterval) {
    clearInterval(_peakTrafficInterval);
    _peakTrafficInterval = null;
  }
}

function getPeakDateWindow() {
  if (peakStartDate) {
    const start = new Date(`${peakStartDate}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 13);
    return {
      from: peakStartDate,
      to: ymd(end),
    };
  }
  // Default window reshaped 2026-07-26 (Rere's call): 10 days back, today,
  // 3 days ahead — still 14 columns.
  //
  // WHY it is not symmetrical: walk-ins can only ever exist in the past, so
  // future columns can show reservations and nothing else. The old
  // 7-back/6-ahead split spent 6 of 14 columns on days holding 1 booking
  // between them. Weighting toward history puts two full weekends in view
  // (the days that actually differ) while keeping a glance at the pipeline.
  //
  // KEEP IN SYNC: loadAdminTraffic() fetches the data for the copy of this
  // chart on the owner dashboard. If these windows disagree, the chart draws
  // columns for days whose data was never fetched — exactly the phantom
  // empty-column bug Rere reported on 18 Jul 2026.
  const start = new Date();
  start.setDate(start.getDate() - PEAK_DAYS_BACK);
  const end = new Date();
  end.setDate(end.getDate() + PEAK_DAYS_AHEAD);
  return {
    from: ymd(start),
    to: ymd(end),
  };
}

function togglePeakCalendar() {
  const popup = document.getElementById("peak-calendar-popup");
  if (!popup) return;
  const isHidden = popup.classList.contains("hidden");
  if (isHidden) {
    // Set view to the month of the current start (or today)
    const ref = peakStartDate
      ? new Date(`${peakStartDate}T00:00:00`)
      : new Date();
    peakCalViewYear = ref.getFullYear();
    peakCalViewMonth = ref.getMonth();
    renderPeakCalendar();
    popup.classList.remove("hidden");
    // Close on outside click
    setTimeout(
      () =>
        document.addEventListener("click", closePeakCalOnOutside, {
          once: true,
        }),
      0,
    );
  } else {
    popup.classList.add("hidden");
  }
}

function closePeakCalOnOutside(e) {
  const wrap = document.getElementById("peak-date-picker-wrap");
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById("peak-calendar-popup")?.classList.add("hidden");
  } else {
    // Re-attach if click was inside
    setTimeout(
      () =>
        document.addEventListener("click", closePeakCalOnOutside, {
          once: true,
        }),
      0,
    );
  }
}

function movePeakCalMonth(dir) {
  peakCalViewMonth += dir;
  if (peakCalViewMonth > 11) {
    peakCalViewMonth = 0;
    peakCalViewYear += 1;
  }
  if (peakCalViewMonth < 0) {
    peakCalViewMonth = 11;
    peakCalViewYear -= 1;
  }
  renderPeakCalendar();
}

function renderPeakCalendar() {
  const grid = document.getElementById("peak-cal-grid");
  const monthLabel = document.getElementById("peak-cal-month-label");
  const hint = document.getElementById("peak-cal-hint");
  if (!grid || !monthLabel) return;

  const { from, to } = getPeakDateWindow();
  const todayStr = TODAY;

  monthLabel.textContent = new Date(
    peakCalViewYear,
    peakCalViewMonth,
    1,
  ).toLocaleDateString(CURRENT_LANG === "id" ? "id-ID" : "en-GB", {
    month: "long",
    year: "numeric",
  });

  // Compute range days set for fast lookup
  const rangeStart = new Date(`${from}T00:00:00`);
  const rangeEnd = new Date(`${to}T00:00:00`);

  const firstDay = new Date(peakCalViewYear, peakCalViewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(
    peakCalViewYear,
    peakCalViewMonth + 1,
    0,
  ).getDate();

  let cells = "";
  // Leading blanks
  for (let i = 0; i < firstDay; i++) cells += `<div></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${peakCalViewYear}-${String(peakCalViewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cellDate = new Date(`${dateStr}T00:00:00`);

    const isStart = dateStr === from;
    const isEnd = dateStr === to;
    const inRange = cellDate >= rangeStart && cellDate <= rangeEnd;
    const isToday = dateStr === todayStr;
    const isFuture = cellDate > new Date();

    let cls =
      "relative flex items-center justify-center text-xs h-8 cursor-pointer select-none transition-colors ";
    let style = "";
    let title = "";

    if (isStart) {
      cls += "font-bold text-white rounded-l-full ";
      style = "background:#28547C;";
      title = "Start of range";
    } else if (isEnd && peakStartDate) {
      cls += "font-bold text-white rounded-r-full ";
      style = "background:#5596CE;";
      title = "End of range";
    } else if (inRange) {
      cls += "text-[#28547C] font-medium ";
      style = "background:#ddeaf7;";
    } else if (isFuture) {
      cls += "text-[#ccc] cursor-not-allowed ";
    } else {
      cls += "text-[#555] hover:bg-[#F0F6FC] rounded-full ";
    }

    if (isToday && !isStart && !isEnd) {
      cls += "ring-1 ring-[#5596CE] ring-inset rounded-full ";
    }

    cells += `<div class="${cls}" style="${style}" title="${title}" onclick="${isFuture ? "" : `selectPeakDate('${dateStr}')`}">${day}</div>`;
  }

  grid.innerHTML = cells;

  // Update hint
  if (hint) {
    hint.textContent = peakStartDate
      ? `${fmt.date(from)} → ${fmt.date(to)}`
      : "Tap a day to set start date";
  }
}

async function selectPeakDate(dateStr) {
  peakStartDate = dateStr;

  // Update trigger label
  const { from, to } = getPeakDateWindow();
  const triggerLabel = document.getElementById("peak-date-trigger-label");
  if (triggerLabel)
    triggerLabel.textContent = `${fmt.date(from)} – ${fmt.date(to)}`;

  renderPeakCalendar(); // re-render to show highlighted range

  // Reload only the peak traffic data
  await reloadPeakTrafficOnly();
}

async function resetPeakDate() {
  peakStartDate = null;
  const triggerLabel = document.getElementById("peak-date-trigger-label");
  if (triggerLabel) triggerLabel.textContent = "Last 14 days";  // reset-to-default label
  renderPeakCalendar();
  await reloadPeakTrafficOnly();
}

async function reloadPeakTrafficOnly() {
  const { from, to } = getPeakDateWindow();

  const [resResult, walkResult] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("reservation_date")
          .not("status", "in", '("Cancelled","Cancelled (No Show)")')
          .gte("reservation_date", from)
          .lte("reservation_date", to),
      "Failed to reload peak reservations",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_date")
          .eq("visit_type", "Walk-In")
          .gte("visit_date", from)
          .lte("visit_date", to),
      "Failed to reload peak walk-ins",
    ),
  ]);

  renderOpsPeakTraffic(resResult.data || [], walkResult.data || []);
}

// targets lets the admin dashboard reuse this exact renderer (same bars,
// labels, counts, legend) in its own containers instead of duplicating a
// simplified chart. Defaults preserve the original Reports page behavior.
function renderOpsPeakTraffic(
  reservations,
  walkins,
  targets = {
    peakDay: "ops-peak-day",
    bars: "ops-peak-traffic-bars",
    legend: "ops-peak-traffic-legend",
  },
) {
  const { from: windowFrom, to: windowTo } = getPeakDateWindow();

  // Reservations by date (data is already pre-filtered by caller)
  const resByDate = {};
  (reservations || []).forEach((r) => {
    const d = r.reservation_date;
    if (d >= windowFrom && d <= windowTo) {
      resByDate[d] = (resByDate[d] || 0) + 1;
    }
  });

  // Walk-ins by date
  const walkByDate = {};
  (walkins || []).forEach((w) => {
    const d = (w.visit_date || "").slice(0, 10);
    if (d >= windowFrom && d <= windowTo) {
      walkByDate[d] = (walkByDate[d] || 0) + 1;
    }
  });

  // Build the 14 dates from windowFrom → windowTo
  const recentDates = [];
  const winStart = new Date(`${windowFrom}T00:00:00`);
  for (let i = 0; i < 14; i++) {
    const date = new Date(winStart);
    date.setDate(winStart.getDate() + i);
    recentDates.push(ymd(date));
  }

  // Peak day label — combined total
  const combinedByDate = {};
  recentDates.forEach((d) => {
    combinedByDate[d] = (resByDate[d] || 0) + (walkByDate[d] || 0);
  });
  const ranked = Object.entries(combinedByDate).sort((a, b) => b[1] - a[1]);
  const peakEl = document.getElementById(targets.peakDay);
  if (peakEl) {
    peakEl.textContent =
      ranked.length && ranked[0][1] > 0
        ? `${fmt.date(ranked[0][0])} · ${ranked[0][1]} total guests`
        : "No recent activity";
  }

  const barContainer = document.getElementById(targets.bars);
  const legendContainer = document.getElementById(targets.legend);
  if (!barContainer || !legendContainer) return;

  const maxRes = Math.max(...recentDates.map((d) => resByDate[d] || 0), 1);
  const maxWalk = Math.max(...recentDates.map((d) => walkByDate[d] || 0), 1);
  const maxSingle = Math.max(maxRes, maxWalk);
  const MAX_BAR_PX = 130;

  // Peak counts for legend
  const peakResCount = Math.max(...recentDates.map((d) => resByDate[d] || 0));
  const peakWalkCount = Math.max(...recentDates.map((d) => walkByDate[d] || 0));

  barContainer.innerHTML = recentDates
    .map((date) => {
      const res = resByDate[date] || 0;
      const walk = walkByDate[date] || 0;
      const isToday = date === TODAY;
      const d = new Date(`${date}T00:00:00`);
      const label = isToday
        ? "Today"
        : d.toLocaleDateString(CURRENT_LANG === "id" ? "id-ID" : "en-GB", {
            day: "numeric",
            month: "short",
          });
      const weekday = d.toLocaleDateString(
        CURRENT_LANG === "id" ? "id-ID" : "en-GB",
        { weekday: "short" },
      );

      const resH = Math.max(
        Math.round((res / maxSingle) * MAX_BAR_PX),
        res > 0 ? 4 : 0,
      );
      const walkH = Math.max(
        Math.round((walk / maxSingle) * MAX_BAR_PX),
        walk > 0 ? 4 : 0,
      );

      const resColor = isToday ? "#9a6a1e" : "#5596CE";
      const walkColor = isToday ? "#e8a830" : "#C8A96B";
      const labelColor = isToday ? "#9a6a1e" : "#28547C";

      return `
      <div class="flex flex-col items-center gap-1 flex-1 min-w-0">
        <div class="flex items-end justify-center gap-[2px] w-full" style="height:${MAX_BAR_PX}px;">
          <div class="flex flex-col items-center justify-end" style="height:100%;">
            <div class="text-[9px] font-medium mb-0.5" style="color:${resColor};">${res > 0 ? res : ""}</div>
            <div class="w-[12px] rounded-t-sm transition-all" style="height:${resH}px;background:${resColor};" title="${label}: ${res} reservation${res !== 1 ? "s" : ""}"></div>
          </div>
          <div class="flex flex-col items-center justify-end" style="height:100%;">
            <div class="text-[9px] font-medium mb-0.5" style="color:${walkColor};">${walk > 0 ? walk : ""}</div>
            <div class="w-[12px] rounded-t-sm transition-all opacity-90" style="height:${walkH}px;background:${walkColor};" title="${label}: ${walk} walk-in${walk !== 1 ? "s" : ""}"></div>
          </div>
          ${res === 0 && walk === 0 ? `<div class="w-[20px] rounded-t-sm self-end" style="height:3px;background:#EDE9E3;"></div>` : ""}
        </div>
        <div class="text-[10px] text-center leading-tight whitespace-nowrap" style="color:#999;"><div>${label}</div><div class="text-[9px] opacity-70">${weekday}</div></div>
      </div>
    `;
    })
    .join("");

  legendContainer.innerHTML = `
    <div class="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#999]">
      <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:#5596CE;"></span>Reservations</span>
      <span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:#C8A96B;"></span>Walk-ins</span>
      <span class="flex items-center gap-1.5 ml-1 pl-3 border-l border-[#EDE9E3]">Peak res: <strong class="text-[#5596CE] ml-1">${peakResCount}</strong></span>
      <span class="flex items-center gap-1.5">Peak walk-in: <strong class="text-[#C8A96B] ml-1">${peakWalkCount}</strong></span>
    </div>
  `;
}

async function loadMarketingReviewPerformance() {
  const { data: submissions, error } = await supabaseQuery(
    () =>
      db
        .from("spin_submissions")
        .select("id, prize_name, status, created_at")
        .order("created_at", { ascending: false }),
    "Failed to load review performance data",
  );

  if (error || !submissions?.length) {
    renderMktReviewPerformance([]);
    return;
  }

  renderMktReviewPerformance(submissions);
}

function renderMktReviewPerformance(submissions) {
  // Calculate summary metrics
  const totalSpins = submissions.length;
  const totalWon = submissions.filter(
    (s) => s.status === "pending" || s.status === "redeemed",
  ).length;
  const rejected = submissions.filter((s) => s.status === "rejected").length;
  const redeemed = submissions.filter((s) => s.status === "redeemed").length;
  const redemptionRate =
    totalWon > 0 ? Math.round((redeemed / totalWon) * 100) : 0;

  // Update summary cards
  document.getElementById("mkt-review-total-spins").textContent = totalSpins;
  document.getElementById("mkt-review-approved").textContent = totalWon;
  document.getElementById("mkt-review-rejected").textContent = rejected;
  document.getElementById("mkt-review-redeemed").textContent = redeemed;
  document.getElementById("mkt-review-redemption-rate").textContent =
    `${redemptionRate}%`;

  // Calculate prize breakdown
  const prizeBreakdown = {};
  submissions.forEach((s) => {
    const prizeName = s.prize_name || "Unknown Prize";
    if (!prizeBreakdown[prizeName]) {
      prizeBreakdown[prizeName] = { won: 0, redeemed: 0 };
    }
    if (s.status === "pending" || s.status === "redeemed") {
      prizeBreakdown[prizeName].won += 1;
    }
    if (s.status === "redeemed") {
      prizeBreakdown[prizeName].redeemed += 1;
    }
  });

  // Render prize breakdown table
  const breakdownBody = document.getElementById(
    "mkt-review-prize-breakdown-body",
  );
  if (!breakdownBody) return;

  const breakdownRows = Object.entries(prizeBreakdown)
    .sort((a, b) => b[1].won - a[1].won)
    .map(([prizeName, stats]) => {
      const rate =
        stats.won > 0 ? Math.round((stats.redeemed / stats.won) * 100) : 0;
      return `
        <tr class="border-b border-[#F5F3EF]">
          <td class="px-3 py-2 text-[#555]">${escapeHtml(prizeName)}</td>
          <td class="px-3 py-2 text-right text-[#28547C] font-medium">${stats.won}</td>
          <td class="px-3 py-2 text-right text-[#28547C] font-medium">${stats.redeemed}</td>
          <td class="px-3 py-2 text-right text-[#28547C] font-medium">${rate}%</td>
        </tr>
      `;
    });

  if (breakdownRows.length === 0) {
    breakdownBody.innerHTML =
      '<tr><td colspan="4" class="px-3 py-4 text-center text-[#bbb]">No prize data yet</td></tr>';
  } else {
    breakdownBody.innerHTML = breakdownRows.join("");
  }
}

async function loadOperationsReports() {
  if (!allAreas.length) await loadAreas();

  const { from, to } = getOpsReportDateRange();

  const { from: peakFrom, to: peakTo } = getPeakDateWindow();

  const [
    reservationsResult,
    visitsResult,
    todayReservationsResult,
    peakWalkInsResult,
    peakResResult,
  ] = await Promise.all([
    // Date-filtered: lead time, sources, res vs walk-in
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select(
            "reservation_date, pax, status, assigned_area, created_at, reservation_source",
          )
          // deleted_at filter added 2026-07-26: 'Deleted' means staff
          // mis-entered the booking, so it must never appear in a report
          // denominator. 'Cancelled' is different and stays included.
          .is("deleted_at", null)
          .gte("reservation_date", from)
          .lte("reservation_date", to),
      "Failed to load reservation reports",
    ),
    // Date-filtered: res vs walk-in ratio
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_type")
          .gte("visit_date", from)
          .lte("visit_date", to),
      "Failed to load visit mix reports",
    ),
    // Always today — unaffected by date filter (live snapshot card)
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("pax, status")
          .eq("reservation_date", TODAY),
      "Failed to load today reservations",
    ),
    // Peak traffic window — walk-ins (14 days, user-selectable start)
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_date")
          .eq("visit_type", "Walk-In")
          .gte("visit_date", peakFrom)
          .lte("visit_date", peakTo),
      "Failed to load walk-in peak data",
    ),
    // Peak traffic window — reservations (14 days, user-selectable start)
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("reservation_date")
          .not("status", "in", '("Cancelled","Cancelled (No Show)")')
          .gte("reservation_date", peakFrom)
          .lte("reservation_date", peakTo),
      "Failed to load peak reservation data",
    ),
  ]);

  if (
    reservationsResult.error ||
    visitsResult.error ||
    todayReservationsResult.error
  ) {
    toast("Failed to load operations reports", "error");
    return;
  }

  const reservations = reservationsResult.data || [];
  const visits = visitsResult.data || [];
  const todayReservations = todayReservationsResult.data || [];
  const peakWalkIns = peakWalkInsResult.data || [];
  const peakReservations = peakResResult?.data || [];

  // Today snapshot — always live, unaffected by date filter
  const todayCancelled = todayReservations.filter(
    (r) => r.status === "Cancelled",
  );
  const todayActive = todayReservations.filter(
    (r) => !["Cancelled", "Cancelled (No Show)"].includes(r.status),
  );
  const todayExpectedPax = todayActive.reduce(
    (sum, r) => sum + (r.pax || 0),
    0,
  );
  const todayCancelledPax = todayCancelled.reduce(
    (sum, r) => sum + (r.pax || 0),
    0,
  );

  const todayCountEl = document.getElementById("ops-demand-0-count");
  const todayPaxEl = document.getElementById("ops-demand-0-pax");
  if (todayCountEl) todayCountEl.textContent = todayActive.length;
  if (todayPaxEl) todayPaxEl.textContent = `${todayExpectedPax} pax expected`;

  const todayCancelCountEl = document.getElementById(
    "ops-today-cancelled-count",
  );
  const todayCancelPaxEl = document.getElementById("ops-today-cancelled-pax");
  if (todayCancelCountEl)
    todayCancelCountEl.textContent = todayCancelled.length;
  if (todayCancelPaxEl)
    todayCancelPaxEl.textContent = `${todayCancelledPax} pax released`;

  // Reservation vs Walk-In vs Cancelled — date filtered
  const reservationVisits = visits.filter(
    (v) => v.visit_type === "Reservation",
  ).length;
  const walkInVisits = visits.filter((v) => v.visit_type === "Walk-In").length;
  const cancelledInPeriod = reservations.filter(
    (r) => r.status === "Cancelled",
  ).length;
  const visitTotal = reservationVisits + walkInVisits;
  const reservationShare = visitTotal
    ? Math.round((reservationVisits / visitTotal) * 100)
    : 0;
  const walkInShare = visitTotal
    ? Math.round((walkInVisits / visitTotal) * 100)
    : 0;
  document.getElementById("ops-reservation-ratio").textContent =
    `${reservationShare}%`;
  document.getElementById("ops-reservation-count").textContent =
    `${reservationVisits} reservations`;
  document.getElementById("ops-walkin-ratio").textContent = `${walkInShare}%`;
  document.getElementById("ops-walkin-count").textContent =
    `${walkInVisits} walk-ins`;
  document.getElementById("ops-cancelled-ratio").textContent =
    cancelledInPeriod;
  document.getElementById("ops-cancelled-count").textContent =
    `${cancelledInPeriod} cancellation${cancelledInPeriod !== 1 ? "s" : ""}`;

  // Reservation Sources — date filtered. Pass the full booking count so
  // the renderer can report how much of the denominator is unknown.
  renderOpsReservationSources(
    aggregateReservationSources(reservations),
    reservations.length,
  );

  // Online form effectiveness + repeat guests (Ops request 2026-07-26)
  await loadOpsOnlineFormReport();
  await loadOpsRepeatGuests();

  // Reservation Forecast — always live, independent of date filter
  await loadOpsForecast();

  // Peak Traffic — user-selectable 14-day window
  renderOpsPeakTraffic(peakReservations, peakWalkIns);
  startPeakTrafficAutoRefresh();

  // Sync active button state and range label
  await setOpsReportRange(currentOpsReportRange);
}

async function loadOpsForecast() {
  // Compute date windows — always relative to today, never affected by the reporting period filter
  const now = new Date();
  const todayStr = ymd(now);

  // This week: Mon–Sun of current week
  const dayOfWeek = now.getDay(); // 0=Sun
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - ((dayOfWeek + 6) % 7)); // Monday
  const thisWeekEnd = new Date(thisWeekStart);
  thisWeekEnd.setDate(thisWeekStart.getDate() + 6); // Sunday

  // Next week: following Mon–Sun
  const nextWeekStart = new Date(thisWeekEnd);
  nextWeekStart.setDate(thisWeekEnd.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  // Next month: 1st–last day of next calendar month
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const fmt2 = ymd;

  const [thisWeekRes, nextWeekRes, nextMonthRes] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("pax, status")
          .gte("reservation_date", fmt2(thisWeekStart))
          .lte("reservation_date", fmt2(thisWeekEnd))
          .neq("status", "cancelled"),
      "Failed to load this week forecast",
    ),
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("pax, status")
          .gte("reservation_date", fmt2(nextWeekStart))
          .lte("reservation_date", fmt2(nextWeekEnd))
          .neq("status", "cancelled"),
      "Failed to load next week forecast",
    ),
    supabaseQuery(
      () =>
        db
          .from("reservations")
          .select("pax, status")
          .gte("reservation_date", fmt2(nextMonthStart))
          .lte("reservation_date", fmt2(nextMonthEnd))
          .neq("status", "cancelled"),
      "Failed to load next month forecast",
    ),
  ]);

  const summarise = (res) => {
    const data = res.data || [];
    return {
      count: data.length,
      pax: data.reduce((sum, r) => sum + (r.pax || 0), 0),
    };
  };

  const tw = summarise(thisWeekRes);
  const nw = summarise(nextWeekRes);
  const nm = summarise(nextMonthRes);

  document.getElementById("ops-forecast-this-week").textContent = tw.count;
  document.getElementById("ops-forecast-this-week-pax").textContent =
    `${tw.pax} pax`;
  document.getElementById("ops-forecast-next-week").textContent = nw.count;
  document.getElementById("ops-forecast-next-week-pax").textContent =
    `${nw.pax} pax`;
  document.getElementById("ops-forecast-next-month").textContent = nm.count;
  document.getElementById("ops-forecast-next-month-pax").textContent =
    `${nm.pax} pax`;
}

function getMarketingDateRange(value = currentMarketingRange) {
  const today = new Date();
  const padded = ymd;
  const TODAY = padded(today);
  if (value === "today") return { from: TODAY, to: TODAY };
  if (value === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { from: padded(start), to: TODAY };
  }
  if (value === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: padded(start), to: TODAY };
  }
  if (value === "custom") {
    const from = document.getElementById("mkt-from-date")?.value || TODAY;
    const to = document.getElementById("mkt-to-date")?.value || TODAY;
    return { from, to };
  }
  return { from: TODAY, to: TODAY };
}

// Channel of a single visit. visits.visit_type is 'Reservation' or 'Walk-In'
// and in prod it has never disagreed with reservation_id being present, but we
// fall back to reservation_id rather than trust the free-text column alone.
// Anything we cannot classify becomes 'walkin' — the front desk creates
// walk-ins by default, so that is the safe assumption, and it keeps the two
// channel lines summing to the card headline instead of silently losing rows.
function reportVisitChannel(v) {
  if (v.visit_type === "Reservation" || v.reservation_id) return "reservation";
  return "walkin";
}

// A visit's key for "which came first", date + time so two visits on the same
// day resolve deterministically instead of depending on fetch order.
function reportVisitOrderKey(v) {
  return `${v.visit_date} ${v.visit_time || "00:00:00"}`;
}

function buildReportGuestStats(visits) {
  const stats = {};
  (visits || []).forEach((v) => {
    if (!v.guest_id) return;
    const g = v.guests || {};
    const pax = Number(v.pax) > 0 ? Number(v.pax) : 0;
    const channel = reportVisitChannel(v);
    const orderKey = reportVisitOrderKey(v);
    if (!stats[v.guest_id]) {
      stats[v.guest_id] = {
        id: v.guest_id,
        name: g.name || "Unknown",
        phone: g.phone || "",
        spending_tier: g.spending_tier || null,
        totalVisits: 0,
        firstVisit: v.visit_date,
        lastVisit: v.visit_date,
        // Channel attribution: the guest belongs to whichever channel brought
        // them in FIRST within this set of visits. A guest who books one night
        // and walks in the next is counted once, under the booking, so the
        // channel lines always add up to the card total.
        firstChannel: channel,
        firstOrderKey: orderKey,
        pax: 0, // total heads across their visits in this set
        paxReservation: 0,
        paxWalkin: 0,
        visitsReservation: 0,
        visitsWalkin: 0,
      };
    }
    const s = stats[v.guest_id];
    s.totalVisits += 1;
    s.pax += pax;
    if (channel === "reservation") {
      s.paxReservation += pax;
      s.visitsReservation += 1;
    } else {
      s.paxWalkin += pax;
      s.visitsWalkin += 1;
    }
    if (v.visit_date < s.firstVisit) s.firstVisit = v.visit_date;
    if (v.visit_date > s.lastVisit) s.lastVisit = v.visit_date;
    if (orderKey < s.firstOrderKey) {
      s.firstOrderKey = orderKey;
      s.firstChannel = channel;
    }
  });
  return stats;
}

// "24 guests / 228 pax". Built in JS rather than as an i18n dictionary key
// because the numbers are interpolated — t() only matches whole strings, so a
// templated sentence would never find its Indonesian entry. The two unit words
// are looked up individually and DO switch language with the rest of the page.
function reportChannelLine(bucket) {
  return `${bucket.guests} ${t("guests")} / ${bucket.pax} ${t("pax")}`;
}

function reportPaxLine(pax) {
  return `${pax} ${t("pax")}`;
}

// CSV column value. Deliberately NOT translated: exports get opened in Excel
// and pivoted, so the values must stay stable regardless of the UI language.
function reportChannelLabel(channel) {
  return channel === "reservation" ? "Reservation" : "Walk-In";
}

// Hosts and heads for one card, split by the channel that brought each guest
// in. Returns counts that are guaranteed to sum to the input length.
function reportChannelBreakdown(guests) {
  const out = {
    reservation: { guests: 0, pax: 0 },
    walkin: { guests: 0, pax: 0 },
    totalPax: 0,
  };
  (guests || []).forEach((g) => {
    const bucket = g.firstChannel === "reservation" ? "reservation" : "walkin";
    out[bucket].guests += 1;
    out[bucket].pax += g.pax || 0;
    out.totalPax += g.pax || 0;
  });
  return out;
}

function reportRangeLabel(from, to) {
  return from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`;
}

function reportIsAcquisitionGuest(g, from, to) {
  return !!g.firstVisit && g.firstVisit >= from && g.firstVisit <= to;
}

// Loyalty tiers are a property of the GUEST, not of the reporting window, so
// they must read lifetime visits. Until 2026-08-09 they read g.totalVisits,
// which buildReportGuestStats() fills with visits INSIDE the selected range —
// so "Loyal (5-9 visits)" was really asking "did they eat here 5 times in
// these 9 days", and the Retain card read 3 when 16 guests had come back.
// periodGuests carries lifetimeVisits; the fallback keeps callers that pass a
// raw stats object working.
function reportLifetimeVisits(g) {
  return g.lifetimeVisits ?? g.totalVisits ?? 0;
}

function reportIsReturningGuest(g) {
  const n = reportLifetimeVisits(g);
  return n >= 2 && n <= 4;
}

function reportIsLoyalGuest(g) {
  const n = reportLifetimeVisits(g);
  return n >= 5 && n <= 9;
}

function reportIsVipGuest(g) {
  return reportLifetimeVisits(g) >= 10;
}

// Retain = visited in the window AND had already visited before it. Defined
// as the exact complement of acquisition within the window's guest list, so
// Acquire + Retain always equals the headline "guests visited" total with no
// guest counted twice. A guest with no firstVisit (data gap) is treated as
// acquisition, never silently dropped from both cards.
function reportIsRetainGuest(g, from, to) {
  return !reportIsAcquisitionGuest(g, from, to);
}

function setMarketingRange(range) {
  currentMarketingRange = range;
  const keys = ["today", "week", "month", "custom"];
  keys.forEach((k) => {
    const btn = document.getElementById(`mkt-range-${k}`);
    if (!btn) return;
    btn.classList.toggle("bg-white", k === range);
    btn.classList.toggle("font-semibold", k === range);
    btn.classList.toggle("border-[#28547C]", k === range);
    btn.classList.toggle("text-[#28547C]", k === range);
  });
  const customDates = document.getElementById("mkt-custom-dates");
  if (customDates) customDates.classList.toggle("hidden", range !== "custom");
  if (range !== "custom") loadReports();
}

async function loadReports() {
  const { from, to } = getMarketingDateRange();

  // Update range label
  const rangeLabel = document.getElementById("mkt-range-label");
  if (rangeLabel)
    rangeLabel.textContent =
      from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`;

  // Fetch all-time visits for first/last-visit segment truth, plus filtered
  // period visits for the selected report window counts.
  //
  // The all-time query stays deliberately LEAN (no pax/visit_type/visit_time):
  // it grows with every visit ever recorded and this account has hit the
  // Supabase egress limit before. Its stats object therefore has pax 0 and
  // firstChannel 'walkin' for everyone — those fields are meaningless on
  // allTimeStats and only ever read from periodStats. Do not start reading
  // channel or pax off allTimeGuests without adding the columns here.
  const [allVisitsRes, periodVisitsRes] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select("visit_date, guest_id, guests(name, phone, spending_tier)")
          .is("voided_at", null)
          .order("visit_date", { ascending: false }),
      "Failed to load all visits",
    ),
    supabaseQuery(
      () =>
        db
          .from("visits")
          .select(
            "visit_date, visit_time, guest_id, pax, visit_type, reservation_id, guests(name, phone, spending_tier)",
          )
          .gte("visit_date", from)
          .lte("visit_date", to)
          .is("voided_at", null)
          .order("visit_date", { ascending: false }),
      "Failed to load period visits",
    ),
  ]);

  if (allVisitsRes.error || periodVisitsRes.error) {
    toast("Failed to load marketing data", "error");
    return;
  }

  const allTimeStats = buildReportGuestStats(allVisitsRes.data);
  const periodStats = buildReportGuestStats(periodVisitsRes.data);

  const periodGuests = Object.values(periodStats).map((g) => ({
    ...g,
    firstVisit: allTimeStats[g.id]?.firstVisit || g.firstVisit,
    lifetimeVisits: allTimeStats[g.id]?.totalVisits || g.totalVisits,
  }));
  const allTimeGuests = Object.values(allTimeStats);
  const today = new Date();
  const atRiskThreshold60 = new Date(today);
  atRiskThreshold60.setDate(atRiskThreshold60.getDate() - 60);
  const atRiskThreshold90 = new Date(today);
  atRiskThreshold90.setDate(atRiskThreshold90.getDate() - 90);

  const newGuests = periodGuests.filter((g) =>
    reportIsAcquisitionGuest(g, from, to),
  );
  const retainGuests = periodGuests.filter((g) =>
    reportIsRetainGuest(g, from, to),
  );
  // Tier breakdown is computed over retainGuests, not periodGuests, so the
  // three lines always sum to the headline. A first-timer who came twice this
  // week has 2 lifetime visits but belongs to Acquire, not to "Returning".
  const returningGuests = retainGuests.filter(reportIsReturningGuest);
  const loyalGuests = retainGuests.filter(reportIsLoyalGuest);
  const vipGuests = retainGuests.filter(reportIsVipGuest);
  // Separate, deliberately different question: how many guests ate here more
  // than once INSIDE the window. Shown as a secondary line so nobody mistakes
  // it for retention again.
  const repeatInPeriodGuests = periodGuests.filter((g) => g.totalVisits >= 2);

  // Channel + headcount split for both cards (2026-08-09). Hosts answer "how
  // many people can we contact", pax answers "how many people did we actually
  // serve" — they are very different numbers: in Aug 2026 reservations were a
  // minority of hosts but the majority of heads.
  const newChannels = reportChannelBreakdown(newGuests);
  const retainChannels = reportChannelBreakdown(retainGuests);

  // At-risk: split into 60–89 days and 90+ days, guests appear in exactly one bucket
  const atRiskBase = allTimeGuests.map((g) => ({
    ...g,
    daysSinceLastVisit: Math.max(
      0,
      Math.round((today - new Date(g.lastVisit)) / 86400000),
    ),
  }));

  const atRisk60 = atRiskBase
    .filter(
      (g) =>
        new Date(g.lastVisit) < atRiskThreshold60 &&
        new Date(g.lastVisit) >= atRiskThreshold90,
    )
    .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);

  const atRisk90 = atRiskBase
    .filter((g) => new Date(g.lastVisit) < atRiskThreshold90)
    .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);

  const atRisk = [...atRisk60, ...atRisk90]; // legacy combined key

  currentReportSegments = {
    range: { from, to, label: reportRangeLabel(from, to) },
    firstTime: newGuests,
    returning: retainGuests,
    repeatInPeriod: repeatInPeriodGuests,
    atRisk,
    atRisk60,
    atRisk90,
    allPeriod: periodGuests,
    // legacy keys kept for any other callers
    newGuests: newGuests.length,
    returningGuests: returningGuests.length,
    loyalGuests: loyalGuests.length,
    vipGuests: vipGuests.length,
    // "Ready for membership" is a lifetime property too — same bug class as
    // the tier counts above, fixed 2026-08-09.
    membershipCandidates: periodGuests.filter(
      (g) => reportLifetimeVisits(g) >= 3,
    ),
    vipCandidates: periodGuests.filter((g) => reportLifetimeVisits(g) >= 5),
  };

  // Update headline
  document.getElementById("report-total-guests").textContent =
    periodGuests.length;
  const headlineSub = document.getElementById("mkt-headline-sub");
  if (headlineSub)
    headlineSub.textContent = `in ${reportRangeLabel(from, to)}`;

  // Update cards
  document.getElementById("report-new-guests").textContent = newGuests.length;
  document.getElementById("mkt-retain-total").textContent = retainGuests.length;
  // report-returning-guests / report-loyal-guests / report-vip-guests were
  // written here until 2026-08-09, when the tier rows were removed from the
  // Retain card. Those three getElementById calls were UNGUARDED and would
  // have thrown on the missing elements, aborting loadReports() before the
  // at-risk card and the tables rendered. The counts still reach the hidden
  // seg-* spans via the guarded legacyIds block below.
  const repeatEl = document.getElementById("mkt-repeat-in-period");
  if (repeatEl) repeatEl.textContent = repeatInPeriodGuests.length;

  // Channel + pax lines. Written as text rather than i18n keys because the
  // numbers are interpolated; the unit words come from reportPaxUnit() so
  // they follow the same language toggle as the rest of the page.
  const setChannelText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setChannelText("mkt-acq-res", reportChannelLine(newChannels.reservation));
  setChannelText("mkt-acq-walkin", reportChannelLine(newChannels.walkin));
  setChannelText("mkt-acq-pax", reportPaxLine(newChannels.totalPax));
  setChannelText("mkt-ret-res", reportChannelLine(retainChannels.reservation));
  setChannelText("mkt-ret-walkin", reportChannelLine(retainChannels.walkin));
  setChannelText("mkt-ret-pax", reportPaxLine(retainChannels.totalPax));

  refreshAtRiskDisplay();

  // Legacy hidden IDs
  const legacyIds = {
    "seg-new-guests": newGuests.length,
    "seg-returning-guests": returningGuests.length,
    "seg-loyal-guests": loyalGuests.length,
    "seg-vip-guests": vipGuests.length,
    "opp-first-time": newGuests.length,
    "opp-membership": currentReportSegments.membershipCandidates.length,
    "opp-vip": currentReportSegments.vipCandidates.length,
  };
  Object.entries(legacyIds).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  // Top guests table
  const topGuests = [...periodGuests]
    .sort((a, b) => b.totalVisits - a.totalVisits)
    .slice(0, 10);
  const topGuestsBody = document.getElementById("top-guests-table-body");
  if (topGuestsBody) {
    topGuestsBody.innerHTML = topGuests.length
      ? topGuests
          .map(
            (g) => `
        <tr class="border-b border-[#F5F3EF]">
          <td class="px-4 py-3 text-sm text-[#222] font-medium">${formatGuestName(g)} ${memberBadge(g.id)}</td>
          <td class="px-4 py-3 text-sm text-[#999]">${escapeHtml(g.phone || "—")}</td>
          <td class="px-4 py-3 text-sm text-[#555] text-right">${g.totalVisits}</td>
          <td class="px-4 py-3 text-sm text-[#999] text-right">${fmt.date(g.lastVisit)}</td>
        </tr>
      `,
          )
          .join("")
      : '<tr><td colspan="4" class="px-4 py-8 text-center text-[#bbb] text-sm">No guest visits in this period</td></tr>';
  }

  // Google Review Promotion — all-time, not date filtered
  await loadMarketingReviewPerformance();

  // Top Spender Leaderboard - last 3 months
  await loadTopSpenderLeaderboard();

  // At-Risk High Spender Report
  await loadAtRiskHighSpenders();
}

// ============================================================
// TOP SPENDER LEADERBOARD
// ============================================================
async function loadTopSpenderLeaderboard() {
  const fromInput = document.getElementById("top-spender-from");
  const toInput = document.getElementById("top-spender-to");

  // Default to last 3 months if no dates selected
  const today = new Date();
  let from, to;
  if (fromInput?.value && toInput?.value) {
    from = fromInput.value;
    to = toInput.value;
  } else {
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    from = ymd(threeMonthsAgo);
    to = ymd(today);
    if (fromInput) fromInput.value = from;
    if (toInput) toInput.value = to;
  }

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select(
          "visit_date, pax, spend_amount, guest_id, guests(id, name, phone)",
        )
        .gte("visit_date", from)
        .lte("visit_date", to)
        .gt("spend_amount", 0)
        .neq("pax", 0)
        .order("spend_amount", { ascending: false }),
    "Failed to load top spender data",
  );

  const tbody = document.getElementById("top-spender-table-body");
  if (!tbody) return;

  if (error || !data?.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="px-4 py-8 text-center text-[#bbb] text-sm">No spending data available for the selected period</td></tr>';
    return;
  }

  // Aggregate spend and visits per guest
  const guestMap = {};
  data.forEach((v) => {
    const guest = v.guests || {};
    const gid = v.guest_id;
    if (!gid) return;
    if (!guestMap[gid]) {
      guestMap[gid] = {
        name: guest.name || "Unknown",
        phone: guest.phone || "",
        totalSpend: 0,
        totalVisits: 0,
      };
    }
    guestMap[gid].totalSpend += v.spend_amount || 0;
    guestMap[gid].totalVisits += 1;
  });

  // Sort by total spend descending, take top 20
  const sorted = Object.values(guestMap)
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 5);

  function formatCurrency(amount) {
    return "Rp " + Number(amount).toLocaleString("id-ID");
  }

  tbody.innerHTML = sorted.length
    ? sorted
        .map(
          (g, i) => `
      <tr class="border-b border-[#F5F3EF]">
        <td class="px-4 py-3 text-sm text-[#555] font-medium">${i + 1}</td>
        <td class="px-4 py-3 text-sm text-[#222] font-medium">${formatGuestName(g)}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${escapeHtml(g.phone || "-")}</td>
        <td class="px-4 py-3 text-sm text-[#28547C] font-semibold text-right">${formatCurrency(g.totalSpend)}</td>
        <td class="px-4 py-3 text-sm text-[#555] text-right">${g.totalVisits}</td>
      </tr>
    `,
        )
        .join("")
    : '<tr><td colspan="5" class="px-4 py-8 text-center text-[#bbb] text-sm">No spending data available for the selected period</td></tr>';
}

// ============================================================
// AT-RISK HIGH SPENDER REPORT
// ============================================================
async function loadAtRiskHighSpenders() {
  const tbody = document.getElementById("at-risk-high-spender-table-body");
  if (!tbody) return;

  const { data: guests, error } = await supabaseQuery(
    () =>
      db
        .from("guests")
        .select("id, name, phone, spending_tier, high_spender_qualified_at")
        .eq("spending_tier", "high_spender")
        .not("high_spender_qualified_at", "is", null),
    "Failed to load at-risk high spender data",
  );

  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">Failed to load data</td></tr>';
    return;
  }

  const now = new Date();
  const STICKY_DAYS = 90;

  const atRisk = (guests || [])
    .map((g) => {
      const qualifiedAt = new Date(g.high_spender_qualified_at);
      const daysSince = Math.round((now - qualifiedAt) / 86400000);
      const daysRemaining = STICKY_DAYS - daysSince;
      return { ...g, daysRemaining };
    })
    .filter((g) => g.daysRemaining <= 14 && g.daysRemaining > 0)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  if (!atRisk.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No High Spenders are approaching downgrade. Guests nearing expiration will appear here.</td></tr>';
    return;
  }

  const guestIds = atRisk.map((g) => g.id);
  const { data: visitsData } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("guest_id, visit_date")
        .in("guest_id", guestIds)
        .order("visit_date", { ascending: false }),
    "Failed to load visit data",
  );

  const lastVisitMap = {};
  (visitsData || []).forEach((v) => {
    if (!lastVisitMap[v.guest_id]) {
      lastVisitMap[v.guest_id] = v.visit_date;
    }
  });

  tbody.innerHTML = atRisk
    .map((g) => {
      const lastVisit = lastVisitMap[g.id] ? fmt.date(lastVisitMap[g.id]) : "—";
      return `
      <tr class="border-b border-[#F5F3EF]">
        <td class="px-4 py-3 text-sm text-[#222] font-medium">${formatGuestName(g)}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${escapeHtml(fmt.phone(g.phone))}</td>
        <td class="px-4 py-3 text-sm">${formatSpendingTierBadge(g.spending_tier)}</td>
        <td class="px-4 py-3 text-sm text-[#555]">${fmt.date(g.high_spender_qualified_at)}</td>
        <td class="px-4 py-3 text-sm text-[#C0392B] font-semibold">${g.daysRemaining} days</td>
        <td class="px-4 py-3 text-sm text-[#999]">${lastVisit}</td>
      </tr>
    `;
    })
    .join("");
}

// ============================================================
// BIRTHDAY GUESTS REPORT
// ============================================================

let birthdayViewYear, birthdayViewMonth;

// ============================================================
// BIRTHDAY ALERT BELL (next 7 days, global across all pages)
// ============================================================
let birthdayAlertData = [];

// Returns integer days from today until the guest's next birthday
// occurrence (0 = today). Handles year-wrap (Dec -> Jan) and Feb 29
// guests in non-leap years (treated as Feb 28).
function computeDaysUntilBirthday(birthdayStr, today) {
  if (!birthdayStr) return null;
  const parts = String(birthdayStr).split("-");
  if (parts.length < 3) return null;
  let bMonth = parseInt(parts[1], 10);
  let bDay = parseInt(parts[2], 10);
  if (!bMonth || !bDay) return null;

  // `todayMidnight`, not `t` — see the note in truncateNotes().
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const buildOccurrence = (year) => {
    // Feb 29 in a non-leap year -> fall back to Feb 28
    if (bMonth === 2 && bDay === 29) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      if (!isLeap) return new Date(year, 1, 28);
    }
    return new Date(year, bMonth - 1, bDay);
  };

  let occurrence = buildOccurrence(todayMidnight.getFullYear());
  if (occurrence < todayMidnight) {
    occurrence = buildOccurrence(todayMidnight.getFullYear() + 1);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((occurrence - todayMidnight) / msPerDay);
}

// ============================================================
// BIRTHDAY FOLLOW-UP
// ============================================================
// The loop this serves:
//   badge lights up -> staff opens the list -> sends a WhatsApp greeting
//   -> ticks the guest off -> badge goes down, list stays.
//
// SCOPE OF THE BADGE (Rere, 2026-08-23): birthdays in the CURRENT CALENDAR
// MONTH that have not been greeted, counting only those that have not
// already passed. The month is what she wants visible; a birthday that was
// on the 3rd cannot be un-missed on the 20th, and leaving it red for the
// rest of the month trains people to ignore the badge. Passed birthdays stay
// in the list, labelled, and can still be ticked or messaged.
//
// Guests with no phone number are shown but never counted: the front desk
// cannot WhatsApp them, so a badge that includes them is a task nobody can
// finish. The row says why and offers the manual tick instead.
//
// THE TICK IS SEPARATE FROM THE WHATSAPP BUTTON, on purpose, matching
// reservation follow-up. Opening wa.me proves a chat window opened, not that
// a message was sent, and staff get interrupted mid-send constantly.

// Greetings already recorded, keyed "<guestId>:<year>". Keyed by year rather
// than a bare id because the dashboard shows this year while the report can
// be browsing next January, and the two must not contaminate each other.
let birthdayGreetedKeys = new Set();

function birthdayGreetKey(guestId, year) {
  return `${guestId}:${year}`;
}

function isBirthdayGreeted(guestId, year) {
  return birthdayGreetedKeys.has(birthdayGreetKey(guestId, year));
}

// Has this birthday already gone by in the month being shown?
//
// It cannot be answered with computeDaysUntilBirthday(). That function rolls
// a past date forward to NEXT year, so a birthday on the 3rd read on the 15th
// comes back as ~353 days, which is >= 0 and looks perfectly upcoming. A
// first version of this feature used `daysUntil >= 0` and counted every
// passed birthday as still outstanding; the test suite caught it.
//
// The lists that use this are already filtered to one calendar month, so
// comparing the day of the month is both correct and unambiguous.
function birthdayHasPassed(guest, today) {
  const now = today || new Date();
  if (!guest || !guest.birthday) return false;
  const bdMonth = parseInt(String(guest.birthday).substring(5, 7), 10);
  if (bdMonth !== now.getMonth() + 1) return false; // not this month, not our call
  const bdDay = parseInt(String(guest.birthday).substring(8, 10), 10);
  return bdDay < now.getDate();
}

// True when this guest still needs action: not greeted, has a phone, and the
// date has not gone by. This one predicate drives the badge, the nav dots and
// the row styling, so the three can never disagree.
function birthdayNeedsFollowUp(guest, year, today) {
  if (!guest || !guest.birthday) return false;
  if (!guest.phone) return false;
  if (isBirthdayGreeted(guest.id, year)) return false;
  if (birthdayHasPassed(guest, today || new Date())) return false;
  const daysUntil = computeDaysUntilBirthday(guest.birthday, today || new Date());
  return daysUntil !== null && daysUntil >= 0;
}

// Reads which of these guests have already been greeted this year. Small
// query by design: it is filtered to the ids on screen, so it costs one
// round trip and a few dozen rows, not the whole table.
async function loadBirthdayGreetings(guestIds, year) {
  if (!guestIds || !guestIds.length) return;
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("birthday_greetings")
        .select("guest_id")
        .eq("birthday_year", year)
        .in("guest_id", guestIds),
    "Failed to load birthday greetings",
  );
  if (error) return; // leave the cache as-is; worst case a tick looks unticked
  // Drop this year's stale entries for the ids we just asked about, so a
  // greeting undone in another tab disappears here too.
  guestIds.forEach((id) => birthdayGreetedKeys.delete(birthdayGreetKey(id, year)));
  (data || []).forEach((r) =>
    birthdayGreetedKeys.add(birthdayGreetKey(r.guest_id, year)),
  );
}

// Feeds the badge. `monthShown` / `yearShown` are the month the CALLER just
// loaded, and the guard below is the whole point of them: the birthday report
// lets a manager browse to December, and without this the badge would
// recompute from December's data and clear itself while August still has
// people waiting to be greeted.
function computeBirthdayAlerts(guestsData, monthShown, yearShown) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  if (
    (monthShown !== undefined && monthShown !== currentMonth) ||
    (yearShown !== undefined && yearShown !== currentYear)
  ) {
    return; // not this month — the badge is not ours to touch
  }

  const monthStr = String(currentMonth).padStart(2, "0");
  birthdayAlertData = (guestsData || [])
    .filter((g) => g.birthday && String(g.birthday).substring(5, 7) === monthStr)
    .map((g) => ({
      ...g,
      daysUntil: computeDaysUntilBirthday(g.birthday, today),
      greeted: isBirthdayGreeted(g.id, currentYear),
      needsFollowUp: birthdayNeedsFollowUp(g, currentYear, today),
    }))
    // Still to do first (soonest first), then the rest of the month by day.
    .sort((a, b) => {
      if (a.needsFollowUp !== b.needsFollowUp) return a.needsFollowUp ? -1 : 1;
      return (a.daysUntil ?? 999) - (b.daysUntil ?? 999);
    });

  renderBirthdayAlertBadge();
  renderBirthdayAlertPanel();
  updateBirthdayReportBadge();
  updateBirthdayNavDots();
}

function birthdayDueCount() {
  return birthdayAlertData.filter((g) => g.needsFollowUp).length;
}

function renderBirthdayAlertBadge() {
  const badge = document.getElementById("bd-alert-badge");
  if (!badge) return;
  const count = birthdayDueCount();
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// Short label for how far away a birthday is. Past dates are the interesting
// case: computeDaysUntilBirthday() rolls to NEXT year once the day has gone,
// so a birthday earlier this month comes back as ~350 rather than a negative
// number. Detect it by comparing the day of the month, not the day count.
function birthdayDayLabel(guest, today) {
  const now = today || new Date();
  if (birthdayHasPassed(guest, now)) return { text: t("passed"), color: "#999" };
  if (guest.daysUntil === 0) return { text: t("Today"), color: "#C0392B" };
  if (guest.daysUntil === 1) return { text: t("Tomorrow"), color: "#C0392B" };
  return { text: `in ${guest.daysUntil} days`, color: "#28547C" };
}

function renderBirthdayAlertPanel() {
  const list = document.getElementById("bd-alert-list");
  if (!list) return;

  if (!birthdayAlertData.length) {
    list.innerHTML = `<p class="text-xs text-[#bbb] text-center py-4">${t("No birthdays this month.")}</p>`;
    return;
  }

  const year = new Date().getFullYear();
  const today = new Date();
  list.innerHTML = birthdayAlertData
    .map((g) => {
      const day = birthdayDayLabel(g, today);
      const greeted = g.greeted;
      return `
      <div class="py-2 border-b border-[#F5F3EF] last:border-0 ${greeted ? "opacity-60" : ""}"
           style="border-radius: 6px; padding-left: 4px; padding-right: 4px">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-medium text-[#222] truncate">${formatGuestName(g)}</p>
            <p class="text-xs text-[#999]">${g.phone ? escapeHtml(fmt.phone(g.phone)) : t("No phone on file")}</p>
          </div>
          <span class="text-xs font-semibold whitespace-nowrap" style="color: ${day.color}">${day.text}</span>
        </div>
        <div class="flex items-center gap-3 mt-1.5">
          ${birthdayFollowUpControls(g, year, "panel")}
        </div>
      </div>`;
    })
    .join("");
}

// One renderer for the bell panel, the dashboard table and the report table,
// so the three can never drift into showing different states for the same
// guest.
function birthdayFollowUpControls(guest, year, context) {
  const greeted = isBirthdayGreeted(guest.id, year);
  const refresh = context === "panel" ? "panel" : context;
  if (greeted) {
    return `
      <span class="text-xs font-semibold text-[#1FAF5E] whitespace-nowrap">${t("Greeting sent")}</span>
      <button onclick="unmarkBirthdayGreeted('${guest.id}', ${year})"
              class="text-xs text-[#999] hover:underline whitespace-nowrap">${t("Undo")}</button>`;
  }
  const waBtn = guest.phone
    ? `<button onclick="sendBirthdayGreeting('${guest.id}', ${year})"
               class="text-xs text-[#1FAF5E] hover:underline whitespace-nowrap font-medium">${t("Send WhatsApp")}</button>`
    : `<span class="text-xs text-[#C0392B] whitespace-nowrap">${t("No phone")}</span>`;
  return `
    ${waBtn}
    <button onclick="markBirthdayGreeted('${guest.id}', ${year}, 'manual')"
            class="text-xs text-[#28547C] hover:underline whitespace-nowrap">${t("Mark as sent")}</button>`;
}

// Opens WhatsApp. Does NOT tick the guest off — see the note at the top of
// this section. The toast is the nudge, because the whole feature is
// worthless if staff message people and never mark it.
async function sendBirthdayGreeting(guestId, year) {
  if (typeof waSendBirthday !== "function") return;
  const opened = await waSendBirthday(guestId);
  if (!opened) return;
  toast(
    CURRENT_LANG === "id"
      ? "WhatsApp dibuka. Setelah pesan terkirim, tekan \"Tandai sudah dikirim\"."
      : 'WhatsApp opened. Once you have sent it, press "Mark as sent".',
  );
}

async function markBirthdayGreeted(guestId, year, method) {
  const session = getStaffSession();
  const { error } = await supabaseQuery(
    () =>
      db.from("birthday_greetings").insert({
        guest_id: guestId,
        birthday_year: year,
        greeted_by: session?.id || null,
        greeted_by_name: session?.display_name || session?.username || null,
        method: method === "whatsapp" ? "whatsapp" : "manual",
      }),
    "Failed to mark birthday greeting",
  );
  // 23505 means somebody at another till ticked the same guest a moment ago.
  // That is the desired end state, not an error to shout about.
  const duplicate =
    error &&
    (error.code === "23505" || /duplicate key|unique/i.test(error.message || ""));
  if (error && !duplicate) {
    toast(error.message || t("Could not mark this as sent"), "error");
    return;
  }
  birthdayGreetedKeys.add(birthdayGreetKey(guestId, year));
  if (!duplicate) toast(t("Marked as sent"));
  refreshBirthdayViews();
}

async function unmarkBirthdayGreeted(guestId, year) {
  const { error } = await supabaseQuery(
    () =>
      db
        .from("birthday_greetings")
        .delete()
        .eq("guest_id", guestId)
        .eq("birthday_year", year),
    "Failed to undo birthday greeting",
  );
  if (error) {
    toast(error.message || t("Could not undo this"), "error");
    return;
  }
  birthdayGreetedKeys.delete(birthdayGreetKey(guestId, year));
  toast(t("Marked as not sent yet"));
  refreshBirthdayViews();
}

// Re-renders whichever birthday surfaces are actually on screen. Reloads
// rather than patching the DOM in place: a tick is rare and a stale row here
// is exactly the failure this feature exists to prevent.
function refreshBirthdayViews() {
  if (isViewingStaffDashboard()) loadDashboardBirthdays();
  if (currentPage === "reports") loadBirthdayGuestsReport();
  if (currentPage === "dashboard" && currentStaffRole() === "admin")
    loadAdminBirthdays();
  // The panel is rendered from birthdayAlertData, which the loaders above
  // refresh. If neither ran (the bell is open over some other page), redraw
  // from what is already in memory so the row updates immediately.
  const stillOpen = !document
    .getElementById("bd-alert-panel")
    ?.classList.contains("hidden");
  if (stillOpen) {
    birthdayAlertData = birthdayAlertData.map((g) => ({
      ...g,
      greeted: isBirthdayGreeted(g.id, new Date().getFullYear()),
      needsFollowUp: birthdayNeedsFollowUp(g, new Date().getFullYear()),
    }));
    renderBirthdayAlertBadge();
    renderBirthdayAlertPanel();
    updateBirthdayReportBadge();
    updateBirthdayNavDots();
  }
}

function toggleBirthdayAlertPanel() {
  document.getElementById("res-alert-panel")?.classList.add("hidden"); // one panel at a time
  document.getElementById("bd-alert-panel")?.classList.toggle("hidden");
}

// Close the panel when clicking outside of it
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("bd-alert-wrap");
  const panel = document.getElementById("bd-alert-panel");
  if (!wrap || !panel || panel.classList.contains("hidden")) return;
  // A click on a control INSIDE the panel often re-renders the panel's list,
  // which detaches the very node this handler is about to test. contains()
  // then reports "outside" and the panel closes under the user's finger.
  // Reported 2026-08-23: the same thing happened on the reservation
  // panel. Fixed here at the same time because "Mark as sent" and "Undo" in
  // this panel re-render it exactly the same way. isConnected is false for a node that has been replaced,
  // so this catches every such control rather than one button at a time.
  if (!e.target.isConnected) return;
  if (!wrap.contains(e.target)) panel.classList.add("hidden");
});

// The bell used to send everyone to Reports. Staff cannot open Reports
// (STAFF_ALLOWED_PAGES excludes it), so for them that was a button that
// bounced them to the dashboard with "Access restricted". Managers still go
// to the report; everyone else goes to the birthday table on the dashboard,
// which shows the same month and now carries the same buttons.
function goToBirthdayReport() {
  document.getElementById("bd-alert-panel")?.classList.add("hidden");
  if (!hasAccess("reports")) {
    navigateTo(currentStaffRole() === "admin" ? "staff-dashboard" : "dashboard");
    setTimeout(() => {
      document
        .getElementById("dash-bd-label")
        ?.closest(".card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return;
  }
  navigateTo("reports");
  setReportsTab("marketing");
  setTimeout(() => {
    document
      .getElementById("bd-current-label")
      ?.closest(".card")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

function updateBirthdayReportBadge() {
  const el = document.getElementById("bd-report-soon-count");
  if (!el) return;
  const count = birthdayDueCount();
  if (count > 0) {
    el.textContent =
      CURRENT_LANG === "id"
        ? `${count} belum diucapkan`
        : `${count} still to greet`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// Red dot on the Reports sidebar item + the Marketing tab, so staff notice
// there's something to act on before they even open the panel. Driven by the
// same due count as the badge: once everyone this month has been greeted the
// dots go out, even though the list is still full of names.
function updateBirthdayNavDots() {
  const hasUpcoming = birthdayDueCount() > 0;
  [
    "nav-reports-dot",
    "nav-reports-cake",
    "nav-dashboard-dot",
    "nav-dashboard-cake",
    "tab-marketing-dot",
  ].forEach((id) => {
    document.getElementById(id)?.classList.toggle("hidden", !hasUpcoming);
  });
}

// ============================================================
// DASHBOARD PRIZE REDEMPTIONS (pending only)
// ============================================================

let dashboardPrizeAllData = [];
const DASH_PRIZE_LIMIT = 5;

async function loadDashboardPrizeRedemptions() {
  const tbody = document.getElementById("dash-prize-table-body");
  if (!tbody) return;

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("spin_submissions")
        .select(
          "id, name, prize_name, reference_code, review_confirmed, status, created_at",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    "Failed to load prize redemptions",
  );

  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">Failed to load data</td></tr>';
    return;
  }

  dashboardPrizeAllData = data || [];
  dashboardPrizePage = 0;

  // Clear search on fresh load
  const searchEl = document.getElementById("dash-prize-search");
  if (searchEl) searchEl.value = "";

  renderDashboardPrizeTable();
}

function filterDashboardPrizes() {
  renderDashboardPrizeTable();
}

function renderDashboardPrizeTable() {
  const tbody = document.getElementById("dash-prize-table-body");
  const label = document.getElementById("dash-prize-label");
  if (!tbody) return;

  const query = (document.getElementById("dash-prize-search")?.value || "")
    .trim()
    .toLowerCase();
  const isSearching = query.length > 0;

  const filtered = isSearching
    ? dashboardPrizeAllData.filter(
        (row) =>
          (row.name || "").toLowerCase().includes(query) ||
          (row.prize_name || "").toLowerCase().includes(query) ||
          (row.reference_code || "").toLowerCase().includes(query),
      )
    : dashboardPrizeAllData;

  const total = dashboardPrizeAllData.length;

  if (label) {
    if (isSearching) {
      label.textContent = filtered.length
        ? `${filtered.length} result${filtered.length === 1 ? "" : "s"} for "${query}"`
        : `No results for "${query}"`;
    } else {
      label.textContent =
        total === 0
          ? "No pending prizes at this time"
          : `${total} pending redemption${total === 1 ? "" : "s"}`;
    }
  }

  if (!filtered.length) {
    renderPaginationControls(
      "dash-prize-pagination",
      0,
      0,
      "dashPrizePrevPage",
      "dashPrizeNextPage",
    );
    tbody.innerHTML = isSearching
      ? `<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No matches found for "${escapeHtml(query)}".</td></tr>`
      : '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No pending prize redemptions.<br><span class="text-xs mt-1 block">Guests with prizes to redeem will appear here.</span></td></tr>';
    return;
  }

  // When searching, disable pagination and show all matches per existing search behavior
  const display = isSearching
    ? filtered
    : filtered.slice(
        dashboardPrizePage * DASH_PAGE_SIZE,
        (dashboardPrizePage + 1) * DASH_PAGE_SIZE,
      );

  if (!isSearching) {
    renderPaginationControls(
      "dash-prize-pagination",
      dashboardPrizePage,
      filtered.length,
      "dashPrizePrevPage",
      "dashPrizeNextPage",
    );
  } else {
    renderPaginationControls(
      "dash-prize-pagination",
      0,
      0,
      "dashPrizePrevPage",
      "dashPrizeNextPage",
    );
  }

  tbody.innerHTML = display
    .map((row) => {
      const reviewBadge = row.review_confirmed
        ? '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#D1FAE5] text-[#065F46] font-medium">Confirmed</span>'
        : '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FEF3C7] text-[#92400E] font-medium">Pending</span>';
      const statusBadgeHtml =
        '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FEF3C7] text-[#92400E] font-medium">Pending</span>';
      return `
      <tr class="border-b border-[#F5F3EF]">
        <td class="px-4 py-3 text-sm text-[#222] font-medium">${escapeHtml(row.name || "—")}</td>
        <td class="px-4 py-3 text-sm text-[#28547C] font-medium">${escapeHtml(row.prize_name || "—")}</td>
        <td class="px-4 py-3 text-sm font-mono text-[#555]">${escapeHtml(row.reference_code || "—")}</td>
        <td class="px-4 py-3 text-sm">${reviewBadge}</td>
        <td class="px-4 py-3 text-sm">${statusBadgeHtml}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${fmt.date(row.created_at)}</td>
      </tr>`;
    })
    .join("");
}

// ============================================================
// DASHBOARD BIRTHDAY GUESTS (current month, no navigation)
// ============================================================

async function loadDashboardBirthdays() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-based

  const label = document.getElementById("dash-bd-label");
  if (label) {
    label.textContent = `Guests celebrating a birthday in ${monthNameLong(currentMonth)} ${currentYear}`;
  }

  const monthStr = String(currentMonth).padStart(2, "0");
  // EGRESS FIX: server-side RPC returns only guests whose birthday is in
  // this month OR within the next 7 days (for the alert bell), instead of
  // downloading every guest with a birthday on file.
  const { data: bdData, error } = await supabaseQuery(
    () => db.rpc("get_guests_for_birthday_view", { p_month: currentMonth }),
    "Failed to load dashboard birthday guests",
  );

  const tbody = document.getElementById("dash-bd-table-body");
  if (!tbody) return;

  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">Failed to load data</td></tr>';
    return;
  }

  // Month filtering happens here (client-side)
  const filtered = (bdData || []).filter((g) => {
    if (!g.birthday) return false;
    return String(g.birthday).substring(5, 7) === monthStr;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">
      No birthdays this month.<br><span class="text-xs mt-1 block">Guests with birthdays this month will appear here.</span>
    </td></tr>`;
    // Still recompute: everyone may simply have been greeted already, and
    // the badge has to go out rather than keep the last count on screen.
    computeBirthdayAlerts(bdData, currentMonth, currentYear);
    return;
  }

  const guestIds = filtered.map((g) => g.id);

  // Who has already been greeted this year. Must be awaited BEFORE the badge
  // is computed and before the rows render, or the first paint shows every
  // guest as outstanding and the number is wrong for a moment.
  await loadBirthdayGreetings(guestIds, currentYear);
  computeBirthdayAlerts(bdData, currentMonth, currentYear);
  const { data: visitsData } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("guest_id, visit_date")
        .in("guest_id", guestIds)
        .order("visit_date", { ascending: false }),
    "Failed to load visit data",
  );

  const lastVisitMap = {};
  (visitsData || []).forEach((v) => {
    if (!lastVisitMap[v.guest_id]) lastVisitMap[v.guest_id] = v.visit_date;
  });

  const today = new Date();
  tbody.innerHTML = filtered
    .map((g) => {
      const bdDisplay = g.birthday ? fmt.date(g.birthday) : "—";
      const lastVisit = lastVisitMap[g.id] ? fmt.date(lastVisitMap[g.id]) : "—";
      const daysUntil = computeDaysUntilBirthday(g.birthday, today);
      const soonTag =
        daysUntil !== null && daysUntil >= 0 && daysUntil <= 7
          ? `<span class="inline-block ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background:#FEF3C7;color:#92400E;">${daysUntil === 0 ? "Today" : `in ${daysUntil}d`}</span>`
          : "";
      const greeted = isBirthdayGreeted(g.id, currentYear);
      return `
      <tr class="border-b border-[#F5F3EF] ${greeted ? "opacity-60" : ""}">
        <td class="px-4 py-3 text-sm text-[#222] font-medium">${formatGuestName(g)}${soonTag}</td>
        <td class="px-4 py-3 text-sm text-[#555]">${bdDisplay}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${escapeHtml(fmt.phone(g.phone))}</td>
        <td class="px-4 py-3 text-sm">${formatSpendingTierBadge(g.spending_tier)}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${lastVisit}</td>
        <td class="px-4 py-3 text-sm">
          <div class="flex items-center gap-3">${birthdayFollowUpControls(g, currentYear, "dashboard")}</div>
        </td>
      </tr>`;
    })
    .join("");
}

function initBirthdayView() {
  const now = new Date();
  // Default to the current calendar month (matches the Dashboard widget).
  birthdayViewYear = now.getFullYear();
  birthdayViewMonth = now.getMonth() + 1; // 0-based to 1-based
  loadBirthdayGuestsReport();
}

function navigateBirthdayMonth(direction) {
  birthdayViewMonth += direction;
  if (birthdayViewMonth > 12) {
    birthdayViewMonth = 1;
    birthdayViewYear += 1;
  } else if (birthdayViewMonth < 1) {
    birthdayViewMonth = 12;
    birthdayViewYear -= 1;
  }
  loadBirthdayGuestsReport();
}

async function loadBirthdayGuestsReport() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-based

  // Update Previous Month button state
  const prevBtn = document.getElementById("bd-prev-btn");
  if (prevBtn) {
    const isCurrentMonth =
      birthdayViewYear === currentYear && birthdayViewMonth === currentMonth;
    if (isCurrentMonth) {
      prevBtn.disabled = true;
      prevBtn.classList.add("disabled", "opacity-30", "cursor-not-allowed");
    } else {
      prevBtn.disabled = false;
      prevBtn.classList.remove("disabled", "opacity-30", "cursor-not-allowed");
    }
  }

  // Update label
  const label = document.getElementById("bd-current-label");
  if (label) {
    label.textContent = `${monthNameLong(birthdayViewMonth)} ${birthdayViewYear}`;
  }

  // EGRESS FIX: server-side RPC returns only guests whose birthday is in
  // the selected month OR within the next 7 days (for the alert bell),
  // instead of downloading every guest with a birthday on file.
  const monthStr = String(birthdayViewMonth).padStart(2, "0");
  const { data, error } = await supabaseQuery(
    () =>
      db.rpc("get_guests_for_birthday_view", { p_month: birthdayViewMonth }),
    "Failed to load birthday guests",
  );

  const tbody = document.getElementById("bd-table-body");
  if (!tbody) return;

  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">Failed to load data</td></tr>';
    return;
  }

  // Filter by birthday month and fetch last visit dates
  const filtered = (data || []).filter((g) => {
    if (!g.birthday) return false;
    const bdMonth = String(g.birthday).substring(5, 7);
    return bdMonth === monthStr;
  });

  if (!filtered.length) {
    const label = `${monthNameLong(birthdayViewMonth)} ${birthdayViewYear}`;
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No birthdays found for ${label}. Guests with birthdays in this month will appear here.</td></tr>`;
    computeBirthdayAlerts(data, birthdayViewMonth, birthdayViewYear);
    return;
  }

  // Fetch last visit dates for these guests
  const guestIds = filtered.map((g) => g.id);

  // Greeted state for the month BEING VIEWED, which is not necessarily the
  // current one. computeBirthdayAlerts() ignores the badge unless the two
  // match; the ticks in the table below are per-viewed-month either way, so
  // a manager can look back at December and see who was greeted then.
  await loadBirthdayGreetings(guestIds, birthdayViewYear);
  computeBirthdayAlerts(data, birthdayViewMonth, birthdayViewYear);
  const { data: visitsData } = await supabaseQuery(
    () =>
      db
        .from("visits")
        .select("guest_id, visit_date")
        .in("guest_id", guestIds)
        .order("visit_date", { ascending: false }),
    "Failed to load visit data",
  );

  // Map last visit per guest
  const lastVisitMap = {};
  (visitsData || []).forEach((v) => {
    if (!lastVisitMap[v.guest_id]) {
      lastVisitMap[v.guest_id] = v.visit_date;
    }
  });

  tbody.innerHTML = filtered
    .map((g) => {
      const bdDisplay = g.birthday ? fmt.date(g.birthday) : "—";
      const lastVisit = lastVisitMap[g.id] ? fmt.date(lastVisitMap[g.id]) : "—";
      const greeted = isBirthdayGreeted(g.id, birthdayViewYear);
      return `
      <tr class="border-b border-[#F5F3EF] ${greeted ? "opacity-60" : ""}">
        <td class="px-4 py-3 text-sm text-[#222] font-medium">${formatGuestName(g)}</td>
        <td class="px-4 py-3 text-sm text-[#555]">${bdDisplay}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${escapeHtml(fmt.phone(g.phone))}</td>
        <td class="px-4 py-3 text-sm">${formatSpendingTierBadge(g.spending_tier)}</td>
        <td class="px-4 py-3 text-sm text-[#999]">${lastVisit}</td>
        <td class="px-4 py-3 text-sm">
          <div class="flex items-center gap-3">${birthdayFollowUpControls(g, birthdayViewYear, "report")}</div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows]
    .map((r) =>
      r.map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// RESERVATION EXPORT (Excel)
// ============================================================
// Seven columns. Five were agreed 2026-09-01; Pax and Area were added
// 2026-09-04 when the day run sheet arrived.
//
// The original five deliberately left pax and area out, on the reasoning
// that the front desk reads this to WORK a service, not to audit one. That
// reasoning did not survive contact with the floor: this spreadsheet was
// being PRINTED and handed to security, who need to know how many people
// are arriving and where they are sitting. The run sheet is the right paper
// for that job now, but the two sit side by side on the same page and
// somebody will print this one out of habit. Adding the two columns means
// the wrong choice is no longer a harmful one.
//
// Table, occasion, source and spending tier are still deliberately out.
const RES_EXPORT_HEADERS = [
  "Name",
  "Phone Number",
  "Date Time",
  "Pax",
  "Area",
  "Notes",
  "Status",
];

// Excel column widths, in characters. Notes is the only free-text field
// and is what makes an unformatted export unreadable.
const RES_EXPORT_WIDTHS = [26, 16, 18, 6, 18, 56, 18];

// A real Excel datetime, not text, so the column sorts and filters as a
// date instead of alphabetically.
//
// Built from LOCAL parts on purpose. `new Date("2026-09-01")` is parsed as
// UTC and renders as 31 August at UTC+7, which is the same trap ymd()
// exists to avoid. See CLAUDE.md, "Dates".
function resExportDateTime(dateStr, timeStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return "";
  const [hh, mm] = String(timeStr || "").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

// The kitchen detail that belongs to the GUEST rather than to the booking,
// appended under the booking's own note.
//
// One item per LINE, not comma-separated. The values themselves routinely
// contain commas ("Nasi Goreng, Es Teh Manis"), so a comma-joined line is
// ambiguous exactly where it matters most: reading an allergy off a printed
// sheet. Newlines survive the .xlsx round trip; that was verified before this
// was written.
//
// Allergies go LAST because they sit closest to the row below and are the
// line a cook scans for. If that turns out to be the wrong way round on a
// printout, move this one line.
function guestExportExtras(guest) {
  if (!guest) return "";
  const parts = [];
  const fav = (guest.favorite_menu || "").trim();
  const last = (guest.last_order || "").trim();
  const allergy = (guest.food_allergy || "").trim();
  if (fav) parts.push(`Favorite: ${fav}`);
  if (last) parts.push(`Last order: ${last}`);
  if (allergy) parts.push(`Allergies: ${allergy}`);
  return parts.join("\n");
}

// One export row. `fallbackDate` exists because the DASHBOARD query filters
// on reservation_date and never selects it, so those rows carry no date of
// their own and would export a blank Date Time column without it.
function resExportRow(r, fallbackDate) {
  const bookingNote = (r.notes || "").trim();
  const extras = guestExportExtras(r.guests);
  return [
    r.guests ? guestDisplayName(r.guests) : "",
    r.guests?.phone || "",
    resExportDateTime(r.reservation_date || fallbackDate, r.reservation_time),
    r.pax ?? "",
    // A booking with no area yet exports a BLANK cell rather than the run
    // sheet's "Not yet placed" wording. This is a spreadsheet: blank filters
    // and sorts cleanly, a sentence in a column of area names does not.
    r.areas?.name || "",
    // The booking's own note leads: it is about THIS table tonight. The guest
    // details follow. Either half can be missing without leaving a stray
    // blank line at the top or bottom of the cell.
    [bookingNote, extras].filter(Boolean).join("\n"),
    r.status || "",
  ];
}

// Excel cannot hold a Date the way the CSV fallback needs it, so flatten.
function resExportRowAsText(row) {
  return row.map((v) =>
    v instanceof Date
      ? `${ymd(v)} ${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}`
      : v,
  );
}

// SheetJS is lazy-loaded from a CDN (see loadSheetJs), so it can fail on a
// blocked or offline front-desk PC. When it does the export still happens,
// as CSV, rather than the button appearing to do nothing.
async function downloadReservationSheet(baseName, rows, sheetName) {
  if (!rows.length) {
    toast("No reservations to export", "error");
    return;
  }

  let XLSX;
  try {
    XLSX = await loadSheetJs();
  } catch (e) {
    downloadCsv(`${baseName}.csv`, RES_EXPORT_HEADERS, rows.map(resExportRowAsText));
    toast("Excel could not load, exported as CSV instead", "error");
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet([RES_EXPORT_HEADERS, ...rows], {
    cellDates: true,
  });
  ws["!cols"] = RES_EXPORT_WIDTHS.map((w) => ({ wch: w }));
  // Filter dropdowns on the header, so a 200-row day is sortable and
  // filterable without the reader setting anything up first.
  //
  // No frozen header pane: `ws["!freeze"]` is a SheetJS Pro feature and the
  // free build we load from the CDN drops it silently. Verified by reading
  // the produced file back - no <pane> element is written. Do not re-add it
  // and assume it works.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows.length, c: RES_EXPORT_HEADERS.length - 1 },
    }),
  };

  // Explicit d/m/y so the sheet reads the same on an Indonesian and an
  // English copy of Excel. Left to Excel's default it follows the reader's
  // locale and 01/09 silently becomes 9 January somewhere.
  for (let i = 0; i < rows.length; i++) {
    const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: 2 })];
    if (cell && cell.t === "d") cell.z = "dd/mm/yyyy hh:mm";
  }

  const wb = XLSX.utils.book_new();
  // Excel rejects a sheet name over 31 chars or containing : \ / ? * [ ]
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    String(sheetName || "Reservations").replace(/[:\\/?*[\]]/g, "-").slice(0, 31),
  );
  XLSX.writeFile(wb, `${baseName}.xlsx`);
  toast("Reservations exported");
}

// ============================================================
// AT-RISK TAB STATE
// ============================================================

let currentAtRiskTab = "60"; // '60' = 60–89 days, '90' = 90+ days

function switchAtRiskTab(tab) {
  currentAtRiskTab = tab;

  const tab60 = document.getElementById("at-risk-tab-60");
  const tab90 = document.getElementById("at-risk-tab-90");

  if (tab === "60") {
    tab60.classList.add("bg-white", "text-[#E8736A]", "shadow-sm");
    tab60.classList.remove("text-[#bbb]");
    tab90.classList.remove("bg-white", "text-[#E8736A]", "shadow-sm");
    tab90.classList.add("text-[#bbb]");
  } else {
    tab90.classList.add("bg-white", "text-[#E8736A]", "shadow-sm");
    tab90.classList.remove("text-[#bbb]");
    tab60.classList.remove("bg-white", "text-[#E8736A]", "shadow-sm");
    tab60.classList.add("text-[#bbb]");
  }

  refreshAtRiskDisplay();
}

function refreshAtRiskDisplay() {
  const segments = currentReportSegments || {};
  const isTab60 = currentAtRiskTab === "60";
  const data = isTab60 ? segments.atRisk60 || [] : segments.atRisk90 || [];
  const countEl = document.getElementById("opp-at-risk");
  const labelEl = document.getElementById("at-risk-label");
  if (countEl) countEl.textContent = data.length;
  if (labelEl)
    labelEl.textContent = isTab60
      ? "haven't returned in 60–89 days"
      : "haven't returned in 90+ days";
}

function exportAtRiskSegment() {
  const segments = currentReportSegments || {};
  const isTab60 = currentAtRiskTab === "60";
  const data = isTab60 ? segments.atRisk60 || [] : segments.atRisk90 || [];
  const label = isTab60 ? "60-89-days" : "90-plus-days";

  if (!data.length) {
    toast("No guests in this segment to export", "error");
    return;
  }

  const headers = [
    "Name",
    "Phone",
    "Spending Tier",
    "Total Visits",
    "Last Visit Date",
    "Days Since Last Visit",
  ];
  const rows = data.map((g) => [
    g.name,
    g.phone,
    formatSpendingTierLabel(g.spending_tier),
    g.totalVisits,
    fmt.date(g.lastVisit),
    g.daysSinceLastVisit,
  ]);
  downloadCsv(`export-at-risk-${label}-${TODAY}.csv`, headers, rows);
}

function exportGuestSegment(segmentKey) {
  const segments = currentReportSegments[segmentKey] || [];
  if (!segments.length) {
    toast("No guests available for this export", "error");
    return;
  }

  let headers = [];
  let rows = [];
  let filename = `export-${segmentKey}-${TODAY}.csv`;

  if (segmentKey === "firstTime") {
    headers = [
      "Name",
      "Phone",
      "Spending Tier",
      "First Visit Date",
      "Channel",
      "Pax In Period",
    ];
    rows = segments.map((g) => [
      g.name,
      g.phone,
      formatSpendingTierLabel(g.spending_tier),
      fmt.date(g.firstVisit),
      reportChannelLabel(g.firstChannel),
      g.pax || 0,
    ]);
  } else if (segmentKey === "returning") {
    // Lifetime visits, matching the card's tier breakdown. Exporting the
    // period-only count made the CSV disagree with the number on screen.
    headers = [
      "Name",
      "Phone",
      "Spending Tier",
      "Lifetime Visits",
      "Visits In Period",
      "Last Visit Date",
      "Channel",
      "Pax In Period",
    ];
    rows = segments.map((g) => [
      g.name,
      g.phone,
      formatSpendingTierLabel(g.spending_tier),
      reportLifetimeVisits(g),
      g.totalVisits,
      fmt.date(g.lastVisit),
      reportChannelLabel(g.firstChannel),
      g.pax || 0,
    ]);
  } else if (segmentKey === "membershipCandidates") {
    headers = [
      "Name",
      "Phone",
      "Spending Tier",
      "Lifetime Visits",
      "Last Visit Date",
    ];
    rows = segments.map((g) => [
      g.name,
      g.phone,
      formatSpendingTierLabel(g.spending_tier),
      reportLifetimeVisits(g),
      fmt.date(g.lastVisit),
    ]);
  } else if (segmentKey === "atRisk") {
    headers = [
      "Name",
      "Phone",
      "Spending Tier",
      "Total Visits",
      "Last Visit Date",
      "Days Since Last Visit",
    ];
    rows = segments.map((g) => [
      g.name,
      g.phone,
      formatSpendingTierLabel(g.spending_tier),
      g.totalVisits,
      fmt.date(g.lastVisit),
      g.daysSinceLastVisit,
    ]);
  } else if (segmentKey === "allPeriod") {
    headers = [
      "Name",
      "Phone",
      "Spending Tier",
      "Total Visits",
      "First Visit",
      "Last Visit Date",
    ];
    rows = segments.map((g) => [
      g.name,
      g.phone,
      formatSpendingTierLabel(g.spending_tier),
      g.totalVisits,
      fmt.date(g.firstVisit),
      fmt.date(g.lastVisit),
    ]);
  }

  downloadCsv(filename, headers, rows);
}

// ============================================================
// PRIZE MANAGEMENT & SPIN RESULTS
// ============================================================
async function loadPrizeAdmin() {
  await loadPrizes();
  await loadSpinResults();
}

function setupSpinResultsActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".spin-redeem-button");
    if (!button) return;
    const submissionId = button.dataset.submissionId;
    if (!submissionId) return;
    redeemPrize(submissionId);
  });
}

async function loadPrizes() {
  const { data, error } = await supabaseQuery(
    () => db.from("prizes").select("*").order("name"),
    "Failed to load prizes",
  );
  if (error) {
    toast("Failed to load prizes", "error");
    return;
  }
  allPrizes = data || [];
  renderPrizesList();
  populatePrizeFilter();
}

function renderPrizesList() {
  const el = document.getElementById("prizes-list");
  if (!el) return;
  if (!allPrizes.length) {
    el.innerHTML =
      '<p class="text-sm text-[#bbb] text-center py-4">No prizes yet</p>';
    return;
  }
  el.innerHTML = allPrizes
    .map(
      (prize) => `
    <div class="flex items-center justify-between gap-3 p-3 rounded-10 border border-[#EDE9E3]">
      <div>
        <p class="text-sm font-medium text-[#222]">${escapeHtml(prize.name)}</p>
        <p class="text-xs ${prize.is_active ? "text-[#5F8D4E]" : "text-[#999]"}">${prize.is_active ? "Active" : "Disabled"}</p>
      </div>
      <button onclick="openPrizeModal('${prize.id}')" class="text-xs text-[#5596CE] hover:underline">Edit</button>
    </div>
  `,
    )
    .join("");
}

function populatePrizeFilter() {
  const el = document.getElementById("spin-result-prize-filter");
  if (!el) return;
  const current = el.value;
  el.innerHTML =
    '<option value="">All prizes</option>' +
    allPrizes
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join("");
  el.value = current;
}

function openPrizeModal(prizeId = "") {
  const prize = allPrizes.find((p) => p.id === prizeId);
  document.getElementById("prize-modal-title").textContent = prize
    ? "Edit Prize"
    : "Add Prize";
  document.getElementById("prize-edit-id").value = prize?.id || "";
  document.getElementById("prize-name-input").value = prize?.name || "";
  document.getElementById("prize-active-input").checked =
    prize?.is_active ?? true;
  showModal("modal-prize");
}

async function savePrize() {
  const id = document.getElementById("prize-edit-id").value;
  const name = document.getElementById("prize-name-input").value.trim();
  const isActive = document.getElementById("prize-active-input").checked;
  if (!name) {
    toast("Prize name is required", "error");
    return;
  }
  const payload = {
    name,
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, ""),
    is_active: isActive,
    weight: 1,
    color: "#5596CE",
  };

  loader(true);
  const { error } = await supabaseQuery(
    () =>
      id
        ? db.from("prizes").update(payload).eq("id", id)
        : db.from("prizes").insert(payload),
    id ? "Failed to update prize" : "Failed to create prize",
  );
  loader(false);
  if (error) {
    toast(error.message || "Failed to save prize", "error");
    return;
  }
  toast(id ? "Prize updated" : "Prize added");
  hideModal("modal-prize");
  loadPrizes();
}

async function loadSpinResults() {
  const tbody = document.getElementById("spin-results-tbody");
  if (!tbody) return;
  const search = document.getElementById("spin-result-search")?.value.trim();
  const prizeId = document.getElementById("spin-result-prize-filter")?.value;
  const sort = document.getElementById("spin-result-sort")?.value || "newest";

  let query = db
    .from("spin_submissions")
    .select(
      "id, name, phone, prize_id, prize_name, reference_code, claim_code, status, created_at",
    );
  if (search) {
    const s = search.replace(/[%,]/g, "");
    query = query.or(
      `name.ilike.%${s}%,phone.ilike.%${s}%,prize_name.ilike.%${s}%,reference_code.ilike.%${s}%`,
    );
  }
  if (prizeId) query = query.eq("prize_id", prizeId);
  query =
    sort === "prize"
      ? query.order("prize_name", { ascending: true })
      : query.order("created_at", { ascending: sort === "oldest" });

  const { data, error } = await supabaseQuery(
    () => query.limit(100),
    "Failed to load spin results",
  );
  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500 text-sm">Failed to load spin results</td></tr>';
    return;
  }
  if (!data?.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-4 py-8 text-center text-[#bbb] text-sm">No spin results found</td></tr>';
    return;
  }

  const getStatusBadge = (status) => {
    const badges = {
      pending:
        '<span class="inline-block px-2 py-1 rounded-lg bg-[#FEF3C7] text-[#92400E] text-xs font-medium">Pending</span>',
      approved:
        '<span class="inline-block px-2 py-1 rounded-lg bg-[#DBEAFE] text-[#1E40AF] text-xs font-medium">Approved</span>',
      rejected:
        '<span class="inline-block px-2 py-1 rounded-lg bg-[#FEE2E2] text-[#991B1B] text-xs font-medium">Rejected</span>',
      redeemed:
        '<span class="inline-block px-2 py-1 rounded-lg bg-[#D1FAE5] text-[#065F46] text-xs font-medium">Redeemed</span>',
      expired:
        '<span class="inline-block px-2 py-1 rounded-lg bg-[#FEE2E2] text-[#991B1B] text-xs font-medium">Expired</span>',
    };
    return badges[status] || badges.pending;
  };

  const getActionButton = (row) => {
    if (row.status === "pending") {
      return `<button type="button" data-submission-id="${escapeHtml(row.id)}" class="spin-redeem-button btn-primary text-xs px-3 py-1">Redeem</button>`;
    }
    if (row.status === "redeemed") {
      return '<span class="inline-block px-2 py-1 rounded-lg bg-[#D1FAE5] text-[#065F46] text-xs font-medium">Redeemed</span>';
    }
    if (row.status === "expired") {
      return '<span class="inline-block px-2 py-1 rounded-lg bg-[#FEE2E2] text-[#991B1B] text-xs font-medium">Expired</span>';
    }
    return '<span class="text-[#999] text-xs">—</span>';
  };

  tbody.innerHTML = data
    .map(
      (row) => `
    <tr class="table-row border-b border-[#F5F3EF]">
      <td class="px-4 py-3 text-sm font-medium text-[#222]">${escapeHtml(row.name || "—")}</td>
      <td class="px-4 py-3 text-sm text-[#28547C] font-medium">${escapeHtml(row.prize_name || "—")}</td>
      <td class="px-4 py-3 text-sm text-[#555]">${escapeHtml(row.reference_code || row.claim_code || "—")}</td>
      <td class="px-4 py-3 text-sm">${getStatusBadge(row.status || "pending")}</td>
      <td class="px-4 py-3 text-sm text-[#999]">${fmt.date(row.created_at)}</td>
      <td class="px-4 py-3 text-sm">${getActionButton(row)}</td>
    </tr>
  `,
    )
    .join("");
}

async function redeemPrize(submissionId) {
  if (!confirm("Mark this prize as redeemed?")) return;

  const payload = { status: "redeemed", redeemed_at: new Date().toISOString() };
  console.log("[redeemPrize] submissionId:", submissionId);
  console.log("[redeemPrize] payload:", payload);

  loader(true);
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("spin_submissions")
        .update(payload)
        .eq("id", submissionId)
        .select("id"),
    "Failed to redeem prize",
  );
  loader(false);

  console.log("[redeemPrize] supabase response data:", data);
  console.log("[redeemPrize] supabase response error:", error);

  if (error) {
    console.error("[redeemPrize] Supabase error:", error);
    toast(error.message || "Failed to redeem prize", "error");
    return;
  }

  if (!data || !data.length) {
    console.error(
      "[redeemPrize] No rows returned from update for submissionId:",
      submissionId,
    );
    toast(
      "Unable to redeem this prize. Please refresh and try again.",
      "error",
    );
    return;
  }

  toast("Prize redeemed successfully");
  loadSpinResults();
}

async function exportCSV() {
  loader(true);
  const { data: guests, error } = await supabaseQuery(
    () => db.from("guests").select("*").order("name"),
    "Failed to fetch guests for export",
  );
  loader(false);

  if (error) {
    toast(error.message || "Export failed", "error");
    return;
  }
  if (!guests?.length) {
    toast("No guest data to export", "error");
    return;
  }

  const headers = [
    "Name",
    "Phone",
    "Gender",
    "Birthday",
    "Company",
    "Spending Tier",
    "Food Allergy",
    "Preference",
    "Notes",
    "Created At",
  ];
  const rows = guests.map((g) => [
    g.name,
    g.phone,
    g.gender || "",
    g.birthday || "",
    g.company || "",
    formatSpendingTierLabel(g.spending_tier),
    g.food_allergy || "",
    g.preference || "",
    g.notes || "",
    new Date(g.created_at).toLocaleDateString(
      CURRENT_LANG === "id" ? "id-ID" : "en-GB",
    ),
  ]);

  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export-guests-${TODAY}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("CSV exported");
}

// ============================================================
// QUICK WALK-IN (dashboard card — spreadsheet-speed entry)
// Name + phone + Enter. Table/area/spend can be added later
// from the Walk-Ins page. Reuses existing guest by exact phone.
// ============================================================
let qwSelectedGuest = null; // {id, name, phone} picked from the dropdown
let qwSearchTimeout = null;

function hideQwResults() {
  const el = document.getElementById("qw-results");
  if (el) {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
}

function onQwNameInput() {
  qwSelectedGuest = null; // typing again = no longer the selected guest
  clearTimeout(qwSearchTimeout);
  const term = (document.getElementById("qw-name")?.value || "").trim();
  const resultsEl = document.getElementById("qw-results");
  if (!resultsEl) return;

  if (term.length < 2) {
    hideQwResults();
    return;
  }

  qwSearchTimeout = setTimeout(async () => {
    const { data: guests } = await supabaseQuery(
      () =>
        db
          .from("guests")
          .select("id, name, phone")
          .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
          .order("name")
          .limit(6),
      "Failed to search guests",
    );

    if (!guests?.length) {
      hideQwResults();
      return;
    }

    resultsEl.innerHTML = `
      <div class="rounded-10 border border-[#E0DDD7] bg-white shadow-lg overflow-hidden max-h-[220px] overflow-y-auto">
        ${guests
          .map(
            (g) => `
          <button type="button"
            onclick='selectQwGuest(${JSON.stringify(g).replace(/'/g, "&#39;")})'
            class="w-full text-left px-3 py-2 border-b border-[#F0EDE8] last:border-0 hover:bg-[#F8F6F2] transition-colors">
            <p class="text-sm font-medium text-[#222] truncate">${formatGuestName(g)} ${memberBadge(g.id)}</p>
            ${g.phone ? `<p class="text-xs text-[#999] truncate">${escapeHtml(g.phone)}</p>` : ""}
          </button>`,
          )
          .join("")}
      </div>`;
    resultsEl.classList.remove("hidden");
  }, 300);
}

function selectQwGuest(g) {
  qwSelectedGuest = g;
  const nameEl = document.getElementById("qw-name");
  const phoneEl = document.getElementById("qw-phone");
  if (nameEl) nameEl.value = g.name;
  if (phoneEl) phoneEl.value = g.phone || "";
  hideQwResults();
  document.getElementById("qw-pax")?.focus();
}

async function quickAddWalkIn() {
  const nameEl = document.getElementById("qw-name");
  const phoneEl = document.getElementById("qw-phone");
  const paxEl = document.getElementById("qw-pax");
  const btn = document.getElementById("qw-btn");
  const hint = document.getElementById("qw-hint");

  const name = (nameEl?.value || "").trim();
  const phone = (phoneEl?.value || "").trim() || null;
  const pax = Math.max(1, parseInt(paxEl?.value) || 1);

  if (!name) {
    toast("Guest name is required", "error");
    nameEl?.focus();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }

  hideQwResults();

  try {
    // Priority: guest picked from dropdown > exact phone match > create new
    let guest = null;
    let matchNote = "";
    if (qwSelectedGuest && qwSelectedGuest.name === name) {
      guest = qwSelectedGuest;
      matchNote = " (existing guest)";
    }
    if (!guest && phone) {
      const { data: existing } = await supabaseQuery(
        () => db.from("guests").select("id, name").eq("phone", phone).maybeSingle(),
        "Guest lookup failed",
      );
      if (existing) {
        guest = existing;
        matchNote =
          existing.name.toLowerCase() !== name.toLowerCase()
            ? ` (existing guest: ${existing.name})`
            : " (existing guest)";
      }
    }

    if (!guest) {
      const { data: created, error: gErr } = await supabaseQuery(
        () =>
          db
            .from("guests")
            .insert({ name, phone, created_by: currentStaffId() })
            .select("id, name")
            .single(),
        "Failed to create guest",
      );
      if (gErr || !created) {
        toast("Could not save guest. Try again.", "error");
        return;
      }
      guest = created;
      matchNote = " (new guest)";
    }

    const { error: vErr } = await supabaseQuery(
      () =>
        db.from("visits").insert({
          guest_id: guest.id,
          visit_type: "Walk-In",
          visit_date: TODAY,
          visit_time: getNowTime(),
          pax,
          status: "Active",
          created_by: currentStaffId(),
        }),
      "Failed to create walk-in",
    );
    if (vErr) {
      toast("Guest saved, but walk-in failed. Try again.", "error");
      return;
    }

    const badge = typeof memberBadge === "function" ? memberBadge(guest.id) : "";
    toast(`Walk-in added: ${guestReadingName(guest)}`);
    if (hint) {
      hint.innerHTML = `✓ ${formatGuestName(guest)}${escapeHtml(matchNote)} — ${pax} pax, ${getNowTime()} ${badge}`;
      hint.classList.remove("hidden");
    }

    if (nameEl) nameEl.value = "";
    if (phoneEl) phoneEl.value = "";
    if (paxEl) paxEl.value = "1";
    qwSelectedGuest = null;
    nameEl?.focus();

    invalidateVisitCountCache();
    if (isViewingStaffDashboard()) loadDashboard();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Add";
    }
  }
}

// ============================================================
// SETTINGS (added 2026-07-21)
// Groups Areas + Prizes (moved from main nav) with two new subpages:
//  - settings-menu       : Reservation Configuration (featured dishes)
//  - settings-thresholds : spending tier + membership rules (manager)
// Staff can VIEW Areas and the dish list; every mutation below is
// double-gated: manager-only-ui hides the buttons AND each save/delete
// function re-checks isManagerOrAdmin() (stale-session defense, same
// pattern as void walk-in).
// ============================================================

// ── Shared tab bar (rendered into every [data-settings-tabs]) ─────────
function renderSettingsTabs(activePage) {
  const tabs = [
    { page: "areas", label: t("Areas"), managerOnly: false },
    { page: "settings-menu", label: t("Reservation Form"), managerOnly: false },
    { page: "prizes", label: t("Prizes"), managerOnly: true },
    { page: "settings-thresholds", label: t("Thresholds"), managerOnly: true },
    { page: "settings-branding", label: t("Branding"), managerOnly: true },
    // Staff is admin-only, so it is filtered OUT of the list below rather
    // than hidden with a CSS class. A hidden-but-present tab would still be
    // in the DOM for a manager to find, and this tab decides who can log in.
    { page: "settings-staff", label: t("Staff"), adminOnly: true },
  ].filter((tab) => !tab.adminOnly || currentStaffRole() === "admin");
  const activeCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-[#28547C] text-white transition";
  const idleCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-white text-[#555] border border-[#E6E2DC] hover:bg-[#F8F6F2] transition";
  const html = tabs
    .map(
      (tab) =>
        `<button onclick="navigateTo('${tab.page}')" class="${tab.page === activePage ? activeCls : idleCls}${tab.managerOnly ? " manager-only-ui" : ""}">${tab.label}</button>`,
    )
    .join("");
  document.querySelectorAll("[data-settings-tabs]").forEach((el) => {
    el.innerHTML = `<div class="flex flex-wrap items-center gap-2">${html}</div>`;
  });
  applyManagerOnlyUI();
}

// ── Thresholds subpage (manager-only) ─────────────────────────────────
function renderThresholdSettings() {
  if (!isManagerOrAdmin()) return; // hasAccess() already blocks staff
  const st = APP_SETTINGS.spending_tier || {};
  const mb = APP_SETTINGS.membership || {};
  const fam = mb.Family || {};
  const com = mb.Company || {};
  const rh = APP_SETTINGS.reservation_hours || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("set-high-total", st.high_visit_total ?? HIGH_SPEND_THRESHOLD);
  set("set-high-pax", st.high_per_pax ?? HIGH_SPEND_PER_PAX);
  set("set-sticky-days", st.sticky_days ?? HIGH_SPENDER_STICKY_DAYS);
  set("set-spv", mb.stickers_per_voucher ?? 5);
  set("set-voucher-days", mb.voucher_validity_days ?? 90);
  set("set-fam-min", fam.min_spend ?? 300000);
  set("set-fam-voucher", fam.voucher_amount ?? 100000);
  set("set-fam-cap", fam.cap ?? "");
  set("set-com-min", com.min_spend ?? 2000000);
  set("set-com-voucher", com.voucher_amount ?? 500000);
  set("set-com-cap", com.cap ?? "");
  renderReservationAvailability(rh);
  document.getElementById("settings-recalc-hint")?.classList.add("hidden");
}

// ============================================================
// ONLINE RESERVATION AVAILABILITY
// ============================================================
// Keys "0".."6" are Sunday..Saturday, which is BOTH JavaScript getDay() and
// Postgres extract(dow), so one key set is correct on both sides. Displayed
// Monday first because that is how a restaurant reads a week; the key, not
// the position, is what gets written.
const RES_WEEKDAYS = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" },
];

function renderReservationAvailability(rh) {
  const cfg = rh || {};
  const weekly = cfg.weekly || {};
  const flatOpen = cfg.open || "10:00";
  const flatClose = cfg.close || "21:30";

  const paused = !!cfg.online_paused;
  const pausedEl = document.getElementById("set-res-paused");
  if (pausedEl) pausedEl.checked = paused;
  const msgEl = document.getElementById("set-res-pause-msg");
  if (msgEl) msgEl.value = cfg.pause_message || "";
  onResPausedToggle();

  const leadEl = document.getElementById("set-res-lead-days");
  if (leadEl) leadEl.value = Number.isFinite(+cfg.min_lead_days) ? +cfg.min_lead_days : 0;
  onResLeadDaysInput();

  // Defaults match the numbers that were hardcoded in
  // create_public_reservation before 2026-09-04, so a database that has not
  // been migrated yet still shows the truth rather than a blank box.
  const maxPaxEl = document.getElementById("set-res-max-pax");
  if (maxPaxEl) maxPaxEl.value = Number.isFinite(+cfg.max_pax) ? +cfg.max_pax : 20;
  const maxDaysEl = document.getElementById("set-res-max-days");
  if (maxDaysEl)
    maxDaysEl.value = Number.isFinite(+cfg.max_days_ahead) ? +cfg.max_days_ahead : 90;

  const wrap = document.getElementById("set-res-week");
  if (wrap) {
    wrap.innerHTML = RES_WEEKDAYS.map((d) => {
      // A missing weekday entry is NOT a closed day. Same rule as
      // reservation_hours_for() in the database: a silent "no bookings
      // accepted" is far worse than a wrong-but-visible window.
      const day = weekly[d.key] || {};
      const closed = !!day.closed;
      return `
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 w-40 shrink-0">
          <input type="checkbox" id="set-res-open-${d.key}" ${closed ? "" : "checked"}
                 onchange="onResDayToggle('${d.key}')" />
          <span class="text-sm text-[#333]">${t(d.label)}</span>
        </label>
        <input type="time" id="set-res-from-${d.key}" class="form-input-inline"
               value="${escapeHtml(day.open || flatOpen)}" ${closed ? "disabled" : ""} />
        <span class="text-xs text-[#999]">&rarr;</span>
        <input type="time" id="set-res-to-${d.key}" class="form-input-inline"
               value="${escapeHtml(day.close || flatClose)}" ${closed ? "disabled" : ""} />
        <span id="set-res-closed-${d.key}" class="text-xs text-[#C0392B] ${closed ? "" : "hidden"}">${t("Closed")}</span>
      </div>`;
    }).join("");
  }

  loadReservationExceptions();
}

// ------------------------------------------------------------
// DATED CLOSURES (reservation_exceptions)
// ------------------------------------------------------------
// Saved on their own Add button, NOT with Save Settings. Two save buttons on
// one screen is a trap: whichever one you press, half your edits are gone.
let reservationExceptions = [];

async function loadReservationExceptions() {
  const list = document.getElementById("set-exc-list");
  if (!list) return;
  const { data } = await supabaseQuery(
    () =>
      db
        .from("reservation_exceptions")
        .select("*")
        .gte("exception_date", ymd(new Date()))
        .order("exception_date"),
    "Failed to load dated closures",
  );
  // Past dates are deliberately not listed. They can no longer affect a
  // booking, and a year of stale holidays would bury the two that matter.
  reservationExceptions = data || [];
  renderReservationExceptions();
}

function renderReservationExceptions() {
  const list = document.getElementById("set-exc-list");
  if (!list) return;
  if (!reservationExceptions.length) {
    list.innerHTML = `<p class="text-xs text-[#999]">${t("No dated closures. The weekly hours above apply to every date.")}</p>`;
    return;
  }
  list.innerHTML = reservationExceptions
    .map(
      (e) => `
    <div class="flex flex-wrap items-center gap-3 py-2 border-b border-[#F1EEE8] last:border-0">
      <span class="text-sm font-medium text-[#333] w-40 shrink-0">${fmt.date(e.exception_date)}</span>
      <span class="text-xs px-2 py-0.5 rounded-full ${
        e.closed_all_day
          ? "bg-[#FDEDEC] text-[#C0392B]"
          : "bg-[#EEF4FD] text-[#1F4E79]"
      }">${
        e.closed_all_day
          ? t("Closed all day")
          : `${(e.open_time || "").slice(0, 5)} → ${(e.close_time || "").slice(0, 5)}`
      }</span>
      <span class="text-xs text-[#777] flex-1 min-w-[120px]">${escapeHtml(e.reason || "")}</span>
      <button onclick="deleteReservationException('${e.exception_date}')"
              class="text-xs text-[#C0392B] hover:underline">${t("Remove")}</button>
    </div>`,
    )
    .join("");
}

function onExceptionModeChange() {
  const mode = document.getElementById("set-exc-mode")?.value;
  document.getElementById("set-exc-hours")?.classList.toggle("hidden", mode !== "hours");
}

async function saveReservationException() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  const err = document.getElementById("set-exc-error");
  if (err) err.textContent = "";
  const date = document.getElementById("set-exc-date")?.value || "";
  const mode = document.getElementById("set-exc-mode")?.value || "closed";
  const open = document.getElementById("set-exc-open")?.value || "";
  const close = document.getElementById("set-exc-close")?.value || "";
  const reason = (document.getElementById("set-exc-reason")?.value || "").trim() || null;
  const fail = (m) => {
    if (err) err.textContent = t(m);
    return null;
  };

  if (!date) return fail("Pick a date.");
  // A closure in the past cannot change any booking, and setting one is
  // almost always a mistyped year.
  if (date < ymd(new Date())) return fail("That date has already passed.");
  if (mode === "hours") {
    if (!open || !close) return fail("Set both an opening and a last booking time.");
    if (open >= close) return fail("Last booking must be after opening.");
  }

  // Computed here rather than inline in the object below. A ternary in an
  // object value (`open_time: mode === "hours" ? open : null`) makes
  // scripts/schema-refs.js read the ternary's own `open :` as a column name,
  // and schema-check then demands a `reservation_exceptions.open` column that
  // will never exist. Keeping values simple keeps that scanner honest.
  const closedAllDay = mode === "closed";
  const openTime = closedAllDay ? null : open;
  const closeTime = closedAllDay ? null : close;

  // The date is the primary key, so re-adding a date REPLACES it rather than
  // creating a second contradictory row for the same day.
  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db.from("reservation_exceptions").upsert(
        {
          exception_date: date,
          closed_all_day: closedAllDay,
          open_time: openTime,
          close_time: closeTime,
          reason,
        },
        { onConflict: "exception_date" },
      ),
    "Failed to save the dated closure",
  );
  loader(false);
  if (error) return fail("Could not save. Try again.");

  document.getElementById("set-exc-date").value = "";
  document.getElementById("set-exc-reason").value = "";
  toast(t("Date saved"), "success");
  loadReservationExceptions();
}

async function deleteReservationException(date) {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  if (!confirm(t("Remove this dated closure? The weekly hours will apply to that date again."))) return;
  loader(true);
  const { error } = await supabaseQuery(
    () => db.from("reservation_exceptions").delete().eq("exception_date", date),
    "Failed to remove the dated closure",
  );
  loader(false);
  if (error) {
    toast(t("Could not remove it. Try again."), "error");
    return;
  }
  toast(t("Removed"), "success");
  loadReservationExceptions();
}

function onResPausedToggle() {
  const on = !!document.getElementById("set-res-paused")?.checked;
  document.getElementById("set-res-pause-wrap")?.classList.toggle("hidden", !on);
}

// Spelling out what the number means beats a label. "1" reading as "one day's
// notice" or as "from tomorrow" are the same thing said two ways, and staff
// read it differently depending on the day they are having.
function onResLeadDaysInput() {
  const el = document.getElementById("set-res-lead-days");
  const hint = document.getElementById("set-res-lead-hint");
  if (!hint) return;
  const n = parseInt(el?.value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    hint.textContent = t("0 means guests can book for today.");
  } else if (n === 1) {
    hint.textContent = t("Guests cannot book for today. Tomorrow is the earliest.");
  } else {
    hint.textContent = t("Guests must book at least") + " " + n + " " + t("days ahead.");
  }
}

function onResDayToggle(key) {
  const open = !!document.getElementById(`set-res-open-${key}`)?.checked;
  ["from", "to"].forEach((part) => {
    const el = document.getElementById(`set-res-${part}-${key}`);
    if (el) el.disabled = !open;
  });
  document.getElementById(`set-res-closed-${key}`)?.classList.toggle("hidden", open);
}

// Reads the grid back into the stored shape, and derives the flat open/close
// pair as the WIDEST window across the open days.
//
// The flat pair must keep existing: js/notify.js reads it to decide when the
// D-1 reminder starts, and a guest page built before this change reads it to
// build its time dropdown. Neither knows about `weekly`. Widest-window means
// that dropdown is a superset, so no genuinely bookable slot is ever hidden;
// the narrower per-day rule is enforced in the database, which is the real
// gate.
//
// Returns null and shows the reason if the grid is unusable.
function readReservationWeek() {
  const weekly = {};
  let widestOpen = null;
  let widestClose = null;
  let openDays = 0;

  for (const d of RES_WEEKDAYS) {
    const isOpen = !!document.getElementById(`set-res-open-${d.key}`)?.checked;
    const from = document.getElementById(`set-res-from-${d.key}`)?.value || "";
    const to = document.getElementById(`set-res-to-${d.key}`)?.value || "";
    if (!isOpen) {
      weekly[d.key] = { closed: true };
      continue;
    }
    if (!from || !to) {
      toast(`${t(d.label)}: ${t("set both an opening and a last booking time")}`, "error");
      return null;
    }
    if (from >= to) {
      toast(`${t(d.label)}: ${t("last booking must be after opening")}`, "error");
      return null;
    }
    weekly[d.key] = { closed: false, open: from, close: to };
    openDays++;
    if (widestOpen === null || from < widestOpen) widestOpen = from;
    if (widestClose === null || to > widestClose) widestClose = to;
  }

  // Refused rather than saved. All seven closed nulls the derived pair, which
  // breaks the D-1 reminder and the guest time dropdown, and switches online
  // booking off permanently with no error anywhere for anyone to notice.
  if (openDays === 0) {
    toast(
      t("You cannot close all seven days. To stop taking bookings, use the pause switch above."),
      "error",
    );
    return null;
  }

  return { weekly, open: widestOpen, close: widestClose };
}

function settingsNum(id) {
  const v = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(v) ? v : null;
}

async function saveThresholdSettings() {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can change settings", "error");
    return;
  }
  const highTotal = settingsNum("set-high-total");
  const highPax = settingsNum("set-high-pax");
  const stickyDays = settingsNum("set-sticky-days");
  const spv = settingsNum("set-spv");
  const voucherDays = settingsNum("set-voucher-days");
  const famMin = settingsNum("set-fam-min");
  const famVoucher = settingsNum("set-fam-voucher");
  const famCap = settingsNum("set-fam-cap"); // empty = no cap
  const comMin = settingsNum("set-com-min");
  const comVoucher = settingsNum("set-com-voucher");
  const comCap = settingsNum("set-com-cap");
  // Returns null (having said why) when the grid is unusable, so the save
  // has to bail before it writes anything.
  const resWeek = readReservationWeek();
  if (!resWeek) return;
  const resLead = Math.max(0, Math.min(90, parseInt(document.getElementById("set-res-lead-days")?.value, 10) || 0));
  // Clamped, and falling back to the old hardcoded values rather than to 0.
  // A cleared box meaning "no party may be larger than nobody" would take
  // online booking offline with nothing on screen explaining it.
  const resMaxPax = Math.max(
    1,
    Math.min(500, parseInt(document.getElementById("set-res-max-pax")?.value, 10) || 20),
  );
  const resMaxDays = Math.max(
    1,
    Math.min(730, parseInt(document.getElementById("set-res-max-days")?.value, 10) || 90),
  );
  const resPaused = !!document.getElementById("set-res-paused")?.checked;
  const resPauseMsg = (document.getElementById("set-res-pause-msg")?.value || "").trim() || null;

  // These numbers drive money logic — validate strictly, reject silently
  // fixing anything. First problem is shown to the manager.
  const problems = [];
  if (!(highTotal > 0)) problems.push(t("High spender visit total must be > 0"));
  if (!(highPax > 0)) problems.push(t("High spender per-pax must be > 0"));
  if (highTotal > 0 && highPax > 0 && highPax > highTotal)
    problems.push(t("Per-pax threshold should not exceed the visit total threshold"));
  if (!(stickyDays >= 1)) problems.push(t("Sticky days must be at least 1"));
  if (!(spv >= 1) || !Number.isInteger(spv))
    problems.push(t("Stickers per voucher must be a whole number of at least 1"));
  // The DB trigger stamps expires_at from this number. A zero or a typo
  // like 9 would print already-dead vouchers, so it is validated here as
  // strictly as the money fields.
  if (!(voucherDays >= 1) || !Number.isInteger(voucherDays) || voucherDays > 1825)
    problems.push(t("Voucher validity must be a whole number between 1 and 1825 days"));
  if (!(famMin > 0) || !(famVoucher > 0))
    problems.push(t("Family minimum and voucher must be > 0"));
  if (!(comMin > 0) || !(comVoucher > 0))
    problems.push(t("Company minimum and voucher must be > 0"));
  if (famCap !== null && (!Number.isInteger(famCap) || famCap < 1))
    problems.push(t("Family cap must be a whole number of at least 1, or empty for no cap"));
  if (comCap !== null && (!Number.isInteger(comCap) || comCap < 1))
    problems.push(t("Company cap must be a whole number of at least 1, or empty for no cap"));
  if (!resOpen || !resClose) problems.push(t("Online reservation hours are required"));
  else if (resOpen >= resClose)
    problems.push(t("Online reservation: open time must be before last booking time"));
  if (problems.length) {
    toast(problems[0], "error");
    return;
  }

  const existingMb = APP_SETTINGS.membership || {};
  const rows = [
    {
      key: "spending_tier",
      value: {
        high_visit_total: highTotal,
        high_per_pax: highPax,
        sticky_days: stickyDays,
      },
      updated_at: new Date().toISOString(),
    },
    {
      key: "membership",
      value: {
        stickers_per_voucher: spv,
        // Must be written back on every save: this object REPLACES the
        // whole membership setting, so leaving it out would silently wipe
        // the voucher expiry rule and reset it to the 90-day default.
        voucher_validity_days: voucherDays,
        Family: {
          label: existingMb.Family?.label ?? "Family Card",
          min_spend: famMin,
          voucher_amount: famVoucher,
          cap: famCap,
        },
        Company: {
          label: existingMb.Company?.label ?? "Company Card",
          min_spend: comMin,
          voucher_amount: comVoucher,
          cap: comCap,
        },
      },
      updated_at: new Date().toISOString(),
    },
    {
      key: "reservation_hours",
      // Spread the EXISTING value first. Writing a fresh object here is how
      // this row previously lost anything it did not know about; the day this
      // key gained more fields, a plain { open, close } write would have
      // silently wiped the weekly grid, the lead time and the pause on every
      // save of an unrelated setting.
      value: {
        ...(APP_SETTINGS.reservation_hours || {}),
        open: resWeek.open,
        close: resWeek.close,
        weekly: resWeek.weekly,
        min_lead_days: resLead,
        max_pax: resMaxPax,
        max_days_ahead: resMaxDays,
        online_paused: resPaused,
        pause_message: resPauseMsg,
      },
      updated_at: new Date().toISOString(),
    },
  ];

  loader(true);
  const { error } = await supabaseQuery(
    () => db.from("app_settings").upsert(rows),
    "Failed to save settings",
  );
  loader(false);
  if (error) {
    toast(error.message || t("Unable to save settings"), "error");
    return;
  }

  await loadAppSettings();
  toast(t("Settings saved"));
  // New tier thresholds only apply when a guest's visits change —
  // surface the recalc option so the manager can apply them now.
  document.getElementById("settings-recalc-hint")?.classList.remove("hidden");
}

async function recalcAllTiersNow() {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can do this", "error");
    return;
  }
  if (
    !confirm(
      t(
        "Recalculate the spending tier of every auto-tier guest using the current thresholds?",
      ),
    )
  )
    return;
  loader(true);
  const { data, error } = await supabaseQuery(
    () => db.rpc("recalc_all_tiers"),
    "Failed to recalculate tiers",
  );
  loader(false);
  if (error) {
    toast(error.message || t("Unable to recalculate tiers"), "error");
    return;
  }
  toast(
    CURRENT_LANG === "id"
      ? `Tier dihitung ulang untuk ${data?.recalculated ?? "semua"} tamu`
      : `Tiers recalculated for ${data?.recalculated ?? "all"} guests`,
  );
  document.getElementById("settings-recalc-hint")?.classList.add("hidden");
}

// ── Reservation Configuration subpage (featured dishes) ───────────────
const DISH_IMAGE_BUCKET = "dish-images";
const DISH_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // keep in sync with bucket limit
let allDishes = [];

async function loadFeaturedDishes() {
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("featured_dishes")
        .select("*")
        .order("category")
        .order("display_order")
        .order("created_at"),
    "Failed to load featured dishes",
  );
  if (error) {
    const msg = `<p class="text-sm text-[#bbb]">${t("Unable to load dishes. Check the connection and try again.")}</p>`;
    ["dishes-signature", "dishes-chef", "dishes-bestseller"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = msg;
    });
    return;
  }
  allDishes = data || [];
  // One shared set of dishes, feeds both reserve.html and the landing page.
  renderDishList("signature", "dishes-signature");
  renderDishList("chef_recommendation", "dishes-chef");
  renderDishList("best_seller", "dishes-bestseller");
  applyManagerOnlyUI();
}

function renderDishList(category, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const dishes = allDishes.filter((d) => d.category === category);
  if (!dishes.length) {
    el.innerHTML = `<p class="text-sm text-[#bbb] py-4 text-center">${t("No dishes yet. Add one so guests see it when reserving online.")}</p>`;
    return;
  }
  el.innerHTML = dishes
    .map((d) => {
      const img = d.image_url
        ? `<img src="${escapeHtml(d.image_url)}" alt="${escapeHtml(d.name)}" class="w-16 h-16 rounded-10 object-cover flex-shrink-0 border border-[#EDE9E3]" loading="lazy" />`
        : `<div class="w-16 h-16 rounded-10 bg-[#F3F0EA] flex items-center justify-center flex-shrink-0 text-xl">🍽️</div>`;
      const inactiveBadge = d.is_active
        ? ""
        : `<span class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#E7E4DE] text-[#999]">${t("Hidden")}</span>`;
      return `
      <div class="flex items-start gap-3 p-3 rounded-10 border border-[#EDE9E3] ${d.is_active ? "" : "opacity-60"}">
        ${img}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="text-sm font-semibold text-[#333] truncate">${escapeHtml(d.name)}</p>
            ${inactiveBadge}
          </div>
          <p class="text-xs text-[#777] mt-0.5 line-clamp-2">${d.description ? escapeHtml(d.description) : `<span class="text-[#bbb]">${t("No description")}</span>`}</p>
          <div class="flex items-center gap-3 mt-1.5 manager-only-ui">
            <button onclick="openDishModal('${d.id}')" class="text-xs text-[#5596CE] hover:underline">${t("Edit")}</button>
            <button onclick="toggleDishActive('${d.id}')" class="text-xs text-[#8B6F47] hover:underline">${d.is_active ? t("Hide") : t("Show")}</button>
            <button onclick="deleteDish('${d.id}')" class="text-xs text-red-400 hover:text-red-600">${t("Delete")}</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function openDishModal(dishId = "") {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can manage dishes", "error");
    return;
  }
  const dish = dishId ? allDishes.find((d) => d.id === dishId) : null;
  document.getElementById("dish-edit-id").value = dish?.id || "";
  document.getElementById("dish-modal-title").textContent = dish
    ? t("Edit Dish")
    : t("Add Dish");
  document.getElementById("dish-name").value = dish?.name || "";
  document.getElementById("dish-category").value =
    dish?.category || "signature";
  document.getElementById("dish-description").value = dish?.description || "";
  document.getElementById("dish-active").checked = dish ? !!dish.is_active : true;
  const fileInput = document.getElementById("dish-image");
  if (fileInput) fileInput.value = "";
  const preview = document.getElementById("dish-image-preview");
  if (preview) {
    if (dish?.image_url) {
      preview.src = dish.image_url;
      preview.classList.remove("hidden");
    } else {
      preview.src = "";
      preview.classList.add("hidden");
    }
  }
  showModal("modal-dish");
}

function previewDishImage() {
  const file = document.getElementById("dish-image")?.files?.[0];
  const preview = document.getElementById("dish-image-preview");
  if (!file || !preview) return;
  const problem = validateDishImage(file);
  if (problem) {
    toast(problem, "error");
    document.getElementById("dish-image").value = "";
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
}

function validateDishImage(file) {
  const okTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!okTypes.includes(file.type))
    return t("Photo must be JPG, PNG or WebP");
  if (file.size > DISH_IMAGE_MAX_BYTES)
    return t("Photo is too large (max 2 MB). Resize it and try again.");
  return null;
}

async function saveDish() {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can manage dishes", "error");
    return;
  }
  const dishId = document.getElementById("dish-edit-id").value;
  const name = document.getElementById("dish-name").value.trim();
  const category = document.getElementById("dish-category").value;
  const description = document
    .getElementById("dish-description")
    .value.trim();
  const isActive = document.getElementById("dish-active").checked;
  const file = document.getElementById("dish-image")?.files?.[0] || null;

  if (name.length < 2) {
    toast(t("Dish name is required (min 2 characters)"), "error");
    return;
  }
  if (!["signature", "chef_recommendation", "best_seller"].includes(category)) {
    toast(t("Pick a category"), "error");
    return;
  }
  if (file) {
    const problem = validateDishImage(file);
    if (problem) {
      toast(problem, "error");
      return;
    }
  }

  const btn = document.getElementById("dish-save-button");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("Saving...");
  }

  try {
    const existing = dishId ? allDishes.find((d) => d.id === dishId) : null;
    let imageUrl = existing?.image_url || null;

    // Upload first; only touch the table once the image is safely stored.
    if (file) {
      const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
      const path = `dish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await db.storage
        .from(DISH_IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        toast(upErr.message || t("Photo upload failed. Please try again."), "error");
        return;
      }
      const { data: pub } = db.storage
        .from(DISH_IMAGE_BUCKET)
        .getPublicUrl(path);
      imageUrl = pub?.publicUrl || null;
    }

    const payload = {
      name,
      category,
      description: description || null,
      image_url: imageUrl,
      is_active: isActive,
    };

    const { error } = await supabaseQuery(
      () =>
        dishId
          ? db.from("featured_dishes").update(payload).eq("id", dishId)
          : db.from("featured_dishes").insert(payload),
      "Failed to save dish",
    );
    if (error) {
      toast(error.message || t("Failed to save dish"), "error");
      return;
    }

    // Replaced the photo? Best-effort cleanup of the old file — never
    // block the save on storage housekeeping.
    if (file && existing?.image_url && existing.image_url !== imageUrl) {
      removeDishImageByUrl(existing.image_url);
    }

    hideModal("modal-dish");
    toast(dishId ? t("Dish updated") : t("Dish added"));
    loadFeaturedDishes();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("Save Dish");
    }
  }
}

async function toggleDishActive(dishId) {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can manage dishes", "error");
    return;
  }
  const dish = allDishes.find((d) => d.id === dishId);
  if (!dish) return;
  const { error } = await supabaseQuery(
    () =>
      db
        .from("featured_dishes")
        .update({ is_active: !dish.is_active })
        .eq("id", dishId),
    "Failed to update dish",
  );
  if (error) {
    toast(t("Failed to update dish. Please try again."), "error");
    return;
  }
  toast(dish.is_active ? t("Dish hidden from guests") : t("Dish visible to guests"));
  loadFeaturedDishes();
}

async function deleteDish(dishId) {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can manage dishes", "error");
    return;
  }
  const dish = allDishes.find((d) => d.id === dishId);
  if (!dish) return;
  const msg =
    CURRENT_LANG === "id"
      ? `Hapus "${dish.name}" secara permanen? Untuk menyembunyikan sementara dari tamu, gunakan tombol Sembunyikan.`
      : `Permanently delete "${dish.name}"? To temporarily hide it from guests, use Hide instead.`;
  if (!confirm(msg)) return;
  const { error } = await supabaseQuery(
    () => db.from("featured_dishes").delete().eq("id", dishId),
    "Failed to delete dish",
  );
  if (error) {
    toast(t("Failed to delete dish. Please try again."), "error");
    return;
  }
  if (dish.image_url) removeDishImageByUrl(dish.image_url);
  toast(t("Dish deleted"));
  loadFeaturedDishes();
}

// Best-effort: extract the object path from a public URL and remove it.
// Failures are logged, never surfaced — orphaned images are harmless.
function removeDishImageByUrl(url) {
  try {
    const marker = `/object/public/${DISH_IMAGE_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(url.slice(idx + marker.length));
    db.storage
      .from(DISH_IMAGE_BUCKET)
      .remove([path])
      .catch((e) => console.warn("dish image cleanup failed", e));
  } catch (e) {
    console.warn("dish image cleanup failed", e);
  }
}

// ── Full Menu link (shared by reserve.html + landing page) ───────────
// Dish lists (Signature / Chef's Special / Best Seller) are rendered by
// loadFeaturedDishes() above. This part just handles the one shared
// setting: where the "View Full Menu" / "Lihat Menu Lengkap" button
// points on BOTH public pages.
function renderFullMenuLink() {
  const fm = APP_SETTINGS.full_menu || {};
  const el = document.getElementById("set-full-menu-url");
  if (el) el.value = fm.url ?? "";
}

async function saveFullMenuLink() {
  if (!isManagerOrAdmin()) {
    toast("Only a manager can change settings", "error");
    return;
  }
  const url = document.getElementById("set-full-menu-url")?.value.trim() || "";
  if (url && !/^https?:\/\//i.test(url)) {
    toast(t("Full menu link must start with http:// or https://"), "error");
    return;
  }

  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db.from("app_settings").upsert({
        key: "full_menu",
        value: { url },
        updated_at: new Date().toISOString(),
      }),
    "Failed to save settings",
  );
  loader(false);
  if (error) {
    toast(error.message || t("Unable to save settings"), "error");
    return;
  }

  await loadAppSettings();
  toast(t("Settings saved"));
}


// ============================================================
// SETTINGS: BRANDING (manager+)
// ============================================================
// Uploads the client's own logo so one codebase can serve every restaurant
// without a per-client fork of the HTML. The reading side (fallbacks, the
// data-brand-logo swap, what this deliberately does NOT cover) lives in
// config.template.js under "BRANDING".
const BRAND_MAX_BYTES = 2 * 1024 * 1024; // keep in sync with the bucket limit

// The voucher card is a fixed-size canvas: the PNG is drawn at exactly these
// dimensions and every text position below the header is measured against
// them. A background of a different shape does not crop, it stretches.
const VOUCHER_BG_W = 1084;
const VOUCHER_BG_H = 1940;

const BRAND_SLOTS = {
  full: { key: "logo_url", input: "brand-file-full", prefix: "logo" },
  small: { key: "small_logo_url", input: "brand-file-small", prefix: "mark" },
  // Still here so brandAsset("voucher") and the upload helpers keep working.
  // Its UI card moved to Settings > Vouchers > Card Design (2026-08-23) —
  // it is not a logo, and it belongs next to the colours it overrides.
  voucher: { key: "voucher_bg_url", input: "vch-artwork-file", prefix: "voucher-bg" },
};

function renderBrandingSettings() {
  if (!isManagerOrAdmin()) return; // hasAccess() already blocks staff
  // Only the two logo slots have UI on this page. The voucher slot is still
  // in BRAND_SLOTS (brandAsset and the upload helpers use it) but its card
  // lives under Vouchers > Card Design, so iterating it here would hunt for
  // elements that are not on this page.
  ["full", "small"].forEach((slot) => {
    const url = brandAsset(slot);
    const img = document.getElementById(`brand-preview-${slot}`);
    if (img && url) img.src = url;
    const state = document.getElementById(`brand-state-${slot}`);
    if (state) {
      const custom = brandUrlOk(BRANDING && BRANDING[BRAND_SLOTS[slot].key]);
      state.textContent = custom ? t("Custom image") : t("Default image");
      state.className = custom
        ? "text-[11px] font-semibold text-[#28547C]"
        : "text-[11px] text-[#999]";
    }
    const reset = document.getElementById(`brand-reset-${slot}`);
    if (reset)
      reset.classList.toggle(
        "hidden",
        !brandUrlOk(BRANDING && BRANDING[BRAND_SLOTS[slot].key]),
      );
    const input = document.getElementById(BRAND_SLOTS[slot].input);
    if (input) input.value = "";
  });
}

function validateBrandFile(file) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type))
    return t("Use a JPG, PNG or WebP file. SVG is not accepted.");
  if (file.size > BRAND_MAX_BYTES) return t("Image must be under 2 MB.");
  return null;
}

// Reads the real pixel size before upload. Used only to WARN: a logo has no
// one correct size, but a voucher background of the wrong shape produces a
// visibly stretched card and it is worth one confirm() to prevent that.
function readImageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function uploadBrandImage(slot) {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  const conf = BRAND_SLOTS[slot];
  if (!conf) return;
  const file = document.getElementById(conf.input)?.files?.[0];
  if (!file) {
    toast(t("Pick an image file first"), "error");
    return;
  }
  const problem = validateBrandFile(file);
  if (problem) {
    toast(problem, "error");
    return;
  }

  if (slot === "voucher") {
    const size = await readImageSize(file);
    if (size && (size.w !== VOUCHER_BG_W || size.h !== VOUCHER_BG_H)) {
      const msg =
        CURRENT_LANG === "id"
          ? `Gambar ini ${size.w}x${size.h} piksel. Kartu voucher digambar pada ${VOUCHER_BG_W}x${VOUCHER_BG_H}, jadi ukuran lain akan tertarik/gepeng, bukan terpotong. Tetap unggah?`
          : `This image is ${size.w}x${size.h} pixels. The voucher card is drawn at ${VOUCHER_BG_W}x${VOUCHER_BG_H}, so a different size stretches rather than crops. Upload anyway?`;
      if (!confirm(msg)) return;
    }
  }

  const btn = document.getElementById(`brand-upload-${slot}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("Uploading...");
  }
  loader(true);
  try {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
      file.type
    ];
    // Timestamped filename, never a fixed one. Overwriting a fixed path would
    // leave the old image in every browser cache and in WhatsApp's preview
    // cache, so the change would look like it silently did not happen.
    const path = `${conf.prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const { error: upErr } = await db.storage
      .from(BRAND_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      toast(upErr.message || t("Upload failed. Please try again."), "error");
      return;
    }
    const { data: pub } = db.storage.from(BRAND_BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl || null;
    if (!brandUrlOk(url)) {
      toast(t("Upload failed. Please try again."), "error");
      return;
    }

    const previous = BRANDING ? BRANDING[conf.key] : null;
    const saved = await saveBrandingValue(conf.key, url);
    if (!saved) return;

    // Best-effort cleanup of the replaced file. Never block on it: an
    // orphaned image in storage is harmless, a failed save is not.
    if (brandUrlOk(previous)) removeBrandImageByUrl(previous);
    toast(t("Logo updated"));
  } finally {
    loader(false);
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("Upload");
    }
  }
}

async function resetBrandImage(slot) {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  const conf = BRAND_SLOTS[slot];
  if (!conf) return;
  if (!confirm(t("Go back to the built-in image?"))) return;
  const previous = BRANDING ? BRANDING[conf.key] : null;
  loader(true);
  const saved = await saveBrandingValue(conf.key, null);
  loader(false);
  if (!saved) return;
  if (brandUrlOk(previous)) removeBrandImageByUrl(previous);
  toast(t("Back to the built-in image"));
}

// Writes ONE key of the branding row, re-reading the row first so two people
// editing different slots at the same time cannot wipe each other's upload.
// Returns true on success.
async function saveBrandingValue(key, url) {
  const { data: fresh } = await supabaseQuery(
    () =>
      db.from("app_settings").select("value").eq("key", "branding").maybeSingle(),
    "Failed to read branding settings",
  );
  const value = { ...((fresh && fresh.value) || {}), [key]: url };
  const { error } = await supabaseQuery(
    () =>
      db.from("app_settings").upsert({
        key: "branding",
        value,
        updated_at: new Date().toISOString(),
      }),
    "Failed to save branding",
  );
  if (error) {
    toast(error.message || t("Unable to save settings"), "error");
    return false;
  }
  await loadAppSettings(); // refreshes APP_SETTINGS, BRANDING and the visible logos
  renderBrandingSettings();
  return true;
}

function removeBrandImageByUrl(url) {
  try {
    const marker = `/object/public/${BRAND_BUCKET}/`;
    const idx = String(url).indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(String(url).slice(idx + marker.length));
    db.storage
      .from(BRAND_BUCKET)
      .remove([path])
      .catch((e) => console.warn("branding cleanup failed", e));
  } catch (e) {
    console.warn("branding cleanup failed", e);
  }
}

// ============================================================
// SETTINGS: STAFF CONFIGURATION (admin only)
// ============================================================
// Creates the accounts the front desk logs in with. Admin-only because this
// screen sets roles, and a manager who could set roles could promote
// themselves, which would make the whole role system decorative.
//
// TWO THINGS THIS SCREEN DOES NOT DO, both on purpose:
//
// 1. No delete. staff_users.id is a foreign key on visits, walk-ins,
//    reservations, vouchers and campaign logs. Deleting a leaver would either
//    fail or orphan a year of "who served this table". Deactivate instead:
//    the account cannot log in, and the history keeps their name.
//
// 2. No security. PINs are plain text and the anon key is public, exactly as
//    everywhere else in this app. This screen makes staff management possible
//    for the owner; it does not make it safe. See CLAUDE.md, "Must be fixed
//    before the first sale".
const STAFF_ROLES = ["staff", "manager", "admin"];
let allStaffUsers = [];

function staffRoleLabel(role) {
  return role === "admin" ? t("Admin") : role === "manager" ? t("Manager") : t("Staff");
}

async function loadStaffUsers() {
  if (currentStaffRole() !== "admin") return; // hasAccess() already blocks the rest
  const listEl = document.getElementById("staff-list");
  if (listEl) listEl.innerHTML = '<div class="loading-skeleton h-20"></div>';
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("staff_users")
        .select("id, username, display_name, role, is_active, created_at")
        .order("is_active", { ascending: false })
        .order("display_name"),
    "Failed to load staff",
  );
  if (error) {
    if (listEl)
      listEl.innerHTML = `<p class="text-sm text-[#B23B3B]">${t("Could not load the staff list. Check the connection and try again.")}</p>`;
    return;
  }
  allStaffUsers = data || [];
  renderStaffUsers();
}

// Counts the admins who can still log in. The UI uses this to refuse the
// action that would leave nobody able to reach this screen; the database
// trigger refuses it again, because this check runs in public JavaScript.
function activeAdminCount(excludeId) {
  return allStaffUsers.filter(
    (u) => u.role === "admin" && u.is_active && u.id !== excludeId,
  ).length;
}

function renderStaffUsers() {
  const listEl = document.getElementById("staff-list");
  if (!listEl) return;
  if (!allStaffUsers.length) {
    listEl.innerHTML = `<p class="text-sm text-[#999]">${t("No staff accounts yet.")}</p>`;
    return;
  }
  const me = currentStaffId();
  listEl.innerHTML = allStaffUsers
    .map((u) => {
      const isMe = u.id === me;
      const badge =
        u.role === "admin"
          ? "bg-[#8B5E3C] text-white"
          : u.role === "manager"
            ? "bg-[#28547C] text-white"
            : "bg-[#E7E4DE] text-[#555]";
      return `
        <div class="flex items-center justify-between gap-3 py-3 border-b border-[#EDE9E3] last:border-0 ${u.is_active ? "" : "opacity-60"}">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-[#333]">${escapeHtml(u.display_name)}</span>
              <span class="inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full ${badge}">${staffRoleLabel(u.role)}</span>
              ${isMe ? `<span class="text-[11px] text-[#999]">${t("(you)")}</span>` : ""}
              ${u.is_active ? "" : `<span class="text-[11px] font-semibold text-[#B23B3B]">${t("Inactive")}</span>`}
            </div>
            <div class="text-xs text-[#999] mt-0.5">${escapeHtml(u.username)}</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="openStaffModal('${u.id}')" class="btn-ghost text-xs px-3 py-1.5">${t("Edit")}</button>
            <button onclick="toggleStaffActive('${u.id}')" class="btn-ghost text-xs px-3 py-1.5">${u.is_active ? t("Deactivate") : t("Activate")}</button>
          </div>
        </div>`;
    })
    .join("");
}

function openStaffModal(staffId) {
  if (currentStaffRole() !== "admin") {
    toast(t("Only an admin can manage staff"), "error");
    return;
  }
  const user = staffId ? allStaffUsers.find((u) => u.id === staffId) : null;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("staff-form-id", user ? user.id : "");
  set("staff-form-name", user ? user.display_name : "");
  set("staff-form-username", user ? user.username : "");
  set("staff-form-pin", "");
  set("staff-form-role", user ? user.role : "staff");

  const title = document.getElementById("staff-modal-title");
  if (title) title.textContent = user ? t("Edit Staff") : t("Add Staff");
  const pinHint = document.getElementById("staff-form-pin-hint");
  if (pinHint)
    pinHint.textContent = user
      ? t("Leave blank to keep the current PIN.")
      : t("Exactly 4 digits. The staff member types this to log in.");

  // Username is the login key and changing it silently locks someone out of
  // a shift, so it is set once at creation and read-only afterwards.
  const usernameEl = document.getElementById("staff-form-username");
  if (usernameEl) usernameEl.readOnly = !!user;
  const usernameNote = document.getElementById("staff-form-username-note");
  if (usernameNote) usernameNote.classList.toggle("hidden", !user);

  // Demoting yourself out of admin is how an owner loses their own system.
  const roleEl = document.getElementById("staff-form-role");
  const isSelf = !!user && user.id === currentStaffId();
  if (roleEl) roleEl.disabled = isSelf;
  const roleNote = document.getElementById("staff-form-role-self-note");
  if (roleNote) roleNote.classList.toggle("hidden", !isSelf);

  showModal("modal-staff");
}

// 0000, 1111, 1234, 4321 and friends. Not blocked, because the owner knows
// their own restaurant better than this function does, but worth one prompt:
// a guessable PIN on a shared front-desk PC is how one person's login ends up
// recording another person's shift.
function isWeakPin(pin) {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const digits = pin.split("").map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

async function saveStaffUser() {
  if (currentStaffRole() !== "admin") {
    toast(t("Only an admin can manage staff"), "error");
    return;
  }
  const staffId = document.getElementById("staff-form-id")?.value || "";
  const displayName =
    document.getElementById("staff-form-name")?.value.trim() || "";
  // Lowercased on the way in, because login compares the username EXACTLY.
  // "Rina" typed at the login screen would never match "rina" in the table,
  // and the front desk would blame the PIN.
  const username =
    document.getElementById("staff-form-username")?.value.trim().toLowerCase() || "";
  const pin = document.getElementById("staff-form-pin")?.value.trim() || "";
  const role = document.getElementById("staff-form-role")?.value || "staff";
  const existing = staffId ? allStaffUsers.find((u) => u.id === staffId) : null;
  const isSelf = !!existing && existing.id === currentStaffId();

  if (displayName.length < 2) {
    toast(t("Name is required (min 2 characters)"), "error");
    return;
  }
  if (!staffId && !/^[a-z0-9._-]{3,20}$/.test(username)) {
    toast(
      t("Username must be 3-20 characters: lowercase letters, numbers, dot, dash or underscore."),
      "error",
    );
    return;
  }
  if (!STAFF_ROLES.includes(role)) {
    toast(t("Pick a role"), "error");
    return;
  }
  // A new account always needs a PIN; an edit may leave it blank to keep it.
  if (!staffId && !/^\d{4}$/.test(pin)) {
    toast(t("PIN must be exactly 4 digits"), "error");
    return;
  }
  if (staffId && pin && !/^\d{4}$/.test(pin)) {
    toast(t("PIN must be exactly 4 digits"), "error");
    return;
  }
  if (pin && isWeakPin(pin)) {
    const msg =
      CURRENT_LANG === "id"
        ? "PIN ini mudah ditebak. Tetap gunakan?"
        : "That PIN is easy to guess. Use it anyway?";
    if (!confirm(msg)) return;
  }
  // The role select is disabled for yourself, but a disabled input is one
  // devtools click away from being enabled, so check the value too.
  const effectiveRole = isSelf ? existing.role : role;
  if (
    existing &&
    existing.role === "admin" &&
    existing.is_active &&
    effectiveRole !== "admin" &&
    activeAdminCount(existing.id) === 0
  ) {
    toast(
      t("This is the last active admin. Promote someone else to admin first."),
      "error",
    );
    return;
  }

  const btn = document.getElementById("staff-save-button");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("Saving...");
  }
  try {
    const payload = { display_name: displayName, role: effectiveRole };
    if (pin) payload.pin = pin;
    if (!staffId) {
      payload.username = username;
      payload.is_active = true;
    }

    const { error } = await supabaseQuery(
      () =>
        staffId
          ? db.from("staff_users").update(payload).eq("id", staffId)
          : db.from("staff_users").insert(payload),
      "Failed to save staff",
    );
    if (error) {
      // 23505 = unique violation, which here can only be the username.
      const dup =
        error.code === "23505" || /duplicate key|unique/i.test(error.message || "");
      toast(
        dup
          ? t("That username is already taken. Pick another one.")
          : error.message || t("Failed to save staff"),
        "error",
      );
      return;
    }

    // Editing your own account leaves the cached session copy stale, so the
    // sidebar would keep showing the old name until the next login.
    if (isSelf) {
      const session = getStaffSession();
      if (session) {
        setStaffSession({
          ...session,
          display_name: displayName,
          role: effectiveRole,
        });
        applyRoleToNav();
        const nameEl = document.getElementById("staff-display-name");
        if (nameEl) nameEl.textContent = displayName;
      }
    }

    hideModal("modal-staff");
    toast(staffId ? t("Staff updated") : t("Staff added"));
    if (pin && !staffId) {
      // The PIN is never shown again anywhere, so say it once, now.
      toast(
        CURRENT_LANG === "id"
          ? `Beri tahu ${displayName}: username ${username}, PIN ${pin}`
          : `Tell ${displayName}: username ${username}, PIN ${pin}`,
      );
    }
    loadStaffUsers();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("Save Staff");
    }
  }
}

async function toggleStaffActive(staffId) {
  if (currentStaffRole() !== "admin") {
    toast(t("Only an admin can manage staff"), "error");
    return;
  }
  const user = allStaffUsers.find((u) => u.id === staffId);
  if (!user) return;

  if (user.is_active) {
    if (user.id === currentStaffId()) {
      toast(t("You cannot deactivate your own account."), "error");
      return;
    }
    if (user.role === "admin" && activeAdminCount(user.id) === 0) {
      toast(
        t("This is the last active admin. Promote someone else to admin first."),
        "error",
      );
      return;
    }
    const msg =
      CURRENT_LANG === "id"
        ? `Nonaktifkan ${user.display_name}? Mereka tidak bisa login lagi, tapi riwayat kerjanya tetap tersimpan. Kalau sedang login di PC lain, efeknya baru terasa setelah logout.`
        : `Deactivate ${user.display_name}? They can no longer log in, and their work history is kept. If they are already logged in on another PC, it takes effect when that session logs out.`;
    if (!confirm(msg)) return;
  }

  const { error } = await supabaseQuery(
    () =>
      db
        .from("staff_users")
        .update({ is_active: !user.is_active })
        .eq("id", staffId),
    "Failed to update staff",
  );
  if (error) {
    toast(error.message || t("Failed to update staff"), "error");
    return;
  }
  toast(user.is_active ? t("Staff deactivated") : t("Staff reactivated"));
  loadStaffUsers();
}


// ============================================================
// SETTINGS: RESERVATION FORM APPEARANCE (manager+)
// ============================================================
// Backdrop, panel colour, button colour and logo size for the public booking
// page. The reading half (CSS variables, validation, fallbacks) lives in
// config.template.js under "RESERVATION PAGE APPEARANCE".
const RESERVE_BG_PREFIX = "reserve-bg";

function reserveAppearanceForm() {
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    const n = Number(el?.value);
    return isFinite(n) ? n : fallback;
  };
  const color = (id, fallback) => {
    const v = document.getElementById(id)?.value;
    return isHexColor(v) ? v.toUpperCase() : fallback;
  };
  return {
    // The uploaded background is NOT part of this form. It is saved the moment
    // it uploads, so a slow photo upload followed by a browser crash does not
    // lose the file with nothing pointing at it.
    bg_url: (RESERVE_APPEARANCE && RESERVE_APPEARANCE.bg_url) || null,
    glass_color: color("rf-glass-color", RESERVE_APPEARANCE_DEFAULTS.glass_color),
    glass_opacity: num("rf-glass-opacity", 60) / 100,
    accent_color: color("rf-accent-color", RESERVE_APPEARANCE_DEFAULTS.accent_color),
    logo_max_height: num("rf-logo-height", RESERVE_APPEARANCE_DEFAULTS.logo_max_height),
  };
}

function renderReserveAppearanceSettings() {
  if (!isManagerOrAdmin()) return; // hasAccess() already blocks staff
  const cfg = { ...RESERVE_APPEARANCE_DEFAULTS, ...(RESERVE_APPEARANCE || {}) };
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  set("rf-glass-color", isHexColor(cfg.glass_color) ? cfg.glass_color : RESERVE_APPEARANCE_DEFAULTS.glass_color);
  set("rf-glass-color-hex", isHexColor(cfg.glass_color) ? cfg.glass_color.toUpperCase() : RESERVE_APPEARANCE_DEFAULTS.glass_color);
  set("rf-accent-color", isHexColor(cfg.accent_color) ? cfg.accent_color : RESERVE_APPEARANCE_DEFAULTS.accent_color);
  set("rf-accent-color-hex", isHexColor(cfg.accent_color) ? cfg.accent_color.toUpperCase() : RESERVE_APPEARANCE_DEFAULTS.accent_color);
  set("rf-glass-opacity", Math.round(clampGlassOpacity(cfg.glass_opacity) * 100));
  set("rf-logo-height", cfg.logo_max_height || RESERVE_APPEARANCE_DEFAULTS.logo_max_height);

  const bgCustom = /^https?:\/\/\S+$/i.test(String(cfg.bg_url || "").trim());
  const preview = document.getElementById("rf-bg-preview");
  if (preview) preview.src = bgCustom ? cfg.bg_url : "assets/background-generic.jpg";
  const state = document.getElementById("rf-bg-state");
  if (state) {
    state.textContent = bgCustom ? t("Custom image") : t("Default image");
    state.className = bgCustom
      ? "text-[11px] font-semibold text-[#28547C]"
      : "text-[11px] text-[#999]";
  }
  document.getElementById("rf-bg-reset")?.classList.toggle("hidden", !bgCustom);
  const file = document.getElementById("rf-bg-file");
  if (file) file.value = "";

  previewReserveAppearance();
}

// Keeps the hex box and the colour swatch in step. Typing is allowed to be
// half-finished ("#28" on the way to "#28547C") without the swatch jumping
// somewhere random, so only a complete value is pushed across.
function syncReserveColorInput(pickerId, textEl) {
  let v = String(textEl.value || "").trim();
  if (v && !v.startsWith("#")) {
    v = "#" + v;
    textEl.value = v;
  }
  if (isHexColor(v)) {
    const picker = document.getElementById(pickerId);
    if (picker) picker.value = v;
    previewReserveAppearance();
  }
}

// Repaints the little mock booking card from whatever the controls say right
// now. Nothing is saved: this is here because four settings that each look
// fine alone can combine into an unreadable form over a dark photo.
function previewReserveAppearance() {
  const cfg = reserveAppearanceForm();

  const glassHex = document.getElementById("rf-glass-color-hex");
  if (glassHex && document.activeElement !== glassHex)
    glassHex.value = cfg.glass_color;
  const accentHex = document.getElementById("rf-accent-color-hex");
  if (accentHex && document.activeElement !== accentHex)
    accentHex.value = cfg.accent_color;

  const opLabel = document.getElementById("rf-glass-opacity-value");
  if (opLabel) opLabel.textContent = Math.round(cfg.glass_opacity * 100) + "%";
  const hLabel = document.getElementById("rf-logo-height-value");
  if (hLabel) hLabel.textContent = cfg.logo_max_height + "px";

  const card = document.getElementById("rf-preview-card");
  if (card)
    card.style.background =
      hexToRgba(cfg.glass_color, clampGlassOpacity(cfg.glass_opacity)) || "";
  const btn = document.getElementById("rf-preview-btn");
  if (btn)
    btn.style.background = `linear-gradient(135deg, ${cfg.accent_color}, ${shadeHex(cfg.accent_color, -0.32)})`;

  // The preview box is 260px tall against a real page around 800px, so the
  // logo is scaled to match rather than shown at its literal pixel height —
  // otherwise "200px" would fill the entire preview and look like a bug.
  const logo = document.getElementById("rf-preview-logo");
  if (logo) logo.style.maxHeight = Math.round(cfg.logo_max_height * 0.55) + "px";

  const bgEl = document.getElementById("rf-preview-bg");
  const bg = String((RESERVE_APPEARANCE && RESERVE_APPEARANCE.bg_url) || "").trim();
  if (bgEl)
    bgEl.style.backgroundImage = /^https?:\/\/\S+$/i.test(bg)
      ? `url("${bg}")`
      : 'url("assets/background-generic.jpg")';
}

async function saveReserveAppearance() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  const cfg = reserveAppearanceForm();
  loader(true);
  const ok = await writeReserveAppearance(cfg);
  loader(false);
  if (ok) toast(t("Appearance saved"));
}

async function resetReserveAppearanceDefaults() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  if (!confirm(t("Put the colours and sizes back to the built-in ones? The background photo is kept."))) return;
  // The photo is deliberately NOT cleared here: it is a file somebody
  // uploaded, and "back to defaults" on a colour picker should not silently
  // throw it away. "Use built-in" under the photo does that, on purpose.
  const cfg = {
    ...RESERVE_APPEARANCE_DEFAULTS,
    bg_url: (RESERVE_APPEARANCE && RESERVE_APPEARANCE.bg_url) || null,
  };
  loader(true);
  const ok = await writeReserveAppearance(cfg);
  loader(false);
  if (ok) toast(t("Back to the built-in look"));
}

async function writeReserveAppearance(cfg) {
  const { error } = await supabaseQuery(
    () =>
      db.from("app_settings").upsert({
        key: "reserve_appearance",
        value: cfg,
        updated_at: new Date().toISOString(),
      }),
    "Failed to save appearance",
  );
  if (error) {
    toast(error.message || t("Unable to save settings"), "error");
    return false;
  }
  RESERVE_APPEARANCE = cfg;
  renderReserveAppearanceSettings();
  return true;
}

async function uploadReserveBackground() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  const file = document.getElementById("rf-bg-file")?.files?.[0];
  if (!file) {
    toast(t("Pick an image file first"), "error");
    return;
  }
  const problem = validateBrandFile(file);
  if (problem) {
    toast(problem, "error");
    return;
  }
  // Portrait photos crop badly in a full-bleed backdrop: the interesting part
  // ends up off screen on a phone. Warn, do not block — it is their photo.
  const size = await readImageSize(file);
  if (size && size.w < size.h) {
    const msg =
      CURRENT_LANG === "id"
        ? "Foto ini potret (lebih tinggi daripada lebar). Latar belakang halaman memakai seluruh layar, jadi bagian atas dan bawah akan terpotong. Tetap unggah?"
        : "This photo is portrait (taller than it is wide). The page backdrop fills the whole screen, so the top and bottom will be cropped off. Upload anyway?";
    if (!confirm(msg)) return;
  }

  const btn = document.getElementById("rf-bg-upload");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("Uploading...");
  }
  loader(true);
  try {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
    const path = `${RESERVE_BG_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await db.storage
      .from(BRAND_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      toast(upErr.message || t("Upload failed. Please try again."), "error");
      return;
    }
    const { data: pub } = db.storage.from(BRAND_BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl || null;
    if (!brandUrlOk(url)) {
      toast(t("Upload failed. Please try again."), "error");
      return;
    }

    const previous = RESERVE_APPEARANCE && RESERVE_APPEARANCE.bg_url;
    // Saved immediately, with whatever the colour controls currently show, so
    // the uploaded file is never orphaned in storage with nothing pointing at
    // it. Unsaved colour edits ride along, which is what the user expects.
    const ok = await writeReserveAppearance({ ...reserveAppearanceForm(), bg_url: url });
    if (!ok) return;
    if (brandUrlOk(previous)) removeBrandImageByUrl(previous);
    toast(t("Background updated"));
  } finally {
    loader(false);
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("Upload");
    }
  }
}

async function resetReserveBackground() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change settings"), "error");
    return;
  }
  if (!confirm(t("Go back to the built-in image?"))) return;
  const previous = RESERVE_APPEARANCE && RESERVE_APPEARANCE.bg_url;
  loader(true);
  const ok = await writeReserveAppearance({ ...reserveAppearanceForm(), bg_url: null });
  loader(false);
  if (!ok) return;
  if (brandUrlOk(previous)) removeBrandImageByUrl(previous);
  toast(t("Back to the built-in image"));
}


// ============================================================
// AREAS: CREATE, RENAME, REMOVE
// ============================================================
// Until 2026-08-23 `areas` was SELECT-only: the four rows every database had
// came from the migration seed and there was no way to add a fifth. That made
// onboarding a client impossible without opening the SQL editor, since no two
// restaurants have the same rooms.

// Rupiah in, rupiah out. Staff type "1500000", "1.500.000", "Rp 1.500.000"
// and "1,500,000" and all four mean the same thing, so strip everything that
// is not a digit. Same rule the invoice generator already uses; a second,
// stricter parser here would reject what the invoice screen accepts.
function areaParseRupiah(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits === "" ? null : parseInt(digits, 10);
}

function areaFormatRupiah(n) {
  if (n === null || n === undefined || n === "") return "";
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num).toLocaleString("id-ID") : "";
}

// Money boxes reformat ON EVERY KEYSTROKE, which is what Rere asked for and
// what people expect of a currency field. The reason to avoid it is that
// rewriting the value moves the caret to the end, so somebody correcting the
// middle of a number gets thrown to the end after each key. That is fixed
// here rather than avoided: count the DIGITS before the caret, reformat, then
// put the caret back after that same number of digits. Digits are the only
// stable landmark, because the dots move as the number grows.
function onAreaMoneyInput(el) {
  if (!el) return;
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = el.value.slice(0, caret).replace(/\D/g, "").length;

  const n = areaParseRupiah(el.value);
  const formatted = n === null ? "" : areaFormatRupiah(n);
  if (el.value !== formatted) el.value = formatted;

  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBefore) {
    if (formatted[pos] >= "0" && formatted[pos] <= "9") seen++;
    pos++;
  }
  try {
    el.setSelectionRange(pos, pos);
  } catch (e) {
    /* a detached or hidden input cannot take a selection — never break typing */
  }
  refreshAreaDepositHint();
}

// Backspace onto a separator would otherwise look broken: deleting the dot in
// "1.500.000" leaves the digits unchanged, so reformatting puts the dot
// straight back and the key appears to do nothing. Delete the digit in front
// of it instead, which is what the person meant.
function onAreaMoneyKeydown(el, ev) {
  if (!el || !ev || ev.key !== "Backspace") return;
  const start = el.selectionStart;
  if (start !== el.selectionEnd || start < 2) return;
  if (el.value[start - 1] !== ".") return;
  ev.preventDefault();
  el.value = el.value.slice(0, start - 2) + el.value.slice(start);
  try {
    el.setSelectionRange(start - 2, start - 2);
  } catch (e) {
    /* see above */
  }
  onAreaMoneyInput(el);
}

// Blur stays as the backstop for values that never went through a keystroke:
// autofill, a paste handled by the browser, or a programmatic change.
function onAreaMoneyBlur(el) {
  if (!el) return;
  const n = areaParseRupiah(el.value);
  el.value = n === null ? "" : areaFormatRupiah(n);
  refreshAreaDepositHint();
}

// A deposit larger than the minimum spend WARNS rather than refuses. It is
// almost always a typo, but it is not impossible, and refusing it would also
// block the restaurant that wants a flat deposit on an area with no minimum
// spend at all. Nothing breaks quietly here: the guest sees both figures.
function refreshAreaDepositHint() {
  const hint = document.getElementById("area-deposit-hint");
  if (!hint) return;
  const on = !!document.getElementById("area-bookable")?.checked;
  const minSpend = areaParseRupiah(document.getElementById("area-min-spend")?.value);
  const deposit = areaParseRupiah(document.getElementById("area-deposit-amount")?.value);
  const odd = on && deposit !== null && minSpend !== null && deposit > minSpend;
  hint.classList.toggle("hidden", !odd);
  if (odd) {
    hint.textContent = t("This deposit is larger than the minimum spend.");
    hint.style.color = "#D4A017";
  }
}

// The conditions only mean anything for an area guests can actually book, so
// they stay hidden until the switch is on. Hidden, not disabled: a disabled
// field that still holds a number looks like a rule that is in force.
function onAreaBookableToggle() {
  const on = !!document.getElementById("area-bookable")?.checked;
  document.getElementById("area-conditions-wrap")?.classList.toggle("hidden", !on);
  document.getElementById("area-conditions-note")?.classList.toggle("hidden", !on);
  if (!on) document.getElementById("area-deposit-hint")?.classList.add("hidden");
  else refreshAreaDepositHint();
}

function openAreaModal(areaId) {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change areas"), "error");
    return;
  }
  const area = areaId ? allAreas.find((a) => a.id === areaId) : null;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("area-edit-id", area ? area.id : "");
  set("area-name", area ? area.name : "");
  set("area-capacity", area ? area.capacity : "");
  set("area-min-pax", area && area.min_pax != null ? area.min_pax : "");
  set("area-min-spend", area && area.min_spend != null ? areaFormatRupiah(area.min_spend) : "");
  set(
    "area-deposit-amount",
    area && area.deposit_amount != null ? areaFormatRupiah(area.deposit_amount) : "",
  );
  const bookableEl = document.getElementById("area-bookable");
  if (bookableEl) bookableEl.checked = !!(area && area.is_bookable_online);
  onAreaBookableToggle();
  refreshAreaDepositHint();
  const title = document.getElementById("area-modal-title");
  if (title) title.textContent = area ? t("Edit Area") : t("Add Area");
  const btn = document.getElementById("area-save-button");
  if (btn) btn.textContent = area ? t("Save Changes") : t("Create Area");
  showModal("modal-area");
}

async function saveArea() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change areas"), "error");
    return;
  }
  const id = document.getElementById("area-edit-id")?.value || "";
  const name = document.getElementById("area-name")?.value.trim() || "";
  const capacityRaw = document.getElementById("area-capacity")?.value;
  const capacity = parseInt(capacityRaw, 10);

  if (name.length < 2) {
    toast(t("Area name is required (min 2 characters)"), "error");
    return;
  }
  if (!isFinite(capacity) || capacity < 0) {
    toast(t("Seats must be 0 or more"), "error");
    return;
  }
  // Case-insensitive, because "VIP Room" and "vip room" are the same room to
  // everyone except the database, and two of them makes the area dropdown on
  // the reservation form unusable.
  const clash = allAreas.find(
    (a) => a.id !== id && a.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) {
    toast(t("An area with that name already exists"), "error");
    return;
  }

  // ---- Online booking conditions ----
  const bookable = !!document.getElementById("area-bookable")?.checked;
  const minPaxRaw = document.getElementById("area-min-pax")?.value;
  const minPax = minPaxRaw === "" || minPaxRaw == null ? null : parseInt(minPaxRaw, 10);
  const minSpend = areaParseRupiah(document.getElementById("area-min-spend")?.value);
  // A typed 0 is stored as NULL. "Deposit: 0" and "no deposit" are the same
  // intention, but a stored 0 would mark bookings as owing money and show the
  // guest "DP Rp 0".
  const depRaw = areaParseRupiah(document.getElementById("area-deposit-amount")?.value);
  const depAmount = depRaw === 0 ? null : depRaw;

  if (minPax !== null && (!isFinite(minPax) || minPax < 1)) {
    toast(t("Minimum guests must be 1 or more"), "error");
    return;
  }
  // The old "a deposit percentage needs a minimum spend" refusal is gone on
  // purpose: a flat rupiah deposit has nothing to calculate from, so it no
  // longer depends on min_spend. Deposit larger than min_spend is a warning
  // on the screen, not a refusal. See refreshAreaDepositHint().
  // min_pax above capacity is a rule no booking can ever satisfy. The area
  // would simply never accept anyone, with nothing on screen saying why.
  if (minPax !== null && capacity > 0 && minPax > capacity) {
    toast(
      t("Minimum guests cannot be higher than the seats in this area"),
      "error",
    );
    return;
  }

  const btn = document.getElementById("area-save-button");
  if (btn) btn.disabled = true;
  loader(true);
  // .select() is NOT decoration. Without it PostgREST answers 204 No Content
  // and supabaseQuery reports success, which is ALSO what it reports for an
  // update that matched zero rows — a row-level policy refusing the write, or
  // an id that no longer exists. The app then says "Area updated" over a write
  // that changed nothing. Asking for the row back makes the difference visible.
  const { data: saved, error } = await supabaseQuery(
    () =>
      id
        ? db
            .from("areas")
            .update({
              name,
              capacity,
              is_bookable_online: bookable,
              min_pax: minPax,
              min_spend: minSpend,
              deposit_amount: depAmount,
            })
            .eq("id", id)
            .select("id, is_bookable_online, min_pax, min_spend, deposit_amount")
        : db
            .from("areas")
            .insert({
              name,
              capacity,
              is_bookable_online: bookable,
              min_pax: minPax,
              min_spend: minSpend,
              deposit_amount: depAmount,
            })
            .select("id, is_bookable_online, min_pax, min_spend, deposit_amount"),
    "Failed to save area",
  );
  loader(false);
  if (btn) btn.disabled = false;
  if (error) {
    toast(error.message || t("Failed to save area"), "error");
    return;
  }
  const row = Array.isArray(saved) ? saved[0] : saved;
  if (!row) {
    console.error("saveArea: the write returned no row", { id, bookable });
    toast(
      t("Nothing was saved. The area may have been deleted, or the database refused the change."),
      "error",
    );
    return;
  }
  // The row came back, so the write landed. If the switch still disagrees with
  // what was sent, the column was accepted and discarded, which is a different
  // fault from a refused write and must not read as success either.
  if (!!row.is_bookable_online !== bookable) {
    console.error("saveArea: the database did not keep is_bookable_online", { sent: bookable, stored: row.is_bookable_online, row });
    toast(t("Saved, but the database did not keep the online booking settings."), "error");
    await refreshAreasAndTables();
    return;
  }
  hideModal("modal-area");
  toast(id ? t("Area updated") : t("Area created"));
  await refreshAreasAndTables();
}

async function deleteArea(areaId) {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change areas"), "error");
    return;
  }
  const area = allAreas.find((a) => a.id === areaId);
  if (!area) return;
  const tables = allTables.filter((tbl) => tbl.area_id === areaId);

  // areas -> tables is ON DELETE CASCADE, but reservations.table_id has NO
  // cascade, so the database will simply refuse to delete an area whose
  // tables are booked. Say so up front instead of letting them press delete
  // and read a foreign key error.
  if (tables.length) {
    const msg =
      CURRENT_LANG === "id"
        ? `Hapus "${area.name}" beserta ${tables.length} mejanya? Kalau ada meja yang sudah dipakai di reservasi, penghapusan akan ditolak dan tidak ada yang berubah.`
        : `Delete "${area.name}" and its ${tables.length} table${tables.length === 1 ? "" : "s"}? If any of those tables is used by a reservation the delete is refused and nothing changes.`;
    if (!confirm(msg)) return;
  } else if (!confirm(t("Delete this area?"))) {
    return;
  }

  loader(true);
  const { error } = await supabaseQuery(
    () => db.from("areas").delete().eq("id", areaId),
    "Failed to delete area",
  );
  loader(false);
  if (error) {
    // 23503 = foreign key violation: a table in this area is on a booking.
    const inUse =
      error.code === "23503" || /foreign key|violates/i.test(error.message || "");
    toast(
      inUse
        ? t("This area still has tables used by reservations, so it cannot be deleted. Deactivate the tables instead.")
        : error.message || t("Failed to delete area"),
      "error",
    );
    return;
  }
  toast(t("Area deleted"));
  await refreshAreasAndTables();
}

// One place to reload both and repaint everything that reads them. Areas feed
// the reservation form, the walk-in form and the capacity cards, so a stale
// copy after an edit shows the old name in three places at once.
async function refreshAreasAndTables() {
  await loadAreas();
  await loadTables();
  populateAreaSelects();
  renderAreas();
}

// ============================================================
// AREAS & TABLES: IMPORT
// ============================================================
// Two ways in, because onboarding a restaurant is a one-off job that should
// take two minutes rather than an evening:
//
//   1. Paste or upload a spreadsheet (CSV, or Excel via SheetJS loaded on
//      demand). Columns: area, table, seats.
//   2. Type a range: area "Indoor", names "A1-A12", seats 4.
//
// ADD ONLY, by decision (Rere, 2026-08-23). Anything whose name already
// exists is skipped, never updated and never deleted. Re-importing a
// corrected file cannot duplicate the rows that were already right, and
// cannot silently rewrite live data from a stale column.
let importRows = []; // [{area, table, seats, status}]

function openImportModal() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change areas"), "error");
    return;
  }
  importRows = [];
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("import-paste", "");
  set("import-range-area", "");
  set("import-range-names", "");
  set("import-range-seats", "4");
  const file = document.getElementById("import-file");
  if (file) file.value = "";
  // Existing areas offered as suggestions, but the field stays free text:
  // the whole point of an import is that most of these areas do not exist yet.
  const list = document.getElementById("import-area-options");
  if (list)
    list.innerHTML = allAreas
      .map((a) => `<option value="${escapeHtml(a.name)}"></option>`)
      .join("");
  renderImportPreview();
  showModal("modal-import");
}

// Splits one CSV line, honouring quotes. Restaurant data is full of commas
// ("Terrace, upper") and a naive split() mangles exactly those rows.
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === "\t" || ch === ";") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

// Header names people actually type, in both languages. A file whose first
// row is data rather than headers is still read: the header check has to
// MATCH something, it does not just assume row one is a header.
const IMPORT_HEADERS = {
  area: ["area", "ruang", "ruangan", "section", "zona", "zone", "room"],
  table: ["table", "meja", "table name", "nama meja", "no meja", "name", "nama"],
  seats: ["seats", "kursi", "capacity", "kapasitas", "pax", "seat"],
};

function detectImportColumns(cells) {
  const lower = cells.map((c) => String(c || "").trim().toLowerCase());
  const find = (keys) => lower.findIndex((c) => keys.includes(c));
  const area = find(IMPORT_HEADERS.area);
  const table = find(IMPORT_HEADERS.table);
  const seats = find(IMPORT_HEADERS.seats);
  if (area === -1 || table === -1) return null; // not a header row
  return { area, table, seats };
}

function parseImportText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  let cols = { area: 0, table: 1, seats: 2 };
  let start = 0;
  const detected = detectImportColumns(parseCsvLine(lines[0]));
  if (detected) {
    cols = detected;
    start = 1;
  }

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const area = (cells[cols.area] || "").trim();
    const table = (cells[cols.table] || "").trim();
    const seatsRaw = cols.seats >= 0 ? cells[cols.seats] : "";
    const seats = parseInt(seatsRaw, 10);
    if (!area && !table) continue;
    rows.push({
      area,
      table,
      seats: isFinite(seats) && seats > 0 ? seats : null,
    });
  }
  return rows;
}

// "A1-A12" -> A1..A12. Also "1-10", and plain comma lists.
//
// The prefix must match on both sides: "A1-B5" is not a range anybody means,
// and silently producing 100 tables from it would be worse than refusing.
function expandTableRange(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const out = [];
  parts.forEach((part) => {
    const m = part.match(/^([A-Za-z ._-]*?)(\d+)\s*[-–]\s*([A-Za-z ._-]*?)(\d+)$/);
    if (!m) {
      out.push(part);
      return;
    }
    const [, p1, n1, p2, n2] = m;
    if (p1.trim().toLowerCase() !== p2.trim().toLowerCase()) {
      out.push(part); // not a range: keep it as one literal name
      return;
    }
    const from = parseInt(n1, 10);
    const to = parseInt(n2, 10);
    if (!isFinite(from) || !isFinite(to)) {
      out.push(part);
      return;
    }
    const step = from <= to ? 1 : -1;
    // A hard ceiling. A typo like "A1-A1000" should not try to create a
    // thousand tables and time the browser out.
    const count = Math.abs(to - from) + 1;
    if (count > 200) {
      out.push(part);
      return;
    }
    // Keep the zero padding people use: "T01-T12" stays two digits.
    const width = n1.length > 1 && n1.startsWith("0") ? n1.length : 0;
    for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
      out.push(p1 + (width ? String(n).padStart(width, "0") : String(n)));
    }
  });
  return out;
}

function addImportRange() {
  const area = document.getElementById("import-range-area")?.value.trim() || "";
  const names = document.getElementById("import-range-names")?.value || "";
  const seats = parseInt(document.getElementById("import-range-seats")?.value, 10);
  if (!area) {
    toast(t("Pick or type an area first"), "error");
    return;
  }
  const expanded = expandTableRange(names);
  if (!expanded.length) {
    toast(t("Type table names, e.g. A1-A12"), "error");
    return;
  }
  expanded.forEach((table) =>
    importRows.push({ area, table, seats: isFinite(seats) && seats > 0 ? seats : null }),
  );
  document.getElementById("import-range-names").value = "";
  renderImportPreview();
}

function addImportPaste() {
  const text = document.getElementById("import-paste")?.value || "";
  const rows = parseImportText(text);
  if (!rows.length) {
    toast(t("Nothing to import. Check the pasted text."), "error");
    return;
  }
  importRows.push(...rows);
  renderImportPreview();
}

// Excel needs a parser. SheetJS is loaded ONLY when an .xlsx is actually
// picked, so a client who never touches Excel never downloads it, and the app
// gains no permanent dependency for a once-per-restaurant job.
function importFilePicked() {
  const file = document.getElementById("import-file")?.files?.[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseImportText(reader.result);
      if (!rows.length) {
        toast(t("Nothing to import. Check the file."), "error");
        return;
      }
      importRows.push(...rows);
      renderImportPreview();
    };
    reader.readAsText(file);
    return;
  }
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    toast(t("Use a CSV or Excel file."), "error");
    return;
  }
  loadSheetJs()
    .then((XLSX) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          // Read as a grid of raw cells and reuse the same parser the paste
          // box uses, so both routes behave identically and there is one set
          // of header rules to keep correct.
          const grid = XLSX.utils.sheet_to_csv(sheet);
          const rows = parseImportText(grid);
          if (!rows.length) {
            toast(t("Nothing to import. Check the file."), "error");
            return;
          }
          importRows.push(...rows);
          renderImportPreview();
        } catch (e) {
          console.warn("xlsx parse failed", e);
          toast(t("Could not read that Excel file. Try saving it as CSV."), "error");
        }
      };
      reader.readAsArrayBuffer(file);
    })
    .catch(() => {
      toast(
        t("Could not load the Excel reader. Save the file as CSV and try again."),
        "error",
      );
    });
}

let _sheetJsPromise = null;
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_sheetJsPromise) return _sheetJsPromise;
  _sheetJsPromise = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    el.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("no XLSX")));
    el.onerror = reject;
    document.head.appendChild(el);
  });
  return _sheetJsPromise;
}

// Works out what each row WILL do before anything is written, and says so.
// The whole point of add-only is that the user can see the skips and trust
// that re-importing is safe.
function classifyImportRows() {
  const existingAreas = new Map(
    allAreas.map((a) => [a.name.trim().toLowerCase(), a]),
  );
  const existingTables = new Set(
    allTables.map((tb) => {
      const area = allAreas.find((a) => a.id === tb.area_id);
      return `${(area?.name || "").trim().toLowerCase()}|${tb.name.trim().toLowerCase()}`;
    }),
  );
  const newAreas = new Set();
  const seenTables = new Set();

  return importRows.map((row) => {
    const areaKey = row.area.trim().toLowerCase();
    const tableKey = `${areaKey}|${row.table.trim().toLowerCase()}`;
    let status;
    if (!row.area || !row.table) {
      status = "invalid";
    } else if (existingTables.has(tableKey) || seenTables.has(tableKey)) {
      // Duplicates WITHIN the pasted file count too — a spreadsheet with the
      // same table twice would otherwise insert it twice.
      status = "skip";
    } else {
      status = "add";
      seenTables.add(tableKey);
      if (!existingAreas.has(areaKey)) newAreas.add(row.area.trim());
    }
    return { ...row, status, newArea: !existingAreas.has(areaKey) };
  });
}

function renderImportPreview() {
  const el = document.getElementById("import-preview");
  const btn = document.getElementById("import-apply-button");
  if (!el) return;
  if (!importRows.length) {
    el.innerHTML = `<p class="text-xs text-[#999] text-center py-6">${t("Nothing queued yet. Paste a list, pick a file, or add a range above.")}</p>`;
    if (btn) btn.disabled = true;
    return;
  }
  const rows = classifyImportRows();
  const adds = rows.filter((r) => r.status === "add");
  const skips = rows.filter((r) => r.status === "skip");
  const bad = rows.filter((r) => r.status === "invalid");
  const newAreas = [...new Set(adds.filter((r) => r.newArea).map((r) => r.area.trim()))];

  const pill = (r) =>
    r.status === "add"
      ? `<span class="text-[10px] font-semibold text-[#1FAF5E]">${t("ADD")}</span>`
      : r.status === "skip"
        ? `<span class="text-[10px] font-semibold text-[#999]">${t("EXISTS")}</span>`
        : `<span class="text-[10px] font-semibold text-[#B23B3B]">${t("INVALID")}</span>`;

  el.innerHTML =
    `<div class="text-xs text-[#555] mb-2">
       <strong>${adds.length}</strong> ${t("to add")}
       ${skips.length ? ` &middot; ${skips.length} ${t("already there")}` : ""}
       ${bad.length ? ` &middot; <span class="text-[#B23B3B]">${bad.length} ${t("unusable")}</span>` : ""}
       ${newAreas.length ? `<div class="mt-1 text-[11px] text-[#777]">${t("New areas")}: ${escapeHtml(newAreas.join(", "))}</div>` : ""}
     </div>
     <div class="max-h-56 overflow-y-auto border border-[#EDE9E3] rounded-10">` +
    rows
      .map(
        (r) => `
        <div class="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[#F5F3EF] last:border-0 ${r.status === "add" ? "" : "opacity-60"}">
          <span class="text-xs text-[#333] truncate">${escapeHtml(r.area || "—")} &middot; ${escapeHtml(r.table || "—")}${r.seats ? ` &middot; ${r.seats} ${t("seats")}` : ""}</span>
          ${pill(r)}
        </div>`,
      )
      .join("") +
    "</div>";
  if (btn) btn.disabled = adds.length === 0;
}

function clearImportQueue() {
  importRows = [];
  renderImportPreview();
}

async function applyImport() {
  if (!isManagerOrAdmin()) {
    toast(t("Only a manager can change areas"), "error");
    return;
  }
  const rows = classifyImportRows().filter((r) => r.status === "add");
  if (!rows.length) return;

  const btn = document.getElementById("import-apply-button");
  if (btn) btn.disabled = true;
  loader(true);
  try {
    // Areas first: a table needs its area's id, and the areas in this file
    // may not exist yet.
    const existing = new Map(allAreas.map((a) => [a.name.trim().toLowerCase(), a.id]));
    const wantedAreas = [
      ...new Set(
        rows
          .map((r) => r.area.trim())
          .filter((n) => !existing.has(n.toLowerCase())),
      ),
    ];

    if (wantedAreas.length) {
      // Capacity is left at 0 rather than guessed from the table seats: an
      // area's capacity is a fire-code number the owner sets, not the sum of
      // the chairs that happen to be in it today.
      const { error } = await supabaseQuery(
        () => db.from("areas").insert(wantedAreas.map((name) => ({ name, capacity: 0 }))),
        "Failed to create areas",
      );
      if (error) {
        toast(error.message || t("Failed to create areas"), "error");
        return;
      }
      await loadAreas();
      allAreas.forEach((a) => existing.set(a.name.trim().toLowerCase(), a.id));
    }

    const payload = rows
      .map((r) => ({
        name: r.table.trim(),
        area_id: existing.get(r.area.trim().toLowerCase()),
        capacity: r.seats || 2,
        is_active: true,
      }))
      .filter((r) => r.area_id);

    if (payload.length) {
      const { error } = await supabaseQuery(
        () => db.from("tables").insert(payload),
        "Failed to create tables",
      );
      if (error) {
        toast(error.message || t("Failed to create tables"), "error");
        return;
      }
    }

    hideModal("modal-import");
    toast(
      CURRENT_LANG === "id"
        ? `${payload.length} meja ditambahkan${wantedAreas.length ? ` di ${wantedAreas.length} area baru` : ""}`
        : `Added ${payload.length} table${payload.length === 1 ? "" : "s"}${wantedAreas.length ? ` across ${wantedAreas.length} new area${wantedAreas.length === 1 ? "" : "s"}` : ""}`,
    );
    importRows = [];
    await refreshAreasAndTables();
  } finally {
    loader(false);
    if (btn) btn.disabled = false;
  }
}
