// ============================================================
// SCREENSHOT CAPTURE FOR THE STAFF MANUALS
// ============================================================
// Produces every screenshot the manuals use, with numbered badges drawn on
// top, into one folder under FIXED file names. The manual build reads that
// folder, so refreshing all the pictures after a UI change is one command
// instead of an afternoon with a snipping tool.
//
// ── RUN IT WHERE THE APP IS REACHABLE ───────────────────────────────────
// Claude's cloud workspace is blocked from *.intoch.app by the egress
// policy (the proxy answers 403 to CONNECT), so this runs on Rere's own
// machine. One-time setup, in the repo folder:
//
//   npm i -D playwright
//   npx playwright install chromium
//
// Then, in PowerShell:
//
//   $env:APP_URL="https://demo.intoch.app"; $env:STAFF_USER="demo"; $env:STAFF_PIN="1234"
//   node scripts/capture-manual-screens.mjs
//
// Public guest pages only, no login and no guest data on screen:
//
//   $env:PUBLIC_URL="https://demo.intoch.app"; node scripts/capture-manual-screens.mjs --public
//
// See which files exist and which are still missing:
//
//   node scripts/capture-manual-screens.mjs --list
//
// ── WHICH DATABASE ──────────────────────────────────────────────────────
// Point this at a DEMO project seeded from demo/, never production. A
// printed manual leaves the building, and production screens carry real
// names, phone numbers and spend.
//
// --anonymize is the fallback when only production exists: it rewrites
// guest names and phone numbers in the rendered page before each shot. It
// is BEST EFFORT and changes nothing in the database. Any element it does
// not know about keeps its real text, so every image still has to be looked
// at before the manual ships. Demo data remains the real answer.
//
// ── WHY BADGES ARE PLACED BY SELECTOR ───────────────────────────────────
// Each numbered badge is anchored to an element by CSS selector, not to
// pixel coordinates, so a layout change moves the badge with its field
// rather than leaving it pointing at empty space.
// ============================================================
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
// Resolve playwright from wherever it is installed, so this runs from any
// folder without needing a node_modules beside it.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const OUT = process.env.OUT || path.join(process.cwd(), 'docs', 'screens');
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || APP_URL).replace(/\/$/, '');
const STAFF_USER = process.env.STAFF_USER || '';
const STAFF_PIN = process.env.STAFF_PIN || '';
const PUBLIC_ONLY = process.argv.includes('--public');
const ANONYMIZE = process.argv.includes('--anonymize');
const LIST_ONLY = process.argv.includes('--list');

const INK = '#1F3864';

// Every file the manuals expect. Keep the names stable: the document looks
// them up by name, and renaming one silently turns a picture back into a
// placeholder frame.
const EXPECTED = [
  ['02-login', 'Layar login'],
  ['02-menu-sidebar', 'Menu di sisi kiri'],
  ['03-quick-walkin', 'Kartu Quick Walk-In di Dashboard'],
  ['03-register-walkin', 'Jendela Register Walk-In'],
  ['03-daftar-walkins', 'Daftar walk-in hari ini'],
  ['03-complete-modal', 'Jendela penyelesaian kunjungan'],
  ['04-reservasi-baru', 'Formulir New Reservation'],
  ['04-panel-deposit', 'Panel Request deposit'],
  ['04-update-reservasi', 'Jendela Update Reservation'],
  ['05-halaman-reservations', 'Halaman Reservations'],
  ['05-form-online-kosong', 'Form reservasi online, kosong'],
  ['05-form-online-terisi', 'Form reservasi online, terisi'],
];

if (LIST_ONLY) {
  console.log('Files the manuals expect in ' + OUT + ':\n');
  for (const [f, c] of EXPECTED) {
    const there = fs.existsSync(path.join(OUT, f + '.png'));
    console.log('  [' + (there ? 'ada' : '   ') + '] ' + f + '.png  ' + c);
  }
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });

const FAKE_NAMES = ['Ibu Sinta', 'Pak Andi', 'Ibu Dewi', 'Pak Bagus', 'Ibu Rahma',
  'Pak Yoga', 'Ibu Kirana', 'Pak Hendra', 'Ibu Mega', 'Pak Surya'];

