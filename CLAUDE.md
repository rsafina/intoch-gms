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
**Half done (2026-08-23).** The IMAGES are now configurable: Settings > Branding
uploads a main logo, a small mark and the voucher card artwork into a `branding`
storage bucket, with the public URLs in `app_settings.branding`. Every surface
reads them through `brandAsset()` / `applyBranding()` in `config.js`, with the
files in `assets/` kept as the fallback so a client who has uploaded nothing still
sees a working page. Covered: reserve, reservation-created,
reservation-confirmation, spin, the staff app login and sidebar, the invoice, and
the voucher canvas.

Still hardcoded in the files, and still to do before client one:

- the restaurant name in the page markup (tab title, og:site_name, headings) —
  `restaurantName()` reads `app_settings.restaurant_name` in JS already, but the
  HTML does not use it
- the taglines
- the background photo
- the brand colour, written into the stylesheet
- the WhatsApp number and the Google Maps link

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
The original database had that widened by hand. Fixed by
`migrations/20260822_admin_role_and_first_user.sql`, but assume there are more
gaps like it and re-test the full run on an empty project before client one.

### 5. Routing, file splitting, inline handlers
The three reasons this repo exists. See the top of this file.

### 6. Port the promo function to a Cloudflare Worker
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
