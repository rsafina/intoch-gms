# Intoch

Guest management + membership system sold to restaurants. Multi-client product, cloned from
`blueheron-gms` (the original, still running live at one restaurant in Yogyakarta).

Previously called Sirkel. Before that, the prototype lived in `gms-proto`.

Owner: Rere (Resafina), Product Manager. Formerly a frontend dev, so she reads code fine but
does not write much of it. Wants to understand *why*, not just be handed a fix. Ask before
building. She dislikes em dashes in writing.

**This file holds rules, decisions and current state. How the subsystems actually work, and
the data models behind them, live in `ARCHITECTURE.md`.** Read that before changing
reservations, capacity, deposits, invoices, roles or the build. Read this one first.

---

## What this repo is for

`blueheron-gms` is one restaurant's working system and is deliberately staying as it is:
vanilla HTML/JS, no build step, everything in one `index.html`. **This repo is where the
architecture work happens instead.**

Three things this repo exists to fix, in the order they matter:

1. **URL-based routing.** Blue Heron toggles section visibility, so the browser back button
   does nothing. Real UX complaint from daily use.
2. **File structure.** Blue Heron is ~29,000 lines with 8,000 of them in `index.html` and
   11,600 in `app.js`. Unhirable. A developer cannot find anything.
3. **Per-client configuration**, so one codebase serves many restaurants.

Item 3 is done (`ARCHITECTURE.md`, "Config and build"). Items 1 and 2 are not. `app.js` is
now ~16,000 lines and `index.html` ~9,400, though CSS has been pulled out into `css/` and
six feature areas now have their own JS file.

---

## Current state, 12 September 2026

**Staff authentication and database-enforced roles are LIVE**, including the four follow-up
migrations the rollout turned out to need. Every migration is applied to Supabase, staff
accounts are linked, the edge function is deployed, and the code is up on both staging and
production.

What that means in practice, and what it does NOT mean, is in `ARCHITECTURE.md`, "Staff auth
and roles". Three things matter enough to repeat here:

- **Every request now carries a JWT.** Policies that test the caller's verified role work
  and are the enforcement layer. The old rule "do not write a policy that tests
  `auth.role()`" is dead. Do not follow it.
- **The PIN is still four digits of entropy.** The `Intoch-PIN:` prefix only satisfies
  Supabase's password-length requirement. Auth rate limiting is now the only thing between a
  guessed PIN and a real session. Auth is enforced, not strong. Do not record this as solved.
- **`migrations/20260911_roles_enforce.sql` is one-time and one-way**, and
  `ALL_IN_ONE.sql` now **refuses to run** on a database that has it, aborting with "Phase 1
  roles are installed. Do not rerun ALL_IN_ONE.sql; apply only targeted migrations." A new
  client is eight ordered steps, listed in that file's own header. A secured client gets
  targeted migrations only.

Also live since 7 September: the deposit flow, the large-party gate, saved reservation
invoices, whole-area time blocks, timed table capacity, the table picker availability check,
multi-table assignment, guest reservation tickets, ten concurrent broadcast campaigns, the
Owner/Admin read-only summary dashboard, and the per-staff deposit waiver permission.

### The role rollout broke four saves, and they all broke the same way

Worth reading even though all four are fixed, because the pattern will recur the moment
anyone adds a function.

`roles_enforce` revokes EXECUTE on every function in `public` and re-grants only the ones on
its authorized list. That list was written for the RPCs the app calls. It did not account for
the **helper functions the database calls by itself while saving a row**, which are invisible
from the application's point of view and therefore from the list.

| What broke | What staff saw | Fix |
| --- | --- | --- |
| Table assignment. `normalize_table_assignment()` takes `FOR SHARE` on `tables`, which needs edit-level row visibility, and staff may not edit table settings | "One or more selected tables no longer exist" on any booking with a table | `20260912_roles_save_paths.sql` |
| The spending-tier recalculation after every reservation and walk-in | `permission denied for function recalculate_guest_spending_tier` | same migration |
| `invoice_document_rupiah()`, which turns "2.500.000" into a number | `permission denied for function invoice_document_rupiah` on any deposit or settlement invoice save | `20260912_roles_invoice_amount.sql` |
| The voucher default triggers that fill in a code and an expiry | a voucher insert relying on database defaults failed | `20260912_roles_voucher_defaults.sql` |

