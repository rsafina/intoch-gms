// Page transitions only. Background refreshes must never cover an active screen.
(() => {
  let generation = 0;
  let timer;
  let overlay;
  let animationFrame = null;
  let animationStart = null;
  // One full circle -> infinity -> circle, in milliseconds. The single knob
  // for how fast the loader reads: lower is busier, higher is calmer. Below
  // about 1500 the fold stops being legible and just flickers.
  const CYCLE_MS = 2200;
  let animationId = 0;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  // A closed ribbon that folds from a circle into an uneven infinity and
  // opens back, once every four seconds.
  //
  //   t     0 -> 1 -> 0   how far the fold has gone. 0 is the circle, 1 is the
  //                       full figure-eight (Gerono lemniscate: y carries an
  //                       extra cos, which is what pinches the middle).
  //   s                   which loop is the big one. It swaps sign across the
  //                       cycle, so the two loops trade places instead of the
  //                       shape merely pulsing.
  //   f                   the same skew applied to BOTH axes, so the small
  //                       loop closes to a blob rather than flattening into a
  //                       sliver. Multiplied by t so it vanishes as the shape
  //                       returns: skew left in at t=0 dents the circle, which
  //                       reads as a rendering fault rather than a motion.
  //
  // Every term is periodic in `phase`, so the loop joins itself with no jump.
  function ribbonPath(phase) {
    const t = (1 - Math.cos(phase)) / 2;
    const s = 0.62 * Math.sin(phase);
    const r = 45 - 6 * t; // the fold is wider than the circle; give it room
    const points = [];
    // 180 samples. At 128 the crossing point showed a visible corner on a
    // desktop-sized loader.
    for (let i = 0; i < 180; i++) {
      const angle = (i / 180) * Math.PI * 2;
      const f = 1 + s * t * Math.cos(angle);
      const x = 70 + r * Math.cos(angle) * f;
      const y = 70 + r * Math.sin(angle) * ((1 - t) + t * Math.cos(angle)) * f;
      points.push((i ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2));
    }
    return points.join(' ') + ' Z';
  }
  function ribbonMarkup() {
    const id = 'loading-brand-gradient-' + ++animationId;
    return '<svg class="loading-ribbon" viewBox="0 0 140 140" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" ' +
      'x1="18" y1="0" x2="122" y2="0">' +
      // Light to dark to accent, in that order. Brand-first put the darkest
      // colour hard against the left edge and left the middle of the ring
      // paler than both ends, which reads as a washed-out shape rather than a
      // sweep. Each page supplies its own three; the fallbacks are the staff
      // app's, for the one frame before its stylesheet lands.
      '<stop offset="0" style="stop-color:var(--brand-light, #245A8D)" />' +
      '<stop offset="0.52" style="stop-color:var(--brand, #173B64)" />' +
      '<stop offset="1" style="stop-color:var(--accent, #F9A825)" />' +
      '</linearGradient></defs><path data-loading-ribbon d="' + ribbonPath(0) +
      '" fill="none" stroke="url(#' + id + ')" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" /></svg>';
  }
  function syncMotion() {
    // The observer can fire one microtask after the document has gone (a
    // closed window, a teardown mid-navigation). Reading `document.hidden`
    // then throws, and an uncaught error from a loading overlay is the last
    // thing anyone wants in a console they are already debugging.
    if (!document || !document.documentElement) return;
    const active = !document.hidden && (root.hasAttribute('data-page-loading') ||
      root.hasAttribute('data-reserve-loading'));
    if (!active || reducedMotion?.matches) {
      if (animationFrame !== null) window.cancelAnimationFrame?.(animationFrame);
      animationFrame = null;
      animationStart = null;
      document.querySelectorAll('[data-loading-ribbon]').forEach(path => path.setAttribute('d', ribbonPath(0)));
      return;
    }
    if (animationFrame !== null || !window.requestAnimationFrame) return;
    function frame(now) {
      if (animationStart === null) animationStart = now;
      const phase = ((now - animationStart) / CYCLE_MS) * Math.PI * 2;
      const d = ribbonPath(phase);
      document.querySelectorAll('[data-loading-ribbon]').forEach(path => path.setAttribute('d', d));
      animationFrame = window.requestAnimationFrame(frame);
    }
    animationFrame = window.requestAnimationFrame(frame);
  }
  function mount() {
    if (overlay || !document.body) return;
    const reserveRing = document.querySelector('#reserve-loading .loading-ring');
    if (reserveRing) reserveRing.outerHTML = ribbonMarkup();
    overlay = document.createElement('div');
    overlay.id = 'page-loading';
    overlay.hidden = !root.hasAttribute('data-page-loading');
    overlay.innerHTML = ribbonMarkup() +
      // One word, both languages. "Loading" needs no translating for an
      // Indonesian reader and the doubled line was the widest thing on the
      // screen; the failure message below still switches, because that one
      // asks the guest to do something.
      '<p role="status" aria-live="polite">Loading…</p>' +
      '<button type="button" hidden>Coba lagi / Try again</button>';
    overlay.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(overlay);
    syncMotion();
  }
  function fail(token = generation) {
    if (token !== generation) return;
    clearTimeout(timer);
    mount();
    if (!overlay) return;
    overlay.querySelector('p').textContent = root.lang === 'en'
      ? 'Loading is taking longer than expected. Please try again.'
      : 'Halaman belum selesai dimuat. Silakan coba lagi.';
    overlay.querySelector('button').hidden = false;
  }
  function begin() {
    const token = ++generation;
    clearTimeout(timer);
    root.setAttribute('data-page-loading', '');
    mount();
    if (overlay) {
      overlay.hidden = false;
      overlay.querySelector('p').textContent = 'Loading…';
      overlay.querySelector('button').hidden = true;
    }
    timer = setTimeout(() => fail(token), 15000);
    syncMotion();
    return token;
  }
  function finish(token = generation) {
    if (token !== generation) return;
    clearTimeout(timer);
    root.removeAttribute('data-page-loading');
    if (overlay) overlay.hidden = true;
    syncMotion();
  }
  async function ready(work) {
    const token = generation;
    try { await work; finish(token); }
    catch (error) { console.warn('Page loading failed', error); fail(token); }
  }
  window.PageLoading = { begin, finish, fail, ready };
  if (root.hasAttribute('data-page-loading')) begin();
  document.addEventListener('DOMContentLoaded', mount);
  new MutationObserver(syncMotion).observe(root, {
    attributes: true, attributeFilter: ['data-page-loading', 'data-reserve-loading'],
  });
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion?.addEventListener('change', syncMotion);
  window.addEventListener('pageshow', event => { if (event.persisted) finish(); });
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') ||
        (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    begin();
  });
})();
