/* Backend-free QA only. Uses actual navigation/search/profile functions and markup;
 * supplies filter-aware fictional reads. Never loads generated config or contacts Supabase.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'); }
function extract(file, name) {
  const content = source(file);
  const match = content.match(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  if (!match) throw new Error('Missing real app function: ' + name);
  const end = content.indexOf('\n}', match.index);
  return content.slice(match.index, end + 2);
}
const functions = [
  'navigateTo', 'loadGuests', 'renderGuestsTable', 'renderGuestPagination', 'searchGuests',
  'updateGuestSortIcons', 'viewGuestProfile', 'cancelGuestProfileRead', 'showLoginPage', 'loadDashboard', 'renderDashboardReservations',
  'renderDashboardWalkIns', 'renderDashboardAreaOccupancy', 'formatDashboardDateHeader',
  'onQwNameInput', 'hideQwResults', 'selectQwGuest', 'quickAddWalkIn',
].map(name => extract('js/app.js', name)).join('\n');
const utilities = ['showModal', 'hideModal', 'ymd'].map(name => extract('js/config.template.js', name)).join('\n');
const drawer = extract('js/settings-navigation.js', 'toggleSidebarDrawer');
const setup = `
const SUPABASE_URL = 'https://hkrhsubhfqrgqkuhpvql.supabase.co';
const TODAY = '2026-10-08';
let CURRENT_LANG = 'en', currentPage = 'dashboard';
let fixtureStaff = {id:'fixture-admin',role:'admin',display_name:'Demo host'};
const getStaffSession = () => fixtureStaff;
const currentStaffRole = () => fixtureStaff?.role;
const hasAccess = () => !!fixtureStaff;
const t = label => label;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const fixture = window.fixture = {delay:0,fail:null,writes:0,reads:0};
const guest = {id:'11111111-1111-4111-8111-111111111111',name:'Budi Santoso',phone:'Demo contact',
  company:null,created_at:'2026-07-01',favorite_menu:'Grilled fish',last_order:'Grilled fish',
  preference:'A quiet table near the window',food_allergy:'Peanuts',notes:'Enjoys outdoor seating',tag:'Regular'};
const second = {...guest,id:'22222222-2222-4222-8222-222222222222',name:'Michelle',favorite_menu:'Pasta',notes:'Birthday dinner'};
const visits = [
 {id:'visit-1',guest_id:guest.id,visit_date:TODAY,visit_time:'18:30',visit_type:'Walk-In',pax:2,status:'Active',spend_amount:null,assigned_area:'indoor',guests:guest,areas:{name:'Indoor Dining'},notes:'Window table'},
 {id:'visit-2',guest_id:guest.id,visit_date:'2026-09-28',visit_time:'19:00',visit_type:'Walk-In',pax:4,status:'Done',spend_amount:640000,assigned_area:'outdoor',guests:guest,areas:{name:'Outdoor Dining'}},
 {id:'visit-3',guest_id:guest.id,visit_date:'2026-09-14',visit_type:'Reservation',pax:2,status:'Done',spend_amount:320000,guests:guest,areas:{name:'Indoor Dining'}}
];
const bookings = [{id:'reservation-1',guest_id:guest.id,reservation_date:TODAY,reservation_time:'19:30',pax:4,status:'Reserved',assigned_area:'outdoor',guests:guest,areas:{name:'Outdoor Dining'},reservation_source:'Online Form',notes:'Anniversary dinner'}];
class ReadQuery {
  constructor(table) {this.table=table;this.filters=[];this.singleRow=false;this.columns='*';}
  select(columns) {this.columns=columns;return this;}
  eq(column,value) {this.filters.push(row=>row[column]===value);return this;}
  is(column,value) {this.filters.push(row=>(row[column]??null)===value);return this;}
  gt(column,value) {this.filters.push(row=>row[column]>value);return this;}
  not(column,operator,value) {this.filters.push(row=>row[column]!==value);return this;}
  order() {return this;} limit() {return this;} in() {return this;}
  or(expression) {const query=expression.split('ilike.%')[1]?.split('%')[0]?.toLowerCase()||'';this.filters.push(row=>[row.name,row.phone,row.company].some(value=>String(value||'').toLowerCase().includes(query)));return this;}
  single() {this.singleRow=true;return this;} maybeSingle() {return this.single();}
  insert() {fixture.writes++;throw Error('Fixture refuses writes');}
  update() {fixture.writes++;throw Error('Fixture refuses writes');}
  delete() {fixture.writes++;throw Error('Fixture refuses writes');}
  async then(resolve,reject) {
    try {
      fixture.reads++;
      const delay = fixture.delay, failed = fixture.fail === this.table || fixture.fail === this.columns;
      if(delay) await new Promise(done=>setTimeout(done,delay));
      const rows=(this.table==='guests'?[guest,second]:this.table==='visits'?visits:bookings).filter(row=>this.filters.every(filter=>filter(row)));
      return resolve(failed?{data:null,error:{code:'FIXTURE_READ_FAILED'}}:{data:this.singleRow?rows[0]||null:rows,error:null});
    } catch(error) {return reject(error);}
  }
}
const db = {from:table=>new ReadQuery(table),rpc:async()=>({data:[{guest_id:guest.id,visit_count:3,last_visit_date:TODAY}],error:null})};
const supabaseQuery = async callback => callback();
const fmt = {date:value=>value||'—',pax:value=>value+' pax',currency:value=>'Rp '+Number(value).toLocaleString('id-ID'),time:value=>String(value||'').slice(0,5)};
const memberBadgeMap={},memberBadge=()=>'',formatSpendingTierBadge=()=>'';
const financialTrackingSettings=()=>({depositEnabled:true,spendingEnabled:true});
const formatGuestName=value=>escapeHtml(value.name), renderGuestExtras=()=>'',assignedTableNames=()=> 'T2';
const truncateNotes=value=>String(value||'');
const currentStaffId=()=>fixtureStaff?.id,getNowTime=()=> '18:45',guestReadingName=value=>value.name;
let qwSelectedGuest=null,qwSearchTimeout=null;
const waThankYouVisitBtn=()=>'',followUpActionHtml=()=>'',statusBadge=value=>'<span class="badge">'+value+'</span>',dashboardDepositSummary=()=>'';
const odIdentity=()=>fixtureStaff?.id,odInvalidate=()=>{},loader=()=>{},settingsCaptureBaseline=()=>{},initI18nCache=()=>{},translateStaticDOM=()=>{};
const SETTINGS_SUBPAGES=[],defaultSettingsTab=()=> 'dashboard',settingsMayNavigate=()=>true;
const settingsNavigationChanged=()=>{if(document.body.classList.contains('sidebar-drawer-open'))toggleSidebarDrawer(false);};
const setStaffDashboardDateLabel=()=>{document.getElementById('dashboard-date-label').textContent='Thursday, 8 October 2026';};
const loadOwnerDashboard=async()=>{},loadReservationOutlook=async()=>{},renderStaffViewBanner=()=>{};
const fixtureOperations=async page=>{await new Promise(resolve=>setTimeout(resolve,fixture.delay));DemoTour.notify('operations-ready',{page,ok:fixture.fail!==page});};
const loadReservations=()=>fixtureOperations('reservations'),clearResSearch=()=>{},loadWalkIns=()=>fixtureOperations('walkins'),initInvoice=()=>{};
const toast=message=>{fixture.lastToast=message;};
let guestLoadGeneration=0,guestProfileGeneration=0,allGuests=[],guestPage=1,guestSortKey='name',guestSortDir='asc',guestTierFilter='all',guestMinVisits=0,guestTagFilter='',guestLastVisitFrom='',guestLastVisitTo='',searchTimeout;
const GUEST_PAGE_SIZE=25,GUEST_VISIT_HISTORY_TTL=300000;
let _guestVisitHistoryCache=null,_guestVisitHistoryCacheTime=0;
let dashboardLoadRequest=0,reservationDataRevision=0,dashboardResData=[],dashboardResPage=0,dashboardResFilter='all',dashboardReservationOffset=0,dashboardWalkinData=[],dashboardWalkinPage=0;
const DASH_PAGE_SIZE=5;
const allAreas=[{id:'indoor',name:'Indoor Dining',capacity:30},{id:'outdoor',name:'Outdoor Dining',capacity:24},{id:'vip',name:'VIP Room',capacity:12}],allTables=[];
const compareDashboardReservations=(a,b)=>String(a.reservation_time).localeCompare(String(b.reservation_time));
const dashboardVisibleReservations=()=>dashboardResData;
const renderPaginationControls=()=>{},updateDashboardReservationTabs=()=>{},attachGuestVisitCounts=async()=>{};
const loadDashboardReservationCounts=async()=>{},loadDashboardReservations=async()=>renderDashboardReservations(bookings);
const odRows=async(table,columns,filter)=>{const query=new ReadQuery(table).select(columns);const result=await filter(query);if(result.error)throw Error('Fixture read failed');return result.data;};
const odRange=()=>({start:TODAY,end:TODAY});
const getDashboardDate=()=>TODAY;
const openResActions=()=>{fixture.lastToast='Reservation shortcut clicked (local read fixture)';},editGuest=()=>{},startEditFavoriteMenu=()=>{},startEditVisitSpend=()=>{},openGuestModal=()=>{},openWalkInModal=()=>{},openReservationModal=()=>{};
fixture.changeIdentity = value=>{fixtureStaff=value;};
fixture.logout = ()=>{fixtureStaff=null;showLoginPage();};
fixture.relogin = async()=>{fixtureStaff={id:'fixture-admin',role:'admin'};document.getElementById('app-main').classList.remove('hidden');DemoTour.sessionReady(fixtureStaff);await navigateTo('dashboard');};
`;
const runtime = setup + '\n' + utilities + '\n' + drawer + '\n' + functions;
const boot = `
document.documentElement.removeAttribute('data-page-loading');
document.getElementById('login-page').classList.add('hidden');
document.getElementById('app-sidebar').classList.remove('hidden');
document.getElementById('app-main').classList.remove('hidden');
document.getElementById('sidebar-mobile-toggle').classList.remove('hidden');
document.getElementById('staff-display-name').textContent='Local fictional fixture';
document.getElementById('sidebar-logout')?.setAttribute('onclick','fixture.logout()');
initDemoPresentation();
DemoTour.sessionReady(fixtureStaff);
const savedPage=localStorage.getItem('lastPage')||'dashboard';
navigateTo(savedPage);
`;
function html() {
  let content = source('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  content = content.replace('</head>', '<script src="https://cdn.tailwindcss.com"></script><style>.hidden{display:none!important}</style></head>');
  return content.replace('</body>', [
    '<script src="assets/vendor/driverjs/1.9.0/driver.js.iife.js"></script>',
    '<script src="js/demo-tour-environment.js"></script>',
    '<script src="js/demo-tour.js"></script>',
    '<script>' + runtime + '</script>',
    '<script src="js/demo.js"></script>',
    '<script>' + boot + '</script></body>',
  ].join('\n'));
}
module.exports = { html, runtime, boot, source, root };
