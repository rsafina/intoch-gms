const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const app = fs.readFileSync('js/app.js', 'utf8');
const form = fs.readFileSync('reserve.template.html', 'utf8');
const w = new JSDOM(fs.readFileSync('index.html', 'utf8'), {runScripts:'outside-only', url:'https://demo.test/index.html'}).window;
function lift(src, name, indent='') {
  const match = src.match(new RegExp('^'+indent+'(?:async )?function '+name+'\\([^]*?^'+indent+'}', 'm'));
  assert.ok(match, name); return match[0];
}
w.eval(fs.readFileSync('js/deposit-policy.js','utf8'));
w.eval('var depositActionResId=null, depositActionRes=null, depositInvoiceSaving=false;');
for (const name of ['isLargeReservation','openDepositInvoice','submitDepositInvoice','submitSimpleDepositInvoice','depositInvoiceUrl','largePartyAgreePanel','areaParseRupiah','areaFormatRupiah','onAreaMoneyInput']) w.eval(lift(app,name));
w.CURRENT_LANG='en';
w.APP_SETTINGS = {reservation_hours:{max_pax:20}};
w.t = s=>s; w.escapeHtml = s=>s; w.depositRupiah = n=>'Rp '+Number(n).toLocaleString('id-ID');
w.isManagerOrAdmin = ()=>false; w.canIssueDepositInvoice = ()=>true; w.reservationFormSettings = ()=>({bank_details:'Bank'});
w.refreshAreaDepositHint=()=>{};
w.currentStaffId = ()=>'staff'; w.loader = ()=>{}; w.toast=()=>{};
let modal, full=0, rows=[], next=0, failRead=false;
w.hideModal=()=>{}; w.showModal=id=>{modal=id;}; w.invOpenReservation=async()=>{full++;};
w.loadReservations=async()=>{}; w.waLoadTemplates=async()=>{};
let link; w.waDepositRequestMessage=x=>x.link; w.waOpenChat=(phone,msg)=>{link=msg;return true;};
let res={id:'r1',pax:7,status:'Incoming',is_large_party:false,deposit_required:true,deposit_expected:50000,guests:{name:'Test',phone:'08123456789'}};
w.supabaseQuery=fn=>fn();
w.db={from(table) {
  let op='read', payload; const filters=[];
  const q={select(){return q;},single(){return q;},order(){return q;},eq(k,v){filters.push([k,v]);return q;},
    update(p){op='update';payload=p;return q;},insert(p){op='insert';payload=p;return q;},
    then(resolve){
      if(table==='reservations') return Promise.resolve(resolve({data:op==='read'?res:[{id:res.id}]}));
      if(failRead&&op==='read') return Promise.resolve(resolve({data:null,error:new Error('offline')}));
      const found=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
      if(op==='insert'){const r={...payload,id:'i'+ ++next,token:'t'+next,status:'issued'};rows.push(r);return Promise.resolve(resolve({data:[r]}));}
      if(op==='update') found.forEach(r=>Object.assign(r,payload));
      return Promise.resolve(resolve({data:found}));
    }}; return q;
}};
(async()=>{
  await w.openDepositInvoice('r1'); assert.equal(modal,'modal-deposit-invoice'); assert.equal(full,0);
  assert.match(w.document.getElementById('dep-inv-summary').textContent,/50\.000/);
  await w.submitSimpleDepositInvoice(); assert.equal(rows.length,1); assert.equal(rows[0].total,50000);
  assert.equal(rows[0].doc,undefined); assert.match(link,/deposit-invoice\.html\?t=t1$/);
  rows.push({id:'settlement',reservation_id:'r1',kind:'settlement',status:'issued',total:100000});
  await w.submitSimpleDepositInvoice(); assert.equal(rows.length,2,'repeat request reuses deposit link');
  assert.equal(rows[1].status,'issued','settlement invoices are untouched');
  failRead=true; await w.submitSimpleDepositInvoice(); assert.equal(rows.length,2,'failed lookup cannot create duplicates'); failRead=false;
  res={...res,pax:62,is_large_party:true,status:'Waitlist'};
  await w.openDepositInvoice('r1'); assert.equal(full,1,'large party uses full editor');
  res.deposit_invoice_format='simple';await w.openDepositInvoice('r1');assert.equal(full,1,'large party can use the simplified deposit');assert.equal(modal,'modal-deposit-invoice');
  res.deposit_invoice_format='unselected';await w.openDepositInvoice('r1');assert.equal(modal,'modal-deposit-format','staff chooses the format');
  w.db.rpc=async(name,args)=>{assert.equal(name,'set_reservation_deposit_request');res.deposit_invoice_format=args.p_format;return {data:{ok:true}};};
  await w.chooseDepositFormat('simple');assert.equal(modal,'modal-deposit-invoice');assert.equal(full,1);
  res.deposit_invoice_format='detailed';await w.openDepositInvoice('r1');assert.equal(full,2);
  assert.equal(w.isLargeReservation({...res,pax:10,is_large_party:false,waitlist_reason:'over_capacity'}),false);
  assert.equal(w.isLargeReservation({...res,pax:10,is_large_party:true}),true,'snapshot survives threshold or pax changes');
  const panel=w.largePartyAgreePanel({...res,deposit_required:false}); assert.match(panel,/onAreaMoneyInput/);
  w.document.body.insertAdjacentHTML('beforeend',panel);
  const input=w.document.getElementById('lp-agreed-amount');
  input.value='1000000';input.setSelectionRange(7,7);w.onAreaMoneyInput(input);
  assert.equal(input.value,'1.000.000'); assert.equal(w.areaParseRupiah(input.value),1000000);
  input.value='1250000';input.setSelectionRange(2,2);w.onAreaMoneyInput(input);
  assert.equal(input.value,'1.250.000');assert.equal(input.selectionStart,3,'caret stays after same digit when editing');
  assert.doesNotMatch(w.largePartyAgreePanel({...res,is_large_party:false,deposit_required:false}),/lp-agreed-amount/);
  assert.equal(w.largePartyAgreePanel({...res,is_large_party:false}), '','active deposit has no misleading no-payment notice');
  w.document.body.insertAdjacentHTML('beforeend','<div id="area-cond"></div><input id="f-time"><button id="btn-submit"></button>');
  w.$=id=>w.document.getElementById(id);w.gt=s=>s;w.gtf=s=>s;w.rupiah=w.depositRupiah;
  w.readPaxRaw=()=>41;w.areaSlot=()=>null;w.areaTimeBlocked=()=>false;
  w.eval('var DEPOSIT_FORM={}, GUEST_LANG="en"; var AREAS=[{id:"a",deposit_amount:null}], AREA_ID="a", MAX_PAX=20;');
  w.eval(lift(form,'renderAreaCond','      '));w.renderAreaCond();
  assert.match(w.$('area-cond').textContent,/Deposit \(DP\)To be confirmed/,'large party gets deposit notice even in no-deposit area');
  w.eval('AREAS[0].deposit_amount=50000');w.renderAreaCond();
  assert.doesNotMatch(w.$('area-cond').textContent,/50\.000/,'large party does not see standard deposit');
  w.readPaxRaw=()=>7;w.renderAreaCond();assert.match(w.$('area-cond').textContent,/50\.000/);
  assert.equal(w.$('btn-submit').textContent,'Reserve Now');
  w.areaTimeBlocked=()=>true;w.renderAreaCond();
  assert.equal(w.$('btn-submit').textContent,'Submit request','capacity waitlist is presented as a request');
  w.eval('DEPOSIT_FORM={deposit_basis:"pax",deposit_free_pax:1,deposit_regular_max_pax:20};');
  w.areaTimeBlocked=()=>false;w.readPaxRaw=()=>2;w.renderAreaCond();assert.match(w.$('area-cond').textContent,/staff will contact/i);assert.doesNotMatch(w.$('area-cond').textContent,/50\.000/);
  w.readPaxRaw=()=>1;w.renderAreaCond();assert.doesNotMatch(w.$('area-cond').textContent,/deposit is required/i);
  w.eval('DEPOSIT_FORM.deposit_free_pax=0');w.renderAreaCond();assert.match(w.$('area-cond').textContent,/deposit is required/i);
  console.log('Simplified deposit routing, link reuse, settlement preservation, money input and guest conditions passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
