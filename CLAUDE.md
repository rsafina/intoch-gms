# Intoch

Guest management + membership system sold to restaurants. Multi-client product, cloned from
`blueheron-gms` (the original, still running live at one restaurant in Yogyakarta).

Previously called Sirkel. Before that, the prototype lived in `gms-proto`.

Owner: Rere (Resafina), Product Manager. Formerly a frontend dev, so she reads code fine but
does not write much of it. Wants to understand *why*, not just be handed a fix. Ask before
building. She dislikes em dashes in writing.

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

### What this means practically

Each client's Supabase can sit on **their own free tier**. Blue Heron is a real restaurant
with a year of trading and its database is 14 MB against a 500 MB free limit. So a client
project costs the client nothing and costs Rere nothing. Rere's own free allowance (2 active
projects) only needs to cover concurrent trials.

Cloudflare serves static assets **free and unlimited** (asset requests do not count toward
the 100k/day Workers limit), so hosting any number of client apps costs nothing.

---

## Per-client configuration

The thing that must be built before client number two.

Blue Heron hardcodes its credentials:

```js
const SUPABASE_URL = "https://<project-ref>.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGci...";
```

Forking that per client is unmaintainable by client three. Instead:

- `js/config.template.js` in the repo holds placeholders, no client's details.
- Each client's Cloudflare project sets `SUPABASE_URL` and `SUPABASE_ANON_KEY` as
  environment variables.
- A small build script writes `js/config.js` from those at deploy time.
- Build command becomes `node build-config.js` instead of empty.

One repo, N deployments, byte-identical code. A fix pushed once reaches every client.

**This does not hide the key.** The anon key is still readable in the published JavaScript,
as it always was and always will be. This is a maintenance fix, not a security fix.

Also needed before client three: **a migration runner** that loops over the client project
list and applies the same SQL to each.

---

## Must be fixed before the first sale

**RLS is disabled on every table** in the Blue Heron schema this is cloned from. With the
anon key public in the frontend and RLS off, anyone who views source on a client's app can
read and write that client's entire guest database.

For Blue Heron alone that is a risk Rere has chosen to accept. Handed to a paying customer
it is a liability. Fix before selling, not after.

Staff PINs are also stored in plain text.

---

## Backlog

Ordered by what blocks a sale, not by size.

### 1. Row Level Security (blocks the first client)
Covered above. The anon key is public in the browser and RLS is off, so it grants
full read and write on every table. Needs a design decision first: staff currently
authenticate against a `staff_users` table with plain-text PINs and there is no
real auth layer, so there is no `auth.uid()` for policies to key off.

Settings > Staff (2026-08-23) makes staff accounts manageable but changes none of
this. It is an admin-only UI gate over the same public table. The one rule that is
genuinely enforced is **never zero active admins**, and that lives in the
`staff_users_guard_last_admin` trigger, not in the JavaScript, precisely because
the JavaScript is public. Hash the PINs as part of the auth work, not before it:
two half-fixes to the same problem are worse than one whole one.

### 2. Per-client branding on the public pages
**Mostly done (2026-08-23).** Three settings rows now carry it:

- `app_settings.branding` — main logo and small mark, uploaded into the
  `branding` storage bucket. Read through `brandAsset()` / `applyBranding()` in
  `config.js`. Covers reserve, reservation-created, reservation-confirmation,
  spin, the staff login and sidebar, the invoice, and the voucher card.
- `app_settings.reserve_appearance` — the booking page and the thank-you page
  after it: backdrop photo, form panel colour and opacity, button colour, logo
  height. Delivered as four CSS custom properties (`--rf-bg-image`, `--rf-glass`,
  `--rf-logo-max-h`, plus `--primary` / `--dark`), so applying settings is a
  handful of `setProperty` calls and the bundled values stay in each page's
  `:root` as the fallback.
- `app_settings.voucher_style` — see "The voucher card is drawn, not a picture".

The files in `assets/` are the fallback throughout, so a client who has uploaded
and configured nothing still sees a working, on-brand page.

Still hardcoded in the files, and still to do before client one:

- the restaurant name in the page markup (tab title, og:site_name, headings) —
  `restaurantName()` reads `app_settings.restaurant_name` in JS already, but the
  HTML does not use it
- the taglines
- the WhatsApp number and the Google Maps link

### reserve.html carries a COPY of two appearance functions, on purpose

`loadReserveAppearance()` and `applyReserveAppearance()` exist in both
`js/config.template.js` and inline in `reserve.template.html`. That is not an
oversight and must not be "cleaned up" by loading config.js from reserve.html:
both files declare `const SUPABASE_URL`, and the redeclaration kills the page.
Fifteen duplicated lines beat a booking form that white-screens. Both copies
carry a comment pointing at the other; change one, change the other.

