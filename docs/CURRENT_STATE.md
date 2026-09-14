# Current state and operational handoff

Audited 2026-09-14. This file replaces conversation history as the task handoff.
Implementation claims were checked against code, migrations, Git and existing tests/docs.
No live Supabase/Cloudflare inspection, migration, deployment or push was performed for this
documentation task. **Committed code is not proof of deployed SQL or Edge Functions.**

## Repository snapshot

- Working branch: `main`, HEAD `d89252c`; local `origin/main` points to the same commit.
- Local `release` and `origin/release`: `d99d3dc`. No fetch was performed, so these are local
  refs, not proof of the remote's current state. Main has subsequent work not on local release.
- Tree was clean at handoff start. The prior implementation and manual/screenshot edits
  are committed, not outstanding local work. Only handoff documentation is being edited now.
- `d89252c`: session/spending/notification changes plus manual tooling/screenshots.
- `5969782`: loading/skeleton lifecycle separation and reservation cosmetics.
- `4728667`: visible pax in the amount-quotation section; `428c043`/`b0d978f`: action-link cosmetics.

When reopening this task, re-run `git status --short --branch`, inspect HEAD and any diff.
Do not assume the branch/ref snapshot above is still current. Do not merge/push automatically.

Handoff working diff: five new documents (`AGENTS.md`, and docs/ARCHITECTURE,
DECISIONS, CURRENT_STATE, DEVELOPMENT_RULES) plus updates to root README/CLAUDE/ARCHITECTURE,
CLIENT_DEPLOY, ROLE_ROLLOUT, the five historical feature specs/scope documents,
migrations/README, demo/README and docs/SESSION_SPENDING_ROLLOUT. No runtime, SQL,
configuration or manual assets were changed. Remove this transient diff description once
the handoff is committed and replace it with the resulting commit when known.

## Implemented in current code

Dashboard reservation filters (local): the redundant Needs attention tab is hidden; Deposit
queue and All upcoming remain available. No deployment performed.

Three-month demo seed handoff (2026-09-14): reused the existing
`demo/01_seed_3_months.sql` (120 guests, 287 historical visits, linked completed
reservations and 24 memberships). Clarified empty-demo execution and rolling
Jakarta dates in demo/README; removed unsafe seed advice to rerun ALL_IN_ONE on
secured databases. No live seed, reset or schema change performed. Verification:
existing demo SQL static checks only; live schema compatibility remains unverified.

Mobile management navigation: both Overview and Reservation Outlook hide the sidebar
at widths up to 640px and show only Overview/Outlook bottom navigation. Desktop navigation
and role permissions are unchanged. Frontend-only change; no deployment performed.

Dashboard legacy-schema compatibility fix (local): user-provided live response confirmed
`42703: column visits.spend_recording_status does not exist`. Overview and financial-history
reads now retry without that optional column only for this specific error. Null spending
remains unknown; recorded zero remains recorded. Other schema/RLS/network failures still
fail visibly. Financial Tracking write workflows still require their existing migration.
No live SQL, push or deployment performed for this fix. Targeted dashboard tests cover
legacy reads, unchanged totals and refusal to mask unrelated errors.

Management dashboard and Reservation Outlook (local, not deployed): Owner/Admin/Manager
now share the management overview; Admin/Manager retain Staff Dashboard. Today KPIs
and a fixed seven-day visit-pax chart separate attendance from booked demand. Guest Load
does not claim live occupancy. Deposit widgets obey Deposit Tracking; Revenue stays
visible when spending is disabled, with recorded/skipped/unknown coverage when enabled.
Reports > Operations offers on-demand historical spending/deposit totals even with tracking
disabled. Outlook includes Today/+1/+2 and all future large parties; Settings > Thresholds
stores a separate management threshold (default 8 pax). No new SQL/Edge Function changes.
Targeted jsdom/PGlite/role/loading/realtime checks passed, plus desktop/mobile synthetic
visual checks; no full-suite or live-client verification. See [full handoff and metric
definitions](MANAGEMENT_DASHBOARD.md). Existing financial/arrival migration prerequisites
still apply before deploying current frontend. Nothing pushed, committed or deployed.

