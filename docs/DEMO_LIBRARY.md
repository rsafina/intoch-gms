# IntoCh Demo Library

Implemented on `demo`, 2026-09-23. Local work only; no push, merge or deployment.

## Preview

Run `node scripts/serve-demo-library.cjs`, then open
`http://127.0.0.1:8088/demo/reactivation`. This local-only server also serves `/landing`
for visual regression. It intentionally serves a small public asset allowlist.
The ordinary Python static server does not apply `_redirects`.

Implemented routes:

- `/demo/reactivation`
- `/demo/customer-database`
- `/demo/campaign`
- `/demo/walk-in`
- `/demo/reservation`
- `/demo/follow-up`
- `/demo/membership`
- `/demo/customer-insight`
- `/demo/full-journey`

`/demo` lists the stories. Direct links immediately open their own story. Unknown
slugs show a helpful unavailable state and links; they do not silently pick another story.
No route is a placeholder. Full Journey has four steps; the other stories have three.

## Structure and reuse

`demo-library.html` is the standalone shell. `js/demo-library-data.js` holds definitions
(slug/category/title/problem/keyMessage/steps/related links), the fictional Senja dataset,
and the same sales WhatsApp URL used by the landing page. `js/demo-library.js` owns the
player, shared UI rendering helpers and scene registry. To add a story, add a definition
and reuse scene identifiers; add a scene renderer only for a different workflow.

`css/landing-tokens.css` and `css/product-story.css` were extracted verbatim from the
landing page, retaining their original cascade positions. Both pages use them. Reused
pieces include the fonts, palette, tab navigation, split panel, product rows, profile
cards/statistics, status pills, reservation fields and selection states. The new
`css/demo-library.css` supplies the standalone page, browser frame, controls and responsive
overrides. The existing logo and share image are reused. Product screenshot assets were
inspected in the repository inventory; scenes use fictional HTML UI rather than embed
screenshots with client information or tiny mobile text.

The player advances four beats per step at 2.4 seconds per beat: about 29 seconds for
three steps and 38 seconds for Full Journey. CSS provides cursor and result transitions.
It stops at the result/CTA, with explicit replay. Step changes reset the scene. Pause
survives step changes. Hidden tabs and offscreen product panels stop the timer. Reduced
motion shows the completed state of each step with manual navigation and no animation;
preference changes are handled while the page is open. Mobile playback controls stick
near the bottom of the viewport. No hover is required.

Only local in-memory state is used. There are no app scripts, Auth, Supabase clients,
requests to customer services, writes, or local/session storage. External requests are
fonts and the existing sales contact link when deliberately opened. Visible scene
actions simulate state changes; they never open a customer's WhatsApp or send a message.

## Product fidelity boundaries

- At Risk uses the existing campaign concept: more than 60 days since a real visit.
  The six-person fixture narrows to Dewi (95 days) and Rina (75 days), as of 23 Sep 2026.
- Campaigns prepare a selected audience and message. Sending is one person at a time
  by staff in WhatsApp. Opening WhatsApp is never presented as delivery confirmation.
- Follow-up demonstrates the reservation checklist, not a general inquiry/task CRM.
- Insights show actual available visit counts, recency, recorded spending and segments;
  no predictive analytics, automatic POS sync, or campaign causality is claimed.
- Profiles consolidate data already recorded in Intoch; external imports need onboarding.
- Membership illustrates configurable spending-to-sticker conversion and voucher creation,
  not an automatic reward for a visit alone. Example rules: Rp100,000/sticker, 10/voucher,
  Rp50,000 voucher value and a 30-day validity period.
- Full Journey moves from 23 Sep to 1 Oct outreach and 3 Oct return; returning is an
  illustrative outcome, not a promise. Optional membership is linked as a next story.
- No public promo-page workflow is demonstrated because its deployment remains unfinished.

## Hosting and expansion

`_redirects` rewrites `/demo` and `/demo/*` to the shared shell. Absolute local asset URLs
make direct loading and refresh work under nested paths. Public assets live outside
the private `demo/` folder; `.assetsignore` continues excluding that tooling and SQL.
Before deployment, verify the actual host applies `_redirects` and exclusions, and that
existing host-level landing redirects do not swallow `/demo/*`. No hosting settings were
changed or verified against a deployed origin.

Share crawlers currently receive the same static Open Graph preview for all stories.
Before large-scale outreach, consider generating small route-specific HTML heads from
the definitions for pain-point-specific WhatsApp previews. Keep one player and scene
registry. This is also preferable to growing handwritten pages or connecting the mock
player to production code.

No additional assets are required. Optional sanitized current screenshots of the campaign
workspace, booking checklist and membership voucher screens would help refine visual
fidelity. Next recommended refinement is the Follow-up story: deepen the supported
reservation context without inventing a generic task scheduler.

## Verification

File inventory:

| Change | Files |
|---|---|
| Public entry/routing | Added `demo-library.html`, `_redirects` |
| Shared and demo styling | Added `css/landing-tokens.css`, `css/product-story.css`, `css/demo-library.css`; updated `landing.html` to load extracted styles |
| Content and player | Added `js/demo-library-data.js`, `js/demo-library.js` |
| Local tooling | Added `scripts/serve-demo-library.cjs`, `scripts/check-demo-library-browser.cjs` |
| Tests | Added `tests/demo-library.test.js`; updated `tests/brand-tokens.test.js` to resolve linked local stylesheets |
| Handoff | Added `docs/DEMO_LIBRARY.md`; updated `docs/CURRENT_STATE.md`, `docs/DECISIONS.md` |

- `npm.cmd test`: 91 suites passed, zero failures.
- `node tests/demo-library.test.js`: all nine stories, end/replay, pause, step reset,
  visibility, reduced motion, audience narrowing, route fallback and state isolation.
- `node scripts/check-demo-library-browser.cjs`: hidden local Chrome route/refresh,
  every step at 1440, 390 and 320 pixels, overflow, motion controls and landing tabs.
  Run the preview server first. Screenshots are written to a new OS temporary directory.
- All new JavaScript passes `node --check`; `git diff --check` passes.
- The existing build command (`node build-config.js`) passed in an isolated temporary
  copy of the templates with fictional build values, producing all seven outputs.
  Working client configuration and generated pages were untouched.
- Re-inlining extracted CSS reconstructed the original landing HTML byte for byte,
  confirming content and cascade order were preserved. Desktop and mobile demo screenshots
  and the landing storytelling section were visually inspected.

There are no configured lint or TypeScript-check scripts. These tests prove local behavior,
not deployment routing, live product integrations or WhatsApp preview caching.
