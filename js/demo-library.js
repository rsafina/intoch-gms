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
  const reservationGuest = { ...dewi, name: "Michelle", initials: "MI" };
  const field = (label, value) => `<div class="demo-field"><span>${label}</span><div class="pf-in">${value}</div></div>`;
  function database(filtered = false, search = false) {
    const selected = beat >= 2;
    const visibleGuests = search && selected ? [dewi] : filtered && selected ? guests.filter(guest => guest.days > 60) : guests;
    return `<div class="scene-heading"><h3>Database Tamu</h3>${badge(visibleGuests.length + ' tamu')}</div>
      <div class="filter-bar">${search ? `<div class="search-field">⌕ ${beat ? 'Michelle' : 'Cari nama atau nomor telepon'}</div>${action('Cari tamu')}` : `<span class="filter-chip ${!filtered || !selected ? 'selected' : ''}">Semua tamu · 6</span>${filtered ? action(selected ? '✓ At Risk · 2 tamu' : 'Pilih At Risk >60 hari') : '<span class="filter-chip">Kunjungan terakhir</span>'}`}</div>
      <div class="guest-rows">${visibleGuests.map(guest => row(guest, beat > 0 && guest.days > 60)).join('')}</div>
      <div class="scene-summary">${filtered && selected ? '<strong>6 → 2</strong><span>Tersisa pelanggan yang 60 hari lebih tidak datang.</span>' : search && selected ? '<strong>Profil ketemu</strong><span>Riwayat dan catatan ada di satu halaman.</span>' : '<strong>Sudah lama tidak datang</strong><span>Bu Michelle dan Bu Noelle belum kembali lebih dari 2 bulan.</span>'}</div>`;
  }
  const eyeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  function guestDatabaseStory(member = false) {
    const guest = member ? sari : dewi;
    const found = beat >= 1;
    const rows = found ? [guest] : guests;
    const tier = person => person === sari ? 'High Spender' : 'Medium Spender';
    const profileOpen = beat === lastBeat;
    return `<div class="db-demo ${beat === 0 ? 'db-searching' : ''} ${profileOpen ? 'db-open' : ''}">
      <aside class="db-sidebar"><b>intoch</b><span>Dashboard</span><span>Reservations</span><span>Walk-Ins</span><strong>Guests</strong><span>Membership</span><span>Broadcast</span><span>Reports</span></aside>
      <div class="db-workspace">
        <div class="scene-heading"><div><h3>Guest Database</h3><small>Search and manage guest profiles</small></div><span class="db-new">+ New Guest</span></div>
        <div class="db-filters"><div class="db-search" aria-label="Search guests"><span>⌕</span><span class="db-query ${beat === 0 ? 'db-typing' : ''}" style="--letters:${guest.name.length}">${guest.name}</span></div><div class="db-filter-row"><span>All Tiers ⌄</span><span>All Tags ⌄</span><span>Any Visits ⌄</span><span>Last visit</span><span>dd/mm/yyyy</span><span>Reset</span></div></div>
        <div class="db-table"><div class="db-table-head"><span>GUEST</span><span>PHONE</span><span>TIER</span><span>VISITS</span><span>LAST VISIT</span><span></span></div>${rows.map(person => `<div class="db-row ${found ? 'db-found' : ''}" data-key="${person.initials}"><div class="db-person"><span class="avatar">${person.initials}</span><div><b>${person.name}</b>${person === sari ? '<small class="db-member-badge">★ M-0007</small>' : '<small>RETURNING</small>'}</div></div><span class="db-phone">${person.phone}</span><span class="db-tier">${tier(person)}</span><span class="db-visits">${person.visits}</span><span class="db-last">${person.last} 2026</span><button class="db-eye ${beat === 2 ? 'db-eye-active' : ''}" type="button" data-db-eye aria-label="Lihat profil ${person.name}">${eyeIcon}</button></div>`).join('')}</div>
      </div>
      ${profileOpen ? `<div class="db-overlay"><section class="db-profile" aria-label="Guest Profile ${guest.name}"><div class="db-profile-heading"><h3>Guest Profile</h3><button type="button" class="db-close" data-db-close aria-label="Tutup profil">×</button></div><div class="db-profile-id"><span class="avatar">${guest.initials}</span><div><b>${guest.name}</b><span>${guest.phone}</span>${member ? '<div class="db-member-line"><small class="db-member-badge">★ M-0007</small><span>8 stickers · 2 vouchers available</span></div><span class="db-member-link">Open member card</span>' : ''}<div><span class="db-tier">${tier(guest)}</span> <small>Auto-calculated</small></div><small>Member since ${member ? '12 Jun' : '7 Mar'} 2026</small></div><span class="db-edit">Edit</span></div><div class="db-profile-metrics"><div><small>AVERAGE SPEND</small><b>${member ? 'Rp350.000' : 'Rp310.000'}</b><span>across ${guest.visits} visits with spend recorded</span></div><div><small>FAVORITE</small><b>—</b><span>no order recorded yet</span></div></div><div class="db-profile-note"><small>NOTES</small><p>${member ? 'Member Family · pelanggan tetap, kenal staf.' : guest.note}</p></div><div class="db-history"><small>VISIT HISTORY (${guest.visits} VISITS)</small>${(member ? [['18 Sep', 'Reservation · 2 pax · Indoor', 'Rp400.000'], ['5 Sep', 'Walk-In · 3 pax · Teras', 'Rp300.000']] : [['20 Jun', 'Reservation · 4 pax · Teras', 'Rp360.000'], ['16 Mei', 'Walk-In · 2 pax · Indoor', 'Rp280.000'], ['11 Apr', 'Reservation · 2 pax · Teras', 'Rp320.000'], ['7 Mar', 'Walk-In · 2 pax · Indoor', 'Rp280.000']]).map(([day, detail, spend]) => `<div><span>${day} 2026<small>${detail}</small></span><b>${spend}</b></div>`).join('')}${member ? '<p class="db-history-more">+ 6 kunjungan sebelumnya</p>' : ''}</div></section></div>` : ''}
    </div>`;
  }
  function profile(kind) {
    const isBayu = kind === 'bayu-profile' || kind === 'return';
    const returning = kind === 'return';
    const guest = isBayu ? { ...bayu, visits: returning && beat >= 2 ? 2 : 1, days: returning && beat < 2 ? 10 : 0 } : kind === 'booked-profile' ? reservationGuest : dewi;
    return `<div class="scene-heading"><h3>Profil Tamu</h3>${badge(returning ? '3 Okt 2026' : 'Riwayat tamu')}</div>
      ${card('', identity(guest) + stats(guest))}
      <div class="profile-columns">${card('Riwayat kunjungan', `<div class="history">${isBayu ? `${returning && beat >= 2 ? '<p class="highlight">3 Okt · Walk-in <b>2 orang</b></p>' : ''}<p>23 Sep · Walk-in <b>2 orang · A3</b></p>` : '<p>20 Jun · Reservasi <b>Rp360.000</b></p><p>16 Mei · Walk-in <b>Rp280.000</b></p><p>11 Apr · Reservasi <b>Rp320.000</b></p><p>7 Mar · Walk-in <b>Rp280.000</b></p>'}</div>`)}
      ${card(kind === 'booked-profile' ? 'Reservasi mendatang' : 'Catatan tim', kind === 'booked-profile' ? '<p>26 Sep · 19:00</p><b>4 orang · Teras</b>' : `<p class="${beat >= 1 ? 'highlight' : ''}">${guest.note}</p><small>${isBayu ? 'Gunakan profil yang sama saat tamu kembali.' : 'Buka catatan sebelum menyiapkan meja.'}</small>`, beat >= 1 ? 'lit' : '')}</div>
      ${kind === 'preference' ? `${action('Lihat catatan tamu')}${beat >= 2 ? note('“Selamat datang kembali, Bu Michelle. Ingin di teras seperti biasa?”') : ''}` : returning ? `${action('Catat kunjungan berikutnya')}${beat >= 2 ? note('Kunjungan kedua terhubung ke profil Brian.') : ''}` : beat >= 2 ? note(isBayu ? 'Pak Brian kini tercatat sebagai pelanggan.' : 'Siapa dia, kapan datang, dan apa kesukaannya, semua terlihat.') : ''}`;
  }
  function campaign(kind) {
    const journey = kind === 'journey-message';
    const brianAudience = journey;
    const name = brianAudience ? bayu.name : dewi.name;
    const segment = journey ? 'Tamu baru belum kembali' : 'At Risk >60 hari';
    return `<div class="scene-heading"><h3>${beat >= 2 ? 'Workspace Campaign' : 'Buat Campaign'}</h3>${badge('Draft')}</div>
      ${card('Audiens terpilih', `<div class="audience-count"><b>${brianAudience ? '1' : '2'}</b><span>dari ${guests.length} tamu<br><strong>${segment}</strong></span></div><div class="audience-names">${brianAudience ? 'Brian' : 'Michelle · Noelle'}</div>`)}
      ${field('Nama campaign', journey ? 'Terima kasih sudah datang' : 'Kembali ke Intoch Restaurant')}
      ${card('Template pesan', `<p>${beat >= 1 ? 'Pesan personal untuk ' + name + ' siap ditinjau di preview.' : 'Pilih pesan yang sesuai dengan audiens.'}</p>`)}
      ${action(beat >= 2 ? 'Siapkan WhatsApp untuk ' + (brianAudience ? 'Brian' : 'Michelle') : 'Buat draft campaign')}
      ${beat >= 3 ? note('Pesan siap. Staf kirim satu per satu lewat WhatsApp.') : '<p class="scene-fine">Penerima di luar segmen tidak masuk audiens ini.</p>'}`;
  }
  // Pesan yang relevan: the Customer Insight cards, the Campaign Baru modal and
  // the recipient list, in the order staff meet them in the app.
  const segmentCards = [
    { key: 'acquire', label: 'ACQUIRE', total: 20, unit: 'first-time visitors', lines: [['Via reservation', '6 guests / 31 pax'], ['Via walk-in', '14 guests / 55 pax']], cta: 'Buat Campaign Akuisisi' },
    { key: 'retain', label: 'RETAIN', total: 23, unit: 'returning guests', lines: [['Via reservation', '8 guests / 61 pax'], ['Via walk-in', '15 guests / 68 pax']], cta: 'Buat Campaign Tamu Kembali' },
    { key: 'risk', label: 'AT RISK', total: 14, unit: "haven't returned in 60–89 days", lines: [['60–89 Days', '14 guests'], ['Last visit', 'all-time']], cta: 'Buat Campaign At-Risk' }
  ];
  const segmentOptions = ['At Risk (>60 hari tidak berkunjung)', 'Akuisisi', 'Tamu yang kembali', 'Tamu Baru (belum kembali)', 'Medium Spender', 'High Spender', 'Berdasarkan Tag', 'Semua Guest'];
  const returningGuests = [guests[2], guests[4], guests[3]];
  const returningMessage = name => `Halo ${name}! Terima kasih sudah kembali berkunjung ke ${restaurant}. Kami sangat menghargai kepercayaannya dan senang bisa melayani Bapak/Ibu lagi. Sampai jumpa di kunjungan berikutnya!`;
  function segmentReport(pick = false) {
    const cards = segmentCards.map((item, index) => {
      const shown = window.innerWidth <= 560 || pick || beat >= index;
      const lit = pick ? item.key === 'retain' : beat === index;
      const button = pick && item.key === 'retain' ? `<button type="button" class="seg-cta" data-scene-action>${item.cta}</button>` : `<span class="seg-cta">${item.cta}</span>`;
      return `<div class="seg-card ${item.key} ${shown ? '' : 'pending'} ${lit ? 'lit' : ''}" data-seg="${item.key}"><small>${item.label}</small>${shown ? `<b class="seg-num">${item.total}</b><span class="seg-unit">${item.unit}</span>${item.lines.map(([k, v]) => `<p><span>${k}</span><em>${v}</em></p>`).join('')}${button}` : '<b class="seg-num">–</b>'}</div>`;
    }).join('');
    return `<div class="scene-heading"><h3>Customer Insight</h3>${badge('1–23 Sep 2026')}</div><div class="seg-cards" tabindex="0" role="region" aria-label="Segmen pelanggan: geser untuk melihat kategori lainnya">${cards}</div>
      ${pick ? '<p class="scene-fine">Pilih segmen yang ingin disapa.</p>' : beat >= 3 ? note('Tiga segmen, tiga pesan yang berbeda.') : `<div class="scene-summary"><strong>${segmentCards[beat].label}</strong><span>${['Tamu yang pertama kali datang di periode ini.', 'Tamu yang sudah pernah datang, lalu kembali lagi.', 'Tamu yang 60 hari lebih belum kembali.'][beat]}</span></div>`}`;
  }
  function campaignModal(stage) {
    // stage: 0 name only, 1 dropdown open, 2 segment chosen, 3 ready to submit
    const chosen = stage >= 2;
    const select = stage === 0 ? `<button type="button" class="camp-select" data-scene-action>Pilih segmen <i>⌄</i></button>` : `<div class="camp-select ${stage === 1 ? 'open' : ''}">${chosen ? 'Tamu yang kembali' : 'Pilih segmen'} <i>⌄</i></div>`;
    const list = stage === 1 ? `<div class="camp-options">${segmentOptions.map(option => option === 'Tamu yang kembali' ? `<button type="button" class="camp-option active" data-scene-action>${option}</button>` : `<span class="camp-option">${option}</span>`).join('')}</div>` : '';
    const info = chosen ? `<div class="camp-info"><p><b>23 guest</b> masuk segmen ini sekarang, <b>23</b> punya nomor WA valid.</p><p>Periode laporan: <b>1–23 September 2026</b>.</p></div>` : '';
    const submit = stage === 3 ? `<button type="button" class="camp-submit" data-scene-action>Buat Campaign</button>` : '<span class="camp-submit">Buat Campaign</span>';
    return `<div class="camp-modal"><h3>Campaign Baru</h3><p class="scene-fine">Pilih siapa yang mau disapa. Pesan diatur setelah ini.</p>
      <div class="demo-field"><span>NAMA CAMPAIGN</span><div class="pf-in">Tamu Kembali - September</div></div>
      <div class="demo-field camp-segment"><span>SEGMEN</span>${select}${list}</div>${info}
      <div class="camp-footer"><span class="camp-cancel">Batal</span>${submit}</div></div>`;
  }
  function campaignSend() {
    if (beat === 0) return campaignModal(3);
    const recipients = beat >= 2;
    const sent = beat >= 3;
    return `<div class="scene-heading"><h3>Tamu Kembali - September</h3>${badge(sent ? 'Aktif' : 'Draft')}</div>
      <div class="filter-bar"><span class="filter-chip ${recipients ? '' : 'selected'}">Pesan</span>${recipients ? '<span class="filter-chip selected" data-tab="recipients">Penerima (23)</span>' : '<button type="button" class="filter-chip" data-tab="recipients" data-scene-action>Penerima (23)</button>'}</div>
      ${recipients ? `<div class="guest-rows">${returningGuests.map((guest, index) => `<div class="app-row ${index === 0 && !sent ? 'hl' : ''}" data-key="${guest.initials}"><span class="avatar">${guest.initials}</span><span class="who"><b>${guest.name}</b><small>${index === 0 && sent ? '✓ Terkirim · 10:20' : guest.visits + ' kunjungan · Belum dikirim'}</small></span>${index === 0 && sent ? badge('Terkirim') : index === 0 ? action('Kirim WA') : '<span class="rel-btn">Kirim WA</span>'}</div>`).join('')}</div><p class="scene-fine">+ 20 penerima lainnya di segmen Tamu yang kembali</p>`
        : `${field('Segmen', 'Tamu yang kembali · 23 guest')}${card('Isi pesan', `<div class="message-bubble">${returningMessage('{nama}')}</div>`)}<p class="scene-fine">Nama tamu terisi otomatis di pesan masing-masing.</p>`}
      ${sent ? note('Pesan Jessica terkirim. Lanjut ke John, satu per satu dari daftar.') : ''}`;
  }
  // Hubungan pelanggan: one evening of WhatsApp touchpoints, mirroring the
  // dashboard buttons (Follow up, Issue ticket, WA Thanks). Staff still send.
  const relButton = (text, rel, extra = '') => `<button type="button" class="rel-btn ${extra}" data-rel="${rel}" data-scene-action>${text}</button>`;
  function relationship(kind) {
    if (kind === 'rel-thanks') {
      const done = beat >= 1, sent = beat >= 2;
      return `<div class="scene-heading"><h3>Kunjungan Hari Ini</h3>${badge('23 Sep · 21:30')}</div>
      <div class="guest-rows">
        <div class="app-row rel-row ${done && !sent ? 'hl' : ''}" data-key="BR"><span class="t">18:30</span><span class="who"><b>${bayu.name} <span class="tg hs">Walk-in</span></b><small>2 orang · A3 · 1 kunjungan</small></span><span class="rel-actions">${done ? '<span class="rel-state">✓ Done</span>' : relButton('Done', 'done')}<span class="rel-state edit">Edit</span>${done ? relButton(sent ? '✓ WA Thanks' : 'WA Thanks', 'thanks', 'wa') : ''}</span></div>
        <div class="app-row rel-row" data-key="MI"><span class="t">19:00</span><span class="who"><b>${dewi.name} <span class="tg online">Reservasi</span></b><small>4 orang · Teras · 5 kunjungan</small></span><span class="rel-actions"><span class="st arr">Completed</span><span class="rel-btn wa">✓ WA Thanks</span></span></div>
      </div>
      ${beat >= 3 ? note('Brian (walk-in) dan Michelle (reservasi) sama-sama menerima ucapan terima kasih.') : `<div class="scene-summary"><strong>Walk-in dan reservasi</strong><span>Tombol WA Thanks muncul setelah kunjungan ditandai selesai.</span></div>`}`;
    }
    const ticket = kind === 'rel-ticket';
    const followed = ticket || beat >= 2;
    const rowLit = ticket ? beat === 0 : beat === 1;
    return `<div class="scene-heading"><h3>Reservasi Mendatang</h3>${badge('Hari ini · 1')}</div>
      <div class="guest-rows"><div class="app-row rel-row ${rowLit ? 'hl' : ''}" data-key="MI"><span class="t">19:00</span><span class="who"><b>${dewi.name}</b><small>4 orang · Teras · T2 · 4 kunjungan</small>${followed ? '<small class="rel-flag">✓ Konfirmasi WhatsApp terkirim</small>' : ''}</span>${badge('Reserved')}
        <span class="rel-actions stack"><span class="rel-btn primary">Update</span>${ticket ? relButton('Issue ticket', 'ticket', beat >= 1 ? 'active' : '') : '<span class="rel-btn">Issue ticket</span>'}${ticket ? '<span class="rel-btn outline">Follow up ↗</span>' : relButton('Follow up ↗', 'follow', 'outline' + (beat >= 1 ? ' active' : ''))}</span></div></div>
      ${ticket && beat >= 1 ? card('Tiket konfirmasi', `<p class="scene-fine">Tiket siap dibagikan. Tamu dapat membuka dan mengunduhnya.</p><div class="pf-in rel-link-field">intoch.app/reservation-ticket?t=MI-0923</div><div class="rel-actions start"><span class="rel-btn">Salin tautan</span>${relButton(beat >= 2 ? '✓ WhatsApp' : 'WhatsApp', 'ticket-wa', 'primary')}</div>`, 'lit') : ''}
      ${beat >= 3 ? note(ticket ? 'Tiket konfirmasi sudah di WhatsApp Bu Michelle. Tidak perlu screenshot atau ketik ulang.' : 'Pesan konfirmasi terisi otomatis. Staf cukup cek, lalu kirim.')
        : ticket && beat >= 1 ? '' : `<div class="scene-summary"><strong>${ticket ? 'Beri kepastian' : 'Satu klik'}</strong><span>${ticket ? 'Tiket resmi membuat tamu yakin mejanya aman.' : 'Nama, tanggal, jam, dan jumlah tamu sudah ada di pesan.'}</span></div>`}`;
  }
  function quickWalkin(kind) {
    const existing = kind === 'quick-existing';
    const seating = kind === 'quick-seat';
    const guest = existing ? sari : bayu;
    const registered = seating || beat === lastBeat;
    const editing = seating && (beat === 1 || beat === 2);
    const seated = seating && beat === lastBeat;
    const chosen = existing && beat >= 2;
    return `<div class="qw-dashboard ${editing ? 'qw-editing' : ''}"><div class="scene-heading"><div><h3>Welcome!</h3><small>Wednesday, 23 September 2026</small></div><div class="qw-top-actions"><span>ϟ Walk-In</span><span>+ New Reservation</span></div></div>
      <div class="qw-quick"><div class="qw-label"><b>QUICK WALK-IN</b><small>Name &amp; hp, sisa detail bisa menyusul</small><small>Pax bisa diisi nanti</small></div><div class="qw-name"><div class="qw-input" data-qw-name>${!seating && !registered ? `<span class="${beat === 0 ? 'db-typing' : ''}" style="--letters:${guest.name.length}">${guest.name}</span>` : '<span class="qw-placeholder">Guest name *</span>'}</div>${!seating && beat === 1 ? `<div class="qw-suggestions">${existing ? `<button type="button" data-scene-action><b>Jessica <span class="db-member-badge">★ M-0007</span></b><small>${sari.phone}</small></button>` : '<div><b>Belum ada tamu yang cocok</b><small>Klik Add untuk mendaftarkan Brian.</small></div>'}</div>` : ''}</div><div class="qw-input qw-phone">${chosen ? guest.phone : 'Phone (optional)'}</div><div class="qw-input qw-pax">${chosen ? '4' : '1'}</div><button class="qw-primary" type="button" data-scene-action>Add</button></div>
      <section class="qw-list"><div class="scene-heading"><div><h3>Today's Walk-Ins</h3><small>${registered ? '1 walk-in' : '0 walk-ins'} on Wednesday, 23 September</small></div><span class="qw-link">View all →</span></div>${registered ? `<div class="qw-visit"><span class="qw-time">5:45 PM</span><div class="qw-guest"><b>${guest.name} ${existing ? '<span class="db-member-badge">★ M-0007</span>' : ''}</b><small>${existing ? '4' : seated ? '4' : '1'} pax · ${seated ? 'T2 · Indoor' : '— · —'}</small><small>${existing ? '8 visits · Member Family' : seated ? 'Dekat jendela' : 'Tamu baru'}</small></div><div class="qw-row-actions"><span class="qw-active">● Active</span><button type="button" data-scene-action>Edit</button><span>Complete</span></div></div>` : '<p class="qw-empty">No walk-ins for today</p>'}</section>
      <div class="qw-tagline">Quick registration in under 20 seconds.</div>
      ${editing ? `<div class="qw-overlay"><section class="qw-modal"><div class="db-profile-heading"><h3>Edit Walk-In</h3><span class="db-close" aria-hidden="true">×</span></div><p class="qw-subtitle">Quick registration in under 20 seconds</p><div class="qw-edit-identity">${field('Guest Name *', 'Brian')}${field('Phone (optional)', '—')}</div><div class="qw-edit-fields">${field('Pax *', beat === 2 ? '4' : '1')}${field('Area (auto from table)', beat === 2 ? 'Indoor' : 'No preference')}</div>${field('Notes', beat === 2 ? 'Dekat jendela' : 'Any notes...')}<div class="qw-tables"><div><b>Tables</b><span>Clear selection</span></div><small>Select one or more tables in the same area.</small><b>Indoor</b><div class="qw-table-pills">${['IN6', 'IN7', 'IN8', 'T1', 'T2', 'T3'].map(table => `<button type="button" class="${beat === 2 && table === 'T2' ? 'selected' : ''}" data-scene-action>${table} · 4 pax</button>`).join('')}</div><b>Outdoor</b><div class="qw-table-pills"><span>OUT4 · 6 pax</span><span>OUT5 · 6 pax</span></div></div><div class="qw-modal-footer"><button type="button" class="qw-primary" data-scene-action>Save Changes</button><span>Cancel</span></div></section></div>` : ''}</div>`;
  }
  function walkin() {
    return `<div class="scene-heading"><h3>Walk-in</h3>${badge('23 Sep · 18:30')}</div><p class="scene-fine">Tamu datang tanpa reservasi</p>
      ${card('Tambah kunjungan', `<div class="form-grid">${field('Nama tamu', beat >= 1 ? bayu.name : 'Nama tamu')}${field('Nomor WhatsApp', beat >= 1 ? bayu.phone : 'Nomor tamu')}${field('Jumlah tamu', '2 orang')}${field('Meja · Area', beat >= 2 ? 'A3 · Indoor' : 'Pilih meja')}</div>${action('Simpan walk-in')}`)}
      ${beat >= 3 ? note('Brian · 2 orang · meja A3. Kunjungan tersimpan.') : '<div class="service-context"><span>01</span><p>Catat singkat.<br><b>Lanjutkan menyambut tamu.</b></p></div>'}`;
  }
  function reservationStory(kind) {
    const phone = reservationGuest.phone;
    if (kind === 'rsv-form') return `<div class="rsv-form-view ${beat === 0 ? 'rsv-brand-focus' : ''}"><div class="rsv-brand"><img src="/assets/intoch-logo.png" alt="Intoch Restaurant logo"><b>${restaurant}</b><small>Reservasi dengan identitas restoran Anda</small></div><section class="rsv-form"><div class="scene-heading"><h3>BOOK A TABLE</h3></div><p>Welcome to ${restaurant}</p><div data-rsv="identity">${field('Name', beat >= 1 ? 'Michelle' : 'Your name')}${field('WhatsApp Number', beat >= 1 ? phone : '08xxxxxxxxxx')}</div><div data-rsv="choices">${field('Number of Guests', beat >= 2 ? '−　　　　 4　　　　 +' : '−　　　　 2　　　　 +')}<small>□ Book a private room if available</small><label>Choose an Area</label><div class="rsv-pills"><span>Indoor</span><span class="${beat >= 2 ? 'selected' : ''}">Outdoor</span><span>Outdoor – Smoking</span></div>${field('Date', '26/09/2026')}<label>Time</label><div class="rsv-pills"><span>19:00</span><span>20:00</span><span class="${beat >= 2 ? 'selected' : ''}">21:00</span></div>${field('Notes (optional)', beat >= 2 ? 'Meja dekat taman, jika tersedia.' : 'Any notes...')}</div><button type="button" class="rsv-submit" data-scene-action>Reserve Now</button>${beat === 3 ? '<div class="rsv-received"><b>✓ Reservasi diterima, Michelle.</b><span>26 Sep · 21:00 · 4 pax · Outdoor</span><small>Tim restoran akan menghubungi Anda.</small></div>' : ''}</section></div>`;
    if (kind === 'rsv-dashboard') return `<div class="rsv-dashboard"><div class="scene-heading"><div><h3>Welcome!</h3><small>Wednesday, 23 September 2026</small></div><span class="rsv-bell">♧ <b>1</b></span></div>${beat === 0 ? '<div class="rsv-notification"><h3>Booking follow-ups</h3><small>Perlu follow up (1)</small><b>Michelle</b><span>Sab, 26 Sep · 21:00 · 4 pax</span><span>□ Sudah di-follow up</span><div>Buka halaman Reservasi</div></div>' : ''}<section class="rsv-upcoming"><div class="scene-heading"><h3>Upcoming Reservations</h3><small>Next 3 days</small></div><div class="rsv-pills"><span>Today (0)</span><span>Tomorrow (0)</span><span class="selected">26 Sep (1)</span></div><div class="rsv-totals"><b>26 September</b><span>Total reservations <strong>1</strong></span><span>Expected pax <strong>4</strong></span></div><div class="rsv-booking"><b>21:00</b><div><strong>Michelle</strong><small>4 pax · Outdoor · ${beat === 3 ? 'OUT4' : 'Unassigned'}</small><small>Online Form · 0 visits</small></div>${badge('Reserved')}<div class="rsv-actions"><button type="button" data-scene-action>Update</button><span>Issue ticket</span><span>Follow up ↗</span></div></div></section>${beat === 2 ? '<div class="rsv-edit-overlay"><section class="rsv-edit"><div class="db-profile-heading"><h3>Update Reservation</h3><span class="db-close">×</span></div><div class="db-profile-note"><b>Michelle</b><p>9:00 PM · 4 pax</p><small>Source: Online Form</small></div><label>UPDATE STATUS</label><div class="rsv-status"><span class="selected">Reserved</span><span>Arrived</span><span>Completed</span><span>Cancelled</span><span>Cancelled (No Show)</span></div><label>ASSIGN TABLE</label><div class="qw-input">Outdoor</div><div class="qw-table-pills"><span class="selected">OUT4 · 6 pax</span><span>OUT5 · 6 pax</span><span>OUT6 · 6 pax</span><span>OUT7 · 6 pax</span></div><button type="button" class="rsv-submit" data-scene-action>Save Changes</button></section></div>' : beat === 3 ? '<div class="scene-note">✓ Meja OUT4 tersimpan. Status tetap Reserved.</div>' : ''}</div>`;
    return `<div class="rsv-guest"><div class="scene-heading"><div><h3>Guest Database</h3><small>Search and manage guest profiles</small></div></div><div class="db-filters"><div class="db-search"><span>⌕</span><span class="db-query ${beat === 0 ? 'db-typing' : ''}" style="--letters:8">Michelle</span></div></div><div class="db-table"><div class="rsv-guest-row"><span class="avatar">MI</span><div><b>Michelle</b><small>${phone}</small></div><span class="db-tier">None</span><span>0 visits</span><button class="db-eye ${beat === 2 ? 'db-eye-active' : ''}" type="button" data-db-eye aria-label="Lihat profil Michelle">${eyeIcon}</button></div></div><p class="rsv-saved">✓ Kontak tersimpan otomatis dari Online Form.</p>${beat === 3 ? `<div class="db-overlay"><section class="db-profile"><div class="db-profile-heading"><h3>Guest Profile</h3><button type="button" class="db-close" data-db-close aria-label="Tutup profil">×</button></div><div class="db-profile-id"><span class="avatar">MI</span><div><b>Michelle</b><span>${phone}</span><div><span class="db-tier">None</span> <small>Belum ada spending tercatat</small></div><small>Member since 23 Sep 2026</small></div></div><div class="db-profile-metrics"><div><small>AVERAGE SPEND</small><b>—</b><span>No visits with spend recorded</span></div><div><small>FAVORITE</small><b>—</b><span>no order recorded yet</span></div></div><div class="db-profile-note"><small>UPCOMING RESERVATION</small><p>26 Sep 2026 · 21:00 · 4 pax</p><p>Outdoor · OUT4 · Reserved</p><small>Meja dekat taman, jika tersedia.</small></div><div class="db-history"><small>VISIT HISTORY (0 VISITS)</small><p>Belum ada kunjungan tercatat.</p></div></section></div>` : ''}</div>`;
  }
  function reservation() {
    return `<div class="scene-heading"><h3>Reservasi Mendatang</h3>${badge(beat === 3 ? '1 booking baru' : 'Minggu ini')}</div>
      <div class="app-row"><span class="who"><b>Jessica</b><small>Jum, 25 Sep · 20:00 · 2 orang · Indoor</small></span>${badge('Reserved')}</div>
      ${beat === 3 ? `<div class="app-row hl"><span class="who"><b>${reservationGuest.name} <span class="tg online">Online</span></b><small>Sab, 26 Sep · 19:00 · 4 orang · Teras</small></span>${badge('Reserved')}</div><div class="notification">Reservasi online baru<br><b>${reservationGuest.name} · 4 orang</b></div>` : '<div class="awaiting-booking"><span>↙</span><b>Dimulai dari ponsel tamu</b><p>Booking akan muncul di sini.</p></div>'}
      <div class="scene-summary"><strong>${beat === 3 ? 'Langsung masuk' : 'Booking baru'}</strong><span>${beat === 3 ? 'Nama, nomor, dan pilihan meja ikut tersimpan.' : 'Pelanggan pilih sendiri, Intoch yang mencatat.'}</span></div>`;
  }
  function booking(follow = false, done = false, context = false) {
    const guest = follow ? dewi : reservationGuest;
    return `<div class="scene-heading"><h3>${follow ? 'Follow-up Reservasi' : 'Reservasi Mendatang'}</h3>${badge(done && beat >= 2 ? '0 perlu follow-up' : '1 perlu follow-up', true)}</div>
      <div class="app-row ${beat >= 1 ? 'hl' : ''}"><span class="who"><b>${guest.name} <span class="tg online">Online</span></b><small>Sab, 26 Sep · 19:00 · 4 orang · Teras</small></span>${badge('Reserved')}</div>
      ${!follow && beat >= 1 ? '<div class="notification">♧ Reservasi online baru<br><b>' + guest.name + ' · 4 orang</b></div>' : ''}
      ${card(context ? 'Konteks sebelum menghubungi' : 'Detail reservasi', `<div class="booking-details"><p><span>Kontak</span><b>${guest.phone}</b></p><p><span>Catatan tamu</span><b>${guest.note}</b></p><p><span>Kunjungan sebelumnya</span><b>20 Jun · 4 kunjungan</b></p></div>`)}
      ${context ? card('Pesan konfirmasi', '<div class="message-bubble">Halo Bu Michelle, kami konfirmasi reservasi Sabtu, 26 Sep pukul 19:00 untuk 4 orang di Teras. Kami tunggu kedatangannya di Intoch Restaurant.</div>') : ''}
      ${follow ? action(done ? (beat >= 2 ? '✓ Sudah di-follow up' : 'Tandai setelah menghubungi') : 'Lihat detail & pesan WhatsApp') : '<div class="scene-summary"><strong>Tidak perlu salin dari chat</strong><span>Nama, nomor, jam, dan jumlah orang sudah terisi.</span></div>'}
      ${done && beat >= 2 ? note('Ditandai oleh staf · 23 Sep, 10:05. Antrean diperbarui.') : context ? '<p class="scene-fine">Pesan tetap dikirim staf lewat WhatsApp.</p>' : ''}`;
  }
  function membership(kind) {
    const converted = kind === 'reward' && beat >= 2;
    const added = kind === 'stickers' && beat >= 2;
    const total = converted ? 0 : (kind === 'reward' || added ? 10 : 8);
    return `<div class="scene-heading"><h3>Membership</h3>${badge('Family')}</div>${card('', identity(sari))}
      ${card('Saldo stiker', `<div class="sticker-total"><b>${total}</b><span>/ 10 stiker untuk 1 voucher</span></div><div class="sticker-grid">${Array.from({ length: 10 }, (_, index) => `<span class="${index < total ? 'filled' : ''}">${index < total ? '✓' : '·'}</span>`).join('')}</div>`)}
      ${kind === 'member' ? card('Aktivitas member', '<p>8 kunjungan · terakhir 18 Sep</p><p>Saldo 8 stiker · siap digunakan pada kunjungan berikutnya.</p>') : kind === 'stickers' ? `${field('Transaksi kunjungan · 23 Sep', 'Rp200.000 → 2 stiker')}${action('Simpan transaksi member')}${added ? note('2 stiker ditambahkan · saldo 10 stiker.') : ''}` : `${action('Konversi 10 stiker menjadi voucher')}${converted ? card('Voucher member', '<b>Voucher Intoch Restaurant · Rp50.000</b><p>Aktif · berlaku hingga 23 Okt 2026</p><small>Nilai dan masa berlaku mengikuti aturan restoran.</small>', 'reward-card') : '<p class="scene-fine">10 stiker siap dikonversi sesuai aturan restoran.</p>'}`}`;
  }
  const scenes = {
    'rsv-form': () => reservationStory('rsv-form'), 'rsv-dashboard': () => reservationStory('rsv-dashboard'), 'rsv-guest': () => reservationStory('rsv-guest'),
    'quick-existing': () => quickWalkin('quick-existing'), 'quick-new': () => quickWalkin('quick-new'), 'quick-seat': () => quickWalkin('quick-seat'),
    'db-guest': () => guestDatabaseStory(), 'db-member': () => guestDatabaseStory(true),
    'segment-report': () => segmentReport(), 'campaign-create': () => beat === 0 ? segmentReport(true) : campaignModal(beat - 1), 'campaign-send': campaignSend,
    database: () => database(), risk: () => database(true), search: () => database(false, true),
    profile: () => profile('profile'), preference: () => profile('preference'),
    'booked-profile': () => profile('booked-profile'), 'bayu-profile': () => profile('bayu-profile'), return: () => profile('return'),
    reactivate: () => campaign('reactivate'), 'journey-message': () => campaign('journey-message'),
    walkin, reservation, booking: () => booking(),
    visit: () => `<div class="scene-heading"><h3>Kunjungan Hari Ini</h3>${badge('23 Sep 2026')}</div>${row(bayu, beat >= 1, '18:30 · 2 orang · A3 · Indoor')}${card('Kunjungan walk-in', '<div class="visit-proof"><b>A3</b><div>Brian<p>2 orang · Sedang berkunjung</p></div></div>')}${beat >= 2 ? note('Kunjungan terhubung ke profil Brian.') : ''}`,
    'follow-list': () => booking(true), 'follow-context': () => booking(true, false, true), 'follow-done': () => booking(true, true),
    'rel-followup': () => relationship('rel-followup'), 'rel-ticket': () => relationship('rel-ticket'), 'rel-thanks': () => relationship('rel-thanks'),
    member: () => membership('member'), stickers: () => membership('stickers'), reward: () => membership('reward')
  };
  function relationshipPhone(kind) {
    const thanks = kind === 'rel-thanks', ticket = kind === 'rel-ticket';
    const guest = thanks ? bayu : dewi;
    const followUp = `Halo ${dewi.name}!<br><br>Kami dari ${restaurant} ingin mengonfirmasi reservasi Bapak/Ibu:<br>Tanggal: 23 Sep 2026<br>Jam: 19:00<br>Jumlah: 4 orang<br><br>Kami nantikan kehadirannya. Terima kasih!`;
    const sent = time => `<div class="comp-receipt rel-sent">Dikirim staf · ${time} ✓✓</div>`;
    let body;
    if (thanks) body = beat >= 2
      ? `<span class="chat-date">Setelah kunjungan</span><div class="comp-bubble revealed">Terima kasih atas kunjungan Bapak di ${restaurant} hari ini. Kami nantikan kedatangannya kembali di lain waktu!</div>${sent('21:30')}`
      : `<span class="chat-date">Setelah kunjungan</span><div class="comp-bubble">${beat >= 1 ? 'Menyiapkan pesan…' : 'Pesan terima kasih siap setelah kunjungan selesai.'}</div>`;
    else if (ticket) body = `<span class="chat-date">Konfirmasi reservasi</span>${beat >= 2
      ? `<div class="comp-bubble revealed">Halo ${dewi.name}! Reservasi Anda di ${restaurant} telah dikonfirmasi untuk 23 Sep, pukul 19:00, 4 orang. Tiket Anda:</div><div class="rel-ticket"><small>TIKET RESERVASI</small><b>${restaurant}</b><span>${dewi.name} · 4 orang</span><span>Rab, 23 Sep · 19:00 · Teras</span><em>Buka &amp; unduh tiket ↗</em></div>${sent('10:12')}`
      : `<div class="comp-bubble rel-earlier">Konfirmasi reservasi terkirim · 10:05 ✓✓</div><div class="comp-bubble">${beat >= 1 ? 'Menyiapkan tiket…' : 'Tiket konfirmasi belum dikirim.'}</div>`}`;
    else body = `<span class="chat-date">Konfirmasi reservasi</span><div class="comp-bubble ${beat >= 1 ? 'revealed' : ''}">${beat >= 1 ? followUp : 'Klik Follow up untuk menyiapkan pesan.'}</div>${beat === 1 ? '<button class="scene-action" data-scene-action type="button">Kirim di WhatsApp</button>' : beat >= 2 ? sent('10:05') : ''}`;
    return { type: 'phone chat', label: 'WHATSAPP PELANGGAN', title: thanks ? 'Ucapan terima kasih setelah kunjungan' : ticket ? 'Tiket konfirmasi di WhatsApp' : 'Konfirmasi reservasi', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>${guest.name}</b><small>${guest.phone}</small></div><div class="comp-body">${body}</div>` };
  }
  function segmentPeek(kind) {
    if (kind === 'campaign-send') {
      const shown = beat >= 1;
      const guest = returningGuests[0];
      return { type: 'phone chat', label: 'WHATSAPP PELANGGAN', title: 'Pesan untuk tamu yang kembali', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>${guest.name}</b><small>${guest.phone}</small></div><div class="comp-body"><span class="chat-date">Tamu Kembali - September</span><div class="comp-bubble ${beat >= 3 ? 'revealed' : ''}">${beat >= 3 ? returningMessage(guest.name) : shown ? 'Pesan siap dikirim dari daftar penerima.' : 'Menunggu campaign dibuat…'}</div>${beat >= 3 ? '<div class="comp-receipt rel-sent">Dikirim staf · 10:20 ✓✓</div>' : ''}</div>` };
    }
    const item = kind === 'campaign-create' ? segmentCards[1] : segmentCards[Math.min(beat, 2)];
    const all = kind === 'segment-report' && beat >= 3;
    return { type: 'insight', label: 'SEGMEN', title: 'Pesan mengikuti segmen', html: all
      ? `<div class="comp-body"><span class="insight-symbol">◎</span><h4>Satu pesan untuk setiap segmen</h4>${segmentCards.map(card => `<div class="mini-person seg-mini ${card.key}"><b>${card.total}</b><span>${card.label}<small>${card.cta.replace('Buat Campaign ', 'Campaign ')}</small></span></div>`).join('')}</div>`
      : `<div class="comp-body seg-peek ${item.key}"><small class="seg-peek-label">${item.label}</small><div class="insight-number">${item.total} <small>${item.unit}</small></div>${item.lines.map(([k, v]) => `<div class="mini-person"><span>${k}<small>${v}</small></span></div>`).join('')}<p>${kind === 'campaign-create' && beat >= 3 ? '23 punya nomor WA valid.' : { acquire: 'Ajak kembali untuk kunjungan kedua.', retain: 'Ucapkan terima kasih karena sudah kembali.', risk: 'Sapa sebelum mereka benar-benar hilang.' }[item.key]}</p></div>` };
  }
  // The companion is part of the same story: a guest phone, profile or audience.
  // It stays mounted alongside the staff screen, as in the landing-page use cases.
  function companion(kind) {
    if (kind.startsWith('rel-')) return relationshipPhone(kind);
    if (['segment-report', 'campaign-create', 'campaign-send'].includes(kind)) return segmentPeek(kind);
    const reservationFlow = ['reservation', 'booking', 'booked-profile'].includes(kind);
    const messaging = ['reactivate', 'journey-message', 'follow-context', 'follow-list', 'follow-done'].includes(kind);
    const memberFlow = ['member', 'stickers', 'reward'].includes(kind);
    const isBayu = ['walkin', 'visit', 'bayu-profile', 'return', 'journey-message'].includes(kind);
    const guest = isBayu ? bayu : dewi;
    if (reservationFlow) {
      const sent = kind !== 'reservation' || beat === 3;
      return { type: 'phone', label: 'HP PELANGGAN', title: 'Booking tanpa chat', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>Intoch Restaurant</b><small>Reservasi meja</small></div><div class="comp-body">
        ${sent ? '<div class="phone-success">✓</div><h4>Sampai jumpa, ' + reservationGuest.name + '.</h4><p>26 Sep · 19:00<br>4 orang · Teras</p><div class="comp-receipt">Reservasi diterima<br><b>Tim akan menghubungi Anda.</b></div>' : `${field('Tanggal', 'Sab, 26 Sep 2026')}<div class="comp-choice" data-point="area"><small>Area</small><div class="pf-pills"><span class="pf-pill">Indoor</span><span class="pf-pill ${beat >= 1 ? 'pick' : ''}">Teras</span></div></div><div class="comp-choice" data-point="time"><small>Jam</small><div class="pf-pills"><span class="pf-pill">18:00</span><span class="pf-pill ${beat >= 2 ? 'pick' : ''}">19:00</span></div></div>${field('Nama · Jumlah', beat >= 2 ? reservationGuest.name + ' · 4 orang' : 'Nama tamu · 4 orang')}<button class="scene-action" data-scene-action type="button">Kirim reservasi</button>`}</div>` };
    }
    if (messaging) {
      const follow = kind.startsWith('follow');
      const message = follow ? 'Halo Bu Michelle, kami konfirmasi reservasi 26 Sep, pukul 19:00 untuk 4 orang di Teras. Kami tunggu di Intoch Restaurant.' : isBayu ? 'Halo Pak Brian, terima kasih sudah mampir ke Intoch Restaurant. Kami senang menyambut Bapak kembali bersama keluarga.' : 'Halo Bu Michelle, sudah lama tidak bertemu di Intoch Restaurant. Ada waktu untuk makan bersama keluarga akhir pekan ini?';
      return { type: 'phone chat', label: 'PREVIEW WHATSAPP', title: 'Pesan sudah menyebut nama pelanggan', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>${guest.name}</b><small>${guest.phone}</small></div><div class="comp-body"><span class="chat-date">${follow ? 'Konfirmasi reservasi' : 'Kembali ke Intoch Restaurant'}</span><div class="comp-bubble ${beat >= 1 ? 'revealed' : ''}">${beat >= 1 ? message : 'Menyiapkan pesan…'}</div><div class="comp-receipt"><b>Draft:</b><br>staf cek dulu, lalu kirim.</div></div>` };
    }
    if (memberFlow) {
      const reward = kind === 'reward' && beat >= 2;
      return { type: 'phone member-phone', label: 'MEMBERSHIP FAMILY', title: 'Belanja jadi stiker, stiker jadi voucher', html: `<div class="comp-phone-top"><span class="phone-speaker"></span><b>Intoch Restaurant Family</b><small>Jessica</small></div><div class="comp-body"><div class="member-emblem">I</div><h4>${reward ? 'Voucher member' : 'Selamat datang kembali.'}</h4><div class="comp-receipt"><span>${reward ? 'Reward tersedia' : 'Saldo stiker'}</span><strong>${reward ? 'Rp50.000' : kind === 'member' || (kind === 'stickers' && beat < 2) ? '8 / 10' : '10 / 10'}</strong><small>${reward ? 'Berlaku hingga 23 Okt 2026' : '10 stiker menjadi 1 voucher'}</small></div><p>Datang lagi, dapat hadiah.</p></div>` };
    }
    const segment = ['database', 'risk'].includes(kind);
    if (segment) return { type: 'insight', label: 'PERLU DISAPA', title: '2 pelanggan lama belum kembali', html: `<div class="comp-body"><span class="insight-symbol">↗</span><h4>Pernah datang, lalu menghilang</h4><div class="insight-number">2 <small>dari 6 tamu</small></div><div class="mini-person"><b>MI</b><span>Michelle<small>95 hari tidak datang</small></span></div><div class="mini-person"><b>NO</b><span>Noelle<small>75 hari tidak datang</small></span></div><p>Mereka sudah kenal restoran Anda.</p></div>` };
    return { type: 'profile-peek', label: 'PROFIL PELANGGAN', title: isBayu ? 'Brian: Kunjungan pertama tercatat' : 'Tim tahu siapa yang datang', html: `<div class="comp-body">${identity(guest)}<div class="comp-receipt"><small>${isBayu ? 'Kunjungan tercatat' : 'Catatan untuk tim'}</small><b>${isBayu ? kind === 'return' && beat >= 2 ? '2 kunjungan · tamu kembali' : '23 Sep · 2 orang · A3' : 'Suka meja teras'}</b></div><p>${isBayu ? 'Kunjungan berikutnya masuk ke profil ini.' : '“Ingin di teras seperti biasa, Bu Michelle?”'}</p></div>` };
  }
  root.innerHTML = `<section class="demo-intro"><div class="intro-top"><span class="v2-stagetag">${definition.category}</span><h1>${definition.title}</h1></div></section>
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
  // One compact control row, like the landing-page story player.
  const stepNavigation = root.querySelector('.demo-steps');
  ['pause', 'restart'].forEach(id => stepNavigation.appendChild(document.getElementById(id)));
  document.getElementById('restart').textContent = '↻';
  controls.forEach((button, index) => button.setAttribute('aria-label', `Langkah ${index + 1}: ${definition.steps[index].title}`));
  function fitStage() {
    const scale = Math.min((stage.clientWidth || 680) / 680, (stage.clientHeight || 560) / 560);
    const changed = Math.abs(Number(stage.style.getPropertyValue('--stage-scale')) - scale) > .001;
    stage.style.setProperty('--stage-scale', String(scale));
    stage.style.setProperty('--pointer-size', String(1 / scale));
    return changed;
  }
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
  function fitSegments(slide = false) {
    const track = scene.querySelector('.seg-cards');
    if (!track || window.innerWidth > 560 || !stage.classList.contains('detail-view')) return;
    const index = definition.steps[stepIndex].scene === 'campaign-create' ? 1 : Math.min(beat, 2);
    const card = track.children[index];
    const previous = track.scrollLeft;
    track.scrollLeft = card.offsetLeft - track.children[0].offsetLeft;
    if (slide && track.scrollLeft !== previous) animate(card, [{ transform: 'translateX(100%)', opacity: .4 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 550 });
  }
  function movePointer(kind, reset) {
    if (cursorAnimation) cursorAnimation.cancel();
    const selectors = kind === 'rsv-form' ? ['#scene .rsv-brand img', '#scene [data-rsv="identity"]', '#scene [data-rsv="choices"] .rsv-pills']
      : kind === 'rsv-dashboard' ? ['#scene .rsv-notification', '#scene .rsv-actions button', '#scene .rsv-edit .rsv-submit']
      : kind === 'rsv-guest' ? ['#scene .db-search', '#scene .rsv-guest-row', '#scene .db-eye']
      : kind.startsWith('quick-')
      ? kind === 'quick-seat' ? ['#scene .qw-row-actions button', '#scene .qw-edit-identity', '#scene .qw-modal-footer button'] : ['#scene [data-qw-name]', kind === 'quick-existing' ? '#scene .qw-suggestions button' : '#scene .qw-quick > button', '#scene .qw-quick > button']
      : kind.startsWith('db-')
      ? ['#scene .db-search', '#scene .db-found .db-person', '#scene .db-eye']
      : kind === 'segment-report'
      ? ['#scene [data-seg="acquire"] .seg-num', '#scene [data-seg="retain"] .seg-num', '#scene [data-seg="risk"] .seg-num']
      : kind === 'campaign-create'
      ? ['#scene [data-seg="retain"] [data-scene-action]', '#scene .camp-select', '#scene .camp-option.active']
      : kind === 'campaign-send'
      ? ['#scene .camp-submit', '#scene [data-tab="recipients"]', '#scene .guest-rows [data-scene-action]']
      : kind === 'rel-followup'
      ? ['#scene [data-rel="follow"]', '.companion [data-scene-action]', null]
      : kind === 'rel-ticket'
      ? ['#scene [data-rel="ticket"]', '#scene [data-rel="ticket-wa"]', null]
      : kind === 'rel-thanks'
      ? ['#scene [data-rel="done"]', '#scene [data-rel="thanks"]', null]
      : kind === 'reservation'
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
    const detailed = window.innerWidth <= 560 && stage.classList.contains('detail-view');
    const scale = detailed ? 1 : bounds.width / 680 || 1;
    if (detailed && !target.getClientRects().length) { pointer.classList.remove('visible'); return; }
    if ((detailed || kind.startsWith('rsv-')) && kind !== 'segment-report' && !kind.startsWith('db-')) {
      const viewport = target.closest('.rsv-edit, .rsv-form-view, .rsv-dashboard, .qw-modal, .qw-dashboard') || (scene.contains(target) ? scene : companionScreen.parentElement);
      viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientHeight / 2;
    }
    const targetBounds = target.getBoundingClientRect();
    const previousBounds = pointer.getBoundingClientRect();
    const x = Math.max(0, Math.min(680 - 40 / scale, (targetBounds.left - bounds.left + targetBounds.width * .62) / scale));
    const y = (targetBounds.top - bounds.top + targetBounds.height * .55) / scale;
    const startX = reset ? Math.max(12, x - 80) : (previousBounds.left - bounds.left) / scale;
    const startY = reset ? y + 50 : (previousBounds.top - bounds.top) / scale;
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
    document.getElementById('story-title').textContent = definition.problem;
    document.getElementById('story-text').textContent = current.text;
    document.getElementById('story-text').dataset.number = String(stepIndex + 1);
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
      const previousShot = stage.dataset.shot;
      const guestAction = current.scene === 'reservation' && beat < lastBeat;
      const guestResult = ['campaign-send', 'journey-message', 'reward'].includes(current.scene) && beat === lastBeat;
      const guestMessage = current.scene.startsWith('rel-') && (beat === 2 || (current.scene === 'rel-followup' && beat === 1));
      const mobileSegments = window.innerWidth <= 560 && (current.scene === 'segment-report' || current.scene.startsWith('db-') || current.scene.startsWith('quick-'));
      const shot = current.scene.startsWith('rsv-') ? 'main' : beat === 0 && !motion.matches && !mobileSegments ? 'overview' : guestAction || guestResult || guestMessage ? 'companion' : 'main';
      const cameraTarget = shot === 'companion' ? companionScreen : stage.querySelector('.product-wrap');
      const beforeCamera = cameraTarget.getBoundingClientRect();
      stage.dataset.shot = shot;
      stage.classList.toggle('detail-view', shot !== 'overview');
      stage.classList.toggle('detail-companion', shot === 'companion');
      if (stepChanged || previousShot !== shot) { scene.scrollTop = 0; companionScreen.parentElement.scrollTop = 0; }
      fitStage(); fitSegments(true); movePointer(current.scene, stepChanged);
      if (current.scene.startsWith('rsv-')) {
        const viewport = scene.querySelector('.rsv-form-view, .rsv-dashboard, .rsv-guest');
        if (stepChanged) viewport.scrollTop = 0;
        if (current.scene === 'rsv-form' && beat === 3) viewport.scrollTop = viewport.scrollHeight;
        if (current.scene === 'rsv-dashboard' && beat === 2) viewport.scrollTop = 0;
        if (current.scene === 'rsv-dashboard' && beat === 3 && window.innerWidth <= 560) viewport.scrollTop = scene.querySelector('.rsv-booking').offsetTop - 14;
        if (current.scene === 'rsv-form' && beat === 0) animate(scene.querySelector('.rsv-brand'), [{ transform: 'scale(1)', opacity: .7 }, { transform: 'scale(1.12)', opacity: 1 }], { duration: 1800 });
      }
      if (current.scene.startsWith('quick-')) {
        const dashboard = scene.querySelector('.qw-dashboard');
        if (beat === lastBeat && window.innerWidth <= 560) dashboard.scrollTop = scene.querySelector('.qw-list').offsetTop - 10;
        else if (dashboard.classList.contains('qw-editing')) dashboard.scrollTop = 0;
      }
      if (window.innerWidth <= 560 && previousShot !== shot) {
        const afterCamera = cameraTarget.getBoundingClientRect();
        const from = beforeCamera.width && afterCamera.width
          ? `translate(${beforeCamera.left - afterCamera.left}px, ${beforeCamera.top - afterCamera.top}px) scale(${beforeCamera.width / afterCamera.width}, ${beforeCamera.height / afterCamera.height})`
          : 'translateY(12px) scale(.96)';
        animate(cameraTarget, [{ opacity: .35, transform: from, transformOrigin: 'top left' }, { opacity: 1, transform: 'none', transformOrigin: 'top left' }], { duration: 1000 });
      }
      if (window.innerWidth <= 560 && stage.classList.contains('detail-view') && beat === lastBeat && current.scene !== 'segment-report' && !current.scene.startsWith('db-') && !current.scene.startsWith('quick-') && !current.scene.startsWith('rsv-')) {
        const viewport = shot === 'companion' ? companionScreen.parentElement : scene;
        viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
      }
      renderedStep = stepIndex; renderedBeat = beat;
    }
    if (finished) pointer.classList.remove('visible');
    syncMotion();
    document.getElementById('beat-label').textContent = ['Situasinya', 'Cek datanya', 'Lakukan di Intoch', 'Hasilnya'][beat];
    document.getElementById('demo-progress').style.width = `${((stepIndex * 4 + beat + 1) / (definition.steps.length * 4)) * 100}%`;
    document.getElementById('step-count').textContent = `${stepIndex + 1} / ${definition.steps.length}`;
    document.getElementById('pause').textContent = motion.matches ? 'Ⅱ' : finished ? '▶' : paused ? '▶' : 'Ⅱ';
    document.getElementById('pause').setAttribute('aria-label', motion.matches ? 'Mode manual: animasi dikurangi' : finished ? 'Putar lagi' : paused ? 'Putar' : 'Jeda');
    document.getElementById('pause').disabled = motion.matches;
    document.getElementById('pause').setAttribute('aria-pressed', String(paused || motion.matches));
    document.getElementById('previous').disabled = stepIndex === 0;
    document.getElementById('next').textContent = stepIndex === definition.steps.length - 1 ? '✓' : '→';
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
      remaining = beat === lastBeat ? 4200 : interval;
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
    if (event.target.closest('[data-db-eye], [data-db-close]')) {
      clear(); remaining = interval; beat = event.target.closest('[data-db-close]') ? 1 : lastBeat; paint(); schedule(); return;
    }
    if (!event.target.closest('[data-scene-action]')) return;
    clear(); remaining = interval; beat = Math.min(lastBeat, beat + 1); paint(); schedule();
  });
  stage.addEventListener('pointerdown', event => {
    if (window.innerWidth > 560 || !event.target.closest('.seg-cards')) return;
    paused = true; paint(); schedule();
    pointer.classList.remove('visible');
  });
  document.addEventListener('visibilitychange', () => { syncMotion(); schedule(); });
  window.addEventListener('resize', () => { fitStage(); fitSegments(); movePointer(definition.steps[stepIndex].scene, false); syncMotion(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => {
    if (fitStage()) movePointer(definition.steps[stepIndex].scene, false);
    syncMotion();
  }).observe(stage);
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
