/* Management overview and outlook. Authenticated read-only queries; RLS remains authoritative. */
const ownerOverview = { period: 'today', request: 0, data: null };
const odText = (en, id) => typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'id' ? id : en;
const odMoney = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID', {maximumFractionDigits:0});
const odEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function odDateShift(day, offset) { const date = new Date(day+'T12:00:00'); date.setDate(date.getDate()+offset); return ymd(date); }
function odClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {day:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
function odRange(period, now = new Date()) {
  const {day,time}=odClock(now); let start=day, prevStart=odDateShift(day,-7), prevEnd=prevStart;
  if(period==='week'){ start=odDateShift(day,-6); prevStart=odDateShift(start,-7); prevEnd=odDateShift(day,-7); }
  if(period==='month'){
    start=day.slice(0,8)+'01'; const last=odDateShift(start,-1); prevStart=last.slice(0,8)+'01';
    prevEnd=last.slice(0,8)+String(Math.min(Number(day.slice(8)),Number(last.slice(8)))).padStart(2,'0');
  }
  return {start,end:day,prevStart,prevEnd,time};
}
async function odRows(table, columns, configure = q=>q, order='id') {
  const rows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await configure(db.from(table).select(columns)).order(order).range(offset,offset+499);
    if(error) throw Object.assign(new Error(error.message || 'Could not load summary'), {code:error.code,table});
    rows.push(...(data || [])); if((data || []).length<500) return rows;
  }
}
async function odByIds(table, columns, key, ids, configure=q=>q, order='id') {
  const result=[];
  for(let i=0;i<ids.length;i+=150) result.push(...await odRows(table,columns,q=>configure(q.in(key,ids.slice(i,i+150))),order));
  return result;
}
// Older secured clients can report attendance/spending before Financial Tracking
// is migrated. Retry only this missing optional column; never mask RLS/network errors.
async function odVisitRows(columns, configure) {
  try { return await odRows('visits',columns,configure); }
  catch(error) {
    if(error.code!=='42703'||!/\bspend_recording_status\b/.test(error.message))throw error;
    return odRows('visits',columns.split(',').filter(column=>column!=='spend_recording_status').join(','),configure);
  }
}
function odReservationTotals(rows){
  const active=rows.filter(r=>!r.deleted_at&&!['Deleted','Cancelled','Cancelled (No Show)','No Show'].includes(r.status));
  const waiting=active.filter(r=>r.status==='Waitlist');const confirmed=active.filter(r=>['Reserved','Confirmed','Arrived','Completed'].includes(r.status));
  return {count:active.length,confirmed:confirmed.length,pax:confirmed.reduce((s,r)=>s+Number(r.pax||0),0),waiting:waiting.length,waitingPax:waiting.reduce((s,r)=>s+Number(r.pax||0),0),incoming:active.filter(r=>r.status==='Incoming').length};
}

