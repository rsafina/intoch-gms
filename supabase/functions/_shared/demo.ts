import { createClient } from 'npm:@supabase/supabase-js@2';

export const PLAYGROUND = 'https://hkrhsubhfqrgqkuhpvql.supabase.co';
const origins = ['https://demo.intoch.app', 'https://dashboard.intoch.app', 'http://localhost:8080', 'http://127.0.0.1:8080'];
export function response(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get('Origin') || '';
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    ...(origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  } });
}
export function serviceClient() {
  if (Deno.env.get('SUPABASE_URL') !== PLAYGROUND) throw new Error('Wrong project');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('Server configuration unavailable');
  return createClient(PLAYGROUND, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function acceptedOrigin(req: Request) { return origins.includes(req.headers.get('Origin') || ''); }
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
