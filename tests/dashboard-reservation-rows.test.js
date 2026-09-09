const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('js/app.js','utf8');
const dom = new JSDOM('<div id="dashboard-reservations-list"></div>');
let pagination;
const ctx = vm.createContext({document:dom.window.document, CURRENT_LANG:'en',
  dashboardResData:[], dashboardResPage:0, dashboardResFilter:'all', DASH_PAGE_SIZE:5,
  allAreas:[], resDepositBalances:{paid:{state:'partial',paid:1000000,expected:2500000,outstanding:1500000}},
  isCancelledRes:s=>s.startsWith('Cancelled'), t:s=>s, statusBadge:s=>`<span>${s}</span>`,
  escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  assignedTableNames:r=>r.tableName, formatGuestName:g=>g.name, memberBadge:()=>'', formatSpendingTierBadge:()=>'',
  fmt:{pax:n=>n+' pax'}, renderGuestExtras:g=>g.food_allergy || '',
  waReservationBtns:r=>`<button onclick="follow('${r.id}')">Invoice Followup</button>`,
  depositRupiah:n=>'Rp '+Number(n).toLocaleString('id-ID'), depositDeadline:()=>null,
  renderPaginationControls:(...args)=>{pagination=args;},
});
vm.runInContext(source.slice(source.indexOf('function compareDashboardReservations('),source.indexOf('function renderDashboardWalkIns(')),ctx);
const rows = Array.from({length:7},(_,i)=>({id:i===2?'paid':String(i),status:i===1?'Waitlist':'Reserved',reservation_time:`${10+i}:00:00`,pax:4,guests:{name:'Guest '+i,notes:'A long note '.repeat(30),food_allergy:'Peanuts'},areas:{name:'Indoor'}}));
rows[0].notes='<img src=x onerror=alert(1)>';
ctx.renderDashboardReservations(rows);
const doc=dom.window.document;
assert.equal(doc.querySelectorAll('article').length,5);
assert.equal(doc.querySelector('time').textContent,'10:00');
assert.ok(doc.body.textContent.includes('Rp 1.000.000 / Rp 2.500.000'));
assert.ok(doc.body.textContent.includes('Remaining Rp 1.500.000'));
assert.ok(doc.body.textContent.includes('Unassigned'));
assert.equal(doc.querySelectorAll('img').length,0);
assert.ok(doc.querySelector('details p').textContent.includes('<img'));
assert.ok(doc.body.textContent.includes('Peanuts'));
assert.equal(doc.querySelector('.dash-res-update').getAttribute('onclick'),"openResActions('0')");
ctx.setDashboardReservationFilter('attention');
assert.equal(doc.querySelectorAll('article').length,2);
assert.equal(pagination[2],2);
assert.equal(doc.querySelector('time').textContent,'11:00');
ctx.dashboardResPage=1;
ctx.setDashboardReservationFilter('all');
assert.equal(ctx.dashboardResPage,0);
ctx.CURRENT_LANG='id'; ctx.renderDashboardReservations(rows);
assert.ok(doc.body.textContent.includes('Perlu perhatian'));
assert.ok(doc.body.textContent.includes('Deposit dibayar / diminta'));
ctx.setDashboardReservationFilter('attention');ctx.renderDashboardReservations([]);
assert.equal(doc.querySelectorAll('article').length,0);
assert.ok(doc.body.textContent.includes('Tidak ada reservasi yang perlu perhatian'));
assert.ok(ctx.dashboardDepositSummary({id:'missing',status:'Waitlist',deposit_required:true}).includes('belum tersedia'));
console.log('Dashboard reservation filtering, pagination, payments, actions, notes and languages passed');
