import { acceptedOrigin, digest, response, serviceClient } from '../_shared/demo.ts';

Deno.serve(async req => {
  if (!acceptedOrigin(req)) return response(req, { error: 'Demo origin unavailable' }, 403);
  if (req.method === 'OPTIONS') return response(req, { ok: true });
  if (req.method !== 'POST') return response(req, { error: 'Method not allowed' }, 405);
  try {
    const admin = serviceClient();
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const identity = await admin.auth.getUser(token);
    const claims = await admin.auth.getClaims(token);
    const user = identity.data.user;
    const session = claims.data?.claims?.session_id;
    if (identity.error || claims.error || !user?.is_anonymous || typeof session !== 'string')
      return response(req, { error: 'Temporary demo authentication required' }, 401);
    // The gateway IP header and CAPTCHA are checked server-side. Never trust an
    // IP or workspace ID supplied in a JSON body. Fail closed without secrets.
    const secret = Deno.env.get('DEMO_TURNSTILE_SECRET_KEY');
    const salt = Deno.env.get('DEMO_RATE_LIMIT_SALT');
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!secret || !salt || !ip) return response(req, { error: 'Demo preparation is temporarily unavailable' }, 503);
    const body = await req.json();
    if (typeof body.captchaToken !== 'string' || body.captchaToken.length > 4096)
      return response(req, { error: 'Complete the security check' }, 400);
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: new URLSearchParams({ secret, response: body.captchaToken, remoteip: ip }),
      signal: AbortSignal.timeout(10000),
    });
    const check = await verification.json();
    const originHost = new URL(req.headers.get('Origin')!).hostname;
    if (!verification.ok || !check.success || check.hostname !== originHost || check.action !== 'intoch-demo')
      return response(req, { error: 'Please repeat the security check' }, 403);
    const result = await admin.rpc('demo_provision', {
      p_user_id: user.id, p_auth_session_id: session, p_ip_hash: await digest(salt + ':' + ip),
    });
    if (result.error) return response(req, { error: 'Could not prepare this demo. Retry or start a fresh session.' }, 409);
    return response(req, result.data);
  } catch { return response(req, { error: 'Demo preparation is temporarily unavailable' }, 503); }
});
