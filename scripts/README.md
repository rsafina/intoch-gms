# Repository tools

Run commands from the repository root. These files support development and operations;
they are excluded from website uploads by `.assetsignore`.

| File | Purpose and boundaries |
|---|---|
| `run-tests.js` | `npm test` runs both test directories with Jakarta timezone. On PowerShell with blocked npm.ps1, use `npm.cmd test`. Existing failures are recorded in docs/CURRENT_STATE.md. |
| `demo-regression/` | Opt-in deployed-demo access checks, fixed to the approved demo project and blocked on release. See docs/DEMO_REGRESSION.md. Not part of the offline test discovery. |
| `schema-refs.js` | Static extraction of database references from application source; used by the schema checker. |
| `schema-dump.sql` | Read-only database catalog query; run only against an identified project when authorized. |
| `schema-check.js` | `node scripts/schema-check.js <catalog.json>` compares a saved catalog with source references. Does not prove RLS, data types or successful workflows. Follow migrations/README.md for setup. |
| `capture-management-preview.cjs` | Synthetic management UI screenshots using local Chrome; writes docs/screens/management. No backend connection. |
| `capture-manual-screens.mjs` | Playwright manual screenshot utility, not a regression suite. Review its environment/account and interaction instructions before running against any site. Playwright is not in package.json. |
| `migrate-staff-auth.mjs` | Privileged initial Auth-account linking. Requires explicit environment authorization and the migration guide; never run as routine housekeeping. |
| `repair_duplicate_reservation_visit.sql` | Incident-specific guarded data repair. Not a general migration or test fixture; do not reuse its incident IDs elsewhere. |

Manual generators live in `docs/manual/`. Demo seed/reset SQL lives in `demo/` and must
never be run against a live client as part of testing. Database migrations remain in
their documented locations and order.
