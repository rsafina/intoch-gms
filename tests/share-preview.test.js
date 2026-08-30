// The WhatsApp link preview on the four guest-facing pages.
//
// WHY THIS IS PINNED
// The share card is the only part of this system a customer sees before they
// decide whether to trust it, and it fails in the most expensive way there
// is: silently, and permanently. WhatsApp caches a preview per URL, hard, and
// there is no way to force a re-crawl of a link already sitting in somebody's
// chat. A card sent wrong once stays wrong in that thread forever.
//
// It also cannot be fixed from JavaScript, however much easier that would be.
// The crawler does not run scripts. It reads the file exactly as served, so
// every value has to be correct in the built file.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// Normalise line endings on read: a checkout with core.autocrlf=true would
// otherwise fail every anchored assertion below and look like a code bug.
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const PAGES = [
  ["reserve.template.html", "/reserve"],
  ["reservation-created.template.html", "/reservation-created"],
  ["reservation-confirmation.template.html", "/reservation-confirmation"],
  ["spin.template.html", "/spin"],
];

const buildSrc = read("build-config.js");
const gitignore = read(".gitignore");

console.log("\nEvery guest page carries a share card");
for (const [file] of PAGES) {
  const src = read(file);
  ok(`${file} has og:title`, /property="og:title"/.test(src));
  ok(`${file} has og:image`, /property="og:image"/.test(src));
  ok(`${file} has twitter:card`, /name="twitter:card"/.test(src));
}

console.log("\nog:url and og:image are ABSOLUTE, built from SITE_URL");
// A relative og:image renders no preview at all: the crawler resolves it
// against its own host, not the site's. This is the bug that shipped.
for (const [file, route] of PAGES) {
  const src = read(file);
  const url = src.match(/property="og:url"\s+content="([^"]*)"/);
  const img = src.match(/property="og:image"\s+content="([^"]*)"/);
  ok(`${file} og:url is __SITE_URL__${route}`, url && url[1] === `__SITE_URL__${route}`, url ? `got ${url[1]}` : "no og:url");
  ok(`${file} og:image is prefixed by __SITE_URL__`, img && img[1].startsWith("__SITE_URL__/"), img ? `got ${img[1]}` : "no og:image");
}

console.log("\nNo hardcoded host survives in a template");
for (const [file] of PAGES) {
  const src = read(file);
  const meta = src.slice(0, src.indexOf("</head>"));
  ok(`${file} names no concrete host`, !/netlify\.app|workers\.dev|blue-?heron|your-site\.example/i.test(meta));
}

console.log("\nThe restaurant name is a placeholder, not a baked-in word");
for (const [file] of PAGES) {
  const src = read(file);
  const head = src.slice(0, src.indexOf("</head>"));
  ok(`${file} title uses __RESTAURANT_NAME__`, /<title>__RESTAURANT_NAME__/.test(head));
  ok(`${file} head has no literal "Restoran"`, !/Restoran/.test(head));
}

console.log("\nbuild-config.js actually builds all four");
for (const [file] of PAGES) {
  ok(`${file} is a build target`, buildSrc.includes(file));
  ok(`${file.replace(".template", "")} is gitignored`, gitignore.includes(file.replace(".template", "")));
}
ok("SITE_URL is REQUIRED, not optional",
  /const REQUIRED = \[[^\]]*"SITE_URL"/.test(buildSrc),
  "a missing SITE_URL must fail the build, because the failure it causes is invisible");
ok("the build refuses to emit a leftover placeholder",
  /__\[A-Z_\]\+__/.test(buildSrc) || /__\[A-Z_\]\+__\/g/.test(buildSrc) || buildSrc.includes("still contains"),
  "a page reaching a client with __SITE_URL__ in it is a dead share card");

console.log("\nThe checked-in copies are gone, so nobody edits the wrong file");
for (const [file] of PAGES) {
  const generated = file.replace(".template", "");
  if (generated === "reserve.html") continue; // already generated before this change
  ok(`${generated} is not committed alongside its template`,
    !fs.existsSync(path.join(ROOT, generated)) || gitignore.includes(generated));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
