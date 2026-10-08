# Authenticated demo walkthrough

## Optional Reports guide

The demo Reports page reuses the original product cards and report calculations,
with no Marketing/Operations/Spending tab selector. It includes date range and
guest totals, Acquire, Retain, At Risk, today's reservations/cancellations,
upcoming reservations and Peak Traffic. Original CSV exports, at-risk switches
and the Peak Traffic date picker remain interactive. Campaign creation and other
report sections are outside this demo view. Non-demo Reports is unchanged.

Start Reports Guide in the page introduction, or choose Reports from Reset Tour.
The initial three-guide introduction is unchanged. The nine steps introduce:
guest insights, date range, acquisition, returning guests, at-risk relationships,
today's service, upcoming bookings, peak traffic and independent exploration.
Controls can be tried while highlighted; this introduction does not require
writes or force filter changes. Skip/Close, Back, restart and reload recovery use
the existing controller. Loading failures offer Retry without presenting zeros
as successful results; stale session reads cannot replace the current report.

Verification uses the actual report handlers with fictional read-only fixtures:
`tests/demo-reports.test.js` and
`node scripts/check-demo-tour-browser.cjs --reports-only` (1440/393/320px).
Screenshots: `docs/screens/demo-tour/*-reports-*.png`. Live Supabase reads and
deployment remain separate verification obligations.

Implemented locally on `feature/demo-guided-tour`, 2026-10-08. No deployment,
public access provisioning, live SQL, reset, Auth changes or configuration rebuild.

The user confirmed the existing Supabase project is the fictional Intoch playground.
It remains the existing operational app: customers may manually use its CRUD controls.
The tour itself only navigates and reads; it never submits a walk-in, reservation,
payment, invoice or message. Reset Demo Data is a separate future improvement.
The `/demo/*` sales-story player is unchanged.

A separate [Online Reservation Guide](DEMO_ONLINE_GUIDE.md) now connects the real
guest form to the exact saved booking on the dashboard. It is launched explicitly
from the dashboard demo guidance and does not add steps to this tour.

## Integration and availability

Modified: `index.html`, `js/app.js`, `js/demo.js`, `docs/CURRENT_STATE.md` and
`docs/DECISIONS.md`. Added: the tour controller/environment manifest/CSS, versioned
Driver assets/license, `tests/demo-tour.test.js`, `scripts/demo-tour-fixture.cjs`, `scripts/demo-tour-preview.cjs` and
`scripts/check-demo-tour-browser.cjs`, this guide and `docs/screens/demo-tour/` screenshots.
Pre-existing package, lockfile and skill-install changes were preserved.

- `js/demo-tour.js` uses vanilla DOM APIs and the existing global application functions.
  Its controller remains mounted while `navigateTo()` swaps sections.
- `assets/vendor/driverjs/1.9.0/` contains the existing dependency's browser build,
  stylesheet and MIT license. These are byte-for-byte copies of the installed 1.9.0
  artifacts. There is no CDN dependency for Driver, frontend framework or new bundler.
- `css/demo-tour.css` scopes the popovers to Intoch fonts and brand tokens. It supports
  phone navigation, the visual viewport/keyboard, nested profile scrolling and reduced
  motion. A temporary phone sizing guard prevents the guided profile from clipping after
  horizontal guest-table scrolling; independent use retains the existing dialog styles.
  There is no animated hand or dashboard redesign.
- `index.html` and generated guest/profile content expose dedicated `data-tour`
  anchors. Guest eye buttons carry their associated guest ID.
- App lifecycle notifications report navigation readiness, dashboard readiness,
  successful guest results and complete profile reads. Failed profile history/spending
  reads do not satisfy the profile action. Booking shortcuts wait for their read result.
  Guest read generations discard stale requests and results after logout.

Activation requires **all** of the following:

1. `initializeApplication()` calls the session hook after the existing verified login
   or session restoration and application setup.
2. The document has `demo-mode` and the verified staff session can access the dashboard
   and Guest Database. Owner's management overview is excluded.
