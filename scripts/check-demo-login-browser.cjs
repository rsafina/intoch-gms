// Run demo-tour-preview.cjs first. Only the backend-free localhost fixture is permitted.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const output = path.resolve(__dirname,'../docs/screens/demo-login');
fs.mkdirSync(output,{recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'intoch-login-chrome-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9337','--user-data-dir='+profile,'about:blank',
],{windowsHide:true,stdio:'ignore'});
const sleep = milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
let socket;
const watchdog = setTimeout(()=>{chrome.kill();console.error('Login browser verification timed out');process.exit(1);},180000);
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
    throw Error('Timed out: '+label+'; '+JSON.stringify(await evaluate('({title:document.querySelector(".driver-popover-title")?.textContent,toast:window.fixture?.lastToast,drawer:document.body.classList.contains("sidebar-drawer-open"),profileOpen:!document.getElementById("modal-profile").classList.contains("hidden"),click:fixture.lastClick,viewport:{scale:visualViewport.scale,x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width},active:document.querySelector(".driver-active-element")?.outerHTML.slice(0,250)})'))+'; '+errors.join('\n'));
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
    assert.ok(await evaluate('document.querySelector(".intoch-demo-tour").getBoundingClientRect().height < 500'),'Popover has no stretched blank space: '+label);
  }
  for(const width of [1440,393,320]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:width<=640?852:1000,deviceScaleFactor:1,mobile:width<=640});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:width===320?'reduce':'no-preference'}]});
    await command('Page.navigate',{url:'http://127.0.0.1:8080/__demo-login-fixture'});
    await until('!!window.fixture && document.activeElement?.dataset.tour === "login-submit"','prefilled login ready');
    assert.equal(await evaluate('fixture.calls'),0,'No automatic sign-in');
    await until(`(()=>{const view=visualViewport;return ['#demo-login-hint','[data-tour="login-submit"]'].every(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return box.left>=view.offsetLeft-1&&box.right<=view.offsetLeft+view.width+1&&box.top>=view.offsetTop-1&&box.bottom<=view.offsetTop+view.height+1;});})()`,'Hint and Login fit viewport');
    await screenshot(width+'-login');
    await evaluate('fixture.reject=true;');await click('[data-tour="login-submit"]');
    await until('!document.getElementById("login-error").classList.contains("hidden")','Rejected login stays on form');
    assert.equal(await evaluate('fixture.initializations'),0);await screenshot(width+'-rejected');
    await evaluate('fixture.reject=false;');await click('[data-tour="login-submit"]');
    await until('document.getElementById("login-page").classList.contains("hidden")','Actual manual Login enters dashboard');
    assert.equal(await evaluate('fixture.page'),'dashboard');assert.equal(await evaluate('fixture.calls'),2);
    assert.equal(await evaluate('!!document.getElementById("demo-login-hint")'),false,'Hint tears down');
    assert.equal(await evaluate('document.getElementById("login-pin").value'),'', 'Successful login clears form PIN');
    await evaluate('clearStaffSession();showLoginPage();');
    await until('document.activeElement?.dataset.tour === "login-submit"','Logout login screen ready');
    assert.equal(await evaluate('fixture.calls'),2,'Returning to login does not sign in');
    console.log('PASS '+width+'px: prefill, click hint, focus, actual manual Login, rejected Auth, dashboard and teardown');
  }
  assert.deepEqual(errors,[],'No browser runtime exceptions');console.log('Screenshots: '+output);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(watchdog);socket?.close();chrome.kill();});
