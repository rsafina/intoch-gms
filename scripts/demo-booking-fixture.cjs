/* Loopback QA only. Fictional bookings live in browser storage, never Supabase.
 * Uses real public submit handler, online overview/day navigation and staff row renderer.
 */
const {source,root,runtime,boot} = require('./demo-tour-fixture.cjs');
function extract(file,name) {
  const value=source(file),match=value.match(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  if(!match)throw Error('Missing '+name);
  return value.slice(match.index,value.indexOf('\n}',match.index)+2);
}
const database = `
const fixtureProfile={id:'fixture-admin',role:'admin',is_active:true,auth_user_id:'fixture-auth'};
function fixtureRecord(){try{return JSON.parse(localStorage.getItem('intoch-fixture-online-booking'));}catch{return null;}}
class BookingQuery {
 constructor(table){this.table=table;this.filters=[];this.one=false;this.cap=Infinity;}
 select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}is(){return this;}
 gte(k,v){this.filters.push(r=>r[k]>=v);return this;}lte(k,v){this.filters.push(r=>r[k]<=v);return this;}
 order(){return this;}limit(n){this.cap=n;return this;}range(){return this;}single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}
 async then(resolve,reject){try{
  const wait=window.fixture.delay||0;if(wait)await new Promise(done=>setTimeout(done,wait));
  if(window.fixture.fail===this.table)return resolve({data:null,error:{code:'FIXTURE_READ_FAILED'}});
  const row=fixtureRecord();let rows=this.table==='staff_users'?[fixtureProfile]:this.table==='reservations'?(row?[row]:[]):this.table==='guests'?(row?[{id:row.guest_id,name:row.guests.name,phone:row.guests.phone}]:[]):[];
  rows=rows.filter(row=>this.filters.every(filter=>filter(row))).slice(0,this.cap);
  resolve({data:this.one?rows[0]||null:rows,error:null});
 }catch(error){reject(error);}}
}
function fixtureRpc(name,values){
 if(name==='app_session_valid')return Promise.resolve({data:window.fixture.authValid!==false,error:null});
 if(name!=='create_public_reservation')return Promise.resolve({data:[],error:null});
 return new Promise(resolve=>setTimeout(()=>{
  if(window.fixture.rpcError)return resolve({data:null,error:{code:'FIXTURE_RPC_FAILED'}});
  if(window.fixture.rpcCode)return resolve({data:{ok:false,code:window.fixture.rpcCode},error:null});
  const row={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',guest_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',reservation_date:values.p_date,reservation_time:values.p_time,pax:values.p_pax,status:window.fixture.bookingStatus||'Reserved',reservation_source:'Online Form',created_at:new Date().toISOString(),guests:{name:values.p_name,phone:values.p_phone},areas:{name:'Outdoor Dining'},assigned_area:'outdoor'};
  localStorage.setItem('intoch-fixture-online-booking',JSON.stringify(row));
  localStorage.setItem('intoch-fixture-booking-writes',String(Number(localStorage.getItem('intoch-fixture-booking-writes')||0)+1));
  if(window.fixture.writeThenError)return resolve({data:null,error:{code:'FIXTURE_RESPONSE_LOST'}});
  resolve({data:{ok:true,reservation_id:row.id,status:row.status,waitlisted:row.status==='Waitlist',deposit_required:row.status==='Incoming'},error:null});
 },window.fixture.delay||0));
}
const fixtureAuth={getUser:async()=>({data:{user:{id:'fixture-auth'}},error:null}),onAuthStateChange:callback=>{window.fixture.signOut=()=>callback('SIGNED_OUT');return {data:{subscription:{unsubscribe(){}}}};}};
`;
function staffRuntime() {
  let value=runtime.replace("const TODAY = '2026-10-08';", "const TODAY = ymd(new Date());")
    .replace("const db = {from:table=>new ReadQuery(table),rpc:async()=>({data:[{guest_id:guest.id,visit_count:3,last_visit_date:TODAY}],error:null})};",database+"\nconst db={from:table=>new BookingQuery(table),rpc:fixtureRpc,auth:fixtureAuth};")
    .replace("const getDashboardDate=()=>TODAY;",extract('js/app.js','getDashboardDate'))
    .replace("const loadReservations=()=>fixtureOperations('reservations'),clearResSearch=()=>{},loadWalkIns=()=>fixtureOperations('walkins'),initInvoice=()=>{};",`const clearResSearch=()=>{},loadWalkIns=()=>fixtureOperations('walkins'),initInvoice=()=>{};
async function loadReservations(){const result=await db.from('reservations').select('*').eq('reservation_date',resSelectedDate||TODAY);if(result.error){DemoBookingTour.notify('operations-ready',{page:'reservations',ok:false});return;}await renderReservationsTable(result.data);DemoTour.notify('operations-ready',{page:'reservations',ok:true});DemoBookingTour.notify('operations-ready',{page:'reservations',ok:true,rows:result.data});}`);
  return `function ymd(value){return value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');}\n`+value+`
let dashboardReservationRequest=0,reservationListRenderRequest=0,resSelectedDate=null,resRangeMode='daily',resStatusFilter='all',resSearchActive=null;
const loadDepositBalances=async()=>{},waitlistReasonLine=()=>'';
`+extract('js/app.js','renderReservationsTable')+'\n'+source('js/reservation-extras.js').split('let staffDepositEdited')[0];
}
function strip(value){return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');}
function commonScripts(){return '<script src="assets/vendor/driverjs/1.9.0/driver.js.iife.js"></script><script src="js/demo-tour-environment.js"></script>';}
function staffHtml() {
  let value=strip(source('index.html')).replace('</head>','<script src="https://cdn.tailwindcss.com"></script><style>.hidden{display:none!important}</style></head>');
  return value.replace('</body>',commonScripts()+'<script>'+staffRuntime()+'</script><script src="js/demo.js"></script><script src="js/demo-tour.js"></script><script src="js/demo-booking-tour.js"></script><script>'+boot.replace('DemoTour.sessionReady(fixtureStaff);',`localStorage.setItem('intoch:demo-tour:v1:'+SUPABASE_URL+':'+fixtureStaff.id+':seen',JSON.stringify({status:'skipped',version:1}));DemoTour.sessionReady(fixtureStaff);DemoBookingTour.sessionReady(fixtureStaff);`)+`document.getElementById('res-alert-bell').classList.remove('hidden');document.getElementById('bd-alert-wrap').classList.remove('hidden');document.getElementById('demo-guide').open=true;</script></body>`);
}
function publicRuntime() {
  return `const SUPABASE_URL='https://hkrhsubhfqrgqkuhpvql.supabase.co';let GUEST_LANG='en';window.fixture={delay:0,fail:null};\n`+database+`
const db={from:table=>new BookingQuery(table),rpc:fixtureRpc,auth:fixtureAuth};
const $=id=>document.getElementById(id),gt=value=>value,errMsg=value=>value,ERR_ID={network:'Fixture network error'};
const PageLoading={begin(){}};
const SHOW_PAX_REQUEST=false,DEPOSIT_TRACKING_ENABLED=true,MAX_PAX=20,AREAS=[{id:'outdoor',name:'Outdoor Dining'}];
let AREA_ID='outdoor',AREA_BLOCK_DATE='',submitting=false;
const readPax=()=>Number($('pax-value').value),readPaxRaw=readPax,clampPax=()=>{},renderPaxNote=()=>{};
const showError=value=>{$('form-error').textContent=value;},hideError=()=>{$('form-error').textContent='';};
const largePartyGate=()=>false,largePartyWaLink=()=>null,loadAvailability=async()=>{},areaTimeBlocked=()=>false;
function paxStep(delta){$('pax-value').value=String(Math.max(1,readPax()+delta));}
function chooseFixtureTime(){ $('f-time').value='19:30';$('f-time').dispatchEvent(new Event('input',{bubbles:true})); }
document.documentElement.removeAttribute('data-page-loading');document.documentElement.removeAttribute('data-reserve-loading');document.getElementById('reserve-loading')?.remove();
`;
}
function formHtml() {
  const full=source('reserve.template.html'),start=full.indexOf('      $("res-form").addEventListener("submit", async (e) => {');
  const submit=full.slice(start,full.indexOf('    </script>',start));
  let value=strip(full);
  const setup=publicRuntime()+submit+`
const date=new Date();$('f-date').value=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');AREA_BLOCK_DATE=$('f-date').value;
$('f-date').addEventListener('change',()=>{AREA_BLOCK_DATE=$('f-date').value;});
$('area-field').style.display='block';$('area-pills').innerHTML='<button type="button" class="pill active">Outdoor Dining</button>';
$('time-pills').innerHTML='<button type="button" class="pill" onclick="chooseFixtureTime()">19:30</button>';
`;
  return value.replace('</body>',commonScripts()+'<script>'+setup+'</script><script src="js/demo-booking-tour.js"></script></body>');
}
function createdHtml() {
  return strip(source('reservation-created.template.html')).replace('</body>',commonScripts()+`<script>const SUPABASE_URL='https://hkrhsubhfqrgqkuhpvql.supabase.co';let GUEST_LANG='en';window.fixture={delay:0,fail:null};${database}\nconst db={from:table=>new BookingQuery(table),rpc:fixtureRpc,auth:fixtureAuth};document.documentElement.removeAttribute('data-page-loading');const row=fixtureRecord();document.getElementById('res-summary').textContent=row?row.guests.name+' · '+row.reservation_date+' · '+row.status:'';</script><script src="js/demo-booking-tour.js"></script></body>`);
}
module.exports={staffHtml,staffRuntime,formHtml,createdHtml,publicRuntime,database,root};
