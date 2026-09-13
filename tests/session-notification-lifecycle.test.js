const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
(async()=>{
 let session={id:'staff',role:'staff'},valid=true,reloads=0,check,event;
 const ctx=vm.createContext({console,setTimeout:fn=>fn(),setInterval:fn=>{check=fn;return 1},clearInterval(){},
  window:{location:{reload:()=>reloads++},addEventListener(){},removeEventListener(){}},
  document:{hidden:false,addEventListener(){},removeEventListener(){}},
  getStaffSession:()=>session,setStaffSession:s=>session=s,clearStaffSession:()=>session=null,
  db:{rpc:async()=>({data:valid}),auth:{onAuthStateChange:fn=>{event=fn;return {data:{subscription:{unsubscribe(){}}}}}},
   from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'staff',role:'staff',is_active:true}})})},
 });
 vm.runInContext(fs.readFileSync('js/staff-auth.js','utf8'),ctx);
 ctx.startStaffSessionMonitor();await new Promise(r=>setImmediate(r));assert.equal(reloads,0);
 valid=false;await check();assert.equal(reloads,1);assert.equal(session,null);
 session={id:'staff',role:'staff'};valid=true;ctx.startStaffSessionMonitor();await new Promise(r=>setImmediate(r));
 event('SIGNED_OUT');assert.equal(reloads,2);
 const w=new JSDOM('<div id="res-alert-panel" class="hidden"></div>',{runScripts:'outside-only'}).window;
 w.console={...console,error(){},warn(){}};w.db={};w.eval(fs.readFileSync('js/notify.js','utf8')+'\nObject.defineProperty(window,"testItems",{get:()=>_resNotifyItems,set:v=>_resNotifyItems=v});');
 w._resNotifyLoadStaffNames=()=>{};w._resNotifyRenderBadge=()=>{};w._resNotifyRenderList=()=>{};
 const pages=[];w.db.from=()=>({select(){return this},eq(){return this},is(){return this},in(){return this},or(){return this},order(){return this},
  async range(start,end){pages.push([start,end]);return {data:Array.from({length:start===0?150:1},(_,i)=>({id:String(start+i),status:'Incoming'}))}}});
 assert.equal((await w._resNotifyFetch()).length,151,'pending backlog cannot hide bookings beyond first page');
 assert.deepEqual(pages,[[0,149],[150,299]]);
 const pending=[];w._resNotifyFetch=()=>new Promise(resolve=>pending.push(resolve));
 const a=w._resNotifyRefresh(),b=w._resNotifyRefresh();
 pending[1]([{id:'new',status:'Reserved',done:false,date:'2099-01-01'}]);await b;
 pending[0]([{id:'old',status:'Reserved',done:false,date:'2099-01-01'}]);await a;
 assert.equal(w.testItems[0].id,'new','older response cannot overwrite newer data');
 const c=w._resNotifyRefresh();w.teardownOnlineResNotify();pending[2]([{id:'old-user'}]);await c;
 assert.equal(w.testItems.length,0,'logout invalidates in-flight refresh');
 let args,resolveSave;w.db.rpc=async(name,p)=>{assert.equal(name,'set_reservation_followup');args=p;return new Promise(resolve=>resolveSave=resolve)};
 w.testItems=[{id:'r',done:false,date:'2099-01-01'}];
 const save=w.resNotifyToggleDone('r');assert.equal(args.p_done,true);assert.equal('p_staff_id' in args,false);
 w.teardownOnlineResNotify();resolveSave({data:{ok:true,id:'r'}});await save;
 assert.equal(w.testItems.length,0,'old checklist response cannot restore previous user state');
 w.close();console.log('Session monitor, sign-out handling, reordered notifications and account-switch races passed');
})().catch(e=>{console.error(e);process.exitCode=1});
