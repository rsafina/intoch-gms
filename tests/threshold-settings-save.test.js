const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const document = new JSDOM(fs.readFileSync('index.html', 'utf8')).window.document;
const src = fs.readFileSync('js/app.js', 'utf8');
const values = { 'high-total':500000, 'high-pax':150000, 'sticky-days':90, spv:10, 'voucher-days':90, 'fam-min':100000, 'fam-voucher':50000, 'com-min':200000, 'com-voucher':100000 };
for (const [key, value] of Object.entries(values)) document.getElementById('set-' + key).value = value;
const week = { open:'10:00', close:'21:00', weekly:{mon:{closed:false,open:'10:00',close:'21:00'}} };
let saved, writes = 0, reloaded = 0, error = null;
const messages = [];
const ctx = vm.createContext({ document, isManagerOrAdmin:()=>true, t:s=>s, toast:s=>messages.push(s),
  readReservationWeek:()=>week, APP_SETTINGS:{reservation_hours:{custom:true}}, loader:()=>{},
  supabaseQuery:fn=>fn(), db:{from:()=>({upsert:async rows=>{saved=rows;writes++;return {error};}})},
  loadAppSettings:async()=>{reloaded++;}
});
vm.runInContext(src.slice(src.indexOf('function settingsNum('),src.indexOf('async function recalcAllTiersNow(')),ctx);
(async()=>{
  await ctx.saveThresholdSettings();
  assert.equal(writes,1); assert.equal(reloaded,1);
  assert.equal(saved.find(r=>r.key==='spending_tier').value.high_visit_total,500000);
  const hours=saved.find(r=>r.key==='reservation_hours').value;
  assert.equal(hours.open,'10:00'); assert.equal(hours.close,'21:00'); assert.equal(hours.custom,true);
  assert.equal(hours.weekly.mon.open,'10:00');
  assert.equal(document.getElementById('settings-recalc-hint').classList.contains('hidden'),false);
  assert.ok(messages.includes('Settings saved'));
  document.getElementById('set-high-total').value='0';
  await ctx.saveThresholdSettings(); assert.equal(writes,1,'invalid threshold must not be written');
  document.getElementById('set-high-total').value='500000';
  ctx.readReservationWeek=()=>null;
  await ctx.saveThresholdSettings(); assert.equal(writes,1,'invalid weekly hours must not be written');
  ctx.readReservationWeek=()=>week;
  error={message:'Save failed'};
  await ctx.saveThresholdSettings(); assert.equal(reloaded,1); assert.equal(messages.at(-1),'Save failed');
  console.log('Threshold save, validation, weekly hours and database failure checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
