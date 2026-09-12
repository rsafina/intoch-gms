import { createClient } from 'npm:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Content-Type':'application/json'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 const {data:identity,error:authError}=await admin.auth.getUser(token);
 if(authError||!identity.user)return reply({error:'Sign in required'},401);
 const {data:actor}=await admin.from('staff_users').select('id,role,is_active').eq('auth_user_id',identity.user.id).single();
 if(!actor?.is_active||actor.role!=='admin')return reply({error:'Admin required'},403);
 const editor=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});
 try{
  const body=await req.json();
  const {id,display_name,role,pin}=body;
  if(body.can_waive_deposit!==undefined && typeof body.can_waive_deposit!=='boolean')return reply({error:'Invalid deposit waiver permission'},400);
  const waiverPermission=body.can_waive_deposit===undefined?{}:{can_waive_deposit:role==='staff' && body.can_waive_deposit};
  if(!['owner','admin','manager','staff'].includes(role)||typeof display_name!=='string'||display_name.trim().length<2)return reply({error:'Invalid account details'},400);
  if(pin!==undefined&&!/^\d{4}$/.test(pin))return reply({error:'PIN must be four digits'},400);
  if(id){
   const {data:old}=await admin.from('staff_users').select('auth_user_id,role').eq('id',id).single();
   if(!old?.auth_user_id)return reply({error:'Account not migrated'},400);
   if(id===actor.id&&role!==old.role)return reply({error:'Cannot change your own role'},400);
   const {error}=await editor.from('staff_users').update({display_name:display_name.trim(),role,...waiverPermission}).eq('id',id);
   if(error)return reply({error:error.message},400);
   if(pin){const result=await admin.auth.admin.updateUserById(old.auth_user_id,{password:'Intoch-PIN:'+pin});if(result.error)return reply({error:'Name/role saved, but PIN update failed. Retry the PIN change.'},500);const logged=await editor.rpc('record_staff_pin_change',{p_staff_id:id});if(logged.error)return reply({error:'PIN changed, but the audit entry failed. Contact your administrator.'},500);}
  }else{
   const username=String(body.username||'').trim().toLowerCase();
   if(!/^[a-z0-9._-]{3,20}$/.test(username)||!pin)return reply({error:'Valid username and PIN required'},400);
   const created=await admin.auth.admin.createUser({email:username+'@staff.intoch.invalid',password:'Intoch-PIN:'+pin,email_confirm:true});
   if(created.error)return reply({error:'Could not create account; check for an existing username.'},400);
   const {error}=await editor.from('staff_users').insert({username,display_name:display_name.trim(),role,auth_user_id:created.data.user.id,is_active:true,pin:null,...waiverPermission});
   if(error){await admin.auth.admin.deleteUser(created.data.user.id);return reply({error:error.message},400);}
  }
  return reply({ok:true});
 }catch{return reply({error:'Could not save account'},500);}
});
