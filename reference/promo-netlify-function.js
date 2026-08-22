// ============================================================
// /promo/<slug> — the page WhatsApp reads to draw a preview card
// ============================================================
//
// WHY THIS IS A SERVER FUNCTION AND NOT A STATIC FILE
// WhatsApp's crawler does not run JavaScript. The og: tags have to be
// present in the HTML as it comes off the server, which means a page
// that loads its promo from Supabase in the browser shows the crawler
// an empty head and produces no preview at all.
//
// Serving it from a function is what lets ops change the promo image
// inside the app instead of asking a developer for a file and a push.
//
// WHAT IT DOES
//   1. Look up the campaign by slug
//   2. Return HTML whose og: tags describe that campaign's promo
//   3. Send a real human straight on to the reservation form
//
// A guest must never see an error page. Every failure path below
// falls through to a redirect to /reserve, because a guest who taps a
// promo link wants to book a table, and a stack trace does not help
// them do that.
// ============================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://YOUR_SUPABASE_PROJECT_REF.supabase.co";
// Publishable anon key, copied from js/config.js. It is served to every
// visitor on every page load already, so inlining it here exposes
// nothing new — and hardcoding it means the promo links work the moment
// this deploys, with no Netlify environment variables to configure and
// no silent "why is the image wrong" failure if someone forgets.
// The env var still wins, so the key can be rotated without a push.
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "SET_SUPABASE_ANON_KEY_IN_ENV";

// Netlify sets URL to the site's primary address on every deploy, so
// this follows a domain change (or a custom domain) with no code edit.
// The literal is only a last resort for local runs. It was stale once
// already — the site moved to blue-heron and this still said
// blueheron-gms, which silently broke the fallback og: image.
const SITE = (
  process.env.SITE_URL ||
  process.env.URL ||
  "https://your-site.example"
).replace(/\/$/, "");
const FALLBACK_IMAGE = SITE + "/assets/og-share.jpg";
const RESTAURANT = "Blue Heron";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only ever redirect to a path on this site. A destination stored in
// the database should not be able to bounce guests to an arbitrary
// external URL, however it got in there.
function safeDestination(dest, slug) {
  const d = String(dest || "").trim();
  if (d.startsWith("/") && !d.startsWith("//")) return d;
  return "/reserve?from=" + encodeURIComponent(slug || "promo");
}

// ── og:image, served from OUR domain ─────────────────────────
// Pointing og:image straight at Supabase Storage worked, but had three
// problems, and the first is the one that matters to a guest:
//
//   1. WhatsApp's crawler is markedly fussier than Facebook's about
//      images it has to fetch from a third host. A page on one domain
//      whose image lives on another is the difference between the
//      full-width card and the small side thumbnail.
//   2. It printed the Supabase project ID into a URL sent to every
//      guest. Harmless on its own — the bucket is public and the anon
//      key is already shipped in config.js — but there is no reason to
//      advertise the backend to customers.
//   3. Cache headers were Supabase's to decide, not ours. WhatsApp
//      caches previews for weeks, so those headers matter.
//
// /pimg/<slug> fixes all three: same origin as the page, our headers,
// and the storage path stays private. The function streams the bytes;
// it does not redirect, because a redirect would hand the crawler back
// to the third-party host and undo the point of the exercise.
function imageUrl(campaign, slug) {
  if (campaign && campaign.promo_image_path && slug)
    return `${SITE}/pimg/${encodeURIComponent(slug)}`;
  return FALLBACK_IMAGE;
}

function storageUrl(path) {
  return SUPABASE_URL + "/storage/v1/object/public/promo-images/" + path;
}

