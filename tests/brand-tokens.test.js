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
  // Moved out of index.html into its own file on 2026-09-06, because the
  // public invoice page draws the same sheet. This check followed it.
  //
  // When it was still pointed at index.html after the move it passed by
  // examining NOTHING: zero rules found, zero offenders, green. The
  // "it actually examined some rules" assertion below exists so that can
  // never happen quietly again, here or after the next move.
  const src = read(path.join(ROOT, "css", "invoice-sheet.css"));
  const lines = src.split("\n");
  let selBuf = [], inRule = false, offenders = [], rulesSeen = 0;
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
        rulesSeen++;
        inRule = !line.includes("}");
        if (/var\(--(?:brand|accent)/.test(line)) offenders.push(`line ${i + 1}: ${line.trim().slice(0, 50)}`);
      }
    } else if (line.trim() && !/^\s*[/*]/.test(line)) {
      selBuf.push(line); if (selBuf.length > 2) selBuf = selBuf.slice(-2);
    }
  }
  ok(
    "the sheet stylesheet was actually found and read",
    rulesSeen > 10,
    `Only ${rulesSeen} #inv-sheet rules were examined. The file moved, or the ` +
      "selector shape changed, and this check is now protecting nothing.",
  );
  ok("no #inv-sheet rule uses a CSS variable", offenders.length === 0, offenders.join("\n        "));
}
{
  const inv = read(path.join(ROOT, "js", "invoice.js"));
  const block = inv.slice(inv.indexOf("INV_DEFAULTS"), inv.indexOf("INV_DEFAULTS") + 600);
  ok("the invoice's default colours are literal hex", !/var\(--/.test(block),
     "INV_DEFAULTS feeds the CSS html2canvas rasterises.");
}

console.log("\nColour values that get validated as hex stay hex");
// A var() is not a hex string. isHexColor() rejects it and an <input
// type="color"> cannot display it, so a default written as var() means a
// client with nothing saved silently gets no colour at all. The 2026-09-05
// sweep did exactly this to RESERVE_APPEARANCE_DEFAULTS and nothing caught it
// until the settings screen was opened.
for (const f of ["js/config.template.js", "js/config.js"]) {
  const src = read(path.join(ROOT, f));
  const blocks = [...src.matchAll(/const\s+\w*(?:DEFAULTS|_STYLE|_COLORS)\w*\s*=\s*\{([^}]*)\}/g)];
  const bad = blocks.filter((b) => /var\(--/.test(b[1])).map((b) => b[0].slice(0, 60));
  ok(`${f} has no var() in a colour defaults object`, bad.length === 0, bad.join("\n        "));
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

// ── The accent has to stay readable ─────────────────────────────────────
// The old gold was retired for failing this. Its replacement, a pale yellow,
// failed it too: at 1.32:1 on white the "gold" links and stat numbers were
// nearly invisible, which is how Rere described them on 2026-09-06 ("too
// washed up, unclear to our eye").
//
// So the palette splits the job, the way landing.html already did:
//   --accent         a FILL. Bars, buttons, borders, anything with dark text
//                    ON it. Never small text itself.
//   --accent-strong  the same hue pushed dark enough to be read at 4.5:1.
//                    Text and icons on light surfaces use this.
//
// Nothing enforced that split until now, which is why one colour ended up
// doing both jobs and doing one of them badly. These assertions are the
// enforcement: change the accent to anything you like, and this fails the
// moment the readable half stops being readable.
console.log("\nThe accent stays readable where it is read");
{
  const srgb = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (hex) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const WHITE = "#FFFFFF";
  const CREAM = "#F8F6F2"; // the app's card and panel background

  // Read from index.html rather than hardcoded, so this tests the palette that
  // actually ships rather than a copy that can drift from it.
  const src = read(path.join(ROOT, "index.html"));
  const tok = (name) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(src);
    return m ? m[1] : null;
  };
  const accent = tok("accent");
  const strong = tok("accent-strong");
  const ink = tok("brand-ink");
  ok("the accent tokens were found", !!accent && !!strong && !!ink,
     `accent=${accent} strong=${strong} ink=${ink}`);

  ok(
    `--accent-strong is readable as text on white (${ratio(strong, WHITE).toFixed(2)}:1)`,
    ratio(strong, WHITE) >= 4.5,
    "Everything the eye actually READS in the accent colour uses this token. " +
      "Below 4.5:1 it is the washed-out problem again, in a different hue.",
  );
  ok(
    `--accent-strong is readable on the cream panels too (${ratio(strong, CREAM).toFixed(2)}:1)`,
    ratio(strong, CREAM) >= 4.5,
  );
  ok(
    `dark text is readable ON an --accent fill (${ratio(accent, ink).toFixed(2)}:1)`,
    ratio(accent, ink) >= 4.5,
    "The fill's job is to carry dark text: badges, buttons, bars.",
  );
  ok(
    "the two are the same colour, one darker, not two unrelated colours",
    ratio(strong, accent) > 1.5 && ratio(strong, accent) < 6,
    `They differ by ${ratio(strong, accent).toFixed(2)}:1. Too close and the ` +
      "text one is not dark enough to help; too far and they stop looking " +
      "like one brand.",
  );
}

// Nothing may use the FILL colour as text again. This is the rule the split
// exists for, and the only way to keep it is to check.
console.log("\nThe fill colour is never used as text");
{
  const offenders = [];
  for (const f of FILES) {
    const r = rel(f);
    // Built files are generated from the templates checked above.
    if (/^(reserve|spin|reservation-created|reservation-confirmation|deposit-invoice|invoice-view)\.html$/.test(r)) continue;
    if (r === "js/config.js") continue;
    if (!/\.(html|js)$/.test(r)) continue;
    const src = read(f);
    if (/text-\[color:var\(--accent\)\]/.test(src)) offenders.push(r + " (text-[color:var(--accent)])");
    if (/stroke="var\(--accent\)"/.test(src)) offenders.push(r + ' (stroke="var(--accent)")');
  }
  ok(
    "no file paints text or an icon stroke with --accent",
    offenders.length === 0,
    offenders.join("\n        ") +
      "\n        Use --accent-strong. --accent is for fills.",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
