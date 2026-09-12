# Intoch architecture

How the subsystems work and the data models behind them. `CLAUDE.md` holds the rules,
decisions and current state, and is the file to read first.

Written 12 September 2026, after the roles rollout. If this file and the running database
disagree, **the database is right**: read it with `pg_get_functiondef`, `pg_get_viewdef`,
`pg_indexes` and `information_schema.columns`, and correct the file.

---

## 1. File map

```
index.html                    staff app, ~9,400 lines, one page, section toggling
landing.html                  public marketing page (carries its own orange, see CLAUDE.md)
*.template.html               guest pages, stamped at build time. NEVER edit the built copy
  reserve / spin / reservation-created / reservation-confirmation
  invoice-view / deposit-invoice / reservation-ticket
js/
  app.js                      ~16,000 lines: dashboard, reservations, walk-ins, guests,
                              reports, settings, staff accounts
  config.template.js          SOURCE of config.js. Supabase constants, ID_DICT, t(),
                              ymd(), branding, role gating (hasAccess / applyRoleToNav)
  config.js                   BUILD ARTEFACT. Do not edit
  staff-auth.js               username/PIN to Supabase Auth mapping, session restore
  owner-dashboard.js          Owner/Admin read-only summary (+ css/owner-dashboard.css)
  reservation-extras.js       dashboard online-form overview, online-only filter,
                              staff deposit request copy
  invoice.js                  invoice editor, INV_DEFAULTS, PDF export
  invoice-sheet.js            the sheet itself. Shared with the guest page. No config.js
  reservation-ticket.js       guest ticket page
  guest-i18n.js               guest-page translations, loaded by all four guest pages
  i18n.js                     staff-app dictionary plumbing
  notify.js                   online-reservation bell
  runsheet.js                 day run sheet
  membership.js  vouchers.js  voucher.js  broadcast.js  campaign.js
  campaign-editor.js  wa.js   page-loading.js  version-check.js
css/                          dashboard-reservations, invoice-sheet, owner-dashboard,
                              page-loading, reservation-ticket
migrations/                   ALL_IN_ONE.sql plus dated files; see section 9
supabase/functions/staff-account/index.ts    admin-only account and PIN management
scripts/                      build and verification helpers, migrate-staff-auth.mjs
demo/                         seed data for demos and for rehearsing migrations
tests/                        ~71 files, Node + vm, plus PGlite for role enforcement
```

Specs that remain authoritative for their feature, and record decisions Rere took:
`DEPOSIT_FLOW_SPEC.md`, `RESERVATION_DEPOSIT_SCOPE.md`, `RESERVATION_DEPOSIT_PHASE1.md`,
`RESERVATION_FORM_SPEC.md`, `RESERVATION_INVOICE_SPEC.md`, `ROLE_ROLLOUT.md`,
`CLIENT_DEPLOY.md`, `migrations/README.md`.

---

## 2. Config and build

Blue Heron hardcoded its Supabase credentials. Forking that per client is unmaintainable by
client three. Instead:

- `js/config.template.js` holds placeholders and no client's details.
- Each client's Cloudflare project sets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL` and
  `RESTAURANT_NAME` as environment variables.
- `node build-config.js` is the **deploy platform's** build command (Cloudflare > Settings >
  Build), not something Rere runs. It writes `js/config.js` and stamps every
  `*.template.html` into its built counterpart on each push.

One repo, N deployments, byte-identical code. A fix pushed once reaches every client.

- **`SITE_URL` is REQUIRED** and the build fails without it, deliberately. It is the bare
  public origin, no path and no trailing slash. A missing `SITE_URL` is invisible until a
  guest forwards a link, and by then WhatsApp has cached the broken preview.
- **`RESTAURANT_NAME`** is optional, defaults to `Restoran`, and warns when unset: a wrong
  name is embarrassing but not broken.
- **This does not hide the anon key.** It is still readable in the published JavaScript, as it
  always will be. This was a maintenance fix, never a security fix. Security is section 3.

