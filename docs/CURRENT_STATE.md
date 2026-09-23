# Current state and operational handoff

Demo link routing fix (2026-09-23; local on `demo`, pending deployment): live requests
to `/demo/campaign` returned HTTP 307 with `Location: /demo-library`, losing the category.
The `.html` rewrite target triggered Cloudflare HTML canonicalization. Changed `_redirects`
to target `/demo-library` (extensionless). The preview now reads the actual rewrite file
and models the observed canonical redirect; regression checks inspect unfollowed responses
for all nine category paths and trailing slashes. Earlier final-200 checks missed this bug.
No commit, push or deployment performed for this fix; redeploy `demo-intoch` after publishing
the change, then verify both the initial response and the category displayed in the browser.

IntoCh Demo Library (2026-09-23; local on `demo`): all nine `/demo/*` sales stories
are implemented with one standalone configuration-driven player, shared fictional Senja
data and reusable UI scenes. Landing tokens and product-story styles were extracted
verbatim into shared CSS, preserving cascade order and existing landing behavior.
No app/Auth/config modules, database calls or storage are used. Follow-up is scoped to
the existing reservation checklist; campaigns retain explicit staff WhatsApp sending.
The private `demo/` tooling remains excluded from assets. `_redirects` routes public
stories to a separate shell; actual host rewrite/exclusion behavior still needs deployment
verification. Shared generic Open Graph metadata is a future route-specific refinement.
All 91 suites passed; isolated seven-output build, syntax/diff checks and local Chrome
direct-route/refresh/mobile checks passed. Screenshots inspected at desktop and 390px;
overflow checked at 1440/390/320px. No push, merge, live SQL or deployment. See
[Demo Library](DEMO_LIBRARY.md) for preview commands, architecture, fidelity and handoff.

Demo guest segments (2026-09-23; local): added simplified Acquire, Retain and At Risk
cards below report totals, without campaign/export controls. Acquire/Retain count unique
linked guests in the selected period, with their visits and pax; At Risk uses the latest
non-voided visit through today and shows 60–89 and 90+ calendar-day groups independently
of the period. A paginated lean history query now supplies both revenue cohorts and risk.
Targeted tests passed for unique counts, repeat visits, voided/future exclusion, latest
visit and exact 60/89/90-day boundaries. Syntax/diff checks passed. Desktop and true 390px
mobile Indonesian fixtures were visually checked in Chrome. No push or deployment.

Demo report presentation (2026-09-23; local): replaced the period dropdown with
Today / Last 7 days / This month buttons; added coloured card accents, icons and
a separate illustrative marketing panel. Visits and diners (pax) are explicitly
distinguished with a group-of-four example. Average spending is labeled per visit
and rounded to whole rupiah for display. Revenue cohorts and underlying calculations
are unchanged. Calculation notes are expandable; missing-data coverage stays visible.
Targeted demo tests cover period switching, Indonesian labels, visit/pax counts and
average rounding in addition to the existing error/session checks; all passed.
Syntax and diff checks passed. Headless Chrome screenshots of the fictional Indonesian
report were inspected at desktop and true 390px iframe width. Not pushed or deployed.

Demo guide readability (2026-09-23; local): the four instructions now use a spaced
numbered list in English and Indonesian. Removed the sentence about closing the
guide during presentations. Bumped demo asset versions; no workflow changes.

## Simplified demo branch (2026-09-23; local, not deployed)

Created `demo` from the current clean `release` checkout. Added a small presentation
layer retaining the current operational screens: Admin front-desk dashboard, collapsible
guide and online form link, guest-profile reservation/deposit/invoice shortcuts, and
six simplified report metrics. Advanced navigation and dashboard loyalty widgets are
hidden. Campaign return is an explicitly labeled example, not live attribution.
Deposits remain reservation-linked; a reusable guest wallet needs business clarification.
See [demo presentation](DEMO_PRESENTATION.md) for metric definitions and provisioning.
No Auth/SQL/role changes, live writes, generated configuration edits, push or deployment.
The separate demo host must use a dedicated fictional-data Supabase project.

Verification: existing full runner passed 89 suites; the added demo presentation suite
passed separately (recorded zero/missing spending, revenue cohorts, voided exclusion,
errors, role checks and stale-session protection). Syntax and diff checks passed.
In-app browser startup failed with missing `sandboxPolicy`; headless Chrome verified
the report at desktop and true 390px iframe width, plus dashboard and guest profile
at 390px, using fictional fixtures with real markup/styles. Loading-sequence and
settings-navigation tests also passed after the final hooks; the former emits its
known jsdom unsupported-reload diagnostic. Live end-to-end testing remains a deployment
obligation.

Audited 2026-09-14. This file replaces conversation history as the task handoff.
Implementation claims were checked against code, migrations, Git and existing tests/docs.
No live Supabase/Cloudflare inspection, migration, deployment or push was performed for this
documentation task. **Committed code is not proof of deployed SQL or Edge Functions.**

