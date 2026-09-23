# Simplified demo

Local `demo` branch, based on the existing `release` checkout. No push or deployment.

The `demo-mode` class on `index.html` enables a presentation layer in `js/demo.js`
and `css/demo.css`. Existing reservation, walk-in, deposit and invoice operations
remain authoritative; this layer does not change Auth, roles, SQL or saved money.
Use an Admin demo account for the complete guided experience. Owner remains read-only
and retains its management dashboard; Staff and Finance retain their existing access.

## Experience

- Dashboard: collapsible guide, quick walk-in, reservations, walk-ins, area occupancy
  and actual visit/pax traffic today. Prize/birthday widgets and the old mixed
  actual/expected KPI row are hidden. Admin lands on this front-desk view.
- Reservation and walk-in screens: existing controls and behavior.
- Guest profile: contact details, preferences, spending and history remain. Loyalty/tier
  decorations are hidden. The latest five reservations link to Deposit & invoices;
  a new reservation can start with this guest selected.
- Invoice stays available through its existing role-gated editor. Large-party simple
  versus detailed invoice choice remains in the reservation flow.
- Reports: today, last seven days or month-to-date; actual visits, recorded pax,
  recorded visit revenue, average per recorded visit, returning-guest revenue and
  new-guest revenue. Zero spending counts; null spending does not. Returning means
  a non-voided visit before the reporting period. Subsequent visits by a newly
  acquired guest remain in the new-guest group. Unlinked revenue is disclosed separately.
- Campaign returns are an explicitly illustrative example, excluded from totals.
  No actual campaign return amount is queried yet. Email/WhatsApp campaigns are
  described as an optional service; campaign management is hidden.

Deposits currently belong to reservations. A reusable guest wallet is not implemented;
the user has been asked whether that is intended. No automatic reset, payment sandbox,
fake authentication or message interception is added. Existing sending controls still
work, so provision fictional data and use only test recipients during demonstrations.

## Isolated hosting

Use a separate Cloudflare static site/Worker, separate origin and the `demo` branch,
plus a dedicated demo Supabase project. A branch or Worker does not isolate a database.
Follow [client deployment](deployment/CLIENT_DEPLOY.md) and the migration guide for
the target project's actual starting state. Never replay consolidated SQL on a secured DB.
Build with the demo project's public URL/key and demo `SITE_URL`; keep generated local
configuration untouched until the correct environment is explicitly selected.
Verify upload exclusions, public reservation links and authentication on that origin.

`node scripts/demo-preview.cjs` writes a local fictional report fixture to the OS temp
directory for visual QA. It contains no backend connection and is not a standalone demo.
`node tests/demo-presentation.test.js` checks metrics, failed reads, role checks and
stale-session suppression. Live Auth, saves, online form and invoice links still need
verification against the dedicated demo project.
