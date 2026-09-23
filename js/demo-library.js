/* Standalone deterministic story player. Never load config.js or staff modules here. */
(function () {
  'use strict';
  const { definitions, guests, contact, restaurant, date } = window.IntochDemoData;
  const root = document.getElementById('demo-root');
  const slug = location.pathname.replace(/\/+$/, '').split('/').pop();
  const definition = definitions.find(item => item.slug === slug);
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const link = item => `<a class="demo-flow-link" href="/demo/${item.slug}"><span>${escape(item.category)}</span><b>${escape(item.title)} ↗</b></a>`;
  if (!definition) {
    const isLibrary = ['demo', 'demo-library.html', 'demo-library'].includes(slug);
    root.innerHTML = `<section class="library-intro"><span class="v2-stagetag">Intoch Demo Library</span><h1>${isLibrary ? 'Mulai dari masalah restoran Anda.' : 'Demo ini belum tersedia.'}</h1><p>Pilih satu cerita. Lihat bagaimana alurnya bekerja.</p></section><nav class="demo-grid" aria-label="Pilih demo">${definitions.map(link).join('')}</nav>`;
    return;
  }
  document.title = `${definition.title} · Demo Intoch`;
  document.querySelector('meta[name="description"]').content = definition.problem;
  let stepIndex = 0, beat = 0, timer = null, paused = false, finished = false, inView = true;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const lastBeat = 3;
  const interval = 2400;
  const card = (title, body, extra = '') => `<section class="gp-card ${extra}"><h4>${title}</h4>${body}</section>`;
  const badge = (text, warm = false) => `<span class="st ${warm ? 'inc' : 'conf'}">${text}</span>`;
  const action = text => `<button type="button" class="scene-action" data-scene-action>${text}<span aria-hidden="true"> ↗</span></button>`;
  const note = text => `<div class="scene-note">✓ ${text}</div>`;
  const row = (guest, highlighted = false, detail = '') => `<div data-key="${guest.initials}" class="app-row ${highlighted ? 'hl' : ''}"><span class="avatar">${guest.initials}</span><span class="who"><b>${guest.name}</b><small>${detail || guest.visits + ' kunjungan · terakhir ' + guest.last}</small></span>${badge(guest.days > 60 ? guest.days + ' hari' : 'Aktif', guest.days > 60)}</div>`;
  const identity = guest => `<div class="gp-id"><span class="gp-av">${guest.initials}</span><div><b>${guest.name}</b><small>${guest.phone}</small></div></div>`;
  const stats = guest => `<div class="gp-stats"><div class="gp-stat"><b>${guest.visits}</b><small>Kunjungan</small></div><div class="gp-stat"><b>${guest.days}</b><small>Hari sejak datang</small></div><div class="gp-stat"><b class="money">${guest.spend}</b><small>Belanja tercatat</small></div></div>`;
  const dewi = guests[0], bayu = guests[5], sari = guests[2];
  const field = (label, value) => `<div class="demo-field"><span>${label}</span><div class="pf-in">${value}</div></div>`;
  function database(filtered = false, search = false) {
    const selected = beat >= 2;
    const visibleGuests = search && selected ? [dewi] : filtered && selected ? guests.filter(guest => guest.days > 60) : guests;
    return `<div class="scene-heading"><h3>Database Tamu</h3>${badge(visibleGuests.length + ' tamu')}</div>
      <div class="filter-bar">${search ? `<div class="search-field">⌕ ${beat ? 'Dewi Lestari' : 'Cari nama atau nomor telepon'}</div>${action('Cari tamu')}` : `<span class="filter-chip ${!filtered || !selected ? 'selected' : ''}">Semua tamu · 6</span>${filtered ? action(selected ? '✓ At Risk · 2 tamu' : 'Pilih At Risk >60 hari') : '<span class="filter-chip">Kunjungan terakhir</span>'}`}</div>
      <div class="guest-rows">${visibleGuests.map(guest => row(guest, beat > 0 && guest.days > 60)).join('')}</div>
      <div class="scene-summary">${filtered && selected ? '<strong>6 → 2</strong><span>Hanya tamu yang lebih dari 60 hari belum datang.</span>' : search && selected ? '<strong>Profil ditemukan</strong><span>Riwayat dan catatan berada di satu tempat.</span>' : '<strong>Kenali jeda kunjungannya</strong><span>Dewi dan Rina sudah lama tidak datang.</span>'}</div>`;
  }
  function profile(kind) {
    const isBayu = kind === 'bayu-profile' || kind === 'return';
    const returning = kind === 'return';
    const guest = isBayu ? { ...bayu, visits: returning && beat >= 2 ? 2 : 1, days: returning && beat < 2 ? 10 : 0 } : dewi;
    return `<div class="scene-heading"><h3>Profil Tamu</h3>${badge(returning ? '3 Okt 2026' : 'Riwayat tamu')}</div>
      ${card('', identity(guest) + stats(guest))}
      <div class="profile-columns">${card('Riwayat kunjungan', `<div class="history">${isBayu ? `${returning && beat >= 2 ? '<p class="highlight">3 Okt · Walk-in <b>2 orang</b></p>' : ''}<p>23 Sep · Walk-in <b>2 orang · A3</b></p>` : '<p>20 Jun · Reservasi <b>Rp360.000</b></p><p>16 Mei · Walk-in <b>Rp280.000</b></p><p>11 Apr · Reservasi <b>Rp320.000</b></p><p>7 Mar · Walk-in <b>Rp280.000</b></p>'}</div>`)}
      ${card(kind === 'booked-profile' ? 'Reservasi mendatang' : 'Catatan tim', kind === 'booked-profile' ? '<p>26 Sep · 19:00</p><b>4 orang · Teras</b>' : `<p class="${beat >= 1 ? 'highlight' : ''}">${guest.note}</p><small>${isBayu ? 'Gunakan profil yang sama saat tamu kembali.' : 'Buka catatan sebelum menyiapkan meja.'}</small>`, beat >= 1 ? 'lit' : '')}</div>
      ${kind === 'preference' ? `${action('Lihat catatan tamu')}${beat >= 2 ? note('“Selamat datang kembali, Bu Dewi. Ingin di teras seperti biasa?”') : ''}` : returning ? `${action('Catat kunjungan berikutnya')}${beat >= 2 ? note('Kunjungan kedua terhubung ke profil Bayu.') : ''}` : beat >= 2 ? note(isBayu ? 'Bayu kini punya riwayat, bukan hanya nama.' : 'Identitas, riwayat, dan konteks tamu tersedia untuk tim.') : ''}`;
  }
  function campaign(kind) {
    const journey = kind === 'journey-message';
    const name = journey ? bayu.name : dewi.name;
    const segment = journey ? 'Tamu baru belum kembali' : 'At Risk >60 hari';
    return `<div class="scene-heading"><h3>${beat >= 2 ? 'Workspace Campaign' : 'Buat Campaign'}</h3>${badge('Draft')}</div>
      ${card('Audiens terpilih', `<div class="audience-count"><b>${journey ? '1' : '2'}</b><span>dari ${guests.length} tamu<br><strong>${segment}</strong></span></div><div class="audience-names">${journey ? 'Bayu Pratama' : 'Dewi Lestari · Rina Putri'}</div>`)}
      ${field('Nama campaign', journey ? 'Terima kasih sudah datang' : 'Kembali ke Senja')}
      ${beat >= 1 ? card('Preview pesan · ' + name, `<div class="message-bubble">${journey ? 'Halo Pak Bayu, terima kasih sudah mampir ke Senja. Kami senang menyambut Bapak kembali bersama keluarga.' : 'Halo Bu Dewi, sudah lama tidak bertemu di Senja. Ada waktu untuk makan bersama keluarga akhir pekan ini? Kami senang menyambut Ibu kembali.'}</div>`) : card('Template pesan', '<p>Pilih pesan yang sesuai dengan audiens.</p>')}
      ${action(beat >= 2 ? 'Siapkan WhatsApp untuk ' + (journey ? 'Bayu' : 'Dewi') : 'Buat draft campaign')}
      ${beat >= 3 ? note('Pesan siap ditinjau. Staf membuka dan mengirim satu per satu.') : '<p class="scene-fine">Penerima di luar segmen tidak masuk audiens ini.</p>'}`;
  }
  function walkin() {
    return `<div class="scene-heading"><h3>Walk-in</h3>${badge('23 Sep · 18:30')}</div><p class="scene-fine">Tamu datang tanpa reservasi</p>
      ${card('Tambah kunjungan', `<div class="form-grid">${field('Nama tamu', beat >= 1 ? bayu.name : 'Nama tamu')}${field('Nomor WhatsApp', beat >= 1 ? bayu.phone : 'Nomor tamu')}${field('Jumlah tamu', '2 orang')}${field('Meja · Area', beat >= 2 ? 'A3 · Indoor' : 'Pilih meja')}</div>${action('Simpan walk-in')}`)}
      ${beat >= 3 ? note('Bayu Pratama · 2 orang · meja A3. Kunjungan tersimpan.') : '<div class="service-context"><span>01</span><p>Catat singkat.<br><b>Lanjutkan menyambut tamu.</b></p></div>'}`;
  }
  function reservation() {
    return `<div class="scene-heading"><h3>Reservasi Mendatang</h3>${badge(beat === 3 ? '1 booking baru' : 'Minggu ini')}</div>
      <div class="app-row"><span class="who"><b>Sari Wulandari</b><small>Jum, 25 Sep · 20:00 · 2 orang · Indoor</small></span>${badge('Reserved')}</div>
      ${beat === 3 ? `<div class="app-row hl"><span class="who"><b>Dewi Lestari <span class="tg online">Online</span></b><small>Sab, 26 Sep · 19:00 · 4 orang · Teras</small></span>${badge('Reserved')}</div><div class="notification">Reservasi online baru<br><b>Dewi Lestari · 4 orang</b></div>` : '<div class="awaiting-booking"><span>↙</span><b>Dimulai dari ponsel tamu</b><p>Booking akan muncul di sini.</p></div>'}
      <div class="scene-summary"><strong>${beat === 3 ? 'Masuk otomatis' : 'Tim siap menerima'}</strong><span>${beat === 3 ? 'Nama, kontak, dan pilihan tamu ikut tersimpan.' : 'Tamu memilih. Intoch mencatat.'}</span></div>`;
  }
  function booking(follow = false, done = false, context = false) {
    return `<div class="scene-heading"><h3>${follow ? 'Follow-up Reservasi' : 'Reservasi Mendatang'}</h3>${badge(done && beat >= 2 ? '0 perlu follow-up' : '1 perlu follow-up', true)}</div>
      <div class="app-row ${beat >= 1 ? 'hl' : ''}"><span class="who"><b>${dewi.name} <span class="tg online">Online</span></b><small>Sab, 26 Sep · 19:00 · 4 orang · Teras</small></span>${badge('Reserved')}</div>
      ${!follow && beat >= 1 ? '<div class="notification">♧ Reservasi online baru<br><b>Dewi Lestari · 4 orang</b></div>' : ''}
      ${card(context ? 'Konteks sebelum menghubungi' : 'Detail reservasi', `<div class="booking-details"><p><span>Kontak</span><b>${dewi.phone}</b></p><p><span>Catatan tamu</span><b>${dewi.note}</b></p><p><span>Kunjungan sebelumnya</span><b>20 Jun · 4 kunjungan</b></p></div>`)}
      ${context ? card('Pesan konfirmasi', '<div class="message-bubble">Halo Bu Dewi, kami konfirmasi reservasi Sabtu, 26 Sep pukul 19:00 untuk 4 orang di Teras. Kami tunggu kedatangannya di Senja.</div>') : ''}
      ${follow ? action(done ? (beat >= 2 ? '✓ Sudah di-follow up' : 'Tandai setelah menghubungi') : 'Lihat detail & pesan WhatsApp') : '<div class="scene-summary"><strong>Tanpa salin ulang</strong><span>Nama, kontak, waktu, dan jumlah tamu masuk bersama booking.</span></div>'}
      ${done && beat >= 2 ? note('Ditandai oleh staf · 23 Sep, 10:05. Antrean diperbarui.') : context ? '<p class="scene-fine">Staf tetap meninjau dan mengirim pesan di WhatsApp.</p>' : ''}`;
  }
  function membership(kind) {
    const converted = kind === 'reward' && beat >= 2;
    const added = kind === 'stickers' && beat >= 2;
    const total = converted ? 0 : (kind === 'reward' || added ? 10 : 8);
    return `<div class="scene-heading"><h3>Membership</h3>${badge('Family')}</div>${card('', identity(sari))}
      ${card('Saldo stiker', `<div class="sticker-total"><b>${total}</b><span>/ 10 stiker untuk 1 voucher</span></div><div class="sticker-grid">${Array.from({ length: 10 }, (_, index) => `<span class="${index < total ? 'filled' : ''}">${index < total ? '✓' : '·'}</span>`).join('')}</div>`)}
      ${kind === 'member' ? card('Aktivitas member', '<p>8 kunjungan · terakhir 18 Sep</p><p>Saldo 8 stiker · siap digunakan pada kunjungan berikutnya.</p>') : kind === 'stickers' ? `${field('Transaksi kunjungan · 23 Sep', 'Rp200.000 → 2 stiker')}${action('Simpan transaksi member')}${added ? note('2 stiker ditambahkan · saldo 10 stiker.') : ''}` : `${action('Konversi 10 stiker menjadi voucher')}${converted ? card('Voucher member', '<b>Voucher Senja · Rp50.000</b><p>Aktif · berlaku hingga 23 Okt 2026</p><small>Nilai dan masa berlaku mengikuti aturan restoran.</small>', 'reward-card') : '<p class="scene-fine">10 stiker siap dikonversi sesuai aturan restoran.</p>'}`}`;
  }
  const scenes = {
    database: () => database(), risk: () => database(true), search: () => database(false, true),
    profile: () => profile('profile'), preference: () => profile('preference'),
    'booked-profile': () => profile('booked-profile'), 'bayu-profile': () => profile('bayu-profile'), return: () => profile('return'),
    reactivate: () => campaign('reactivate'), campaign: () => campaign('campaign'), 'journey-message': () => campaign('journey-message'),
    walkin, reservation, booking: () => booking(),
    visit: () => `<div class="scene-heading"><h3>Kunjungan Hari Ini</h3>${badge('23 Sep 2026')}</div>${row(bayu, beat >= 1, '18:30 · 2 orang · A3 · Indoor')}${card('Kunjungan walk-in', '<div class="visit-proof"><b>A3</b><div>Bayu Pratama<p>2 orang · Sedang berkunjung</p></div></div>')}${beat >= 2 ? note('Kunjungan terhubung ke profil Bayu Pratama.') : ''}`,
    'follow-list': () => booking(true), 'follow-context': () => booking(true, false, true), 'follow-done': () => booking(true, true),
    member: () => membership('member'), stickers: () => membership('stickers'), reward: () => membership('reward')
  };
  // The companion is part of the same story: a guest phone, profile or audience.
  // It stays mounted alongside the staff screen, as in the landing-page use cases.
  function companion(kind) {
    const reservationFlow = ['reservation', 'booking', 'booked-profile'].includes(kind);
    const messaging = ['reactivate', 'campaign', 'journey-message', 'follow-context', 'follow-list', 'follow-done'].includes(kind);
    const memberFlow = ['member', 'stickers', 'reward'].includes(kind);
    const isBayu = ['walkin', 'visit', 'bayu-profile', 'return', 'journey-message'].includes(kind);
    const guest = isBayu ? bayu : dewi;
    if (reservationFlow) {
      const sent = kind !== 'reservation' || beat === 3;
      return { type: 'phone', label: 'PONSEL TAMU', title: sent ? 'Reservasi terkirim' : 'Tamu memilih sendiri', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>Senja Resto</b><small>Reservasi meja</small></div><div class="comp-body">
        ${sent ? '<div class="phone-success">✓</div><h4>Sampai jumpa, Bu Dewi.</h4><p>26 Sep · 19:00<br>4 orang · Teras</p><div class="comp-receipt">Reservasi diterima<br><b>Tim akan menghubungi Anda.</b></div>' : `${field('Tanggal', 'Sab, 26 Sep 2026')}<div class="comp-choice" data-point="area"><small>Area</small><div class="pf-pills"><span class="pf-pill">Indoor</span><span class="pf-pill ${beat >= 1 ? 'pick' : ''}">Teras</span></div></div><div class="comp-choice" data-point="time"><small>Jam</small><div class="pf-pills"><span class="pf-pill">18:00</span><span class="pf-pill ${beat >= 2 ? 'pick' : ''}">19:00</span></div></div>${field('Nama · Jumlah', beat >= 2 ? 'Dewi Lestari · 4 orang' : 'Nama tamu · 4 orang')}<button class="scene-action" data-scene-action type="button">Kirim reservasi</button>`}</div>` };
    }
    if (messaging) {
      const follow = kind.startsWith('follow');
      const message = follow ? 'Halo Bu Dewi, kami konfirmasi reservasi 26 Sep, pukul 19:00 untuk 4 orang di Teras. Kami tunggu di Senja.' : isBayu ? 'Halo Pak Bayu, terima kasih sudah mampir ke Senja. Kami senang menyambut Bapak kembali bersama keluarga.' : 'Halo Bu Dewi, sudah lama tidak bertemu di Senja. Ada waktu untuk makan bersama keluarga akhir pekan ini?';
      return { type: 'phone chat', label: 'PREVIEW WHATSAPP', title: 'Pesan personal, siap ditinjau', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>${guest.name}</b><small>${guest.phone}</small></div><div class="comp-body"><span class="chat-date">${follow ? 'Konfirmasi reservasi' : 'Kembali ke Senja'}</span><div class="comp-bubble ${beat >= 1 ? 'revealed' : ''}">${beat >= 1 ? message : 'Pesan disiapkan dari konteks tamu…'}</div><div class="comp-receipt"><b>Draft pesan</b><br>Staf meninjau dan mengirim di WhatsApp.</div></div>` };
    }
    if (memberFlow) {
      const reward = kind === 'reward' && beat >= 2;
      return { type: 'phone member-phone', label: 'MEMBERSHIP FAMILY', title: 'Aktivitas menjadi reward', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>Senja Family</b><small>Sari Wulandari</small></div><div class="comp-body"><div class="member-emblem">S</div><h4>${reward ? 'Voucher member' : 'Selamat datang kembali.'}</h4><div class="comp-receipt"><span>${reward ? 'Reward tersedia' : 'Saldo stiker'}</span><strong>${reward ? 'Rp50.000' : kind === 'member' || (kind === 'stickers' && beat < 2) ? '8 / 10' : '10 / 10'}</strong><small>${reward ? 'Berlaku hingga 23 Okt 2026' : '10 stiker menjadi 1 voucher'}</small></div><p>Kenali tamunya.<br>Jaga hubungannya.</p></div>` };
    }
    const segment = ['database', 'risk'].includes(kind);
    if (segment) return { type: 'insight', label: 'DARI DATA KE INSIGHT', title: 'Ada tamu yang perlu disapa', html: `<div class="comp-body"><span class="insight-symbol">↗</span><h4>${kind === 'risk' && beat >= 2 ? 'Audiens ditemukan' : 'Pernah datang. Lama tak kembali.'}</h4><div class="insight-number">2 <small>dari 6 tamu</small></div><div class="mini-person"><b>DL</b><span>Dewi Lestari<small>95 hari tidak datang</small></span></div><div class="mini-person"><b>RP</b><span>Rina Putri<small>75 hari tidak datang</small></span></div><p>Mulai dari hubungan yang sudah ada.</p></div>` };
    return { type: 'profile-peek', label: 'KONTEKS TAMU', title: isBayu ? 'Kunjungan menjadi riwayat' : 'Tim mengenal tamunya', html: `<div class="comp-body">${identity(guest)}<div class="comp-receipt"><small>${isBayu ? 'Kunjungan tercatat' : 'Catatan untuk tim'}</small><b>${isBayu ? kind === 'return' && beat >= 2 ? '2 kunjungan · tamu kembali' : '23 Sep · 2 orang · A3' : 'Suka meja teras'}</b></div><p>${isBayu ? 'Gunakan profil yang sama saat datang lagi.' : '“Ingin di teras seperti biasa, Bu Dewi?”'}</p></div>` };
  }
  root.innerHTML = `<section class="demo-intro"><div class="intro-top"><span class="v2-stagetag">${definition.category}</span><span>${definition.title}</span></div><h1>${definition.problem}</h1></section>
    <section class="demo-player" aria-label="${definition.title}">
    <div class="v2-panel demo-panel"><div class="story-copy"><span id="story-label" class="v2-stagetag"></span><h2 id="story-title"></h2><p id="story-text"></p><nav class="demo-steps" aria-label="Langkah demo">${definition.steps.map((item, index) => `<button type="button" data-step="${index}"><span class="n">${index + 1}</span><span><small>${item.label}</small><b>${item.title}</b></span><i aria-hidden="true">→</i></button>`).join('')}</nav><p id="story-note" class="story-note"></p><div class="story-outcome"><span>UNTUK RESTORAN ANDA</span><b>${definition.keyMessage}</b></div></div>
    <div class="story-stage"><div class="stage-heading"><span>DI DALAM INTOCH</span><span class="stage-live"><i></i> Lihat alurnya</span></div><div class="stage-devices"><div class="device-laptop"><div class="product-wrap"><div class="browser-bar"><span aria-hidden="true">● ● ●</span><span>${restaurant} / <b id="screen-label"></b></span><span class="simulation-label">SIMULASI</span></div><div class="product-screen"><div class="app-top"><span class="app-logo">intoch</span><span class="app-date">${date}</span></div><div id="scene" class="scene"></div></div><div class="product-caption"><span id="beat-label"></span><span>Data fiktif</span></div></div><div class="laptop-base"></div></div><aside class="companion"><span id="companion-label" class="device-label"></span><div id="companion-screen" class="companion-device"></div><span id="companion-caption"></span></aside><div class="demo-pointer" aria-hidden="true"><span class="pointer-ring"></span><svg viewBox="0 0 36 44"><path d="M4 3 L29 24 L19 26 L25 38 L18 41 L12 29 L4 36 Z"/></svg><span class="pointer-label">Pilih</span></div></div></div></div>
    <div class="player-controls"><div class="progress-track" aria-hidden="true"><span id="demo-progress"></span></div><span id="step-count"></span><div><button type="button" id="previous" aria-label="Langkah sebelumnya">←</button><button type="button" id="pause">Jeda</button><button type="button" id="restart" aria-label="Ulangi cerita dari awal">↻ Ulangi</button><button type="button" id="next" aria-label="Langkah berikutnya">→</button></div></div><p id="player-status" class="sr-only" role="status"></p></section>
    <section id="demo-end" class="demo-end" hidden><span class="v2-stagetag">Begitu alurnya.</span><h2>${definition.keyMessage}</h2><p>Ingin melihat alur ini untuk restoran Anda?</p><a class="demo-cta" href="${contact}" target="_blank" rel="noopener">Diskusikan dengan tim Intoch ↗</a><nav class="related-flows" aria-label="Cerita terkait">${definition.related.map(related => link(definitions.find(item => item.slug === related))).join('')}<a class="all-demos" href="/demo">Lihat semua cerita →</a></nav></section>`;
  const scene = document.getElementById('scene');
  const stage = root.querySelector('.story-stage');
  const companionScreen = document.getElementById('companion-screen');
  const pointer = root.querySelector('.demo-pointer');
  const animations = new Set();
  let renderedStep = -1, renderedBeat = -1, cursorAnimation = null;
  let remaining = interval, dueAt = 0;
  const controls = [...root.querySelectorAll('[data-step]')];
  function clear(preserve = false) {
    if (timer !== null) {
      if (preserve) remaining = Math.max(0, dueAt - performance.now());
      clearTimeout(timer);
    }
    timer = null;
  }
  function isRunning() { return !paused && !motion.matches && !document.hidden && inView && !finished; }
  function animate(element, frames, options = {}) {
    if (!isRunning() || !element.animate) return null;
    const animation = element.animate(frames, { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)', ...options });
    animations.add(animation);
    animation.onfinish = animation.oncancel = () => animations.delete(animation);
    return animation;
  }
  function syncMotion() {
    stage.classList.toggle('motion-paused', !isRunning());
    stage.classList.toggle('reduced-motion', motion.matches);
    animations.forEach(animation => {
      if (motion.matches) { animation.cancel(); return; }
      if (isRunning() && animation.playState === 'paused') animation.play();
      else if (!isRunning() && animation.playState === 'running') animation.pause();
    });
  }
  // Reconcile the mock UI in place: fields, rows and focused buttons survive beats.
  // Keyed guest rows keep their identity as the audience narrows.
  function updateSurface(container, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const changed = new Set();
    function update(parent, desired) {
      [...desired.childNodes].forEach((next, index) => {
        let previous = parent.childNodes[index];
        const key = next.nodeType === 1 && next.dataset.key;
        if (key) {
          const match = [...parent.children].find(child => child.dataset.key === key);
          if (match && match !== previous) { parent.insertBefore(match, previous || null); previous = match; }
        }
        if (!previous || previous.nodeType !== next.nodeType || previous.nodeName !== next.nodeName ||
          (key && previous.dataset.key !== key)) {
          const inserted = next.cloneNode(true);
          if (previous) parent.replaceChild(inserted, previous); else parent.appendChild(inserted);
          if (inserted.nodeType === 1) changed.add(inserted);
          return;
        }
        if (next.nodeType === 3) {
          if (previous.nodeValue !== next.nodeValue) {
            previous.nodeValue = next.nodeValue;
            const highlight = parent.closest('.pf-in,.st,.gp-stat,.notification,.scene-note,.comp-bubble,.insight-number,.sticker-total');
            if (highlight) changed.add(highlight);
          }
          return;
        }
        if (next.nodeType !== 1) return;
        [...previous.attributes].forEach(attribute => { if (!next.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name); });
        [...next.attributes].forEach(attribute => {
          if (previous.getAttribute(attribute.name) !== attribute.value) previous.setAttribute(attribute.name, attribute.value);
        });
        update(previous, next);
      });
      while (parent.childNodes.length > desired.childNodes.length) parent.lastChild.remove();
    }
    update(container, template.content);
    changed.forEach(element => {
      if (element.isConnected && ![...changed].some(other => other !== element && other.contains(element)))
        animate(element, [{ opacity: .25, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }]);
    });
  }
  function movePointer(kind, reset) {
    if (cursorAnimation) cursorAnimation.cancel();
    const selectors = kind === 'reservation'
      ? ['.companion [data-point="area"] .pf-pill:last-child', '.companion [data-point="time"] .pf-pill:last-child', '.companion [data-scene-action]']
      : kind === 'walkin'
        ? ['#scene .demo-field:first-child .pf-in', '#scene .demo-field:last-child .pf-in', '#scene [data-scene-action]']
        : kind === 'risk'
          ? [null, '#scene [data-scene-action]', null]
          : kind === 'search'
          ? ['#scene .search-field', '#scene [data-scene-action]', null]
          : ['stickers', 'reward', 'return', 'follow-done'].includes(kind)
          ? [null, '#scene [data-scene-action]', null]
          : ['#scene .pf-in, #scene [data-scene-action]', '#scene [data-scene-action]', '#scene [data-scene-action]'];
    const target = beat < lastBeat && selectors[beat] && stage.querySelector(selectors[beat]);
    pointer.classList.toggle('visible', !!target && !motion.matches && !finished);
    if (!target || motion.matches) return;
    const bounds = pointer.parentElement.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const previousBounds = pointer.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width - 70, targetBounds.left - bounds.left + targetBounds.width * .62));
    const y = targetBounds.top - bounds.top + targetBounds.height * .55;
    const startX = reset ? Math.max(12, x - 80) : previousBounds.left - bounds.left;
    const startY = reset ? y + 50 : previousBounds.top - bounds.top;
    pointer.style.transform = `translate(${x}px, ${y}px)`;
    pointer.querySelector('.pointer-label').textContent = target.matches('.pf-in,.search-field') ? 'Isi data' : target.matches('.app-row') ? 'Lihat tamu' : 'Klik';
    cursorAnimation = animate(pointer, [
      { transform: `translate(${startX}px, ${startY}px)`, offset: 0 },
      { transform: `translate(${x}px, ${y}px)`, offset: .62 },
      { transform: `translate(${x}px, ${y}px) scale(1)`, offset: .82 },
      { transform: `translate(${x}px, ${y}px) scale(.88)`, offset: .91 },
      { transform: `translate(${x}px, ${y}px) scale(1)`, offset: 1 }
    ], { duration: interval, easing: 'cubic-bezier(.4,0,.2,1)' });
    const ring = pointer.querySelector('.pointer-ring');
    animate(ring, [{ opacity: 0, transform: 'scale(.3)', offset: 0 }, { opacity: 0, transform: 'scale(.3)', offset: .82 }, { opacity: .75, transform: 'scale(.65)', offset: .9 }, { opacity: 0, transform: 'scale(1.2)', offset: 1 }], { duration: interval });
  }
  function paint() {
    const current = definition.steps[stepIndex];
    const stepChanged = renderedStep !== stepIndex;
    const sceneChanged = stepChanged || renderedBeat !== beat;
    root.dataset.step = String(stepIndex);
    root.dataset.beat = String(beat);
    document.getElementById('story-label').textContent = `${definition.category} · ${stepIndex + 1} / ${definition.steps.length}`;
    document.getElementById('story-title').textContent = current.title;
    document.getElementById('story-text').textContent = current.text;
    document.getElementById('story-note').textContent = current.note;
    document.getElementById('screen-label').textContent = current.label;
    root.querySelector('.app-date').textContent = current.scene === 'return' ? '3 Okt 2026' : current.scene === 'journey-message' ? '1 Okt 2026' : date;
    controls.forEach((button, index) => {
      if (index === stepIndex) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    if (sceneChanged) {
      if (stepChanged) animations.forEach(animation => animation.cancel());
      const hadSceneFocus = stage.contains(document.activeElement);
      const companionView = companion(current.scene);
      stage.dataset.scene = current.scene;
      stage.dataset.device = companionView.type.split(' ')[0];
      companionScreen.className = 'companion-device ' + companionView.type;
      document.getElementById('companion-label').textContent = companionView.label;
      document.getElementById('companion-caption').textContent = companionView.title;
      updateSurface(scene, scenes[current.scene]());
      updateSurface(companionScreen, companionView.html);
      if (stepChanged) animate(scene, [{ opacity: .3, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 800 });
      if (hadSceneFocus && !stage.contains(document.activeElement)) (stage.querySelector('[data-scene-action]') || document.getElementById('next')).focus({ preventScroll: true });
      movePointer(current.scene, stepChanged);
      renderedStep = stepIndex; renderedBeat = beat;
    }
    if (finished) pointer.classList.remove('visible');
    syncMotion();
    document.getElementById('beat-label').textContent = ['Alur dimulai', 'Lihat konteksnya', 'Tindakan di Intoch', 'Hasilnya terlihat'][beat];
    document.getElementById('demo-progress').style.width = `${((stepIndex * 4 + beat + 1) / (definition.steps.length * 4)) * 100}%`;
    document.getElementById('step-count').textContent = `${stepIndex + 1} / ${definition.steps.length}`;
    document.getElementById('pause').textContent = motion.matches ? 'Mode manual' : finished ? 'Putar lagi' : paused ? 'Putar' : 'Jeda';
    document.getElementById('pause').disabled = motion.matches;
    document.getElementById('pause').setAttribute('aria-pressed', String(paused || motion.matches));
    document.getElementById('previous').disabled = stepIndex === 0;
    document.getElementById('next').textContent = stepIndex === definition.steps.length - 1 ? 'Selesai ✓' : '→';
    document.getElementById('next').setAttribute('aria-label', stepIndex === definition.steps.length - 1 ? 'Selesaikan demo' : 'Langkah berikutnya');
    document.getElementById('demo-end').hidden = !finished;
  }
  function schedule() {
    clear(true);
    if (!isRunning()) return;
    dueAt = performance.now() + remaining;
    timer = setTimeout(() => {
      timer = null; remaining = interval;
      if (beat < lastBeat) beat++;
      else if (stepIndex < definition.steps.length - 1) { stepIndex++; beat = 0; }
      else finished = true;
      paint(); schedule();
    }, remaining);
  }
  function select(index) {
    clear(); remaining = interval; stepIndex = index; beat = motion.matches ? lastBeat : 0; finished = false;
    renderedStep = -1;
    paint(); schedule();
    document.getElementById('player-status').textContent = `Langkah ${index + 1}: ${definition.steps[index].title}`;
  }
  controls.forEach((button, index) => button.addEventListener('click', () => select(index)));
  document.getElementById('previous').addEventListener('click', () => select(Math.max(0, stepIndex - 1)));
  document.getElementById('next').addEventListener('click', () => {
    if (stepIndex < definition.steps.length - 1) select(stepIndex + 1);
    else { clear(); beat = lastBeat; finished = true; paint(); document.getElementById('demo-end').scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'start' }); }
  });
  document.getElementById('restart').addEventListener('click', () => { paused = false; select(0); });
  document.getElementById('pause').addEventListener('click', () => {
    if (finished) { paused = false; select(0); return; }
    paused = !paused; paint(); schedule();
  });
  stage.addEventListener('click', event => {
    if (!event.target.closest('[data-scene-action]')) return;
    clear(); remaining = interval; beat = Math.min(lastBeat, beat + 1); paint(); schedule();
  });
  document.addEventListener('visibilitychange', () => { syncMotion(); schedule(); });
  window.addEventListener('resize', () => { movePointer(definition.steps[stepIndex].scene, false); syncMotion(); });
  motion.addEventListener('change', () => { if (motion.matches) beat = lastBeat; paint(); schedule(); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      syncMotion(); schedule();
    }, { threshold: 0.15 });
    observer.observe(stage);
    window.addEventListener('pagehide', () => { clear(); observer.disconnect(); });
    window.addEventListener('pageshow', () => { observer.observe(stage); schedule(); });
  } else window.addEventListener('pagehide', clear);
  select(0);
})();