### The invoice sheet is styled with LITERAL hex, never CSS variables

`#inv-sheet` is rasterised by html2canvas for the PDF, and the stylesheet has
warned since it was written that html2canvas is not reliable with CSS
variables. So `applyInvoiceStyle()` (2026-08-23) builds a `<style>` block of
literal hex values from `app_settings.invoice_style` rather than setting custom
properties the way the reservation page does.

Do not "modernise" this into `var()`. The failure mode is the worst kind: the
colour resolves perfectly on screen and silently falls back in the exported PDF
— a document that has already been sent to a guest before anyone notices.
`tests/invoice-style.test.js` asserts the generated CSS contains no `var(`.

**Bar text is derived, not configured.** The table header and totals bar print
text on the accent colour, and that text is deliberately not one of the five
settings: it flips between white and the ink colour based on the fill's
luminance. A client picking a pale brand colour would otherwise print an
invisible Total line, and would not find out until a guest asked.

**The footer address was one particular restaurant's.** Until 2026-08-23 the
invoice footer carried a real Yogyakarta street address plus `[nomor telepon]`
and `[akun]` as unfilled placeholders, left over from the de-branding pass. It
is now three separate fields, seeded EMPTY. Separate rather than one textarea
so a client cannot ship an invoice with a placeholder still in it, and empty so
a missing footer is obviously missing rather than confidently wrong.

### The voucher card is drawn, not a picture

Until 2026-08-23 the downloadable voucher was text painted onto a fixed
1084x1940 artwork file, with four hardcoded colours and the logo baked into the
image. That made it unsellable: every client would have needed a designer before
they could hand out one voucher.

It is now painted in code from `app_settings.voucher_style` (background, accent
and text colours, logo scale) plus the Branding logo. Every secondary colour —
muted labels, hairlines, fine print — is DERIVED from those three, because asking
an owner for six colours and hoping they harmonise is how cards end up
unreadable. Settings > Vouchers > Card Design has a live preview that runs the
real renderer, not a mock-up.

`use_artwork` switches back to the old behaviour for a client who genuinely has
designed artwork; the file still lives in `app_settings.branding.voucher_bg_url`.
The migration flips existing artwork users into that mode automatically, so
nobody's card silently changes.

Two traps in that renderer:

- **Canvas tainting.** A logo from Supabase Storage is cross-origin, and drawing
  it onto the canvas taints it, so `toDataURL()` throws and the download button
  silently does nothing. `loadImage` sets `crossOrigin = "anonymous"` for any
  http(s) source. Storage sends the CORS header; a `file://` page does not, which
  is why local screenshot harnesses need `--allow-file-access-from-files`.
- **A dark card hides a dark logo.** The colour contrast warning checks text
  against background AND measures the logo's own average luminance (ignoring
  transparent pixels) to catch it. The default mark is dark navy and vanishes on
  a navy card, which is the first thing a client trying dark colours will hit.

**`og:image` can never be one of these.** The WhatsApp crawler does not run
JavaScript, so the share card has to stay a real file in the build and gets
changed at deploy time. Same for `og:site_name`. Do not "fix" this by swapping the
tag in JS: it will look right in devtools and change nothing in WhatsApp.

The voucher background is a fixed-size canvas, not a logo slot: 1084 x 1940, with
the middle band left empty for the drawn text. The upload screen checks the pixel
size and warns.

### 3. Broken share preview on the booking page
`reserve.html`'s og: tags point at `blueheron-gms.netlify.app`, which does not
exist. The real Blue Heron site is `blue-heron.netlify.app`. So when a guest
forwards the booking link on WhatsApp, the preview image fails to load.

Cosmetic, but it is the first thing a guest sees when someone shares the link.
**This is also live in the blueheron-gms repo**, not just here.

### 4. The migration set does not build a database from zero
Proven on 2026-08-22 while standing up the first fresh project: the base schema's
role CHECK allows only `staff` and `manager`, while the code expects `admin` too.
The original database had that widened by hand. Assume there are more gaps like it
and re-test the full run on an empty project before client one.

**Two more surfaced on 2026-08-23, from the same cause.**

- The spending-tier function pair, which stopped walk-ins and reservations being
  created at all. See "Two functions in this file can drift apart" below.
- `wa_campaigns.status` and `wa_campaign_audience.status` / `updated_at`, used
  throughout `campaign-editor.js` and created by no migration. The Broadcast
  campaign list 400'd on every load.

