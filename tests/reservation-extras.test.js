const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const w=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://demo.test/'}).window;
w.eval(fs.readFileSync('js/deposit-policy.js','utf8'));
w.eval(fs.readFileSync('js/reservation-extras.js','utf8')+'\nwindow.leaveOnline=()=>{dashboardOnlineView=false; ++dashboardOnlineRequest;};');
Object.assign(w,{CURRENT_LANG:'en',APP_SETTINGS:{reservation_hours:{max_pax:20}},allAreas:[{id:'a',deposit_amount:50000},{id:'b',deposit_amount:0}],
 areaParseRupiah:s=>Number(String(s||'').replaceAll('.','')),toast:()=>{},refreshResTableOccupancy:()=>{},
 updateDashboardReservationTabs:()=>{},dashboardReservationRequest:0,getDashboardDate:n=>n===0?'2026-09-09':'2026-09-22',escapeHtml:s=>String(s),
 clearResSearch:()=>{},loadReservations:()=>{},navigateTo:p=>{w.destination=p;},supabaseQuery:fn=>fn(),
});
const el=id=>w.document.getElementById(id);
el('res-area').innerHTML='<option value="a">Indoor</option><option value="b">Outdoor</option>';
el('res-date').value='2026-09-10';el('res-time').value='19:00';el('res-pax').value='4';
w.updateStaffDepositDefaults(true);assert.equal(el('res-request-deposit').checked,true);assert.equal(el('res-deposit-amount').value,'50.000');
let deposit=w.readStaffDeposit();assert.equal(deposit.status,'Incoming');assert.equal(deposit.deposit_expected,50000);assert.equal(deposit.deposit_due_at,'2026-09-10T12:00:00.000Z');
el('res-area').value='b';w.updateStaffDepositDefaults(true);assert.equal(el('res-request-deposit').checked,false);
el('res-request-deposit').checked=true;el('res-deposit-amount').value='75.000';w.onStaffDepositChange();assert.equal(w.readStaffDeposit().deposit_expected,75000);
el('res-pax').value='40';w.updateStaffDepositDefaults(true);assert.equal(el('res-request-deposit').checked,true);assert.equal(w.readStaffDeposit(),false);
 w.APP_SETTINGS.reservation_form={deposit_basis:'pax',deposit_free_pax:1,deposit_regular_max_pax:20};
 el('res-pax').value='2';w.updateStaffDepositDefaults(true);assert.equal(w.readStaffDeposit().status,'Incoming');assert.equal(w.readStaffDeposit().deposit_expected,null);assert.equal(w.readStaffDeposit().deposit_due_at,null);
 el('res-pax').value='21';w.updateStaffDepositDefaults(true);assert.equal(w.readStaffDeposit().status,'Waitlist');assert.equal(w.readStaffDeposit().deposit_invoice_format,'unselected');
 w.APP_SETTINGS.reservation_form={};
