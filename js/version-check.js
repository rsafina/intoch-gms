// ============================================================
// BUILD FRESHNESS CHECK
//
// Front desk PCs keep this tab open for the whole shift. app.js already
// reloads on the midnight rollover and every 6 hours, but a fix pushed
// at 20:30 can still sit unseen until the next reload fires. This shows
// staff that a newer build exists and lets them take it when they are
// not mid-task.
//
// HOW IT DETECTS A NEW BUILD, and why it is done this way:
//
// The obvious design is a version.json bumped on every deploy. That
// only works if the bump never gets forgotten, and a freshness check
// that silently stops noticing is worse than none at all. So instead
// this reads the ETag of index.html itself, via HEAD (a few hundred
// bytes, not the 300KB document). Netlify's ETag is content-derived,
// so it changes exactly when index.html changes and not otherwise.
//
// That is reliable here for a specific reason worth stating: this repo
// cache-busts every JS change with a ?v= bump in index.html. So every
// deploy that changes behaviour necessarily changes index.html, and
// therefore its ETag. Detection comes free, with nothing to remember.
// If that convention is ever dropped, this check goes blind to JS-only
// deploys, so keep bumping ?v=.
//
// FAIL-QUIET BY DESIGN: no ETag header, a failed request, an offline
// moment — all resolve to "say nothing". A false "new version" banner
// nagging staff every 10 minutes would train them to ignore it, which
// costs more than the feature is worth. The 6-hour reload remains the
// backstop in every case.
// ============================================================

// Hourly, not every few minutes. Netlify's free plan bills web requests
// (roughly 2 credits per 10,000), and this repo now deploys in deliberate
// batches rather than on every push — so there is nothing to discover more
// often than this. Hourly costs well under a credit a month across the
// front desk PCs, and still beats waiting on the 6-hour auto-reload.
// Raising the frequency has a real bill attached; don't, without a reason.
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const VERSION_CHECK_URL = "/index.html";

let _verStarted = false;
let _verBaseline = null; // validator for the build this tab is running
let _verLatest = null; // validator seen on the most recent poll
let _verDismissed = null; // validator staff explicitly dismissed
let _verTimer = null;

async function _verFetchTag() {
  try {
    const res = await fetch(VERSION_CHECK_URL + "?_v=" + Date.now(), {
      method: "HEAD",
      cache: "no-store",
    });
    if (!res.ok) return null;
    // ETag first; Last-Modified is a usable fallback on hosts that omit it.
    return res.headers.get("etag") || res.headers.get("last-modified") || null;
  } catch (_) {
    return null; // offline / blocked — stay quiet
  }
}

function _verShowBanner() {
  document.getElementById("version-update-bar")?.classList.remove("hidden");
}

function _verHideBanner() {
  document.getElementById("version-update-bar")?.classList.add("hidden");
}

function versionCheckReload() {
  location.reload();
}

function versionCheckDismiss() {
  // Dismiss silences THIS build only. If another deploy lands later its
  // validator differs again and the bar comes back, which is the point:
  // dismissing is "not now", never "stop telling me".
  _verDismissed = _verLatest;
  _verHideBanner();
}

async function setupVersionCheck() {
  if (_verStarted) return;
  _verStarted = true;

  if (typeof IS_DEV !== "undefined" && IS_DEV) return; // dev: same rule as app.js timers

  _verBaseline = await _verFetchTag();
  if (!_verBaseline) {
    console.log("[version-check] no validator header — disabled, 6h reload still applies");
    return;
  }

  _verTimer = setInterval(async () => {
    const tag = await _verFetchTag();
    if (!tag) return; // transient failure, try again next tick
    _verLatest = tag;
    if (tag === _verBaseline) {
      _verHideBanner(); // rolled back to the build we are running
      return;
    }
    if (tag === _verDismissed) return;
    _verShowBanner();
  }, VERSION_CHECK_INTERVAL_MS);
}