The fix in every case is the same and is the right one: the **trigger** becomes SECURITY
DEFINER with a pinned `search_path`, so it runs as its trusted owner, while the helper stays
unreachable as an RPC. Never fix one of these by granting the helper to `authenticated`
unless it is genuinely a pure calculation with no privileges attached, which is why
`invoice_document_rupiah` was granted and `recalculate_guest_spending_tier` was not.

`tests/role-save-paths.test.js` reproduces the original errors on a real Postgres, applies
the fix, and re-asserts that staff still cannot edit tables or call the tier helper by hand.

**Two trigger functions have still not been exercised under enforcement**, and both are in
the category that fails quietly:

- `sync_live_table_assignment()` copies a table change between a booking and its live visit.
  It runs as the caller and its two `UPDATE`s **cannot tell a blocked row from a row that
  does not match**, so if RLS hides the partner row the sync silently does nothing. Same
  failure mode as the rule below about writes that do not ask for their row back.
- `guard_last_admin()` is the never-zero-active-admins rule, which lives in the database
  precisely because the JavaScript is public. It now counts `staff_users` under both RLS and
  column-level grants. If a policy hides rows from that count it could block a legitimate
  demotion, or permit removing the last admin.

Neither is covered by the new tests. The harness in `role-save-paths.test.js` makes both
cheap to add. The other five trigger functions are either already fixed or carry no
privileged access (`sync_reservation_deposit_deadline` and `update_updated_at` are pure
assignment).

### What is not built, roughly in order of usefulness

1. **Cover the two unexercised triggers**, `sync_live_table_assignment()` and
   `guard_last_admin()`. Cheapest item on this list and the only one guarding a rule that
   protects the system from itself.
2. **Routing, file splitting, inline handlers.** The three reasons this repo exists.
3. **Hashing or lengthening the PIN.** See above. The auth layer now exists to hang this on.
4. **A campaign link origin fix.** `js/campaign-editor.js`, `js/campaign.js` and
   `js/broadcast.js` still hardcode `https://your-site.example` as the promo link origin, so
   every generated campaign link is wrong. Same root cause as the old share-preview bug,
   different blast radius: those constants are asserted by 257 campaign-editor tests. Feed it
   `SITE_URL` as its own change.
5. **Porting the promo function to a Cloudflare Worker.**
   `reference/promo-netlify-function.js`. Until then campaign promo links do not work.
6. **The remaining hardcoded strings on guest pages.** `reservation-confirmation.html` says
   `Restoran` in its body heading and in the Google Calendar link it builds.
   `restaurantName()` already exists to fix that. Taglines, the WhatsApp number and the
   Google Maps link are still in the files.
7. **The write-audit.** `saveArea()` proves its write landed. `saveTable` and several
   settings saves have still not been audited. See "A write that does not ask for its row
   back" below. Less dangerous than it was (a denied write now raises instead of silently
   updating zero rows) but a missing `.select()` still hides a no-op.
8. **The brand colour picker.** Two colours, `--brand` and `--accent`, stored in
   `app_settings` and applied at runtime the way `loadReserveAppearance()` already does. It
   must write `--brand-rgb` alongside `--brand` or shadows keep the old hue.
9. **One WhatsApp send carrying both the card and the message.** Scoped, not built. Options
   and costs are in `ARCHITECTURE.md`, "WhatsApp: one send with a picture".
10. **A migration runner** that loops over the client project list and applies the same SQL to
   each. Needed before client three.

### Known-lazy spots worth a pass sometime

- `js/owner-dashboard.js` uses `toISOString()` in `odDateShift`. It is safe *only* because it
  anchors at noon UTC. It is the exact pattern banned below, and the next person to copy that
  line will not anchor it. Convert it to `ymd()` or comment it loudly.
- Three duplicate keys in `ID_DICT` (`Spending Tier`, `Remove`, `Average Spend`). A duplicate
  key in a JS object literal is silently overwritten by the last one.
- A test that reads source text and finds nothing passes for the wrong reason. This has
  happened five times here: `brand-tokens.test.js` kept passing after the invoice CSS moved
  out from under it, examining zero rules. When a check greps for the ABSENCE of something,
  strip comments first and assert it actually examined something.
