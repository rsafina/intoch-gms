const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {html,runtime} = require('../scripts/demo-login-fixture.cjs');
const {source} = require('../scripts/demo-tour-fixture.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function harness(options = {}) {
  const dom = new JSDOM(html().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''), {url:options.origin || 'http://127.0.0.1:8080',runScripts:'outside-only',pretendToBeVisual:true});
  const win = dom.window;
  win.eval([runtime,source('js/demo.js'),source('js/demo-tour-environment.js'),source('js/demo-login.js'),options.setup || '', 'showLoginPage();'].join('\n'));
  await sleep(75);
  return {win,dom};
}
(async()=>{
  let h = await harness();
  const {win} = h, submit = win.document.querySelector('[data-tour="login-submit"]');
  assert.equal(win.document.getElementById('login-username').value,'intoch-demo');
  assert.equal(win.document.getElementById('login-pin').value.length,4);
  assert.match(win.document.getElementById('demo-login-hint').textContent,/Click Login to continue/);
  assert.equal(win.document.activeElement,submit,'Autofill focuses Login rather than opening the phone keyboard');
  assert.equal(win.fixture.calls,0,'Preparing does not authenticate automatically');
  win.showLoginPage();assert.equal(win.document.querySelectorAll('#demo-login-hint').length,1,'Idempotent hint');
  win.fixture.reject=true;await win.loginStaff();assert.equal(win.fixture.initializations,0);assert.equal(win.document.getElementById('login-error').classList.contains('hidden'),false);
  win.fixture.reject=false;win.fixture.invalidSession=true;await win.loginStaff();assert.equal(win.fixture.initializations,0,'Auth success alone cannot bypass verified session checks');
  win.fixture.invalidSession=false;win.fixture.inactive=true;await win.loginStaff();assert.equal(win.fixture.initializations,0,'Inactive profile cannot enter');
  win.fixture.inactive=false;await win.loginStaff();assert.equal(win.fixture.page,'dashboard');assert.equal(win.document.getElementById('login-pin').value,'');assert.equal(win.document.getElementById('demo-login-hint'),null);
  assert.equal(submit.classList.contains('demo-login-highlight'),false);assert.equal(submit.hasAttribute('aria-describedby'),false);
  win.showLoginPage();assert.equal(win.document.getElementById('login-pin').value.length,4,'Logout/login screen restores public demo autofill without signing in');
  h.dom.window.close();
  for(const options of [
    {origin:'https://client.example'}, {origin:'https://demo.intoch.app.client.example'},
    {setup:'window.INTOCH_DEMO_TOUR_ENV={origins:[location.origin],supabaseUrl:"https://other.supabase.co"};'},
    {setup:'document.documentElement.classList.remove("demo-mode");'},
  ]) {
    h=await harness(options);assert.equal(h.win.document.getElementById('login-username').value,'');assert.equal(h.win.document.getElementById('login-pin').value,'');assert.equal(h.win.document.getElementById('demo-login-hint'),null);assert.equal(h.win.fixture.calls,0);h.dom.window.close();
  }
  h=await harness({setup:'document.getElementById("login-username").value="another-staff";document.getElementById("login-pin").value="9876";'});
  assert.equal(h.win.document.getElementById('login-username').value,'another-staff');assert.equal(h.win.document.getElementById('login-pin').value,'9876','Preserves typed/saved credentials');h.dom.window.close();
  h=await harness({setup:'CURRENT_LANG="id";'});assert.match(h.win.document.getElementById('demo-login-hint').textContent,/Klik Login/);h.dom.window.close();
  console.log('Demo login: allowlist/project gates, editable autofill, manual Auth, verified session/profile checks, dashboard entry, teardown, focus and hint passed.');
})().catch(error=>{console.error(error);process.exit(1);});
