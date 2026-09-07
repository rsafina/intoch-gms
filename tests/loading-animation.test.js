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
  const paths = w.document.querySelectorAll('[data-loading-top]');
  assert.equal(paths.length, 2, 'both reserve and shared loaders use the logo');
  const circle = paths[0].getAttribute('transform');
  // Taken from the source, not restated here: the cycle length is a design
  // knob, and a test that hardcodes it fails every time somebody tunes the
  // speed, which teaches people to edit tests to make them green.
  const cycle = Number(source.match(/CYCLE_MS = (\d+)/)[1]);
  assert.ok(cycle >= 1500 && cycle <= 6000, 'cycle stays in a legible range');
  if (reduced) assert.equal(frames.size, 0, 'reduced motion schedules no animation');
  else {
    const tick = time => { const [key, fn] = [...frames][0]; frames.delete(key); fn(time); };
    tick(0); tick(cycle * 0.19);
    const loop = paths[0].getAttribute('transform');
    assert.notEqual(loop, circle, 'top piece lifts off the base');
    assert.equal(loop, paths[1].getAttribute('transform'));
    assert.ok(!/NaN|Infinity/.test(loop));
    tick(cycle);
    assert.equal(paths[0].getAttribute('transform'), circle, 'the cycle joins itself seamlessly');
    w.document.documentElement.removeAttribute('data-reserve-loading');
    w.PageLoading.finish();
    assert.equal(frames.size, 0, 'hidden loaders stop requesting animation frames');
  }
  dom.window.close();
}
console.log('Bouncing logo loader: both screens, smooth loop, reduced motion and cleanup passed');