- Two tests fail and both predate the current work. Do not "fix" them by changing the
  assertion until somebody decides which side is right.
  - `js/invoice.i18n.test.js` "closing line": the footer says "We look forward to welcoming
    you :)" and the test expects "We look forward to welcome you at Restoran :)". Somebody
    fixed the grammar and dropped the restaurant name without updating the test. **Rere's
    call which wording ships.**
  - `js/vouchers.test.js` crashes on a null voucher in the redeem step (`vchStatus` reading
    `.voided` of null). Reproduced against committed code.

---

## Sales model (decided, do not re-litigate without cause)

- **One client, one stack.** Each client gets their own Supabase project and their own
  Cloudflare project. Fully isolated, no shared multi-tenant database.
- **License buyout.** Client pays once for perpetual use. **Code stays in Rere's private
  repo**; the host only ever receives built output. Optional yearly fee covers updates.
- **Trial for 1 to 2 months** on Rere's own accounts, for kill-switch control. After
  payment the Supabase project transfers to the client's org. Code never transfers.
- Rejected: creating accounts under client emails. The client can password-reset and lock
  Rere out.
- **Secret sauce goes server-side** (database functions or Workers), since frontend JS is
  public either way.
- **Multi-branch is a someday scenario.** `stores` table and `store_id` columns go in the
  schema now while it is free; the branch-picker UI waits until a multi-branch client pays.
- Scale expectation: 10 to 20 clients, managed solo.

Each client's Supabase can sit on **their own free tier**. Blue Heron is a real restaurant
with a year of trading and its database is 14 MB against a 500 MB free limit. So a client
project costs the client nothing and costs Rere nothing. Rere's own free allowance (2 active
projects) only needs to cover concurrent trials.

Cloudflare serves static assets **free and unlimited** (asset requests do not count toward
the 100k/day Workers limit), so hosting any number of client apps costs nothing.

---

## Rules that must not be re-broken

Each of these was found the hard way, most of them in Blue Heron. Porting the code without
porting the rules reintroduces them.

### Dates: `ymd()`, never `toISOString()`

`date.toISOString().split("T")[0]` formats in UTC. Clients run at UTC+7, so local midnight
serialises as the previous day. **`gms-proto` had this in 18 places.** Use `ymd(date)`, which
uses local getters.

Invisible when testing in UTC or any UTC-negative zone. Test with `TZ=Asia/Jakarta`.

### Never declare a local variable named `t`

`t` is the translation helper. Shadowing it turns every `t("...")` into
`TypeError: t is not a function` and silently kills whatever screen it is in. A static check
with acorn (find `t("literal")` calls, walk the scope chain, fail if any local binds `t`) is
worth having in CI.

### A write that does not ask for its row back cannot tell success from silence

Use `.select()` on every `update`/`insert` and treat an empty result as a failure, the way
`saveArea()` does. Before roles enforcement, a write no policy permitted updated zero rows
and PostgREST answered `204`, byte-identical to success: **every edit to an area silently did
nothing for days** while the app said "Area updated". Enforcement now raises instead, but a
filter that matches nothing still returns an empty success.

### A status written by a human at end of shift records intent to tidy up, not what happened

The visit row is the event. Front desk marks everything `Completed` at closing, no-shows
included. **15 Blue Heron reservations were Completed with no visit behind them, 7.7% of all
completed bookings, 91 pax, every one flipped on the day between 16:00 and 21:30.**

So: never infer an arrival from a status. Any new metric reads the visit join, the way
`online_reservation_performance` does and was right about those bookings the whole time.
Counting `status = 'Completed'` counts a click. Any code path writing
`status = 'Completed'` on a reservation must first establish that a visit exists. Grep
`"Completed"` before adding another one.

`confirmCompleteVisit()` asks rather than guesses: with no visit row it reveals
`#complete-arrived-ask`. **Yes** creates the visit (same shape as the Arrived insert, keep
the two in step) then does spend, sticker and tier. **No** sets `Cancelled (No Show)` and
demands no spend, and that branch runs BEFORE the mandatory-spend check on purpose:
requiring a number for a no-show is what pushed staff into completing them with a fake one.
**Nothing picked** refuses with an inline error. Auto-creating was tried and is wrong, it
invents arrivals. Blocking until Arrived is clicked was rejected too, because the front desk
hits that wall exactly when they are busiest. Covered by
`tests/complete-reservation.test.js` (24 assertions, mutation-checked against the pre-fix
code).

### Realtime channels MUST be torn down on logout

