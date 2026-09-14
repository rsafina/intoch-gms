# Implemented architecture

Repository audit: 2026-09-14, code baseline `d89252c`. Read [CURRENT_STATE](CURRENT_STATE.md)
for deployment uncertainty. Earlier specifications are design history, not current security
or migration instructions. [DECISIONS](DECISIONS.md) explains why the constraints exist.

## Runtime and files

The staff app is `index.html`, with section visibility controlled by `navigateTo()` in
`js/app.js`. It remembers the last page in localStorage; it does not implement URL/history
routing. Scripts share global functions/state and many inline event handlers. Script order
matters. Tailwind/CDN libraries and local feature CSS coexist; there is no framework build.

| Location | Responsibility |
|---|---|
| `js/app.js` | Staff dashboard, reservations, guests, walk-ins, reports, settings, completion/spending |
| `js/config.template.js` | Supabase client, settings, translations, branding, role/page controls, date helpers |
| `js/staff-auth.js` | Username/PIN mapping, verified session restoration and session monitor |
| `js/owner-dashboard.js` | Owner/Admin/Manager overview, Reservation Outlook, financial history and management threshold |
| `js/reservation-extras.js`, `js/deposit-policy.js` | Online-form overview, staff deposit controls, area/pax classification |
| `js/membership.js` | Member cards, transactions, stickers, member vouchers and visit conversion |
| `js/invoice.js`, `js/invoice-sheet.js` | Editor/saved invoice flow and shared preview/PDF rendering |
| `js/vouchers.js`, `js/voucher.js` | Standalone voucher operations and canvas card rendering |
| `js/wa.js`, `js/broadcast.js`, `js/campaign.js`, `js/campaign-editor.js` | Templates, click-to-chat, audience and campaign workflow |
| `js/notify.js` | Online booking bell, checklist, reminder slots and refresh recovery |
| `js/page-loading.js`, `js/version-check.js` | Boot loading lifecycle and deployed-version notice |
| `js/runsheet.js`, `js/reservation-ticket.js` | Run sheet and guest confirmation ticket |
| `*.template.html`, `js/guest-i18n.js` | Generated public pages and guest translations |
| `reservation-ticket.html` | Tracked static ticket page; reads generated config, not a build template |
| `css/` | Shared/feature styling including reservations, invoices, ticket and loading |
| `supabase/functions/staff-account/index.ts` | Only checked-in deployable Edge Function |

`reference/promo-netlify-function.js` is a porting reference, not a deployed Cloudflare
function. `docs/manual/` and screenshots are documentation tooling. Demo SQL is separate
from application operation and must never be treated as a production update.

## Supabase and database

Browser supabase-js calls PostgREST queries, RPCs, Auth, Storage and Realtime directly.
There is no general application backend proxy. Postgres owns critical concurrency,
authorization, payment/status and membership rules. `app_settings` stores JSON settings.
The `financial_tracking` row independently controls deposit and spending tracking; missing keys default to enabled for existing clients. Disabling a feature preserves historical rows while PostgreSQL prevents new financial state.

| Data | Main objects |
|---|---|
| Identity/configuration | `staff_users`, `app_settings`, `areas`, `tables`, `reservation_exceptions` |
| Guest activity | `guests`, `reservations`, `visits`; `guest_visit_stats`, `online_reservation_performance` |
| Money | `invoices`, `invoice_payments`; `invoice_balances`, `reservation_money`, deposit balance views |
| Loyalty | `members`, `member_transactions`, `member_vouchers`, `standalone_vouchers` |
| Outreach | `wa_templates`, `wa_outreach_log`, `wa_campaigns`, `wa_campaign_audience`, `birthday_greetings` |
| Other public flows | `prizes`, `spin_submissions`, featured dishes and spin RPCs |
| Private enforcement | `app_private` guarded implementations, triggers and `role_audit` |

The database base is `migrations/ALL_IN_ONE.sql`, a historical consolidation with repeated
definitions. Later targeted migrations supersede it. It is not the complete secured schema
by itself. The [migration guide](../migrations/README.md) gives the dependency order.

## Authentication and authorization

Login remains username plus four-digit PIN. `staff-auth.js` maps the username to an internal
Auth identity and derives the Auth password; `loginStaff()` uses `signInWithPassword`.
The fixed password prefix adds no entropy. PINs are not stored as plaintext staff-table
credentials after enforcement. Supabase Auth rate limiting remains important.

`staff_users.auth_user_id` links Auth to staff identity. Restoration calls Auth `getUser`,
`app_session_valid`, then reads the active linked staff row. localStorage is a UI cache only.
`app_staff_role()`/`app_staff_id()` are SECURITY DEFINER helpers resolving the verified actor.
With `20260917_session_notifications.sql`, operational authorization also requires an active
`auth.sessions` row whose creation time is later than the staff reset cutoff and no pending
PIN reset. The Auth session table is only read. A refreshed token cannot bypass the cutoff.

