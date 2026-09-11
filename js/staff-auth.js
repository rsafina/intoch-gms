// The visible login remains username + PIN. Supabase Auth supplies the JWT.
function staffAuthEmail(username) { return String(username).trim().toLowerCase() + "@staff.intoch.invalid"; }
function staffAuthPassword(pin) { return "Intoch-PIN:" + pin; }
async function restoreVerifiedStaffSession() {
  const {data,error} = await db.auth.getUser();
  if (error || !data?.user) { clearStaffSession(); return null; }
  const result = await db.from("staff_users").select("id,username,display_name,role,is_active").eq("auth_user_id",data.user.id).eq("is_active",true).maybeSingle();
  if (result.error || !result.data) { clearStaffSession(); await db.auth.signOut(); return null; }
  setStaffSession(result.data);
  return result.data;
}
