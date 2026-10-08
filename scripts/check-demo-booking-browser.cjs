// Run demo-tour-preview.cjs --online first. Bookings are browser-local fixtures only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const output = path.resolve(__dirname,'../docs/screens/demo-online-booking');
fs.mkdirSync(output,{recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'intoch-tour-chrome-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9337','--user-data-dir='+profile,'about:blank',
],{windowsHide:true,stdio:'ignore'});
const sleep = milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
let socket;
const watchdog = setTimeout(()=>{chrome.kill();console.error('Tour browser verification timed out');process.exit(1);},180000);
async function main() {
  let tabs;
  for(let attempt=0;attempt<60;attempt++){try{tabs=await(await fetch('http://127.0.0.1:9337/json')).json();break;}catch{await sleep(200);}}
  assert.ok(tabs,'Local headless Chrome started');
  socket=new WebSocket(tabs.find(item=>item.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let sequence=0;const pending=new Map(),errors=[];
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.id){const waiter=pending.get(message.id);pending.delete(message.id);message.error?waiter.reject(message.error):waiter.resolve(message.result);}
  });
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  await command('Runtime.enable');await command('Page.enable');
  async function until(expression,label,timeout=12000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){if(await evaluate(expression))return;await sleep(80);}
    await screenshot('failure');
    throw Error('Timed out: '+label+'; '+JSON.stringify(await evaluate('({title:document.querySelector(".driver-popover-title")?.textContent,toast:window.fixture?.lastToast,drawer:document.body.classList.contains("sidebar-drawer-open"),profileOpen:!document.getElementById("modal-profile")?.classList.contains("hidden"),click:fixture.lastClick,activeBox:document.querySelector(".driver-active-element")?.getBoundingClientRect().toJSON(),scroll:window.scrollX,list:document.querySelector(".res-list-scroll")?.getBoundingClientRect().toJSON(),popover:document.querySelector(".intoch-demo-tour")?.getBoundingClientRect().toJSON(),viewport:{scale:visualViewport.scale,x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height},active:document.querySelector(".driver-active-element")?.outerHTML.slice(0,250)})'))+'; '+errors.join('\n'));
  }
  const title=label=>`document.querySelector('.driver-popover-title')?.textContent === ${JSON.stringify(label)}`;
  async function click(selector){
    await sleep(450); // Driver transition must finish in the focused page before input.
    const rect=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target');node.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const box=node.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2,scale:visualViewport?.scale||1,offsetX:visualViewport?.offsetLeft||0,offsetY:visualViewport?.offsetTop||0};})()`);
    await sleep(200);
    const hit=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});const hit=document.elementFromPoint(${rect.x},${rect.y});return {matches:!!hit&&(node===hit||node.contains(hit)),hit:hit?.outerHTML.slice(0,180),width:innerWidth,rect:node.getBoundingClientRect().toJSON()};})()`);
    assert.ok(hit.matches,'Real click reaches '+selector+': '+JSON.stringify(hit));
    await evaluate(`document.addEventListener('click',event=>{fixture.lastClick={target:event.target.outerHTML.slice(0,180),x:event.clientX,y:event.clientY};},{capture:true,once:true});`);
    const inputPoint={x:(rect.x-rect.offsetX)*rect.scale,y:(rect.y-rect.offsetY)*rect.scale};
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...inputPoint});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...inputPoint});
  }
  async function screenshot(name){await sleep(500);const result=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(result.data,'base64'));}
  async function bounds(label){
    await until(`(()=>{const box=document.querySelector('.intoch-demo-tour').getBoundingClientRect(),viewport=visualViewport;return box.left>=viewport.offsetLeft-1&&box.right<=viewport.offsetLeft+viewport.width+1&&box.top>=viewport.offsetTop-1&&box.bottom<=viewport.offsetTop+viewport.height+1;})()`,'Popover fits '+label);
    if (label.startsWith('booking row') || label.startsWith('status')) await until(`(()=>{const box=document.querySelector('.driver-active-element').getBoundingClientRect(),view=visualViewport;return box.left>=view.offsetLeft-1&&box.right<=view.offsetLeft+view.width+1;})()`,'Saved booking target readable '+label);
    assert.ok(await evaluate('document.querySelector(".intoch-demo-tour").getBoundingClientRect().width <= 341'),'Popover keeps compact tour width: '+label);
    assert.ok(await evaluate('document.querySelector(".intoch-demo-tour").getBoundingClientRect().height < 650'),'Popover has no stretched blank space: '+label);
  }
  const active="JSON.parse(sessionStorage.getItem('intoch:online-demo:v1:https://hkrhsubhfqrgqkuhpvql.supabase.co:active'))";
  for(const width of process.argv.includes('--narrow')?[320]:[1440,393,320]) {
    const phone=width<=640;
    await command('Emulation.setDeviceMetricsOverride',{width,height:phone?852:1000,deviceScaleFactor:1,mobile:phone});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:width===320?'reduce':'no-preference'}]});
    await command('Page.navigate',{url:'http://127.0.0.1:8080/'});await until('!!document.getElementById("demo-online-guide")','online entry');
    await evaluate('localStorage.clear();sessionStorage.clear();');await command('Page.reload');await until('!!document.getElementById("demo-online-guide")','fresh staff entry');
    await click('#demo-online-guide');await until(title('Book as a guest'),'launch');await bounds('launch '+width);await screenshot(width+'-launch');
    assert.equal(await evaluate('localStorage.getItem("intoch-fixture-booking-writes")'),null,'No automatic booking');
    await click('[data-booking-tour="form-link"]');await until(title('Introduce your demo guest'),'real guest form');await bounds('name '+width);await screenshot(width+'-guest-form');
    const name=await evaluate(active+'.name');await click('#f-name');await command('Input.insertText',{text:name});await until(title('Use a fictional contact'),'name input result');
    const number=await evaluate(active+'.phone');await click('#f-phone');await command('Input.insertText',{text:number});await until(title('Choose the party size'),'fictional contact input result');
    await click('.driver-popover-next-btn');await until(title('Choose an available visit'),'schedule');await bounds('schedule '+width);await screenshot(width+'-schedule');
    await click('#time-pills button');await until(title('Create the demo booking'),'available time chosen');
    await evaluate('fixture.delay=150;');await click('#btn-submit');await until(title('Read the booking outcome'),'real submit/server result/redirect');await bounds('saved '+width);await screenshot(width+'-saved');
    assert.equal(await evaluate('localStorage.getItem("intoch-fixture-booking-writes")'),'1','Exactly one explicit booking');
    await click('.driver-popover-next-btn');await until(title('See online bookings arrive'),'return to authenticated dashboard');
    await click('[data-booking-tour="online-tab"]');await until(title('Open your booking day'),'online overview actual read');await bounds('online day '+width);await screenshot(width+'-online-dashboard');
    await click('[data-booking-tour="day"]');await until(title("Your guest's booking is here"),'open saved day and exact booking');await bounds('booking row '+width);await screenshot(width+'-staff-booking');
    await command('Page.reload');await until('!!document.querySelector(".demo-tour-dock")','reload offers recovery');await click('.demo-tour-dock button');await until(title("Your guest's booking is here"),'recover exact saved booking');
    await click('.driver-popover-next-btn');await until(title('Understand its status'),'booking status');await bounds('status '+width);await screenshot(width+'-status');
    await click('.driver-popover-next-btn');await until(title('Know what needs follow-up'),'notification guidance');await bounds('notification '+width);await screenshot(width+'-follow-up');
    await click('.driver-popover-next-btn');await until(title('Guest to front desk, connected'),'completion');await click('.driver-popover-next-btn');
    assert.equal(await evaluate(active),null,'Completed state clears handoff');assert.equal(await evaluate('localStorage.getItem("intoch-fixture-booking-writes")'),'1','No duplicate booking on reload');
    if(phone)await click('[data-tour="mobile-menu"]');await click('[data-nav="dashboard"]');await until('document.getElementById("page-dashboard").classList.contains("active")','return to guide entry');
    await click('#demo-online-guide');await until(title('Book as a guest'),'restart online guide');await click('.driver-popover-close-btn');assert.equal(await evaluate(active),null,'Close skips guide');
    await click('#demo-online-guide');await until(title('Book as a guest'),'second restart');await evaluate('fixture.logout()');assert.equal(await evaluate('!!document.querySelector(".driver-overlay")'),false,'Logout teardown');
    console.log('PASS '+width+'px: guest form, actual manual submit, dashboard overview/day/exact row, recovery, completion, restart, close and logout');
  }
  assert.deepEqual(errors,[],'No browser runtime exceptions');
  console.log('Screenshots: '+output);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(watchdog);socket?.close();chrome.kill();});
