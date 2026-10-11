import { response, serviceClient } from '../_shared/demo.ts';

Deno.serve(async req => {
  // Scheduled calls have no browser origin and use a separate maintenance secret.
  const secret = Deno.env.get('DEMO_CLEANUP_SECRET');
  if (!secret || req.headers.get('Authorization') !== 'Bearer ' + secret)
    return response(req, { error: 'Maintenance authorization required' }, 401);
  if (req.method !== 'POST') return response(req, { error: 'Method not allowed' }, 405);
  try {
    const admin = serviceClient();
    const batch = await admin.rpc('demo_cleanup_batch');
    if (batch.error || !Array.isArray(batch.data)) throw new Error('Cleanup unavailable');
    let deleted = 0;
    for (const userId of batch.data) {
      // Defense in depth: deletion never targets a permanent or staff identity.
      const identity = await admin.auth.admin.getUserById(userId);
      const staff = await admin.from('staff_users').select('id').eq('auth_user_id', userId).maybeSingle();
      if (staff.error || staff.data) continue;
      if (identity.error && identity.error.status !== 404) continue;
      if (identity.data.user && !identity.data.user.is_anonymous) continue;
      if (identity.data.user && (await admin.auth.admin.deleteUser(userId)).error) continue;
      if (!(await admin.rpc('demo_cleanup_confirm', { p_user_id: userId })).error) deleted++;
    }
    // Anonymous identities whose provisioning never ran/finished are collected
    // by a separate, bounded SQL queue added by the lifecycle migration.
    return response(req, { ok: true, deleted });
  } catch { return response(req, { error: 'Cleanup must be retried' }, 503); }
});