A local build is only needed to open the guest pages from disk, and needs those variables set.
Normal workflow: edit the `.template.html`, push, let the host build.

### `reserve.html` carries a COPY of two appearance functions, on purpose

`loadReserveAppearance()` and `applyReserveAppearance()` exist in both
`js/config.template.js` and inline in `reserve.template.html`. This must not be "cleaned up"
by loading `config.js` from `reserve.html`: both files declare `const SUPABASE_URL`, and the
redeclaration kills the page. Fifteen duplicated lines beat a booking form that white-screens.
Both copies carry a comment pointing at the other; change one, change the other.

The same restriction is why `js/invoice-sheet.js` must never depend on `js/config.js`, and
therefore has no `t()` and no `toast()`: `invSheetPdf` reports through a `say` callback the
caller supplies.

### `og:image` can never be generated in JavaScript

The WhatsApp crawler does not run JS, so the share card has to be a real file in the build,
changed at deploy time. Same for `og:site_name`. Do not "fix" this by swapping the tag in JS:
it will look right in devtools and change nothing in WhatsApp.

---

## 3. Staff auth and verified roles (live, 11 September 2026)

### The shape of it

The login screen still asks for a username and a 4-digit PIN. `js/staff-auth.js` turns that
into real Supabase Auth credentials:

```
email    = username + "@staff.intoch.invalid"
password = "Intoch-PIN:" + pin
```

`loginStaff()` calls `signInWithPassword`, then `restoreVerifiedStaffSession()` looks the
`staff_users` row up **by `auth_user_id` and `is_active`**, never by the local-storage role
label and never by JWT metadata (which a client can edit). Deactivating an account revokes
database access immediately, without waiting for a JWT to expire.

So every request now carries a JWT and the database knows who is asking. Policies that test
the verified role work. The old rule forbidding `auth.role()` tests is retired.

### The four roles

| Role | Can |
| --- | --- |
| **owner** | Dashboard and Reports only, read-only. Writes and operational RPCs denied. |
| **admin** | Everything, including staff accounts, bank details, QRIS, payment instructions. |
| **manager** | Operations and reports, waivers, voids, negative adjustments. No accounts, no role changes, no payment destination. |
| **staff** | Dashboard, Reservations, Walk-ins, Membership, Guests. Deposit invoices and positive payment records. |

Frontend gating lives in `config.template.js`: `OWNER_ALLOWED_PAGES`, `STAFF_ALLOWED_PAGES`,
`ADMIN_ONLY_PAGES`, `hasAccess()`, `applyRoleToNav()`, `applyManagerOnlyUI()`,
`canManagePaymentSettings()`, `canIssueDepositInvoice()`. **Page navigation is a convenience,
not a boundary.** `applyManagerOnlyUI()` has to be re-run after any dynamic re-render
(`openResActions`, `loadWalkIns`, `loadReservations`) because those replace `innerHTML` and
would otherwise reset hidden controls back to visible.

### What enforces it, in the database

`20260911_roles_enforce.sql`:

- `public.app_staff_role()` and `public.app_staff_id()` resolve the caller's verified row from
  `auth.uid()`. Everything keys off these, never off submitted input.
- `app_private.require_access(kind)` is the single gate, with kinds `public_read`,
  `public_write`, `read`, `staff`, `manager`, `admin`.
- Every pre-existing permissive policy is dropped and RLS is enabled on every public table.
  `anon` keeps `select` on the configuration tables the public pages genuinely need:
  `app_settings`, `areas`, `tables`, `featured_dishes`, `prizes`, `reservation_exceptions`,
  `wa_campaigns`.
- `staff_users.pin` is set to NULL for every row and `select` on the column is revoked.
  Authenticated callers see only `id, username, display_name, role, is_active, created_at,
  auth_user_id`.
- `app_private.protect_changes()` is a BEFORE trigger on `staff_users`, `app_settings`,
  `invoice_payments`, `member_transactions`, `reservations`, `visits` and `invoices`. It is
  where the fine-grained rules live: only admin may change `bank_details` or `qris_url`, a
  negative or non-insert payment needs manager, staff may not set a reservation to `Deleted`
  or clear `deposit_required`, staff may not void a visit, staff may only touch `deposit`
  invoices, and non-admins may not alter invoice payment instructions.
