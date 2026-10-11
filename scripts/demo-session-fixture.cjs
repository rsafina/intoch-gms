// Backend-free visual QA of the actual dashboard/tour and session controller.
const { source, runtime, root } = require('./demo-tour-fixture.cjs');
function html() {
 const context=runtime
  .replace('const getStaffSession = () => fixtureStaff;', 'const getStaffSession = () => window.DemoSession?.profile() || fixtureStaff;')
  .replace('const hasAccess = () => !!fixtureStaff;', "const hasAccess = page => window.DemoSession?.selected() ? window.DemoSession.permits(page) : !!fixtureStaff;")
  .replace('const currentStaffId=()=>fixtureStaff?.id', 'const currentStaffId=()=>window.DemoSession?.selected()?null:fixtureStaff?.id');
 const mutableContext=context.replace('const allAreas=', 'let allAreas=');
 const support=`
 const SUPABASE_ANON_KEY='public-fixture'; const DEMO_TURNSTILE_SITE_KEY='public-fixture';
 window.PageLoading={finish:()=>document.documentElement.removeAttribute('data-page-loading')};
 const seededStart=localStorage.getItem('intoch-fixture-start')||new Date().toISOString();localStorage.setItem('intoch-fixture-start',seededStart);
 let expired=false;
 const sessionStatus=()=>({id:'fixture-private-demo',user_id:'fixture-anonymous',active:!expired,
  started_at:seededStart,expires_at:new Date(Date.parse(seededStart)+3600000).toISOString(),server_now:new Date().toISOString()});
 const auth={getUser:async()=>({data:{user:{id:'fixture-anonymous',is_anonymous:true}},error:null}),
  signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})};
 window.supabase={createClient:()=>({auth,rpc:async name=>({data:name==='demo_session_status'?sessionStatus():{ok:true},error:null}),
  functions:{invoke:async()=>({data:sessionStatus(),error:null})}})};
 window.turnstile={render:(selector,options)=>{queueMicrotask(()=>options.callback('fixture-check'));return 1;},remove(){}};
 window.initializeApplication=async()=>{
  document.getElementById('login-page').classList.add('hidden');document.getElementById('app-sidebar').classList.remove('hidden');
  document.getElementById('app-main').classList.remove('hidden');document.getElementById('sidebar-mobile-toggle').classList.remove('hidden');
  document.getElementById('staff-display-name').textContent='Private Demo';
  document.querySelectorAll('[data-nav]').forEach(node=>node.style.display=hasAccess(node.dataset.nav)?'':'none');
  initDemoPresentation();DemoTour.sessionReady(DemoSession.profile());await navigateTo('dashboard');
 };
 fixture.expireDemo=async()=>{expired=true;await DemoSession.validate();};
 fixture.getSession=()=>sessionStatus();
 document.getElementById('sidebar-logout').onclick=()=>DemoSession.exit();
 `;
 let page=source('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 page=page.replace('</head>','<script src="https://cdn.tailwindcss.com"></script><style>.hidden{display:none!important}</style></head>');
 return page.replace('</body>',[
  '<script src="assets/vendor/driverjs/1.9.0/driver.js.iife.js"></script>',
  '<script src="js/demo-tour-environment.js"></script>',
  '<script>'+mutableContext+'\n'+support+'</script>',
  '<script src="js/demo-session.js"></script>',
  '<script src="js/demo.js"></script><script src="js/demo-tour.js"></script>',
  '<script>DemoSession.bootstrap()</script></body>',
 ].join('\n'));
}
module.exports={html,root};
