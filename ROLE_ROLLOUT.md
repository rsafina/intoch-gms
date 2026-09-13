# Stage 1: verified staff roles, keeping username/PIN login

This is a coordinated deployment, not a standalone frontend push. The Owner summary redesign is stage 2; Owner currently gets the existing summary dashboard and reports.

## Permissions

- Owner: read-only dashboard/reports. Database writes and operational RPCs are denied.
- Admin: all operational pages, staff accounts, bank details, QRIS and payment instructions.
- Manager: operations/reports, waivers and voids, but no accounts, role changes, bank details or QRIS changes.
- Staff: Dashboard, Reservations, Walk-ins, Membership and Guests; deposit invoices and positive payment records. Waivers, negative payment adjustments and deletion require Manager/Admin.

Page navigation is a convenience. RLS and protected RPC wrappers enforce verified database roles. Role lookup uses `staff_users.auth_user_id` and `is_active`, not editable JWT metadata or the local-storage role label. Deactivating an account revokes its database access without waiting for its JWT to expire.

Username/PIN stays unchanged on the login screen. The client maps usernames to internal `@staff.intoch.invalid` Auth identities, using `Intoch-PIN:` plus the PIN as the Auth password. This prefix only satisfies the provider password-length requirement; it does not add PIN entropy. Retain Supabase Auth rate limiting. Do not enable public signup or email password recovery for these internal identities. Admin resets PINs through Staff settings.

## Deployment order

1. Back up the database and confirm at least one active Admin account. Schedule a short maintenance window for steps 4–6.
2. Apply `migrations/20260911_roles_prepare.sql`. It adds Auth links and the Owner role without changing existing access.
3. In a trusted terminal set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run `node scripts/migrate-staff-auth.mjs`. Never put the service-role key in the frontend, build-config variables or a committed file. This links existing accounts using their current usernames/PINs and preserves their staff IDs. The script can resume interrupted provisioning. Clear the secret from the terminal afterward.
4. Deploy the account-management function: `supabase functions deploy staff-account --no-verify-jwt`. The function itself verifies the bearer token with Auth and checks the active Admin database row. It requires the normal Supabase URL, anon key and service-role key server environment values. Disable public Auth signup in the Supabase project.
5. Apply `migrations/20260911_roles_enforce.sql` ONCE. It aborts if any staff account lacks an Auth link, clears legacy plaintext PINs, replaces public-table policies, wraps allowed RPCs and protects Storage writes. The migration is intentionally not appended to ALL_IN_ONE; migration order and account provisioning are mandatory. It refuses a second application.
6. Deploy the frontend together with `js/staff-auth.js`. All users must sign in again. Old local-only login sessions are deliberately rejected.
7. Verify login for Admin, Manager, Staff and Owner, public booking, the spin flow, guest invoice/ticket links, and public promo pages. Verify Admin can upload QRIS and Manager cannot. Confirm staff deposit creation and payment recording, then Manager waiver/void. Test a deactivated account. Do not remove maintenance mode until these live smoke checks pass.

The enforcement migration denies unlisted legacy RPCs by default. Any additional deployment-specific RPC must be reviewed and assigned a role before granting access. Protected implementations live in `app_private`; later migrations changing them must update that implementation while retaining the authorized public wrapper. Do not rerun old all-in-one migrations after enforcement: they would restore older grants/functions.

Payment instructions in full invoice documents are admin-controlled. Simplified invoice notes remain editable because they are guest notes, not the payment destination; that template obtains payment details from protected settings.

Audit entries are in `app_private.role_audit`, with verified actor ID, Auth ID, timestamp and before/after values for settings, accounts, payments, reservations and visits. API clients cannot edit this log. PIN values are excluded. A dedicated audit-view screen is not included in stage 1.

## Verification

- `node tests/role-enforcement.test.js` runs actual PostgreSQL policies, triggers and RPC wrappers using PGlite, including attempted direct API bypasses.
- `node tests/staff-auth-roles.test.js` verifies navigation, payment controls and rejection of unverified local sessions.
- `node tests/reservation-invoice-flow.test.js` verifies deposit invoice operations.
- `node tests/staff-branding.test.js` covers existing account rules.

No production data, Auth accounts, migrations or functions are deployed by editing this repository. Applying the SQL without the account migration and frontend/function rollout will prevent login; the prepare/enforce split exists to avoid that failure.

## Finance role addition

Apply `20260916_finance_role.sql`, redeploy `staff-account`, then deploy frontend.
Finance can use Dashboard, Reservations, Guests, Membership, Invoice and Vouchers.
It starts with Incoming/Waitlist bookings, with other filters available. Finance
can issue invoices and vouchers. Waivers require the optional per-account toggle
(also available to Staff). Bank/QRIS changes, settings, Walk-In writes, void/delete,
negative adjustments and standalone voucher redemption remain restricted.