// ── Best-effort anonymiser ──────────────────────────────────────────────
async function anonymize(page) {
  if (!ANONYMIZE) return;
  await page.evaluate(({ names }) => {
    let n = 0;
    const nextName = () => names[(n++) % names.length];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const phone = /(\+?62|0)8\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,5}/g;
    for (const t of nodes) {
      if (phone.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(phone, '0812-3456-7890');
    }
    // Elements known to carry a guest name. Extend this list rather than
    // trusting it to be complete.
    const nameSelectors = [
      '#walkins-tbody tr td:nth-child(2)',
      '#reservations-tbody td:nth-child(2)',
      '#dashboard-reservations-list .dash-res-name',
      '#dashboard-walkins-list .dash-res-name',
      '.returning-badge .font-display',
      '#dash-prize-table-body tr td:nth-child(1)',
      '#dash-bd-table-body tr td:nth-child(1)',
    ];
    for (const sel of nameSelectors) {
      document.querySelectorAll(sel).forEach(el => {
        const small = el.querySelector('small');
        el.innerHTML = nextName() + (small ? small.outerHTML : '');
      });
    }
  }, { names: FAKE_NAMES });
}

// ── Badges ──────────────────────────────────────────────────────────────
async function drawBadges(page, badges) {
  if (!badges || !badges.length) return;
  await page.evaluate(({ badges, INK }) => {
    const host = document.createElement('div');
    host.id = '__manual_badges__';
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483647';
    document.body.appendChild(host);
    badges.forEach((b, i) => {
      const el = document.querySelector(b.selector);
      if (!el) { console.warn('badge target missing: ' + b.selector); return; }
      const r = el.getBoundingClientRect();
      const pos = b.at || 'left';
      let x = r.left + window.scrollX - 34;
      let y = r.top + window.scrollY + r.height / 2 - 14;
      if (pos === 'right') { x = r.right + window.scrollX + 8; }
      if (pos === 'top') { x = r.left + window.scrollX - 10; y = r.top + window.scrollY - 32; }
      if (pos === 'inside') { x = r.left + window.scrollX + 6; y = r.top + window.scrollY + 6; }
      const d = document.createElement('div');
      d.textContent = b.label || String(i + 1);
      d.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:28px;height:28px;'
        + 'border-radius:999px;background:' + INK + ';color:#fff;font:700 15px/28px system-ui,sans-serif;'
        + 'text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid #fff';
      host.appendChild(d);
    });
  }, { badges, INK });
}

const clearBadges = (page) => page.evaluate(() => {
  const h = document.getElementById('__manual_badges__');
  if (h) h.remove();
});

async function shoot(page, spec) {
  const pad = spec.pad === undefined ? 14 : spec.pad;
  await anonymize(page);
  await drawBadges(page, spec.badges);
  const options = { path: path.join(OUT, spec.file + '.png') };
  if (spec.clip) {
    const box = await page.locator(spec.clip).first().boundingBox();
    if (!box) throw new Error('clip target not found: ' + spec.clip);
    options.clip = {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.width + pad * 2, height: box.height + pad * 2,
    };
  }
  await page.screenshot(options);
  await clearBadges(page);
  console.log('  ok   ' + spec.file + '.png');
}

// One failed screen must not cost the other eleven.
const failures = [];
async function attempt(name, fn) {
  try { await fn(); }
  catch (e) {
    const msg = e.message.split('\n')[0];
    failures.push(name + ': ' + msg);
    console.warn('  MISS ' + name + ' — ' + msg);
  }
}

