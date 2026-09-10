const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const app = fs.readFileSync('js/app.js','utf8');
const dom = new JSDOM('<table><tbody id="reservations-tbody"></tbody></table>');
const ctx = vm.createContext({document:dom.window.document,CURRENT_LANG:'en',resSearchActive:false,allAreas:[{id:'a',name:'Indoor'}],
 loadDepositBalances:async()=>{}, attachGuestVisitCounts:async rows=>rows.forEach(r=>r._visitCount=7),
 assignedTableNames:r=>r.tableNames,waReservationBtns:()=>'<button>Invoice Followup</button>',
 escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
 formatSpendingTierBadge:()=>'',memberBadge:()=>'',fmt:{pax:n=>n+' pax'},t:s=>s,
 statusBadge:s=>`<span>${s}</span>`,dashboardDepositSummary:()=>'<span>Deposit paid</span>',waitlistReasonLine:()=>'',
});
vm.runInContext(app.slice(app.indexOf('let reservationListRenderRequest'),app.indexOf('async function openResActions')),ctx);
(async()=>{
 const rows=[1,2,3].map(n=>({id:String(n),guest_id:'g',reservation_date:n===3?'2026-09-11':'2026-09-10',reservation_time:'20:00:00',status:'Reserved',pax:4,assigned_area:'a',tableNames:'T1, T2, T3',guests:{name:'Guest',phone:'08123456',food_allergy:'Peanuts'},notes:'<img src=x> Long notes'}));
 await ctx.renderReservationsTable(rows);
 const doc=dom.window.document;
 assert.equal(doc.querySelectorAll('.res-date-group').length,2);
 assert.equal(doc.querySelectorAll('.res-list-row').length,3);
 assert.equal(doc.querySelector('.res-list-row').children.length,5);
 assert.ok(doc.body.textContent.includes('7 visits'));
 assert.ok(doc.body.textContent.includes('Allergy: Peanuts'));
 assert.equal(doc.querySelector('time').textContent,'20:00');
 assert.ok(doc.querySelector('.res-seating-details summary').textContent.includes('+1'));
 assert.equal(doc.querySelector('.res-seating-details p').textContent,'T1, T2, T3');
 assert.equal(doc.querySelectorAll('img').length,0);
 assert.equal(doc.querySelector('.res-booking-details').open,false);
 assert.equal(doc.querySelector('[data-phone]').dataset.phone,'08123456');
 assert.equal(doc.querySelector('.dash-res-update').getAttribute('onclick'),"openResActions('1')");
 ctx.CURRENT_LANG='id';await ctx.renderReservationsTable(rows);
 assert.ok(doc.body.textContent.includes('7 kunjungan'));
 await ctx.renderReservationsTable([]);
 assert.equal(doc.querySelector('td').colSpan,5);
 const html=new JSDOM(fs.readFileSync('index.html','utf8')).window.document;
 assert.equal(html.querySelector('.res-list-table thead tr').children.length,5);
 assert.ok(html.querySelector('.res-list-scroll > table > tbody#reservations-tbody'));
 const occupancy = doc.createElement('div'); occupancy.id='res-occupancy-summary';doc.body.append(occupancy);
 Object.assign(ctx, {
  supabaseQuery:async()=>({data:[],error:null}),
  allAreas:[{id:'a',name:'VIP Room A'},{id:'b',name:'VIP Room B'}],
  allTables:Array.from({length:20},(_,n)=>({id:String(n),area_id:n<10?'a':'b',name:'Room '+n})),
  computeUnplacedStats:()=>({count:0,pax:0}),computeDiningAreaCapacity:()=>({}),renderDiningAreaCard:()=>'',
  minutesToHHMM:n=>String(n),VIP_TIMELINE_START_MIN:600,VIP_TIMELINE_END_MIN:1260,
  renderVipTableTimeline:table=>`<div class="test-room">${table.name}</div>`,
 });
 vm.runInContext(app.slice(app.indexOf('async function renderResOccupancySummary('),app.indexOf('// Builds one VIP table')),ctx);
 await ctx.renderResOccupancySummary('2026-09-10');
 assert.equal(doc.querySelector('.res-vip-accordion').open,false);
 assert.equal(doc.querySelectorAll('.res-vip-scroll section').length,2);
 assert.equal(doc.querySelectorAll('.test-room').length,20);
 doc.querySelector('.res-vip-accordion').open=true;
 await ctx.renderResOccupancySummary('2026-09-10');
 assert.equal(doc.querySelector('.res-vip-accordion').open,true,'refresh preserves expanded state');
 vm.runInContext(app.slice(app.indexOf('function computeDiningAreaCapacity('),app.indexOf('async function renderResOccupancySummary(')),ctx);
 ctx.allAreas.push({id:'indoor',name:'Indoor',capacity:40},{id:'outdoor',name:'Outdoor',capacity:60},{id:'smoking',name:'Outdoor - Smoking',capacity:20});
 ctx.supabaseQuery=async()=>({data:[{assigned_area:'smoking',pax:5},{assigned_area:'indoor',pax:4}],error:null});
 await ctx.renderResOccupancySummary('2026-09-10');
 assert.ok(occupancy.textContent.includes('Outdoor - Smoking'));
 assert.ok(!occupancy.textContent.includes('Indoor Dining'));
 let stats=ctx.computeDiningAreaCapacity(ctx.allAreas.find(a=>a.id==='smoking'),[{assigned_area:'smoking',pax:5},{assigned_area:'outdoor',pax:9}]);
 assert.equal(stats.capacity,20);assert.equal(stats.reservedPax,5);assert.equal(stats.remaining,15);
 ctx.allAreas.find(a=>a.id==='smoking').name='Terrace <garden>';
 await ctx.renderResOccupancySummary('2026-09-10');
 assert.ok(occupancy.textContent.includes('Terrace <garden>'));
 assert.equal(occupancy.querySelector('garden'),null);
 assert.equal(ctx.computeDiningAreaCapacity(ctx.allAreas.find(a=>a.id==='smoking'),[{assigned_area:'smoking',pax:5}]).reservedPax,5);
 console.log('Reservation list date groups, visit counts, details, seating, escaping, actions and language passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
