# Decisions that future changes must preserve

Current code and the user's accepted scope take priority over historical proposals.
This records material decisions and their consequences, not a list of every UI edit.

| Decision | Reason | Implications / constraints |
|---|---|---|
| Settings grouped by task, with sidebar children and category-local tabs | Booking, payment, spending and loyalty controls need predictable homes | Keep existing role gates; saves update only their section, even when sections share a JSON settings row. Area deposit amounts have one editor. Compact sidebar preference is device-local. |
| One client, one Cloudflare deployment and Supabase project | Isolation and manageable per-client configuration | No shared multi-tenant database. Never point a preview/client at another client's DB. Separate origins avoid shared browser storage. |
| One private codebase; configuration at build time | Avoid divergent per-client forks | Source remains private but published frontend is inspectable. License/ownership arrangements do not hide JS. Server-only privileges/logic stay server-side. |
| `main` for development, deliberate promotion to `release` | Prevent work-in-progress reaching restaurant service accidentally | Verify each host's actual branch before push; branch names are not database environments. Release hotfixes must be brought back to main. |
| Keep username/PIN login with linked Supabase Auth | Preserve front-desk workflow while giving DB calls verified identities | Do not replace with email login or local-only PIN checks. Four digits remain weak entropy; fixed prefix is not extra security. Never restore plaintext staff PIN storage. |
| RLS, protected RPCs and active DB roles are authoritative | Browser code/localStorage is editable | Preserve Phase 1 and Finance guards, private implementations, trusted actor attribution and QRIS restrictions. No broad grants as save-error fixes. |
| Owner read-only; Admin full; Manager restricted payment destination; Staff and Finance operational roles | Separate summary oversight from fraud-sensitive configuration without rigid job silos | Staff can issue deposit invoices; Finance can issue all invoice kinds/vouchers. Waivers for Staff/Finance are per-account Admin toggles. UI hiding alone is insufficient. |
| Reset cutoff uses Auth session creation, not JWT issue time | Token refresh must not revive a pre-reset session | Pending reset locks account. Finalization failure stays locked; service-only recovery. UI rechecks supplement, never replace, DB enforcement. |
| Narrow public RPCs and token lookups | Guests need booking/invoice/ticket flows without staff accounts | Public configuration reads are intentional, general anonymous access is not. Token output must avoid sensitive extra fields. |
| Fresh bootstrap differs from upgrades | Old consolidated SQL can overwrite secured wrappers and grants | ALL_IN_ONE and roles_enforce cannot be rerun on secured projects. Link accounts before enforcement; targeted migrations afterward, with stop-on-error and representative data tests. |
| Timed capacity and preparation buffers shared between picker and DB | Prevent UI accepting a table that save rejects, and prevent simultaneous double booking | Half-open windows, date locks, own-booking exclusion, snapshotted duration. Waitlist does not hold seats; Incoming does. |
| Visits are attendance; reservation status is staff intent | Closing-time cleanup previously counted no-shows as diners | Ask when completing without a visit. Metrics and loyalty use actual non-voided visits; no phantom arrivals. |
| Area or pax deposit policy, without automatic per-pax arithmetic | Staff negotiates amounts that can vary by day | Pax thresholds classify requirements only. Public pax mode says staff will contact; area mode shows amount. Staff may override defaults/request custom deposits. |
| Large bookings may use simple deposit or detailed deposit + settlement | Size does not always imply a complicated invoice | Preserve chosen/issued format. Large requests have no automatic deadline. Full requested deposit, not any partial receipt, triggers automatic Reserved status. Capacity still applies. |
| Payments are ledger rows, not paid flags | Partial receipts/refunds and void invoices must remain reconcilable | Voiding a document moves no money. Deposit request may be smaller than full bill. Settlement must not rewrite the deposit requirement. |
| Explicit Includes deposit choice with saved snapshot | Avoid double-counting a received deposit and changing totals on repeated edits | Checked = final entered total; unchecked = input + net deposit (no settlement). No automatic historical backfill. First explicit historical edit applies chosen rule. |
| Independent financial tracking toggles, default-on | Restaurants may use deposits, visit spending, both or neither without losing operational history | One `financial_tracking` settings row; missing keys mean enabled. Disabling preserves historical data and blocks new financial state in PostgreSQL. |
| Recorded zero is distinct from skipped spending | Zero is known financial data; skip is intentionally missing data | `spend_amount=0` + `recorded` versus `spend_amount=NULL` + `skipped`; historical nulls are not silently classified. |
| One invoice document and shared renderer | Staff preview, saved invoice and guest PDF must agree | Preserve document overrides/locks. PDF styles use literal colors where html2canvas cannot resolve custom properties. |
| Ticket is confirmation, not check-in scanning | A downloadable guest-facing confirmation meets the requested scope | Reserved only; stable token, live details, restricted fields; no invented scanner system. |
| Ten active campaigns, no cross-campaign cooldown | User accepted overlapping campaigns and possible repeated guest contact | Unlimited drafts; starting one must not close others. Keep outreach attribution and explicit user sending. No bulk auto-send. |
| Manual follow-up acknowledgement is separate from opening WhatsApp | Staff can be interrupted before sending | Bell stays pending until checked, including Arrived/Completed. D-1 and D-day reminders remain distinct. |
| Boot cover separate from ordinary navigation spinner/skeleton | Competing loading layers caused flicker and blank transitions | Keep lifecycle ownership and reference counting; test slow/error/back-forward/logout paths. |

## Product context retained, not implemented promises

Management visibility (2026-09-14): Owner/Admin/Manager share the management overview;
only Admin/Manager retain the separate operational dashboard. Foot traffic is actual
non-voided visit pax. Guest Load separates arrivals from pending demand without claiming
live occupancy. Management large-party visibility defaults to 8 pax and is independently
configurable, without changing deposit/public-booking classifications. Financial tracking
toggles stop the relevant current workflows/widgets, but preserve access to historical
recorded spending and deposits. Deposits and spending must not be added together as revenue.

- The commercial intent is a license buyout with optional maintenance; trials are initially
  owner-managed, with client infrastructure ownership handled separately. Confirm contractual
  arrangements per client; do not infer permission to transfer code/accounts.
- Multi-branch UI, a fleet migration runner and automatic WhatsApp media/API delivery were
  discussed, not delivered by this work. No current pricing or provider limit is promised here.
- Shared rendering, manual WhatsApp attachment limitations and server-readable Open Graph
  tags motivated earlier designs. Recheck provider APIs/pricing when implementing integrations.

Detailed defect-derived rules are in [DEVELOPMENT_RULES](DEVELOPMENT_RULES.md).