// ── Public guest pages ──────────────────────────────────────────────────
async function capturePublic(ctx) {
  if (!PUBLIC_URL) { console.log('PUBLIC_URL not set, skipping public pages'); return; }
  const page = await ctx.newPage();
  console.log('\nPublic guest pages');

  await attempt('05-form-online-kosong', async () => {
    await page.goto(PUBLIC_URL + '/reserve.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await shoot(page, { file: '05-form-online-kosong' });
  });

  await attempt('05-form-online-terisi', async () => {
    const fill = async (sel, val) => {
      const l = page.locator(sel);
      if (await l.count()) await l.first().fill(val);
    };
    await fill('#f-name', 'Ibu Sinta (contoh)');
    await fill('#f-phone', '081234567890');
    await fill('#f-pax', '4');
    await page.waitForTimeout(600);
    await shoot(page, { file: '05-form-online-terisi' });
  });

  await page.close();
}

// ── Staff app ───────────────────────────────────────────────────────────
async function captureStaff(ctx) {
  const page = await ctx.newPage();
  console.log('\nStaff app');

  await attempt('02-login', async () => {
    await page.goto(APP_URL + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shoot(page, {
      file: '02-login',
      clip: '#login-username >> xpath=ancestor::div[2]',
      badges: [{ selector: '#login-username', label: '1', at: 'top' },
               { selector: '#login-pin', label: '2', at: 'top' }],
    });
  });

  await page.fill('#login-username', STAFF_USER);
  await page.fill('#login-pin', STAFF_PIN);
  await page.press('#login-pin', 'Enter');
  await page.waitForSelector('#page-dashboard.active, #page-owner-dashboard.active', { timeout: 25000 });
  await page.waitForTimeout(3000);
  console.log('  logged in');

  await attempt('02-menu-sidebar', () => shoot(page, {
    file: '02-menu-sidebar',
    clip: '[data-nav="dashboard"] >> xpath=ancestor::nav[1]',
    badges: [{ selector: '[data-nav="dashboard"]', label: '1', at: 'right' },
             { selector: '[data-nav="reservations"]', label: '2', at: 'right' },
             { selector: '[data-nav="walkins"]', label: '3', at: 'right' }],
  }));

  // Admin and Owner land on a different dashboard, so make sure the staff
  // one is on screen before shooting the cards that live on it.
  await attempt('go to staff dashboard', async () => {
    await page.evaluate(() => {
      const admin = typeof currentStaffRole === 'function' && currentStaffRole() === 'admin';
      navigateTo(admin ? 'staff-dashboard' : 'dashboard');
    });
    await page.waitForTimeout(2500);
  });

  await attempt('03-quick-walkin', () => shoot(page, {
    file: '03-quick-walkin',
    clip: '#qw-name >> xpath=ancestor::div[contains(@class,"card")][1]',
    badges: [{ selector: '#qw-name', label: '1', at: 'top' },
             { selector: '#qw-phone', label: '2', at: 'top' },
             { selector: '#qw-pax', label: '3', at: 'top' },
             { selector: '#qw-btn', label: '4', at: 'top' }],
  }));

  await attempt('03-register-walkin', async () => {
    await page.evaluate(() => openWalkInModal());
    await page.waitForSelector('#modal-walkin:not(.hidden)');
    await page.waitForTimeout(1200);
    await shoot(page, {
      file: '03-register-walkin',
      clip: '#modal-walkin > div',
      badges: [{ selector: '#wi-guest-search', label: '1', at: 'top' },
               { selector: '#wi-pax', label: '2', at: 'top' },
               { selector: '#wi-area', label: '3', at: 'top' },
               { selector: '#wi-notes', label: '4', at: 'top' },
               { selector: '#wi-save-button', label: '5', at: 'top' }],
    });
    await page.evaluate(() => hideModal('modal-walkin'));
  });

  await attempt('03-daftar-walkins', async () => {
    await page.evaluate(() => navigateTo('walkins'));
    await page.waitForTimeout(2800);
    await shoot(page, { file: '03-daftar-walkins', clip: '#walkins-tbody >> xpath=ancestor::table[1]' });
  });

  // The completion window needs a walk-in that is still Active. Demo data
  // normally has one; if not, that is the row to seed for.
  await attempt('03-complete-modal', async () => {
    const id = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#walkins-tbody tr'));
      const row = rows.find(r => /openCompleteVisit/.test(r.innerHTML));
      const m = row && row.innerHTML.match(/openCompleteVisit\('([^']+)'/);
      return m ? m[1] : null;
    });
    if (!id) throw new Error('no active walk-in on screen to open the Complete window with');
    await page.evaluate((v) => openCompleteVisit(v, 'visit'), id);
    await page.waitForSelector('#modal-complete-visit:not(.hidden)');
    await page.waitForTimeout(1500);
    await shoot(page, {
      file: '03-complete-modal',
      clip: '#modal-complete-visit > div',
      badges: [{ selector: '#complete-spend', label: '1', at: 'top' },
               { selector: '#complete-last-order', label: '2', at: 'top' },
               { selector: '#complete-notes', label: '3', at: 'top' }],
    });
    await page.evaluate(() => hideModal('modal-complete-visit'));
  });

  await attempt('04-reservasi-baru', async () => {
    await page.evaluate(() => navigateTo('reservations'));
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      if (typeof openReservationModal === 'function') return openReservationModal();
      if (typeof openResModal === 'function') return openResModal();
      showModal('modal-reservation');
    });
    await page.waitForSelector('#modal-reservation:not(.hidden)');
    await page.waitForTimeout(1200);
    await shoot(page, {
      file: '04-reservasi-baru',
      clip: '#modal-reservation > div',
      badges: [{ selector: '#res-guest-search', label: '1', at: 'top' },
               { selector: '#res-date', label: '2', at: 'top' },
               { selector: '#res-time', label: '3', at: 'top' },
               { selector: '#res-pax', label: '4', at: 'top' },
               { selector: '#res-area', label: '5', at: 'top' },
               { selector: '#res-source', label: '6', at: 'top' }],
    });
  });

  await attempt('04-panel-deposit', () => shoot(page, {
    file: '04-panel-deposit',
    clip: '#res-staff-deposit',
    badges: [{ selector: '#res-request-deposit', label: '1', at: 'left' },
             { selector: '#res-deposit-amount', label: '2', at: 'top' }],
  }));

  await attempt('close reservation modal', () => page.evaluate(() => hideModal('modal-reservation')));

  await attempt('05-halaman-reservations', async () => {
    await page.evaluate(() => navigateTo('reservations'));
    await page.waitForTimeout(2500);
    await shoot(page, {
      file: '05-halaman-reservations',
      clip: '#res-search-wrap >> xpath=ancestor::div[3]',
      badges: [{ selector: '#res-search-input', label: '1', at: 'top' },
               { selector: '#res-date-input', label: '2', at: 'top' },
               { selector: '#res-online-only', label: '3', at: 'left' }],
    });
  });

  await attempt('04-update-reservasi', async () => {
    const id = await page.evaluate(() => {
      const body = document.querySelector('#reservations-tbody');
      const m = body && body.innerHTML.match(/openResActions\('([^']+)'/);
      return m ? m[1] : null;
    });
    if (!id) throw new Error('no reservation on screen to open Update Reservation with');
    await page.evaluate((v) => openResActions(v), id);
    await page.waitForSelector('#modal-res-actions:not(.hidden)');
    await page.waitForTimeout(1800);
    await shoot(page, { file: '04-update-reservasi', clip: '#modal-res-actions > div' });
    await page.evaluate(() => hideModal('modal-res-actions'));
  });

  await page.close();
}