Duplicate-arrival repair (local, not deployed): repeated Arrived actions previously inserted
another visit. The reported pair had NULL spending/notes and zero membership transactions.
`scripts/repair_duplicate_reservation_visit.sql` is a guarded, incident-specific manual repair:
keep the earlier visit, soft-void the later one only if the reviewed conditions still hold.
It is not a fleet migration. Then apply `20260920_reservation_arrival.sql` and deploy frontend.
The migration refuses unresolved duplicates, adds one non-voided visit per reservation, and
provides an atomic/retry-safe `record_reservation_arrival` RPC. Completion ignores voided
rows and reports unresolved duplicates instead of treating a failed lookup as no arrival.
Tests: reservation-arrival covers repair refusal, idempotence, role gates, uniqueness,
transaction rollback and completion lookup; existing DP include/exclude tests still pass.
Unrelated local Financial Tracking panel/test edits were preserved.

Financial Tracking settings independently control deposit and spending workflows. Both default enabled for existing clients. The forward migration `20260919_financial_tracking.sql` preserves historical data and distinguishes explicit zero from intentionally skipped spending. It has not been applied to or deployed on any live project by this repository change.

Core reservation, guest, walk-in, invoice, membership/voucher and report flows exist. Phase 1
Auth/RLS and Phase 2 responsive Owner/Admin summary are implemented, as are Finance role,
per-account Staff/Finance waiver permission, area/pax deposit policy, staff-created deposit
requests, simple/detailed invoices, reserved-only tickets, timed table availability,
daily/weekly/monthly/custom reservation ranges, compact occupancy and ten active campaigns.
See [ARCHITECTURE](ARCHITECTURE.md) for exact behavior and source locations.

| Backlog item | Current implementation | Remaining verification |
|---|---|---|
| 1. Deactivated staff loses open-app access | `staff-auth.js` monitor validates every 15s while visible, on focus/reconnect/Auth events; invalid session reloads. DB helper rejects inactive accounts. | Two-browser live deactivation test; network/background throttling means screen removal is not literally instantaneous. |
| 2. PIN reset terminates old access | `20260917_session_notifications.sql`, `staff-account`: pending lock, session creation cutoff, service-only finalization. Refreshing an old token cannot restore operational role. | Confirm migration AND Edge Function deployment per project. Exercise reset failure and recovery; do not test against real staff casually. |
| 3. Include/exclude deposit spending | `save_visit_spending` in `20260918_spending_deposit_choice.sql`, completion/history UI. Checked final input; unchecked input plus net deposit only; saved snapshot, no historical backfill. | Live linked reservation, walk-in, Finance, refund/waiver and loyalty regression after SQL/frontend rollout. |
| 4. Delayed notification | `notify.js` has recovery events, diagnostics, stale-response rejection and pagination beyond 150 records. Polling and realtime remain independent fallback mechanisms. | Original intermittent delay was not reproduced conclusively. Capture channel state, errors, tab lifecycle, account transitions and timestamps when it recurs. |
| 5. Checklist intermittent error during account/PIN testing | Defensive RPC save, verified actor, explicit success check, duplicate-click guard, stale-session protection and checkbox restoration on error. | **Investigation/regression remains open.** The historical error was not later reproducible; do not claim the defensive changes identify or conclusively fix it. |
| 6. Loading flicker | `5969782` separates initial cover from route spinner/skeleton; loading tests adjusted. | Committed separate frontend work, not an unimplemented request. Live slow-network/back-forward/relogin checks still needed; do not redesign without reproducing. |

## Rollout outstanding or unverified

The previous implementation session did not run the new SQL or deploy anything. The changes
have since been committed, but no per-project deployment evidence is available here.
For projects already through Finance, verify/apply `20260917_session_notifications.sql`,
then `20260918_spending_deposit_choice.sql`, redeploy current `staff-account`, then build and
deploy frontend. See [SESSION_SPENDING_ROLLOUT](SESSION_SPENDING_ROLLOUT.md).

Earlier conversation reported Phase 1/2 and Finance working on environments, but that is
historical user feedback, not a schema audit of every client. There is no checked-in applied
migration ledger or verified mapping of branch -> Cloudflare project -> Supabase project.
Do not decide which SQL to run from a commit title alone. Fresh-client bootstrap is separate:
[migration guide](../migrations/README.md).

## Test evidence and limitations

The preceding implementation run passed targeted session/spending SQL (including reruns,
Finance walk-in restriction, refund/waiver and snapshot behavior), session/notification
lifecycle/pagination, 33 completion checks, account endpoint, role restoration/enforcement,
membership/reports, payment/settlement, realtime lifecycle, page loading/loading sequence,
26 notification classification checks, JS syntax and diff whitespace checks.
These are local mocks/jsdom/PGlite, not live Supabase Auth/Storage/Realtime verification.
The loading test emitted JSDOM's unsupported `location.reload` warning but completed.
The documentation task did not rerun the complete application suite.

Known failures from that run, also reproduced against the then-unchanged HEAD:

- `tests/finance-role.test.js` reads `.non-finance-ui`, absent from the DOM. Its later source
  extraction also expects an older initializer signature. Treat as stale harness work, not
  proof Finance authorization is broken.
- `tests/deposit-staff-app.test.js` cannot find `lp-deposit-format` in index/app; the element
  is generated by `depositFormatSelect()` in `js/deposit-policy.js`, so the test's file scope
  is incomplete. It also reports two missing translations and generated-config mismatch.
  The missing template translations are real: “Could not record the request” and the saved
  deposit-rule-after-acceptance notice. Build regenerates config; never hand-edit it to pass.
- Older context reports `js/invoice.i18n.test.js` footer-wording mismatch and
  `js/vouchers.test.js` null-voucher crash. Not rerun during this handoff; verify before
  treating them as current failures or changing expected behavior.

`npm test` discovers all tests and continues after failures, but has no per-test timeout;
a hung harness can stall the run. Historical “13 suites” and “stops on first crash” claims
were stale. Source-pattern tests can pass vacuously or fail after file extraction; behavioral
tests should cover actual outcomes, especially for permissions and financial writes.

## Remaining backlog and technical debt

Verified or still relevant:

- Campaign promo origin still uses `your-site.example` in `campaign-editor.js`, `campaign.js`
  and `broadcast.js`. No deployed Cloudflare promo renderer exists in this repo; the Netlify
  reference is not wired. Treat promo links as unfinished even though campaigns themselves work.
- URL/history routing is not implemented. `app.js` and index remain large/global with inline
  handlers; gradual extraction is future work, not permission for a broad refactor.
- `guard_last_admin()` and `sync_live_table_assignment()` lack explicit named coverage in
  the checked test tree. Earlier context flagged their RLS interactions. This is a test gap,
  not a verified current production defect.
- Audit remaining direct writes for successful returned rows, especially settings/table paths.
  Do not “fix” RLS errors with broad grants. Earlier save failures arose from private helper
  EXECUTE/default/trigger access, now addressed by the 20260912 role follow-ups.
- Four-digit PIN entropy remains limited. No public signup/email recovery for internal Auth
  identities should be enabled. Server Auth settings/rate limits were not inspected here.
- Pending PIN reset can leave an account locked if finalization fails. Recovery is service-only;
  inspect logs/password outcome before clearing it. No automatic recovery screen exists.
- No fleet migration runner, audit-view screen, multi-branch UI or automated WhatsApp image
  delivery is established by this implementation. Historical pricing/quotas are not current facts.
- Loading/notification reliability needs real browser/session evidence, especially sleep/wake,
  offline/reconnect and account changes. Local DEV mode skips polling/realtime.
- Historical concerns about guest-query egress, repeated translations and remaining branding
  literals require a scoped recheck before fixes; do not assume every old complaint persists.

## Documentation/deployment inconsistencies found

- Old README/client deployment instructions said RLS was off and PINs plaintext; corrected.
- Old architecture omitted Finance, current deposit choices/session invalidation and described
  an eight-step bootstrap; replaced by the current architecture and central migration guide.
- Old instructions suggested ALL_IN_ONE for already-secured demo/feature updates; corrected
  or clearly labeled historical. Do not replay dated SQL merely in filename order.
- `build-config.js` still has a **stale explanatory comment** saying RLS is not yet enabled.
  The code implements build substitution and key checks; the comment is not security truth.
  No runtime file was changed in this documentation task.
- `.assetsignore` targets the static-asset upload workflow; no checked-in Wrangler/Pages
  manifest proves the external host honors it. Confirm upload settings before publishing.
- Deployment claims/domain mappings in older client notes were historical. No cloud access
  was used to verify domains, connected branches, databases or applied SQL during this task.

## Recommended next threads

1. **Release/deployment verification:** inspect target project mapping and migration state,
   apply only missing approved updates, then run live role/session/spending smoke checks.
2. **Notification regression:** capture the intermittent issue with diagnostics; include
   checklist errors and account switching. Keep “cause unknown” until evidence establishes it.
3. **Test maintenance:** repair stale harness references, resolve footer/voucher findings,
   add the two trigger tests and establish a trustworthy suite baseline.
4. **Promo links:** choose/deploy the server-rendered link path and correct per-client origin.
5. **Frontend loading/routing:** reproduce remaining flicker, then scope independent routing
   or extraction work rather than mixing it into auth/financial changes.

Start a fresh thread with: “Read AGENTS.md and the project docs first. Inspect the current
repository state. We are continuing [TASK].” No retired-chat access should be necessary.
