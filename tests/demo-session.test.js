const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source = fs.readFileSync('js/demo-session.js','utf8');
const roles = fs.readFileSync('js/config.template.js','utf8');
const roleCode = roles.slice(roles.indexOf('function getStaffSession()'),roles.indexOf('// RESERVATION PAGE APPEARANCE'));
function setup({url='http://127.0.0.1:8080/?demo=1',existing=false,expired=false,wrongProject=false}={}) {
 const dom = new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
 const win=dom.window, calls=[], listeners=[];
 let milliseconds=0, identity=existing?{id:'anonymous-user',is_anonymous:true}:null;
 const status={id:'private-workspace',user_id:'anonymous-user',active:!expired,state:expired?'ended':'active',
  started_at:'2026-10-11T05:00:00.000Z',expires_at:'2026-10-11T06:00:00.000Z',server_now:'2026-10-11T05:15:00.000Z'};
 Object.defineProperty(win.performance,'now',{value:()=>milliseconds});
 win.t=value=>value; win.STAFF_SESSION_KEY='staff-test'; win.CSS={escape:value=>value}; win.fetch=async()=>{throw Error('Unexpected network request');};
 win.eval(`var SUPABASE_URL=${JSON.stringify(wrongProject?'https://wrong.supabase.co':'https://hkrhsubhfqrgqkuhpvql.supabase.co')};var SUPABASE_ANON_KEY='public-test';var DEMO_TURNSTILE_SITE_KEY='public-site-key';var CURRENT_LANG='en';`);
 win.INTOCH_DEMO_TOUR_ENV={origins:['http://127.0.0.1:8080'],supabaseUrl:'https://hkrhsubhfqrgqkuhpvql.supabase.co'};
 win.turnstile={render:(target,options)=>{calls.push('captcha');queueMicrotask(()=>options.callback('single-use-'+calls.length));return calls.length;},remove:()=>{}};
 const demo={
  auth:{getUser:async()=>({data:{user:identity},error:null}),signInAnonymously:async options=>{
   calls.push(['anonymous',options]);identity={id:'anonymous-user',is_anonymous:true};return {data:{user:identity},error:null};
  },signOut:async()=>{identity=null;calls.push('signout');return {error:null};},onAuthStateChange:callback=>{listeners.push(callback);return {data:{subscription:{unsubscribe:()=>calls.push('unsubscribe')}}};}},
  rpc:async(name)=>{calls.push(name);if(name==='demo_end_session') {status.active=false;return {data:{ok:true},error:null};}return {data:identity?{...status}:null,error:null};},
  functions:{invoke:async(name,args)=>{calls.push([name,args]);return {data:{...status,server_now:status.started_at},error:null};}},
  schema:name=>({from:table=>{calls.push(['schema',name,table]);return {schema:name,table};},rpc:async(name)=>{calls.push(['scoped-rpc',name]);return {data:[],error:null};}}),
 };
 const staff={auth:{kind:'staff-auth'},from:name=>({table:name,staff:true}),rpc:()=>({staff:true})};
 win.supabase={createClient:()=>demo};
 win.eval(source);win.eval(roleCode);
 const database=win.createDemoDatabase(staff);
 win.eval('let guestLoadGeneration=0,guestProfileGeneration=0;');
 win.PageLoading={begin:()=>win.document.documentElement.setAttribute('data-page-loading',''),finish:()=>win.document.documentElement.removeAttribute('data-page-loading')};win.teardownRealtimeUpdates=()=>calls.push('realtime-end');win.teardownOnlineResNotify=()=>calls.push('notifications-end');
 win.DemoTour={teardown:()=>calls.push('tour-end')};
 win.initializeApplication=async page=>{calls.push(['initialize',page]);win.document.getElementById('app-main').classList.remove('hidden');win.document.getElementById('app-sidebar').classList.remove('hidden');};
 return {dom,win,calls,status,database,advance:value=>milliseconds+=value};
}
(async()=>{
 let instance=setup();let {win,calls,database}=instance;
 // The facade preserves the existing staff client until the demo is selected.
 assert.equal(database.auth.kind,'staff-auth');
 assert.equal(await win.DemoSession.bootstrap(),true);
 assert.equal(calls.filter(item=>item==='captcha').length,2,'Auth and provisioning use different single-use CAPTCHA tokens');
 assert.ok(calls.some(item=>Array.isArray(item)&&item[0]==='anonymous'));
 assert.ok(calls.some(item=>Array.isArray(item)&&item[0]==='demo-start'));
 assert.equal(win.document.getElementById('demo-session-clock').textContent,'60:00');
 assert.equal(win.document.getElementById('bd-alert-wrap').closest('#demo-session-banner')?.id,'demo-session-banner','notifications share the header layout');
 assert.equal(win.document.documentElement.hasAttribute('data-page-loading'),false,'successful activation dismisses loading');
 assert.equal(win.getStaffSession().role,'demo_guest');assert.equal(win.currentStaffId(),null);
 for(const page of ['dashboard','reservations','walkins','reports'])assert.equal(win.hasAccess(page),true,page);
 for(const page of ['guests','invoice','membership','settings-staff','broadcast'])assert.equal(win.hasAccess(page),false,page);
 assert.equal(database.from('guests').schema,'intoch_demo');await database.rpc('record_reservation_arrival');
 assert.throws(()=>database.functions.invoke('staff-account'),/Unavailable/);
 assert.equal(win.canManagePaymentSettings(),false);assert.equal(win.canWaiveDeposit(),false);
 instance.status.active=false;await win.DemoSession.validate();
 assert.equal(win.DemoSession.active(),false);assert.equal(win.document.querySelector('#demo-session-screen h1').textContent,'Demo Ended');
 assert.equal(win.document.getElementById('app-main').classList.contains('hidden'),true);
 assert.ok(calls.includes('unsubscribe'));assert.ok(calls.includes('realtime-end'));
 assert.equal(win.document.getElementById('bd-alert-wrap').parentNode,win.document.body,'teardown restores notification container');
 instance.dom.window.close();

 instance=setup();({win}=instance);
 const checks=[];win.turnstile.render=(selector,options)=>{checks.push(options);return checks.length;};
 const activation=win.DemoSession.bootstrap();
 for(let attempt=0;attempt<10&&!checks.length;attempt++)await Promise.resolve();
 assert.match(win.document.querySelector('#demo-session-screen h1').textContent,/Try Intoch for 1 hour/);
 assert.match(win.document.getElementById('demo-security-loading').textContent,/Loading security verification/,'waiting state appears before the widget');
 const frame=win.document.createElement('iframe');win.document.getElementById('demo-session-captcha').append(frame);
 await Promise.resolve();frame.dispatchEvent(new win.Event('load'));
 assert.equal(win.document.getElementById('demo-security-loading'),null,'iframe arrival replaces waiting state');
 checks[0].callback('signup-token');
 assert.equal(win.document.documentElement.hasAttribute('data-page-loading'),true,'verification immediately shows loading before network work');
 for(let attempt=0;attempt<10&&checks.length<2;attempt++)await Promise.resolve();
 assert.equal(checks.length,2);
 checks[1]['before-interactive-callback']();
 assert.equal(win.document.documentElement.hasAttribute('data-page-loading'),false,'second interactive challenge stays accessible');
 checks[1].callback('provision-token');
 assert.equal(win.document.documentElement.hasAttribute('data-page-loading'),true,'second verification resumes loading immediately');
 await activation;
 assert.equal(win.DemoSession.active(),true);instance.dom.window.close();

 instance=setup();({win}=instance);delete win.turnstile;
 const failedActivation=win.DemoSession.bootstrap();
 for(let attempt=0;attempt<10&&!win.document.getElementById('demo-turnstile-script');attempt++)await Promise.resolve();
 assert.ok(win.document.getElementById('demo-security-loading'),'slow script download shows a waiting state');
 win.document.getElementById('demo-turnstile-script').dispatchEvent(new win.Event('error'));
 await failedActivation;
 assert.equal(win.document.getElementById('demo-security-loading'),null,'failed download does not leave an endless spinner');
 assert.match(win.document.querySelector('#demo-session-screen h1').textContent,/temporarily unavailable/);
 instance.dom.window.close();

 instance=setup({existing:true});({win,calls}=instance);
 await win.DemoSession.bootstrap();assert.equal(win.document.getElementById('demo-session-clock').textContent,'45:00','reload preserves remaining time');
 assert.ok(!calls.some(item=>Array.isArray(item)&&['anonymous','demo-start'].includes(item[0])));
 instance.advance(1000);await win.DemoSession.exit();assert.ok(calls.includes('demo_end_session'));assert.ok(calls.includes('signout'));instance.dom.window.close();

 instance=setup({existing:true,expired:true});await instance.win.DemoSession.bootstrap();
 assert.equal(instance.win.document.querySelector('#demo-session-screen h1').textContent,'Demo Ended');
 assert.ok(!instance.calls.some(item=>Array.isArray(item)&&item[0]==='initialize'));instance.dom.window.close();

 instance=setup({wrongProject:true});await instance.win.DemoSession.bootstrap();
 assert.match(instance.win.document.getElementById('demo-session-screen').textContent,/approved playground/);
 assert.deepEqual(instance.calls,[]);instance.dom.window.close();

 instance=setup({url:'http://127.0.0.1:8080/'});assert.equal(await instance.win.DemoSession.bootstrap(),false);
 assert.equal(instance.database.auth.kind,'staff-auth');assert.deepEqual(instance.calls,[]);
 const loginCode=fs.readFileSync('js/app.js','utf8').match(/^async function loginStaff\([\s\S]*?^}/m)[0];
 const staffWindow=instance.win;let loginRequest;
 staffWindow.db={auth:{signInWithPassword:async request=>{loginRequest=request;return {error:null};}}};
 staffWindow.staffAuthEmail=()=> 'fictional@staff.intoch.invalid';staffWindow.staffAuthPassword=()=> 'test-only';
 staffWindow.restoreVerifiedStaffSession=async()=>({id:'admin',role:'admin'});
 staffWindow.loader=()=>{};staffWindow.applyRoleToNav=()=>{};
 staffWindow.document.getElementById('login-username').value='fictional';
 staffWindow.document.getElementById('login-pin').value='0000';
 staffWindow.eval(loginCode);await staffWindow.loginStaff();
 assert.match(loginRequest.options.captchaToken,/single-use/,'staff password sign-in receives a fresh CAPTCHA');
 assert.equal(staffWindow.DemoSession.selected(),false,'staff CAPTCHA never activates demo mode');
 assert.equal(instance.database.auth.kind,'staff-auth');
 instance.dom.window.close();
 instance=setup({url:'http://127.0.0.1:8080/',wrongProject:true});
 assert.equal(await instance.win.DemoSession.staffCaptcha(),undefined);
 assert.deepEqual(instance.calls,[],'other projects retain existing login without demo CAPTCHA');
 instance.dom.window.close();
 console.log('Demo entry: credential-free authentication, separate CAPTCHA tokens, scoped client, four pages, preserved staff client, countdown recovery, expiry/exit teardown and wrong-project refusal passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