- **SECURITY DEFINER RPCs bypass RLS**, so every one of them was moved into `app_private` and
  re-exposed as a public wrapper that calls `require_access` first. Arguments named
  `p_staff_id`, `p_created_by`, `p_redeemed_by` or `p_voided_by` are replaced with
  `public.app_staff_id()` in the wrapper, so a client cannot attribute an action to someone
  else.
- `app_private.role_audit` records actor, auth id, table, action and before/after rows for the
  same tables, with `pin` stripped. API clients cannot edit it. There is no audit-viewing
  screen yet.
- A **restrictive** Storage policy sits over the existing permissive ones so neither `anon`
  nor `owner` can write, and only admin can touch the QRIS object.

`supabase/functions/staff-account` is the only way to create an account or change a PIN. It
verifies the bearer token with Auth, requires an active admin row, refuses a self role change,
writes `staff_users` **as the caller** (so the triggers and the audit log see the real actor)
while using the service-role client only for the Auth side, deletes the Auth user again if the
row insert fails, and logs PIN changes through `record_staff_pin_change`.

### Three constraints that come with it

1. **An RPC added after enforcement is denied by default.** The wrapper loop assigns a role to
   a known list of function names and skips anything unlisted, and the migration revokes
   execute from `public`, `anon` and `authenticated` first. A new RPC must be reviewed and
   given a role explicitly. A later migration changing a protected function must change the
   implementation in `app_private` and keep the public wrapper.
2. **Do not rerun `ALL_IN_ONE.sql` after enforcement.** It would restore the old grants and
   unwrapped functions. `20260911_roles_enforce.sql` is deliberately not part of it, refuses a
   second application (it checks for `app_private.role_audit`), and aborts if any staff account
   is unlinked or if there is no active admin.
3. **Rollout order is load-bearing.** prepare migration, then
   `node scripts/migrate-staff-auth.mjs` with a service-role key in a trusted terminal, then
   `supabase functions deploy staff-account --no-verify-jwt`, then the enforce migration, then
   the frontend. Out of order and nobody can log in. Public Auth signup and email password
   recovery stay disabled for these internal identities. Full checklist: `ROLE_ROLLOUT.md`.

### What this does not fix

Four digits of entropy. `Intoch-PIN:` only satisfies a length requirement. Supabase Auth rate
limiting is the real protection. Hashing or lengthening the PIN is now a normal piece of work
rather than a prerequisite, and it is item 2 in the backlog.

---

## 4. Reservation capacity and timing

Three migrations built this: `20260908_area_time_blocks`, `20260909_timed_table_capacity`,
`20260913_table_picker_availability`. It is the most intricate part of the system.

### Columns on `reservations`

| Column | Meaning |
| --- | --- |
| `exclusive_area` | This booking takes the whole area. |
| `block_buffer_minutes` | Preparation time before the arrival, part of the hold. |
| `booking_duration_minutes` | How long the hold lasts. **Snapshotted at booking.** |
| `table_ids` | Multi-table assignment. |

`booking_duration_minutes` defaults to `public.default_reservation_duration()`, which reads
`reservation_hours.default_duration_minutes` and clamps it to 15..1440 (falling back to 180).
**It is snapshotted deliberately**: changing the setting later must not move holds that already
exist. Pre-existing bookings keep the legacy 180.

### The hold window

`reservation_hold_window(date, time, end, duration, buffer)` returns a `tsrange`:

```
[ date + time - buffer , date + end  )      when an explicit end_time is later than the start
[ date + time - buffer , date + time + duration )   otherwise
```

Half-open on purpose: the end slot is available to the next booking.

Everything derives from this one function, which is the point. `reservation_capacity()` (the
private aggregate calculator), the save-time trigger guard, and
`reservation_table_availability()` (what the picker greys out) all call it, so the picker and
the save guard cannot disagree. They previously could, which is the whole reason it exists.

