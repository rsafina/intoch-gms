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
  const motionAnimations = [];
  window.HTMLElement.prototype.animate = function () {
    const animation = { element: this, playState: 'running', pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; }, cancel() { this.playState = 'idle'; if (this.oncancel) this.oncancel(); } };
    motionAnimations.push(animation);
    return animation;
  };
  const timers = new Map(); let id = 0; let motionListener; let observer;
  const frames = new Map(); let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = key => frames.delete(key);
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
  return { window, document, timers, motionAnimations,
    frame(now) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); },
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
  assert.equal(page.document.querySelector('.detail-toolbar'), null, 'no screen-selection work for visitors');
  assert.equal(page.document.querySelector('.story-stage').dataset.shot, slug === 'reservation' ? 'main' : 'overview');
  for (let index = 0; index < count * 4; index++) {
    page.tick();
    const stage = page.document.querySelector('.story-stage');
    assert.doesNotMatch(stage.textContent, /\b(Dewi|Rina|Sari|Andi|Bima|Bayu)\b/, 'all visible demo characters use the updated names');
    const beat = page.document.getElementById('demo-root').dataset.beat;
    if (slug === 'reservation') {
      assert.doesNotMatch(stage.textContent, /Dewi/, 'reservation visuals use the approved Michelle identity');
      if (beat === '3') assert.match(stage.textContent, /Michelle/, 'reservation result names Michelle');
    }
    assert.equal(stage.dataset.shot === 'overview', slug !== 'reservation' && beat === '0', slug + ' uses its intended opening camera');
    if (stage.dataset.scene === 'reservation' && beat !== '0') {
      assert.equal(stage.dataset.shot, beat === '3' ? 'main' : 'companion', 'guest form automatically hands off to dashboard');
    }
  }
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
const risk = fixture('customer-insight');
const quick = fixture('walk-in');
const quickScene = () => quick.document.getElementById('scene');
assert.match(quickScene().textContent, /Welcome!.*QUICK WALK-IN.*Jessica.*No walk-ins for today/s);
quick.tick();
assert.match(quickScene().querySelector('.qw-suggestions').textContent, /Jessica.*M-0007/s);
quick.click('.qw-suggestions button');
assert.match(quickScene().querySelector('.qw-phone').textContent, /0072/, 'selecting existing guest fills the phone');
quick.click('.qw-quick > button');
assert.match(quickScene().querySelector('.qw-visit').textContent, /Jessica.*4 pax.*Active/s);
quick.click('.demo-steps [data-step="1"]'); quick.tick();
assert.match(quickScene().querySelector('.qw-suggestions').textContent, /Belum ada tamu yang cocok.*Brian/s);
quick.tick(); quick.tick();
assert.match(quickScene().querySelector('.qw-visit').textContent, /Brian.*1 pax.*Tamu baru/s);
quick.click('.demo-steps [data-step="2"]');
assert.doesNotMatch(quickScene().querySelector('.qw-visit').textContent, /T2/, 'table is not assigned before seating');
quick.click('.qw-row-actions button');
assert.match(quickScene().querySelector('.qw-modal').textContent, /Edit Walk-In.*Brian.*No preference/s);
quick.tick();
assert.match(quickScene().querySelector('.qw-table-pills .selected').textContent, /T2/);
quick.click('.qw-modal-footer button');
assert.equal(quickScene().querySelector('.qw-modal'), null);
assert.match(quickScene().querySelector('.qw-visit').textContent, /Brian.*4 pax.*T2.*Indoor.*Dekat jendela/s);
quick.close();
const guestDatabase = fixture('customer-database');
const databaseScene = () => guestDatabase.document.getElementById('scene');
assert.equal(databaseScene().querySelectorAll('.db-row').length, 6, 'search starts with the guest database');
assert.equal(databaseScene().querySelector('.db-query').textContent, 'Michelle');
guestDatabase.tick();
assert.equal(databaseScene().querySelectorAll('.db-row').length, 1, 'typing filters to the matching guest');
assert.match(databaseScene().querySelector('.db-row').textContent, /Michelle/);
assert.equal(databaseScene().querySelector('.db-profile'), null, 'finding a name does not open the profile');
guestDatabase.tick();
assert.ok(databaseScene().querySelector('.db-eye-active'), 'camera sequence highlights the eye before opening');
guestDatabase.click('[data-db-eye]');
assert.match(databaseScene().querySelector('.db-profile').textContent, /Michelle.*AVERAGE SPEND.*Rp310.000.*Suka meja teras.*VISIT HISTORY \(4 VISITS\)/s);
guestDatabase.click('[data-db-close]');
assert.equal(databaseScene().querySelector('.db-profile'), null, 'close returns to the search result');
guestDatabase.click('.demo-steps [data-step="1"]');
assert.equal(databaseScene().querySelector('.db-query').textContent, 'Jessica');
guestDatabase.tick(); guestDatabase.tick(); guestDatabase.tick();
assert.match(databaseScene().querySelector('.db-profile').textContent, /Jessica.*M-0007.*8 stickers.*2 vouchers.*Open member card.*Rp350.000.*VISIT HISTORY \(8 VISITS\)/s);
guestDatabase.close();
for (const stepIndex of [0, 1]) {
  const scrolling = fixture('customer-database');
  scrolling.click(`.demo-steps [data-step="${stepIndex}"]`);
  scrolling.tick(); scrolling.tick(); scrolling.tick();
  const profile = scrolling.document.querySelector('.db-profile');
  Object.defineProperty(profile, 'scrollHeight', { value: 800 });
  Object.defineProperty(profile, 'clientHeight', { value: 240 });
  scrolling.frame(0); scrolling.frame(1000);
  assert.equal(profile.scrollTop, 0, 'profile identity holds before scrolling');
  scrolling.frame(3200);
  assert.equal(profile.scrollTop, 252, 'spending and notes receive a middle stop');
  scrolling.click('#pause'); scrolling.frame(6000);
  assert.equal(profile.scrollTop, 252, 'pause freezes automatic profile scroll');
  scrolling.click('#pause'); scrolling.frame(7000); scrolling.frame(10400);
  assert.equal(profile.scrollTop, 560, 'resume reaches visit history without user scrolling');
  scrolling.click('#restart'); scrolling.frame(14000);
  assert.equal(scrolling.document.querySelector('.db-profile'), null, 'restart cancels profile scrolling');
  scrolling.close();
}
const relationship = fixture('reactivation');
const relScene = () => relationship.document.getElementById('scene');
const relPhone = () => relationship.document.getElementById('companion-screen');
assert.match(relScene().textContent, /Update.*Issue ticket.*Follow up/s, 'reservation row shows the dashboard actions');
assert.ok(relScene().querySelector('[data-rel="follow"][data-scene-action]'));
relationship.tick();
assert.match(relPhone().textContent, /Michelle.*mengonfirmasi reservasi.*19:00.*4 orang/s, 'follow up fills the confirmation message');
assert.equal(relationship.document.querySelector('.story-stage').dataset.shot, 'companion');
relationship.tick();
assert.match(relPhone().textContent, /Dikirim staf/);
relationship.click('.demo-steps [data-step="1"]');
assert.ok(relScene().querySelector('[data-rel="ticket"][data-scene-action]'));
relationship.tick();
assert.match(relScene().textContent, /Tiket konfirmasi.*reservation-ticket/s);
relationship.tick();
assert.match(relPhone().textContent, /TIKET RESERVASI.*Michelle.*19:00/s, 'ticket lands in the guest WhatsApp');
relationship.click('.demo-steps [data-step="2"]');
assert.match(relScene().textContent, /Brian.*Walk-in.*Done.*Michelle.*Reservasi.*WA Thanks/s, 'walk-in and reservation both appear');
assert.equal(relScene().querySelector('[data-key="BR"] [data-rel="thanks"]'), null, 'WA Thanks waits for Done');
const walkInRow = relScene().querySelector('[data-key="BR"]');
relationship.tick();
assert.equal(relScene().querySelector('[data-key="BR"]'), walkInRow, 'walk-in row updates in place');
assert.ok(relScene().querySelector('[data-key="BR"] [data-rel="thanks"]'), 'Done reveals WA Thanks');
relationship.tick();
assert.match(relPhone().textContent, /Brian.*Terima kasih atas kunjungan/s);
relationship.close();
const targetedCampaign = fixture('campaign');
const campScene = () => targetedCampaign.document.getElementById('scene');
const pendingCards = () => campScene().querySelectorAll('.seg-card.pending').length;
assert.equal(pendingCards(), 2, 'Acquire appears first');
targetedCampaign.tick(); assert.equal(pendingCards(), 1, 'Retain appears second');
targetedCampaign.tick(); assert.equal(pendingCards(), 0, 'At Risk appears third');
assert.match(campScene().textContent, /ACQUIRE.*20.*RETAIN.*23.*AT RISK.*14/s);
targetedCampaign.click('.demo-steps [data-step="1"]');
assert.ok(campScene().querySelector('[data-seg="retain"] [data-scene-action]'), 'Buat Campaign Tamu Kembali is clickable');
targetedCampaign.tick();
assert.match(campScene().textContent, /Campaign Baru.*Promo Dessert - Oktober.*Pilih segmen/s, 'naming screen opens');
targetedCampaign.tick();
assert.equal(campScene().querySelectorAll('.camp-option').length, 8, 'segment dropdown lists every segment');
assert.equal(campScene().querySelector('.camp-option.active').textContent, 'Tamu yang kembali');
targetedCampaign.tick();
assert.match(campScene().textContent, /23 guest.*nomor WA valid/s, 'segment selection shows the audience');
targetedCampaign.click('.demo-steps [data-step="2"]');
assert.ok(campScene().querySelector('.camp-submit[data-scene-action]'), 'Buat Campaign submits the modal');
targetedCampaign.tick();
assert.match(campScene().textContent, /Terima kasih sudah berkunjung/);
assert.match(campScene().textContent, /sebelum 31 Oktober.*kesempatan menikmati dessert gratis/s);
targetedCampaign.tick();
assert.match(campScene().textContent, /Penerima \(23\).*Jessica.*Kirim WA/s, 'recipient list is shown');
targetedCampaign.tick();
assert.match(targetedCampaign.document.getElementById('companion-screen').textContent, /Jessica.*Terima kasih sudah berkunjung/s, 'message reaches the first recipient');
assert.doesNotMatch(campScene().textContent, /Brian|Michelle/, 'returning audience excludes non-returning guests');
targetedCampaign.close();
risk.click('.demo-steps [data-step="1"]');
const persistentGuest = risk.document.querySelector('[data-key="MI"]');
assert.equal(risk.document.querySelectorAll('.guest-rows .app-row').length, 6);
risk.tick(); risk.tick();
assert.equal(risk.document.querySelector('[data-key="MI"]'), persistentGuest, 'retained guests update in place without remounting');
assert.equal(risk.document.querySelectorAll('.guest-rows .app-row').length, 2);
assert.match(risk.document.getElementById('scene').textContent, /Michelle/);
assert.doesNotMatch(risk.document.getElementById('scene').textContent, /Jessica/);
risk.click('.demo-steps [data-step="1"]');
assert.equal(risk.document.querySelectorAll('.guest-rows .app-row').length, 6, 'reselection resets scene');
risk.close();
const paired = fixture('reservation');
assert.ok(paired.document.querySelector('.rsv-brand-focus img'), 'reservation opens on the restaurant logo');
assert.match(paired.document.getElementById('scene').textContent, /BOOK A TABLE/);
const phoneFrame = paired.document.getElementById('scene');
const fieldNode = paired.document.querySelector('.rsv-form .pf-in');
paired.tick();
assert.equal(paired.document.querySelector('.rsv-form .pf-in'), fieldNode, 'form fields persist across beats');
paired.click('#pause');
assert.ok(paired.motionAnimations.filter(animation => animation.playState !== 'idle').every(animation => animation.playState === 'paused'), 'pause freezes active UI and cursor animations');
paired.click('#pause');
assert.ok(paired.motionAnimations.filter(animation => animation.playState !== 'idle').every(animation => animation.playState === 'running'), 'resume continues active animations');
paired.tick(); paired.tick();
assert.equal(paired.document.getElementById('scene'), phoneFrame);
assert.match(phoneFrame.textContent, /Reservasi diterima/);
paired.click('.demo-steps [data-step="1"]');
assert.match(phoneFrame.textContent, /Booking follow-ups.*Michelle.*21:00.*4 pax/s);
paired.tick();
assert.match(phoneFrame.textContent, /Upcoming Reservations.*Unassigned.*Online Form · 0 visits/s);
paired.tick();
assert.ok(phoneFrame.querySelector('.rsv-edit'));
paired.tick();
assert.match(phoneFrame.textContent, /OUT4.*Reserved/s);
paired.click('.demo-steps [data-step="2"]');
paired.tick(); paired.tick(); paired.tick();
assert.match(phoneFrame.querySelector('.db-profile').textContent, /Michelle.*No visits with spend recorded.*26 Sep 2026.*21:00.*4 pax.*VISIT HISTORY \(0 VISITS\)/s);
paired.motion(true);
assert.ok(paired.document.querySelector('.story-stage.reduced-motion'));
assert.ok(paired.motionAnimations.every(animation => animation.playState === 'idle'), 'reduced motion cancels all active animation effects');
paired.close();
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
