const fs=require('fs'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const w=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://example.com'}).window;
let role='owner',epoch=0,features={depositEnabled:true,spendingEnabled:true};
w.CURRENT_LANG='en';w.currentStaffRole=()=>role;w.currentStaffId=()=>String(epoch);w.restaurantName=()=>'<Restaurant>';
w.APP_SETTINGS={};w.financialTrackingSettings=()=>features;
w.ymd=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
w.eval(fs.readFileSync('js/owner-dashboard.js','utf8')+'\nwindow.testOverview=ownerOverview;window.odPax=odPax;');
w.HTMLElement.prototype.scrollIntoView=()=>{};
const json=value=>JSON.parse(JSON.stringify(value));
const day='2026-09-14';
const visits=[
 {id:'arrival',reservation_id:'r1',pax:4,visit_type:'Reservation',status:'Active',spend_amount:null,visit_date:day,visit_time:'12:00'},
 {id:'walkin',pax:3,visit_type:'Walk-In',status:'Done',spend_amount:100000,spend_recording_status:'recorded',visit_date:day,visit_time:'12:10'},
 {id:'zero',pax:1,visit_type:'Walk-In',status:'Done',spend_amount:0,spend_recording_status:'recorded',visit_date:day,visit_time:'12:20'},
 {id:'skip',pax:2,visit_type:'Walk-In',status:'Done',spend_amount:null,spend_recording_status:'skipped',visit_date:day,visit_time:'12:30'},
 {id:'void',pax:100,visit_type:'Walk-In',spend_amount:900000,voided_at:'x',visit_date:day,visit_time:'12:40'},
 {id:'late',pax:200,visit_type:'Walk-In',spend_amount:500000,visit_date:day,visit_time:'23:00'},
 {id:'history',pax:5,visit_type:'Reservation',spend_amount:600000,visit_date:'2026-09-08',visit_time:'12:00'},
 {id:'old',pax:90,visit_type:'Reservation',spend_amount:1000000,visit_date:'2026-09-01',visit_time:'12:00'},
];
const reservations=[
 {id:'r1',status:'Reserved',pax:4,reservation_date:day,reservation_time:'12:00'},
 {id:'r2',booking_name:'<img src=x onerror=alert(1)>',status:'Incoming',pax:8,deposit_required:true,deposit_expected:50000,reservation_date:day,reservation_time:'18:00'},
 {id:'r3',status:'Waitlist',pax:12,deposit_required:false,reservation_date:day,reservation_time:'19:00'},
 {id:'phantom',status:'Completed',pax:30,reservation_date:day,reservation_time:'09:00'},
 {id:'cancel',status:'Cancelled',pax:100,reservation_date:day},
 {id:'deleted',status:'Reserved',pax:100,deleted_at:'x',reservation_date:day},
 {id:'tomorrow',status:'Confirmed',pax:6,reservation_date:'2026-09-15'},
 {id:'later',status:'Reserved',pax:14,reservation_date:'2026-12-20'},
 {id:'quote',guests:{name:'Future party'},status:'Waitlist',pax:22,deposit_required:true,deposit_expected:null,reservation_date:'2026-12-21'},
 {id:'future-completed',status:'Completed',pax:22,reservation_date:'2026-12-22'},
];
const payments=[
 {id:'p1',reservation_id:'cancel',amount:100000,paid_on:day},
 {id:'p2',invoice_id:'dep',amount:200000,paid_on:day},
 {id:'p3',invoice_id:'dep',amount:-50000,paid_on:day},
 {id:'p4',invoice_id:'settle',amount:900000,paid_on:day},
 {id:'p5',invoice_id:'general',amount:900000,paid_on:day},
 {id:'p6',reservation_id:'r1',amount:30000,paid_on:'2026-09-01'},
];
const invoices=[{id:'dep',kind:'deposit',reservation_id:'r2',status:'void'},{id:'settle',kind:'settlement',reservation_id:'r2'},{id:'general',kind:'general'}];
const records={visits,reservations,invoice_payments:payments,invoices};
let reads=[];
function fakeDb(source=records,hold=null){return {from(table){
 reads.push(table);let filters=[],sort='id';
 return {select(){return this},is(key,value){filters.push(row=>(row[key]??null)===value);return this},
  eq(key,value){filters.push(row=>row[key]===value);return this},gte(key,value){filters.push(row=>row[key]>=value);return this},
  lte(key,value){filters.push(row=>row[key]<=value);return this},in(key,values){filters.push(row=>values.includes(row[key]));return this},
  order(key){sort=key;return this},async range(from,to){if(hold)await hold;return {data:(source[table]||[]).filter(row=>filters.every(filter=>filter(row))).sort((a,b)=>String(a[sort]).localeCompare(String(b[sort]))).slice(from,to+1),error:null}}};
}};}
function activate(id){w.document.querySelectorAll('.page-section').forEach(el=>el.classList.remove('active'));w.document.getElementById(id).classList.add('active');}
const root=w.document.getElementById('owner-overview-content');
(async()=>{
 assert.equal(w.odClock(new Date('2026-09-13T18:00:00Z')).day,day);
 assert.equal(w.odDateShift('2026-01-01',-1),'2025-12-31');
 assert.equal(w.odDateShift('2024-02-28',1),'2024-02-29');
 w.odClock=()=>({day,time:'14:00'});
 assert.equal(w.odThreshold(),8);w.APP_SETTINGS.management_dashboard={large_party_pax:12};assert.equal(w.odThreshold(),12);
 w.APP_SETTINGS.management_dashboard={large_party_pax:0};assert.equal(w.odThreshold(),8);w.APP_SETTINGS={};
 assert.deepEqual(json(w.odCoverage(visits.slice(0,4))),{recorded:2,skipped:1,missing:1,amount:100000});
 assert.equal(w.odDepositReceipts(payments,invoices).reduce((sum,row)=>sum+row.amount,0),280000,'refunds and void invoices retained; settlement/general excluded');
 activate('page-owner-dashboard');w.db=fakeDb();await w.loadOwnerDashboard();
 assert.equal(w.testOverview.data.today.length,4);assert.equal(w.odPax(w.testOverview.data.today),10);
 assert.equal(w.testOverview.data.queue.length,2,'non-deposit waitlist excluded, future quote included');
 assert.deepEqual(json(w.odLoad(w.testOverview.data.today,reservations.filter(row=>row.reservation_date===day))),{arrived:10,pending:8,waitlist:12},'no double count of arrived reservation; no phantom completed attendance');
 assert.equal(root.querySelectorAll('.od-today .od-metric').length,3);
 assert.equal(root.querySelectorAll('.od-bar-column').length,7);
 assert.equal(root.querySelectorAll('.od-today strong')[0].textContent,'4');
 assert.equal(root.querySelectorAll('.od-today strong')[1].textContent,'3');
 assert.ok(root.textContent.includes('Rp 250.000'));
 assert.ok(root.textContent.includes('2 / 4 visits'));
 w.odShowDetails('deposits');assert.equal(root.querySelector('img'),null);assert.ok(root.textContent.includes('<img src=x'));
 assert.equal(root.querySelectorAll('[onclick*="openResActions"]').length,0);
 await w.odSetPeriod('month');assert.equal(root.querySelectorAll('.od-bar-column').length,7);assert.equal(w.testOverview.data.today.length,4);
 features={depositEnabled:false,spendingEnabled:false};reads=[];await w.loadOwnerDashboard();
 assert.deepEqual(reads,['visits','reservations'],'disabled deposits trigger no ledger/queue queries');
 assert.ok(root.textContent.includes('Revenue'));assert.ok(root.textContent.includes('Spending Tracking is disabled.'));
 assert.ok(!root.textContent.includes('Recorded Deposits'));assert.ok(!root.textContent.includes('Deposit Queue'));
 for(const feature of [{depositEnabled:true,spendingEnabled:false},{depositEnabled:false,spendingEnabled:true}]){
  features=feature;await w.loadOwnerDashboard();assert.equal(root.textContent.includes('Deposit Queue'),feature.depositEnabled);assert.equal(root.textContent.includes('Spending Tracking is disabled.'),!feature.spendingEnabled);
 }
 features={depositEnabled:true,spendingEnabled:true};
 activate('page-reservation-outlook');w.db=fakeDb();await w.loadReservationOutlook();
 const outlook=w.document.getElementById('outlook-content');assert.equal(outlook.querySelectorAll('.od-outlook-days > section').length,3);
 assert.ok(outlook.textContent.includes('2026-12-20'));assert.ok(!outlook.textContent.includes('2026-12-22'));assert.equal(outlook.querySelector('img'),null);
 assert.equal(outlook.querySelectorAll('[onclick]').length,0,'outlook exposes no mutation controls');
 activate('page-owner-dashboard');let release;const pending=new Promise(resolve=>{release=resolve});w.db=fakeDb(records,pending);
 const old=w.loadOwnerDashboard();epoch++;release();await old;assert.equal(w.testOverview.data,null,'old-session success discarded');
 let releaseNavigation;const navigationWait=new Promise(resolve=>{releaseNavigation=resolve});w.db=fakeDb(records,navigationWait);
 const leaving=w.loadOwnerDashboard();w.odInvalidate();activate('page-reservation-outlook');releaseNavigation();await leaving;
 assert.equal(w.testOverview.data,null,'navigation invalidates pending overview');
 let releaseFailure;const failureWait=new Promise(resolve=>{releaseFailure=resolve});
 const brokenData=new Proxy({}, {get(){throw Error('late failure')}});w.db=fakeDb(brokenData,failureWait);
 const failing=w.loadReservationOutlook();epoch++;const loadingText=outlook.textContent;releaseFailure();await failing;
 assert.equal(outlook.textContent,loadingText,'old-session errors do not replace current content');
 activate('page-reservation-outlook');w.db={from(){throw Error('offline')}};await w.loadReservationOutlook();assert.ok(outlook.textContent.includes('Overview unavailable'));
 activate('page-owner-dashboard');const warn=w.console.warn;w.console.warn=()=>{};await w.loadOwnerDashboard();w.console.warn=warn;
 assert.ok(root.textContent.includes('Overview unavailable'));assert.equal(root.querySelectorAll('.od-metric').length,0);
 w.db=fakeDb({visits:[],reservations:[],invoice_payments:[],invoices:[]});await w.loadOwnerDashboard();assert.ok(root.textContent.includes('0 / 0 visits'));assert.ok(root.textContent.includes('—'));
 for(const denied of ['staff','finance']){role=denied;reads=[];await w.loadOwnerDashboard();await w.loadReservationOutlook();assert.equal(reads.length,0);}
 role='manager';reads=[];await w.loadOwnerDashboard();assert.ok(reads.length>0);
 features={depositEnabled:false,spendingEnabled:false};activate('page-reports');w.db=fakeDb();w.getOpsReportDateRange=()=>({from:'2026-09-01',to:day});
 await w.odLoadFinancialHistory();const history=w.document.getElementById('management-financial-history-content');assert.ok(history.textContent.includes('Rp 280.000'));assert.ok(history.textContent.includes('skipped'));
 w.odRenderSettings();let writes=0;w.db={from(){return {upsert(row){writes++;assert.equal(row.key,'management_dashboard');return this},select:async()=>({data:[{value:{large_party_pax:10}}]})}}};
 w.document.getElementById('od-large-party-pax').value='10';await w.odSaveThreshold();assert.equal(w.odThreshold(),10);assert.equal(writes,1);
 w.document.getElementById('od-large-party-pax').value='1.5';await w.odSaveThreshold();assert.equal(writes,1,'reject invalid threshold before writing');
 role='owner';await w.odSaveThreshold();assert.equal(writes,1,'owner cannot change threshold');
 w.CURRENT_LANG='id';role='manager';w.db=fakeDb();activate('page-owner-dashboard');await w.loadOwnerDashboard();assert.ok(root.textContent.includes('Pendapatan'));
 activate('page-reservation-outlook');await w.loadReservationOutlook();assert.ok(outlook.textContent.includes('Lusa'));
 reads=[];w.db=fakeDb({visits:Array.from({length:501},(_,index)=>({id:String(index)}))});assert.equal((await w.odRows('visits','id')).length,501);
 // Exercise the real route swap and staff-view classification for every role.
 const app=fs.readFileSync('js/app.js','utf8').replace(/\r\n/g,'\n');
 w.eval(app.match(/^async function navigateTo\([^]*?^}/m)[0]+'\n'+app.match(/^function isViewingStaffDashboard\([^]*?^}/m)[0]);
 w.SETTINGS_SUBPAGES=[];w.hasAccess=()=>true;w.db=fakeDb();
 let staffLoads=0;w.loadDashboard=async()=>{staffLoads++;};w.setStaffDashboardDateLabel=()=>{};w.renderStaffViewBanner=()=>{};
 for(const managementRole of ['owner','admin','manager']){
  role=managementRole;await w.navigateTo('dashboard');assert.ok(w.document.getElementById('page-owner-dashboard').classList.contains('active'));assert.equal(w.isViewingStaffDashboard(),false);
  await w.navigateTo('reservation-outlook');assert.ok(w.document.getElementById('page-reservation-outlook').classList.contains('active'));
 }
 for(const operator of ['admin','manager']){role=operator;await w.navigateTo('staff-dashboard');assert.equal(w.isViewingStaffDashboard(),true);}
 for(const operator of ['staff','finance']){role=operator;await w.navigateTo('dashboard');assert.equal(w.isViewingStaffDashboard(),true);}
 assert.equal(staffLoads,4);
 w.odReset();assert.equal(root.textContent,'');assert.equal(outlook.textContent,'');assert.equal(history.textContent,'');
 console.log('Management dashboard: attendance, seven-day chart, coverage, deposit ledger, disabled states, outlook, roles, pagination, settings and stale-session checks passed');
 w.close();
})().catch(error=>{console.error(error);w.close();process.exitCode=1;});