el('res-deposit-amount').value='2.500.000';w.onStaffDepositChange();deposit=w.readStaffDeposit();assert.equal(deposit.status,'Waitlist');assert.equal(deposit.deposit_due_at,null);assert.equal(deposit.is_large_party,true);
el('res-request-deposit').checked=false;w.onStaffDepositChange();assert.equal(w.readStaffDeposit().deposit_required,false);
el('res-edit-id').value='existing';w.updateStaffDepositDefaults(true);assert.equal(w.readStaffDeposit(),null);assert.equal(el('res-staff-deposit').hidden,true);
assert.equal(w.reservationTicketButton({status:'Waitlist'}),'');assert.ok(w.reservationTicketButton({id:'r',status:'Reserved'}).includes('Issue ticket'));
const rows=[{reservation_date:'2026-09-10',pax:4,status:'Incoming',created_at:'2026-09-09T10:00:00Z'}, {reservation_date:'2026-09-10',pax:25,status:'Waitlist'}, {reservation_date:'2026-09-10',pax:9,status:'Cancelled'}];
const summary=w.onlineReservationDays(rows)[0];assert.equal(summary.count,2);assert.equal(summary.expectedPax,4);assert.equal(summary.pendingPax,25);assert.equal(summary.incoming,1);
(async()=>{
 // Save the real staff form: deposit fields must reach the reservation insert.
 const app=fs.readFileSync('js/app.js','utf8');
 w.eval(app.match(/^async function saveReservation\([^]*?^}/m)[0]);
 let saved;
 Object.assign(w,{currentResGuestId:'guest',currentStaffId:()=> 'staff',selectedTableIdsFor:()=>[],getTableById:()=>null,
   readAreaBlock:()=>({}),reservationTablesReady:()=>true,readResSourceValue:()=> 'WhatsApp',loader:()=>{},
   updateGuestSpendingTier:async()=>{},hideModal:()=>{},isViewingStaffDashboard:()=>false});
 w.db={from:()=>({insert:async payload=>{saved=payload;return {error:null};}})};
 el('res-edit-id').value='';el('res-area').value='a';el('res-pax').value='4';w.updateStaffDepositDefaults(true);
 await w.saveReservation();assert.equal(saved.deposit_expected,50000);assert.equal(saved.status,'Incoming');assert.equal(saved.reservation_source,'WhatsApp');
 el('res-area').value='b';el('res-pax').value='40';w.updateStaffDepositDefaults(true);el('res-deposit-amount').value='2.500.000';w.onStaffDepositChange();
 await w.saveReservation();assert.equal(saved.status,'Waitlist');assert.equal(saved.deposit_due_at,null);assert.equal(saved.is_large_party,true);
 let calls=0,fail=false;const filters=[];
 w.db={from:()=>{const q={select:()=>q,eq:(...a)=>{filters.push(a);return q;},gte:(...a)=>{filters.push(a);return q;},lte:(...a)=>{filters.push(a);return q;},order:()=>q,range:async()=>{calls++;return fail?{error:true}:{data:rows};}};return q;}};
 await w.showDashboardOnlineReservations();assert.equal(calls,1);assert.ok(el('dashboard-reservations-list').textContent.includes('25 pax pending'));
 assert.ok(filters.some(f=>f[0]==='reservation_source'&&f[1]==='Online Form'));
 assert.ok(filters.some(f=>f[0]==='reservation_date'&&f[1]==='2026-09-22'));
 w.openOnlineReservationDay('2026-09-10');assert.equal(w.resSelectedDate,'2026-09-10');assert.equal(w.destination,'reservations');assert.equal(el('res-online-only').checked,true);
 fail=true;await w.showDashboardOnlineReservations();assert.ok(el('dashboard-reservations-list').textContent.includes('Retry'));assert.ok(!el('dashboard-reservations-list').textContent.includes('No upcoming'));
 // The summary continues past one backend page.
 let pages=0;
 w.db={from:()=>{const q={select:()=>q,eq:()=>q,gte:()=>q,lte:()=>q,order:()=>q,range:async()=>({data:pages++===0?Array.from({length:500},()=>rows[0]):[rows[0]]})};return q;}};
 await w.showDashboardOnlineReservations();assert.equal(pages,2);assert.ok(el('dashboard-reservations-list').textContent.includes('501 online bookings'));
 // Leaving the online tab while a request is pending must preserve the day view.
 let release;
 w.db={from:()=>{const q={select:()=>q,eq:()=>q,gte:()=>q,lte:()=>q,order:()=>q,range:()=>new Promise(resolve=>{release=resolve;})};return q;}};
 const pending=w.showDashboardOnlineReservations();
 w.leaveOnline();el('dashboard-reservations-list').textContent='Daily rows';release({data:rows});await pending;
 assert.equal(el('dashboard-reservations-list').textContent,'Daily rows');
 // Regular staff can reach only the reservation deposit editor, not general invoices.
 const config=fs.readFileSync('js/config.template.js','utf8');
 w.getStaffSession=()=>({id:'s',role:'staff'});w.currentStaffRole=()=> 'staff';w.STAFF_ALLOWED_PAGES=new Set(['reservations']);w.ADMIN_ONLY_PAGES=new Set(['settings-staff']);
 for(const name of ['canIssueDepositInvoice','hasAccess'])w.eval(config.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'))[0]);
 w.invReservationContext=null;assert.equal(w.hasAccess('invoice'),false);
 w.invReservationContext={kind:'deposit'};assert.equal(w.hasAccess('invoice'),true);
 w.invReservationContext={kind:'settlement'};assert.equal(w.hasAccess('invoice'),false);
 w.getStaffSession=()=>null;assert.equal(w.canIssueDepositInvoice(),false);
 console.log('Staff deposit defaults/custom amounts/status/deadlines and independent online overview passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
