// The visible login remains username + PIN. Supabase Auth supplies the JWT.
function staffAuthEmail(username) { return String(username).trim().toLowerCase() + "@staff.intoch.invalid"; }
function staffAuthPassword(pin) { return "Intoch-PIN:" + pin; }
async function restoreVerifiedStaffSession() {
  const {data,error} = await db.auth.getUser();
  if (error || !data?.user) { clearStaffSession(); return null; }
  const result = await db.from("staff_users").select("id,username,display_name,role,is_active,can_waive_deposit").eq("auth_user_id",data.user.id).eq("is_active",true).maybeSingle();
  if (result.error || !result.data) { clearStaffSession(); await db.auth.signOut(); return null; }
  setStaffSession(result.data);
  return result.data;
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