const outlookState = { request: 0 };
const odHistoryState = { request: 0 };
const odCanView = () => ['owner','admin','manager'].includes(currentStaffRole());
const odPax = rows => rows.reduce((sum,row)=>sum+Number(row.pax||0),0);
const odActiveReservation = row => !row.deleted_at && !['Deleted','Cancelled','Cancelled (No Show)','No Show'].includes(row.status);
function odIdentity() {
  return [typeof currentStaffId==='function'?currentStaffId():'',currentStaffRole(),
    typeof staffSessionEpoch==='undefined'?'':staffSessionEpoch].join(':');
}
function odInvalidate() { ownerOverview.request++; outlookState.request++; odHistoryState.request++; }
function odReset() {
  odInvalidate(); ownerOverview.data=null;
  for(const id of ['owner-overview-content','outlook-content','management-financial-history-content']) document.getElementById(id)?.replaceChildren();
}
function odThreshold() {
  const value=Number(typeof APP_SETTINGS==='undefined'?8:APP_SETTINGS.management_dashboard?.large_party_pax??8);
  return Number.isInteger(value)&&value>=1&&value<=500?value:8;
}
function odCoverage(visits) {
  const recorded=visits.filter(row=>row.spend_amount!=null);
  const skipped=visits.filter(row=>row.spend_amount==null&&row.spend_recording_status==='skipped');
  return {recorded:recorded.length,skipped:skipped.length,missing:visits.length-recorded.length-skipped.length,
    amount:recorded.reduce((sum,row)=>sum+Number(row.spend_amount),0)};
}
function odLoad(visits,reservations) {
  const arrivedIds=new Set(visits.map(row=>row.reservation_id).filter(Boolean));
  const pending=reservations.filter(row=>odActiveReservation(row)&&
    ['Reserved','Confirmed','Incoming'].includes(row.status)&&!arrivedIds.has(row.id));
  return {arrived:odPax(visits),pending:odPax(pending),
    waitlist:odPax(reservations.filter(row=>odActiveReservation(row)&&row.status==='Waitlist'))};
}
function odDepositReceipts(payments,invoices) {
  const invoiceMap=new Map(invoices.map(row=>[row.id,row]));
  return payments.filter(row=>row.reservation_id ||
    (invoiceMap.get(row.invoice_id)?.kind==='deposit'&&invoiceMap.get(row.invoice_id)?.reservation_id));
}
function odCard(label,value,detail) {
  return `<article class="od-metric"><h2>${label}</h2><strong>${value}</strong><p>${detail}</p></article>`;
}
async function loadOwnerDashboard() {
  if(!odCanView())return;
  const root=document.getElementById('owner-overview-content');if(!root)return;
  const request=++ownerOverview.request, identity=odIdentity(), range=odRange(ownerOverview.period);
  const valid=()=>request===ownerOverview.request&&identity===odIdentity()&&odCanView()&&
    document.getElementById('page-owner-dashboard')?.classList.contains('active');
  const features=financialTrackingSettings();
  ownerOverview.data=null; odRenderHeader(range,true);
  root.innerHTML='<div class="od-loading" role="status">'+odText('Loading restaurant overview…','Memuat ringkasan restoran…')+'</div>';
  try {
    const start=range.start<odDateShift(range.end,-6)?range.start:odDateShift(range.end,-6);
    const [visits,reservations,queue,payments]=await Promise.all([
      odVisitRows('id,reservation_id,pax,spend_amount,spend_recording_status,visit_date,visit_time,visit_type,status,voided_at',
        query=>query.is('voided_at',null).gte('visit_date',start).lte('visit_date',range.end)),
      odRows('reservations','id,pax,status,deleted_at,reservation_date',
        query=>query.is('deleted_at',null).eq('reservation_date',range.end)),
      features.depositEnabled?odRows('reservations','id,booking_name,guests(name),reservation_date,reservation_time,pax,status,deposit_expected,deposit_due_at',
        query=>query.is('deleted_at',null).eq('deposit_required',true).in('status',['Incoming','Waitlist'])):[],
      features.depositEnabled?odRows('invoice_payments','id,reservation_id,invoice_id,amount,paid_on',
        query=>query.gte('paid_on',range.start).lte('paid_on',range.end)):[]
    ]);
    if(!valid())return;
    const invoiceIds=[...new Set(payments.map(row=>row.invoice_id).filter(Boolean))];
    const invoices=await odByIds('invoices','id,kind,reservation_id','id',invoiceIds);
    if(invoices.length!==invoiceIds.length)throw new Error('Incomplete payment classification');
    if(!valid())return;
    // Attendance is always visit-based. Status cleanup never invents guests.
    const visible=visits.filter(row=>!row.voided_at&&(row.visit_date<range.end||!row.visit_time||row.visit_time.slice(0,5)<=range.time));
    const today=visible.filter(row=>row.visit_date===range.end);
    const data={range,visits:visible,today,reservations,queue,features,
      coverage:odCoverage(visible.filter(row=>row.visit_date>=range.start)),
      deposits:odDepositReceipts(payments,invoices)};
    ownerOverview.data=data;
    odRenderOverview(root,data);odRenderHeader(range,false,new Date());
  } catch(error) {
    if(!valid())return;
    ownerOverview.data=null;
    root.innerHTML=odError('loadOwnerDashboard');
    odRenderHeader(range,false);
    console.warn('Management overview load failed',{name:error.name,code:error.code,table:error.table});
  }
}
function odError(retry) {
  return `<div class="od-error" role="alert"><h2>${odText('Overview unavailable','Ringkasan belum tersedia')}</h2><p>${odText('The data could not be loaded. Please retry; no totals are being shown.','Data gagal dimuat. Coba lagi; total belum ditampilkan.')}</p><button class="btn-primary" onclick="${retry}()">${odText('Retry','Coba lagi')}</button></div>`;
}
function odRenderMobileNav() {
  document.querySelectorAll('.od-mobile-nav button').forEach((button,index)=>{
    button.textContent=[odText('Overview','Ringkasan'),odText('Outlook','Agenda')][index%2];
  });
}
function odRenderHeader(range,loading,updated) {
  document.querySelectorAll('[data-nav="reservation-outlook"] .nav-label').forEach(element=>element.textContent=odText('Reservation Outlook','Agenda Reservasi'));
  odRenderMobileNav();
  const host=document.getElementById('owner-overview-header');
  host.innerHTML=`<div><p class="od-eyebrow">${odEscape(restaurantName())} · ${odEscape(currentStaffRole())}</p><h1>${odText('Restaurant overview','Ringkasan restoran')}</h1><p class="od-dates">${range.end} · ${odText('Today, so far','Hari ini, sejauh ini')}</p></div>
    <div class="od-header-controls"><button class="od-refresh" onclick="loadOwnerDashboard()" ${loading?'disabled':''}>${loading?odText('Loading…','Memuat…'):odText('Refresh','Muat ulang')}</button><button class="od-refresh" onclick="navigateTo('reservation-outlook')">${odText('Reservation Outlook','Agenda Reservasi')}</button><small>${updated?odText('Updated ','Diperbarui ')+odClock(updated).time+' WIB':odText('Jakarta time','Waktu Jakarta')}</small></div>`;
}
function odSetPeriod(key) {
  if(!['today','week','month'].includes(key))return;
  ownerOverview.period=key;return loadOwnerDashboard();
}
function odRenderOverview(root,data) {
  const {range,today,reservations,queue,features,coverage,deposits}=data;
  const totals=odReservationTotals(reservations), walkins=today.filter(row=>row.visit_type==='Walk-In');
  const load=odLoad(today,reservations);
  const chartRange={start:odDateShift(range.end,-6),end:range.end};
  const chartVisits=data.visits.filter(row=>row.visit_date>=chartRange.start);
  const receipts=deposits.filter(row=>Number(row.amount)>0).reduce((sum,row)=>sum+Number(row.amount),0);
  const refunds=-deposits.filter(row=>Number(row.amount)<0).reduce((sum,row)=>sum+Number(row.amount),0);
  const financeLabel=range.start===range.end?range.end:range.start+' — '+range.end;
  const periods=`<div class="od-periods" aria-label="${odText('Financial period','Periode keuangan')}">${[['today','Today','Hari ini'],['week','7 days','7 hari'],['month','Month','Bulan ini']].map(([key,en,id])=>`<button aria-pressed="${key===ownerOverview.period}" onclick="odSetPeriod('${key}')">${odText(en,id)}</button>`).join('')}</div>`;
  root.innerHTML=`
    <div class="od-metrics od-today">
      ${odCard(odText('Reservations Today','Reservasi Hari Ini'),totals.count,odText('Bookings excluding cancelled/deleted; includes waitlist','Reservasi selain batal/dihapus; termasuk daftar tunggu'))}
      ${odCard(odText('Walk-Ins Today','Walk-In Hari Ini'),walkins.length,odPax(walkins)+' pax · '+odText('recorded visits','kunjungan tercatat'))}
      ${odCard(odText('Total Foot Traffic Today','Total Tamu Datang Hari Ini'),odPax(today)+' pax',today.length+' '+odText('actual visits, including reservation arrivals','kunjungan nyata, termasuk kedatangan reservasi'))}
    </div>
    <p class="od-footnote">${odText('Bookings are demand. Foot traffic counts actual non-voided visits, whether active or finished.','Reservasi menunjukkan permintaan. Tamu datang dihitung dari kunjungan aktif maupun selesai yang tidak dibatalkan.')}</p>
    <div class="od-panels">
      <section class="od-card"><h2>${odText('7-Day Foot Traffic','Tamu Datang — 7 Hari')}</h2><p class="od-subtitle">${chartRange.start} — ${chartRange.end} · ${odText('Today is partial','Hari ini belum selesai')}</p>${odChart(chartVisits,chartRange)}</section>
      <section class="od-card"><h2>${odText('Guest Load Today','Beban Tamu Hari Ini')}</h2><div class="od-load-line"><span>${odText('Arrived so far','Sudah datang')}</span><strong>${load.arrived} pax</strong></div><div class="od-load-line"><span>${odText('Booked, no arrival recorded','Reservasi, kedatangan belum tercatat')}</span><strong>${load.pending} pax</strong></div><p class="od-subtitle">${load.waitlist} pax ${odText('waitlisted, shown separately','daftar tunggu, ditampilkan terpisah')}</p><p class="od-footnote">${odText('Daily demand, not live occupancy. Pending includes Incoming, Reserved and Confirmed. Departure times are not reliably recorded; overdue arrivals may still appear pending.','Permintaan harian, bukan okupansi langsung. Tertunda mencakup Incoming, Reserved dan Confirmed. Waktu pulang tidak selalu tercatat; reservasi lewat waktu dapat tetap tertunda.')}</p></section>
    </div>
    <div class="od-finance-heading"><h2>${odText('Financial summary','Ringkasan keuangan')}</h2>${periods}</div>
    <p class="od-subtitle">${financeLabel} · ${odText('Financial period only; Today and traffic stay fixed','Hanya periode keuangan; ringkasan hari ini dan grafik tetap')}</p>
    <div class="od-panels">
      <section class="od-card"><h2>${odText('Revenue','Pendapatan')}</h2>
        ${features.spendingEnabled?`<p class="od-subtitle">${odText('Recorded spending','Belanja tercatat')}</p><p class="od-large">${coverage.recorded?odMoney(coverage.amount):'—'}</p><p>${coverage.recorded} / ${coverage.recorded+coverage.skipped+coverage.missing} ${odText('visits with spending recorded','kunjungan dengan belanja tercatat')}</p><p class="od-subtitle">${coverage.skipped} ${odText('skipped','dilewati')} · ${coverage.missing} ${odText('not yet recorded / legacy unknown','belum tercatat / data lama tidak diketahui')}</p><p class="od-footnote">${odText('Recorded spending is not guaranteed total restaurant revenue. Missing spending is unknown; explicit zero is recorded. Deposits already included in a saved visit total are not added again.','Belanja tercatat belum tentu seluruh pendapatan restoran. Belanja kosong tidak diketahui; angka nol eksplisit tetap tercatat. Deposit dalam total kunjungan tidak ditambahkan lagi.')}</p>`:`<p class="od-empty">${odText('Spending Tracking is disabled.','Pelacakan Pengeluaran dinonaktifkan.')}</p>`}
        <button class="od-text-button" onclick="navigateTo('reports')">${odText('View reports and historical financial records','Lihat laporan dan riwayat keuangan')}</button>
      </section>
      ${features.depositEnabled?`<section class="od-card"><h2>${odText('Recorded Deposits','Deposit Tercatat')}</h2><p class="od-large">${odMoney(receipts-refunds)}</p><p>${odText('Net receipts by payment date','Penerimaan bersih menurut tanggal pembayaran')}</p><p class="od-subtitle">${odText('Received','Diterima')}: ${odMoney(receipts)} · ${odText('Refunds','Pengembalian')}: ${odMoney(refunds)}</p><p class="od-footnote">${odText('Direct reservation and deposit-invoice payments, including cancelled bookings and voided invoices. Excludes settlement/general invoices. This is cash recorded, not revenue.','Pembayaran reservasi langsung dan faktur deposit, termasuk reservasi batal dan faktur dibatalkan. Tidak termasuk faktur pelunasan/umum. Ini kas tercatat, bukan pendapatan.')}</p></section>
      <section class="od-card"><h2>${odText('Deposit Queue','Antrean Deposit')}</h2><p class="od-large">${queue.length} ${odText('bookings','reservasi')}</p><p class="od-subtitle">${odText('All dates · Incoming / Waitlist requiring a deposit','Semua tanggal · Incoming / Waitlist yang memerlukan deposit')}</p><p>${queue.filter(row=>!(Number(row.deposit_expected)>0)).length} ${odText('awaiting a quote','menunggu penawaran')}</p><button class="od-text-button" onclick="odShowDetails('deposits')">${odText('View read-only queue','Lihat antrean hanya baca')}</button><p class="od-footnote">${odText('Workflow queue, not an unpaid balance. Waitlisted bookings can still need acceptance.','Antrean proses, bukan saldo belum dibayar. Reservasi daftar tunggu mungkin masih memerlukan persetujuan.')}</p></section>`:''}
    </div><div id="od-details"></div>`;
}
function odReservationRows(rows) {
  const sorted=[...rows].sort((left,right)=>
    (left.reservation_date+' '+(left.reservation_time||'')).localeCompare(right.reservation_date+' '+(right.reservation_time||''))||String(left.id).localeCompare(String(right.id)));
  return sorted.map(row=>`<div class="od-detail-row"><div><strong>${odEscape(row.booking_name||row.guests?.name||odText('Reservation','Reservasi'))}</strong><small>${odEscape(row.reservation_date)} · ${odEscape((row.reservation_time||'').slice(0,5)||'—')} · ${Number(row.pax||0)} pax</small>${row.assigned_area||row.tables?.name?`<small>${odEscape(row.assigned_area||'')}${row.tables?.name?' · '+odEscape(row.tables.name):''}</small>`:''}</div><span class="od-status">${odEscape(row.status)}</span></div>`).join('')||`<p class="od-empty">${odText('No reservations.','Tidak ada reservasi.')}</p>`;
}
function odShowDetails(kind) {
  if(!odCanView()||!ownerOverview.data||kind!=='deposits'||!financialTrackingSettings().depositEnabled)return;
  const host=document.getElementById('od-details');if(!host)return;
  host.innerHTML=`<section class="od-card od-detail-panel" tabindex="-1"><div class="od-card-title"><h2>${odText('Deposit Queue','Antrean Deposit')}</h2><button class="btn-ghost" onclick="document.getElementById('od-details').replaceChildren()">${odText('Close','Tutup')}</button></div><p class="od-subtitle">${odText('Read-only summary · all dates','Ringkasan hanya baca · semua tanggal')}</p>${odReservationRows(ownerOverview.data.queue)}</section>`;
  host.firstElementChild.focus();host.firstElementChild.scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadReservationOutlook() {
  if(!odCanView())return;
  odRenderMobileNav();
  const root=document.getElementById('outlook-content');if(!root)return;
  const request=++outlookState.request, identity=odIdentity(), day=odClock().day, threshold=odThreshold();
  const valid=()=>request===outlookState.request&&identity===odIdentity()&&odCanView()&&document.getElementById('page-reservation-outlook')?.classList.contains('active');
  document.getElementById('outlook-header').innerHTML=`<div><p class="od-eyebrow">${odEscape(restaurantName())}</p><h1>${odText('Reservation Outlook','Agenda Reservasi')}</h1><p class="od-subtitle">${odText('Upcoming demand · read-only','Permintaan mendatang · hanya baca')}</p></div><div class="od-header-controls"><button class="od-refresh" onclick="navigateTo('dashboard')">${odText('Overview','Ringkasan')}</button><button class="od-refresh" onclick="loadReservationOutlook()">${odText('Refresh','Muat ulang')}</button></div>`;
  root.innerHTML=`<div class="od-loading" role="status">${odText('Loading reservations…','Memuat reservasi…')}</div>`;
  try {
    const columns='id,booking_name,guests(name),reservation_date,reservation_time,status,pax,assigned_area,tables(name),deleted_at';
    const [near,large]=await Promise.all([
      odRows('reservations',columns,query=>query.is('deleted_at',null).gte('reservation_date',day).lte('reservation_date',odDateShift(day,2)).in('status',['Incoming','Waitlist','Reserved','Confirmed','Arrived','Completed'])),
      odRows('reservations',columns,query=>query.is('deleted_at',null).gte('reservation_date',day).gte('pax',threshold).in('status',['Incoming','Waitlist','Reserved','Confirmed']))
    ]);
    if(!valid())return;
    odRenderOutlook(root,day,near,large,threshold);
  } catch(error) { if(valid())root.innerHTML=odError('loadReservationOutlook'); }
}
function odRenderOutlook(root,day,near,large,threshold) {
  const labels=[['Today','Hari Ini'],['Tomorrow','Besok'],['Day After Tomorrow','Lusa']];
  root.innerHTML=`<p class="od-footnote">${odText('Cancelled and deleted bookings are excluded. Incoming and Waitlist are provisional; pax here is booked demand, not attendance.','Reservasi batal dan dihapus tidak ditampilkan. Incoming dan Waitlist belum pasti; pax di sini adalah permintaan reservasi, bukan kedatangan.')}</p><div class="od-outlook-days">${labels.map(([en,id],offset)=>{
    const date=odDateShift(day,offset), rows=near.filter(row=>row.reservation_date===date&&odActiveReservation(row));
    return `<section class="od-card"><h2>${odText(en,id)}</h2><p class="od-subtitle">${date} · ${rows.length} ${odText('bookings','reservasi')} · ${odPax(rows)} pax</p>${odReservationRows(rows)}</section>`;
  }).join('')}</div><section class="od-card od-detail-panel"><h2>${odText('Upcoming Large Parties','Rombongan Besar Mendatang')}</h2><p class="od-subtitle">${threshold}+ pax · ${odText('Today onward, including beyond the three-day window. Excludes arrived/completed.','Mulai hari ini, termasuk setelah tiga hari. Tidak termasuk sudah datang/selesai.')}</p>${odReservationRows(large.filter(row=>odActiveReservation(row)&&Number(row.pax)>=threshold&&!['Arrived','Completed'].includes(row.status)))}</section>`;
}
function odRenderSettings() {
  if(!['admin','manager'].includes(currentStaffRole()))return;
  const host=document.getElementById('management-threshold-settings');if(!host)return;
  host.innerHTML=`<section class="od-card od-threshold"><h2>${odText('Reservation Outlook','Agenda Reservasi')}</h2><label for="od-large-party-pax">${odText('Large party minimum pax','Minimum pax rombongan besar')}</label><input id="od-large-party-pax" class="form-input" type="number" min="1" max="500" step="1" value="${odThreshold()}"><p class="od-subtitle">${odText('Management visibility only. Does not change deposit rules or online booking limits.','Hanya untuk tampilan manajemen. Tidak mengubah aturan deposit atau batas reservasi online.')}</p><button class="btn-primary" onclick="odSaveThreshold(this)">${odText('Save outlook threshold','Simpan ambang agenda')}</button><p id="od-threshold-result" role="status"></p></section>`;
}
async function odLoadFinancialHistory() {
  if(!odCanView())return;
  const root=document.getElementById('management-financial-history-content');if(!root)return;
  const {from,to}=getOpsReportDateRange(), identity=odIdentity(), request=++odHistoryState.request;
  const valid=()=>request===odHistoryState.request&&identity===odIdentity()&&odCanView()&&document.getElementById('page-reports')?.classList.contains('active');
  if(!from||!to||from>to){root.textContent=odText('Select a valid report date range.','Pilih rentang tanggal laporan yang valid.');return;}
  root.innerHTML='<p class="od-empty">'+odText('Loading…','Memuat…')+'</p>';
  try {
    const [visits,payments]=await Promise.all([
      odVisitRows('id,spend_amount,spend_recording_status',query=>query.is('voided_at',null).gte('visit_date',from).lte('visit_date',to)),
      odRows('invoice_payments','id,reservation_id,invoice_id,amount,paid_on',query=>query.gte('paid_on',from).lte('paid_on',to))
    ]);
    if(!valid())return;
    const invoiceIds=[...new Set(payments.map(row=>row.invoice_id).filter(Boolean))];
    const invoices=await odByIds('invoices','id,kind,reservation_id','id',invoiceIds);
    if(invoices.length!==invoiceIds.length)throw new Error('Incomplete payment classification');
    if(!valid())return;
    const coverage=odCoverage(visits), deposits=odDepositReceipts(payments,invoices);
    root.innerHTML=`<p class="od-subtitle">${odEscape(from)} — ${odEscape(to)}</p><div class="od-metrics">${odCard(odText('Recorded spending','Belanja tercatat'),coverage.recorded?odMoney(coverage.amount):'—',`${coverage.recorded} / ${visits.length} ${odText('visits recorded','kunjungan tercatat')}; ${coverage.skipped} ${odText('skipped','dilewati')}; ${coverage.missing} ${odText('unknown','tidak diketahui')}`)}${odCard(odText('Net deposit receipts','Penerimaan deposit bersih'),odMoney(deposits.reduce((sum,row)=>sum+Number(row.amount),0)),odText('By payment date, including refunds. Deposit invoices and direct reservation payments only.','Menurut tanggal pembayaran, termasuk pengembalian. Hanya faktur deposit dan pembayaran reservasi langsung.'))}</div><p class="od-footnote">${odText('Spending uses visit dates; deposits use payment dates. These are separate measures and must not be added together as revenue. Missing spending is unknown, not zero.','Belanja menggunakan tanggal kunjungan; deposit menggunakan tanggal pembayaran. Keduanya terpisah dan tidak boleh dijumlahkan sebagai pendapatan. Belanja kosong tidak diketahui, bukan nol.')}</p>`;
  } catch(error) {if(valid())root.innerHTML=odError('odLoadFinancialHistory');}
}
async function odSaveThreshold(button) {
  if(!['admin','manager'].includes(currentStaffRole())||button?.disabled)return;
  const value=Number(document.getElementById('od-large-party-pax')?.value);
  const result=document.getElementById('od-threshold-result');
  if(!Number.isInteger(value)||value<1||value>500){result.textContent=odText('Enter a whole number from 1 to 500.','Masukkan bilangan bulat 1 sampai 500.');return;}
  const identity=odIdentity();
  if(button)button.disabled=true;
  try {
    const {data,error}=await db.from('app_settings').upsert({key:'management_dashboard',value:{large_party_pax:value}},{onConflict:'key'}).select('value');
    if(identity!==odIdentity())return;
    if(error||!data?.length)throw new Error('Save failed');
    APP_SETTINGS.management_dashboard=data[0].value;
    if(typeof settingsCaptureBaseline==='function')settingsCaptureBaseline(document.getElementById('management-threshold-settings'));
    result.textContent=odText('Outlook threshold saved.','Ambang agenda disimpan.');
  } catch(error) { if(identity===odIdentity())result.textContent=odText('Could not save. Please retry.','Gagal menyimpan. Coba lagi.'); }
  finally { if(button)button.disabled=false; }
}

function odChart(visits,range){
 const days=[];for(let day=range.start;day<=range.end;day=odDateShift(day,1))days.push(day);
 const values=days.map(day=>visits.filter(v=>v.visit_date===day).reduce((s,v)=>s+Number(v.pax||0),0));const max=Math.max(1,...values);
 return `<div class="od-chart" role="img" aria-label="${odEscape(days.map((d,i)=>d+': '+values[i]+' pax').join('; '))}">${days.map((day,i)=>`<div class="od-bar-column"><span>${values[i]}</span><div class="od-bar-track"><div style="height:${values[i]/max*100}%" class="od-bar ${i===days.length-1?'od-bar-last':''}"></div></div><small>${day.slice(8)}</small></div>`).join('')}</div>`;
}
