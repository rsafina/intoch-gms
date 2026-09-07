const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const pages = ['reserve.template.html', 'reservation-created.template.html',
  'reservation-confirmation.template.html', 'deposit-invoice.template.html',
  'invoice-view.template.html', 'spin.template.html', 'landing.html', 'index.html'];
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  assert.ok(html.includes('js/page-loading.js'), page);
  assert.ok(html.includes('css/page-loading.css'), page);
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script[0].includes('application/ld+json')) continue;
    new vm.Script(script[1], { filename: page });
  }
}

(async () => {
  const dom = new JSDOM('<html lang="en" data-page-loading><body><main>Content</main></body></html>',
    { runScripts: 'outside-only', url: 'https://example.test/reserve' });
  const w = dom.window;
  let timeout;
  w.setTimeout = fn => { timeout = fn; return 1; };
  w.clearTimeout = () => {};
  w.eval(fs.readFileSync('js/page-loading.js', 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const loading = () => w.document.documentElement.hasAttribute('data-page-loading');
  const first = w.PageLoading.begin();
  const second = w.PageLoading.begin();
  w.PageLoading.finish(first);
  assert.ok(loading(), 'older navigation cannot reveal an unfinished new page');
  timeout();
  assert.equal(w.document.querySelector('#page-loading button').hidden, false);
  w.PageLoading.finish(second);
  assert.ok(!loading());
  w.PageLoading.begin();
  let resolve;
  const ready = w.PageLoading.ready(new Promise(r => resolve = r));
  assert.ok(loading());
  resolve(); await ready;
  assert.ok(!loading(), 'screen reveals only after required work finishes');
  w.PageLoading.begin();
  w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true }));
  assert.ok(!loading(), 'back/forward cache restores a usable page');

  // Exercise actual staff navigation with a delayed reservation query.
  const app = fs.readFileSync('js/app.js', 'utf8');
  const navigate = app.match(/^async function navigateTo\(page\) \{[\s\S]*?^}/m)[0];
  w.SETTINGS_SUBPAGES = [];
  w.hasAccess = () => true;
  w.currentStaffRole = () => 'staff';
  w.clearResSearch = () => {};
  let finishReservations;
  w.loadReservations = () => new Promise(r => finishReservations = r);
  w.eval(navigate);
  const navigation = w.navigateTo('reservations');
  assert.ok(loading(), 'staff route stays covered during its data request');
  finishReservations(); await navigation;
  assert.ok(!loading());
  dom.window.close();
  console.log('Page loaders: templates, navigation, delayed data, retry and back/forward passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
