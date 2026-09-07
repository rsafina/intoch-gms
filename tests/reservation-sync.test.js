const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync('js/app.js', 'utf8');
const wa = fs.readFileSync('js/wa.js', 'utf8');
const notify = fs.readFileSync('js/notify.js', 'utf8');
const lift = (s, name) => s.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, 'm'))[0];
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

(async () => {
  const old = deferred();
  const rendered = [];
  const ctx = vm.createContext({
    dashboardReservationRequest: 0, reservationDataRevision: 0,
    updateDashboardReservationTabs() {}, getDashboardDate() {},
    loadDepositBalances: async rows => { if (rows[0].status === 'Incoming') await old.promise; },
    attachGuestVisitCounts: async () => {}, renderDashboardReservations: rows => rendered.push(rows[0].status),
  });
  vm.runInContext(lift(app, 'loadDashboardReservations'), ctx);
  const stale = ctx.loadDashboardReservations(0, [{ status: 'Incoming' }]);
  ctx.reservationDataRevision++;
  await ctx.loadDashboardReservations(0, [{ status: 'Reserved' }]);
  old.resolve();
  await stale;
  assert.deepEqual(rendered, ['Reserved'], 'a pre-payment response cannot restore Incoming');

  const buttons = vm.createContext({ resDepositBalances: { paid: { state: 'paid' } }, WA_BTN_CLASS: '', t: s => s });
  vm.runInContext(lift(wa, 'waReservationBtns'), buttons);
  const row = { id: 'paid', status: 'Reserved', guests: { phone: '123' } };
  assert.match(buttons.waReservationBtns(row), /WA Follow Up/);
  assert.match(buttons.waReservationBtns({ ...row, id: 'no-deposit' }), /WA Follow Up/);

  const events = [];
  let listRefreshes = 0;
  const bell = vm.createContext({
    console, document: { getElementById: () => null, addEventListener() {} }, window: {},
    setInterval() {}, clearInterval() {}, APP_SETTINGS: {},
    toast: s => events.push(s),
    scheduleReservationViewsRefresh: () => listRefreshes++,
  });
  vm.runInContext(notify, bell);
  let rows = [];
  bell._resNotifyFetch = async () => rows;
  bell._resNotifyLoadStaffNames = async () => ({});
  bell._resNotifyRenderBadge = () => {};
  bell._resNotifyChime = () => events.push('chime');
  await bell._resNotifyRefresh();
  rows = [{ id: 'online', name: 'New Guest', status: 'Incoming', depositRequired: true, depositExpected: 50000, date: '2026-09-08', time: '19:00', pax: 2 }];
  await bell._resNotifyRefresh({ chimeNew: true });
  assert.equal(events.length, 2, 'new online deposit booking gets toast and chime without reloading');
  assert.equal(listRefreshes, 1, 'notification catch-up also refreshes the visible list');
  await bell._resNotifyRefresh({ chimeNew: true });
  assert.equal(events.length, 2, 'polling the same booking does not repeat its alert');
  assert.equal(listRefreshes, 1, 'unchanged notifications do not reload the list');
  rows = [...rows, { id: 'waitlist', name: 'Waitlist Guest', status: 'Waitlist', date: '2026-09-08', time: '19:00', pax: 30 }];
  await bell._resNotifyRefresh({ chimeNew: true });
  assert.equal(events.length, 4, 'online waitlist booking also alerts staff');
  assert.equal(listRefreshes, 2);

  for (const page of ['dashboard', 'reservations', 'guests']) {
    const refreshes = [];
    const timers = new Map();
    let timerId = 0;
    const live = vm.createContext({
      currentPage: page, _rtReservationTimer: null,
      isViewingStaffDashboard: () => page === 'dashboard',
      loadDashboard: async () => refreshes.push('dashboard'),
      loadReservations: async () => refreshes.push('reservations'),
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: id => timers.delete(id), console,
    });
    vm.runInContext(lift(app, 'scheduleReservationViewsRefresh'), live);
    live.scheduleReservationViewsRefresh();
    live.scheduleReservationViewsRefresh();
    assert.equal(timers.size, 1, 'bell and socket events coalesce');
    await [...timers.values()][0]();
    assert.deepEqual(refreshes, page === 'guests' ? [] : [page]);
  }
  console.log('Reservation synchronization and live notification regressions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
