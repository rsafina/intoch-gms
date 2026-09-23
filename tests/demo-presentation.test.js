const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const source = fs.readFileSync(path.join(root,'js/demo.js'),'utf8');

(async () => {
  const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{runScripts:'outside-only',url:'https://demo.test'});
  const win=dom.window;
  win.eval(source);
  win.initDemoPresentation();
  assert.equal(win.document.querySelectorAll('#demo-guide').length,1);
  win.initDemoPresentation();
  assert.equal(win.document.querySelectorAll('#demo-guide').length,1);
  assert.equal(win.demoRoute('broadcast'),'dashboard');
  assert.equal(win.demoRoute('invoice'),'invoice');
  const metrics=win.demoMetrics([
    {guest_id:'old',pax:2,spend_amount:200},
    {guest_id:'new',pax:3,spend_amount:300},
    {guest_id:'new',pax:1,spend_amount:0},
    {guest_id:'new',pax:null,spend_amount:null},
    {guest_id:null,pax:1,spend_amount:50},
    {guest_id:'old',pax:20,spend_amount:9999,voided_at:'2026-09-01'},
  ],new Set(['old']));
  assert.equal(metrics.visits,5); assert.equal(metrics.pax,7);
  assert.equal(metrics.total,550); assert.equal(metrics.average,137.5);
  assert.equal(metrics.returning,200); assert.equal(metrics.fresh,300);
  assert.equal(metrics.unlinked,50); assert.equal(metrics.missing,1);
  assert.equal(win.demoMetrics([{spend_amount:null}],new Set()).average,null);
  Object.assign(win,{
    hasAccess:()=>true,currentPage:'reports',odIdentity:()=> 'session1',
    odRange:()=>({start:'2026-09-01',end:'2026-09-23'}),
    fmt:{currency:value=>`Rp ${value}`,date:value=>value},
    odRows:async()=>[{guest_id:'old',pax:2,spend_amount:200}],
    odByIds:async()=>[{guest_id:'old'}]
  });
  await win.loadDemoReports();
  assert.match(win.document.getElementById('demo-report-content').textContent,/Rp 200/);
  win.odRows=async()=>[{guest_id:'old',pax:4,spend_amount:200},{guest_id:'old',pax:2,spend_amount:201},{guest_id:'old',pax:1,spend_amount:201}];
  win.CURRENT_LANG='id';
  let selectedPeriod;
  win.odRange=period=>{selectedPeriod=period;return {start:'2026-09-23',end:'2026-09-23'};};
  await win.setDemoReportPeriod('today');
  assert.equal(selectedPeriod,'today');
  assert.equal(win.document.querySelector('[data-demo-period="today"]').getAttribute('aria-pressed'),'true');
  assert.equal(win.document.querySelector('[data-demo-period="month"]').getAttribute('aria-pressed'),'false');
  const cards=win.document.querySelectorAll('#demo-report-content .demo-metric');
  assert.equal(cards[0].querySelector('h2').textContent,'Kunjungan');
  assert.equal(cards[0].querySelector('strong').textContent,'3');
  assert.equal(cards[1].querySelector('strong').textContent,'7');
  assert.equal(cards[3].querySelector('strong').textContent,'Rp 201');
  win.CURRENT_LANG='en';
  win.odRows=async()=>{throw Error('RLS/network failure');};
  await win.loadDemoReports();
  assert.match(win.document.getElementById('demo-report-content').textContent,/Report unavailable/);
  assert.doesNotMatch(win.document.getElementById('demo-report-content').textContent,/Rp 0/);
  let resolve;
  win.odRows=()=>new Promise(done=>{resolve=done;});
  const loading=win.loadDemoReports();
  win.resetDemoPresentation();
  resolve([]); await loading;
  assert.equal(win.document.getElementById('demo-report-content').textContent,'');
  let queried=false;
  win.hasAccess=()=>false; win.odRows=async()=>{queried=true;return [];};
  await win.loadDemoReports(); assert.equal(queried,false);
  win.document.documentElement.classList.remove('demo-mode');
  assert.equal(win.demoRoute('broadcast'),'broadcast');
  await new Promise(done=>win.setTimeout(done,20));
  dom.window.close();
  console.log('Demo presentation: metrics, errors, role checks and stale-session protection passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