All three share a cause: the live Blue Heron database was patched by hand, so
this file was never the thing being exercised. **Nothing here is trustworthy
until a fresh project has been built from it AND every page of the app has been
opened against that project** — not just create-guest, create-walk-in,
create-reservation and add-spend, but Broadcast, Vouchers, Membership and
Reports too. A column only missing from one screen is still a screen that is
down for a paying client.

### 5. Routing, file splitting, inline handlers
The three reasons this repo exists. See the top of this file.

### 6. Sending the reservation card AND the message in one WhatsApp send

**Scoped 2026-08-23 at Rere's request, NOT built.** Decide before quoting a
client on it.

**The constraint.** `wa.me` click-to-chat cannot carry an attachment. That is a
platform fact, not a gap in this app, and it is why the voucher card and the
reservation card are both attached by hand today. Anything that puts a picture
and words into one send has to go around it.

The front desk is a **Windows PC only** (confirmed by Rere, 2026-08-23). That
single fact decides most of this, because the cheapest option only works on
phones.

---

**Option A — Web Share API. Rejected for this client.**

`navigator.share({ files, text })` hands WhatsApp the image and the caption in
one tap. Solid on Android and iOS. On desktop Chrome it is documented as not
fully supported and MDN flags the whole API as limited availability. On a
Windows till it would feature-detect to false and change nothing.

Half a day, no cost, no accounts. Worth adding *only* if staff start following
up from their own handsets. Feature-detect with `navigator.canShare({files})`
and fall through to today's download-and-attach, never assume it.

---

**Option B — Server-rendered preview card. RECOMMENDED.**

Put a URL in the WhatsApp message and WhatsApp draws a picture above the text.
One send, no attaching, works on every device including the PC.

The obvious objection is "that needs server-side image rendering", and it does
not. **The staff app already renders the card to a canvas** in
`reservation-confirmation.html` (`downloadCard()`). The missing pieces are
small:

1. On confirm, upload that canvas PNG to Supabase Storage instead of only
   offering it as a download. The `branding` bucket pattern already does
   exactly this.
2. A Cloudflare Worker route (`/r/:id`) that looks up the reservation, returns
   a tiny HTML page whose `og:image` points at the stored PNG, and redirects a
   human visitor to the real confirmation page.
3. The WhatsApp follow-up message carries that URL.

Cost is effectively zero: Cloudflare Workers' free tier is 100k requests/day
and this is one request per booking. Rough effort: two days including the
per-client deploy story.

**The rules that will bite, all already learned here:**

- The crawler does not run JavaScript. `og:` tags must be in the HTML the
  Worker returns, which is the entire reason the Worker exists.
- WhatsApp caches previews per URL, hard and for weeks. **One booking, one URL,
  never edited.** A URL that has already been sent must never change its image.
- Preview image: 300px+ wide, under 600 KB, or no card is drawn at all.
- The sending client decides card size. Mobile gives a full-width card, Web and
  Desktop a small thumbnail. Same URL, same tags, no code-side workaround. The
  front desk will see the small one and should be told that is normal.

---

**Option C — WhatsApp Cloud API. The real answer, when there is budget.**

A genuine image message with a caption, sent by the app, nobody attaching
anything. Templates support an image header alongside body text.

Also the only option that removes the ban risk behind the standing "no send
all, ever" rule, because it is the sanctioned channel.

Indonesian rates are per 24-hour CONVERSATION, not per message: utility about
$0.0212 (~Rp 336), marketing about $0.0492 (~Rp 780), and conversations the
guest starts are free. So confirming a booking costs roughly Rp 336, and every
further message inside that day is included.

Not free in the ways that matter more than money: Meta Business verification, a
dedicated phone number that can no longer be used in the normal WhatsApp app,
and template approval (usually automatic, up to 24 hours) for anything the
restaurant initiates. Wording changes go through review again, which is a
material change to how ops currently edits templates in Broadcast whenever they
like.

**Price it into the licence rather than absorbing it.** At 300 bookings a month
it is about Rp 100k, which is small but recurring and per client.

---

**Suggested order:** B now if a client asks for it, C when one is big enough to
want automated confirmations, A only if the front desk stops being a PC.

### 7. Port the promo function to a Cloudflare Worker
`reference/promo-netlify-function.js`. Until then campaign promo links do not work.

---

## Inherited rules that must not be re-broken

These were each found the hard way in Blue Heron. Porting the code without porting the rules
reintroduces them.

### Dates: `ymd()`, never `toISOString()`

`date.toISOString().split("T")[0]` formats in UTC. Clients run at UTC+7, so local midnight
serialises as the previous day. **`gms-proto` had this in 18 places** (16 in `app.js`, 2 in
`broadcast.js`). Add `ymd(date)` to `config.js` using local getters and replace every
occurrence.

