# Development rules and historical defect lessons

Extracted from the former CLAUDE.md during the 2026-09-14 handoff. Historical incident
counts explain the rules; they are not current production metrics. Current architecture,
permissions and deployment status are in ARCHITECTURE.md and CURRENT_STATE.md here.
Older platform-specific WhatsApp size/cache observations below are operational history;
verify current provider behavior before designing a new integration.

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

For direct writes, use `.select()` on every `update`/`insert` and treat an empty result as a failure, the way
`saveArea()` does. Before roles enforcement, a write no policy permitted updated zero rows
and PostgREST answered `204`, byte-identical to success: **every edit to an area silently did
nothing for days** while the app said "Area updated". Enforcement now raises instead, but a
filter that matches nothing still returns an empty success.

A guarded RPC may instead return an explicit verified result such as `{ok:true,id}`.
Check that result; a transport-level success alone does not prove the intended write landed.

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
`tests/complete-reservation.test.js` (see the current completion harness).

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
invisible for 17 days.** The current list also includes Incoming and Waitlist; see `js/notify.js`.
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

**Check the actual working-tree line endings.** A whole-string replacement built with the wrong ending can silently match zero times. Do line-based edits that reuse each line's own ending, or normalise first.
Tests that read source text must strip `\r\n`; `tests/res-search.test.js` failed on every
Windows checkout and passed in CI until it did.

### `js/config.js` is a BUILD ARTEFACT

Edit `js/config.template.js`. Everything outside the two Supabase constants is copied through
verbatim, `ID_DICT` included, so a translation added to `config.js` alone works locally,
passes a casual glance, and is silently erased by the next deploy. `tests/` read the TEMPLATE
for exactly this reason: a test that passes while the app is broken is worse than no test.
Regenerate config only through the build; never hand-edit the generated dictionary.

---

## Testing approach that earned its keep

Node + `vm` harnesses, no framework. The runner discovers both `js/*.test.js` and `tests/*.test.js`; do not rely on a historical suite count.

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
- The runner continues after failing suites; an indefinitely hanging harness can still block it. Run affected suites directly when diagnosing.
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