`db.channel(topic)` returns the EXISTING channel when one with that topic is already open,
and calling `.on()` on a channel that has already been subscribed **throws**:

    cannot add `postgres_changes` callbacks for realtime:rt-today-updates
    after `subscribe()`

`logoutStaff()` used to reset `appInitialized` without removing the channels, so the next
login re-ran the boot sequence, hit an already-subscribed channel and threw. The throw
escaped `initializeApplication()` and **every line after it never ran**: the online
reservation bell, its chime, and the overnight auto-refresh. Reported as "notifications don't
work unless I refresh the page"; a refresh cured it because a fresh load starts with no
channel.

- Hold a reference to every channel and `db.removeChannel()` it in logout, BEFORE clearing
  `appInitialized`. `tests/realtime-lifecycle.test.js` asserts this against the real
  `@supabase/supabase-js` and re-proves the library behaviour the bug rests on.
- **Every optional boot step gets its OWN try/catch.** Realtime, the bell, auto-refresh and
  the version check are enhancements over an app that already works on timers. None of them
  may take the others down.
- A teardown must clear its once-only guards too (`_resNotifyStarted`), or a crash is traded
  for something worse: a silent bell with nothing on screen saying anything is wrong.

### Two functions in one concatenated SQL file can drift apart, and this pair did twice

`ALL_IN_ONE.sql` concatenates migrations in order, so **the last definition of a function
wins**, and two related functions can end up paired with versions of each other that were
never meant to meet.

`calculate_guest_spending_tier` was redefined three times, ending at
`RETURNS TABLE(tier, qualified_at)`. `recalculate_guest_spending_tier` was redefined twice,
ending with a call shape for a scalar. The correct recalculate_ sat EARLIER in the file than
the stale one, so the stale one survived. Postgres does not complain: selecting a
TABLE-returning function into a text variable stringifies the whole row, so a guest with no
spend produced the literal string `(,)`, the CHECK constraint rejected it, and **every
walk-in and every reservation failed**, leaving the guest row behind, under the misleading
error `guests_spending_tier_check`.

- **The constraint was not the bug.** The obvious fix is to widen the CHECK to admit the new
  value. That would have written `(,)` into every new guest's tier column and turned a loud
  failure into a silent one. When a CHECK fires, first ask what wrote the value.
- **A redefined function needs every caller re-checked, by calling it**, not by reading it.
  Reading the definitions is exactly what failed to catch this for months.
- **The pair must stay adjacent.** `recalculate_` goes directly beneath the last
  `calculate_`, and moves with it. Both carry a comment saying so, and
  `tests/migration-order.test.js` fails if a top-level write to visits or reservations
  appears before the pair agrees.

It has now drifted twice, once by definition and once by ordering. Treat any edit near it as
high risk.

### An empty-database migration run proves almost nothing

`ALL_IN_ONE.sql` was built onto an empty Postgres twice, declared safe, then aborted on
Rere's seeded database on the first real run. The defect above sat behind a `booking_name`
backfill: **on an empty database that backfill matches no rows, so the trigger never fires.**

**Every backfill and data repair in that file is untested by an empty run.** Rehearse on a
database holding at least a guest, a visit with real spend, and an Online Form reservation
with a NULL `booking_name`. That fixture reproduces this class in seconds.

### The first-timer segment needs both halves of its predicate

Segment = first ever visit inside the window **AND** `lastVisit === firstVisit`. Without the
second half, a guest who came back inside the window gets a "please come back" message.
Compare last-to-first rather than `visitCount === 1`, so lunch plus dinner on the same day
does not count as a return. The dashboard count and the segment size must be computed the
same way, or the two screens disagree and it reads as a bug.

### Broadcast queries must filter `.is("voided_at", null)`

Without it, a guest whose only visit was a voided mis-entry looks like they visited, and
Broadcast disagrees with the dashboard.

### A promo image with no `{link}` in the template fails silently

The message goes out clean, with no link and no preview card, and nothing warns anyone.
Hard-block it. The reverse (link, no image) still delivers something useful, so that stays a
warning. Keep the asymmetry.

### Reservation source: dropdown, but option values stay English

Only labels translate. Otherwise the channel report splits into language buckets. Legacy
free-text values must route into an "Other" box and round-trip unchanged, or opening and
saving an old booking wipes its source.

### Retention is lifetime-based

