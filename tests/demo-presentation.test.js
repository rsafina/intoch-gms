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
  assert.ok(win.document.querySelector('#demo-reports #report-new-guests'),'Reuses real acquisition card');
  assert.ok(win.document.querySelector('#demo-reports #ops-demand-0-count'),'Reuses real live cards');
  assert.ok(win.document.querySelector('#demo-reports #ops-peak-traffic-chart'),'Reuses real Peak Traffic');
  assert.equal(win.document.querySelectorAll('#demo-reports [id^="reports-tab-"]').length,0);
  const segments=win.demoGuestSegments([
    {guest_id:'new',pax:2},{guest_id:'new',pax:3},{guest_id:'old',pax:4},
    {guest_id:null,pax:9},{guest_id:'void',pax:4,voided_at:'2026-09-01'}
  ],[
    {guest_id:'old',visit_date:'2026-08-01'},
    {guest_id:'new',visit_date:'2026-09-02'},
    {guest_id:'sixty',visit_date:'2026-07-25'},
    {guest_id:'eightyNine',visit_date:'2026-06-26'},
    {guest_id:'ninety',visit_date:'2026-06-25'},
    {guest_id:'recent',visit_date:'2026-06-01'},
    {guest_id:'recent',visit_date:'2026-07-26'},
    {guest_id:'void',visit_date:'2026-06-01',voided_at:'2026-06-02'},
    {guest_id:'future',visit_date:'2026-10-01'}
  ],'2026-09-01','2026-09-23');
  assert.equal(segments.acquire.ids.size,1);assert.equal(segments.acquire.visits,2);assert.equal(segments.acquire.pax,5);
  assert.equal(segments.retain.ids.size,1);assert.equal(segments.retain.pax,4);
  assert.equal(segments.risk60,2);assert.equal(segments.risk90,1);
  win.document.documentElement.classList.remove('demo-mode');
  assert.equal(win.demoRoute('broadcast'),'broadcast');
  await new Promise(done=>win.setTimeout(done,20));
  dom.window.close();
  console.log('Demo presentation: metrics, errors, role checks and stale-session protection passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
