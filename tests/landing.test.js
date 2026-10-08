const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
function load({ reduced = false, hash = '' } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'landing.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://intoch.app/' + hash });
  const w = dom.window;
  let scheduled = 0;
  w.matchMedia = () => ({ matches: reduced, addEventListener() {} });
  w.IntersectionObserver = class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ isIntersecting: true }]); } };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.setTimeout = () => { scheduled++; return scheduled; };
  for (const file of ['landing-i18n.js', 'landing.js']) w.eval(fs.readFileSync(path.join(root, 'js', file), 'utf8'));
  return { dom, w, doc: w.document, scheduled: () => scheduled };
}
{
  const { dom, w, doc } = load();
  const tab = doc.getElementById('feature-t1');
  tab.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(doc.activeElement.id, 'feature-t2');
  assert.equal(doc.getElementById('feature-p1').hidden, true);
  assert.equal(doc.getElementById('feature-p2').hidden, false);
  doc.getElementById('feature-t2').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(doc.activeElement.id, 'feature-t3');
  const title = doc.querySelector('h1').innerHTML;
  doc.getElementById('langToggle').click();
  assert.equal(doc.documentElement.lang, 'en');
  assert.match(doc.querySelector('h1').textContent, /Know your guests/);
  assert.equal(doc.getElementById('feature-t3').getAttribute('aria-selected'), 'true');
  doc.getElementById('langToggle').click();
  assert.equal(doc.querySelector('h1').innerHTML, title);
  doc.getElementById('navToggle').click();
  assert.equal(doc.getElementById('navToggle').getAttribute('aria-expanded'), 'true');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.getElementById('navToggle').getAttribute('aria-expanded'), 'false');
  doc.querySelector('#uc-p1 [data-demo-step="2"]').click();
  assert.equal(doc.getElementById('uc-p1').dataset.phase, '2');
  assert.equal(doc.querySelector('#uc-p1 .demo-pause').getAttribute('aria-pressed'), 'true');
  doc.getElementById('uc-t4').click();
  assert.equal(doc.getElementById('uc-p4').hidden, false);
  assert.equal(doc.querySelector('#uc-p4 .demo-pause').getAttribute('aria-pressed'), 'true');
  assert.ok(doc.getElementById('uc-p4').classList.contains('demo-static'), 'Changing scenarios while paused must expose a complete static step');
  doc.getElementById('uc-t1').click();
  doc.querySelector('#uc-p1 .demo-replay').click();
  assert.equal(doc.getElementById('uc-p1').dataset.phase, '1');
  assert.equal(doc.querySelector('#uc-p1 .demo-pause').getAttribute('aria-pressed'), 'false');
  doc.getElementById('uc-t4').click();
  assert.equal(doc.getElementById('uc-p1').hidden, true);
  assert.equal(doc.getElementById('uc-p4').hidden, false);
  assert.equal(doc.querySelector('#uc-p4 .v2-steps .current').dataset.step, '1');
  assert.match(doc.getElementById('waLink').href, /^https:\/\/wa.me\/6281325063362/);
  dom.window.close();
}
{
  const { dom, doc, scheduled } = load({ reduced: true, hash: '#solusi' });
  assert.equal(doc.getElementById('solusi').hidden, false);
  assert.equal(doc.getElementById('compare-new').getAttribute('aria-selected'), 'true');
  assert.equal(doc.getElementById('uc-p1').dataset.phase, '3');
  assert.equal(scheduled(), 0, 'Reduced motion must not autoplay');
  assert.equal(doc.querySelector('#uc-p1 .demo-pause').hidden, true);
  doc.querySelector('#uc-p1 [data-demo-step="1"]').click();
  assert.equal(doc.getElementById('uc-p1').dataset.phase, '1');
  assert.equal(scheduled(), 0);
  dom.window.close();
}
console.log('Landing interactions: keyboard tabs, translations, menu, demo controls, contact links, hash navigation, and reduced motion passed.');
