const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const { html, runtime, boot, source } = require('../scripts/demo-tour-fixture.cjs');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function harness(options = {}) {
  const errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  console.on('error', (...values) => errors.push(new Error(values.map(value => value?.stack || String(value)).join(' '))));
  const dom = new JSDOM(html().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
    url: options.origin || 'http://127.0.0.1:8080', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console,
  });
  const win = dom.window;
  win.matchMedia = query => ({ matches: query.includes('reduce') || (query.includes('640px') && !!options.mobile), addEventListener() {}, removeEventListener() {} });
  win.CSS = { escape: value => value };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.scrollTo = function () {};
  const originalStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = node => new Proxy(originalStyle(node), { get: (style, property) => property === 'opacity' ? style.opacity || '1' : typeof style[property] === 'function' ? style[property].bind(style) : style[property] });
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.closest('.hidden') || (this.closest('.page-section') && !this.closest('.page-section').classList.contains('active'));
    return { x:30, y:100, left:30, top:100, right:330, bottom:150, width:hidden?0:300, height:hidden?0:50 };
  };
  win.HTMLElement.prototype.getClientRects = function () { return this.getBoundingClientRect().width ? [this.getBoundingClientRect()] : []; };
  win.eval(source('assets/vendor/driverjs/1.9.0/driver.js.iife.js'));
  win.eval(source('js/demo-tour-environment.js'));
  if (options.environment) win.INTOCH_DEMO_TOUR_ENV = options.environment;
  win.eval(runtime + '\n' + source('js/demo.js') + '\n' + source('js/demo-tour.js') + '\n' + (options.setup || '') + '\n' + boot);
  win.document.addEventListener('input', event => {
    const handler=event.target.getAttribute('oninput');
    if(handler) new win.Function('event',handler).call(event.target,event);
  });
  async function until(predicate, message = 'Expected UI state') {
    for (let attempt=0; attempt<100; attempt++) { if (predicate()) return; await sleep(20); }
    throw new Error(message + '\n' + errors.map(error=>error.message).join('\n') + '\n' + JSON.stringify({title:title(),toast:win.fixture?.lastToast,entry:!!win.document.getElementById('demo-tour-restart')}));
  }
  const title = () => win.document.querySelector('.intoch-demo-tour .driver-popover-title')?.textContent;
  const click = selector => {
    const node=win.document.querySelector(selector); assert.ok(node, selector);node.click();
    const handler=node.getAttribute('onclick');
    if(handler) new win.Function('event',handler).call(node,new win.Event('click'));
  };
  const next = () => click('.driver-popover-next-btn');
  const back = () => click('.driver-popover-prev-btn');
  const seen = () => Object.keys(win.localStorage).filter(key=>key.includes(':seen')).map(key=>JSON.parse(win.localStorage.getItem(key)));
  return {win,dom,errors,until,title,click,next,back,seen};
}
async function walkToSearch(h) {
  await h.until(()=>h.title()==='Try Intoch at your own pace');h.next();
  await h.until(()=>h.title()==='Your front desk at a glance');
  for(const expected of ['Plan for arriving guests','Keep walk-ins in view','See the seating picture','A quick welcome for walk-ins','Get to know your guests']) {
    h.next(); await h.until(()=>h.title()===expected);
    if(expected==='A quick welcome for walk-ins') {
      const quick=h.win.document.getElementById('qw-name');quick.value='Budi';quick.dispatchEvent(new h.win.Event('input',{bubbles:true}));
      await h.until(()=>!h.win.document.getElementById('qw-results').classList.contains('hidden'));
      h.click('#qw-results button');assert.equal(quick.value,'Budi Santoso');
      assert.equal(h.win.fixture.writes,0,'Quick Walk-In explanation permits lookup without submitting');
    }
  }
  const nextButton=h.win.document.querySelector('.driver-popover-next-btn');
  assert.equal(nextButton.disabled,true,'Navigation requires real action');
  h.click('[data-tour="guests-nav"]');await h.until(()=>h.title()==='Find a familiar face');
}
(async () => {
  let h=await harness();
  await h.until(()=>h.title()==='Try Intoch at your own pace');
  const explore=[...h.win.document.querySelectorAll('.demo-tour-link')].find(node=>node.textContent==='Explore Independently');
  explore.click();assert.equal(h.seen()[0].status,'skipped');assert.equal(h.title(),undefined);
  await h.win.fixture.relogin();await sleep(400);assert.equal(h.title(),undefined,'Explicit skip suppresses next intro');
  assert.ok(h.win.document.getElementById('demo-tour-restart'),'Restart remains available');h.dom.window.close();

  h=await harness();await walkToSearch(h);
  h.next();await sleep(50);assert.equal(h.title(),'Find a familiar face','Next cannot bypass search');
  h.win.fixture.delay=120;
  const input=h.win.document.querySelector('[data-tour="guest-search"]');input.value='Budi Santoso';input.dispatchEvent(new h.win.Event('input',{bubbles:true}));
  await sleep(100);assert.equal(h.title(),'Find a familiar face','Debounced search does not advance early');
  await h.until(()=>h.title()==="Open the guest's story");
  h.next();assert.equal(h.title(),"Open the guest's story",'Next cannot bypass profile');
  h.click('[data-tour="guest-profile-open"]');await sleep(50);assert.equal(h.title(),"Open the guest's story",'Profile waits for read result');
  await h.until(()=>h.title()==='Remember who they are');
  assert.ok(h.win.document.querySelector('[data-tour="profile-details"]').textContent.includes('Budi Santoso'));
  for(const expected of ['Understand recorded spending','Make the next visit personal','See the visits behind the relationship','Connect the next booking',"You're ready to explore"]) {
    h.next();await h.until(()=>h.title()===expected);
  }
  h.next();assert.equal(h.seen()[0].status,'completed');assert.equal(h.title(),undefined);assert.equal(h.win.fixture.writes,0);
  assert.ok(h.win.document.getElementById('modal-profile').classList.contains('hidden'));h.dom.window.close();

  h=await harness();await walkToSearch(h);h.back();await h.until(()=>h.title()==='Get to know your guests');
  assert.ok(h.win.document.getElementById('page-dashboard').classList.contains('active'),'Back returns across pages');
  h.click('[data-tour="guests-nav"]');await h.until(()=>h.title()==='Find a familiar face');
  h.win.DemoTour.pause();assert.equal(h.title(),undefined);
  await h.win.eval('navigateTo("dashboard")');assert.equal(h.title(),undefined,'Independent navigation stays independent');
  assert.ok(h.win.document.querySelector('.demo-tour-dock'));h.win.DemoTour.resume();await h.until(()=>h.title()==='Find a familiar face');
  const stored=Object.fromEntries(Object.keys(h.win.sessionStorage).map(key=>[key,h.win.sessionStorage.getItem(key)]));
  const local=Object.fromEntries(Object.keys(h.win.localStorage).map(key=>[key,h.win.localStorage.getItem(key)]));
  h.dom.window.close();
  h=await harness({setup:Object.entries(stored).map(([key,value])=>`sessionStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`).join('')+Object.entries(local).map(([key,value])=>`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`).join('')});
  await h.until(()=>h.win.document.querySelector('.demo-tour-dock'));assert.equal(h.title(),undefined,'Reload offers resume without forced navigation');
  h.win.DemoTour.resume();await h.until(()=>h.title()==='Find a familiar face');
  h.win.fixture.fail='guests';h.win.eval('loadGuests("Budi Santoso")');await h.until(()=>h.win.document.querySelector('.demo-tour-dock'));
  assert.equal(h.title(),undefined,'Failed reads pause instead of advancing');h.win.fixture.fail=null;
  h.win.DemoTour.start();await h.until(()=>h.title()==='Your front desk at a glance');
  h.win.fixture.logout();assert.equal(h.title(),undefined);assert.equal(h.win.document.querySelector('.demo-tour-dock'),null);
  assert.equal(Object.keys(h.win.sessionStorage).filter(key=>key.includes(':active')).length,0,'Logout clears recovery');h.dom.window.close();

  h=await harness();await walkToSearch(h);
  h.win.eval('loadGuests("Budi Santoso")');await h.until(()=>h.title()==="Open the guest's story");
  h.win.fixture.fail='visits';h.click('[data-tour="guest-profile-open"]');
  await h.until(()=>h.win.document.querySelector('.demo-tour-dock'));
  assert.equal(h.title(),undefined,'A profile with failed history does not satisfy the action');
  h.win.fixture.fail=null;h.win.DemoTour.resume();await h.until(()=>h.title()==="Open the guest's story");
  h.click('[data-tour="guest-profile-open"]');await h.until(()=>h.title()==='Remember who they are');
  h.win.eval('hideModal("modal-profile")');await h.until(()=>h.win.document.querySelector('.demo-tour-dock'));
  assert.equal(h.title(),undefined,'Closing a profile pauses the tour');
  h.win.DemoTour.resume();await h.until(()=>h.title()==='Remember who they are');
  h.win.document.dispatchEvent(new h.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(h.seen()[0].status,'skipped');assert.equal(h.win.document.querySelector('.driver-overlay'),null);h.dom.window.close();

  h=await harness();await h.until(()=>h.title()==='Try Intoch at your own pace');h.next();await h.until(()=>h.title()==='Your front desk at a glance');
  h.win.document.querySelector('[data-tour="today-reservations"]').remove();h.next();await sleep(5200);
  assert.ok(h.win.document.querySelector('.demo-tour-dock'),'Missing target times out safely');
  assert.equal(h.title(),undefined);h.dom.window.close();

  h=await harness();await walkToSearch(h);h.win.eval('loadGuests("Budi Santoso")');await h.until(()=>h.title()==="Open the guest's story");
  h.win.fixture.delay=150;h.click('[data-tour="guest-profile-open"]');h.win.fixture.logout();
  await sleep(600);assert.equal(h.title(),undefined,'Late reads cannot resurrect the tour after logout');
  assert.equal(h.win.document.querySelector('.demo-tour-dock'),null);h.dom.window.close();

  h=await harness();await walkToSearch(h);h.win.eval('loadGuests("No matching fictional guest")');await sleep(100);
  assert.equal(h.title(),'Find a familiar face','Other searches do not satisfy the example action');h.dom.window.close();

  h=await harness();await walkToSearch(h);h.win.eval('loadGuests("Budi")');await h.until(()=>h.title()==="Open the guest's story");
  h.win.fixture.delay=120;h.click('[data-tour="guest-profile-open"]');h.back();
  await h.until(()=>h.title()==='Find a familiar face');await sleep(450);
  assert.ok(h.win.document.getElementById('modal-profile').classList.contains('hidden'),'Back discards an in-flight profile result');
  assert.equal(h.title(),'Find a familiar face');h.dom.window.close();

  h=await harness();await walkToSearch(h);h.back();await h.until(()=>h.title()==='Get to know your guests');
  h.win.fixture.fail='guests';h.click('[data-tour="guests-nav"]');
  await h.until(()=>h.win.document.querySelector('.demo-tour-dock'));
  assert.equal(h.title(),undefined,'Failed page data does not satisfy navigation');h.dom.window.close();

  for(const options of [
    {origin:'https://client.example'},
    {environment:{origins:['http://127.0.0.1:8080'],supabaseUrl:'https://other-project.supabase.co',fictionalGuestNames:['Budi Santoso']}},
    {setup:"fixtureStaff=null;"},
    {setup:"fixtureStaff={id:'owner',role:'owner'};"},
    {setup:"document.documentElement.classList.remove('demo-mode');"},
  ]) {
    h=await harness(options);await sleep(420);assert.equal(h.title(),undefined);assert.equal(h.win.document.getElementById('demo-tour-restart'),null);h.dom.window.close();
  }
  h=await harness({mobile:true});await h.until(()=>h.title()==='Try Intoch at your own pace');h.next();await h.until(()=>h.title()==='Your front desk at a glance');
  for(let count=0;count<5;count++){h.next();await sleep(30);}
  await h.until(()=>h.title()==='Open navigation');h.click('[data-tour="mobile-menu"]');await h.until(()=>h.title()==='Get to know your guests');
  assert.ok(h.win.document.body.classList.contains('sidebar-drawer-open'));h.win.DemoTour.exit();assert.ok(!h.win.document.body.classList.contains('sidebar-drawer-open'));h.dom.window.close();
  console.log('Demo tour: real navigation/search/profile, action gates, skip/completion, back, recovery, pause, teardown and environment gates passed.');
})().catch(error=>{console.error(error);process.exit(1);});
