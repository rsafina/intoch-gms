# Intoch

Guest management and membership system for restaurants. One codebase, one deployment per
client, each pointing at that client's own database.

Derived from Blue Heron GMS, a system running live in a restaurant in Yogyakarta since
2026. This repo is the productised version.

> **Read `CLAUDE.md` before changing anything.** It carries the architecture decisions, the
> bugs that have already been found and fixed once, and the rules that are not obvious from
> reading the code. Several of them will silently corrupt data if ignored.

---

## Quick start

```bash
# 1. point at a Supabase project (your own, for development)
export SUPABASE_URL="https://<your-project-ref>.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."

# 2. generate js/config.js and reserve.html from the templates
node build-config.js

# 3. serve the folder over http (NOT file://, the app disables realtime on file://)
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

`localhost` and `127.0.0.1` put the app in DEV mode: realtime subscriptions and the
auto-refresh timers are skipped, and some queries are cached for 60 seconds so a
live-reload loop does not burn database egress.

---

## How a client deployment works

Each client gets their own Cloudflare project connected to **this same repo**, with their
own environment variables. The code is byte-identical between clients.

| Setting | Where | Value |
|---|---|---|
| Build command | Settings > Build | `node build-config.js` |
| Build output directory | Settings > Build | `/` |
| `SUPABASE_URL` | Settings > **Build** > Variables | that client's project URL |
| `SUPABASE_ANON_KEY` | Settings > **Build** > Variables | that client's anon or publishable key |

> **The variables go under Build, not Runtime.** Cloudflare has two lists with
> nearly identical names. Runtime variables are for a Worker reading them on
> each request; this app bakes the values into the JavaScript at build time, so
> only the Build list is read. Put them in the wrong one and the build fails
> with "missing required environment variable(s)" while the variables sit
> visibly on screen.

Adding a client is: create the project, point it at this repo, paste two values, deploy.
Fixing a bug is: push once, every client rebuilds.

`js/config.js` and `reserve.html` are **generated** and are in `.gitignore`. Never commit
them and never edit them directly; edit `js/config.template.js` and `reserve.template.html`.

---

## Layout

```
index.html                 staff app: all markup, page sections, modals
reserve.template.html      public booking form (guest facing)
reservation-created.html   booking confirmation
reservation-confirmation.html
spin.html                  prize wheel

js/config.template.js      Supabase client, translations, settings, ymd()
js/app.js                  guests, visits, reservations, reports, dashboard
js/membership.js           members, stickers, vouchers
js/wa.js                   WhatsApp templates, phone + name normalisation
js/broadcast.js            audience segments
js/campaign.js             campaign effectiveness with control-group stats
js/campaign-editor.js      campaign workspace, promo images, send guards
js/vouchers.js             standalone gift vouchers
js/voucher.js              canvas voucher card renderer
js/invoice.js              invoice generator (no database, localStorage only)
js/notify.js               online reservation bell
js/version-check.js        "new version available" bar
js/i18n.js                 DOM text translation walker
js/*.test.js               node test harnesses

migrations/                SQL, applied in filename order
reference/                 code kept for porting, NOT wired up
assets/                    ALL PLACEHOLDERS, see below
```

---

## Before this ships to anyone

**1. Row Level Security is off.** Inherited from Blue Heron. The anon key is public in the
frontend, which is normal for Supabase, but with RLS disabled that key grants full read and
write on every table. Anyone who opens a client's app and views source has it. This is the
one item that genuinely blocks a sale.

**2. Staff PINs are stored in plain text.**

**3. Every image in `assets/` is a grey placeholder.** The originals were Blue Heron's logo,
their restaurant photography and their voucher card artwork, none of which belongs in a
product repo. Filenames and pixel dimensions are preserved so layouts hold and nothing
breaks, but every one needs replacing. `assets/voucher-bg.jpg` matters most: `voucher.js`
draws text onto it at fixed coordinates, so a replacement must keep the same dimensions or
the card layout must be re-tuned.

**4. The promo link function is not wired up.** `reference/promo-netlify-function.js` is
Blue Heron's Netlify Function that server-renders `/p/<slug>` pages so WhatsApp can show a
preview card. It needs porting to a Cloudflare Worker. Until then, campaign promo links
will not work. The WhatsApp constraints it encodes are documented in `CLAUDE.md` and are
platform facts, not implementation choices.

**5. `migrations/` is Blue Heron's history, not a clean schema.** `00_schema_from_blueheron.sql`
plus a year of incremental migrations, in filename order. They work, but a new product
probably wants one consolidated schema. Decide before the first client, because after that
you are maintaining both.

---

## Known issues carried over

- Navigation does not change the URL, so the browser back button does nothing. Fixing this
  is one of the three reasons this repo exists.
- `js/app.js` is ~11,600 lines and `index.html` ~8,000. Splitting them is the second reason.
- `loadGuests` fetches every guest with no pagination on each search and page view. The
  largest recurring database egress cost.
- `applyWiSegment`, `resetWiFilters`, `saveWiSegment`, `toggleWiViewAll` are referenced in
  `index.html` but defined nowhere.
- Test coverage is thin: a handful of files across roughly 29,000 lines.

---

## Tests

Plain node, no framework.

```bash
npm install    # once, for the three suites that need jsdom
npm test       # runs all 13 suites, forces TZ=Asia/Jakarta
```

`npm test` forces `TZ=Asia/Jakarta`, and that is deliberate rather than incidental. Date
logic reads the browser's local clock, and several suites only hold at UTC+7. Run them
under UTC and they fail, correctly. `js/notify.test.js` refuses to run at all in another
timezone rather than reporting a misleading pass.

Ten suites pass out of the box. Three need `jsdom` and are skipped until you `npm install`.