### Rules built into it

- Capacity counts **peak concurrent** pax, not a whole-day sum. Unassigned pax, and pax beyond
  the seats actually assigned, still consume capacity.
- Statuses that hold a table: `Reserved`, `Confirmed`, `Incoming`, `Arrived`. **`Waitlist`
  does not hold anything.**
- `area_booking_blocks(date)` is the public read for exclusive blocks and returns **time
  windows only**, never guest names or booking ids.
- `reservation_table_availability()` also preserves current walk-in occupancy when the proposed
  window includes now, reading `visits` with `status = 'Active'` and `voided_at is null`.
- A booking excludes itself from its own check, via `p_exclude`.
- Save-time guards take `pg_advisory_xact_lock` keyed on the date, so two tills cannot both
  pass the check.
- The UI disables conflicting tables and refuses to save while availability is loading or
  failed. **The database checks are still the final guard**, not the UI.
- An area capacity figure is the fire-code number the owner sets, not the sum of its tables.

---

## 5. Deposits

Full reasoning: `DEPOSIT_FLOW_SPEC.md` and `RESERVATION_DEPOSIT_SCOPE.md`.

Deposit is a **flat rupiah amount** (`areas.deposit_amount`). `deposit_pct` is dead, kept, and
commented as superseded.

### The two doors out of `Incoming`

A booking in an area with a deposit is created `Incoming`, holds its table, and leaves that
status by exactly two routes: a recorded payment that clears the balance, or a waiver with a
written reason. Both write a record.

Staff **cannot** click "Reserved" on an `Incoming` booking. That would lock a table with
neither money nor a reason, and a week later nobody could tell it from a real payment.
`Arrived` and `Cancelled` stay reachable, because a guest turning up unpaid and a guest backing
out are both real things.

Unpaid bookings expire at the booking time itself, swept by `pg_cron` every ten minutes **and**
by the staff app on load, so a client project without cron still self-heals.

### Party size decides the flow

| | Small party | Large party |
| --- | --- | --- |
| Amount | Defaults to the area amount, editable | Must be an agreed figure |
| Status | `Incoming` | `Waitlist` |
| Deadline | The visit time | None, no automatic expiry |
| Invoice | Simplified template | Full template |

The public form's large-party gate sits above `reservation_hours.max_pax`: it stops and hands
the guest to WhatsApp rather than creating anything. It replaces the waitlist for that ONE
reason; below-min-pax and over-capacity still waitlist. **The gate closes only when the
restaurant has BOTH ticked the box and filled in a number**, otherwise it falls back to the old
flow. A half-configured setting must not make large bookings impossible with no way for the
guest to tell anyone.

### `record_deposit_payment`

- A zero, NaN or infinite amount is refused.
- Clearing the balance promotes the booking to `Reserved` **in the same transaction**, so it
  cannot be a forgotten second click.
- A **partial** payment leaves it `Incoming` and **does not move the deadline**. Otherwise a
  guest holds a table forever by sending Rp 1.000 a day.
- `Waitlist` is promoted the same way as `Incoming` (added 2026-09-07). A large party agrees a
  figure over WhatsApp and pays it; the money arriving is the same event in both flows. The
  only difference is how the booking got there: `Incoming` was auto-quoted, `Waitlist` was
  negotiated. Nothing else about `Waitlist` changes, no deadline and no sweep.

### The QRIS decision

ONE QRIS image for the whole restaurant, uploaded in Settings by an admin, shown with the
amount after a booking that owes a deposit, proof returned by WhatsApp. **No upload path on
the public page.** The object is protected by the restrictive Storage policy and by the
`app_settings` trigger rule.

---

## 6. Invoices and payments

Full reasoning: `RESERVATION_INVOICE_SPEC.md`.

### One table

`invoices`, extended rather than a second `reservation_invoices` beside it. Deposits already
write here; splitting them would mean every "what does this booking owe" question reads two
tables and hopes they agree.

