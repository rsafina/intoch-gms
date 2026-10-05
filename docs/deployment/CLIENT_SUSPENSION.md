# Client suspension rollout

Prepared on `feat/client-suspension`, starting from release. On 2026-10-05 the
user applied the migration to Djiwana and enabled suspension. They confirmed the
old iPad tab automatically reloaded into the expiration notice. The agent did not
execute live changes. Recheck current settings before acting on this dated handoff.

## Djiwana quick restoration

If the user asks to "turn Djiwana on again", this means restore app access:
**suspended = false**. There are two independent controls to restore.

1. In **Supabase > djiwana > SQL Editor**, run as the trusted database administrator:

   ```sql
   select app_private.set_client_suspended(false, 'Access renewed');
   select suspended, changed_at
   from app_private.client_access where singleton;
   ```

   Verify `suspended` is `false`. An empty result cell from the setter is expected:
   it returns void. The second SELECT confirms the state.

2. In **Cloudflare > Workers & Pages > intoch-gms-expired-access > Domains**,
   remove only the route **`djiwana.intoch.app/*`**. Keep the expiration Worker and
   its separate **`intoch.app/expired-access*`** notice route. Keep the original
   **`djiwana`** Worker's custom-domain binding **`djiwana.intoch.app`** intact.
   The original Worker's workers.dev/Preview URLs can remain disabled; their final
   toggle states were not independently verified in this conversation.
3. Open `https://djiwana.intoch.app` in a fresh/private tab and on the iPad. Confirm
   normal staff login and the intended guest links. No PIN reset or app rebuild is
   required for routine restoration. Verify current target settings before writes.

Do not reinstall the migration, rerun ALL_IN_ONE/roles_enforce, delete the original
Worker, move its domain, or change its production branch to restore service.
The expiration Worker uses GitHub branch `feat/access-expired-screen` and these
build settings (recorded during the successful user deployment):

- Repository root: `/`
- Build: `node scripts/access-expired/build.cjs`
- Deploy: `npx wrangler deploy scripts/access-expired/generated/worker.mjs --name intoch-gms-expired-access --compatibility-date 2026-10-05`
- PIC WhatsApp: `+62 813-2506-3362`, confirmed by user.

To suspend again later, attach `djiwana.intoch.app/*` to the expiration Worker
with Fail closed, close alternate application URLs, and run:

```sql
select app_private.set_client_suspended(true, 'Access expired');
select suspended, changed_at from app_private.client_access where singleton;
```

Verify `true` and the expiration page. Operational requests are blocked while
the existing visible staff monitor reloads; iPad background throttling may delay
that reload. Already displayed data/public image downloads cannot be withdrawn.
Future assistants should use the user's current authorization and verify the
target project; this historical record is not standing permission for live writes.

## Scope and prerequisites

One private control row per Supabase project: this suspends the entire project,
including restaurant Admin/Owner accounts and public guest RPCs. Verify Djiwana
has its own project before applying anything. A first installation defaults to
OFF; Djiwana was subsequently switched ON as recorded above.

Required: secured Phase 1, Finance and session migrations, session-aware role/waiver
helpers, RLS on application tables and storage.objects, and invoker-safe exposed
views. Never rerun ALL_IN_ONE or roles_enforce. Later migrations may supersede
these guards, so repeat the inventory after security-related upgrades.

## 1. Read-only inventory first

In the intended project's SQL editor, run
[`scripts/client-suspension-inventory.sql`](../../scripts/client-suspension-inventory.sql).
It makes no changes and selects schema metadata, policy/function definitions,
grants, Realtime publication membership and bucket visibility. It does not select
staff/customer data or credentials. Review definitions before sharing results:
unexpected custom functions could contain literals outside this repository's control.

The query returns one `suspension_inventory` JSON cell. Export the result as CSV
or copy the complete cell for review; a screenshot cannot show all definitions.
The single-result query was executed successfully in a minimal PGlite catalog.

Review all sections and verify:

- The correct project, current backup/recovery arrangements, migration prerequisites
  and current staff-account Edge Function version.