3. The browser origin AND generated `SUPABASE_URL` match `js/demo-tour-environment.js`.
   This public allowlist includes the Cloudflare demo hostname:
   `https://demo.intoch.app`, `https://dashboard.intoch.app`, localhost/127.0.0.1 port 8080, and the playground
   project `hkrhsubhfqrgqkuhpvql`. A different origin or client project gets no tour UI.

This presentation gate never grants permission. Existing Supabase Auth/RLS remain the
authorization boundary. No query parameter or browser-storage flag enables the tour.
Generated `js/config.js` and all Supabase/authentication configuration were left untouched.

The sample is resolved from successful Guest Database reads, preferring the existing
fictional seed names Budi Santoso, Michelle and Jessica. The captured ID AND exact name
must match the search/profile result; partial searches work once a query of at least two
characters returns the example's visible result. IDs are never invented or selected from a real
client deployment. If these samples are missing or filtered out, pause and correct the
demo data/filters manually; the tour does not seed or reset data.

## First entry, exit and recovery

Policy approved by the user: browser-local V1 state; no server completion flag.

- First successful dashboard entry offers **Start Guided Tour** or **Explore Independently**.
- Local state is keyed by tour version, playground URL and staff identity. Finish,
  Skip, X and Escape suppress another introduction. The introduction is also recorded
  as offered, so abandoning the tab does not nag the user on their next visit.
- **Restart Tour** lives in the existing demo guide's summary, including when collapsed.
- Explore during a tour removes the overlay and offers an unobtrusive Resume/Restart/Close
  panel. Unrelated navigation never forces the user back into the guide.
- `sessionStorage` stores the current step and fictional example for same-tab recovery.
  Reload offers Resume; it does not automatically redirect or reopen the overlay.
  Resume re-establishes necessary reads instead of trusting stored success flags.
- Next is disabled on action steps. Forward keyboard navigation cannot bypass them.
  Back is explicitly managed across page boundaries; it never repeats a write.
- Missing/hidden targets wait up to five seconds, then pause. An action's slow navigation
  or profile read pauses after eight seconds. Skip and Explore remain available while
  the highlighted action waits. Underlying reads are not cancelled or fabricated.
- Logout removes overlays, observers, event handlers, timers, restart/recovery UI and
  active session storage. Late requests cannot resurrect the walkthrough.

Local completion does not follow a user to another browser or device. Private browsing,
storage restrictions or clearing storage can lose persistence; the tour still works.

## Flow and English copy

Desktop: 20 steps. Phone: 21, including the hamburger. Reservation and walk-in
sections are omitted without the relevant access; progress counts applicable steps.
The flow is Dashboard → Reservations → Walk-Ins → Guest Database. Each navigation
requires the real click and a successful page read. Filters remain usable without
requiring a submission; empty lists are valid, and failed reads pause the guide.
Equivalent Indonesian copy is included using the existing `demoText()` convention.

Welcome: **Try Intoch at your own pace** — “Take a short tour of the dashboard and a
fictional guest profile, or explore independently. You can restart the tour from the
demo guidance anytime.”

