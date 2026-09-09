const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('js/app.js', 'utf8');
const sheet = fs.readFileSync('js/runsheet.js', 'utf8');
const extract = (name) => app.match(new RegExp(`^async function ${name}\\([\\s\\S]*?^}`, 'm'))[0];

(async () => {
  for (const action of ['submitDepositPayment', 'submitWaiveDeposit']) {
    for (const success of [true, false]) {
      for (const dashboard of [true, false]) {
        const calls = [];
        const reopened = [];
        const ctx = vm.createContext({
          invoicePaymentContext: null, confirmWaitlistOverflow: async () => true, depositActionResId: 'booking', TODAY: '2026-09-07',
          reservationDataRevision: 0,
          document: { getElementById: () => ({ value: '50000' }) },
          loader() {}, toast() {}, hideModal() {
            if (action === 'submitDepositPayment') {
              assert.deepEqual(calls, dashboard ? ['reservations', 'dashboard'] : ['reservations'],
                'payment modal closes only after booking displays have refreshed');
            }
          }, t: s => s,
          currentStaffId: () => 'staff', depositRupiah: String,
          db: { rpc: async () => ({ data: { ok: success, locked: true } }) },
          supabaseQuery: fn => fn(), isViewingStaffDashboard: () => dashboard,
          openResActions: async id => reopened.push(id),
          loadReservations: async () => calls.push('reservations'),
          loadDashboard: async () => calls.push('dashboard'),
        });
        vm.runInContext(extract(action), ctx);
        await ctx[action]();
        assert.deepEqual(reopened, success && action === "submitDepositPayment" ? ["booking"] : [], "payment refreshes the open Update panel after success");
        assert.deepEqual(calls, success ? (dashboard ? ['reservations', 'dashboard'] : ['reservations']) : []);
      }
    }
  }

  const selections = [];
  const root = { innerHTML: '', classList: { remove() {} } };
  const ctx = vm.createContext({
    resSelectedDate: '2026-09-07', TODAY: '2026-09-07', CURRENT_LANG: 'en',
    allAreas: [], loadAreas: async () => {}, loadTables: async () => {}, RES_OCCUPANCY_STATUSES: ['Incoming', 'Reserved'],
    t: s => s, formatGuestName: g => g.name, restaurantName: () => 'Restaurant',
    toast() {}, document: { getElementById: () => root, body: { classList: { add() {} } } },
    supabaseQuery: fn => fn(),
    db: { from(table) {
      const query = {
        select(fields) { selections.push(fields); return this; },
        eq() { return this; }, in() { return this; }, order() { return this; },
        then(resolve) { return Promise.resolve({ data: table === 'reservations'
          ? [{ id: 'booking', pax: 20, guests: { name: 'Sito' }, deposit_required: true, deposit_expected: 50000 }]
          : [{ reservation_id: 'booking', state: 'paid', outstanding: 0 }] }).then(resolve); },
      };
      return query;
    } },
  });
  vm.runInContext(sheet, ctx);
  await ctx.openRunSheet();
  assert.ok(selections[0].includes('deposit_required'));
  assert.ok(selections[0].includes('deposit_expected'));
  assert.ok(root.innerHTML.includes('Deposit paid'));
  assert.equal(ctx.runSheetDepositCell({ deposit_required: true, deposit_balance: { state: 'partial', outstanding: 20000 } }), 'Part paid · Owed Rp 20.000');
  assert.equal(ctx.runSheetDepositCell({ deposit_required: true, deposit_balance: { state: 'unpaid', outstanding: 50000 } }), 'Owed Rp 50.000');
  assert.equal(ctx.runSheetDepositCell({ deposit_required: false }), '—');
  console.log('Payment/waiver refresh and run sheet balance regression tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
