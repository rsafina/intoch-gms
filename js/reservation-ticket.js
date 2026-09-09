let ticketData = null;
let ticketLang = new URLSearchParams(location.search).get("lang") === "id" ? "id" : "en";
const ticketWords = {
  en:{eyebrow:"RESERVATION CONFIRMATION",title:"You're on the guest list.",name:"RESERVED FOR",date:"Date",time:"Time",pax:"Guests",area:"Area",download:"Download ticket",help:"Save your confirmation to show when you arrive.",note:"We look forward to welcoming you. Please contact the restaurant if your plans change.",invalid:"This booking is no longer Reserved. Please contact the restaurant for confirmation.",loading:"Loading your confirmation...",error:"We couldn't load this ticket. Please retry or contact the restaurant.",retry:"Retry"},
  id:{eyebrow:"KONFIRMASI RESERVASI",title:"Kami menantikan kedatangan Anda.",name:"DIPESAN UNTUK",date:"Tanggal",time:"Waktu",pax:"Jumlah tamu",area:"Area",download:"Unduh tiket",help:"Simpan konfirmasi ini untuk ditunjukkan saat datang.",note:"Kami menantikan kedatangan Anda. Hubungi restoran jika ada perubahan rencana.",invalid:"Reservasi ini tidak lagi berstatus Reserved. Hubungi restoran untuk konfirmasi.",loading:"Memuat konfirmasi...",error:"Tiket tidak dapat dimuat. Coba lagi atau hubungi restoran.",retry:"Coba lagi"},
};
function setTicketLanguage(lang) { ticketLang=lang === "id" ? "id" : "en"; if(ticketData) renderReservationTicket(); }
function ticketDisplayFields(data) {
  const words=ticketWords[ticketLang];
  return [[words.date,new Date(data.date+"T00:00:00").toLocaleDateString(ticketLang==='id'?'id-ID':'en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})],
    [words.time,String(data.time || '').slice(0,5)+(data.end_time ? ' - '+String(data.end_time).slice(0,5) : '')+' WIB'],[words.pax,String(data.pax)], [words.area,data.area || (ticketLang==='id'?'Dikonfirmasi oleh restoran':'Confirmed by restaurant')],
    ...(data.address ? [[ticketLang==='id'?'Alamat':'Address',data.address]] : []),
    ...(data.phone ? [[ticketLang==='id'?'Hubungi restoran':'Restaurant contact',data.phone]] : [])];
}
function renderReservationTicket() {
  const w=ticketWords[ticketLang], r=ticketData;
  document.documentElement.lang=ticketLang;
  const text=(id,value)=>{document.getElementById(id).textContent=value;};
  text('ticket-restaurant',r.restaurant || restaurantName());text('ticket-eyebrow',w.eyebrow);
  text('ticket-title',r.status==='Reserved'?w.title:(ticketLang==='id'?'Status reservasi berubah':'Reservation status changed'));
  text('ticket-name-label',w.name);text('ticket-name',r.name);text('ticket-reference',r.reference);
  text('ticket-status',r.status);text('ticket-note',r.status==='Reserved'?w.note:w.invalid);
  document.getElementById('ticket-status').classList.toggle('ticket-invalid',r.status!=='Reserved');
  const fields=document.getElementById('ticket-fields');fields.replaceChildren();
  ticketDisplayFields(r).forEach(([label,value])=>{const div=document.createElement('div'),span=document.createElement('span'),strong=document.createElement('strong');span.textContent=label;strong.textContent=value;div.append(span,strong);fields.append(div);});
  text('ticket-download',w.download);text('ticket-download-help',w.help);
  document.getElementById('guest-ticket').hidden=false;
  document.getElementById('ticket-actions').hidden=r.status!=='Reserved';
  document.getElementById('ticket-state').hidden=true;
}
async function loadReservationTicket() {
  const state=document.getElementById('ticket-state'),retry=document.getElementById('ticket-retry');
  state.hidden=false;state.textContent=ticketWords[ticketLang].loading;retry.hidden=true;
  document.getElementById('guest-ticket').hidden=true;document.getElementById('ticket-actions').hidden=true;
  ticketData=null;
  try {
    const token=new URLSearchParams(location.search).get('t');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token||'')) throw new Error('Invalid ticket');
    const {data,error}=await db.rpc('reservation_ticket_by_token',{p_token:token});
    if(error || !data) throw error || new Error('Ticket unavailable');
    ticketData=data;renderReservationTicket();return true;
  } catch (_) {state.textContent=ticketWords[ticketLang].error;retry.textContent=ticketWords[ticketLang].retry;retry.hidden=false;return false;}
}
async function downloadReservationTicket() {
  // Re-check the live status before exporting; cancelled links never download a confirmation.
  if(!(await loadReservationTicket()) || ticketData.status!=='Reserved') return;
  const button=document.getElementById('ticket-download');button.disabled=true;
  try {
    const r=ticketData,w=ticketWords[ticketLang],canvas=document.createElement('canvas');canvas.width=1000;
    const c=canvas.getContext('2d');
    const wrap=(text,width,font)=>{c.font=font;const lines=[];let line='';for(const word of String(text).split(/\s+/)){if(c.measureText(line+' '+word).width>width && line){lines.push(line);line='';} if(c.measureText(word).width>width){for(const letter of word){if(c.measureText(line+letter).width>width){lines.push(line);line='';}line+=letter;}}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;};
    const nameLines=wrap(r.name,840,'48px Georgia'),fields=ticketDisplayFields(r).map(([label,value])=>({label,lines:wrap(value,840,'30px Arial')}));
    const restaurantLines=wrap(r.restaurant || restaurantName(),840,'30px Georgia');
    const logo=document.querySelector('#guest-ticket header img');
    const hasLogo=logo?.complete && logo.naturalWidth>0;
    const logoHeight=hasLogo ? 100 : 0;
    const headerHeight=180+restaurantLines.length*38+logoHeight;
    canvas.height=headerHeight+200+nameLines.length*58+fields.reduce((n,f)=>n+70+f.lines.length*38,0)+150;
    c.fillStyle='#ffffff';c.fillRect(0,0,1000,canvas.height);c.fillStyle='#173a60';c.fillRect(0,0,1000,headerHeight);
    if(hasLogo) {const scale=Math.min(280/logo.naturalWidth,80/logo.naturalHeight);const width=logo.naturalWidth*scale,height=logo.naturalHeight*scale;c.fillStyle='#ffffff';c.fillRect(500-width/2-10,20,width+20,height+12);c.drawImage(logo,500-width/2,26,width,height);}
    c.textAlign='center';c.fillStyle='#ffffff';c.font='30px Georgia';restaurantLines.forEach((line,i)=>c.fillText(line,500,65+logoHeight+i*38));
    c.font='20px Arial';c.fillStyle='#ecd6ae';c.fillText(w.eyebrow,500,headerHeight-70);
    c.textAlign='left';let y=headerHeight+65;c.fillStyle='#707b87';c.font='18px Arial';c.fillText(w.name,80,y);y+=60;
    c.fillStyle='#173a60';c.font='48px Georgia';nameLines.forEach(line=>{c.fillText(line,80,y);y+=58;});y+=25;
    fields.forEach(f=>{c.font='20px Arial';c.fillStyle='#707b87';c.fillText(f.label,80,y);y+=42;c.font='30px Arial';c.fillStyle='#173a60';f.lines.forEach(line=>{c.fillText(line,80,y);y+=38;});y+=28;});
    c.strokeStyle='#c5ad83';c.setLineDash([10,8]);c.beginPath();c.moveTo(50,y);c.lineTo(950,y);c.stroke();y+=50;
    c.textAlign='center';c.font='22px Arial';c.fillStyle='#28603b';c.fillText('Reserved',500,y);y+=44;c.font='24px monospace';c.fillStyle='#173a60';c.fillText(r.reference,500,y);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Download failed');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.reference+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch (_) {document.getElementById('ticket-download-help').textContent=ticketWords[ticketLang].error;}
  finally {button.disabled=false;}
}
loadReservationTicket();