| Step | Copy | Advance |
|---|---|---|
| Your front desk at a glance | Start the day with bookings, walk-ins and seating in one place. This tour uses a fictional guest and never saves anything for you. | Next |
| Plan for arriving guests | Upcoming Reservations helps your team prepare before guests arrive. Today, Tomorrow and +2 Days let you look ahead without leaving the dashboard. | Next |
| Keep walk-ins in view | See today's walk-ins alongside your bookings. Your team can return here to update seating as the service changes. | Next |
| See the seating picture | Area occupancy compares assigned parties with area capacity. It is a seating overview; today's traffic also includes completed visits. | Next |
| A quick welcome for walk-ins | Quick Walk-In starts with a name, with phone and party size available here. You can add seating details later; no registration is needed for this tour. | Next; fields remain interactive |
| Open navigation (phone) | Tap the menu to explore reservations, walk-ins and guests. The guide will continue when navigation opens. | Actual hamburger opens drawer |
| Explore reservations | Click Reservations to see how your team prepares bookings and manages arrivals. We will continue when the list loads. | Actual navigation and successful list read |
| Find the right booking | Search for a guest or choose a date range to find bookings. Status filters help the team focus on the arrivals that need attention. | Next; filters remain interactive |
| Manage the arrival | The booking list brings guests, times, seating and status together. Available row actions let your team manage each booking; you do not need to change or save one during this tour. | Next |
| Explore walk-ins | Click Walk-Ins to see the guests who arrived without a reservation. We will continue when the log loads. | Actual navigation and successful log read |
| Review the service day | Choose a day to review its walk-ins. Register Walk-In is available for a new arrival; no registration is required to continue. | Next; filters remain interactive |
| Follow each walk-in | The log shows arrivals and their progress. Your team can edit details or complete a real visit with the available controls. Continue to connect these visits with the guest relationship. | Next |
| Get to know your guests | Open Guest Database to see the relationships behind each visit. Click the highlighted navigation item to continue. | Actual navigation and loaded page |
| Find a familiar face | Search for Budi Santoso, our reviewed fictional example. The guide continues when their matching result has loaded. | Matching query, successful read and visible result; name adapts to sample |
| Open the guest's story | Click the highlighted eye button to open this guest's profile. We'll wait for their details and history to load successfully. | Actual eye click and complete profile read |
| Remember who they are | Contact details keep the guest's identity together across visits. This example is fictional; you do not need to edit or contact anyone. | Next |
| Understand recorded spending | Average Spend gives context from the guest's recorded spending history. Missing spending is different from a recorded zero. | Next |
| Make the next visit personal | Favorites, preferences and notes help the team remember what matters to this guest. Empty fields mean those details have not been recorded yet. | Next; favorite card is fallback for absent notes |
| See the visits behind the relationship | Visit History shows the guest's recent attendance and recorded spending. A reservation alone does not mean the guest visited. | Next |
| Connect the next booking | When available, these shortcuts connect this guest to reservations, deposits and invoices. Deposits belong to a reservation; nothing needs to be created or paid during this tour. | Next, after shortcut read |
| You're ready to explore | Finish the tour to explore at your own pace. Restart Tour is always available in the dashboard's demo guidance. | Finish, record completion and close profile |

## Local review and verification

Run the backend-free fixture:

```powershell
node scripts/demo-tour-preview.cjs
# Open http://127.0.0.1:8080/__demo-tour-fixture
```

The fixture uses actual `index.html` markup, navigation, dashboard renderers, guest
search/table rendering, profile reads/rendering, demo shortcuts and login-page teardown.
Its filter-aware in-memory read provider contains fictional guests. It refuses writes,
never loads generated configuration, never connects to Supabase and never authenticates
a real staff user. It is test tooling, excluded from static website uploads. Existing
Tailwind/font dependencies remain as in the app.

```powershell
$env:TZ = 'Asia/Jakarta'
node tests/demo-tour.test.js
node scripts/check-demo-tour-browser.cjs
npm.cmd test
git diff --check
```

Chrome verification uses real mouse/keyboard input at 1440×1000, 393×852 and 320×852.
The 320px run uses reduced motion. `--phone` runs only the two phone widths;
`CHROME_PATH` can override the local Chrome executable. Screenshots are in
`docs/screens/demo-tour/`; all show the local fictional fixture, not live project data.

Automated tests cover environment/session/role gates, introduction and dismissal,
required actions, delayed/failed reads, missing targets, forward/back navigation,
search and profile data, completion, restart, independent exploration, recovery,
Escape, closing a profile and teardown during in-flight reads. Full-suite and browser
results are recorded in CURRENT_STATE after verification completes.

## Before external client access

Environment isolation is confirmed by the user and is not an implementation blocker.
This local implementation does **not** grant approval to publish or provision access.

