# Reference

Code kept for porting. **Nothing in here is wired up or served.**

## promo-netlify-function.js

Blue Heron's Netlify Function that server-renders `/p/<slug>` promo pages, so WhatsApp's
crawler can read og: tags and show a preview card. The crawler does not run JavaScript, so
a client-rendered page produces no preview at all: that is why this exists as a server
function rather than a static page.

Needs porting to a Cloudflare Worker. It also serves `/pimg/<slug>`, proxying the promo
image out of Supabase Storage with long cache headers, which keeps the database project ref
out of URLs sent to guests.

Credentials removed; it reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the environment.