Invisible when testing in UTC or any UTC-negative zone. Test with `TZ=Asia/Jakarta`.

### Never declare a local variable named `t`

`t` is the translation helper. Shadowing it turns every `t("...")` into
`TypeError: t is not a function` and silently kills whatever screen it is in. A static
check with acorn (find `t("literal")` calls, walk the scope chain, fail if any local binds
`t`) is worth having in CI.

### `gms-proto` had no `t()` at all

Blue Heron uses `ID_DICT` in `config.js`; the prototype used `I18N_ID` in `i18n.js` with a
DOM walker and no `t()`. The DOM walker alone does not work for new code, because sentences
are built from short fragments and, once concatenated, match no dictionary key. Port a
`t()` before anything else. Do not copy `ID_DICT` across; the variable names differ.

### The first-timer segment needs both halves of its predicate

Segment = first ever visit inside the window **AND** `lastVisit === firstVisit`. Without the
second half, a guest who came back inside the window gets a "please come back" message.
Compare last-to-first rather than `visitCount === 1`, so lunch plus dinner on the same day
does not count as a return.

The dashboard count and the segment size must be computed the same way, or the two screens
disagree and it reads as a bug.

### Broadcast queries must filter `.is("voided_at", null)`

Without it, a guest whose only visit was a voided mis-entry looks like they visited, and
Broadcast disagrees with the dashboard.

### A promo image with no `{link}` in the template fails silently

The message goes out clean, with no link and no preview card, and nothing warns anyone.
Hard-block it. The reverse (link, no image) still delivers something useful, so that stays
a warning. Keep the asymmetry.

### Reservation source: dropdown, but option values stay English

Only labels translate. Otherwise the channel report splits into language buckets. Legacy
free-text values must route into an "Other" box and round-trip unchanged, or opening and
saving an old booking wipes its source.

### Retention is lifetime-based

Retain = visited in the window AND had a visit before it. The tier rows (Kembali 2-4,
Loyal 5-9, VIP 10+) count **lifetime** visits, not visits inside the window. Classifying by
in-window visits asks "did they eat here 5 times in these 9 days" and produces nonsense.

### Dashboard baseline guard

`adminBaselineOk()` suppresses period deltas when the comparison window predates the
client's earliest visit by less than 14 days. **Every new client starts with no history**,
so without this their first two months of deltas are pure noise. This matters far more for
a product than it did for Blue Heron.

### Two functions in this file can drift apart, and one pair did

`ALL_IN_ONE.sql` concatenates migrations in order, so **the last definition of a
function wins** — and two related functions can end up paired with versions of each
other that were never meant to meet.

That happened to `calculate_guest_spending_tier` (redefined 3 times, final version
`RETURNS TABLE(tier, qualified_at)`) and `recalculate_guest_spending_tier`
(redefined twice, final version still doing `SELECT calculate_...(id) INTO
new_tier`, the call shape for a scalar). The correct recalculate_ sat EARLIER in
the file than the stale one, so the stale one survived.

Postgres does not complain. Selecting a TABLE-returning function into a text
variable stringifies the whole row, so a guest with no spend produced the literal
string `(,)`, which the CHECK constraint rejected. Result: **every walk-in and
every reservation failed**, leaving the guest row behind, with the misleading error
`new row for relation "guests" violates check constraint
"guests_spending_tier_check"`. Fixed by
`20260823_fix_recalculate_spending_tier.sql` at the end of the file.

Two rules from it:

- **The constraint was not the bug.** The obvious "fix" is to widen the CHECK to
  admit the new value. That would have written `(,)` into the tier column of every
  new guest and turned a loud failure into a silent one. When a CHECK fires, first
  ask what wrote the value.
- **A redefined function needs every caller re-checked**, and the check has to be
  a real call, not a read. The self-test at the end of that section creates a
  throwaway guest, recalculates, and asserts NULL, because reading the definitions
  is exactly what failed to catch this for months.

### Realtime channels MUST be torn down on logout

`db.channel(topic)` returns the EXISTING channel when one with that topic is
already open, and calling `.on()` on a channel that has already been subscribed
**throws**:

    cannot add `postgres_changes` callbacks for realtime:rt-today-updates
    after `subscribe()`

`logoutStaff()` used to reset `appInitialized` without removing the channels, so
the next login re-ran the boot sequence, hit an already-subscribed channel and
threw. The throw escaped `initializeApplication()` and **every line after it
never ran** — the online-reservation bell, its chime, and the overnight
auto-refresh. Reported 2026-08-23 as "notifications don't work unless I refresh
the page"; a refresh cured it because a fresh load starts with no channel.

