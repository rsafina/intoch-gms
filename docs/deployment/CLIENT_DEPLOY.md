# Client deployment

Current source-of-truth guide, audited 2026-09-14. No external dashboard settings were
verified during the handoff. Read [AGENTS.md](../../AGENTS.md) and
[CURRENT_STATE](../CURRENT_STATE.md) before a deployment.

## Model and environment boundaries

One private Intoch repo serves separately configured client deployments. Each restaurant
has its own Supabase project and Cloudflare static hosting project. A client subdomain or
custom domain gives separate browser storage/origin as well as separate database data.
Do not implement same-origin path-based clients or a shared database without a new decision.
Blue Heron's original repo is separate; it is not automatically migrated by Intoch changes.

Historical deployment notes describe `intoch-gms` serving `intoch.app` (landing),
`dashboard.intoch.app` (staff) and `reserve.intoch.app` (form), with host-based redirect
rules. They also describe a Djiwana trial deployment. These are historical mappings, not
verified live inventory. Domains, redirects, branch bindings, environment variables and
Supabase project IDs are configured externally. No checked-in Wrangler/Pages manifest or
fleet deployment registry establishes their current values.

Before any rollout, record/verify in the approved environment inventory:
client, branch, target commit, Cloudflare project/custom origin, Supabase project,
applied migrations and Edge Function version. Never put secrets in that record.

## Build and frontend deployment

1. Verify the target project and branch. `main` is development/integration; `release` is the
   intended controlled client promotion branch. A push can trigger any host watching that
   branch. Do not assume all clients rebuild from main or that release implies a particular DB.
2. Follow [migrations/README.md](../../migrations/README.md) for the appropriate fresh/upgrade path.
3. Configure Cloudflare **Build** variables, not only Runtime variables:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`, `RESTAURANT_NAME`.
   The first three are required by code; the name defaults to Restoran with a warning.
   Configure the real name for clients. `SITE_URL` is a bare HTTPS origin with no path.
4. Build command: `node build-config.js`. The source tree has no dist directory; the existing
   workflow serves the root's static assets. Confirm the host's upload exclusions before
   choosing its output directory. Do not assume Workers and Pages settings are interchangeable.
5. `.assetsignore` excludes docs, SQL, tooling, templates, server function source and secrets
   for the supported static-asset uploader. `.gitignore` is not a publishing firewall.
   Verify exclusions are honored by the selected host workflow; never upload the whole repo
   blindly. Do not publish service-role keys or private client files.
6. Bump affected script/style cache versions where used. Build regenerates config/guest pages.
   An environment-variable change requires a rebuild to reach served output.
7. Verify the deployment on its intended origin, including staff login and guest links.
   Confirm which preview hosts remain reachable and which database each preview uses.

Subdomain/custom-domain bindings belong to the hosting project, not application code.
Preserve unrelated DNS/email records. Historical redirects used 302 for reversibility;
confirm current routes before changing them. Never deploy demo credentials or a service key.

## Supabase and Edge Functions

The database must be prepared independently for **each Supabase project**. SQL does not run
because Git was merged. A frontend promotion must not outrun its required migrations.
Account management additionally needs a separately deployed `staff-account` function:

```
npx supabase functions deploy staff-account --no-verify-jwt --project-ref YOUR_PROJECT_REF
```

Use only after authorization and project verification. The endpoint validates bearer Auth,
active Admin role and session itself; `--no-verify-jwt` does not mean anonymous management.
Supabase URL/anon/service-role values belong in the function's server environment, not
Cloudflare public build values. See [ROLE_ROLLOUT](ROLE_ROLLOUT.md).

## Branch promotion

Do not push automatically. With a clean reviewed tree, fetch refs, compare changes, test,
and merge main into release for deliberate promotion. A release-first fix must also be
merged/cherry-picked back to main without duplicating migrations. Resolve conflicts based
on current implementation and security requirements, not by choosing a whole branch blindly.

A local remote-tracking ref is not a live deployment check. Confirm the deployed commit in
Cloudflare and the actual schema/function state in the matching Supabase project. If two
branches point at one DB, SQL is applied once to that DB; separate DBs each need the update.

## Costs and ownership

Commercial intent: separate client infrastructure, private source, owner-managed trials and
optional maintenance. Confirm current account ownership and provider terms for each client.
Old free-tier/pricing numbers are deliberately not repeated as present-day guarantees.
