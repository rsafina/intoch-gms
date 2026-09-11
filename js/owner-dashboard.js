/* Owner/Admin overview. Read-only queries use the existing authenticated client. */
const ownerOverview = { period: 'today', request: 0, data: null };
const odText = (en, id) => typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'id' ? id : en;
const odMoney = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID', {maximumFractionDigits:0});
const odEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function odDateShift(day, offset) { const date = new Date(day+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()+offset); return date.toISOString().slice(0,10); }
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
    if(error) throw new Error(error.message || 'Could not load summary');
    rows.push(...(data || [])); if((data || []).length<500) return rows;
  }
}
async function odByIds(table, columns, key, ids, configure=q=>q, order='id') {
  const result=[];
  for(let i=0;i<ids.length;i+=150) result.push(...await odRows(table,columns,q=>configure(q.in(key,ids.slice(i,i+150))),order));
  return result;
}
function odMetrics(visits,range,priorIds=new Set()) {
  const valid=visits.filter(v=>!v.voided_at);
  const current=valid.filter(v=>v.visit_date>=range.start && v.visit_date<=range.end && (v.visit_date<range.end || !v.visit_time || v.visit_time.slice(0,5)<=range.time));
  const previousAll=valid.filter(v=>v.visit_date>=range.prevStart && v.visit_date<=range.prevEnd);
  const comparisonReady=previousAll.length>0 && !previousAll.some(v=>v.visit_date===range.prevEnd && !v.visit_time) && !current.some(v=>v.visit_date===range.end && !v.visit_time);
  const previous=previousAll.filter(v=>v.visit_date<range.prevEnd || (v.visit_time && v.visit_time.slice(0,5)<=range.time));
  const pax=rows=>rows.reduce((sum,v)=>sum+Number(v.pax || 0),0);
  const spent=rows=>rows.reduce((sum,v)=>sum+Number(v.spend_amount || 0),0);
  const guests=new Set(current.map(v=>v.guest_id).filter(Boolean));
  const repeat=[...guests].filter(id=>priorIds.has(id)).length;
  const walkins=current.filter(v=>v.visit_type==='Walk-In');
  const delta=comparisonReady && pax(previous)>0 ? (pax(current)-pax(previous))/pax(previous)*100 : null;
  return {current,pax:pax(current),spend:spent(current),walkins:walkins.length,walkinPax:pax(walkins),previousPax:pax(previous),delta,repeat:guests.size?Math.round(repeat/guests.size*100):null,guestCount:guests.size,unrecorded:current.filter(v=>v.spend_amount==null).length};
}
function odReservationTotals(rows){
  const active=rows.filter(r=>!r.deleted_at&&!['Deleted','Cancelled','Cancelled (No Show)','No Show'].includes(r.status));
  const waiting=active.filter(r=>r.status==='Waitlist');const confirmed=active.filter(r=>['Reserved','Arrived','Completed'].includes(r.status));
  return {count:active.length,confirmed:confirmed.length,pax:confirmed.reduce((s,r)=>s+Number(r.pax||0),0),waiting:waiting.length,waitingPax:waiting.reduce((s,r)=>s+Number(r.pax||0),0),incoming:active.filter(r=>r.status==='Incoming').length};
}
function odLeaderboard(visits){
 const map=new Map();for(const v of visits){if(!v.guest_id||v.voided_at)continue;map.set(v.guest_id,(map.get(v.guest_id)||0)+Number(v.spend_amount||0));}
 return [...map].filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5);
}
async function loadOwnerDashboard(){
  if(!['admin','owner'].includes(currentStaffRole())) return;
  const root=document.getElementById('owner-overview-content'); if(!root)return;
  const request=++ownerOverview.request; const range=odRange(ownerOverview.period); const now=new Date();
  odRenderHeader(range,true);
  root.innerHTML='<div class="od-loading" role="status">'+odText('Loading restaurant overview…','Memuat ringkasan restoran…')+'</div>';
  try{
    const [visits,reservations,overdue]=await Promise.all([
      odRows('visits','id,guest_id,pax,spend_amount,visit_date,visit_time,visit_type,voided_at',q=>q.is('voided_at',null).gte('visit_date',range.prevStart).lte('visit_date',range.end)),
      odRows('reservations','id,booking_name,reservation_date,reservation_time,status,pax,deleted_at',q=>q.is('deleted_at',null).gte('reservation_date',range.start).lte('reservation_date',odDateShift(range.end,6))),
      odRows('reservations','id,booking_name,reservation_date,pax,deposit_due_at',q=>q.is('deleted_at',null).eq('deposit_required',true).in('status',['Incoming','Waitlist','Reserved']).lt('deposit_due_at',now.toISOString()))
    ]);
    const current=odMetrics(visits,range).current; const guestIds=[...new Set(current.map(v=>v.guest_id).filter(Boolean))];
    const [history,balances]=await Promise.all([
      odByIds('visits','id,guest_id','guest_id',guestIds,q=>q.is('voided_at',null).lt('visit_date',range.start)),
      odByIds('reservation_deposit_balances','reservation_id,outstanding','reservation_id',overdue.map(r=>r.id),q=>q,'reservation_id')
    ]);
    const metrics=odMetrics(visits,range,new Set(history.map(v=>v.guest_id)));
    const leaders=odLeaderboard(metrics.current);
    const names=await odByIds('guests','id,name','id',leaders.map(([id])=>id));
    const balanceMap=new Map(balances.map(b=>[b.reservation_id,Number(b.outstanding)]));
    const due=overdue.filter(r=>(balanceMap.get(r.id)||0)>0).map(r=>({...r,outstanding:balanceMap.get(r.id)}));
    if(request!==ownerOverview.request || !document.getElementById('page-owner-dashboard')?.classList.contains('active'))return;
    ownerOverview.data={range,visits,metrics,reservations,due,leaders,names};
    odRenderOverview(root,ownerOverview.data);odRenderHeader(range,false,now);
  }catch(error){
    if(request!==ownerOverview.request)return;
    ownerOverview.data=null;
    root.innerHTML='<div class="od-error" role="alert"><h2>'+odText('Overview unavailable','Ringkasan belum tersedia')+'</h2><p>'+odText('The data could not be loaded. Please retry; no totals are being shown.','Data gagal dimuat. Coba lagi; total belum ditampilkan.')+'</p><button class="btn-primary" onclick="loadOwnerDashboard()">'+odText('Retry','Coba lagi')+'</button></div>';
    odRenderHeader(range,false); console.warn('Owner overview load failed',error);
  }
}
function odRenderHeader(range,loading,updated){
 const host=document.getElementById('owner-overview-header');
 document.querySelectorAll('.od-mobile-nav button').forEach((button,i)=>{button.textContent=[odText('Overview','Ringkasan'),odText('Reports','Laporan'),'Menu'][i];});
 host.innerHTML=`<div><p class="od-eyebrow">${odEscape(restaurantName())} · ${currentStaffRole()==='owner'?'Owner':'Admin'}</p><h1>${odText('Restaurant overview','Ringkasan restoran')}</h1><p class="od-dates">${range.start===range.end?range.end:range.start+' — '+range.end}</p></div><div class="od-header-controls"><div class="od-periods" aria-label="${odText('Period','Periode')}">${[['today','Today','Hari ini'],['week','7 days','7 hari'],['month','Month','Bulan ini']].map(([key,en,id])=>`<button aria-pressed="${key===ownerOverview.period}" onclick="odSetPeriod('${key}')">${odText(en,id)}</button>`).join('')}</div><button class="od-refresh" onclick="loadOwnerDashboard()" ${loading?'disabled':''}>${loading?odText('Loading…','Memuat…'):odText('Refresh','Muat ulang')}</button><small>${updated?odText('Updated ','Diperbarui ')+odClock(updated).time+' WIB':odText('Jakarta time','Waktu Jakarta')}</small></div>`;
}
function odSetPeriod(key){if(!['today','week','month'].includes(key))return;ownerOverview.period=key;loadOwnerDashboard();}
const odChevron='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
function odRenderOverview(root,data){
 const {range,metrics:m,reservations,due,leaders,names}=data;
 const totals=odReservationTotals(reservations.filter(r=>r.reservation_date<=range.end));
 const upcoming=reservations.filter(r=>r.reservation_date>=range.end);const next=odReservationTotals(upcoming);
 const requests=upcoming.filter(r=>r.status==='Waitlist');
 const attention=Number(requests.length>0)+Number(due.length>0);
 const meaningful=m.delta!==null&&m.previousPax>=5;
 const down=meaningful&&m.delta<=-15;
 const title=!meaningful?odText('Building a clearer picture','Mengumpulkan gambaran usaha'):down?odText('Visit pace is down','Kunjungan melambat'):odText('Visit pace is steady','Kunjungan relatif stabil');
 const delta=meaningful?`${m.delta>=0?'+':''}${Math.round(m.delta)}%`:odText('Not enough comparison data','Data pembanding belum cukup');
 const card=(label,value,detail)=>`<article class="od-metric"><h2>${label}</h2><strong>${value}</strong><p>${detail}</p></article>`;
 root.innerHTML=`<section class="od-verdict ${down?'od-verdict-warning':''}"><div><p class="od-eyebrow">${odText('At a glance','Sekilas')}</p><h2>${title}</h2><p>${odText('Guest visits','Kunjungan tamu')}: ${delta}</p><small>${odText('Comparison','Pembanding')}: ${range.prevStart} — ${range.prevEnd}, ${odText('through','sampai')} ${range.time} WIB</small></div><a href="#od-attention">${attention?`${attention} ${odText('areas need attention','hal perlu perhatian')}`:odText('No booking or deposit alerts','Tidak ada peringatan reservasi atau deposit')} ${odChevron}</a></section>
 <div class="od-metrics">${card(odText('Recorded spend','Belanja tercatat'),odMoney(m.spend),`${m.unrecorded} ${odText('visits without spend recorded','kunjungan belum mencatat belanja')}`)}${card(odText('Guest visits','Kunjungan tamu'),m.pax+' pax',`${m.current.length} ${odText('visits','kunjungan')}`)}${card(odText('Reservations','Reservasi'),totals.count,`${totals.pax} pax ${odText('confirmed','dikonfirmasi')} · ${totals.incoming} ${odText('awaiting deposit','menunggu deposit')}`)}${card(odText('Walk-ins','Walk-in'),m.walkins,`${m.walkinPax} pax`)}</div>
 <p class="od-footnote">${odText('Recorded guest spending, not audited revenue. Waitlisted guests are excluded from confirmed pax.','Belanja tamu tercatat, bukan pendapatan yang diaudit. Pax terkonfirmasi tidak termasuk daftar tunggu.')}</p>
 <div class="od-panels"><section class="od-card" id="od-attention"><div class="od-card-title"><h2>${odText('Needs attention','Perlu perhatian')}</h2><span class="od-count">${attention}</span></div>${requests.length?`<button class="od-alert" onclick="odShowDetails('requests')"><span><strong>${requests.length} ${odText('booking requests','permintaan reservasi')}</strong><small>${odText('Next 7 days · awaiting review','7 hari ke depan · menunggu keputusan')}</small></span>${odChevron}</button>`:''}${due.length?`<button class="od-alert" onclick="odShowDetails('deposits')"><span><strong>${due.length} ${odText('overdue deposits','deposit lewat jatuh tempo')}</strong><small>${odMoney(due.reduce((s,r)=>s+r.outstanding,0))} · ${odText('all outstanding dates','semua tanggal tertunggak')}</small></span>${odChevron}</button>`:''}${!attention?`<p class="od-empty">${odText('No requests awaiting review in the next 7 days, or overdue deposits.','Tidak ada permintaan menunggu keputusan dalam 7 hari atau deposit tertunggak.')}</p>`:''}</section>
 <section class="od-card"><h2>${odText('Visits in this period','Kunjungan pada periode ini')}</h2><p class="od-subtitle">${m.pax} pax · ${odText('arrivals, including walk-ins','kedatangan, termasuk walk-in')}</p>${odChart(m.current,range)}</section>
 <section class="od-card"><h2>${odText('Next 7 days','7 hari ke depan')}</h2><p class="od-large">${next.count} ${odText('reservations','reservasi')}</p><p>${next.pax} pax ${odText('confirmed','dikonfirmasi')}</p><p class="od-subtitle">${next.waiting} ${odText('requests','permintaan')} · ${next.waitingPax} pax ${odText('awaiting a decision','menunggu keputusan')}</p><button class="od-text-button" onclick="odShowDetails('upcoming')">${odText('View summary','Lihat ringkasan')} ${odChevron}</button></section>
 <section class="od-card"><h2>${odText('Guest leaderboard','Peringkat tamu')}</h2><p class="od-subtitle">${odText('Recorded spend · selected period','Belanja tercatat · periode terpilih')}</p>${leaders.length?leaders.map(([id,amount],i)=>`<div class="od-leader"><span class="od-rank">${i+1}</span><span>${odEscape(names.find(n=>n.id===id)?.name||odText('Guest','Tamu'))}</span><strong>${odMoney(amount)}</strong></div>`).join(''):`<p class="od-empty">${odText('No recorded spending yet.','Belum ada belanja tercatat.')}</p>`}</section>
 <section class="od-card od-returning"><div><h2>${odText('Returning guests','Tamu kembali')}</h2><p class="od-subtitle">${odText('Visited before this period','Pernah datang sebelum periode ini')}</p></div><strong>${m.repeat===null?'—':m.repeat+'%'}</strong></section></div><div id="od-details"></div>`;
}
function odChart(visits,range){
 const days=[];for(let day=range.start;day<=range.end;day=odDateShift(day,1))days.push(day);
 const values=days.map(day=>visits.filter(v=>v.visit_date===day).reduce((s,v)=>s+Number(v.pax||0),0));const max=Math.max(1,...values);
 return `<div class="od-chart" role="img" aria-label="${odEscape(days.map((d,i)=>d+': '+values[i]+' pax').join('; '))}">${days.map((day,i)=>`<div class="od-bar-column"><span>${values[i]}</span><div class="od-bar-track"><div style="height:${values[i]/max*100}%" class="od-bar ${i===days.length-1?'od-bar-last':''}"></div></div><small>${day.slice(8)}</small></div>`).join('')}</div>`;
}
function odShowDetails(kind){
 const d=ownerOverview.data;if(!d)return;
 const upcoming=d.reservations.filter(r=>r.reservation_date>=d.range.end);
 const rows=kind==='deposits'?d.due:kind==='requests'?upcoming.filter(r=>r.status==='Waitlist'):upcoming;
 const title=kind==='deposits'?odText('Overdue deposits','Deposit tertunggak'):kind==='requests'?odText('Booking requests','Permintaan reservasi'):odText('Upcoming reservations','Reservasi mendatang');
 document.getElementById('od-details').innerHTML=`<section class="od-card od-detail-panel" tabindex="-1"><div class="od-card-title"><h2>${title}</h2><button class="btn-ghost" onclick="document.getElementById('od-details').innerHTML=''">${odText('Close','Tutup')}</button></div><p class="od-subtitle">${odText('Read-only summary','Ringkasan hanya baca')}</p>${rows.filter(r=>!['Deleted','Cancelled','Cancelled (No Show)','No Show'].includes(r.status)).sort((a,b)=>a.reservation_date.localeCompare(b.reservation_date)).map(r=>`<div class="od-detail-row"><span>${odEscape(r.booking_name||odText('Reservation','Reservasi'))}<small>${r.reservation_date} · ${r.pax} pax</small></span><strong>${kind==='deposits'?odMoney(r.outstanding):odEscape(r.status)}</strong></div>`).join('')||odText('No reservations.','Tidak ada reservasi.')}</section>`;
 document.querySelector('.od-detail-panel').focus();document.querySelector('.od-detail-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
function odToggleMenu(){document.body.classList.toggle('summary-menu-open');}
