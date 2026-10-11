const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
function harness(file) {
 const events=[],settings={SUPABASE_URL:'https://hkrhsubhfqrgqkuhpvql.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-fixture',
  DEMO_TURNSTILE_SECRET_KEY:'captcha-fixture',DEMO_RATE_LIMIT_SALT:'salt-fixture',DEMO_CLEANUP_SECRET:'maintenance-fixture'};
 const state={anonymous:true,staff:false,captcha:true,hostname:'demo.intoch.app',action:'intoch-demo',authError:false,deleteError:false};
 const admin={auth:{getUser:async()=>({data:{user:{id:'demo-user',is_anonymous:state.anonymous}},error:state.authError}),
  getClaims:async()=>({data:{claims:{session_id:'auth-session'}},error:null}),
  admin:{getUserById:async()=>({data:{user:{id:'demo-user',is_anonymous:state.anonymous}},error:null}),
   deleteUser:async id=>{events.push(['delete',id]);return {error:state.deleteError};}}},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:state.staff?{id:'real-staff'}:null,error:null})})})}),
  rpc:async(name,args)=>{events.push([name,args]);return {error:null,data:name==='demo_cleanup_batch'?['demo-user']:{id:'private-workspace',active:true}};},
 };
 const context=vm.createContext({Request,Response,URL,URLSearchParams,AbortSignal,TextEncoder,crypto:webcrypto,
  createClient:()=>admin,Deno:{env:{get:key=>settings[key]},serve:handler=>{context.handler=handler;}},
  fetch:async()=>new Response(JSON.stringify({success:state.captcha,hostname:state.hostname,action:state.action})),
 });
 const load=path=>stripTypeScriptTypes(fs.readFileSync(path,'utf8')).replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
 vm.runInContext(load('supabase/functions/_shared/demo.ts'),context);
 vm.runInContext(load(file),context);
 const request=(body={},headers={})=>new Request('https://hkrhsubhfqrgqkuhpvql.supabase.co/functions/v1/demo-start',{
  method:'POST',headers:{Origin:'https://demo.intoch.app',Authorization:'Bearer anonymous-fixture','x-forwarded-for':'192.0.2.1','Content-Type':'application/json',...headers},body:JSON.stringify(body),
 });
 return {context,events,settings,state,request};
}
(async()=>{
 let test=harness('supabase/functions/demo-start/index.ts');
 let reply=await test.context.handler(test.request({captchaToken:'single-use',workspace_id:'forged',p_user_id:'forged'}));
 assert.equal(reply.status,200);assert.equal(reply.headers.get('Cache-Control'),'no-store');
 const provision=test.events.find(event=>event[0]==='demo_provision')[1];
 assert.equal(provision.p_user_id,'demo-user');assert.equal(provision.p_auth_session_id,'auth-session');
 assert.match(provision.p_ip_hash,/^[a-f0-9]{64}$/);assert.equal(provision.workspace_id,undefined);
 test.state.anonymous=false;assert.equal((await test.context.handler(test.request({captchaToken:'ok'}))).status,401);
 test.state.anonymous=true;test.state.hostname='evil.example';assert.equal((await test.context.handler(test.request({captchaToken:'ok'}))).status,403);
 test.state.hostname='demo.intoch.app';test.state.action='wrong';assert.equal((await test.context.handler(test.request({captchaToken:'ok'}))).status,403);
 test.state.action='intoch-demo';assert.equal((await test.context.handler(test.request({}, {Origin:'https://evil.example'}))).status,403);
 delete test.settings.DEMO_RATE_LIMIT_SALT;assert.equal((await test.context.handler(test.request({captchaToken:'ok'}))).status,503);
 test.settings.SUPABASE_URL='https://other.supabase.co';assert.equal((await test.context.handler(test.request({captchaToken:'ok'}))).status,503);

 test=harness('supabase/functions/demo-cleanup/index.ts');
 assert.equal((await test.context.handler(test.request())).status,401);
 reply=await test.context.handler(test.request({}, {Authorization:'Bearer maintenance-fixture'}));assert.equal(reply.status,200);
 assert.ok(test.events.some(event=>event[0]==='delete'));
 assert.ok(test.events.some(event=>event[0]==='demo_cleanup_confirm'));
 test.events.length=0;test.state.staff=true;await test.context.handler(test.request({}, {Authorization:'Bearer maintenance-fixture'}));
 assert.ok(!test.events.some(event=>event[0]==='delete'),'cleanup never deletes linked staff');
 test.state.staff=false;test.state.anonymous=false;await test.context.handler(test.request({}, {Authorization:'Bearer maintenance-fixture'}));
 assert.ok(!test.events.some(event=>event[0]==='delete'),'cleanup never deletes permanent users');
 console.log('Demo functions: verified identity/session, CAPTCHA hostname/action, hashed quotas, wrong-project refusal, maintenance auth and protected staff/permanent identities passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
