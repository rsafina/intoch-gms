// Brand colours live in ONE place, and two files are exempt for a reason.
//
// WHY THIS EXISTS
// Before 2026-09-05 there were 728 hardcoded brand colour values across 20
// files: 372 of #28547C alone, plus 74 distinct blue shades and 33 gold. That
// is why "can we change the colour" was not a small question. Everything now
// resolves to a token, so changing the product's colour is changing a handful
// of values in one block.
//
// The sweep had to be explicit rather than by hue, because the blue and gold
// families also contained things that are NOT brand and must never follow it:
// the amber warning family (#D4A017, #C77700), Tailwind's info blues, cool
// greys, and the near-blacks behind the reservation page. A hue-based
// find-and-replace would have made warnings indistinguishable from the accent.
//
// TWO EXEMPTIONS, both real:
//   1. #inv-sheet is rasterised by html2canvas, which does not resolve CSS
//      variables. A var() there means the PDF silently loses the colour while
//      the screen looks perfect. Literal hex only.
//   2. js/voucher.js draws the voucher card to a <canvas>. fillStyle takes a
//      colour string, not a CSS variable.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "_to_delete", "backups", "reference", "tests"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (/\.(html|js)$/.test(e.name) && !e.name.endsWith(".test.js")) out.push(path.join(dir, e.name));
  }
  return out;
}
const FILES = walk(ROOT, []);
const read = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

console.log("\nThe retired brand colours are gone everywhere");
const RETIRED_HEX = ["28547C","5596CE","C8A96B","8B6F47","B8954F","1F4060","1F5480",
                     "3E8FCB","1D3F5E","1F4E79","4795D0","85C5E9","B9985A","8A7645"];
const RETIRED_RGB = ["40, 84, 124","85, 150, 206","200, 169, 107","139, 111, 71",
                     "184, 149, 79","31, 64, 96","31, 84, 128","62, 143, 203"];
const strays = [];
for (const f of FILES) {
  const src = read(f), low = src.toLowerCase();
  for (const h of RETIRED_HEX) if (low.includes("#" + h.toLowerCase())) strays.push(`${rel(f)} #${h}`);
  for (const r of RETIRED_RGB) if (src.includes(r)) strays.push(`${rel(f)} rgb(${r})`);
}
ok("no retired brand hex or rgb survives", strays.length === 0, strays.slice(0, 12).join("\n        "));

console.log("\nEvery token a file uses is actually defined");
const TOKEN_HOSTS = ["index.html","landing.html","spin.template.html","spin.html",
  "reservation-confirmation.template.html","reservation-confirmation.html",
  "reservation-created.template.html","reservation-created.html",
  "reserve.template.html","reserve.html"];
const defined = new Set();
for (const m of read(path.join(ROOT, "index.html")).matchAll(/--([a-z0-9-]+)\s*:/g)) defined.add(m[1]);
const used = new Set();
for (const f of FILES) for (const m of read(f).matchAll(/var\(--((?:brand|accent)[a-z0-9-]*)\)/g)) used.add(m[1]);
const undef = [...used].filter((t) => !defined.has(t)).sort();
ok("no brand token is used without being defined", undef.length === 0, undef.join(", "));

// A page with its own <style> cannot borrow index.html's :root.
for (const name of TOKEN_HOSTS) {
  const src = read(path.join(ROOT, name));
  const usesToken = /var\(--(?:brand|accent)/.test(src);
  ok(`${name} defines its own tokens`, !usesToken || src.includes("--brand:"),
     `${name} uses brand tokens but has no --brand: of its own, so they resolve to nothing.`);
}

console.log("\nThe rasterised invoice sheet stays literal");
// html2canvas cannot resolve custom properties. This is the one place where
// a var() would look right on screen and come out wrong in the PDF.
{
  const src = read(path.join(ROOT, "index.html"));
  const styleEnd = src.indexOf("</style>");
  const lines = src.slice(0, styleEnd).split("\n");
  let selBuf = [], inRule = false, offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inRule) {
      if (/var\(--(?:brand|accent)/.test(line)) offenders.push(`line ${i + 1}: ${line.trim().slice(0, 50)}`);
      if (line.includes("}")) inRule = false;
      continue;
    }
    if (line.includes("{")) {
      const sel = selBuf.join(" ") + " " + line.split("{")[0];
      selBuf = [];
      if (sel.includes("inv-sheet")) {
        inRule = !line.includes("}");
        if (/var\(--(?:brand|accent)/.test(line)) offenders.push(`line ${i + 1}: ${line.trim().slice(0, 50)}`);
      }
    } else if (line.trim() && !/^\s*[/*]/.test(line)) {
      selBuf.push(line); if (selBuf.length > 2) selBuf = selBuf.slice(-2);
    }
  }
  ok("no #inv-sheet rule uses a CSS variable", offenders.length === 0, offenders.join("\n        "));
}
{
  const inv = read(path.join(ROOT, "js", "invoice.js"));
  const block = inv.slice(inv.indexOf("INV_DEFAULTS"), inv.indexOf("INV_DEFAULTS") + 600);
  ok("the invoice's default colours are literal hex", !/var\(--/.test(block),
     "INV_DEFAULTS feeds the CSS html2canvas rasterises.");
}

console.log("\nThe canvas-drawn voucher stays literal");
{
  const v = read(path.join(ROOT, "js", "voucher.js"));
  ok("js/voucher.js uses no CSS variables", !/var\(--/.test(v),
     "fillStyle takes a colour string; a var() there draws nothing.");
}

console.log("\nStatus colours were not swept up in the recolour");
// These mean something. If the recolour ever eats them, a warning becomes
// indistinguishable from the accent and an error from a heading.
const all = FILES.map(read).join("\n");
for (const [name, hex] of [["success green", "#1FAF5E"], ["olive green", "#5F8D4E"],
                           ["danger red", "#C0392B"], ["warning amber", "#D4A017"]]) {
  ok(`${name} ${hex} still exists`, all.toUpperCase().includes(hex));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