1. Review this change and separately authorize its deployment/customer access.
2. Exercise the new tour with real verified login/restoration and the existing playground
   configuration, including the sample records, slow/error reads, session invalidation
   and logout. Local mocks do not prove live Auth or Supabase behavior.
3. Confirm intended demo account provisioning/permissions and how prospects share or
   receive credentials. Completion is per account/browser, not per prospect if shared.
4. Check a physical phone's keyboard/touch behavior, then verify asset exclusions and
   `/demo/*` preservation on the chosen host before exposing the deployed change.

No reset capability, automatic cleanup, public login bypass, server onboarding state,
payment simulation, message interception or new sandbox infrastructure is included.

## Independent sections and Reset Tour

The first-entry introduction offers Dashboard, Reservations & Walk-Ins; Guest
Database; and Reservation from Online Form. Start Dashboard Guide starts the first
section; each choice is independently selectable. Front desk guidance ends after
the walk-in log (12 desktop / 13 mobile steps); Guest Database starts with actual
navigation and contains 9 desktop / 10 mobile steps. The online guide keeps its
existing 13 steps and manual fictional booking submission.

Reset Tour stays visible at the lower right of verified demo staff pages. Select a
section to restart its guide, without changing bookings, guests or other demo data.
Skip, Close, Escape and Explore Independently briefly highlight this entry with
“Restart any guide here ↓”; there is no forced redirect or automatic replay. Explore
preserves a Resume prompt. Back stays within the selected section. Older saved full
walkthroughs retain their recovery path. On the public booking form, dismissal offers
a verified-session-only reset link back to the dashboard; selecting a staff section
happens after the dashboard restores its existing verified session.

Verification for the section picker: full Node runner passes 93 suites. Additional
controller checks cover direct Guest launch on desktop/mobile, intro choices, section
progress, actual actions, Skip preserving the current page, Reset highlight, online
selection and logout removal. Public-form tests cover ordinary-visitor exclusion,
explicit reset return and sign-out cleanup. Chrome fixture walkthroughs pass at
1440px, 393px and 320px for staff and online guides. Staff checks include horizontal
and vertical visual-viewport bounds for Reset Tour and the saved-progress prompt.
Screenshots are in `docs/screens/demo-tour/` and `docs/screens/demo-online-booking/`.
Live Supabase Auth/RPC/realtime and deployed Cloudflare builds were not exercised.

## Public demo login autofill

The user-approved demo Staff account is prefilled on the playground login page.
The inline hint says “Click Login to continue to the Intoch demo. You can explore
freely or choose a guided tour.” Login has a static, rounded highlight and receives
focus when the demo credentials are ready; fields remain editable. No Driver overlay
or automatic submission runs before authentication. Other saved/typed accounts are
preserved. The hint is removed after successful login and restored on the login screen.

`js/demo-login.js` is loaded after the playground allowlist and before `js/app.js`.
`showLoginPage` prepares it; `showAppShell` removes it. CSS lives in `css/demo.css`,
with a stable `data-tour="login-submit"` anchor in `index.html`. The public demo
credential is intentionally browser-visible and must belong only to the dedicated
fictional playground Staff account. The allowlist limits presentation, not access;
verified Supabase Auth and RLS remain the actual boundary. Never substitute private
or Admin credentials. Updating this public account's PIN also requires updating the
public demo module and bumping its index script version; no generated config edits.

QA: `node tests/demo-login.test.js`; start `node scripts/demo-tour-preview.cjs`, then
`node scripts/check-demo-login-browser.cjs` for backend-free real-form checks and
screenshots at 1440/393/320px. The fixture uses existing login and verified-session
handlers with fictional Auth replies. Live credential/session/active Staff checks
also passed, followed by local sign-out; complete live browser boot is still pending.

Reset Tour uses a navy background and white label. Close/Skip/Explore and Finish
highlight it with a static amber ring and a ten-second directional hint. Reduced
motion remains respected; the nudge does not animate or block independent use.
Use `node scripts/check-demo-tour-browser.cjs --reset-only` for fast desktop/393/320
Close-to-reset visual checks and current highlight/section-picker screenshots.
