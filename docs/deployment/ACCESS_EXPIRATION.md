# Djiwana access expiration

Prepared locally on 2026-10-05. User confirmed whole-site coverage and PIC WhatsApp
`+62 813-2506-3362`. No live Cloudflare or Supabase change has been made.

## Build and preview

From the repository root:

```powershell
node scripts/access-expired/build.cjs
node tests/access-expired-worker.test.js
node --check scripts/access-expired/generated/worker.mjs
```

`access-expired.html` is the editable screen. The builder embeds its logo into
`scripts/access-expired/generated/worker.mjs`, so the replacement works on every
path without fetching assets from the suspended website. This generated ES module
can be pasted directly into Cloudflare's Worker editor. Do not edit the generated
file; regenerate it after changes. The whole `scripts` directory is excluded from
the application's static upload by `.assetsignore`.

The Worker returns HTTP 403 with `Cache-Control: no-store` and noindex headers.
Every method/path is blocked; HEAD has no response body. It never calls the
original app or Supabase. The WhatsApp link only opens a draft; sending is manual.

## Deploy the separate Worker (does not activate suspension)

Perform these external actions only when authorized:

1. In the Cloudflare account containing `djiwana`, open Workers & Pages and create
   a new Worker named `intoch-access-expired`. Do not replace `djiwana`.
2. Open its code editor, replace the starter code with the complete generated
   `worker.mjs`, and deploy. No assets, secrets, database bindings or build variables
   are needed. Do not attach a domain or route yet.
3. Visit the new Worker's own workers.dev URL. Expect the designed screen with a
   visible logo, the confirmed PIC link and an HTTP 403 response. Check a nested
   URL as well. A 403 is intentional; judge the rendered page as well as the status.

## Activate whole-site suspension

Attaching the route is the live switch. Verify the existing custom-domain binding
and record current Worker URL/preview settings before proceeding.

1. Inspect the `intoch.app` zone's Worker routes and redirects for conflicts:
   more-specific routes (including routes with no Worker) or redirects to another
   hostname can escape this catch-all. Resolve only Djiwana-specific conflicts.
2. On **intoch-access-expired**, open Domains (or Settings > Domains & Routes),
   choose **Add Route**, select zone `intoch.app`, and set the pattern exactly to
   `djiwana.intoch.app/*`. Select **Fail closed / block** if offered; fail-open
   behaviour could expose the original website when Worker limits are exceeded.
   Do not add a Custom Domain or remove the existing `djiwana` custom domain.
3. On the **original djiwana Worker**, disable both Production workers.dev and
   Preview URLs shown in the Domains screen. Mirror `workers_dev: false` and
   `preview_urls: false` in its actual deployment configuration if managed by
   Wrangler. That live configuration is not checked into this repository.
4. Check fresh/incognito visits to the homepage, staff entry, reservation page,
   invoice/voucher links and nested paths. Confirm 403 + expiration page, including
   the logo. Confirm original production and known old preview URLs cannot serve
   the app. Inventory any additional custom hostnames before declaring coverage.
5. Verify unrelated Intoch/client hostnames still behave normally. Check applicable
   Cloudflare cache rules if results differ; do not apply broad zone-wide changes.

The pattern includes HTTP and HTTPS for this hostname and all paths. Routes take
precedence over Workers Custom Domains. No shared source branch needs to be
pushed, and no app rebuild is needed for this dashboard-based route workflow.

## Restore access

1. Remove only the `djiwana.intoch.app/*` route attached to
   `intoch-access-expired`. Preserve the original custom-domain binding.
2. Verify the original homepage, staff login and guest links in a fresh browser.
   Restore any other Djiwana-specific route changes from the recorded settings.
3. Alternate workers.dev/preview URLs can remain disabled; the custom domain does
   not need them. Restore them only if explicitly wanted.

## Boundary

This is a website suspension, not backend authorization enforcement. Already-open
or cached app pages can still call Supabase directly; other client hostnames may
also remain reachable. No sessions are revoked and no records are deleted.
Complete backend suspension requires separately scoped Supabase work.

## Cloudflare references

- [Routes and precedence](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Maintenance page approach](https://developers.cloudflare.com/fundamentals/performance/maintenance-mode/)
- [Production workers.dev settings](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Previews](https://developers.cloudflare.com/workers/previews/)
- [Limits and fail mode](https://developers.cloudflare.com/workers/platform/limits/)
