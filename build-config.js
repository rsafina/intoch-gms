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
 * USAGE
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node build-config.js
 *
 * On Cloudflare: set both as environment variables on the project, and set
 * the build command to `node build-config.js`.
 */

const fs = require("fs");
const path = require("path");

const TARGETS = [
  { from: "js/config.template.js", to: "js/config.js" },
  { from: "reserve.template.html", to: "reserve.html" },
];

const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    "\nbuild-config: missing required environment variable(s): " +
      missing.join(", ") +
      "\n\nSet them on the hosting project (Cloudflare: Settings > Variables)," +
      "\nor locally for a test build:\n" +
      "  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node build-config.js\n",
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
if (!key.startsWith("eyJ")) {
  console.error(
    "\nbuild-config: SUPABASE_ANON_KEY does not look like a JWT (should start 'eyJ')." +
      "\nCheck you have not swapped the URL and key.\n",
  );
  process.exit(1);
}

let wrote = 0;
for (const { from, to } of TARGETS) {
  const src = path.join(__dirname, from);
  if (!fs.existsSync(src)) {
    console.error("build-config: missing template " + from);
    process.exit(1);
  }
  let out = fs.readFileSync(src, "utf8");

  if (!out.includes("__SUPABASE_URL__") || !out.includes("__SUPABASE_ANON_KEY__")) {
    console.error(
      "build-config: " + from + " has no placeholders left. " +
        "Did someone paste real credentials into the template?",
    );
    process.exit(1);
  }

  out = out.split("__SUPABASE_URL__").join(url);
  out = out.split("__SUPABASE_ANON_KEY__").join(key);
  fs.writeFileSync(path.join(__dirname, to), out);
  console.log("build-config: wrote " + to);
  wrote++;
}

console.log("build-config: done, " + wrote + " file(s), pointing at " + url);
