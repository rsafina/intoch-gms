# One-hour private playground demo

Implemented on `feature/demo-guided-tour`. As of 2026-10-11, demo SQL and its
targeted Auth-bridge upgrade, API schema exposure, both Edge Functions, server
cleanup/rate secrets and Vault/Cron cleanup are installed in playground
`hkrhsubhfqrgqkuhpvql`. Live role/isolation/expiry/cleanup transaction checks passed
and rolled back all test records. Frontend overrides are published, anonymous
Auth/CAPTCHA are enabled, and the user verified both the live demo countdown and
normal staff login. Main's landing page and CTA remain unchanged.

## Behavior and architecture

The feature branch's **Coba Intoch Sekarang** opens
`https://demo.intoch.app/?demo=1`; the main landing CTA is not published yet.
Separate anonymous Supabase Auth receives a private fictional restaurant. Its
server deadline is exactly 60 minutes after seeding. Refresh, JWT renewal and
guide replay never extend it. Exit and expiry hide the app and offer a fresh
session or Admin Login. Dashboard, Reservations, Walk-ins and Reports are the
only pages, with optional Operations and Reports guides. Staff accounts, payment
issuance, membership writes, uploads and WhatsApp sending are unavailable.
Existing username/PIN Auth and its browser storage remain separate. The old
shared demo account is not deactivated by this implementation.

`intoch_demo` is a separate schema in the same playground. The additive migration
copies installed operational tables without records and copies their rules.
Workspace RLS, composite foreign keys and scoped unique constraints isolate
visitors. Copied definer functions use a NOLOGIN/NOBYPASSRLS executor which does
not own tables. Browser grants allow core reads, guest/reservation/visit writes
and an explicit operational RPC allowlist. Original public records, policies
and functions remain intact. Never expose `demo_private` through the Data API.
This is a reviewed snapshot: future public business-rule migrations need targeted
demo upgrades and isolation tests. Review playground-specific triggers/functions;
unknown external hooks fail migration preflight.

Provisioning verifies anonymous users, actual Auth sessions and no staff link.
Two single-use Turnstile checks protect signup and provisioning. Retrying the
same active identity is idempotent. Limits are ten attempts/IP hash/hour, 500
active workspaces, and per-workspace 500 guests/1,000 reservations/2,000 visits
with bounded payloads. Cleanup batches 20 expired/ended workspaces, cascades
their records and retries queued anonymous Auth deletions. Tagged signup orphans
older than two hours are eligible; permanent users and linked staff are protected.
Uploads are disabled. Expiry rejects subsequent access; already downloaded data
and exports cannot be recalled.

## Installation order: approved playground only

For assisted installation, put a Supabase management token in the ignored local
`.env.demo-rollout` as `SUPABASE_ACCESS_TOKEN`. A Cloudflare token with Turnstile
edit access can be configured there as `CLOUDFLARE_API_TOKEN`; never paste either
into chat or frontend variables. `node scripts/demo-session-install.mjs --plan`
makes no requests. Without flags the installer performs read-only management
preflight; `--apply` installs missing additive database phases against the pinned
playground only. It refuses other branches, ignores the stale CLI link and checks
the original public staff policy fingerprint. It does not enable Auth/CAPTCHA,
expose API schemas or deploy Edge functions. API access still needs verification
and the remaining steps below.

1. Verify the dashboard project is `hkrhsubhfqrgqkuhpvql`. The local CLI link
   points to a different project: do not use it or unqualified CLI commands.
   Obtain management/database access to the playground and verify installed
   role, arrival and spending migrations.
2. Review/run `20261011_demo_sessions.sql`, then
   `20261011_demo_lifecycle.sql`. In the same SQL connection set
   `set intoch.demo_project_ref = 'hkrhsubhfqrgqkuhpvql';` before each migration.
   These refuse an existing installation. Never rerun `ALL_IN_ONE.sql` or
   `20260911_roles_enforce.sql` on a secured project.
   If isolation predates the Auth identity bridges, run the targeted
   `20261011_demo_auth_bridges.sql` with the same project marker. Fresh isolation
   already includes those bridges. They expose only the current verified JWT
   identity to copied functions, without Auth table privileges. Supabase may
   retain a platform-created postgres admin membership in the executor role;
   explicit ownership/upgrade grants are revoked on commit.
3. Add `intoch_demo` to API exposed schemas, retaining existing schemas;
   keep `demo_private` unexposed. Verify grants/RLS using real Auth identities.
