// Isolated visual fixture: uses real management HTML/CSS/JS and synthetic data.
// No client config, Auth session, Supabase connection or external resources.
// Run: node scripts/capture-management-preview.cjs [path-to-chrome]
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'docs/screens/management');fs.mkdirSync(output,{recursive:true});
const executable=process.argv[2]||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const doc=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8')).window.document;
const sections=['page-owner-dashboard','page-reservation-outlook'].map(id=>doc.getElementById(id).outerHTML).join('');
const css=[...doc.querySelectorAll('style')].map(el=>el.textContent).join('\n')+'\n'+fs.readFileSync(path.join(root,'css/owner-dashboard.css'),'utf8').replace(/^\uFEFF/,'');
const script=fs.readFileSync(path.join(root,'js/owner-dashboard.js'),'utf8');
const fixture=`
const CURRENT_LANG=new URLSearchParams(location.search).get('lang')||'en';
const APP_SETTINGS={management_dashboard:{large_party_pax:8}};
const currentStaffRole=()=> 'manager';const currentStaffId=()=> 'fixture';
const restaurantName=()=> 'Intoch Preview';
const disabled=new URLSearchParams(location.search).has('disabled');
const financialTrackingSettings=()=>({depositEnabled:!disabled,spendingEnabled:!disabled});
const ymd=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const fixtureDay='2026-09-14';
const fixtureRows={
 visits:Array.from({length:7},(_,index)=>({id:'v'+index,visit_date:odDateShift(fixtureDay,-index),visit_time:'12:00',pax:[18,36,22,45,28,12,30][index],visit_type:'Walk-In',spend_amount:index?index*150000:null,spend_recording_status:index?'recorded':'skipped'})).concat([{id:'a',reservation_id:'r1',visit_date:fixtureDay,visit_time:'12:00',pax:12,visit_type:'Reservation',spend_amount:1500000}]),
 reservations:[
  {id:'r1',booking_name:'Sinta Family',reservation_date:fixtureDay,reservation_time:'12:00',pax:12,status:'Arrived',assigned_area:'Main Dining',tables:{name:'Table 04'}},
  {id:'r2',booking_name:'PT Nusantara — Team Dinner',reservation_date:fixtureDay,reservation_time:'18:00',pax:16,status:'Incoming',deposit_required:true,deposit_expected:1000000,assigned_area:'Private Dining'},
  {id:'r3',booking_name:'Family Celebration',reservation_date:fixtureDay,reservation_time:'19:30',pax:8,status:'Reserved',assigned_area:'Garden'},
  {id:'r4',booking_name:'Anniversary Lunch',reservation_date:'2026-09-15',reservation_time:'12:30',pax:6,status:'Confirmed',assigned_area:'Main Dining'},
  {id:'r5',booking_name:'Company Gathering',reservation_date:'2026-09-16',reservation_time:'18:30',pax:20,status:'Waitlist',deposit_required:true,deposit_expected:null},
  {id:'r6',booking_name:'December Celebration',reservation_date:'2026-12-20',reservation_time:'18:00',pax:36,status:'Reserved',assigned_area:'Garden'}
 ],
 invoice_payments:[{id:'p1',reservation_id:'r2',amount:1000000,paid_on:fixtureDay},{id:'p2',invoice_id:'i1',amount:-100000,paid_on:fixtureDay}],
 invoices:[{id:'i1',kind:'deposit',reservation_id:'r2',status:'void'}]
};
const db={from(table){let filters=[];return {select(){return this},is(key,value){filters.push(row=>(row[key]??null)===value);return this},eq(key,value){filters.push(row=>row[key]===value);return this},gte(key,value){filters.push(row=>row[key]>=value);return this},lte(key,value){filters.push(row=>row[key]<=value);return this},in(key,values){filters.push(row=>values.includes(row[key]));return this},order(){return this},async range(from,to){return {data:(fixtureRows[table]||[]).filter(row=>filters.every(filter=>filter(row))).slice(from,to+1)}}}}};
odClock=()=>({day:fixtureDay,time:'14:00'});
async function navigateTo(page){odInvalidate();document.querySelectorAll('.page-section').forEach(el=>el.classList.remove('active'));document.body.classList.toggle('summary-dashboard-active',page==='dashboard'||page==='reservation-outlook');document.getElementById(page==='dashboard'?'page-owner-dashboard':'page-reservation-outlook').classList.add('active');await (page==='dashboard'?loadOwnerDashboard():loadReservationOutlook());}
window.addEventListener('load',async()=>{await navigateTo(new URLSearchParams(location.search).get('page')||'dashboard');document.body.dataset.fit=String(document.documentElement.scrollWidth<=innerWidth);document.body.dataset.ready='true';});
`;
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Management visual fixture</title><style>${css}
*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;background:#f8f6f2}button{font:inherit;cursor:pointer;border:0}h1,h2,p{margin:0}.hidden{display:none}.page-section{display:none}.page-section.active{display:block}#app-sidebar{position:fixed;inset:0 auto 0 0;width:220px;display:flex;flex-direction:column;gap:12px;padding:28px 16px;background:white;border-right:1px solid #dfe7ef}#app-sidebar button{text-align:left;padding:12px;background:var(--brand-tint);border-radius:8px}#app-main{margin-left:220px}#app-sidebar h2{margin-bottom:20px;color:var(--brand-ink)}@media(max-width:640px){#app-sidebar{width:60px;padding:12px 4px}#app-sidebar h2,#app-sidebar button span{display:none}#app-sidebar button{padding:12px 4px;font-size:10px}#app-main{margin-left:60px}}
</style></head><body><aside id="app-sidebar"><h2>Intoch</h2><button onclick="navigateTo('dashboard')">▦ <span>Dashboard</span></button><button data-nav="reservation-outlook" onclick="navigateTo('reservation-outlook')">▤ <span class="nav-label">Reservation Outlook</span></button><button>↗ <span>Reports</span></button><button>☷ <span>Staff Dashboard</span></button></aside><main id="app-main">${sections}</main><script>${script}\n${fixture}</script></body></html>`;
new (require('node:vm').Script)(script+'\n'+fixture);
const server=http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);});
let browserProcess,socket;
async function connect(url){
 socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',event=>{const response=JSON.parse(event.data);if(!response.id)return;const handler=pending.get(response.id);if(!handler)return;pending.delete(response.id);clearTimeout(handler.timer);response.error?handler.reject(Error(response.error.message)):handler.resolve(response.result);});
 return (method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timed out: '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://127.0.0.1:'+server.address().port;
 const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'intoch-visual-'));
 browserProcess=spawn(executable,['--headless','--disable-gpu','--no-first-run','--disable-background-networking','--disable-extensions',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const browserUrl=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome did not start')),15000);browserProcess.on('error',reject);browserProcess.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
 const port=new URL(browserUrl).port;
 const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
 const send=await connect(target.webSocketDebuggerUrl);await send('Page.enable');
 for(const [name,width,height,query] of [
  ['dashboard-desktop',1440,1300,''],['dashboard-mobile',390,1900,''],
  ['outlook-desktop',1440,1100,'?page=reservation-outlook'],['outlook-mobile',390,1800,'?page=reservation-outlook'],
  ['tracking-disabled-mobile',390,1500,'?disabled=1&lang=id']]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640});
  await send('Page.navigate',{url:address+query});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
   const state=await send('Runtime.evaluate',{expression:'document.body?.dataset.ready === "true"',returnByValue:true});
   if(state.result.value){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));
  }
  const fit=await send('Runtime.evaluate',{expression:'({width:innerWidth,scroll:document.documentElement.scrollWidth})',returnByValue:true});
  if(!ready||fit.result.value.width!==width||fit.result.value.scroll>width)throw Error(name+': layout not ready or horizontally overflowing '+JSON.stringify(fit.result.value));
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(screenshot.data,'base64'));
  console.log(name+': rendered without horizontal overflow');
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{socket?.close();browserProcess?.kill();server.close();});
