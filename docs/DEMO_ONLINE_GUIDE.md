# Online Reservation Guide

Optional, separate experience on `feature/demo-guided-tour`, 2026-10-08.
Launch **Online Reservation Guide** in the authenticated dashboard's existing demo
guidance. The regular dashboard/customer tour remains separate.

## What prospects do

1. Click the existing online form link. During this guide it opens in the same tab;
   independent use retains its original new-tab behavior.
2. Enter the generated fictional name (`Intoch Demo` plus an eight-character suffix).
3. Enter the generated fictional contact number beginning with `000`. This is not
   a recipient for real communication. Guided submission requires these exact values.
4. Keep the party to two guests and review how party size affects availability.
5. Choose an offered area, a date from today through the next 13 days, and a time.
   The actual form supplies availability and any deposit conditions. The date range
   keeps this booking within the existing 14-day online dashboard overview.
6. Click the form's submit button. This is a user-triggered save to the fictional
   playground, using the existing `create_public_reservation` RPC and validation.
   The guide neither submits automatically nor bypasses validation.
7. Read the actual outcome. Waitlist means a request awaiting a decision, Incoming
   means awaiting deposit/quote, and Reserved is separate from arrival or completion.
8. Click **Return to Dashboard**. Existing verified authentication restores the
   staff app; after its successful page load the guide continues.
9. Click **Online form · 14 days**. A successful read must include the saved ID.
10. Click the selected day's card. Reservations opens with existing online/date
    filters, and the successful result must include that exact saved booking.
11. Review its row and current status, then the follow-up bell. No payment, message,
    follow-up write, arrival or completion is required to finish.
12. Finish and explore independently. The fictional booking stays in the playground.

There are 13 spotlight steps (the overview/day actions and the saved name/status highlights are separate steps).
English and Indonesian copy live in `js/demo-booking-tour.js`. Examples of the copy:
**Book as a guest**, **Create the demo booking**, **See online bookings arrive**,
**Your guest's booking is here**, and **Guest to front desk, connected**.
Back, Skip, Close/Escape and independent exploration are available. Back does not
replay a successful save. Relaunch from the dashboard creates a new fictional example
only when the user submits again; Reset Demo Data remains a separate improvement.

## Availability and persistence

- Shares the exact playground origin/project allowlist with the dashboard tour.
- The staff launcher runs after verified app initialization and requires dashboard
  and reservation access. Owner's overview is excluded.
- Ordinary public guests get no guide. Public pages require a valid, unexpired
  same-tab handoff plus fresh `getUser`, `app_session_valid` and active staff-profile
  reads. These are existing Auth/RLS checks; the handoff is presentation state and
  grants no database permissions. Auth sign-out tears down the public guide.
- `sessionStorage` uses a versioned project key, a staff identity and a two-hour
  lifetime. The handoff stores only fictional example details and saved booking ID.
  Reload offers explicit recovery; a successful confirmation-page Return action
  continues automatically after the authenticated app's next successful page load.
- Browser-local completion/skip status has its own versioned project/staff key.
  This guide is launched explicitly and never adds another automatic welcome prompt.
- Browser storage is required for this guide's multi-page handoff. Same-origin,
  same-tab use is intentional; cross-domain guest sites and cross-device recovery
  are not supported in this phase.
- Missing targets and failed reads pause, with independent exploration available.
  An interrupted submission is marked uncertain: reload never retries it. The user
  can check the dashboard, and recovery reads the unique fictional guest/contact,
  date and creation window before accepting exactly one matching online booking.
  Zero or ambiguous results stay paused; no duplicate is created automatically.
- A full/closed slot or server rejection stays in the form for correction. The guide
  does not change restaurant settings, availability, Auth, RLS or payment rules.

## Files and local verification

Runtime: `js/demo-booking-tour.js`, `js/demo-tour.js`, `js/demo.js`, `js/app.js`,
`js/reservation-extras.js`, `index.html`, `reserve.template.html`, and
`reservation-created.template.html`. Public pages use the existing local Driver.js
1.9.0 assets/license and scoped tour CSS. Generated HTML/config were not rebuilt or
edited locally; Cloudflare's existing build generates the public pages from templates.

Tests: `tests/demo-booking-tour.test.js`. Local fixtures and browser checks:
`scripts/demo-booking-fixture.cjs`, `scripts/demo-tour-preview.cjs --online`,
and `scripts/check-demo-booking-browser.cjs`.

```powershell
node scripts/demo-tour-preview.cjs --online
# In another terminal:
node scripts/check-demo-booking-browser.cjs
npm.cmd test
```

The preview binds only `127.0.0.1:8080` and serves backend-free markup at
`http://127.0.0.1:8080/`. Fake bookings stay in that browser's storage; it does not
load generated configuration or contact Supabase. It executes the real public
submit handler, online overview/day handlers and reservation row renderer, with
controlled fictional RPC/query responses. The original read-only tour preview
remains available without `--online`.

Screenshots are in `docs/screens/demo-online-booking/`. Browser checks use actual
mouse/keyboard events through the form and staff flow at 1440px, 393px and 320px,
including reduced motion at 320px. Browser fixture results cannot prove live Auth,
RLS/RPC availability, realtime notifications, physical keyboards or host routing.
Live playground booking verification remains a user-managed follow-up. No live
bookings, pushes or deployments are performed by the preview/tests.

No database migration, additional sandbox or completion-tracking service is added.
The project remains the existing fictional playground confirmed by the user.
