const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {html,runtime,boot,source}=require('../scripts/demo-tour-fixture.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error));
 const dom=new JSDOM(html().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'http://127.0.0.1:8080',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const win=dom.window,OriginalDate=win.Date;
 win.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:['2026-10-08T12:00:00+07:00']));}};
 win.matchMedia=()=>({matches:true});win.CSS={escape:value=>value};win.scrollTo=()=>{};win.HTMLElement.prototype.scrollIntoView=function(){};
 const originalStyle=win.getComputedStyle.bind(win);win.getComputedStyle=node=>new Proxy(originalStyle(node),{get:(style,property)=>property==='opacity'?style.opacity||'1':typeof style[property]==='function'?style[property].bind(style):style[property]});
 win.HTMLElement.prototype.getBoundingClientRect=function(){const hidden=this.closest('.hidden')||this.closest('.page-section:not(.active)');return {x:20,y:80,left:20,top:80,right:320,bottom:130,width:hidden?0:300,height:hidden?0:50};};
 win.eval(source('assets/vendor/driverjs/1.9.0/driver.js.iife.js')+'\n'+source('js/demo-tour-environment.js')+'\n'+runtime+'\n'+source('js/demo.js')+'\n'+source('js/demo-tour.js')+`\n
 visits.push({guest_id:second.id,visit_date:'2026-10-05',pax:3,visit_type:'Reservation',guests:second});
 visits.push({guest_id:second.id,visit_date:'2026-06-01',pax:9,voided_at:'2026-06-02',guests:second});
 visits.push({guest_id:'risk',visit_date:'2026-07-20',pax:2,guests:{name:'Fictional Risk'}});
 bookings.push({id:'cancelled',reservation_date:TODAY,pax:3,status:'Cancelled'});
 bookings.push({id:'deleted',reservation_date:TODAY,pax:99,status:'Reserved',deleted_at:TODAY});
 localStorage.setItem('intoch:demo-tour:v1:'+SUPABASE_URL+':fixture-admin:seen',JSON.stringify({status:'skipped'}));
 `+boot);
 await win.eval('navigateTo("reports")');
 const value=id=>win.document.getElementById(id).textContent;
 assert.equal(win.document.getElementById('demo-reports').dataset.reportState,'ready');
 assert.equal(value('report-total-guests'),'2');assert.equal(value('report-new-guests'),'1');assert.equal(value('mkt-retain-total'),'1');
 assert.equal(value('ops-demand-0-count'),'1');assert.equal(value('ops-today-cancelled-count'),'1');assert.equal(value('ops-forecast-this-week'),'1','Cancelled/deleted forecasts excluded');
 assert.equal(value('opp-at-risk'),'1');win.switchAtRiskTab('90');assert.equal(value('opp-at-risk'),'0');win.switchAtRiskTab('60');
 await win.setMarketingRange('today');await sleep(30); // Existing inline handler starts the asynchronous read.
 for(let i=0;i<80&&win.document.getElementById('demo-reports').dataset.reportState!=='ready';i++)await sleep(20);
 assert.equal(value('report-total-guests'),'1');assert.equal(value('report-new-guests'),'0');assert.equal(value('ops-demand-0-count'),'1','Live cards independent of period');
 win.DemoTour.start('reports');await sleep(100);assert.match(win.document.querySelector('.driver-popover-title').textContent,/Turn visits/);
 win.DemoTour.pause();assert.ok(win.document.querySelector('.demo-tour-dock'));win.DemoTour.resume();await sleep(100);
 win.DemoTour.exit();
 win.fixture.fail='visits';await win.loadDemoReports();assert.equal(win.document.getElementById('demo-reports').dataset.reportState,'error');assert.match(value('demo-reports-status'),/unavailable/);
 win.fixture.fail=null;await win.loadDemoReports();assert.equal(win.document.getElementById('demo-reports').dataset.reportState,'ready');
 win.fixture.delay=100;const loading=win.loadDemoReports();win.eval('fixture.changeIdentity(null);resetDemoPresentation();');await loading;
 assert.equal(value('ops-demand-0-count'),'—','Late session results discarded');
 assert.equal(win.fixture.writes,0);assert.deepEqual(errors,[]);dom.window.close();
 console.log('Demo Reports: real cards/calculations, date/risk controls, excluded voided/deleted rows, guide, failed reads and logout generations passed.');
})().catch(error=>{console.error(error);process.exit(1);});
