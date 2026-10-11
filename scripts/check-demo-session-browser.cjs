// Read-only localhost fixture. Never loads config.js or contacts a database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const output=path.resolve(__dirname,'../.impeccable/demo-session');fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'intoch-session-chrome-'));
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9338','--user-data-dir='+profile,'about:blank',
],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const watchdog=setTimeout(()=>{chrome.kill();console.error('Session visual verification timed out');process.exit(1);},120000);
(async()=>{
 let tabs;for(let attempt=0;attempt<60;attempt++){try{tabs=await(await fetch('http://127.0.0.1:9338/json')).json();break;}catch{await sleep(150);}}
 assert.ok(tabs,'Chrome available');
 const socket=new WebSocket(tabs.find(item=>item.type==='page').webSocketDebuggerUrl);
 await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
 let sequence=0;const pending=new Map(),errors=[];
 socket.addEventListener('message',event=>{const value=JSON.parse(event.data);
  if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description||value.params.exceptionDetails.text);
  if(value.id){const task=pending.get(value.id);pending.delete(value.id);value.error?task.reject(value.error):task.resolve(value.result);}
 });
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;
 };
 const until=async(expression,label)=>{for(let attempt=0;attempt<120;attempt++){if(await evaluate(expression))return;await sleep(80);}throw Error('Timed out: '+label+'; '+errors.join('\n'));};
 const screenshot=async name=>{await sleep(500);const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));};
 const click=async selector=>{await sleep(500);const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing click target');node.scrollIntoView({block:'nearest'});const box=node.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})()`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
 };
 await command('Runtime.enable');await command('Page.enable');
 for(const width of [1440,393,320]){
  if(width!==1440) await evaluate('localStorage.clear();sessionStorage.clear();');
  await command('Emulation.setDeviceMetricsOverride',{width,height:width===1440?1000:852,deviceScaleFactor:1,mobile:width!==1440});
  await command('Page.navigate',{url:'http://127.0.0.1:8080/?demo=1'});
  await until('window.DemoSession?.active() && !!document.querySelector(".driver-popover")','active workspace and guide');
  assert.equal(await evaluate('document.querySelectorAll(".demo-tour-sections button").length'),2,'only Operations and Reports offered');
  assert.equal(await evaluate('hasAccess("guests")'),false);
  const expiration=await evaluate('fixture.getSession().expires_at');
  await screenshot(width+'-welcome');
  await click('.demo-tour-controls button');
  await until('!document.querySelector(".driver-popover")','independent exploration');
  const bounds=await evaluate('(()=>{const bar=document.getElementById("demo-session-banner").getBoundingClientRect();const clock=document.getElementById("demo-session-clock").getBoundingClientRect();return {barLeft:bar.left,barRight:bar.right,clockRight:clock.right,width:innerWidth};})()');
  assert.ok(bounds.barLeft>=0&&bounds.barRight<=bounds.width+1&&bounds.clockRight<=bounds.width,'banner fits viewport');
  await screenshot(width+'-dashboard');
  await click('#demo-tour-reset');await until('!document.getElementById("demo-tour-sections").hidden','guide picker');
  assert.equal(await evaluate('document.querySelectorAll("#demo-tour-sections [data-tour-section]").length'),2);
  await click('[data-tour-section="reports"]');await until('document.querySelector(".driver-popover-title")?.textContent.includes("Turn visits")','reports guide');
  assert.equal(await evaluate('fixture.getSession().expires_at'),expiration,'replay does not change expiry');
  await screenshot(width+'-reports');
  await evaluate('fixture.expireDemo()');
  await until('document.querySelector("#demo-session-screen h1")?.textContent==="Demo Ended"','expired screen');
  assert.equal(await evaluate('document.getElementById("app-main").classList.contains("hidden")'),true);
  assert.equal(await evaluate('!!document.querySelector(".driver-popover")'),false);
  await screenshot(width+'-ended');
  const endBounds=await evaluate('(()=>{const panel=document.querySelector(".demo-session-panel").getBoundingClientRect();return {left:panel.left,right:panel.right,width:innerWidth};})()');
  assert.ok(endBounds.left>=0&&endBounds.right<=endBounds.width,'expired panel fits phone');
 }
 assert.deepEqual(errors,[]);socket.close();clearTimeout(watchdog);chrome.kill();
 console.log('Chrome 1440/393/320: welcome, four-page policy, persistent countdown, independent exploration, Reports replay/unchanged expiry and expiry teardown passed');
})().catch(error=>{clearTimeout(watchdog);chrome.kill();console.error(error);process.exitCode=1;});
