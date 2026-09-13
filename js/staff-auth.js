// The visible login remains username + PIN. Supabase Auth supplies the JWT.
function staffAuthEmail(username) { return String(username).trim().toLowerCase() + "@staff.intoch.invalid"; }
function staffAuthPassword(pin) { return "Intoch-PIN:" + pin; }
async function restoreVerifiedStaffSession() {
  const {data,error} = await db.auth.getUser();
  if (error || !data?.user) { clearStaffSession(); return null; }
  const valid = await db.rpc('app_session_valid');
  if (valid.error || valid.data !== true) { clearStaffSession(); await db.auth.signOut({scope:'local'}); return null; }
  const result = await db.from("staff_users").select("id,username,display_name,role,is_active,can_waive_deposit").eq("auth_user_id",data.user.id).eq("is_active",true).maybeSingle();
  if (result.error || !result.data) { clearStaffSession(); await db.auth.signOut(); return null; }
  setStaffSession(result.data);
  return result.data;
}

let staffSessionWatch = null;
let staffSessionEpoch = 0;
function stopStaffSessionMonitor() {
  staffSessionEpoch++;
  if (!staffSessionWatch) return;
  clearInterval(staffSessionWatch.timer);
  staffSessionWatch.subscription?.unsubscribe();
  window.removeEventListener('focus', staffSessionWatch.check);
  window.removeEventListener('online', staffSessionWatch.check);
  document.removeEventListener('visibilitychange', staffSessionWatch.check);
  staffSessionWatch = null;
}
function startStaffSessionMonitor() {
  stopStaffSessionMonitor();
  const epoch = staffSessionEpoch;
  const initialStaff = getStaffSession()?.id;
  let busy = false;
  const leave = () => {
    if (epoch !== staffSessionEpoch) return;
    stopStaffSessionMonitor();
    clearStaffSession();
    if (typeof teardownOnlineResNotify === 'function') teardownOnlineResNotify();
    if (typeof teardownRealtimeUpdates === 'function') teardownRealtimeUpdates();
    if (typeof showLoginPage === 'function') showLoginPage();
    // A full reload also discards sensitive cached rows and in-flight UI work.
    window.location.reload();
  };
  const check = async () => {
    if (busy || document.hidden || epoch !== staffSessionEpoch) return;
    busy = true;
    try {
      const {data,error} = await db.rpc('app_session_valid');
      if (epoch !== staffSessionEpoch) return;
      if (error) { console.warn('[staff-session] validation unavailable', {code:error.code}); return; }
      if (data !== true || getStaffSession()?.id !== initialStaff) { leave(); return; }
      const profile = await db.from('staff_users').select('id,username,display_name,role,is_active,can_waive_deposit').eq('id',initialStaff).maybeSingle();
      if (epoch !== staffSessionEpoch || profile.error) return;
      if (!profile.data?.is_active) { leave(); return; }
      if (profile.data.role !== getStaffSession()?.role) { window.location.reload(); return; }
      setStaffSession(profile.data);
    } catch (error) { console.warn('[staff-session] validation unavailable', {name:error.name}); }
    finally { busy=false; }
  };
  // Defer work outside Auth's callback to avoid locking its refresh lifecycle.
  const {data} = db.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') setTimeout(leave,0);
    else if (['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) setTimeout(check,0);
  });
  staffSessionWatch = {check,subscription:data?.subscription,timer:setInterval(check,15000)};
  window.addEventListener('focus',check);
  window.addEventListener('online',check);
  document.addEventListener('visibilitychange',check);
  check();
}

async function refreshDepositWaiverPermission() {
  const session = getStaffSession();
  if (!session || !['staff','finance'].includes(session.role)) return;
  let allowed = false;
  try {
    const {data,error} = await db.rpc('app_can_waive_deposit');
    allowed = !error && data === true;
  } catch { /* Fail closed if the permission check cannot be reached. */ }
  if (getStaffSession()?.id === session.id) {
    setStaffSession({...session,can_waive_deposit:allowed});
  }
}
