// Backend-free login QA. Real form, login handler and verified-session restoration;
// fictional Auth/profile replies. Never connects to Supabase or creates real sessions.
const { source } = require('./demo-tour-fixture.cjs');
function extract(file, name) {
  const content = source(file), match = content.match(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  if (!match) throw Error('Missing login function: ' + name);
  return content.slice(match.index, content.indexOf('\n}', match.index) + 2);
}
const credential = source('js/demo-login.js').match(/const username = "([^"]+)", pin = "([^"]+)"/);
const runtime = `
const SUPABASE_URL = 'https://hkrhsubhfqrgqkuhpvql.supabase.co';
let CURRENT_LANG = 'en', fixtureStaff = null;
window.fixture = {calls:0,initializations:0,reject:false,invalidSession:false,inactive:false};
const loader = () => {}, initI18nCache = () => {}, translateStaticDOM = () => {}, applyRoleToNav = () => {};
const getStaffSession = () => fixtureStaff;
const setStaffSession = value => {fixtureStaff=value;};
const clearStaffSession = () => {fixtureStaff=null;};
const db = {
 auth: {
  signInWithPassword: async values => {fixture.calls++;return {error:fixture.reject || values.email !== ${JSON.stringify(credential[1] + '@staff.intoch.invalid')} || values.password !== ${JSON.stringify('Intoch-PIN:' + credential[2])} ? {message:'Fixture rejected'} : null};},
  getUser: async () => ({data:{user:{id:'fictional-auth'}}}), signOut: async () => ({error:null})
 },
 rpc: async () => ({data:!fixture.invalidSession,error:null}),
 from: () => {const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:fixture.inactive?null:{id:'fictional-staff',role:'staff',is_active:true},error:null})};return query;}
};
async function initializeApplication(page) {fixture.initializations++;fixture.page=page;showAppShell();}
${source('js/staff-auth.js').split('\n').filter(line=>/^function staffAuth(?:Email|Password)\(/.test(line)).join('\n')}
${extract('js/staff-auth.js','restoreVerifiedStaffSession')}
${['showLoginPage','showAppShell','loginStaff'].map(name=>extract('js/app.js',name)).join('\n')}
`;
function html() {
  let content = source('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  content = content.replace('</head>', '<script src="https://cdn.tailwindcss.com"></script><style>.hidden{display:none!important}</style></head>');
  return content.replace('</body>', `<script>${runtime}</script><script src="js/demo.js"></script><script src="js/demo-tour-environment.js"></script><script src="js/demo-login.js"></script><script>document.documentElement.removeAttribute('data-page-loading');showLoginPage();</script></body>`);
}
module.exports = {html,runtime};
