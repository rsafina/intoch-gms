/* One-hour playground sessions. Browser state is presentation only: every query
 * is authorized independently by workspace RLS and the database clock.
 * Loaded before config.js; no credentials or generated configuration live here.
 */
(function () {
  'use strict';
  const PROJECT = 'https://hkrhsubhfqrgqkuhpvql.supabase.co';
  const PAGES = new Set(['dashboard', 'reservations', 'walkins', 'reports']);
  const requested = () => new URL(location.href).searchParams.get('demo') === '1';
  let staffClient, guestClient, session = null, selected = false, busy = false;
  let epoch = 0, timer = null, validating = false, overlay = null, widget = null;
  let deadline = 0, authSubscription = null, notificationAnchor = null;
  const text = (en, id) => typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'id' ? id : en;
  function allowed() {
    return typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL === PROJECT &&
      window.INTOCH_DEMO_TOUR_ENV?.origins.includes(location.origin);
  }
  function profile() {
    return selected && session?.active ? { id: session.id, auth_user_id: session.user_id,
      role: 'demo_guest', display_name: text('Demo Guest', 'Tamu Demo'), can_waive_deposit: false } : null;
  }
  function active() { return !!profile() && performance.now() < deadline; }
  function forbidden() {
    return new Response(JSON.stringify({ message: 'Demo access ended', code: '42501' }), {
      status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  function client() {
    if (!allowed()) throw new Error('Demo is available only in the approved playground');
    if (!guestClient) guestClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: 'intoch-demo-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: async (url, options) => {
        const token = epoch, address = new URL(String(url));
        if (address.origin !== PROJECT) return forbidden();
        // Server status and end operations remain callable after local expiry.
        const dataRequest = address.pathname.startsWith('/rest/v1/') &&
          !['/rest/v1/rpc/demo_session_status', '/rest/v1/rpc/demo_end_session'].includes(address.pathname);
        if (dataRequest && session && !active()) { ended(); return forbidden(); }
        const result = await fetch(url, options);
        if (dataRequest && (token !== epoch || (session && !active()))) return forbidden();
        return result;
      } },
    });
    return guestClient;
  }
  window.createDemoDatabase = original => {
    staffClient = original;
    return new Proxy(original, { get(target, property) {
      if (!selected) { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
      const demo = client();
      if (property === 'from') return name => demo.schema('intoch_demo').from(name);
      if (property === 'rpc') return (name, args, options) =>
        (name.startsWith('demo_') ? demo : demo.schema('intoch_demo')).rpc(name, args, options);
      if (property === 'storage' || property === 'functions') return new Proxy({}, { get() { return () => { throw new Error('Unavailable in demo'); }; } });
      const value = Reflect.get(demo, property); return typeof value === 'function' ? value.bind(demo) : value;
    } });
  };
  function button(label, action, primary = false) {
    const node = document.createElement('button'); node.type = 'button';
    node.className = primary ? 'btn-primary' : 'btn-ghost'; node.textContent = label;
    node.addEventListener('click', action); return node;
  }
  function screen(title, message, retry = false, fresh = false) {
    overlay?.remove(); overlay = document.createElement('section');
    overlay.id = 'demo-session-screen'; overlay.className = 'demo-session-screen';
    const panel = document.createElement('div'); panel.className = 'demo-session-panel';
    const brand = document.createElement('p'); brand.className = 'demo-session-eyebrow'; brand.textContent = 'INTOCH DEMO';
    const heading = document.createElement('h1'); heading.textContent = title;
    const copy = document.createElement('p'); copy.textContent = message;
    panel.append(brand, heading, copy);
    const captcha = document.createElement('div'); captcha.id = 'demo-session-captcha'; panel.append(captcha);
    if (retry) panel.append(button(text('Try Again', 'Coba Lagi'), () => bootstrap(), true));
    if (fresh) panel.append(button(text('Start Another Demo', 'Mulai Demo Baru'), () => restart(), true));
    const contact = document.createElement('a'); contact.href = 'https://intoch.app/landing.html#kontak';
    contact.className = 'btn-ghost'; contact.textContent = text('Contact Intoch', 'Hubungi Intoch');
    const admin = document.createElement('a'); const address = new URL(location.href); address.searchParams.delete('demo');
    admin.href = address.href; admin.textContent = text('Admin Login', 'Login Admin'); admin.className = 'demo-session-admin';
    panel.append(contact, admin); overlay.append(panel); document.body.append(overlay);
    if (typeof PageLoading !== 'undefined') PageLoading.finish();
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
  }
  async function captcha(selector = '#demo-session-captcha') {
    const sitekey = typeof DEMO_TURNSTILE_SITE_KEY !== 'undefined' ? DEMO_TURNSTILE_SITE_KEY : '';
    if (!sitekey || sitekey.startsWith('__')) throw new Error('Demo security check is not configured yet');
    if (!window.turnstile) await new Promise((resolve, reject) => {
      let script = document.getElementById('demo-turnstile-script');
      const timeout = setTimeout(() => reject(new Error('Security check unavailable')), 15000);
      const done = () => { clearTimeout(timeout); window.turnstile ? resolve() : reject(new Error('Security check unavailable')); };
      if (script) script.remove();
      script = document.createElement('script'); script.id = 'demo-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Security check unavailable')); }, { once: true });
      document.head.append(script);
    });
    if (widget !== null) window.turnstile.remove(widget);
    return new Promise((resolve, reject) => {
      widget = window.turnstile.render(selector, { sitekey, action: 'intoch-demo', size: 'flexible',
        callback: token => {
          if (selector === '#demo-session-captcha') loading();
          resolve(token);
        },
        'before-interactive-callback': () => {
          // Provisioning needs a second single-use token. Reveal its challenge
          // if interaction is required, rather than trapping it behind loading.
          if (selector === '#demo-session-captcha') {
            overlay?.classList.remove('is-loading');
            if (typeof PageLoading !== 'undefined') PageLoading.finish();
          }
        },
        'error-callback': () => reject(new Error('Please repeat the security check')),
        'expired-callback': () => reject(new Error('Please repeat the security check')) });
    });
  }
  function loading() {
    overlay?.classList.add('is-loading');
    if (typeof PageLoading !== 'undefined') PageLoading.begin();
  }
  async function staffCaptcha() {
    if (!allowed() || typeof DEMO_TURNSTILE_SITE_KEY === 'undefined' ||
        !DEMO_TURNSTILE_SITE_KEY || DEMO_TURNSTILE_SITE_KEY.startsWith('__')) return undefined;
    try { return await captcha('#login-captcha'); }
    finally {
      if (widget !== null && window.turnstile) window.turnstile.remove(widget);
      widget = null;
    }
  }
  function accept(value) {
    const expiry = Date.parse(value?.expires_at), server = Date.parse(value?.server_now), start = Date.parse(value?.started_at);
    if (!value?.active || !value.id || !value.user_id || !Number.isFinite(expiry) || !Number.isFinite(server) ||
        expiry - start !== 3600000 || expiry <= server) throw new Error('Demo ended');
    session = value; deadline = performance.now() + expiry - server;
  }
  async function validate() {
    if (!selected || !session || validating) return;
    validating = true; const token = epoch;
    try {
      const result = await client().rpc('demo_session_status');
      if (token !== epoch) return;
      if (!result.error && (!result.data?.active || result.data.id !== session.id || result.data.user_id !== session.user_id)) return ended();
      if (!result.error) accept(result.data);
    } catch { /* Existing deadline keeps counting when disconnected. */ }
    finally { validating = false; }
  }
  function tick() {
    if (!session) return;
    const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    const node = document.getElementById('demo-session-clock');
    if (node) node.textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    if (!seconds) ended();
    else if (seconds % 15 === 0) validate();
  }
  function attach() {
    document.documentElement.classList.add('demo-guest-mode');
    overlay?.remove(); overlay = null;
    const banner = document.createElement('aside'); banner.id = 'demo-session-banner'; banner.className = 'demo-session-banner';
    const status = document.createElement('div'); status.className = 'demo-session-status';
    const label = document.createElement('strong'); label.textContent = text('Demo Mode', 'Mode Demo');
    const remaining = document.createElement('span'); remaining.className = 'demo-session-remaining';
    const caption = document.createElement('span'); caption.textContent = text('Time left', 'Sisa waktu');
    const clock = document.createElement('span'); clock.id = 'demo-session-clock'; clock.setAttribute('aria-label', text('Time remaining', 'Sisa waktu'));
    remaining.append(caption, clock); status.append(label, remaining);
    banner.append(status, button(text('Exit Demo', 'Keluar Demo'), () => exit()));
    document.getElementById('demo-session-banner')?.remove(); document.getElementById('app-main').prepend(banner);
    const notifications = document.getElementById('bd-alert-wrap');
    if (notifications) {
      notificationAnchor = document.createComment('Demo notification position');
      notifications.before(notificationAnchor); banner.append(notifications);
    }
    const logout = document.getElementById('sidebar-logout'); if (logout) logout.textContent = text('Exit Demo', 'Keluar Demo');
    const guide = document.getElementById('demo-guide');
    if (guide) {
      const copy = guide.querySelector('p');
      if (copy) copy.textContent = text('Try Dashboard, Reservations, Walk-Ins and Reports for one hour using sample restaurant data. Follow a guide or explore on your own.',
        'Coba Dashboard, Reservasi, Walk-In, dan Laporan selama 1 jam dengan data contoh restoran. Ikuti panduan atau jelajahi sendiri.');
      guide.querySelector('ol')?.remove();
    }
    timer = setInterval(tick, 1000); tick();
    window.addEventListener('focus', validate); window.addEventListener('online', validate);
    document.addEventListener('visibilitychange', validate);
    authSubscription = client().auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') setTimeout(ended, 0);
      else if (['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) setTimeout(validate, 0);
    }).data?.subscription;
    if (typeof PageLoading !== 'undefined') PageLoading.finish();
  }
  function teardown() {
    epoch++; clearInterval(timer); timer = null;
    authSubscription?.unsubscribe(); authSubscription = null;
    window.removeEventListener('focus', validate); window.removeEventListener('online', validate);
    document.removeEventListener('visibilitychange', validate);
    window.DemoTour?.teardown(); window.DemoBookingTour?.teardown();
    if (typeof teardownRealtimeUpdates === 'function') teardownRealtimeUpdates();
    if (typeof teardownOnlineResNotify === 'function') teardownOnlineResNotify();
    if (typeof guestLoadGeneration !== 'undefined') guestLoadGeneration++;
    if (typeof guestProfileGeneration !== 'undefined') guestProfileGeneration++;
    if (typeof allGuests !== 'undefined') allGuests = [];
    if (typeof allReservations !== 'undefined') allReservations = [];
    if (typeof allAreas !== 'undefined') allAreas = [];
    if (typeof allTables !== 'undefined') allTables = [];
    if (typeof dashboardResData !== 'undefined') dashboardResData = [];
    if (typeof dashboardWalkinData !== 'undefined') dashboardWalkinData = [];
    if (typeof APP_SETTINGS !== 'undefined') APP_SETTINGS = {};
    document.querySelectorAll('.modal').forEach(node => node.classList.add('hidden'));
    const notifications = document.getElementById('bd-alert-wrap');
    if (notificationAnchor && notifications) notificationAnchor.replaceWith(notifications);
    notificationAnchor = null;
    document.getElementById('demo-session-banner')?.remove();
    document.documentElement.classList.remove('demo-guest-mode');
    document.getElementById('app-sidebar')?.classList.add('hidden'); document.getElementById('app-main')?.classList.add('hidden');
    document.getElementById('sidebar-mobile-toggle')?.classList.add('hidden');
    document.body.classList.remove('sidebar-drawer-open');
    session = null;
  }
  function ended() {
    if (!selected) return;
    teardown();
    screen(text('Demo Ended', 'Demo Berakhir'), text('Your one-hour demo has ended. Start again with a fresh set of sample data.',
      'Demo satu jam Anda telah berakhir. Mulai lagi dengan data contoh yang baru.'), false, true);
  }
  async function exit() {
    if (!selected) return false;
    const result = await client().rpc('demo_end_session');
    if (result.error) { screen(text('Could not end the demo', 'Demo belum dapat diakhiri'), text('Reconnect and try exiting again. Your original expiry is unchanged.', 'Hubungkan kembali dan coba keluar lagi. Waktu berakhir tidak berubah.'), true); return true; }
    teardown(); await client().auth.signOut({ scope: 'local' }); ended(); return true;
  }
  async function restart() {
    if (busy) return;
    await client().rpc('demo_end_session');
    teardown(); await client().auth.signOut({ scope: 'local' });
    location.reload();
  }
  async function bootstrap() {
    if (!requested()) return false;
    if (busy) return true;
    if (session) teardown();
    selected = true; busy = true;
    screen(text('Try Intoch for 1 hour', 'Coba Intoch selama 1 jam'),
      text('No account needed. Complete the security check to start exploring with sample restaurant data. Your hour starts when the demo is ready.',
        'Tanpa membuat akun. Selesaikan verifikasi keamanan untuk mencoba Intoch dengan data contoh restoran. Waktu 1 jam dimulai setelah demo siap.'));
    try {
      if (!allowed()) throw new Error('Demo is available only in the approved playground');
      const activate = async () => {
      const demo = client(); const identity = await demo.auth.getUser();
      if (identity.error && identity.error.name !== 'AuthSessionMissingError') throw new Error('Could not verify the demo session. Please reconnect and retry.');
      if (identity.data?.user && !identity.data.user.is_anonymous) throw new Error('Use Admin Login for staff accounts');
      if (identity.data?.user) {
        loading();
        const status = await demo.rpc('demo_session_status');
        if (status.error) throw new Error('Demo service unavailable');
        if (status.data && !status.data.active) { ended(); return true; }
        if (status.data) accept(status.data);
      } else {
        const authentication = await demo.auth.signInAnonymously({ options: { captchaToken: await captcha(), data: { intoch_demo_version: 1 } } });
        if (authentication.error) throw new Error('Could not start temporary authentication');
      }
      if (!session) {
        const creation = await demo.functions.invoke('demo-start', { body: { captchaToken: await captcha() } });
        if (creation.error) throw new Error('Could not prepare your demo. Please try again.');
        accept(creation.data);
      }
      };
      // Serialize activation across tabs sharing this browser's demo storage.
      if (navigator.locks) await navigator.locks.request('intoch-demo-activation', activate);
      else await activate();
      if (!session || !active()) { ended(); return true; }
      await initializeApplication('dashboard');
      if (!active()) { ended(); return true; }
      attach();
      return true;
    } catch (error) {
      screen(text('Demo temporarily unavailable', 'Demo sementara belum tersedia'),
        error.message, true, allowed()); return true;
    } finally { busy = false; }
  }
  window.DemoSession = Object.freeze({ bootstrap, selected: () => selected, active, profile,
    permits: page => active() && PAGES.has(page), exit, restart, validate, ended,
    staffClient: () => staffClient, staffCaptcha });
})();
