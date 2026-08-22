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