- Every exposed data-bearing RPC enters require_access, or an explicitly reviewed
  session-aware guard (waive_deposit uses app_can_waive_deposit). Check overloads,
  early returns, exposed schemas and extension functions. The migration's textual
  drift checks are deliberately conservative, but are not a security proof.
- Direct tables have RLS; views are invoker-safe. Existing anonymous policies and
  self-profile reads need the additional restrictive policy supplied here.
- app_private remains outside exposed API schemas and inaccessible to browser roles.
- Storage/public URLs and all configured Realtime channels are understood. Public
  bucket downloads, previously signed URLs, Broadcast/Presence and existing cached
  content are not revoked by this migration. Postgres Changes RLS must be checked
  on live subscriptions; do not promise that all Realtime streams immediately stop.

If inventory differs, stop and adapt/test the targeted migration. Do not remove
preflight checks merely to make it apply.

## 2. Local rehearsal

```powershell
$env:TZ = 'Asia/Jakarta'
node tests/client-suspension-sql.test.js
node tests/session-notification-lifecycle.test.js
node tests/session-spending-sql.test.js
```

PGlite uses real database roles/RLS and actual role/session/suspension migrations
against a minimal fixture. Public booking and invoice implementations are fixture
stubs behind the real role wrappers; these checks do not establish full production
schema, Auth, Storage or Realtime compatibility. Existing session-monitor tests
exercise the old frontend's invalid-session reload path.

## 3. Apply only after live inventory review and authorization

Apply [`20261005_client_suspension.sql`](../../migrations/20261005_client_suspension.sql)
as the trusted database administrator. Its transaction aborts on preflight failure.
The initial state is active. Rerunning preserves an existing suspended state.
Smoke-test normal staff roles, guest booking and token links before activation.
No frontend build is required if the loaded client already has the session monitor.

The private setter is not granted to anon, authenticated or service_role and must
not be exposed through a restaurant settings UI or Edge Function. Cloudflare's
expiration Worker remains an independent deployment.

## 4. Activate (separate authorized live action)

Keep the Djiwana Cloudflare expiration route active and alternate app hostnames
closed. In Djiwana's SQL editor as trusted database administrator:

```sql
select app_private.set_client_suspended(true, 'Access expired; contact Intoch PIC');
select suspended, changed_at from app_private.client_access where singleton;
```

Expected behaviour after commit:

- New staff and guest data requests are denied/filtered by the guarded functions
  and restrictive policies. Previously granted permissions are not widened.
- app_session_valid returns false. Existing current-release visible staff tabs
  poll about every 15 seconds, tear down their UI/channel state and reload into
  Cloudflare's expiration screen. A sleeping iPad checks on focus/visibility once
  execution/network resumes. Much older tabs might only show failed operations.
- SQL administration and established trusted service operations remain possible;
  this is not a project shutdown. Existing staff-account verifies session validity
  before invoking its service client, so it must be on the reviewed current version.
- No staff account, PIN, guest, visit or payment is deleted. Already-started requests
  may finish; already displayed/downloaded data cannot be withdrawn.

Use a controlled old session to verify blocked reads/writes and automatic reload,
plus anonymous booking/invoice attempts. Test private Storage and live Realtime
separately. Do not make test bookings/payments in real service without agreement.

## 5. Restore

```sql
select app_private.set_client_suspended(false, 'Access renewed');
select suspended, changed_at from app_private.client_access where singleton;
```

Remove the Djiwana expiration route when ready to reopen the website; test staff
login and guest flows. This toggle does not delete/recreate Auth sessions, change
per-account activation or undo PIN-reset cutoffs. Sessions still valid by the
original rules may become usable again. Users whose tabs reloaded may need to log in.

Use the toggle for routine restoration, not migration removal. Policy/function
rollback would require a separately reviewed restoration of the prior definitions.
Every setter call records its state/reason/time/database login in private history.
Supabase SQL editor connections may share a database login; this is not a personal
operator identity audit.

## Ongoing maintenance

New tables need the restrictive client_access_guard policy; new privileged RPCs
must use the common access guard. New non-public API schemas and alternative Edge
Functions require explicit coverage review. Pure invoice calculations are allowed
to remain callable; suspension is a data-access boundary, not a promise that every
Supabase endpoint returns an error.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[public Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).
