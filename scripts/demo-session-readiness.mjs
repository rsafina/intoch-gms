// Read-only public readiness checks. No staff login, SQL, writes or deployment.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const PROJECT='https://hkrhsubhfqrgqkuhpvql.supabase.co';
if(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()!=='feature/demo-guided-tour')
 throw new Error('Run this only on feature/demo-guided-tour');
const local=fs.existsSync('.env.demo')?Object.fromEntries(fs.readFileSync('.env.demo','utf8').split(/\r?\n/)
 .filter(line=>/^DEMO_SUPABASE_(URL|ANON_KEY)=/.test(line)).map(line=>{const separator=line.indexOf('=');return [line.slice(0,separator),line.slice(separator+1).trim().replace(/^['"]|['"]$/g,'')];})):{};
if(local.DEMO_SUPABASE_URL!==PROJECT)throw new Error('Local demo configuration does not match the pinned playground');
let key=local.DEMO_SUPABASE_ANON_KEY;
if(!key){
 const published=await fetch('https://demo.intoch.app/js/config.js',{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!published.ok)throw new Error('Published playground configuration unavailable');
 const source=await published.text();
 const url=source.match(/const\s+SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
 if(url!==PROJECT)throw new Error('Published configuration is not the approved playground');
 key=source.match(/const\s+SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1];
}
if(!key||key.startsWith('sb_secret_'))throw new Error('Public playground key required');
if(key.startsWith('eyJ')){
 const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());
 if(claims.role!=='anon'||claims.ref!=='hkrhsubhfqrgqkuhpvql')throw new Error('Wrong project/key role');
}else if(!key.startsWith('sb_publishable_'))throw new Error('Public key required');
const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})};
async function request(path,extra={}){
 const reply=await fetch(PROJECT+path,{headers:{...headers,...extra},redirect:'error',signal:AbortSignal.timeout(15000)});
 return {status:reply.status,data:await reply.json().catch(()=>null)};
}
const settings=await request('/auth/v1/settings');
console.log('Pinned playground reached:',settings.status===200);
console.log('Anonymous sign-ins enabled:',settings.data?.external?.anonymous_users===true);
const schema=await request('/rest/v1/areas?select=id&limit=1',{'Accept-Profile':'intoch_demo'});
console.log('Demo schema exposed:',schema.data?.code!=='PGRST106'&&[200,401,403].includes(schema.status));
console.log('Unauthenticated demo rows blocked:',[401,403].includes(schema.status)||(schema.status===200&&Array.isArray(schema.data)&&schema.data.length===0));
const status=await request('/rest/v1/rpc/demo_session_status');
console.log('Demo status RPC installed:',status.data?.code!=='PGRST202'&&[200,401,403].includes(status.status));
console.log('This check does not prove authenticated isolation, cleanup scheduling or live Admin regression.');