Supabase developer guide (local documentation, 2026-09-19): added
`docs/SUPABASE_EXPLAINED_SIMPLY.md` as the non-technical starting point and
`docs/SUPABASE_GUIDE.md` as the developer reference. Together they explain the
browser-to-Supabase architecture, connection/build configuration, Auth session path,
PostgREST queries, RPCs, RLS, Storage, Realtime, the `staff-account` Edge Function,
migration/deployment separation and safe debugging. Linked them from
`docs/ARCHITECTURE.md`. No runtime, SQL, configuration or deployment change was made.

Migration orientation (local documentation, 2026-09-19): added
`docs/MIGRATIONS_EXPLAINED_SIMPLY.md` to separate the fresh-client sequence, existing-client
inventory path and consolidated historical files in non-technical language. No migration was
deleted or applied and no live database was accessed.

## Regression baseline repaired (2026-09-20; local, not deployed)

After investigating the eleven failures below, `npm.cmd test` completed with **88 suites
passed, zero failing, no reported skips**. Syntax checks on changed JavaScript and
`git diff --check` passed. Earlier failure lists below are historical evidence, superseded
by this run; they are not eleven outstanding bugs.

Application fixes: the staff-account Role selector now includes Finance; Reservations
again exposes the Deposit queue chip so Finance's initial filter is visible and selectable;
the config template now translates two missing deposit-request messages into Indonesian.
No database permission, Auth, RPC or SQL behavior was changed. Rebuild the client config
through the normal deployment process for translations; the local generated config was
preserved. Existing Finance migration/Edge Function prerequisites still apply per client.

| Suite | Investigation and resolution |
|---|---|
| `js/invoice.i18n.test.js` | Obsolete closing-line copy expectation; aligned with the shared invoice renderer while retaining English-only checks. |
| `js/invoice.test.js` | Missing role and payment-settings helpers in the isolated DOM harness; supplied its Admin role and bank-settings fixture. |
| `js/vouchers.test.js` | Fake codes used VCH while SQL generates BHV; corrected fixture and expectations. Loaded the real WhatsApp template helpers with fake template data, retaining the intercepted handoff. No messages sent. |
| `tests/deposit-refresh.test.js` | Missing waiver-permission helpers in the isolated harness; retained success/refusal and display-refresh assertions. |
| `tests/deposit-staff-app.test.js` | Format field is generated by the shared helper, not static HTML; test now executes that helper. Fixed the real missing translations. Executes the actual build with in-memory writes instead of reading a possibly stale/absent local config. |
| `tests/finance-role.test.js` | Referenced a removed marker and old initializer signature; checks actual Walk-Ins navigation instead. Preserved the initial-filter assertion, which exposed the missing Deposit queue chip; restored the chip and checks reset when switching to Staff. Existing PGlite permission assertions retained. |
| `tests/guest-language.test.js` | Fixed-length source slice cut off the saved switch flag; inspect the complete save function. |
| `tests/notification-icons.test.js` | Mock still implemented direct updates; now exercises the protected checklist RPC contract and confirmed-state refresh. Also executes a click whose target is detached during rerender. |
| `tests/reservation-export.test.js` | Fixed-length slice missed expanded queries; inspect full functions. Replaced obsolete single-day filename check with execution of daily, range and search exports. |
| `tests/reserve-loading.test.js` | Missing shared deposit-policy dependency caused a harness-only initialization error; supplied it and retained delayed/failure/paused loading checks. |
| `tests/settings-screens.test.js` | Role assertion predated Owner/Finance and exposed the missing Finance option. Updated detached-click source check and scoped operational width rule to exclude the deliberately distinct management layouts. |

Visual check: actual changed markup/local styles in an isolated fixture with Tailwind,
desktop and constrained 390px content screenshots. Finance selection fits and the deposit
chip remains accessible in the horizontally scrolling filter row. The fixture has no backend
and does not prove live saves. In-app browser startup failed (`sandboxPolicy` missing);
approved headless Chrome was used after sandboxed Chrome failed to start.

The next regression phase still needs real Supabase/API/browser coverage. The existing
runner has no per-suite timeout and treats missing jsdom as a skip; this passing run had
jsdom installed, but those runner limitations remain before enforcing a release gate.

## Housekeeping and initial test baseline (2026-09-20; superseded above)

Working branch at this audit: `release`, HEAD `87c4fa8` (merge of origin/main).
The working tree was clean before housekeeping. No fetch, push, deployment or live
database access was performed; local refs do not establish remote/deployment state.

