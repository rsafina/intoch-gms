/* A thin presentation layer for the demo branch. Never grants role access. */
function demoEnabled() { return document.documentElement.classList.contains('demo-mode'); }
function demoRoute(page) {
  if (!demoEnabled()) return page;
  return ['dashboard','reservations','walkins','guests','reports','invoice'].includes(page) ? page : 'dashboard';
}
let demoReportRequest = 0;
let demoTrafficRequest = 0;
let demoGuestRequest = 0;
const demoText = (en, id) => typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'id' ? id : en;
function demoCard(label, value, note, tone = 'brand', icon = 'visit') {
  const paths = {
    visit:'<path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="3"/><path d="m8 15 3 3 5-5"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5"/>',
    money:'<rect x="2" y="5" width="20" height="14" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
    return:'<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5"/>',
    new:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m4-15v6m-3-3h6"/>',
  };
  return `<article class="demo-metric demo-metric--${tone}"><div class="demo-metric-label"><h2>${label}</h2><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[icon]}</svg></div><strong>${value}</strong><p>${note}</p></article>`;
}
async function setDemoReportPeriod(period) {
  if (!['today','week','month'].includes(period)) return;
  document.getElementById('demo-report-period').value = period;
  document.querySelectorAll('[data-demo-period]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.demoPeriod===period)));
  await loadDemoReports();
}
function initDemoPresentation() {
  if (!demoEnabled() || document.getElementById('demo-guide')) return;
  const dashboard = document.querySelector('#page-dashboard > div');
  const guide = document.createElement('details');
  guide.className = 'demo-panel';
  guide.id = 'demo-guide';
  guide.open = sessionStorage.getItem('demo-guide-closed') !== 'yes';
  guide.innerHTML = `<summary>${demoText('Try Intoch in five minutes','Coba Intoch dalam lima menit')}</summary>
    <p>${demoText('Your restaurant, your guest relationships. Each restaurant uses its own guest database.','Restoran Anda, hubungan dengan tamu Anda. Setiap restoran menggunakan database tamunya sendiri.')}</p>
    <ol class="demo-guide-steps">
      <li>${demoText('Add a quick walk-in below.','Tambahkan walk-in di bawah.')}</li>
      <li>${demoText('Make a reservation or try the online form.','Buat reservasi atau coba formulir online.')}</li>
      <li>${demoText('Open a guest profile to explore deposits and detailed invoices.','Buka profil tamu untuk melihat deposit dan invoice terperinci.')}</li>
      <li>${demoText('View Reports.','Buka Laporan.')}</li>
    </ol>
    <p>${demoText('Use fictional guest details in this demo.','Gunakan data tamu fiktif dalam demo ini.')}</p>
    <div class="demo-actions"><a href="reserve.html" target="_blank" rel="noopener" class="btn-ghost">${demoText('Try the online reservation form','Coba formulir reservasi online')}</a></div>`;
  guide.addEventListener('toggle', () => sessionStorage.setItem('demo-guide-closed', guide.open ? 'no' : 'yes'));
  dashboard.children[0].after(guide);
  const traffic = document.createElement('div');
  traffic.id = 'demo-traffic'; traffic.className = 'demo-panel'; traffic.setAttribute('aria-live','polite');
  document.getElementById('dashboard-area-occupancy').after(traffic);
  // Stable card markers keep the original markup and loaders available to the full product.
  document.getElementById('dash-bd-label')?.closest('.card')?.setAttribute('hidden','');
  const reports = document.createElement('div');
  reports.id = 'demo-reports';
  reports.innerHTML = `<h1>${demoText('Reports','Laporan')}</h1><p class="demo-note">${demoText('A simple picture of your restaurant’s visits and recorded spending.','Ringkasan kunjungan dan pengeluaran yang tercatat di restoran Anda.')}</p>
    <div class="demo-range-bar"><span class="demo-eyebrow">${demoText('Date range','Rentang tanggal')}</span>
      <input type="hidden" id="demo-report-period" value="month">
      <div class="demo-range-buttons" role="group" aria-label="${demoText('Report period','Periode laporan')}">
        <button type="button" data-demo-period="today" aria-pressed="false" onclick="setDemoReportPeriod('today')">${demoText('Today','Hari ini')}</button>
        <button type="button" data-demo-period="week" aria-pressed="false" onclick="setDemoReportPeriod('week')">${demoText('Last 7 days','7 hari terakhir')}</button>
        <button type="button" data-demo-period="month" aria-pressed="true" onclick="setDemoReportPeriod('month')">${demoText('This month','Bulan ini')}</button>
      </div><span id="demo-report-range" class="demo-range-label"></span>
    </div>
    <p class="demo-definition">${demoText('One party of 4 dining once = 1 visit · 4 diners (pax).','Satu rombongan berisi 4 orang datang sekali = 1 kunjungan · 4 orang (pax).')}</p>
    <div id="demo-report-content" aria-live="polite"></div>
    <aside class="demo-panel demo-campaign"><div class="demo-campaign-intro"><span class="demo-eyebrow">${demoText('Optional marketing support','Layanan pemasaran opsional')}</span><h2>${demoText('Bring your guests back','Ajak tamu Anda kembali')}</h2>
    <p>${demoText('We can also help you plan campaigns for your guests by email or WhatsApp. This is an optional service.','Kami juga dapat membantu merencanakan kampanye untuk tamu Anda melalui email atau WhatsApp. Ini adalah layanan opsional.')}</p>
    <div class="demo-channel-tags"><span>Email</span><span>WhatsApp</span></div></div>
    <div class="demo-campaign-example"><span class="demo-eyebrow">${demoText('Illustrative example','Contoh ilustrasi')}</span><strong>Rp 2.400.000</strong><p>${demoText('Recorded spending from 12 guests who returned after outreach.','Pengeluaran tercatat dari 12 tamu yang kembali setelah dihubungi.')}</p><p class="demo-note">${demoText('Example only · Excluded from report totals','Hanya contoh · Tidak termasuk total laporan')}</p>
    <details class="demo-method"><summary>${demoText('About campaign results','Tentang hasil kampanye')}</summary><p>${demoText('Spending after a message does not prove the campaign caused the visit. Live campaign attribution is not connected in this demo.','Pengeluaran setelah pesan tidak membuktikan kampanye menyebabkan kunjungan. Atribusi kampanye belum terhubung dalam demo ini.')}</p></details></div></aside>`;
  document.getElementById('page-reports').append(reports);
}

function demoMetrics(visits, priorGuestIds) {
  const rows = visits.filter(row => !row.voided_at);
  const recorded = rows.filter(row => row.spend_amount != null);
  const total = recorded.reduce((sum,row) => sum + Number(row.spend_amount),0);
  const returning = recorded.filter(row => priorGuestIds.has(row.guest_id)).reduce((sum,row) => sum + Number(row.spend_amount),0);
  const unlinked = recorded.filter(row => !row.guest_id).reduce((sum,row) => sum + Number(row.spend_amount),0);
  return { visits:rows.length, pax:rows.reduce((sum,row)=>sum+Number(row.pax||0),0),
    missingPax:rows.filter(row=>row.pax==null).length, recorded:recorded.length,
    missing:rows.length-recorded.length, total, average:recorded.length ? total/recorded.length : null,
    returning, fresh:total-returning-unlinked, unlinked };
}
function demoGuestSegments(visits, history, from, today) {
  const prior = new Set(), latest = new Map();
  for (const row of history) {
    if (!row.guest_id || row.voided_at || row.visit_date > today) continue;
    if (row.visit_date < from) prior.add(row.guest_id);
    if (!latest.has(row.guest_id) || row.visit_date > latest.get(row.guest_id)) latest.set(row.guest_id,row.visit_date);
  }
  const acquire={ids:new Set(),visits:0,pax:0}, retain={ids:new Set(),visits:0,pax:0};
  for (const row of visits) {
    if (!row.guest_id || row.voided_at) continue;
    const group=prior.has(row.guest_id) ? retain : acquire;
    group.ids.add(row.guest_id); group.visits++; group.pax+=Number(row.pax||0);
  }
  // Calendar-day arithmetic avoids local daylight-saving offsets.
  const dayNumber=value=>{const [year,month,day]=value.split('-').map(Number);return Date.UTC(year,month-1,day)/86400000;};
  let risk60=0,risk90=0;
  for (const last of latest.values()) {
    const days=dayNumber(today)-dayNumber(last);
    if(days>=90)risk90++; else if(days>=60)risk60++;
  }
  return {prior,acquire,retain,risk60,risk90};
}
function renderDemoGuestSegments(groups,today) {
  const cohort=(title,group,description,tone)=>`<article class="demo-segment demo-segment--${tone}"><h3>${title}</h3><strong>${group.ids.size}</strong><p class="demo-segment-unit">${demoText('unique guests','tamu unik')}</p><p class="demo-segment-description">${description}</p><dl><div><dt>${demoText('Visits','Kunjungan')}</dt><dd>${group.visits}</dd></div><div><dt>${demoText('Diners (pax)','Jumlah orang (pax)')}</dt><dd>${group.pax}</dd></div></dl></article>`;
  return `<section class="demo-segments"><h2>${demoText('Know your guests','Kenali tamu Anda')}</h2><p class="demo-note">${demoText('Acquire and Retain count each guest profile once in the selected period.','Acquire dan Retain menghitung setiap profil tamu sekali dalam periode yang dipilih.')}</p><div class="demo-segment-grid">`+
    cohort('Acquire',groups.acquire,demoText('First visit in this period.','Kunjungan pertama pada periode ini.'),'brand')+
    cohort('Retain',groups.retain,demoText('Visited in this period and had visited before it.','Datang pada periode ini dan pernah berkunjung sebelumnya.'),'accent')+
    `<article class="demo-segment demo-segment--risk"><h3>At Risk</h3><strong>${groups.risk60+groups.risk90}</strong><p class="demo-segment-unit">${demoText('guests not back in 60+ days','tamu belum kembali selama 60+ hari')}</p><p class="demo-segment-description">${demoText('Based on each guest’s latest visit, as of','Berdasarkan kunjungan terakhir setiap tamu, per')} ${fmt.date(today)}.</p><dl><div><dt>${demoText('60–89 days','60–89 hari')}</dt><dd>${groups.risk60}</dd></div><div><dt>${demoText('90+ days','90+ hari')}</dt><dd>${groups.risk90}</dd></div></dl><p class="demo-note">${demoText('All visit history, independent of the selected period.','Seluruh riwayat kunjungan, tidak mengikuti periode yang dipilih.')}</p></article></div></section>`;
}
async function loadDemoReports() {
  if (!demoEnabled() || !hasAccess('reports')) return;
  const root = document.getElementById('demo-report-content');
  if (!root) return;
  const request = ++demoReportRequest, identity = odIdentity();
  const valid = () => request===demoReportRequest && identity===odIdentity() && currentPage==='reports';
  const range = odRange(document.getElementById('demo-report-period').value);
  document.getElementById('demo-report-range').textContent = `${fmt.date(range.start)} – ${fmt.date(range.end)}`;
  root.textContent = demoText('Loading report…','Memuat laporan…');
  try {
    const visits = await odRows('visits','id,guest_id,pax,spend_amount,voided_at',query=>query.is('voided_at',null).gte('visit_date',range.start).lte('visit_date',range.end));
    if (!valid()) return;
    const today=odRange('today').end;
    const history = await odRows('visits','id,guest_id,visit_date',query=>query.is('voided_at',null).lte('visit_date',today));
    if (!valid()) return;
    const groups=demoGuestSegments(visits,history,range.start,today);
    const stats = demoMetrics(visits,groups.prior);
    const money = value => value==null ? '—' : fmt.currency(Math.round(value));
    root.innerHTML = `<div class="demo-metrics">`+
      demoCard(demoText('Visits','Kunjungan'),stats.visits,demoText('Each arrival counts, including repeat visits.','Setiap kedatangan dihitung, termasuk kunjungan ulang.'),'brand','visit')+
      demoCard(demoText('Diners (pax)','Jumlah orang (pax)'),stats.pax,demoText('Total people served across those visits.','Total orang yang dilayani dalam kunjungan tersebut.'),'accent','people')+
      demoCard(demoText('Revenue','Pendapatan'),money(stats.recorded ? stats.total : null),demoText('Total recorded visit spending.','Total pengeluaran kunjungan yang tercatat.'),'brand','money')+
      demoCard(demoText('Average spend / visit','Rata-rata / kunjungan'),money(stats.average),demoText('Revenue ÷ visits with spending recorded.','Pendapatan ÷ kunjungan dengan pengeluaran tercatat.'),'soft','money')+
      demoCard(demoText('Revenue · returning guests','Pendapatan · tamu kembali'),money(stats.recorded ? stats.returning : null),demoText('From guests who visited before this period.','Dari tamu yang pernah datang sebelum periode ini.'),'accent','return')+
      demoCard(demoText('Revenue · new guests','Pendapatan · tamu baru'),money(stats.recorded ? stats.fresh : null),demoText('From guests whose first visit is in this period.','Dari tamu yang pertama kali datang pada periode ini.'),'brand','new')+
      `</div><div class="demo-report-coverage"><span>${stats.recorded}/${stats.visits} ${demoText('visits have spending recorded','kunjungan memiliki pengeluaran tercatat')}</span>`+
      (stats.missingPax ? `<span>${stats.missingPax} ${demoText('visits have no diner count','kunjungan belum mencatat jumlah orang')}</span>` : '')+
      `<details class="demo-method"><summary>${demoText('How this is calculated','Cara perhitungan')}</summary><p>${demoText('Missing spending is excluded; recorded zero is included. Deposits are not added again. Averages are rounded to the nearest rupiah. Repeat visits by a new guest in this period stay in the new-guest group.','Pengeluaran kosong tidak dihitung; nilai nol tetap dihitung. Deposit tidak ditambahkan lagi. Rata-rata dibulatkan ke rupiah terdekat. Kunjungan ulang tamu baru pada periode ini tetap masuk kelompok tamu baru.')}</p></details></div>`+
      (stats.unlinked ? `<p class="demo-note">${demoText('Revenue without a linked guest','Pendapatan tanpa data tamu')}: ${money(stats.unlinked)}</p>` : '')+
      renderDemoGuestSegments(groups,today);
  } catch (error) {
    if (valid()) root.innerHTML = `<p role="alert">${demoText('Report unavailable. Please retry.','Laporan tidak tersedia. Silakan coba lagi.')}</p><button class="btn-ghost" onclick="loadDemoReports()">${demoText('Retry','Coba lagi')}</button>`;
  }
}
async function loadDemoTraffic() {
  const root = document.getElementById('demo-traffic'); if (!root) return;
  const request=++demoTrafficRequest, identity=odIdentity();
  const valid=()=>request===demoTrafficRequest && identity===odIdentity();
  root.textContent=demoText('Loading current traffic…','Memuat aktivitas hari ini…');
  try {
    const visits=await odRows('visits','id,pax,status,completed_at',query=>query.is('voided_at',null).eq('visit_date',TODAY));
    if (!valid()) return;
    root.innerHTML=`<h2>${demoText('Current traffic','Aktivitas hari ini')}</h2><p><strong>${visits.length}</strong> ${demoText('visits today','kunjungan hari ini')} · <strong>${visits.reduce((sum,row)=>sum+Number(row.pax||0),0)}</strong> pax</p><p>${demoText('Actual arrivals today. Area occupancy above shows the existing availability view; this total includes completed visits.','Kedatangan aktual hari ini. Okupansi area di atas menunjukkan ketersediaan; total ini termasuk kunjungan selesai.')}</p>`;
  } catch (error) { if(valid()) root.textContent=demoText('Current traffic unavailable. Refresh to retry.','Aktivitas tidak tersedia. Muat ulang untuk mencoba lagi.'); }
}
async function demoReserveGuest(guestId) {
  if (!hasAccess('reservations')) return;
  hideModal('modal-profile'); openReservationModal(); await selectGuestFromSearch(guestId,'res');
}
async function renderDemoGuestActions(guest) {
  const root=document.getElementById('profile-content');
  // Hide loyalty/tier decorations, retaining contact details, preferences and history.
  root.querySelector('button[onclick*="viewMemberDetail"]')?.parentElement?.setAttribute('data-demo-advanced','');
  const panel=document.createElement('section'); panel.className='demo-panel';
  const heading=document.createElement('h2'); heading.textContent=demoText('Reservations, deposits & invoices','Reservasi, deposit & invoice'); panel.append(heading);
  const note=document.createElement('p'); note.textContent=demoText('Deposits stay with the reservation. Open a booking to request or record a deposit, or prepare a detailed invoice for a large event.','Deposit terhubung dengan reservasi. Buka reservasi untuk meminta atau mencatat deposit, atau membuat invoice terperinci untuk acara besar.'); panel.append(note);
  if(hasAccess('reservations')) {
    const button=document.createElement('button');button.className='btn-ghost';button.textContent=demoText('New reservation for this guest','Reservasi baru untuk tamu ini');button.onclick=()=>demoReserveGuest(guest.id);panel.append(button);
  }
  const list=document.createElement('div');list.textContent=demoText('Loading bookings…','Memuat reservasi…');panel.append(list);
  root.children[0].after(panel);
  const request=++demoGuestRequest,identity=odIdentity();
  const valid=()=>request===demoGuestRequest && identity===odIdentity() && panel.isConnected;
  try {
    const {data,error}=await db.from('reservations').select('id,reservation_date,pax,status').eq('guest_id',guest.id).order('reservation_date',{ascending:false}).limit(5);
    if(error) throw error; if(!valid()) return;
    list.replaceChildren();
    for(const booking of data||[]) {
      const row=document.createElement('div');row.className='demo-booking';
      const label=document.createElement('span');label.textContent=`${fmt.date(booking.reservation_date)} · ${booking.pax||'—'} pax · ${booking.status}`;row.append(label);
      if(hasAccess('reservations')) { const button=document.createElement('button');button.className='btn-ghost';button.textContent=demoText('Deposit & invoices','Deposit & invoice');button.onclick=()=>{hideModal('modal-profile');openResActions(booking.id);};row.append(button); }
      list.append(row);
    }
    if(!data?.length)list.textContent=demoText('No reservations yet. Create one to try the deposit flow.','Belum ada reservasi. Buat reservasi untuk mencoba alur deposit.');
  } catch(error) { if(valid())list.textContent=demoText('Bookings unavailable. Reopen the profile to retry.','Reservasi tidak tersedia. Buka kembali profil untuk mencoba lagi.'); }
}
function resetDemoPresentation() {
  demoReportRequest++; demoTrafficRequest++; demoGuestRequest++;
  for (const id of ['demo-report-content','demo-traffic']) document.getElementById(id)?.replaceChildren();
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',initDemoPresentation,{once:true});
else initDemoPresentation();