// ── Main ────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  // Retina-grade, so a cropped panel is still sharp printed at 16 cm wide.
  deviceScaleFactor: 2,
  locale: 'id-ID',
  timezoneId: 'Asia/Jakarta',
});

try {
  await capturePublic(ctx);
  if (!PUBLIC_ONLY) {
    if (!APP_URL || !STAFF_USER || !STAFF_PIN) {
      console.log('\nAPP_URL / STAFF_USER / STAFF_PIN not set, skipping the staff app.');
    } else {
      await captureStaff(ctx);
    }
  }
} finally {
  await browser.close();
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png')).sort();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    captured_at: new Date().toISOString(),
    app_url: APP_URL || null,
    public_url: PUBLIC_URL || null,
    anonymized: ANONYMIZE,
    files,
  }, null, 2));
  console.log('\n' + files.length + ' of ' + EXPECTED.length + ' screenshot(s) in ' + OUT);
  const missing = EXPECTED.filter(e => !files.includes(e[0] + '.png')).map(e => e[0]);
  if (missing.length) console.log('missing: ' + missing.join(', '));
  if (failures.length) { console.log('\nwhat failed:'); failures.forEach(f => console.log('  - ' + f)); }
  if (ANONYMIZE) console.log('\nANONYMIZE was on. It is best effort: look at every image before shipping the manual.');
}