Added a [folder inventory](REPOSITORY_GUIDE.md), [documentation index](README.md) and
[tooling guide](../scripts/README.md). Corrected historical-spec paths, stale build/RLS
and schema-setup comments, and artwork guidance. No file moves/deletions, runtime behavior,
SQL or generated-client changes. Twelve unreferenced artwork candidates remain in place
pending checks of saved client URLs and external consumers.

`npm.cmd test` completed: **88 suites, 77 passed, 11 failed**, no reported skips.
The run started before housekeeping edits; only documentation/comments changed afterward.
These are observed failures, not a diagnosis of application defects versus stale tests:

| Failing suite | Reported failure |
|---|---|
| `js/invoice.i18n.test.js` | Closing-line assertion |
| `js/invoice.test.js` | `currentStaffRole` undefined in harness execution |
| `js/vouchers.test.js` | Case-insensitive lookup assertion, then null `voided` access |
| `tests/deposit-refresh.test.js` | `refreshDepositWaiverPermission` undefined |
| `tests/deposit-staff-app.test.js` | Deposit-format element, translations and generated-config comparison |
| `tests/finance-role.test.js` | Null element `style` access |
| `tests/guest-language.test.js` | Stored-language assertion |
| `tests/notification-icons.test.js` | Expected notification source wording missing |
| `tests/reservation-export.test.js` | Guest-field query and export filename assertions |
| `tests/reserve-loading.test.js` | Strict-equality assertion |
| `tests/settings-screens.test.js` | Role options, detached-node handling and page-width assertions |

This initial run was not a green release gate; the investigation above resolves its failures.
Existing mocks/jsdom/PGlite tests do not prove live Auth, Storage, Realtime or client rollout.
The runner has no timeout and can silently accept a missing-jsdom skip; address those
limitations in the upcoming regression-test work.

## Historical repository snapshot (2026-09-14; superseded above)

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

The documentation handoff described here is already tracked in the current checkout;
its former working-diff list is no longer an outstanding task.

## Implemented in current code

Landing phone use-case demos (2026-09-21; local, not deployed): at widths up to
560px the device stage comes first, followed by a single animated step caption
with stable height, numbered step buttons and pause/play. Manual numbered
selection pauses the sequence; reduced motion supports manual navigation without
autoplay. Tablet/desktop retain all steps; no-JavaScript fallback keeps the full
list. Phone mockups overlap in a bounded stage instead of extending vertically.
Verified all four panels in Chrome at 390/768/1440px with no horizontal overflow;
phone panels measured 518px (602px with the deposit note). Step heights stayed
equal; pause held phase 2 and resume advanced to phase 3. Reduced-motion manual
selection worked. Inline syntax, stylesheet parsing and diff checks passed.
No deployment performed.


Landing palette exploration (2026-09-21; local, not deployed): supersedes the
earlier all-white section request. Hero stays white; problem, additional features
and contact sections use warm linen #F7F0E6; features and how-it-works use pale
blue #EDF3FB, alternating with white sections. Actions use logo blue #3C56A6;
contact panel/footer use navy #20345D instead of plum. Softer sand/sky fills,
slate body text and darker blue heading accents complete the palette. Section
fills are defined together; removed obsolete seam overlay CSS/classes.
Scatter-only hero animation remains. Headless Chrome desktop (1440px) and phone
(390px) captures confirmed section colours, visible pills and no horizontal
overflow; reduced motion remains static. CSS parsing and diff checks passed.
No deployment or generated configuration changes.


Landing hero entrance (2026-09-21; local, not deployed): the two back photos scatter out from behind the stationary main photo.
The initial drop and rebound were removed at the user?s request. Four metric pills appear in sequence after settling, with final
numbers immediately readable. Entrance runs once when the hero enters view and
waits briefly for image decoding; reduced motion and no-JavaScript keep the final
composition visible. The white canvas is preserved. Verification: all four inline
scripts passed `node --check`, jsdom parsed CSS, and `git diff --check` passed.
Headless Chrome at 1440px and true 390px emulation confirmed visible final pills,
no horizontal overflow, and white canvas; inspected desktop and phone screenshots.
Reduced-motion styles confirmed no animations and full opacity. No deployment.


Landing background cleanup (2026-09-21; local, not deployed): `landing.html` now
uses one explicit white canvas, including its loading overlay. Removed the
JavaScript-injected hero bloom, broad coloured hero photo/badge shadows, unused
section gradient CSS/DOM creation/scroll listeners, obsolete background tokens
and duplicate section fills. Existing local landing edits were preserved.
Verification: four inline scripts passed `node --check`, stylesheet parsed in
jsdom, and `git diff --check` passed. Headless Chrome desktop and narrow captures
sampled RGB 255/255/255 in blank canvas areas. Narrow Chrome capture was clipped
by its minimum viewport width, so it does not establish phone layout correctness.
In-app browser was unavailable (`sandboxPolicy` missing). No deployment performed.