- `doc` jsonb **is** the document. `invoice_no`, `subtotal`, `deposit_applied` and
  `amount_due` are a queryable summary written from that same object in one statement. **If
  they ever disagree, `doc` is right.**
- `kind` is constrained to `deposit` / `settlement` / `general`.
- `status` is `draft` / `issued` / `void` and **never gains `paid`**. Paid is derived by
  `invoice_balances`, the same reason `reservations` has no deposit status column.
- `next_invoice_no()` allocates `INV/0001/2026` under an advisory lock. It must **not** use
  `SELECT ... FOR UPDATE`: Postgres refuses that beside an aggregate, and it throws at RUN
  time, not CREATE time, so the definition looks healthy until the first save.
- `reservation_money` adds reservation-attached payments (deposits) and invoice-attached ones
  without double counting. **Voiding an invoice does not remove its payments from
  `paid_total`.** An earlier draft excluded them and a part-paid booking reported 3.000.000
  when 13.000.000 had arrived. Voiding is a billing decision and moves no money, the same as
  cancelling a paid booking. `paid_on_void_invoices` flags the part that usually means a refund
  is owed.
- `20260912_invoice_requested_deposit` derives `amount_due` and `deposit_applied` from the
  document's DP and settlement checkboxes in a trigger, refuses an issued deposit invoice with
  a non-positive amount, and syncs the newest issued deposit invoice back into
  `reservations.deposit_expected`. **Only the newest counts**; an older saved invoice is
  history, not the active request. A separate settlement invoice does not rewrite the deposit.

### One sheet definition

`css/invoice-sheet.css` and `js/invoice-sheet.js`, loaded by **both** `index.html` and
`invoice-view.template.html`. Neither file reads a form input: they take the snapshot object
`invSnapshot()` produces, which is exactly what is stored in `invoices.doc`. Staff preview,
saved row and guest copy are therefore one object rendered by one function and cannot disagree.
The sheet's markup comes from `invSheetMarkup()`, not from either page's HTML.

The lock flags in the snapshot are why the document is stored whole rather than recomputed: a
staff member who typed an agreed total by hand must see that total again.

### The invoice sheet is styled with LITERAL hex, never CSS variables

`#inv-sheet` is rasterised by html2canvas for the PDF, and html2canvas does not resolve custom
properties. `applyInvoiceStyle()` builds a `<style>` block of literal hex from
`app_settings.invoice_style`. Do not modernise this into `var()`: the colour resolves
perfectly on screen and silently falls back in the exported PDF, a document already sent to a
guest before anyone notices. `tests/invoice-style.test.js` asserts the generated CSS contains
no `var(`.

**Bar text is derived, not configured.** The table header and totals bar print text on the
accent colour, and that text deliberately is not one of the five settings: it flips between
white and the ink colour by the fill's luminance. A client picking a pale brand colour would
otherwise print an invisible Total line and find out from a guest.

**The footer address was one particular restaurant's.** It is now three separate fields,
seeded EMPTY. Separate so a client cannot ship an invoice with a placeholder still in it, and
empty so a missing footer is obviously missing rather than confidently wrong.

---

## 7. Guest reservation tickets

`20260915_reservation_tickets`. `reservations.ticket_token` (uuid, unique) and
`ticket_issued_at`.

- `issue_reservation_ticket()` only works on a **Reserved** booking, and reissuing reuses the
  same token and timestamp via `coalesce`. One booking, one URL, forever, which is also what
  WhatsApp's per-URL preview cache requires.
- `reservation_ticket_by_token()` returns a deliberately narrow field set: reference, name,
  date, time, end, pax, area, status, issue time, and the restaurant's own name, address and
  phone. **No payment detail, no guest phone number, no staff notes.**
- The reference shown to the guest is `RSV-` plus the first 12 hex characters of the token.
- The page (`js/reservation-ticket.js`, `css/reservation-ticket.css`) is bilingual, shows live
  booking details rather than a frozen copy, and hides the download action when the status is
  no longer Reserved. There is no check-in scanning.

