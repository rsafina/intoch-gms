// Who owns which loading UI, and for how long.
//
// The bug this guards: the staff app revealed its shell and section skeletons
// first and only THEN raised the Intoch boot screen over them (navigateTo did
// it, on every route change), so a refresh read as skeleton -> boot screen ->
// page, a save that re-navigates put the boot screen back over a running app,
// and a fresh login ran two navigations at once. Three separate things were
// deciding what covered the screen.
//
// Rules asserted here:
//   1. Boot raises the Intoch screen ONCE and lowers it ONCE, when the first
//      page has its data.
//   2. A route change never raises it. It spins the shared page spinner, which
//      leaves the shell and the section skeleton visible.
//   3. A login performs ONE navigation, not two.
//   4. A dead connection, and a logout, both uncover the screen. #page-loading
//      hides every sibling in the body, so a toast or a login form left under
//      it is invisible.
//   5. The shared spinner is reference counted: a page loader that raises it
//      for itself (loadMembership does) must not uncover a navigation that is
//      still fetching.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const app = fs.readFileSync('js/app.js', 'utf8').replace(/\r\n/g, '\n');
const config = fs.readFileSync('js/config.template.js', 'utf8').replace(/\r\n/g, '\n');
const grab = (src, name) => {
  const found = src.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert.ok(found, 'cannot find ' + name);
  return found[0];
};

