# Auth and role deployment

Phase 1 is implemented; this file is not a proposal to replace it. Phase 2 responsive
Owner/Admin summary is implemented and requires no separate Phase 2 SQL migration.
The canonical bootstrap/upgrade order is [migrations/README.md](../../migrations/README.md).
The full role/security map is [docs/ARCHITECTURE.md](../ARCHITECTURE.md).

## Preserve these boundaries

- Username/PIN maps to Supabase Auth identities linked by `staff_users.auth_user_id`.
  Active role/session lookup is verified in the DB, not localStorage or editable metadata.
- Owner reads summaries/reports; Admin manages everything; Manager cannot change accounts
  or payment destinations. Staff gets core operations/deposit invoices. Finance gets its
  documented invoice/voucher operations, no Walk-In management or privileged adjustments.
- Staff/Finance waiver is an Admin-controlled per-account flag, rechecked by the DB.
- Keep RLS, private guarded RPC implementations, trusted audit attribution and Storage QRIS
  restrictions. Never reinstate public full access or blanket helper grants.
- Four digits remain limited entropy. Keep Auth rate limiting; disable public signup and
  email recovery for internal identities. Do not store/log PINs or service credentials.

## Coordination

Account linking is a one-time trusted Auth API operation before roles_enforce. Do not rerun
roles_enforce or ALL_IN_ONE on a secured database. Existing projects get targeted upgrades.
Current staff-account and frontend require the session migration; old initial Phase 1
instructions to deploy the function earlier are not sufficient for current source.

Deploy `staff-account` separately to the verified project, using the command in
[CLIENT_DEPLOY](CLIENT_DEPLOY.md). The function validates the bearer, active Admin and
session even when platform JWT verification is disabled. Auth password operations use a
server-only service client; ordinary account writes use the caller so auditing remains real.
PIN reset pending/cutoff/finalization is described in
[SESSION_SPENDING_ROLLOUT](../SESSION_SPENDING_ROLLOUT.md).

After rollout, verify each role, per-account waiver, deactivation, PIN-reset old/new sessions,
public reservation/spin, invoice/ticket lookup, membership/vouchers, and Admin-only QRIS.
Mock/PGlite test success does not substitute for these environment-specific smoke checks.
No applied migration/function version can be inferred from a frontend push.