Retain = visited in the window AND had a visit before it. The tier rows (Kembali 2-4, Loyal
5-9, VIP 10+) count **lifetime** visits, not visits inside the window. Classifying by
in-window visits asks "did they eat here 5 times in these 9 days" and produces nonsense.

### Dashboard baseline guard

`adminBaselineOk()` suppresses period deltas when the comparison window predates the client's
earliest visit by less than 14 days. **Every new client starts with no history**, so without
this their first two months of deltas are pure noise. This matters far more for a product
than it did for Blue Heron. `js/owner-dashboard.js` carries its own version of the same idea
in `odMetrics`, which refuses a delta when the comparison period is empty or either end is a
partial day.

### The online form report shows "Booked On" as well as "Booked For"

A booking taken on the 26th for the 28th showed only the 28th, so the owner read the report
as an arrival log and concluded the notification bell had missed two bookings it had in fact
shown three times each. `_ofBookedOn()` renders date, time and lead as `H-n`. Lead days come
from `ymd()`, never `toISOString()`, or a 23:30 Jakarta booking reports H-1 on a same-day
walk-up.

### The bell keeps firing until someone ticks it, and the status filter must allow that

`notify.js` filtered `status in ('Reserved','Confirmed')`, so an online booking nobody
followed up vanished from the red list the moment the guest was marked Arrived or Completed,
contradicting the promise in its own header comment. **One booking sat unfollowed and
invisible for 17 days.** The list is now `['Reserved','Confirmed','Arrived','Completed']`.
Cancelled, No Show and Deleted stay out deliberately: chasing a follow-up on a cancelled
booking is noise, and noise is what gets a bell ignored.

Opening WhatsApp does **not** tick anything off, here or for birthdays. A chat window opening
is not a message sent, and front desk staff get interrupted mid-send constantly.

### `computeDaysUntilBirthday()` never returns a negative number

It rolls a passed date forward to NEXT year's occurrence, so a birthday on the 3rd, read on
the 15th, comes back as ~353. **`daysUntil >= 0` therefore does NOT mean "has not happened
yet"**, it is true for every guest alive. The first cut of the birthday badge used exactly
that test and counted every passed birthday as still outstanding. Use `birthdayHasPassed()`,
which compares the day of the month, and only inside a list already scoped to one month.

### The birthday badge is month-scoped and has a wrong-month guard

The red number counts birthdays **in the current calendar month, not greeted, not already
passed, and with a phone number on file**. The month list itself always shows everyone,
including greeted, passed and phone-less guests: seeing who has a birthday this month is the
point, the number is only the to-do part of it.

`computeBirthdayAlerts()` owns the badge and is called by three loaders, one of which is a
report a manager can page forward to December in. It takes the month and year the caller
loaded and **returns without touching the badge unless they match today's**. Remove that and
browsing the report silently clears a badge that August still needs.

Greeted state lives in `birthday_greetings`, one row per guest per calendar year,
unique-indexed so two tills cannot both insert. It is deliberately NOT derived from
`wa_outreach_log`: staff greet people at the table and from their own handsets. The WhatsApp
send is still logged like every other button; the two answer different questions.

### Guest names carry dates and titles

Front desk staff type the visit date into the guest name and will not stop. Expect it in
every client's data. Two separate cleaning functions: one that strips only the leading title
(for staff screens), one that also strips dates and parentheticals (for WhatsApp). Never
full-clean the guest list; the notes are how the host tells apart four guests named Sinta.

### Brand colour: tokens only, and the accent needs two of them

Every brand colour resolves to a token in the `:root` block. There were 728 hardcoded values
before this; do not add a 729th. Tailwind needs the explicit type:
`text-[color:var(--brand-ink)]`, not `text-[var(--brand-ink)]`.

`--brand` and `--accent` are the two a client sets. Everything else derives from them, and
derives to **pass contrast** rather than to look nice.

**The accent does two jobs.** This has been got wrong twice, so it is a rule:

- `--accent` is a **FILL**. Bars, badges, buttons, borders, anything with dark text sitting
  ON it. Never small text itself. In the app it is `#F9A825`, 1.97:1 on white.
- `--accent-strong` is the same hue pushed dark enough to read: `#9F6404`, 4.89:1 on white
  and 4.53:1 on the cream panels. **All text and icon strokes use this.**

