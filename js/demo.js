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
function demoCard(label, value, note) {
  return `<article class="demo-metric"><h2>${label}</h2><strong>${value}</strong><p>${note}</p></article>`;
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
    <div class="demo-actions"><label>${demoText('Period','Periode')} <select id="demo-report-period" class="form-input" onchange="loadDemoReports()"><option value="month">${demoText('This month','Bulan ini')}</option><option value="week">${demoText('Last 7 days','7 hari terakhir')}</option><option value="today">${demoText('Today','Hari ini')}</option></select></label></div>
    <div id="demo-report-content" aria-live="polite"></div>
    <aside class="demo-panel"><h2>${demoText('Bring your guests back','Ajak tamu Anda kembali')}</h2>
    <p>${demoText('We can also help you plan campaigns for your guests by email or WhatsApp. This is an optional service.','Kami juga dapat membantu merencanakan kampanye untuk tamu Anda melalui email atau WhatsApp. Ini adalah layanan opsional.')}</p>
    <p><strong>${demoText('Campaign returns — illustrative example','Hasil kampanye — contoh ilustrasi')}</strong></p>
    <p>${demoText('12 guests returned · Rp 2,400,000 in recorded spending after outreach.','12 tamu kembali · Rp 2.400.000 pengeluaran tercatat setelah dihubungi.')}</p>
    <p class="demo-note">${demoText('Example only, excluded from the totals above. Spending after a message is not proof that the campaign caused the visit. Live campaign attribution is not connected in this demo.','Hanya contoh, tidak termasuk total di atas. Pengeluaran setelah pesan tidak membuktikan bahwa kampanye menyebabkan kunjungan. Atribusi kampanye belum terhubung dalam demo ini.')}</p></aside>`;
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
async function loadDemoReports() {
  if (!demoEnabled() || !hasAccess('reports')) return;
  const root = document.getElementById('demo-report-content');
  if (!root) return;
  const request = ++demoReportRequest, identity = odIdentity();
  const valid = () => request===demoReportRequest && identity===odIdentity() && currentPage==='reports';
  const range = odRange(document.getElementById('demo-report-period').value);
  root.textContent = demoText('Loading report…','Memuat laporan…');
  try {
    const visits = await odRows('visits','id,guest_id,pax,spend_amount,voided_at',query=>query.is('voided_at',null).gte('visit_date',range.start).lte('visit_date',range.end));
    if (!valid()) return;
    const ids = [...new Set(visits.map(row=>row.guest_id).filter(Boolean))];
    const prior = await odByIds('visits','id,guest_id','guest_id',ids,query=>query.is('voided_at',null).lt('visit_date',range.start));
    if (!valid()) return;
    const stats = demoMetrics(visits,new Set(prior.map(row=>row.guest_id)));
    const money = value => value==null ? '—' : fmt.currency(value);
    root.innerHTML = `<p class="demo-note">${fmt.date(range.start)} – ${fmt.date(range.end)}</p><div class="demo-metrics">`+
      demoCard(demoText('Guest visits','Kunjungan tamu'),stats.visits,demoText('Actual visits, including repeat visits','Kunjungan aktual, termasuk kunjungan ulang'))+
      demoCard('Pax',stats.pax,demoText('Recorded diners, not bookings','Jumlah orang tercatat, bukan pemesanan'))+
      demoCard(demoText('Revenue','Pendapatan'),money(stats.recorded ? stats.total : null),demoText('Recorded visit spending; deposits are not added again','Pengeluaran kunjungan; deposit tidak ditambahkan lagi'))+
      demoCard(demoText('Average guest spending','Rata-rata pengeluaran tamu'),money(stats.average),demoText('Per visit with spending recorded, not per diner','Per kunjungan dengan pengeluaran tercatat, bukan per orang'))+
      demoCard(demoText('From returning guests','Dari tamu kembali'),money(stats.recorded ? stats.returning : null),demoText('Guests with a visit before this period','Tamu yang pernah berkunjung sebelum periode ini'))+
      demoCard(demoText('From new guests','Dari tamu baru'),money(stats.recorded ? stats.fresh : null),demoText('First visit in this period, including subsequent visits','Kunjungan pertama pada periode ini, termasuk kunjungan berikutnya'))+
      `</div><p class="demo-note">${stats.recorded}/${stats.visits} ${demoText('visits have spending recorded. Missing spending is excluded; recorded zero is included.','kunjungan memiliki pengeluaran tercatat. Data kosong tidak dihitung; nilai nol tetap dihitung.')} ${stats.missingPax} ${demoText('visits have no pax recorded.','kunjungan belum mencatat pax.')}</p>`+
      (stats.unlinked ? `<p class="demo-note">${demoText('Revenue without a linked guest','Pendapatan tanpa data tamu')}: ${money(stats.unlinked)}</p>` : '');
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