function harness({ connected = true, lastPage = null } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="en" data-page-loading><body>' +
    '<div id="page-loader" style="display:none"></div>' +
    '<section id="page-dashboard" class="page-section"></section>' +
    '<section id="page-reservations" class="page-section"></section>' +
    '<section id="page-membership" class="page-section"></section>' +
    '<form id="login-page"><input id="login-username"><input id="login-pin"><p id="login-error"></p></form>' +
    '</body></html>', { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.eval(fs.readFileSync('js/page-loading.js', 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

  const log = [];
  w.localStorage.clear();
  if (lastPage) w.localStorage.setItem('lastPage', lastPage);
  w.appInitialized = false;
  w.currentPage = 'dashboard';
  w.dashboardResFilter = w.resStatusFilter = 'all';
  w.SETTINGS_SUBPAGES = [];
  w.hasAccess = () => true;
  w.currentStaffRole = () => 'staff';
  w.getStaffSession = () => ({ display_name: 'Rere', role: 'staff' });
  w.clearStaffSession = () => {};
  w.setStaffSession = () => {};
  w.clearResSearch = () => {};
  w.toast = () => {};
  w.testSupabaseConnection = async () => connected;
  w.restoreVerifiedStaffSession = async () => ({ role: 'staff' });
  w.staffAuthEmail = u => u;
  w.staffAuthPassword = p => p;
  w.db = { auth: { signInWithPassword: async () => ({ error: null }), signOut: async () => {} } };
  for (const n of ['showAppShell', 'applyRoleToNav', 'populateAreaSelects', 'setupSpinResultsActions',
    'setStaffDashboardDateLabel', 'setupRealtimeUpdates', 'setupOnlineResNotify', 'setupAutoRefresh',
    'setupVersionCheck', 'teardownRealtimeUpdates', 'teardownOnlineResNotify', 'renderSettingsTabs',
    'renderStaffViewBanner', 'showLoginPage', 'initInvoice']) w[n] = () => log.push(n);
  for (const n of ['loadAppSettings', 'loadAreas', 'loadTables']) w[n] = async () => {};
  for (const n of ['loadGuests', 'loadWalkIns', 'renderAreas', 'loadReports', 'loadOperationsReports',
    'initBirthdayView', 'loadPrizeAdmin', 'initVouchers', 'loadFeaturedDishes', 'renderFullMenuLink',
    'renderReserveAppearanceSettings', 'renderReservationFormFields', 'loadWaTemplateSettings',
    'renderThresholdSettings', 'renderBrandingSettings', 'loadStaffUsers', 'loadBroadcast',
    'loadOwnerDashboard']) w[n] = async () => {};
  w.loadDashboard = async () => log.push('loadDashboard');
  w.loadReservations = async () => log.push('loadReservations');
  w.loadMembership = async () => log.push('loadMembership');
  w.eval([config.match(/^let _loaderDepth = 0;$/m)[0], grab(config, 'loader'),
    grab(app, 'navigateTo'), grab(app, 'initializeApplication'),
    grab(app, 'loginStaff'), grab(app, 'logoutStaff')].join('\n'));

  return {
    w, log,
    covered: () => w.document.documentElement.hasAttribute('data-page-loading'),
    spinning: () => w.document.getElementById('page-loader').style.display === 'flex',
  };
}

const settle = () => new Promise(r => setImmediate(r));

(async () => {
  // 1 + 2. Refresh while logged in: covered from the first paint through to the
  // restored page's data, then never covered again by ordinary routing.
  {
    const h = harness({ lastPage: 'reservations' });
    assert.ok(h.covered(), 'the app boots already covered, before any query runs');
    await h.w.initializeApplication();
    // navigateTo is deliberately not awaited inside boot (realtime must not
    // wait on page data), so let its loads settle.
    await settle();
    assert.deepEqual(h.log.filter(n => n.startsWith('load')), ['loadDashboard', 'loadReservations'],
      'boot lands on the restored page, not on a second one');
    assert.ok(!h.covered(), 'and uncovers once that page has its data');

    await h.w.navigateTo('membership');
    assert.ok(!h.covered(), 'a later route change never re-raises the boot screen');
    assert.ok(!h.spinning(), 'and leaves no spinner behind');
  }

  // 2b. A route change spins while its data is in flight, so an already
  // populated section cannot sit there looking like fresh content.
  {
    const h = harness();
    h.w.PageLoading.finish();
    let release;
    h.w.loadReservations = () => new Promise(r => (release = r));
    const nav = h.w.navigateTo('reservations');
    assert.ok(h.spinning(), 'a route change with data to fetch shows the shared spinner');
    assert.ok(!h.covered(), 'and not the boot screen');
    release(); await nav;
    assert.ok(!h.spinning());
  }

  // 3. Fresh login: one navigation. It used to run initializeApplication (which
  // navigated to lastPage) and then navigate to dashboard itself, racing two
  // boot screens and loading two pages.
  {
    const h = harness({ lastPage: 'reservations' });
    h.w.document.getElementById('login-username').value = 'rere';
    h.w.document.getElementById('login-pin').value = '1234';
    await h.w.loginStaff({ preventDefault() {} });
    await settle();
    assert.equal(h.log.filter(n => n === 'loadReservations').length, 0,
      'login lands on the dashboard, not on the previous session page');
    assert.equal(h.w.currentPage, 'dashboard');
    assert.ok(!h.covered(), 'and the screen is uncovered exactly once');
  }

  // 4a. A dead connection must not leave its own error toast under the cover.
  {
    const h = harness({ connected: false });
    await h.w.initializeApplication();
    assert.ok(!h.covered(), 'a failed connection uncovers the page so the toast is visible');
  }

  // 4b. Logout, with a navigation still in flight.
  {
    const h = harness();
    h.w.PageLoading.begin();
    await h.w.logoutStaff();
    assert.ok(!h.covered(), 'the login form is never left behind the boot screen');
  }

  // 5. Reference counting. loadMembership() raises the spinner for itself while
  // navigateTo is holding it up for the whole route change.
  {
    const h = harness();
    h.w.PageLoading.finish();
    let release;
    h.w.loadMembership = async () => {
      h.w.loader(true);
      await new Promise(r => (release = r));
      h.w.loader(false);
    };
    const nav = h.w.navigateTo('membership');
    await settle();
    assert.ok(h.spinning());
    release(); await nav;
    assert.ok(!h.spinning(), 'nested raise/lower leaves the spinner off, not stuck on');

    // An extra lower (every save path has one per early-return branch) must not
    // push the count negative, or the next raise would not show anything.
    h.w.loader(false); h.w.loader(false);
    h.w.loader(true);
    assert.ok(h.spinning(), 'an unbalanced lower cannot deafen the next raise');
    h.w.loader(false);
    assert.ok(!h.spinning());
  }

  console.log('Loading sequence: boot covers once, routing spins instead, login navigates once, failures and logout uncover, spinner refcounts');
})().catch(e => { console.error(e); process.exitCode = 1; });
