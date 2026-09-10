const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm');
const {JSDOM}=require('jsdom');
const document=new JSDOM(fs.readFileSync('index.html','utf8')).window.document;
let stored;
const ctx=vm.createContext({document,console,TODAY:'2026-09-10',restaurantName:()=> 'Intoch',escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getStaffSession:()=>({username:'staff'}),toast:()=>{},supabaseQuery:fn=>fn(),db:{from:()=>({upsert:async row=>{stored=row;return {};}})}});
for(const file of ['js/wa.js','js/broadcast.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
(async()=>{
 vm.runInContext('waTemplatesCache = { invoice_send: {body:"Custom {nama} {invoice}"}, birthday:{body:"Happy {nama}",is_broadcast:true} }; waLoadTemplates=async()=>waTemplatesCache;',ctx);
 ctx.bcRenderEditor('transactional');
 for(const key of ['thank_you','follow_up','voucher_ready','birthday','large_party','waitlist_review','deposit_request','deposit_big','invoice_send','reservation_ticket','standalone_voucher']){
  assert.ok(document.querySelector('#wa-settings-editor-list #bc-body-'+key),key);
  assert.equal(ctx.bcValidateBody(key,document.getElementById('bc-body-'+key).value),null,key+' placeholders');
 }
 assert.equal(document.querySelector('#wa-settings-editor-list #bc-body-at_risk'),null);
 assert.equal(document.getElementById('bc-body-deposit_big').value,'Custom {nama} {invoice}');
 await ctx.bcSaveTemplate('birthday'); assert.equal(stored.is_broadcast,false);
 ctx.bcRenderEditor('broadcast');
 assert.ok(document.querySelector('#bc-editor-list #bc-body-at_risk'));
 assert.equal(document.querySelector('#bc-editor-list #bc-body-birthday'),null);
 vm.runInContext('waTemplatesCache.reservation_ticket={body:"Ticket for {nama}"};waTemplatesCache.deposit_big={body:"Deposit {jumlah}"};',ctx);
 const ticket=ctx.waTicketMessage({guestName:'Test',resDate:'2026-09-10',resTime:'19:00',pax:4,link:'https://example.com/ticket'});
 assert.ok(ticket.includes('https://example.com/ticket')); assert.ok(ticket.startsWith('Ticket for'));
 const invoice=ctx.waInvoiceMessage({templateKey:'deposit_big',guestName:'Test',amountText:'Rp 5.000.000',requestedText:'Rp 2.500.000',link:'https://example.com/invoice'});
 assert.ok(invoice.includes('Rp 2.500.000'));assert.ok(invoice.includes('https://example.com/invoice'));assert.ok(invoice.startsWith('Deposit'));
 console.log('WA settings separation, saved wording, placeholder validation, classification, ticket and deposit messages passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
