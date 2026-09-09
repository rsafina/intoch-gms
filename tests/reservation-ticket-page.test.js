const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const w=new JSDOM(fs.readFileSync('reservation-ticket.html','utf8'),{runScripts:'outside-only',url:'https://demo.test/reservation-ticket.html?t=11111111-1111-4111-a111-111111111111'}).window;
let data={name:'<img src=x onerror=alert(1)>',restaurant:'Restaurant',reference:'RSV-123',date:'2026-09-30',time:'19:00:00',pax:4,area:'Indoor',status:'Reserved'};
w.db={rpc:async()=>({data})};w.restaurantName=()=> 'Restaurant';
w.eval(fs.readFileSync('js/reservation-ticket.js','utf8').replace(/loadReservationTicket\(\);\s*$/,''));
(async()=>{
 await w.loadReservationTicket();
 const el=id=>w.document.getElementById(id);
 assert.equal(el('ticket-name').textContent,data.name);assert.equal(el('ticket-name').querySelector('img'),null);
 assert.equal(el('ticket-actions').hidden,false);assert.ok(el('ticket-fields').textContent.includes('19:00 WIB'));
 w.setTicketLanguage('id');assert.equal(el('ticket-download').textContent,'Unduh tiket');
 data={...data,status:'Cancelled'};await w.downloadReservationTicket();
 assert.equal(el('ticket-actions').hidden,true);assert.ok(el('ticket-note').textContent.includes('tidak lagi'));
 data=null;await w.loadReservationTicket();assert.equal(el('guest-ticket').hidden,true);assert.equal(el('ticket-retry').hidden,false);
 console.log('Guest ticket renders safely, supports both languages, and blocks downloads after cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