| Role | Current operational access |
|---|---|
| Owner | Read-only summary and reports; no operational writes |
| Admin | All pages, accounts, bank/QRIS/payment instructions |
| Manager | Operations/reports, waivers and privileged adjustments; no accounts/payment destination changes |
| Staff | Dashboard, Reservations, Walk-ins, Guests, Membership; reservation deposit invoices and positive payments |
| Finance | Dashboard, Reservations, Guests, Membership, Invoice and Vouchers; invoice/voucher issuance; default deposit queue |

Staff and Finance may waive deposits only with the Admin-controlled per-account flag.
Finance does not get Walk-In writes, settings, deletions, negative adjustments or standalone
voucher redemption/voiding. UI page access is not equivalent to the whole SQL permission
matrix; read policies and guarded operations are defined in the role migrations.

Phase 1 replaces permissive table policies with verified-role RLS, protects settings and
money through `app_private.protect_changes()`, and wraps privileged RPCs with
`app_private.require_access()`. Finance adds narrow policies/guards. Actor arguments are
replaced with verified staff IDs in protected wrappers. Trigger/helper execution privileges
matter independently of table RLS. Storage policies restrict writes and reserve QRIS for
Admin. Audits exclude PINs and cannot be edited by ordinary API clients; no audit UI exists.

Public guest flows remain anonymous through selected configuration reads and narrow RPCs:
public reservation/spin submission and token-based invoice/ticket lookups. They do not receive
general guest or financial-table access. Do not replace these with anonymous direct writes.

### Account management and session lifecycle

The Deno `staff-account` endpoint verifies the bearer with Auth, checks active Admin and
`app_session_valid`, then writes staff records as that caller. A server-only service client
creates Auth identities or changes passwords. A failed staff insert cleans up the new Auth
identity. PIN reset uses `begin_staff_pin_reset`, password update, then service-only
`finish_staff_pin_reset`; concurrent resets are rejected. A failed finalization leaves the
account locked for administrator recovery, rather than permitting stale access.

Open clients check session validity every 15 seconds while visible, on focus/reconnect and
Auth events. Logout/invalid-session paths clear UI state, remove subscriptions and reload.
Hidden-tab throttling and network failures mean this is not an instantaneous screen-erasure
guarantee; DB authorization is independent of the next UI check.

## Reservations, guests, walk-ins and reports

Guests are reused rather than recreated on every booking. A booking's `booking_name` can
differ from the guest's stored name. Existing-phone/new-guest and retry flows must avoid
duplicate guest creation. Staff creates reservations from the modal; public booking goes
through a restricted RPC. `visits` represent actual attendance/spending, linked to a booking
when applicable. Walk-ins also produce visits. Voided visits must be excluded from metrics.

The management dashboard now serves Owner/Admin/Manager with Today volume, actual visit-pax
traffic, Guest Load and conditional financial summaries. Reservation Outlook is a separate
read-only page; Admin/Manager retain Staff Dashboard. The large-party visibility threshold
is separate from deposit policy. Historical financial reporting remains accessible when
tracking is disabled. See [metric definitions and rollout](MANAGEMENT_DASHBOARD.md).

The staff dashboard retains Today/+1/+2 and an online-form two-week summary linking to the
reservation list. The list has daily/weekly/monthly/custom ranges, online-only/status filters,
compact expandable occupancy/VIP availability, and reservation actions. Only daily mode has
previous/next navigation.

Capacity uses timed, half-open hold windows: start minus preparation buffer through explicit
end, or snapshotted duration. `reservation_hold_window`, aggregate capacity, table availability
and save guards share this definition. Holds include Reserved/Confirmed/Incoming/Arrived;
Waitlist holds no capacity. Active walk-ins affect availability. Date advisory locks and
database guards arbitrate simultaneous saves. The UI greys conflicting tables, excludes the
edited booking from its own check, and must not silently ignore unavailable capacity data.
Area capacity and summed table seats are distinct concepts.

Completion without a visit asks whether the guest arrived. No means No Show without invented
spending; yes establishes the visit before completion. Reports must use actual visits, not
infer attendance from a staff status click. Retention is lifetime-based, and sparse/unequal
comparison periods should not display misleading growth figures.

## Deposits, invoices and spending

Area mode remains the default. It uses an editable flat amount per area. Pax mode stores
`deposit_free_pax` and `deposit_regular_max_pax` (defaults 1 and 20); above the free threshold
requires a staff-quoted amount. Zero free pax means everyone requires deposit. This is
classification, **not price multiplied by pax**. Public pax mode shows a contact-later notice;
area mode can display its amount. Staff can request/edit a deposit even when the area's
public configuration has none. Rules/format are saved with the booking.

