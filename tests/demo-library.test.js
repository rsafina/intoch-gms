const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('demo-library.html');
function fixture(slug, reduced = false) {
  const dom = new JSDOM(html, { url: `https://demo.invalid/demo/${slug}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window;
  const timers = new Map(); let id = 0; let motionListener; let observer;
  const media = { matches: reduced, addEventListener: (_, callback) => { motionListener = callback; } };
  window.matchMedia = () => media;
  window.setTimeout = callback => { timers.set(++id, callback); return id; };
  window.clearTimeout = key => timers.delete(key);
  window.IntersectionObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket']) window[name] = () => { throw new Error('Demo attempted network access'); };
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new Error('Demo accessed app storage'); } });
  window.eval(read('js/demo-library-data.js'));
  window.eval(read('js/demo-library.js'));
  const document = window.document;
  return { window, document, timers,
    click(selector) { document.querySelector(selector).click(); },
    tick() { const next = timers.entries().next().value; assert.ok(next, 'a single timer is pending'); timers.delete(next[0]); next[1](); assert.ok(timers.size <= 1); },
    motion(value) { media.matches = value; motionListener(); },
    visibility(value) { Object.defineProperty(document, 'hidden', { configurable: true, value }); document.dispatchEvent(new window.Event('visibilitychange')); },
    visible(value) { observer([{ isIntersecting: value }]); },
    close() { window.close(); }
  };
}
const slugs = ['reactivation', 'customer-database', 'campaign', 'walk-in', 'reservation', 'follow-up', 'membership', 'customer-insight', 'full-journey'];
for (const slug of slugs) {
  const page = fixture(slug);
  const count = page.document.querySelectorAll('.demo-steps [data-step]').length;
  assert.match(page.document.title, /Demo Intoch/);
  for (let index = 0; index < count * 4; index++) page.tick();
  assert.equal(page.document.getElementById('demo-end').hidden, false, slug + ' completes');
  assert.equal(page.timers.size, 0);
  assert.ok(page.document.querySelector('.demo-cta').href.startsWith('https://wa.me/6281325063362?'));
  page.click('#restart');
  assert.equal(page.document.getElementById('demo-root').dataset.step, '0');
  assert.equal(page.document.getElementById('demo-root').dataset.beat, '0');
  assert.equal(page.document.getElementById('demo-end').hidden, true);
  page.click('#pause'); assert.equal(page.timers.size, 0);
  page.click('.demo-steps [data-step="1"]'); assert.equal(page.timers.size, 0, 'step change preserves pause');
  page.click('#pause'); assert.equal(page.timers.size, 1);
  page.visibility(true); assert.equal(page.timers.size, 0);
  page.visibility(false); assert.equal(page.timers.size, 1);
  page.visible(false); assert.equal(page.timers.size, 0);
  page.visible(true); assert.equal(page.timers.size, 1);
  page.motion(true); assert.equal(page.timers.size, 0);
  assert.equal(page.document.getElementById('demo-root').dataset.beat, '3');
  page.close();
  const manual = fixture(slug, true);
  assert.equal(manual.timers.size, 0);
  for (let index = 0; index < count; index++) manual.click('#next');
  assert.equal(manual.document.getElementById('demo-end').hidden, false);
  manual.close();
}
const risk = fixture('reactivation');
risk.click('.demo-steps [data-step="1"]');
assert.equal(risk.document.querySelectorAll('.guest-rows .app-row').length, 6);
risk.tick(); risk.tick();
assert.equal(risk.document.querySelectorAll('.guest-rows .app-row').length, 2);
assert.match(risk.document.getElementById('scene').textContent, /Dewi Lestari/);
assert.doesNotMatch(risk.document.getElementById('scene').textContent, /Sari Wulandari/);
risk.click('.demo-steps [data-step="1"]');
assert.equal(risk.document.querySelectorAll('.guest-rows .app-row').length, 6, 'reselection resets scene');
risk.close();
const fallback = fixture('does-not-exist');
assert.match(fallback.document.body.textContent, /Demo ini belum tersedia/);
assert.equal(fallback.document.querySelectorAll('.demo-flow-link').length, 9);
fallback.close();
const library = fixture('');
assert.equal(library.document.querySelectorAll('.demo-flow-link').length, 9);
library.close();
assert.doesNotMatch(html, /(?:config|staff-auth|supabase|app)\.js/);
assert.match(read('_redirects'), /^\/demo\/\* \/demo-library 200$/m);
assert.match(read('.assetsignore'), /^demo$/m, 'private demo tooling remains excluded');
console.log('PASS: nine stories, completion, restart, step reset, pause, background/offscreen, reduced motion, filtering, routing and isolation');
// Check the response before following redirects: a final 200 alone hid the live bug.
const server = require('../scripts/serve-demo-library.cjs');
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const route of ['/demo', '/demo/', ...slugs.flatMap(slug => ['/demo/' + slug, '/demo/' + slug + '/'])]) {
      const response = await fetch(origin + route, { redirect: 'manual' });
      assert.equal(response.status, 200, route + ' must not redirect to the library');
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.url, origin + route);
      assert.match(await response.text(), /\/js\/demo-library.js/);
    }
    const canonical = await fetch(origin + '/demo-library.html', { redirect: 'manual' });
    assert.equal(canonical.status, 307, 'preview models the canonicalization that caused the incident');
    assert.equal(canonical.headers.get('location'), '/demo-library');
    console.log('PASS: all category URLs and trailing slashes serve directly without losing their pathname');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