Settings navigation redesign (local, 2026-09-20; not deployed): Settings now expands
into Reservations, Deposits & Payments, Guest Spending, Membership & Rewards,
WhatsApp Messages, Branding and Staff & Access, with category-specific content tabs.
Booking rules, spending rules, membership rules, deposit policy and payment instructions
have separate screens and scoped saves. Outlook configuration sits inside Reservations.
Area deposit amounts remain edited once in Areas & tables. Spin Wheel Prizes and its
existing history remain together under Membership & Rewards. The sidebar supports a
device-persisted icon view, click/tap Settings flyout, and a phone drawer with keyboard
focus handling. Reorganized rule/payment screens warn before discarding unsaved edits;
older appearance, message and catalogue editors retain their existing save behaviour.
Existing roles, Admin-only payment destination controls, and database permissions remain.
No migration is required; rebuild generated config for the new Indonesian translations.
Verification: new jsdom navigation/role/scoped-save tests, threshold save tests, form fields,
guest links, financial tracking, reservation gate, staff auth roles, page loading, loading
sequence and WA settings passed. Desktop, compact/tablet-width and 390px phone/drawer
screenshots used a local synthetic fixture with no backend. In-app browser startup failed
(`sandboxPolicy` missing); headless Chrome was used instead. Three existing settings-screen
test failures (role options, notification source assertion, management page widths) were
reproduced against HEAD; no full-suite or live Supabase verification was performed.

Reservation modal tablet spacing (local, not deployed): iPad-sized viewports now use wider
gutters across all paired reservation fields, more vertical space between Expected Duration
and Reservation Hours, and more space within the hours row. The breakpoint deliberately does
not depend on pointer type because iPadOS may expose a fine pointer when a mouse or trackpad is
connected. Large desktop and phone spacing remain unchanged. Confirm on an iPad Air before
deployment.

Dashboard large-party deposit choice (local, not deployed): New Reservation now reveals the
existing simple-versus-detailed invoice-format choice when pax exceeds the configured regular
maximum and a deposit is requested. The chosen format is saved on creation; online-form and
older unselected bookings retain the existing post-creation choice. No SQL change is required.

Guest deposit confirmation wording (local, not deployed): Settings > WhatsApp Messages now
includes an editable `Deposit payment confirmation (guest button)` template for the public
invoice's “Saya sudah transfer” action. It supports `{nama}` and `{resto}` and retains a
built-in fallback until a client saves its own wording. No SQL migration is required because
the existing template editor upserts the row when saved.

Branding and issued-document consistency (local, not deployed): uploaded Branding logos now
drive the detailed invoice (including existing guest links), simple deposit invoice,
reservation ticket and their browser-tab icons. Issued detailed invoices snapshot the active
Invoice Design, and the shared renderer applies that same appearance on the staff preview,
guest page and PDF; older invoices fall back to the current saved design. No SQL change is
required. Generated client HTML was not hand-edited and must be rebuilt for deployment.

Day run sheet guest names (local, not deployed): online-booking aliases now print as plain
readable text such as `Rere (Resa)`. The sheet no longer escapes the interactive guest-name
`<span>` markup into visible text. Canonical names, aliases and HTML escaping remain intact.

Reservation ticket appearance (local, not deployed): the on-screen and downloaded ticket
header follows Invoice Design's editable Bars colour, with automatic contrasting text. The
download button matches it. The uploaded logo sits directly on the colour without a white
plate, padding or a duplicate restaurant-name line.

Reservation-form guest links (local, not deployed): Settings > Reservation Form now accepts
both a full-menu URL and an address/location URL. Either may be blank; its public control is
then hidden. The booking template no longer contains Blue Heron's menu URL, featured dishes,
or a generic Maps fallback. The Add Dish button now sits directly above the three dish groups,
whose existing empty states remain available. No SQL change is required because the URLs use
the existing `app_settings.full_menu` JSON row.

Manager dashboard visibility (local, not deployed): Manager now always uses the Staff
Dashboard. The management Restaurant Overview and Reservation Outlook are visible only to
Admin and Owner; Admin retains its separate Staff Dashboard link. This is a frontend role
visibility/routing change and does not alter database permissions.

Online reservation notes wording (local, not deployed): Settings > Reservation Form now
lets managers replace the example placeholder inside the optional Notes box. Blank keeps
the existing translated built-in wording; custom text is capped at 160 characters and shown
exactly as entered. No SQL change is required because it uses the existing
`app_settings.reservation_form` JSON row.

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

Management dashboard and Reservation Outlook (local, not deployed): Owner/Admin share the
management overview; Manager always uses Staff Dashboard, and Admin retains a separate Staff Dashboard link. Today KPIs
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
- The stale `build-config.js` comment saying RLS was not enabled was corrected during
  2026-09-20 housekeeping. Actual per-client security deployment still needs verification.
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
