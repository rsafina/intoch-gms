// Tests for the /promo/<slug> function's HTML output.
//
// Lives outside netlify/functions on purpose: Netlify bundles every .js file
// in that directory as a serverless function, and "promo.test" is not a legal
// function name (the dot is rejected), which fails the build.
//
// Run: node tests/promo.test.js
const { _internals: I } = require("../reference/promo-netlify-function.js");

let pass = 0,
  fail = 0;
const ok = (n, c, x) => {
  c ? (pass++, console.log("  PASS  " + n))
    : (fail++, console.log("  FAIL  " + n + (x ? "  → " + JSON.stringify(x) : "")));
};
const eq = (n, a, b) => ok(n, a === b, { got: a, want: b });

const CAMP = {
  slug: "promo-burger-agustus",
  promo_title: "Promo Burger Beli 1 Gratis 1",
  promo_description: "Berlaku sampai 15 Agustus di Blue Heron Jogja.",
  promo_image_path: "promo-burger-agustus/poster.jpg",
  promo_destination: "/reserve?from=promo-burger-agustus",
};

console.log("\n── og tags ──");
{
  const h = I.page(CAMP, CAMP.slug);
  const og = {};
  for (const m of h.matchAll(/<meta property="(og:[a-z:]+)" content="([^"]*)"\/>/g))
    og[m[1]] = m[2];
  eq("og:title", og["og:title"], CAMP.promo_title);
  eq("og:description", og["og:description"], CAMP.promo_description);
  // og:image must be SAME-ORIGIN with the page. WhatsApp's crawler is
  // fussier than Facebook's about images on a third host, and a
  // cross-origin og:image is the difference between the full-width
  // card and a small side thumbnail. It also kept the Supabase project
  // ID out of a URL that goes to every guest.
  eq(
    "og:image is served from our own domain",
    og["og:image"],
    "https://your-site.example/pimg/promo-burger-agustus",
  );
  ok(
    "og:image does not leak the storage host",
    !og["og:image"].includes("supabase"),
  );
  ok(
    "og:image shares an origin with og:url",
    new URL(og["og:image"]).origin === new URL(og["og:url"]).origin,
  );
  // Canonical og:url is always the short /p/ form, even for a guest who
  // arrived through an old /promo/ link — one preview cached per promo,
  // not two.
  eq("og:url", og["og:url"], "https://your-site.example/p/promo-burger-agustus");
  eq("og:image:width", og["og:image:width"], "1200");
  eq("og:image:height", og["og:image:height"], "630");
  ok("twitter card present", h.includes('name="twitter:card"'));
  ok("title tag matches", h.includes("<title>Promo Burger Beli 1 Gratis 1</title>"));
}

console.log("\n── crawler safety ──");
{
  const h = I.page(CAMP, CAMP.slug);
  // Must match an actual tag, not the words "http-equiv" appearing in the
  // comment that explains why we avoid it.
  ok("no meta refresh tag (would hide og from some crawlers)", !/<meta[^>]+http-equiv/i.test(h));
  ok("js redirect present", h.includes("window.location.replace"));
  ok("visible fallback link", h.includes('id="go"'));
  ok("og tags appear before any script", h.indexOf('property="og:image"') < h.indexOf("<script"));
}

console.log("\n── missing / partial campaign degrades to something usable ──");
{
  const h = I.page(null, "tidak-ada");
  ok("still returns a page", h.startsWith("<!doctype html>"));
  ok("falls back to the house image", h.includes("/assets/og-share.jpg"));
  ok("still sends the guest to /reserve", h.includes("/reserve?from=tidak-ada"));

  const partial = I.page({ slug: "x", promo_title: "Judul" }, "x");
  ok("missing image → house image", partial.includes("/assets/og-share.jpg"));
  ok("missing description → generic copy", partial.includes("penawaran spesial"));
}

