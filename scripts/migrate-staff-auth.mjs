// Run once with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
// Credentials never print. Existing usernames, PINs and staff IDs are preserved.
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key) throw Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
async function api(path,method='GET',body){const r=await fetch(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Migration request failed: '+r.status+' '+path.split('?')[0]);return r.status===204?null:r.json();}
const users=await api('/rest/v1/staff_users?select=id,username,pin,auth_user_id');
let migrated=0;
for(const user of users){
 if(user.auth_user_id)continue;
 if(!/^\d{4}$/.test(user.pin||''))throw Error('An unmapped account has no valid PIN; migration stopped.');
 const email=user.username.toLowerCase()+'@staff.intoch.invalid';
 // Check for a previous interrupted creation, without resetting its password.
 let found=null;
 for(let page=1;;page++){const batch=await api('/auth/v1/admin/users?page='+page+'&per_page=100');found=batch.users.find(u=>u.email===email);if(found||batch.users.length<100)break;}
 if(!found)found=await api('/auth/v1/admin/users','POST',{email,password:'Intoch-PIN:'+user.pin,email_confirm:true});
 await api('/rest/v1/staff_users?id=eq.'+user.id,'PATCH',{auth_user_id:found.id});migrated++;
}
console.log('Auth accounts linked:',migrated,'. Apply the roles enforcement migration next.');
