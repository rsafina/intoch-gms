#!/usr/bin/env node
/**
 * Fills per-client credentials into the two files that need them.
 *
 * WHY THIS EXISTS
 * Every client runs byte-identical code against their own Supabase project.
 * The only things that differ are the project URL and its anon key. Rather
 * than forking the repo per client (unmaintainable by client three), those
 * two values live as environment variables in each client's hosting project
 * and get written in at build time.
 *
 * WHAT IT IS NOT
 * This does not hide the anon key. It ends up in the published JavaScript,
 * readable by anyone, exactly as before. Supabase is designed that way. The
 * thing that protects a client's data is Row Level Security, which is NOT yet
 * enabled. See CLAUDE.md, "Must be fixed before the first sale".
 *
 * SITE_URL exists for a different reason. The Open Graph tags that produce
 * the WhatsApp link preview must carry ABSOLUTE urls. A relative one renders
 * no preview at all, because the crawler resolves it against its own host and
 * finds nothing. The page cannot know its own public origin at build time, so
 * it is supplied, and every share card for every client is wrong without it.
 *
 * That is also why og: tags cannot be set from JavaScript, however tempting:
 * the WhatsApp crawler does not run scripts. It reads the file as served.
 *
 * USAGE
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SITE_URL=... node build-config.js
 *
 * On Cloudflare: set these as environment variables on the project, and set
 * the build command to `node build-config.js`.
 */

const fs = require("fs");
const path = require("path");

// `requires` is what each template MUST still contain. It is a tripwire for
// somebody pasting real values into a template and committing them, which is
// how a client's credentials end up in the repo.
//
// The three guest pages read their Supabase client from js/config.js, so they
// need no credentials of their own, only the share-card values.
const TARGETS = [
  {
    from: "js/config.template.js",
    to: "js/config.js",
    requires: ["__SUPABASE_URL__", "__SUPABASE_ANON_KEY__"],
  },
  {
    from: "reserve.template.html",
    to: "reserve.html",
    requires: ["__SUPABASE_URL__", "__SUPABASE_ANON_KEY__", "__SITE_URL__", "__RESTAURANT_NAME__"],
  },
  {
    from: "reservation-created.template.html",
    to: "reservation-created.html",
    requires: ["__SITE_URL__", "__RESTAURANT_NAME__"],
  },
  {
    from: "reservation-confirmation.template.html",
    to: "reservation-confirmation.html",
    requires: ["__SITE_URL__", "__RESTAURANT_NAME__"],
  },
  {
    from: "spin.template.html",
    to: "spin.html",
    requires: ["__SITE_URL__", "__RESTAURANT_NAME__"],
  },
  {
    // Needs its own Supabase client: it looks an invoice up by token. Unlike
    // the other guest pages it cannot read js/config.js, for the same reason
    // reserve.html cannot — redeclaring const SUPABASE_URL.
    from: "deposit-invoice.template.html",
    to: "deposit-invoice.html",
    requires: ["__SUPABASE_URL__", "__SUPABASE_ANON_KEY__", "__SITE_URL__", "__RESTAURANT_NAME__"],
  },
  {
    // The saved invoice a guest opens from WhatsApp. Draws the same sheet as
    // the staff generator, from css/invoice-sheet.css and js/invoice-sheet.js.
    from: "invoice-view.template.html",
    to: "invoice-view.html",
    requires: ["__SUPABASE_URL__", "__SUPABASE_ANON_KEY__", "__SITE_URL__", "__RESTAURANT_NAME__"],
  },
];

const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SITE_URL"];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    "\nbuild-config: missing required environment variable(s): " +
      missing.join(", ") +
      "\n\nON CLOUDFLARE: these must be BUILD variables, not RUNTIME variables." +
      "\n  Settings > Build > Variables and secrets   <- correct, the build reads these" +
      "\n  Settings > Runtime > Variables and secrets <- wrong, only the live Worker sees these" +
      "\nThe two lists look identical in the dashboard. Filling in the runtime" +
      "\none and retrying produces exactly this error, with the variables" +
      "\nvisibly present on screen." +
      "\n\nLocally, for a test build:\n" +
      "  SUPABASE_URL=https://xxxx.supabase.co \\\n" +
      "  SUPABASE_ANON_KEY=eyJ... \\\n" +
      "  SITE_URL=https://client.example.com \\\n" +
      "  node build-config.js\n",
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL.replace(/\/+$/, "");
const key = process.env.SUPABASE_ANON_KEY;

// Fail loudly on a swapped pair. Pasting the key into the URL box is the
// obvious mistake and would otherwise produce a site that builds fine and
// silently cannot reach the database.
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error(
    "\nbuild-config: SUPABASE_URL does not look like a Supabase project URL." +
      "\n  got: " + url +
      "\n  expected: https://<project-ref>.supabase.co\n",
  );
  process.exit(1);
}
// Supabase issues two shapes of publishable key:
//   legacy anon key  -> a JWT, starts "eyJ"
//   modern key       -> starts "sb_publishable_"
// Both work with supabase-js. Accept either, and reject anything else,
// because the common mistake is pasting the URL and key the wrong way round.
const looksLikeKey =
  key.startsWith("eyJ") || key.startsWith("sb_publishable_");

