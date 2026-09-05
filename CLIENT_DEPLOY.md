# Deploying a client

How `intoch.app` is wired, and how a new client gets a live site. Written 2026-09-05 when
the domain was bought and Djiwana became the first trial client.

The shape: **one repo, one Cloudflare Pages project per client, one Supabase project per
client, one subdomain per client.** Nothing is ever duplicated except configuration.

```
github.com/rsafina/intoch-gms   (one repo, private, never forked)
        |
        +--> Cloudflare Pages project "djiwana"  --> djiwana.intoch.app  --> Supabase proj A
        +--> Cloudflare Pages project "client2"  --> client2.intoch.app  --> Supabase proj B
```

---

## Why subdomains and not `intoch.app/djiwana-dashboard`

Cloudflare Pages binds a **hostname** to a project. It has no concept of "this path belongs
to that project". Serving `intoch.app/djiwana-dashboard` from a separate project needs a
Worker sitting in front of the root domain, rewriting path prefixes and proxying to the
right project. That is a permanent moving part between every client and their app, and the
thing most likely to be broken at 8pm on a Saturday.

The isolation argument matters more. Paths on one domain share a **browser origin**, so
every client's app shares one `localStorage`, one cookie jar, one service worker scope. The
sales model promises full isolation. Same-origin clients are not isolated in the browser,
whatever the databases do.

Subdomains cost nothing extra, are one form field per client, and each is its own origin.

---

## Part 1: get intoch.app into Cloudflare (once)

The domain is registered at Hostinger. Registration stays there; only DNS moves.

1. Cloudflare dashboard, **Add a site**, enter `intoch.app`, pick the **Free** plan.
2. Cloudflare scans existing DNS and shows two nameservers, e.g. `xxx.ns.cloudflare.com`.
   Copy both.
3. Hostinger hPanel, **Domains > intoch.app > DNS / Nameservers**, choose **Change
   nameservers > Use custom nameservers**, paste both, save.
4. Wait. Usually under an hour, occasionally up to 24. Cloudflare emails when the zone
   goes active. Nothing below works until it does.
5. In Cloudflare, **SSL/TLS > Overview**, set encryption mode to **Full (strict)**.

### The `.app` gotcha

`.app` is on the browser HSTS preload list. Every `.app` address is HTTPS-only at the
browser level, permanently, before any request leaves the machine. Practically:

- Any `http://` link to an intoch.app address simply fails. There is no redirect to fall
  back on. Never write `http://` into a WhatsApp message, an invoice, or a QR code.
- Any mixed content (an asset loaded over http) is blocked, not warned about.
- You cannot test with a self-signed cert or a plain-http local tunnel on this domain.

This is a feature, not a problem, but it will look like a broken site the one time it bites.

---

## Part 2: what lives at the root

`intoch.app` and `www.intoch.app` are **not** a client. Decide before pointing them
anywhere. The options are a marketing landing page (there is a `landing.html` in this repo
and a `gms-proto-landing-page` folder), a redirect to a sales page, or nothing at all.

Leave it unpointed rather than accidentally serving a client's dashboard at the root.

---

## Part 3: a new client, step by step

Using Djiwana as the worked example. Do these in order; each step depends on the one above.

### 3.1 Supabase project

1. New Supabase project, name it `djiwana`, region Singapore (closest to Indonesia).
2. Save the database password somewhere you will still have in a year.
3. Apply the schema from `migrations/`, then prove it:
   ```
   SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run schema-check
   ```
   `schema-check` exists exactly to prove a client database from zero. A migration run that
   passes on an empty database proves almost nothing, so run it and read the output.
4. Copy **Project URL** and the **anon** key from Settings > API. Not the service_role key.
   The service_role key must never touch this repo, a build, or a browser.

**Trial ownership:** the project is created under Rere's Supabase org, not the client's.
That is the kill switch. It transfers to the client's org after payment. Do not create it
under a client email; they can password-reset and lock you out.

**Free-tier ceiling:** a Supabase org gets 2 active free projects. Blue Heron prod is one.
Djiwana makes two. Client three needs a paid plan or a paused project. Know this before you
promise a second trial.

### 3.2 Cloudflare Worker project

Cloudflare folded Pages into Workers, so the dashboard says "Workers" where older guides say
"Pages". A static site with a build step is now a Worker with static assets. Same thing.