4. Configure Turnstile for the published demo hostname. Publish the staff-login
   CAPTCHA compatibility code and public widget key before enabling global Auth
   CAPTCHA, since it also protects password sign-in. Verify Admin login.
   Enable anonymous
   Supabase Auth with CAPTCHA protection and the matching secret in Auth.
   Build variable `DEMO_TURNSTILE_SITE_KEY` contains only the public widget key.
   The controller requests separate tokens with action `intoch-demo`.
5. Set server-only Edge secrets `DEMO_TURNSTILE_SECRET_KEY`,
   `DEMO_RATE_LIMIT_SALT` and an independent random `DEMO_CLEANUP_SECRET`.
   Supabase supplies server-only project URL/service-role variables. Deploy
   `demo-start` and `demo-cleanup` explicitly with
   `--project-ref hkrhsubhfqrgqkuhpvql`. Their `verify_jwt=false` is intentional:
   start verifies user/JWT claims itself; cleanup verifies a maintenance secret.
6. Enable playground pg_cron, pg_net and Vault. Store the cleanup secret in
   Vault as `intoch_demo_cleanup_token`. Review/run
   `20261011_demo_cleanup_schedule.sql` with the same project marker.
   It calls the pinned endpoint every minute; inspect failures and backlog.
   Access expiry does not depend on successful cleanup.
7. Build with the real playground public configuration/widget key and publish
   reviewed demo/landing artifacts. Never replace local generated config with
   dummy values. `.assetsignore` excludes SQL, docs, tooling and server source.

Latest readiness on 2026-10-11: demo schema/status RPC are present, anonymous
Auth and Turnstile CAPTCHA are enabled, and unauthenticated row access is blocked.
Live signup/password requests without CAPTCHA return `captcha_failed`. The user
confirmed demo Dashboard/countdown and normal staff login. Local generated
configuration was not overwritten; public artifacts were built separately.

## Published frontend and maintenance

Worker `intoch-playground-access` intercepts exactly `demo.intoch.app/*` and
`dashboard.intoch.app/*`. It embeds reviewed public frontend files, including
the public widget key, with no server secrets. Service bindings `DEMO_ORIGIN`
and `STAFF_ORIGIN` fall back to `demo-intoch` and `intoch-gms` respectively for
unchanged assets. Dashboard overrides retain its original app and add only
staff-login CAPTCHA support. The shared `intoch-gms` worker also serves main
landing/reservation hosts; do not publish this feature branch wholesale there.
Main landing, landing route and reservation root hashes were unchanged after
rollout. Existing static assets remain available.

The router was required because existing Cloudflare static assets took precedence
over uploaded Worker code when preserving assets. A normal build of the origin
Workers will not replace embedded router files. Before a later deployment, update
the router snapshot, or publish equivalent compatible assets to the origins and
then remove its two host routes. Keep CAPTCHA-compatible staff login available
while playground Auth CAPTCHA is enabled. The deployed Worker source is retrievable
from Cloudflare; local operational artifacts/source are in the ignored
`.impeccable/demo-rollout/` directory. Credentials remain in ignored local/server
storage. Main CTA publication remains a separate follow-up.

## Acceptance checks

`node scripts/demo-session-readiness.mjs` performs a pinned, read-only check,
without signup, writes or key output. After rollout, use two browser profiles
to verify separate seeded data, edits, reports and tables, including direct
requests for the other workspace's IDs. Exercise saves, arrival, spending and
completion through the real API; ensure account/admin/payment RPCs deny demo
users. Recheck ordinary Admin login and public staff data are unaffected.
Refresh/reopening must preserve expiry; replay must not extend it. Expired
reads/writes/RPCs must fail; fresh sessions must be isolated. Verify cleanup
retains permanent users and recovers from Auth deletion failures. Confirm the
gateway's forwarded IP header is trustworthy before relying on IP limits;
monitor signup abuse and configure platform rate limits.

Local checks: `npm test`, `tests/demo-session*.test.js`, `node --check`,
`git diff --check`. The SQL fixture installs the actual migration chain into
disposable PGlite only and exercises authenticated roles/RLS. This cannot prove
live Supabase Auth/API/extensions or Deno execution. Run
`node scripts/demo-session-preview.cjs` then
`node scripts/check-demo-session-browser.cjs` for actual UI/controller checks at
1440/393/320 pixels using a fake backend. Screenshots are ignored under
`.impeccable/demo-session`; this fixture is not a deployed demo.
