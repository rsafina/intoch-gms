const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('js/page-loading.js', 'utf8');
for (const reduced of [false, true]) {
  const dom = new JSDOM('<html data-reserve-loading><body><div id="reserve-loading"><span class="loading-ring"></span></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const frames = new Map();
  let id = 0;
  w.matchMedia = () => ({ matches: reduced, addEventListener() {} });
  w.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  w.cancelAnimationFrame = n => frames.delete(n);
  w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const paths = w.document.querySelectorAll('[data-loading-ribbon]');
  assert.equal(paths.length, 2, 'both reserve and shared loaders use the ribbon');
  assert.equal(new Set([...w.document.querySelectorAll('linearGradient')].map(el => el.id)).size, 2);
  const circle = paths[0].getAttribute('d');
  if (reduced) assert.equal(frames.size, 0, 'reduced motion schedules no animation');
  else {
    const tick = time => { const [key, fn] = [...frames][0]; frames.delete(key); fn(time); };
    tick(0); tick(750);
    const loop = paths[0].getAttribute('d');
    assert.notEqual(loop, circle, 'ring morphs rather than merely rotating');
    assert.equal(loop, paths[1].getAttribute('d'));
    assert.ok(!/NaN|Infinity/.test(loop));
    tick(4000);
    assert.equal(paths[0].getAttribute('d'), circle, 'four-second cycle joins seamlessly');
    w.document.documentElement.removeAttribute('data-reserve-loading');
    w.PageLoading.finish();
    assert.equal(frames.size, 0, 'hidden loaders stop requesting animation frames');
  }
  dom.window.close();
}
console.log('Morphing loader: both screens, smooth loop, reduced motion and cleanup passed');