---

## 8. Broadcast and campaigns

**Ten active campaigns, not one.** `20260914_multiple_active_campaigns` drops
`idx_one_open_campaign` (which earlier documentation described as a deliberate
one-campaign rule) and replaces it with ten numbered slots:

- `wa_campaigns.active_slot` is 1..10 and unique, NULL for anything not active, enforced by
  both a CHECK and a trigger that takes an advisory lock before picking the lowest free slot.
- Drafts are unlimited and consume no slot. Starting or reopening a campaign never closes
  another one. Re-running the migration preserves existing slot assignments and refuses
  over-cap legacy data rather than silently closing campaigns.
- Sends stay attributed to their selected campaign. A guest can receive messages from several
  campaigns and there is no cross-campaign cooldown.

Still broken, and listed in the backlog: the promo link origin is hardcoded as
`https://your-site.example` in `campaign-editor.js`, `campaign.js` and `broadcast.js`, and 257
campaign-editor tests assert those constants.

### WhatsApp: one send with a picture

Scoped at Rere's request, not built. Decide before quoting a client. The front desk is a
**Windows PC only**, which decides most of it.

- **Option A, Web Share API. Rejected for this client.** `navigator.share({files, text})` is
  solid on Android and iOS and feature-detects to false on a Windows till. Worth adding only
  if staff start following up from their own handsets; gate it on
  `navigator.canShare({files})` and fall through to today's download-and-attach.
- **Option B, server-rendered preview card. RECOMMENDED.** Put a URL in the message and
  WhatsApp draws the picture. The staff app already renders the card to a canvas in
  `reservation-confirmation.html`; the missing pieces are uploading that PNG to Storage (the
  `branding` bucket pattern already does this) and a Cloudflare Worker route `/r/:id` that
  returns a tiny HTML page whose `og:image` points at it and redirects a human to the real
  page. One request per booking against a 100k/day free tier. Roughly two days including the
  per-client deploy story.
- **Option C, WhatsApp Cloud API. The real answer when there is budget.** A genuine image
  message with a caption, and the only option that removes the ban risk behind the "no send
  all" rule. Indonesian rates are per 24-hour **conversation**: utility about $0.0212
  (~Rp 336), marketing about $0.0492 (~Rp 780), guest-initiated free. So confirming a booking
  costs roughly Rp 336 and everything else that day is included. The real costs are Meta
  Business verification, a dedicated number that can no longer be used in the normal WhatsApp
  app, and template approval for anything the restaurant initiates, which is a material change
  to how ops edits templates in Broadcast today. **Price it into the licence rather than
  absorbing it**; at 300 bookings a month it is about Rp 100k, small but recurring per client.

Suggested order: B when a client asks, C when one is big enough to want automated
confirmations, A only if the front desk stops being a PC.

---

## 9. Branding, the voucher card, and guest-page language

### Per-client branding

Three `app_settings` rows carry it:

- `branding`: main logo and small mark, uploaded into the `branding` storage bucket, read
  through `brandAsset()` / `applyBranding()`. Covers reserve, reservation-created,
  reservation-confirmation, spin, the staff login and sidebar, the invoice and the voucher card.
- `reserve_appearance`: the booking page and the thank-you page after it. Delivered as CSS
  custom properties (`--rf-bg-image`, `--rf-glass`, `--rf-logo-max-h`, plus `--primary` /
  `--dark`), so applying settings is a few `setProperty` calls and the bundled values stay in
  each page's `:root` as the fallback.
- `voucher_style`: see below.

The files in `assets/` are the fallback throughout, so a client who has uploaded and configured
nothing still sees a working, on-brand page.

### The voucher card is drawn, not a picture

It is painted in code from `app_settings.voucher_style` (background, accent and text colours,
logo scale) plus the Branding logo. Every secondary colour, the muted labels, hairlines and
fine print, is **derived** from those three, because asking an owner for six colours and hoping
they harmonise is how cards end up unreadable. Settings > Vouchers > Card Design previews with
the real renderer, not a mock-up.