Before this, 38 places painted text and icons with the fill colour. The old gold was retired
for failing contrast; its replacement, a pale yellow, failed too at 1.32:1, which is what
"washed up, unclear to our eye" means in numbers. `landing.html` and `spin.template.html`
still carry their own orange (`#E24701`) with the same split; whether they should match the
app is an open question, not an oversight.

Two exemptions, both real, both previously broken by a sweep that ignored them:

1. `css/invoice-sheet.css` and `INV_DEFAULTS` in `js/invoice.js`. html2canvas rasterises
   that node and does not resolve custom properties, so a `var()` there loses the colour in
   the PDF while the screen looks perfect.
2. `js/voucher.js` draws to a `<canvas>`; `fillStyle` takes a colour string.

Status colours are **not** brand and never follow it: green `#1FAF5E` / `#5F8D4E`, red
`#C0392B`, amber `#D4A017`. The amber warning family sits close enough to the orange accent
that a hue-based find-and-replace would merge them. `tests/brand-tokens.test.js` measures the
contrast itself and guards all of the above.

### Line endings

`.gitattributes` pins `* text=auto eol=lf`. Before it, a Windows editor rewriting a file
turned a 46-line change into a ~29,000-line diff.

**This matters when EDITING, and the tree is currently mixed.** `js/app.js` and
`js/config.template.js` were rewritten as pure LF on 12 September; `index.html` is still
CRLF throughout. So a whole-string `replace()` built with one ending silently matches zero
times and the edit looks like it worked. Do line-based edits that reuse each line's own ending, or normalise first.
Tests that read source text must strip `\r\n`; `tests/res-search.test.js` failed on every
Windows checkout and passed in CI until it did.

### `js/config.js` is a BUILD ARTEFACT

Edit `js/config.template.js`. Everything outside the two Supabase constants is copied through
verbatim, `ID_DICT` included, so a translation added to `config.js` alone works locally,
passes a casual glance, and is silently erased by the next deploy. `tests/` read the TEMPLATE
for exactly this reason: a test that passes while the app is broken is worse than no test.
Keep the two dictionaries identical when editing by hand.

---

## Testing approach that earned its keep

Node + `vm` harnesses, no framework. Roughly 71 test files now.

- **Smoke tests that actually RUN the loaders** against a filter-aware fake `db`, in both
  languages, asserting the KPI elements populate. Pure-helper unit tests missed the `t`
  shadowing bug entirely. Make the fake apply `gte`/`lte`/`lt`/`is`; a permissive fake
  silently suppresses the very thing under test.
- **Timezone suite** run under `TZ=Asia/Jakarta`, `UTC`, and a UTC+14 zone.
- **Real Postgres where the rule lives in Postgres.** `tests/role-enforcement.test.js` runs
  the actual policies, triggers and RPC wrappers under PGlite, including attempted direct API
  bypasses. Do not assert role safety from JavaScript alone; the JavaScript is public.
- `vm` gotcha: top-level `const`/`let` are not reachable as context properties across
  separate `runInContext` calls. Concatenate sources into one script and append a
  `globalThis.T = {setters}` footer.
- `npm test` stops at the crashing voucher file, so run `tests/*.js` directly to see the rest.
- `tests/settings-screens.test.js` and `tests/reservation-gate.test.js` use jsdom and hang
  over the Cowork device bridge. Run them locally before pushing.

---

## WhatsApp constraints (platform facts, not bugs)

- The **sending client** decides preview card size. Mobile gives a full-width card, Web and
  Desktop give a small thumbnail. Same URL, same tags. No code-side workaround exists. Tell
  the front desk the small card is normal.
- Preview image: 300px+ wide, under 600 KB, or no card is drawn at all.
- WhatsApp caches previews per URL hard and for weeks. One promo, one new URL, and never edit
  a page whose messages already went out.
- The crawler does not run JavaScript. `og:` tags must be in the HTML as served.
- Anchor text in a `wa.me` link is impossible. The raw URL always shows.
- `wa.me` click-to-chat cannot carry an attachment. That is a platform fact, not a gap in
  this app, and it is why cards are attached by hand today.
- **No "send all", ever.** Ban risk.

---

## Hosting

Cloudflare, for the whole fleet. Static asset serving is free and unlimited, and there is no
per-deploy charge, which matters when 20 client sites each need updating.

