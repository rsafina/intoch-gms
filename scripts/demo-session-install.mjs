// Explicitly pinned management API installer; never reads the local CLI link.
// Defaults to a read-only preflight. --apply installs only the two additive SQL
// phases; API exposure, CAPTCHA, Edge deployment and Cron remain separate steps.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const PROJECT = 'hkrhsubhfqrgqkuhpvql';
const phases = ['migrations/20261011_demo_sessions.sql','migrations/20261011_demo_lifecycle.sql'];
const flags = process.argv.slice(2);
if (flags.some(flag => !['--plan','--apply'].includes(flag)) || flags.length > 1) {
  console.error('Use --plan, no arguments (read-only), or --apply. Project cannot be overridden.');
  process.exit(1);
}
if (execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim() !== 'feature/demo-guided-tour') {
  console.error('Run only on feature/demo-guided-tour.');process.exit(1);
}
if (flags.includes('--plan')) {
  console.log('Pinned playground:',PROJECT);
  console.log('Ordered additive phases:',phases.join(', '));
  console.log('No requests or changes performed.');process.exit(0);
}
if (fs.existsSync('.env.demo-rollout')) process.loadEnvFile('.env.demo-rollout');
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('Configure SUPABASE_ACCESS_TOKEN locally in ignored .env.demo-rollout. Do not paste it into chat.');process.exit(1); }
async function request(path,body) {
  const result=await fetch('https://api.supabase.com/v1/projects/'+PROJECT+path,{
    method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(120000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  if (!result.ok) throw new Error('Playground management request failed (HTTP '+result.status+'). No response body logged.');
  return result.json();
}
const query=(sql,readOnly=true)=>request('/database/query',{query:sql,read_only:readOnly});
try {
  const project=await request('');
  if ((project.id || project.ref)!==PROJECT || project.status!=='ACTIVE_HEALTHY') throw new Error('Playground project identity/health check failed.');
  const inspect=`select to_regclass('demo_private.sessions') is not null as isolation,
    to_regprocedure('public.demo_provision(uuid,uuid,text)') is not null as lifecycle,
    to_regprocedure('public.app_session_valid()') is not null and
    to_regprocedure('public.record_reservation_arrival(uuid)') is not null and
    to_regprocedure('public.finish_visit_without_spending(uuid,uuid,text)') is not null as prerequisites`;
  const rows=await query(inspect);const state=rows[0];
  if (!state?.prerequisites || (state.lifecycle&&!state.isolation)) throw new Error('Installed schema requires review; prerequisites missing or inconsistent demo installation.');
  console.log('Verified playground:',PROJECT);
  console.log('Isolation installed:',state.isolation,'Lifecycle installed:',state.lifecycle);
  if (!flags.includes('--apply')) {console.log('Read-only preflight complete. No changes performed.');process.exit(0);}
  const fingerprint=`select md5(coalesce(string_agg(schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,''), E'\\n' order by tablename,policyname),'')) as policies from pg_policies where schemaname='public'`;
  const before=(await query(fingerprint))[0].policies;
  for(let index=0;index<phases.length;index++) {
    if (index===0?state.isolation:state.lifecycle) continue;
    await query("set intoch.demo_project_ref = '"+PROJECT+"';\n"+fs.readFileSync(phases[index],'utf8'),false);
    console.log('Installed:',phases[index]);
  }
  if ((await query(fingerprint))[0].policies!==before) throw new Error('Public staff policies changed unexpectedly; stop rollout and inspect.');
  console.log('Public staff policy fingerprint preserved. Continue the reviewed rollout guide; Auth/API/Edge/Cron are not configured by this command.');
} catch(error) {
  console.error(error.message.startsWith('Playground')||error.message.startsWith('Installed')||error.message.startsWith('Public')?error.message:'Playground installation stopped. Inspect connectivity/access and installed phases before retrying.');
  process.exitCode=1;
}
