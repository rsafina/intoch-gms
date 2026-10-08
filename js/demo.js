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
    <div class="demo-actions"><a data-booking-tour="form-link" href="reserve.html" target="_blank" rel="noopener" class="btn-ghost">${demoText('Try the online reservation form','Coba formulir reservasi online')}</a></div>`;
  guide.addEventListener('toggle', () => sessionStorage.setItem('demo-guide-closed', guide.open ? 'no' : 'yes'));
  dashboard.children[0].after(guide);
  const traffic = document.createElement('div');
  traffic.id = 'demo-traffic'; traffic.className = 'demo-panel'; traffic.setAttribute('aria-live','polite');
  document.getElementById('dashboard-area-occupancy').after(traffic);
  // Stable card markers keep the original markup and loaders available to the full product.
  document.getElementById('dash-bd-label')?.closest('.card')?.setAttribute('hidden','');
  const reports = document.createElement('div');
  reports.id = 'demo-reports';
  reports.innerHTML = `<header data-tour="reports-intro"><h1>${demoText('Reports','Laporan')}</h1><p class="demo-note">${demoText('Understand who visits, who returns, and what your team should prepare for.','Pahami siapa yang datang, siapa yang kembali, dan apa yang perlu disiapkan tim.')}</p></header>
    <aside class="demo-panel"><p>${demoText('Use the date range to explore guest relationships. Live bookings and Peak Traffic have their own time windows, so you can plan ahead while reviewing past visits.','Gunakan rentang tanggal untuk melihat hubungan tamu. Reservasi live dan Peak Traffic memiliki periode sendiri untuk membantu perencanaan sambil meninjau kunjungan.')}</p><button type="button" class="btn-ghost" data-tour="reports-start" onclick="window.DemoTour?.start('reports')">${demoText('Start Reports Guide','Mulai Panduan Laporan')}</button></aside>
    <div id="demo-reports-status" role="status"></div>`;
  const move = (node, marker) => { if (node) { node.dataset.tour = marker; reports.append(node); } };
  move(document.getElementById('mkt-range-today')?.closest('.card'), 'reports-range');
  move(document.getElementById('report-total-guests')?.parentElement, 'reports-total');
  const acquisition = document.getElementById('report-new-guests')?.closest('.card');
  const retention = document.getElementById('mkt-retain-total')?.closest('.card');
  const risk = document.getElementById('at-risk-tab-60')?.closest('.card');
  if (acquisition) acquisition.dataset.tour = 'report-acquire';
  if (retention) retention.dataset.tour = 'report-retain';
  if (risk) risk.dataset.tour = 'report-risk';
  move(acquisition?.parentElement, 'reports-segments');
  const live = document.getElementById('ops-demand-0-count')?.closest('.grid');
  if (live?.previousElementSibling) move(live.previousElementSibling, 'reports-live-label');
  move(live, 'reports-live');
  move(document.getElementById('ops-forecast-this-week')?.closest('.card'), 'reports-forecast');
  const peak = document.getElementById('ops-peak-traffic-chart')?.closest('.card');
  if (peak?.previousElementSibling) move(peak.previousElementSibling, 'reports-peak-label');
  move(peak, 'reports-peak');
  // Campaign creation is outside this guide; keep the real read-only CSV exports.
  reports.querySelectorAll('button[onclick^="bcOpen"]').forEach(node => node.hidden = true);
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
  if (!demoEnabled() || !hasAccess('reports')) return false;
  const root = document.getElementById('demo-reports');
  if (!root) return false;
  const request = ++demoReportRequest, identity = odIdentity();
  const valid = () => request === demoReportRequest && identity === odIdentity() && currentPage === 'reports';
  const status = document.getElementById('demo-reports-status');
  root.dataset.reportState = 'loading'; status.textContent = demoText('Loading reports…','Memuat laporan…');
  window.DemoTour?.notify('operations-ready', {page:'reports',ok:false});
  try {
    const results = await Promise.all([loadReports({demoOnly:true,valid}), loadOperationsReports({demoOnly:true,valid})]);
    if (!valid()) return false;
    if (results.some(value => value !== true)) throw Error('Report read incomplete');
    root.dataset.reportState = 'ready'; status.textContent = '';
    window.DemoTour?.notify('operations-ready', {page:'reports',ok:true});
    return true;
  } catch (error) {
    if (!valid()) return false;
    root.dataset.reportState = 'error'; status.textContent = demoText('Reports unavailable. Please retry.','Laporan tidak tersedia. Silakan coba lagi.');
    const retry = document.createElement('button'); retry.className = 'btn-ghost'; retry.textContent = demoText('Retry','Coba lagi'); retry.onclick = () => loadDemoReports(); status.append(retry);
    window.DemoTour?.notify('operations-ready', {page:'reports',ok:false});
    return false;
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
  const panel=document.createElement('section'); panel.className='demo-panel';panel.dataset.tour='profile-shortcuts';panel.dataset.tourState='loading';
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
    panel.dataset.tourState='ready';
  } catch(error) { if(valid()) { panel.dataset.tourState='error';list.textContent=demoText('Bookings unavailable. Reopen the profile to retry.','Reservasi tidak tersedia. Buka kembali profil untuk mencoba lagi.'); } }
}
function resetDemoPresentation() {
  demoReportRequest++; demoTrafficRequest++; demoGuestRequest++;
  if (typeof currentReportSegments !== 'undefined') currentReportSegments = {};
  const reports = document.getElementById('demo-reports');
  if (reports) { reports.dataset.reportState = 'idle'; reports.querySelectorAll('[id^="ops-demand"], [id^="ops-today"], [id^="ops-forecast"], #report-total-guests, #report-new-guests, #mkt-retain-total').forEach(node => node.textContent = '—'); }

  for (const id of ['demo-reports-status','demo-traffic']) document.getElementById(id)?.replaceChildren();
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',initDemoPresentation,{once:true});
else initDemoPresentation();