Netlify was the original host and moved its free plan to credits (~15 per production deploy).
Blue Heron hit the ceiling on 2026-08-21 and production deploys stopped with no warning. That
is the failure mode to design against: **own the domain**, so that when a host changes terms,
moving is an afternoon rather than a crisis.

Full history and reasoning: see `CLAUDE.md` in the `blueheron-gms` repo.

---

## History

Dated status notes, kept for the reasoning rather than the state. The state is the "Current
state" section at the top.

- **2026-08-21** Netlify credits ceiling hit; the fleet moved to Cloudflare.
- **2026-08-22/23** First attempt to build a database from the migration files surfaced five
  separate defects and led to the single-file `ALL_IN_ONE.sql` approach. The individual
  migration files were deleted; git holds them. See `migrations/README.md`.
- **2026-08-23** Per-client branding landed (three `app_settings` rows). The voucher card
  became drawn-in-code rather than text over fixed artwork. The invoice footer address stopped
  being one particular restaurant's. Settings > Staff shipped as an admin-only UI gate over a
  still-public table; the one genuinely enforced rule, never zero active admins, went into the
  `staff_users_guard_last_admin` trigger because the JavaScript is public.
- **2026-08-30** Share previews fixed by making the four guest pages templates stamped at
  build time, after `og:url` and `og:image` turned out to be relative and therefore broken on
  every page for every client. `ALL_IN_ONE.sql` proven buildable from empty, then found to be
  unsafe on a seeded database, which produced the empty-run rule above.
- **2026-09-05** `areas` discovered to be silently unwritable for days (RLS enabled, no
  policy a caller could satisfy, PostgREST answering 204). The app went navy/gold to
  purple/orange and every brand colour became a token. Waitlist and the configurable public
  booking form landed. Deposit became a flat rupiah amount; `deposit_pct` is dead, kept and
  commented as superseded.
- **2026-09-06** The invoice sheet was reduced to one definition shared by the staff app and
  the guest page. `.gitattributes` pinned line endings. `--accent-strong` introduced.
- **2026-09-07** Deposit flow phases 1 to 3, the large-party WhatsApp gate, and saved
  reservation invoices (database half) applied and deployed.
- **2026-09-08 to 09-11** Whole-area time blocks, timed table capacity, table picker
  availability, multi-table assignment, invoice requested-amount derivation, ten concurrent
  campaigns, guest reservation tickets.
- **2026-09-11** Staff auth and verified database roles (stage 1), then the Owner/Admin
  read-only summary dashboard (stage 2). Rollout order and its constraints:
  `ROLE_ROLLOUT.md`.
- **2026-09-12** The rollout's fallout, found and fixed in one day: four save paths broken by
  the blanket EXECUTE revoke (see "The role rollout broke four saves" above), the per-staff
  deposit waiver permission added, `ALL_IN_ONE.sql` given a hard guard against running on a
  secured database, and three Owner dashboard corrections including the missing `Confirmed`
  status. A failed booking save now keeps the guest row it created, so a retry does not hit a
  duplicate-phone error. All applied to Supabase and live on staging and production. Asset
  versions: `app.js` v51, `config.js` v35, `staff-auth.js` v2, `owner-dashboard.js` v2.
- **2026-09-13 (local, not deployed)** Added optional guest-count deposit policy in Settings >
  Reservation Form. Area mode remains the default. Guest-count mode defaults to no deposit
  up to 1 pax, regular up to 20; staff quotes the amount later. Online guests see a generic
  deposit notice. Capacity waitlists do not request payment until accepted. Large bookings
  allow either a simple deposit invoice or detailed deposit/settlement invoices. Saved
  booking rules and issued invoice formats are preserved. Apply
  `migrations/20260913_deposit_policy.sql` on the secured database before building/deploying
  the frontend; do not rerun ALL_IN_ONE or roles_enforce. No staff-account redeploy needed.
  SQL and frontend regression tests cover thresholds, quoting, payment status and routing.

- Finance role (local release work, not deployed): Dashboard, Reservations, Guests,
  Membership, Invoice and Vouchers. Incoming/Waitlist default deposit queue; other
  filters remain accessible. General/deposit/settlement invoices and voucher issuance
  allowed. Settings, bank/QRIS, Walk-In writes, void/delete and negative adjustments
  stay restricted. Admin can toggle Finance deposit waivers like Staff. Apply
  20260916_finance_role.sql, redeploy staff-account, then frontend. Preserve Phase 1.