`use_artwork` switches back to the old behaviour for a client who genuinely has designed
artwork; the file still lives in `app_settings.branding.voucher_bg_url`, and the migration
flips existing artwork users into that mode automatically so nobody's card silently changes.
The artwork is a fixed 1084 x 1940 canvas with the middle band left empty for the drawn text,
and the upload screen checks the pixel size.

Two traps in the renderer:

- **Canvas tainting.** A logo from Supabase Storage is cross-origin, and drawing it taints the
  canvas, so `toDataURL()` throws and the download button silently does nothing. `loadImage`
  sets `crossOrigin = "anonymous"` for any http(s) source. Storage sends the CORS header; a
  `file://` page does not, which is why local screenshot harnesses need
  `--allow-file-access-from-files`.
- **A dark card hides a dark logo.** The contrast warning checks text against background AND
  measures the logo's own average luminance, ignoring transparent pixels. The default mark is
  dark navy and vanishes on a navy card, which is the first thing a client trying dark colours
  will hit.

### Guest-page language

`js/guest-i18n.js` is loaded by all four guest pages, including `reserve.html`. The pages are
authored in **English** and translated into Indonesian at runtime, Indonesian being the
default. Same direction as the staff app and for the same reason: the dictionary is keyed by
the English sentence as written in the page, so a missing entry shows readable English rather
than a blank label or a raw key.

---

## 10. Migrations

**One file: `ALL_IN_ONE.sql`.** Paste it into the Supabase SQL Editor and run it. That is the
whole procedure for a brand new client and for an existing one. It is idempotent: every
`CREATE` is `IF NOT EXISTS`, every trigger and policy drops itself first, every seed insert is
guarded, and functions that change shape are dropped before redefinition. So there is no
"which migrations has this client had?" bookkeeping.

**The one exception is `20260911_roles_enforce.sql`.** It is not in the file, is one-time, and
`ALL_IN_ONE.sql` must not be run after it. See section 3.

### The rule that keeps the single-file approach working

Anything added to the file must be safe to run twice. New table `create table if not exists`,
new column `add column if not exists`, new index `create index if not exists`, new trigger or
policy `drop ... if exists` immediately before creating it, a function whose return type or
arguments change gets dropped first, seed data `on conflict do nothing` or
`where not exists`. Break that once and the file stops being re-runnable, which is the property
the whole approach depends on.

### Proving it before a client sees it

Reading the SQL cannot tell you whether it is complete. Building a database from it and asking
the application what it expects can. Eight missing objects have been found this way, including
`wa_campaigns.slug` (without which Broadcast > Campaigns was not degraded on a new client, it
was unusable) and the `promo-images` bucket (without which every campaign share image resolved
to nothing).

```
1. run migrations/ALL_IN_ONE.sql on the empty Supabase project
2. run scripts/schema-dump.sql in the same SQL editor, save the JSON
3. npm run schema-check -- catalog.json
```

No local Postgres needed. Run it for every new client, after the migration and before handing
anything over. **Know its limits**, written at the top of `scripts/schema-refs.js`: it proves
an object EXISTS, never that its type, nullability, default or foreign key is right, and RLS
and grants are entirely out of scope. A green run means "no missing object of the kind that has
bitten us eight times", not "this database is correct". `tests/schema-refs.test.js` pins the
scanner itself, because a checker that quietly misses a column is worse than no checker.

**And an empty-database run proves almost nothing about safety.** See the rule of that name in
`CLAUDE.md`. Rehearse on seeded data; `demo/` exists for this.

### Applying to a database with real data in it

Rehearse first. Wrap the whole thing in a single `DO $$` block with
`GET DIAGNOSTICS ROW_COUNT` assertions per statement, run it once ending in
`RAISE EXCEPTION 'DRY RUN OK'` so it rolls back, then re-run without the RAISE.

Pushing the website does not execute database migrations. A missing-column error on save
(`block_buffer_minutes` was the common one) means the app shipped ahead of the database.
Migration and frontend are two halves of one change and belong in the same push.
