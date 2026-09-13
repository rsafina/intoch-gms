# Intoch: start here

Intoch is a restaurant guest-management product: reservations, walk-ins, deposits,
invoices, membership, vouchers, reports and WhatsApp follow-up. One private codebase
serves separate client deployments, each with its own Supabase project and configuration.

## Read before changing code

1. [Current state](docs/CURRENT_STATE.md): branch snapshot, shipped-code versus deployment
   uncertainty, backlog, test limitations and pending rollout.
2. [Architecture](docs/ARCHITECTURE.md): implemented systems and file map.
3. [Decisions](docs/DECISIONS.md) and [development rules](docs/DEVELOPMENT_RULES.md).
4. For database/auth/build work: [migration guide](migrations/README.md),
   [role rollout](docs/deployment/ROLE_ROLLOUT.md), [client deployment](docs/deployment/CLIENT_DEPLOY.md).

Then inspect `git status`, the actual files and relevant tests. Documentation describes
the repository, not proof of a client's deployment. User instructions take precedence;
continue authorized work without asking for permission again. Ask about unresolved business
rules or destructive/external actions, not routine reversible implementation choices.

## Stack and file map

- Vanilla HTML/JavaScript, global functions and inline handlers; no SPA framework/bundler.
- `index.html` staff pages/modals; `js/app.js` core operations; `css/` feature styling.
- `js/config.template.js` config, translations, role UI; `js/staff-auth.js` Auth sessions.
- Feature modules in `js/`: membership, invoices, vouchers, WhatsApp/campaigns,
  notifications, owner summary, page loading. See architecture for the full map.
- Supabase Postgres/Auth/Storage/Realtime; SQL in `migrations/`.
- `supabase/functions/staff-account/index.ts`: Deno account/PIN management endpoint.
- `build-config.js` generates client-specific public files; Cloudflare hosts static assets.
- `tests/` and `js/*.test.js`: Node, vm/jsdom and PGlite; `demo/`: destructive demo tooling.
- `docs/manual/` and `docs/screens/`: user-manual tooling/assets, not runtime app code.

## Mandatory safeguards

- Preserve username/PIN Supabase Auth, active verified DB roles, RLS and protected RPCs.
  Frontend/localStorage role labels are not authorization. Never restore anonymous full
  access, store plaintext staff PINs, or grant broad privileges to bypass a failed save.
- Never expose service-role keys, PINs, passwords or private configuration in code, logs,
  documentation, build variables or browser assets. Public anon/publishable keys are public
  by design; RLS is the boundary. Account management uses `staff-account`.
- **Never rerun `ALL_IN_ONE.sql` or `20260911_roles_enforce.sql` on a secured database.**
  Fresh bootstrap and existing-client upgrades are different. Use targeted migrations,
  preserving `app_private` implementations/wrappers and pinned SECURITY DEFINER search paths.
  Do not casually reformat functions patched by later migrations through exact-text matching.
- Do not run live SQL, deploy, push, wipe demo data or change production configuration unless
  authorized for that action/environment. SQL applies per Supabase project, not per branch.
- Never edit generated `js/config.js` or generated guest HTML as source. Edit templates;
  do not rebuild with dummy values over someone's working client configuration.
- Check `.gitignore` and `.assetsignore`; they serve different purposes. Do not publish
  docs, SQL, tooling, Edge Function source or secrets as static website assets.
- Preserve unrelated local edits. Prefer focused patches; respect LF normalization and
  inspect the diff for accidental whole-file rewrites. Do not commit/push automatically.
- Use `ymd()` for local calendar dates, keep `t()` unshadowed, exclude voided visits from
  metrics, and require a real visit before recording a completed reservation.
- Confirm writes via returned rows/RPC success. Tear down realtime channels/listeners on
  logout; discard in-flight results from an old session. Preserve explicit deposit snapshots.

## Verification and handoff

Run tests relevant to the changed behavior; for DB permissions, exercise SQL/RLS as actual
roles using the PGlite harnesses. `npm test` discovers both test directories and sets
`TZ=Asia/Jakarta`; direct date tests need that timezone. Check `node --check` and
`git diff --check`. UI changes need suitable visual verification, including mobile where
relevant. Mocks/PGlite cannot prove live Auth, Storage, Realtime or deployment settings.

Read known failures in CURRENT_STATE before claiming a green suite. Never weaken tests to
hide a failure. Update CURRENT_STATE for completed work and deployment obligations; update
DECISIONS only for material decisions. Explain changes, verification and remaining limits.
