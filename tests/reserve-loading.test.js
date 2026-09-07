const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('reserve.template.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
scripts.forEach(source => new vm.Script(source));
const init = html.match(/\(async function init\(\) \{[\s\S]*?\}\)\(\)\.then\(finishReserveLoading\)\.catch\(reserveLoadingFailed\);/)[0];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  for (const paused of [false, true]) {
    for (const failure of [false, true]) {
      const appearance = deferred();
      const fields = deferred();
      const events = [];
      const ctx = vm.createContext({
        initGuestLanguageSync() {},
        loadReserveAppearance: () => { events.push('appearance'); return appearance.promise; },
        applyReserveAppearance: () => events.push('applied'),
        loadBrandLogo: async () => events.push('branding'),
        loadFormFields: () => fields.promise,
        loadAreas: async () => events.push('areas'),
        loadAvailability() {}, loadFeaturedDishes() {}, loadFullMenuLink() {},
        buildTimeSlots() {}, renderPaxNote() {},
        $: () => ({ addEventListener() {} }),
        todayLocal: () => '2026-09-07', earliestDate: () => '', nextOpenDate: () => '', addDays: () => '',
        DATE_EXCEPTIONS: {}, MAX_DAYS_AHEAD: 30, ERR_ID: { paused: 'paused' },
        showError: () => events.push('paused'),
        finishReserveLoading: () => events.push('revealed'),
        reserveLoadingFailed: () => events.push('failed'),
        db: { from(table) {
          events.push(table);
          return { select() { return this; }, eq() { return this; }, gte() { return this; },
            maybeSingle: async () => ({ data: { value: { online_paused: paused } } }),
            order: async () => ({ data: [] }),
          };
        } },
      });
      const done = vm.runInContext(init, ctx);
      await flush();
      assert.equal(events[0], 'appearance');
      assert.ok(!events.includes('revealed'));
      fields.resolve();
      await flush();
      assert.ok(!events.includes('revealed'));
      failure ? appearance.reject(new Error('offline')) : appearance.resolve({ bg_style: 'solid' });
      await done;
      assert.equal(events.at(-1), failure ? 'failed' : 'revealed');
      if (!failure) assert.ok(events.indexOf('applied') < events.indexOf('revealed'));
      if (paused) assert.ok(events.includes('paused'));
      else assert.ok(events.indexOf('areas') < events.indexOf(failure ? 'failed' : 'revealed'));
    }
  }
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  let timeout;
  dom.window.setTimeout = fn => { timeout = fn; return 1; };
  dom.window.clearTimeout = () => {};
  dom.window.eval(scripts[0]);
  assert.ok(dom.window.document.documentElement.hasAttribute('data-reserve-loading'));
  timeout();
  assert.equal(dom.window.document.getElementById('reserve-loading-retry').hidden, false);
  assert.ok(dom.window.document.documentElement.hasAttribute('data-reserve-loading'));
  dom.window.finishReserveLoading();
  assert.equal(dom.window.document.getElementById('reserve-loading'), null);
  assert.ok(!dom.window.document.documentElement.hasAttribute('data-reserve-loading'));
  dom.window.close();
  console.log('Reservation loading: slow settings, failure, pause, retry and script syntax passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
