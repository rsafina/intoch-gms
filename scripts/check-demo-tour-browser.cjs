// Run demo-tour-preview.cjs first. Only the backend-free localhost fixture is permitted.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const output = path.resolve(__dirname,'../docs/screens/demo-tour');
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
  if(process.argv.includes('--reset-only')) {
    for(const width of [1440,393,320]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height:width<=640?852:1000,deviceScaleFactor:1,mobile:width<=640});
      await command('Page.navigate',{url:'http://127.0.0.1:8080/__demo-tour-fixture'});
      await until('!!window.fixture','fixture ready');await evaluate('localStorage.clear();sessionStorage.clear();');await command('Page.reload');
      await until(title('Try Intoch at your own pace'),'welcome');await click('.driver-popover-close-btn');
      await until('!!document.querySelector(".demo-tour-reset-highlight") && !document.querySelector(".driver-overlay")','Close highlights Reset Tour');
      assert.equal(await evaluate('getComputedStyle(document.getElementById("demo-tour-reset")).color'),'rgb(255, 255, 255)');
      assert.notEqual(await evaluate('getComputedStyle(document.getElementById("demo-tour-reset")).backgroundColor'),'rgb(255, 255, 255)');
      await screenshot(width+'-reset-highlight');await click('#demo-tour-reset');await screenshot(width+'-reset-menu');
      console.log('PASS '+width+'px: real Close, navy Reset Tour, white label, visible restart hint and section picker');
    }
    assert.deepEqual(errors,[],'No browser runtime exceptions');return;
  }
  for(const width of process.argv.includes('--phone')?[393,320]:[1440,393,320]) {
    const phone=width<=640;
    await command('Emulation.setDeviceMetricsOverride',{width,height:phone?852:1000,deviceScaleFactor:1,mobile:phone});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:width===320?'reduce':'no-preference'}]});
    await command('Page.navigate',{url:'http://127.0.0.1:8080/__demo-tour-fixture'});
    await until('!!window.fixture','fixture ready');
    await evaluate('localStorage.clear();sessionStorage.clear();');
    await command('Page.reload');
    await until(title('Try Intoch at your own pace'),'welcome '+width);
    await bounds('welcome '+width);await screenshot(width+'-welcome');
    if(width===1440){
      await click('.demo-tour-controls .demo-tour-link');
      assert.equal(await evaluate('!!document.querySelector(".intoch-demo-tour")'),false,'Explore dismisses intro');
      await command('Page.reload');await until('!!window.fixture','reload after explore');await sleep(650);
      assert.equal(await evaluate('!!document.querySelector(".intoch-demo-tour")'),false,'Intro does not repeat');
      await click('#demo-tour-restart');await click('[data-tour-section=operations]');
    }else await click('.driver-popover-next-btn');
    await until(title('Your front desk at a glance'),'dashboard');await screenshot(width+'-dashboard');
    for(const expected of ['Plan for arriving guests','Keep walk-ins in view','See the seating picture','A quick welcome for walk-ins',phone?'Open navigation':'Explore reservations']){
      await click('.driver-popover-next-btn');await until(title(expected),expected+' '+width);await bounds(expected+' '+width);
    }
    if(phone){await click('[data-tour="mobile-menu"]');await until(title('Explore reservations'),'phone drawer');await screenshot(width+'-navigation');}
    assert.ok(await evaluate('document.querySelector(".driver-popover-next-btn").disabled'),'Reservations navigation is action gated');
    await click('[data-tour="reservations-nav"]');await until(title('Find the right booking'),'reservations');await bounds('reservations '+width);await screenshot(width+'-reservations');
    await click('.driver-popover-prev-btn');await until(title('Explore reservations'),'Back to dashboard');
    await click('[data-tour="reservations-nav"]');await until(title('Find the right booking'),'return to reservations');
    await click('.driver-popover-next-btn');await until(title('Manage the arrival'),'reservation list');
    await click('.driver-popover-next-btn');await until(title('Explore walk-ins'),'walkins navigation');
    await click('[data-tour="walkins-nav"]');await until(title('Review the service day'),'walkins');await bounds('walkins '+width);await screenshot(width+'-walkins');
    await click('.driver-popover-prev-btn');await until(title('Explore walk-ins'),'Back to reservations');
    await click('[data-tour="walkins-nav"]');await until(title('Review the service day'),'return to walkins');
    await click('.driver-popover-next-btn');await until(title('Follow each walk-in'),'walkin log');
    await click('.driver-popover-next-btn');await until(title('Your front desk guide is complete'),'operations finish');await click('.driver-popover-next-btn');await click('#demo-tour-reset');await screenshot(width+'-reset-menu');await click('[data-tour-section=guests]');
    if(phone){await until(title('Open navigation'),'guest menu');await click('[data-tour=mobile-menu]');}
    await until(title('Get to know your guests'),'guests navigation');
    assert.ok(await evaluate('document.querySelector(".driver-popover-next-btn").disabled'),'Navigation is action gated');
    await click('[data-tour="guests-nav"]');await until(title('Find a familiar face'),'search');
    await click('.driver-popover-prev-btn');await until(title('Get to know your guests'),'Back crosses page boundary');
    assert.ok(await evaluate('document.querySelector("#page-dashboard").classList.contains("active")'));
    await click('[data-tour="guests-nav"]');await until(title('Find a familiar face'),'return to search');
    await screenshot(width+'-search');
    await evaluate('fixture.delay=150;');
    await click('[data-tour="guest-search"]');await command('Input.insertText',{text:'Budi Santoso'});
    await until(title("Open the guest's story"),'real search result');
    await screenshot(width+'-open-profile');
    await click('[data-tour="guest-profile-open"]');await until(title('Remember who they are'),'profile successfully loaded');
    await bounds('profile '+width);await screenshot(width+'-profile');
    if(phone) assert.ok(await evaluate(`(()=>{const box=document.querySelector('#modal-profile .modal-box').getBoundingClientRect();return box.left>=visualViewport.offsetLeft&&box.right<=visualViewport.offsetLeft+visualViewport.width+1;})()`),'Guided profile fits '+width+'px');
    await evaluate('fixture.delay=0;');
    for(const expected of ['Understand recorded spending','Make the next visit personal','See the visits behind the relationship','Connect the next booking',"You're ready to explore"]){
      await click('.driver-popover-next-btn');await until(title(expected),expected);await bounds(expected+' '+width);
      if(expected==='Make the next visit personal')await screenshot(width+'-preferences');
    }
    await click('.driver-popover-next-btn');
    assert.equal(await evaluate('fixture.writes'),0,'Tour performs no writes');
    assert.equal(await evaluate('!!document.querySelector(".driver-overlay")'),false,'Completion removes overlay');
    await command('Page.reload');await until('!!window.fixture','completed reload');await sleep(600);
    assert.equal(await evaluate('!!document.querySelector(".intoch-demo-tour")'),false,'Completion suppresses intro');
    // Restart via dashboard; pause allows unrelated navigation and reload offers explicit resume.
    await evaluate('navigateTo("dashboard")');await click('#demo-tour-restart');await click('[data-tour-section=operations]');await until(title('Your front desk at a glance'),'restart');
    await click('.demo-tour-controls .demo-tour-link:last-child');
    await evaluate('navigateTo("guests")');
    assert.equal(await evaluate('!!document.querySelector(".intoch-demo-tour")'),false,'Exploration does not force navigation');
    await command('Page.reload');await until('!!document.querySelector(".demo-tour-dock")','recovery prompt');
    await until(`(()=>{const view=visualViewport;return ['#demo-tour-reset','.demo-tour-dock'].every(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return box.left>=view.offsetLeft-1&&box.right<=view.offsetLeft+view.width+1&&box.top>=view.offsetTop-1&&box.bottom<=view.offsetTop+view.height+1;});})()`,'Reset and resume remain inside the phone viewport');
    await screenshot(width+'-resume');
    await click('.demo-tour-dock button');await until(title('Your front desk at a glance'),'resume');
    await evaluate('fixture.logout()');assert.equal(await evaluate('!!document.querySelector(".driver-overlay")'),false,'Logout removes overlay');
    assert.equal(await evaluate('!!document.querySelector(".demo-tour-dock")'),false,'Logout removes dock');
    console.log('PASS '+width+'px: intro, explore, action gates, back, search/profile, completion, restart, reload, pause and logout');
  }
  assert.deepEqual(errors,[],'No browser runtime exceptions');
  console.log('Screenshots: '+output);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(watchdog);socket?.close();chrome.kill();});
