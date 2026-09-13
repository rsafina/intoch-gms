# Intoch

Restaurant guest management: reservations, walk-ins, deposits/invoices, membership,
vouchers, WhatsApp follow-up and reports. One codebase, isolated deployment per client.

**Agents: read [AGENTS.md](AGENTS.md) first.**

- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Current state/backlog](docs/CURRENT_STATE.md)
- [Development rules](docs/DEVELOPMENT_RULES.md)
- [Client deployment](docs/deployment/CLIENT_DEPLOY.md) and [database migration sequence](migrations/README.md)

## Local development

Vanilla HTML/JS with Supabase and generated per-client configuration. Install dependencies
with `npm install`. Use your own approved development Supabase project, bootstrapped using
the migration guide. Do not use a production database for demo resets or tests.

Set these environment variables in your shell or approved local setup (never commit values):

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Target project's HTTPS URL |
| `SUPABASE_ANON_KEY` | Public anon/publishable key, never service-role |
| `SITE_URL` | Bare HTTPS public origin for absolute share links |
| `RESTAURANT_NAME` | Client name; optional in code, configure for real clients |

Run `node build-config.js`, then serve over HTTP, for example
`python -m http.server 8080`. Open `http://localhost:8080`.
Generated files are ignored; edit templates, not generated copies. Do not overwrite an
existing local client build with dummy values. Localhost/127.0.0.1 activate DEV behavior,
which skips realtime/polling/auto-refresh and cannot prove live notification behavior.

## Security and deployment

Phase 1 Supabase Auth/RLS is implemented. Staff retain username/PIN login with linked Auth
identities; verified active roles enforce access in PostgreSQL. PINs must not return to
plaintext storage. Phase 2 provides a responsive Owner/Admin summary. Finance and per-user
waiver permissions are implemented. Deployment status is tracked separately from code.

Cloudflare runs `node build-config.js` using per-project **Build** variables and serves the
static output. Database and Edge Function deployments are separate from a Git push.
`.gitignore` controls Git; `.assetsignore` controls the supported static upload workflow.
See CLIENT_DEPLOY before configuring branches or promoting a release.

## Tests

`npm test` discovers `js/*.test.js` and `tests/*.test.js`, setting `TZ=Asia/Jakarta`.
Tests use Node/vm, jsdom and PGlite. Run focused suites for changed behavior; read known
failures in CURRENT_STATE before claiming a clean baseline. The runner continues after
failures but has no per-suite timeout. No test run proves an external deployment is current.

## Historical specifications

Root `*_SPEC.md` and deposit scope/phase documents preserve design discussions. Their
pre-Auth security assumptions and old migration instructions are explicitly superseded.
Current architecture/decisions and actual code take priority. `reference/` is not runtime.