console.log("\n── destination is locked to this site ──");
{
  eq("relative path kept", I.safeDestination("/reserve?from=x", "x"), "/reserve?from=x");
  eq("external url rejected", I.safeDestination("https://evil.example.com", "x"), "/reserve?from=x");
  eq("protocol-relative rejected", I.safeDestination("//evil.example.com", "x"), "/reserve?from=x");
  eq("javascript: rejected", I.safeDestination("javascript:alert(1)", "x"), "/reserve?from=x");
  eq("empty falls back", I.safeDestination("", "burger"), "/reserve?from=burger");
  eq("null falls back", I.safeDestination(null, "burger"), "/reserve?from=burger");
}

console.log("\n── injection ──");
{
  const nasty = {
    slug: "x",
    promo_title: 'Promo "Murah" <script>alert(1)</script>',
    promo_description: "A & B <b>bold</b>",
    promo_destination: "/reserve",
  };
  const h = I.page(nasty, "x");
  ok("script tag escaped in title", !h.includes("<script>alert(1)</script>"));
  ok("quotes escaped so the meta attribute cannot be broken out of", h.includes("&quot;Murah&quot;"));
  ok("ampersand escaped", h.includes("A &amp; B"));
  // The only <script> blocks should be our own redirect
  eq("exactly one script block", (h.match(/<script/g) || []).length, 1);
}

// ============================================================
// SAME-ORIGIN og:image (2026-08-01)
// ------------------------------------------------------------
// The card kept rendering as a small side thumbnail even after the
// image met every documented WhatsApp requirement (1200x630, 135 KB,
// JPEG, absolute HTTPS). The last uncontrolled variable was that the
// image was served from Supabase Storage while the page was served
// from Netlify. /pimg/<slug> makes them same-origin.
// ============================================================

console.log("\n── /pimg/ image route ──");
{
  eq(
    "campaign with an image gets the proxied url",
    I.imageUrl(CAMP, CAMP.slug),
    I.SITE + "/pimg/promo-burger-agustus",
  );

  // No image, no campaign, no slug — all must still yield something
  // WhatsApp can fetch. An og:image that 404s means no card at all,
  // which is worse than a generic card.
  eq(
    "campaign without an image falls back to the house image",
    I.imageUrl({ slug: "x" }, "x"),
    I.FALLBACK_IMAGE,
  );
  eq("null campaign falls back", I.imageUrl(null, "x"), I.FALLBACK_IMAGE);
  eq(
    "missing slug falls back rather than building /pimg/undefined",
    I.imageUrl(CAMP, ""),
    I.FALLBACK_IMAGE,
  );
  ok("fallback is absolute https", /^https:\/\//.test(I.FALLBACK_IMAGE));

  // Slugs are generated by us, but the proxy takes one off a URL, so
  // it must survive being encoded.
  ok(
    "slug is url-encoded in the proxy path",
    I.imageUrl(CAMP, "a b").endsWith("/pimg/a%20b"),
  );

  // The storage URL still has to be correct — the proxy fetches it.
  eq(
    "storage url is built from the stored path",
    I.storageUrl("promo-burger-agustus/poster.jpg"),
    "https://YOUR_SUPABASE_PROJECT_REF.supabase.co/storage/v1/object/public/promo-images/promo-burger-agustus/poster.jpg",
  );
}

console.log("\n── the rendered page uses the proxy everywhere ──");
{
  const h = I.page(CAMP, CAMP.slug);
  ok("no supabase host anywhere in the html", !h.includes("supabase.co"));
  ok("og:image uses /pimg/", h.includes("/pimg/promo-burger-agustus"));

  // A campaign with no image must not emit a /pimg/ url that would
  // redirect — WhatsApp should get the house image directly.
  const noImg = I.page({ slug: "x", promo_destination: "/reserve" }, "x");
  ok("imageless campaign points straight at the fallback", noImg.includes("og-share.jpg"));
  ok("imageless campaign emits no /pimg/ url", !noImg.includes("/pimg/"));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