if (!looksLikeKey) {
  console.error(
    "\nbuild-config: SUPABASE_ANON_KEY is not a recognised Supabase key." +
      "\n  expected it to start with 'eyJ' (legacy anon key)" +
      "\n  or 'sb_publishable_' (current publishable key)" +
      "\n  got: " + key.slice(0, 12) + "..." +
      "\n\nSupabase dashboard: Project Settings > API Keys." +
      "\nDo NOT use a service_role or sb_secret_ key here: this value ends up" +
      "\npublic in the browser.\n",
  );
  process.exit(1);
}

// Hard stop on a server-side key. Shipping one of these to the browser
// hands every visitor full admin access to the database.
if (key.startsWith("sb_secret_") || /"role"\s*:\s*"service_role"/.test(
  (() => { try { return Buffer.from(key.split(".")[1] || "", "base64").toString("utf8"); } catch (_) { return ""; } })()
)) {
  console.error(
    "\nbuild-config: that is a SERVICE ROLE key. Refusing to build." +
      "\nIt would be published in the browser and grant full admin access." +
      "\nUse the anon / publishable key instead.\n",
  );
  process.exit(1);
}

// SITE_URL is the public origin the guest pages are served from, with no
// trailing slash and no path. It becomes the og:url and og:image prefix.
//
// Validated rather than trusted because the failure is invisible for weeks:
// WhatsApp caches a link preview per URL, hard, so a card sent once with a
// broken image stays broken in that thread long after the site is fixed.
// There is no way to force a re-crawl of a link already in somebody's chat.
const siteUrl = process.env.SITE_URL.trim().replace(/\/+$/, "");

if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(siteUrl)) {
  console.error(
    "\nbuild-config: SITE_URL must be the bare public origin of the site." +
      "\n  got:      " + siteUrl +
      "\n  expected: https://reservasi.namaklien.com" +
      "\n\nNo path, no trailing slash, and https rather than http: the link" +
      "\npreview crawlers reject mixed content, and the value is pasted" +
      "\nstraight in front of /reserve and /assets/og-share.jpg.\n",
  );
  process.exit(1);
}

// The restaurant's own name, used in the tab title and the share card. Not
// required: a client who has not set it gets the neutral placeholder the
// pages already shipped with, which is wrong but harmless. A missing
// SITE_URL is silently broken, which is why that one IS required.
const restaurantName = (process.env.RESTAURANT_NAME || "Restoran").trim();

if (!process.env.RESTAURANT_NAME) {
  console.warn(
    "build-config: RESTAURANT_NAME is not set, using \"Restoran\". " +
      "Set it before this reaches a real client.",
  );
}

// A quote or angle bracket would break out of the content="..." attribute
// it is pasted into. Cheap to guard, and the value comes from a dashboard
// field somebody types by hand.
if (/["'<>]/.test(restaurantName)) {
  console.error(
    "\nbuild-config: RESTAURANT_NAME cannot contain quotes or angle brackets." +
      "\n  got: " + restaurantName + "\n",
  );
  process.exit(1);
}

let wrote = 0;
for (const { from, to, requires } of TARGETS) {
  const src = path.join(__dirname, from);
  if (!fs.existsSync(src)) {
    console.error("build-config: missing template " + from);
    process.exit(1);
  }
  let out = fs.readFileSync(src, "utf8");

  const absent = (requires || []).filter((ph) => !out.includes(ph));
  if (absent.length) {
    console.error(
      "build-config: " + from + " is missing placeholder(s): " + absent.join(", ") +
        "\nDid someone paste real values into the template and commit them?",
    );
    process.exit(1);
  }

  out = out.split("__SUPABASE_URL__").join(url);
  out = out.split("__SUPABASE_ANON_KEY__").join(key);
  out = out.split("__SITE_URL__").join(siteUrl);
  out = out.split("__RESTAURANT_NAME__").join(restaurantName);

  // Nothing may reach a client with a placeholder still in it. A page that
  // says __RESTAURANT_NAME__ in the browser tab is embarrassing; an og:url
  // that says __SITE_URL__ is a dead share card.
  const leftover = out.match(/__[A-Z_]+__/g);
  if (leftover) {
    console.error(
      "build-config: " + to + " still contains " + [...new Set(leftover)].join(", ") +
        " after substitution. Add it to build-config.js or remove it from the template.",
    );
    process.exit(1);
  }
  fs.writeFileSync(path.join(__dirname, to), out);
  console.log("build-config: wrote " + to);
  wrote++;
}

console.log(
  "build-config: done, " + wrote + " file(s), database " + url +
    ", site " + siteUrl + ", name \"" + restaurantName + "\"",
);
