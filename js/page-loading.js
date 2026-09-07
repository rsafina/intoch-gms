// Page transitions only. Background refreshes must never cover an active screen.
(() => {
  let generation = 0;
  let timer;
  let overlay;
  let animationFrame = null;
  let animationStart = null;
  const CYCLE_MS = 1500;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  // Follow the base's roughly 60-degree edge up and right, then return to contact.
  function bounceTransform(phase) {
    const progress = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    const flight = Math.min(progress / 0.84, 1);
    const lift = 4 * flight * (1 - flight);
    return 'translate(' + (56 * lift).toFixed(2) + ' ' + (-96 * lift).toFixed(2) + ')';
  }
  function logoMarkup() {
    // Separate vector pieces preserve the mark's cutouts as the top lifts.
    return '<svg class="loading-logo" viewBox="-15 -110 480 558" aria-hidden="true" focusable="false" fill="#3c56a6">' +
      '<path fill-rule="evenodd" d="M160 173 H258 Q285 173 300 200 L349 282 Q362 303 350 325 L299 413 Q288 433 265 433 H19 Q-9 433 4 407 L125 195 Q137 173 160 173 Z M172 195 Q159 195 165 208 L212 287 Q216 295 226 295 H315 Q329 295 322 282 L276 203 Q271 195 262 195 Z" />' +
      '<g data-loading-top transform="translate(0.00 0.00)"><path fill-rule="evenodd" d="M255 0 H357 Q385 0 400 27 L444 106 Q456 127 445 149 L396 233 Q381 260 357 260 H255 Q230 260 217 238 L169 152 Q155 131 169 108 L219 22 Q231 0 255 0 Z M268 22 Q253 22 259 35 L305 113 Q310 121 320 121 H409 Q423 121 417 108 L372 31 Q366 22 356 22 Z" /></g></svg>';
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
      document.querySelectorAll('[data-loading-top]').forEach(piece => piece.setAttribute('transform', bounceTransform(0)));
      return;
    }
    if (animationFrame !== null || !window.requestAnimationFrame) return;
    function frame(now) {
      if (animationStart === null) animationStart = now;
      const phase = ((now - animationStart) / CYCLE_MS) * Math.PI * 2;
      const transform = bounceTransform(phase);
      document.querySelectorAll('[data-loading-top]').forEach(piece => piece.setAttribute('transform', transform));
      animationFrame = window.requestAnimationFrame(frame);
    }
    animationFrame = window.requestAnimationFrame(frame);
  }
  function mount() {
    if (overlay || !document.body) return;
    const reserveRing = document.querySelector('#reserve-loading .loading-ring');
    if (reserveRing) reserveRing.outerHTML = logoMarkup();
    overlay = document.createElement('div');
    overlay.id = 'page-loading';
    overlay.hidden = !root.hasAttribute('data-page-loading');
    overlay.innerHTML = logoMarkup() +
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