function page(campaign, slug) {
  const title = (campaign && campaign.promo_title) || `${RESTAURANT} — Promo`;
  const desc =
    (campaign && campaign.promo_description) ||
    "Ada penawaran spesial dari Blue Heron. Ketuk untuk melihat dan pesan meja.";
  const img = imageUrl(campaign, slug);
  const dest = safeDestination(campaign && campaign.promo_destination, slug);
  // Canonical form is always the short one, even when the guest arrived
  // via an old /promo/ link, so WhatsApp caches one preview per promo
  // rather than two.
  const url = `${SITE}/p/${encodeURIComponent(slug)}`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Blue Heron Restaurant"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${esc(img)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<link rel="icon" href="/assets/bird.png" sizes="32x32" type="image/png"/>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#F8F6F2;color:#28547C;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
text-align:center;padding:24px}
.wrap{max-width:320px}img.logo{width:88px;margin-bottom:20px}
p{font-size:14px;color:#7A7A7A;line-height:1.6}
a{display:inline-block;margin-top:18px;background:#28547C;color:#fff;text-decoration:none;
font-size:14px;font-weight:600;padding:12px 22px;border-radius:12px}
</style>
</head>
<body>
<div class="wrap">
  <img class="logo" src="/assets/logo.png" alt="Blue Heron"/>
  <p>Membuka halaman reservasi…</p>
  <a id="go" href="${esc(dest)}">Buka halaman reservasi</a>
</div>
<script>
// Redirect in JS, deliberately not a meta-refresh tag: the crawler
// does not run scripts, so it stays here and reads the og: tags above,
// while a real visitor is moved on immediately. replace() so the back
// button returns them to WhatsApp.
(function(){ window.location.replace(${JSON.stringify(dest)}); })();
</script>
</body>
</html>`;
}

async function lookupCampaign(slug) {
  if (!slug) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/wa_campaigns` +
        `?slug=eq.${encodeURIComponent(slug)}` +
        `&select=slug,promo_title,promo_description,promo_image_path,promo_destination` +
        `&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
        },
      },
    );
    if (res.ok) return (await res.json())[0] || null;
  } catch (e) {
    // Swallow deliberately. A database blip must not stop a guest from
    // reaching the reservation form; they get the generic card instead.
    console.error("promo lookup failed", slug, e);
  }
  return null;
}

// GET /pimg/<slug> — the campaign's promo image, streamed from Storage
// through our own domain. See imageUrl() above for why this exists.
//
// Never 404s in front of WhatsApp: a crawler that gets an error here
// draws no card at all, so every failure redirects to the house image
// instead. Redirecting is fine on THIS route because it only happens
// when there is no campaign image to serve anyway.
async function serveImage(slug) {
  const campaign = await lookupCampaign(slug);
  if (!campaign || !campaign.promo_image_path)
    return { statusCode: 302, headers: { Location: FALLBACK_IMAGE }, body: "" };

  try {
    const res = await fetch(storageUrl(campaign.promo_image_path));
    if (!res.ok) throw new Error("storage " + res.status);

    const buf = Buffer.from(await res.arrayBuffer());

    // Netlify functions cannot stream binary as text, so it goes back
    // base64-encoded. The image is capped at ~300 KB by the uploader,
    // well inside the 6 MB response limit.
    return {
      statusCode: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Content-Length": String(buf.length),
        // Long cache with immutable: the filename carries a timestamp,
        // so a replaced image is always a different URL. WhatsApp holds
        // preview images for weeks regardless, and this stops it
        // re-fetching on every crawl.
        "Cache-Control": "public, max-age=604800, immutable",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    console.error("promo image fetch failed", slug, e);
    return { statusCode: 302, headers: { Location: FALLBACK_IMAGE }, body: "" };
  }
}

exports.handler = async function (event) {
  // netlify.toml rewrites /p/:splat (current), /promo/:splat (old links
  // already sent to guests) and /pimg/:splat (og:image) to this
  // function with ?slug=. The path fallbacks cover a direct call.
  const path = event.path || "";
  const qs = event.queryStringParameters || {};
  const slug =
    qs.slug ||
    path.split("/promo/")[1] ||
    path.split("/pimg/")[1] ||
    path.split("/p/")[1] ||
    "";

  // The rewrite sets ?img=1 so the two routes stay distinguishable even
  // though they share a function and a slug.
  if (qs.img === "1" || path.includes("/pimg/"))
    return serveImage(String(slug).replace(/\.(jpg|jpeg|png|webp)$/i, ""));

  const campaign = await lookupCampaign(slug);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Short cache: ops edits a promo image and expects to see it.
      // WhatsApp caches previews per URL on its own side for far longer,
      // which is why each campaign gets its own slug.
      "Cache-Control": "public, max-age=60",
    },
    body: page(campaign, slug),
  };
};

// Exported for the node tests in tests/promo.test.js
exports._internals = { page, safeDestination, imageUrl, esc, storageUrl, SITE, FALLBACK_IMAGE };