Three rules came out of it:

- Hold a reference to every channel and `db.removeChannel()` it in logout.
  `tests/realtime-lifecycle.test.js` asserts this against the real
  `@supabase/supabase-js`, and re-proves the library rule the bug rests on, so
  it fails loudly if that ever changes.
- **Every optional boot step gets its OWN try/catch.** Realtime, the bell,
  auto-refresh and the version check are enhancements over an app that already
  works on timers. None of them may take the others down. One shared try would
  still have cost the front desk the bell.
- A teardown must clear its once-only guards too (`_resNotifyStarted`), or a
  crash is traded for something worse: a silent bell with nothing on screen
  saying anything is wrong.

### `computeDaysUntilBirthday()` never returns a negative number

It rolls a date that has already gone by forward to NEXT year's occurrence, so
a birthday on the 3rd, read on the 15th, comes back as ~353. **`daysUntil >= 0`
therefore does NOT mean "has not happened yet"** — it is true for every guest
alive. The first cut of the birthday badge used exactly that test and counted
every passed birthday as still outstanding; `tests/birthday-followup.test.js`
caught it before it shipped. Use `birthdayHasPassed()`, which compares the day
of the month, and only inside a list already scoped to one month.

### The birthday badge is month-scoped and has a wrong-month guard

Decided 2026-08-23 (Rere). The red number counts birthdays **in the current
calendar month, not greeted, not already passed, and with a phone number on
file**. The month list itself always shows everyone, including greeted, passed
and phone-less guests: seeing who has a birthday this month is the point, the
number is only the to-do part of it.

The guard matters as much as the rule. `computeBirthdayAlerts()` owns the badge
and is called by three different loaders, one of which is a report a manager can
page forward to December in. It takes the month and year the caller loaded and
**returns without touching the badge unless they match today's**. Remove that
and browsing the report silently clears a badge that August still needs.

Greeted state lives in `birthday_greetings`, one row per guest per calendar
year, unique-indexed so two tills cannot both insert. It is deliberately NOT
derived from `wa_outreach_log`: staff greet people at the table and from their
own handsets, and those are legitimately done with no wa.me click behind them.
The WhatsApp send is still logged to the outreach log like every other button;
the two answer different questions.

Opening WhatsApp does **not** tick the guest off. Same reasoning as
`reservations.follow_up_done`: a chat window opening is not a message sent, and
front desk staff get interrupted mid-send constantly.

### Guest names carry dates and titles

Front desk staff type the visit date into the guest name and will not stop. Expect it in
every client's data. Two separate cleaning functions: one that strips only the leading
title (for staff screens), one that also strips dates and parentheticals (for WhatsApp).
Never full-clean the guest list; the notes are how the host tells apart four guests named
Sinta.

---

## Testing approach that earned its keep

Node + `vm` harnesses, no framework.

- **Smoke tests that actually RUN the loaders** against a filter-aware fake `db`, in both
  languages, asserting the KPI elements populate. Pure-helper unit tests missed the `t`
  shadowing bug entirely. Make the fake apply `gte`/`lte`/`lt`/`is`; a permissive fake
  silently suppresses the very thing under test.
- **Timezone suite** run under `TZ=Asia/Jakarta`, `UTC`, and a UTC+14 zone.
- `vm` gotcha: top-level `const`/`let` are not reachable as context properties across
  separate `runInContext` calls. Concatenate sources into one script and append a
  `globalThis.T = {setters}` footer.

---

## WhatsApp constraints (platform facts, not bugs)

- The **sending client** decides preview card size. Mobile gives a full-width card, Web and
  Desktop give a small thumbnail. Same URL, same tags. No code-side workaround exists.
- Preview image: 300px+ wide, under 600 KB, or no card.
- WhatsApp caches previews per URL hard and for weeks. One promo, one new URL, never edit a
  page whose messages already went out.
- The crawler does not run JavaScript. og: tags must be server-rendered.
- Anchor text in a `wa.me` link is impossible. The raw URL always shows.
- No "send all", ever. Ban risk.

---

## Hosting

Cloudflare, for the whole fleet. Static asset serving is free and unlimited, and there is no
per-deploy charge, which matters when 20 client sites each need updating.

Netlify was the original host and moved its free plan to credits (~15 per production
deploy). Blue Heron hit the ceiling on 2026-08-21 and production deploys stopped with no
warning. That is the failure mode to design against: **own the domain**, so that when a host
changes terms, moving is an afternoon rather than a crisis.

Full history and reasoning: see `CLAUDE.md` in the `blueheron-gms` repo.