1. Cloudflare dashboard, **Compute > Workers & Pages > Create > Import a repository**.
2. Pick `rsafina/intoch-gms`. Yes, the same repo the previous client uses. This is correct.
3. Project name: `djiwana`.
4. **Production branch:** see the guardrail below before choosing.
5. Build settings:
   - Framework preset: **None**
   - Build command: `node build-config.js`
   - Build output directory: `/` (the repo root; there is no build folder)
6. Environment variables, **Production** scope, all four required:

   | Variable | Value for Djiwana |
   |---|---|
   | `SUPABASE_URL` | `https://<djiwana-ref>.supabase.co` |
   | `SUPABASE_ANON_KEY` | the anon key from 3.1 |
   | `SITE_URL` | `https://djiwana.intoch.app` — no trailing slash |
   | `RESTAURANT_NAME` | `Djiwana` |

   `build-config.js` refuses to build if any is missing, and refuses to ship a file with a
   placeholder left in it. Trust the error message; it is telling the truth.
7. Deploy. The first build lands on `djiwana.pages.dev`. Open it and log in before
   attaching the real domain, so a failure is diagnosed on a URL nobody has been given.

### 3.3 Attach the subdomain

1. In the `djiwana` Pages project, **Custom domains > Set up a domain**.
2. Enter `djiwana.intoch.app`. Because the zone is in the same Cloudflare account,
   Cloudflare creates the CNAME and issues the certificate itself. No DNS editing.
3. Certificate issuance takes a few minutes. The site 404s or shows a cert warning until
   it finishes. Wait before reporting a bug.
4. Then turn **off** both `workers.dev` URLs in the same Domains tab, production and the
   `*-<project>` preview wildcard. Left on, every preview deployment you have ever made stays
   a live, unlisted, world-readable copy of the app pointed at that client's database. One
   client, one address.

### 3.4 The URLs the client actually gets

Everything is one project on one subdomain, so the two things you described are just pages:

- Staff dashboard: `https://djiwana.intoch.app/`
- Guest reservation form: `https://djiwana.intoch.app/reserve`
- Confirmation pages: `/reservation-created`, `/reservation-confirmation`

`SITE_URL` is what makes the WhatsApp share cards work. It is baked into `og:url` and
`og:image` at build time because the crawler does not run JavaScript. Get it wrong and every
share card for that client is dead. There is no runtime fix.

### 3.5 Rebuild checklist

After changing any environment variable, **redeploy**. Cloudflare does not rebuild on an
env var change, so the old values stay live and the symptom is a client pointed at the wrong
database. Deployments > the latest one > Retry deployment.

---

## Guardrails

### One repo means one push reaches every client

That is the whole point, and it is also the risk. If every client project has production
branch `main`, a commit you meant as work-in-progress deploys straight to a paying
restaurant during service.

Two workable answers, pick one and be consistent:

- **Release branch.** Client projects use production branch `release`. You merge `main`
  into `release` deliberately when you want the fleet updated. One extra step per release,
  and nothing reaches a client by accident.
- **`main` everywhere, discipline instead.** Fine while there is one trial client. Stops
  being fine the day Djiwana pays.

Given Djiwana is a real restaurant with real service hours, the release branch is worth the
five minutes it costs to set up.

### RLS is still off

Backlog item 1 in `CLAUDE.md` blocks the first sale, and it is not fixed. The anon key sits
in the published JavaScript, as it must, and with RLS disabled that public key grants full
read and write on Djiwana's entire guest database to anyone who views source.

For Blue Heron that is an accepted risk on Rere's own restaurant. Handed to a client it is a
different thing. A free trial is not a defence; the data is real guests either way.

Decide explicitly before the site is shared: fix RLS first, or run the trial with eyes open
and a written note of it. Do not let it be decided by not thinking about it.

### Never paste real credentials into a template

`js/config.template.js` and the four `*.template.html` files hold placeholders only.
`build-config.js` checks each template still contains its placeholders and exits if not,
specifically to catch a real key being committed. If that check ever fires, do not "fix" it
by editing the check.

### Cache busting

`index.html` loads scripts with `?v=N` query strings. Changing a JS file without bumping its
`?v=` means returning staff keep the old file. This bites on every deploy where a fix
appears not to work.

### Blue Heron stays where it is

`blueheron-gms` is a different repo, deliberately frozen in its own shape, and Blue Heron is
Rere's own venue rather than an Intoch client. Moving it onto an `intoch.app` subdomain is a
separate decision with its own migration, not part of this setup.