Regular quoted requests use Incoming and the existing deadline flow; unquoted requests do
not start a payment deadline. Large requests use Waitlist without automatic expiry. Staff
may choose a simple large deposit or detailed deposit/settlement invoices. Issued formats
cannot silently switch. Capacity-waitlisted requests must be accepted before requesting money.

Recorded net payment reaching the requested deposit promotes the booking in the same
transaction, subject to capacity. Below the requested amount remains pending. Incoming has
no ordinary manual Reserved button; waiver is the audited alternative. Do not generalize
older discussions of overrides into a bypass of current payment or capacity guards.

`invoice_payments` is the ledger, with direct reservation OR invoice association, not both.
Refunds are negative records; invoice voiding does not erase money. `invoices.doc` is the saved
document snapshot, with queryable derived amounts. Deposit/settlement/general are invoice
kinds, while paid state is derived. The newest issued deposit request determines the requested
amount, not necessarily the full agreed bill. Staff and guest render the same invoice sheet.

`save_visit_spending` atomically creates/updates the visit and completes its reservation.
Checked **Includes deposit** saves the entered final total; unchecked adds actual net deposit
receipts, excluding settlement and waived/unpaid amounts. It snapshots the deposit and saves
input/choice so reopening cannot double-count. Historical rows are untouched until explicitly
edited. Changed deposit context before first save forces review. Membership consumes final
saved spending, not the raw input. Finance may save reservation spending but not walk-ins.
`finish_visit_without_spending` completes a real visit with `spend_amount = NULL` and `spend_recording_status = 'skipped'`. Explicit zero remains `spend_amount = 0` with status `recorded`; legacy null rows remain unclassified until explicitly handled.

Reserved bookings can issue a tokenized confirmation ticket. Reissue preserves the token;
guest output uses live booking details and a narrow field set, hides download outside
Reserved, and includes no staff notes or guest phone. It is confirmation only, no scanning.

## Membership and outreach

Family/Company membership uses configured spend-per-sticker, stickers-per-voucher, optional
cap and voucher validity/value. SQL `add_member_transaction` and conversion/redemption RPCs
own monetary/sticker rules. Linked visit IDs protect against counting a meal twice.
Settings affect new transactions, not automatic historical recalculation. Member vouchers
and standalone gift vouchers are separate objects/workflows.

Transactional templates live under Settings > WA Templates; Broadcast holds campaign
templates. Sending uses explicit click-to-chat/download/share flows and logs outreach;
opening WhatsApp does not prove a message was sent. Ten active campaign slots are enforced
in SQL; drafts are unlimited, no cross-campaign cooldown is implemented. Promo origin/Worker
porting remain unfinished (CURRENT_STATE), so campaign management existing does not prove
the public promo URL works.

## Notifications and loading

The database is the bell's source of truth. Unticked online bookings survive past dates and
Arrived/Completed; cancelled/deleted bookings are excluded. D-1 and same-day reminder
acknowledgements are separate from the initial follow-up. Reads paginate in 150-row chunks.
Refresh occurs on startup/open, 30-second polling, INSERT/UPDATE realtime, subscription
recovery, focus and reconnect. Generation/request IDs reject old-session/out-of-order data.
Checklist writes use `set_reservation_followup`, verify success and stamp the DB actor.
Diagnostics record error codes/subscription state without credentials. Original intermittent
reports remain unproven causes; defensive changes and local tests are not a live diagnosis.

`PageLoading` owns the initial cover and a generation token; normal navigation uses the
reference-counted spinner plus page content/skeleton. Commit `5969782` separated those
lifecycles. Logout/failure uncovers appropriately. Intermittent browser flicker still needs
live regression. Local `IS_DEV` disables realtime/poll/auto-refresh, so localhost alone cannot
prove production notification behavior. Audio also depends on browser interaction/permission.

## Configuration and hosting

`node build-config.js` requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`;
`RESTAURANT_NAME` defaults to Restoran with a warning. It stamps seven generated outputs:
config.js, reserve, reservation-created, reservation-confirmation, spin, deposit-invoice,
invoice-view. Edit their templates only. Credentials are public anon/publishable, never
service-role. Public pages that declare their own client must not additionally load config
and redeclare its constants. Shared invoice rendering must stay independent of staff config.

Each client has a Cloudflare static deployment and separate Supabase project. Build variables
select that client's database/origin/branding; custom hostnames provide browser-origin
isolation. `main` is development/integration and `release` is the intended client promotion
branch. Actual Cloudflare branch/domain/project bindings live outside this repo and must be
verified before a rollout. There is no checked-in Worker deployment manifest/CI fleet runner.
`.assetsignore` excludes server source/tooling/docs from static uploads; `.gitignore` excludes
generated files/secrets from Git. Verify the chosen host upload mechanism honors exclusions.
