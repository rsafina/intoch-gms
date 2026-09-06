// The public deposit invoice page, and the settings that feed it.
//
// WHY THIS EXISTS
// This is the one page in the product that asks a guest for money, opened from
// a WhatsApp link by someone who is about to transfer real rupiah. The failure
// modes are quiet and expensive:
//
//   - a network blip rendered as "this link is dead" sends a paying guest away
//   - the amount shown without what already arrived makes a half-payment look
//     like it went missing
//   - a page with no bank details and no QRIS is a request to pay into nothing
//   - an og:description would put "Andi owes Rp 500.000" in a group chat
//     preview before anyone opened the link
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "deposit-invoice.template.html"), "utf8");
const build = fs.readFileSync(path.join(ROOT, "build-config.js"), "utf8");
const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cfg = fs.readFileSync(path.join(ROOT, "js", "config.template.js"), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

console.log("\nThe page is wired into the build, not orphaned");
ok("build-config generates it", /from: "deposit-invoice\.template\.html"/.test(build));
ok("it asks for its own Supabase credentials",
   /deposit-invoice[\s\S]{0,220}__SUPABASE_ANON_KEY__/.test(build),
   "It looks an invoice up by token, so unlike the other guest pages it needs a client.");
ok("the generated file is gitignored", /^deposit-invoice\.html$/m.test(ignore),
   "It carries the client's credentials.");

console.log("\nIt does not leak what a named guest owes");
ok("it is noindex", /name="robots" content="noindex/.test(page));
// Matches an actual META TAG, not the word: the page carries a comment
// explaining why there is no share card, and grepping the raw text flagged
// that comment as the very thing it warns against.
ok("it has no share card", !/<meta\s+property="og:/i.test(page),
   "A WhatsApp preview would show the amount and the name before anyone opened it.");

console.log("\nThe three states are distinct");
for (const id of ["loading", "dead", "invoice"]) {
  ok(`the ${id} state exists`, new RegExp(`id="${id}"`).test(page));
}
ok("it starts on loading, not on an empty invoice",
   /id="loading" class="card state"/.test(page) && /id="invoice" class="card hidden"/.test(page),
   "A slow connection would otherwise render an empty card that reads as a broken link.");

console.log("\nA network failure is not reported as a dead link");
// The difference between "we could not reach the server" and "this link is
// finished" is the difference between a guest retrying and a guest giving up.
ok("a fetch failure gets its own message",
   /catch \(_\) \{[\s\S]{0,260}Periksa koneksi Anda/.test(page));
ok("only a genuinely missing row is treated as dead", /if \(!row\) return show\("dead"\)/.test(page));

console.log("\nThe amount tells the whole truth");
ok("it shows the outstanding balance", /row\.outstanding/.test(page));
ok("a part payment is shown too", /Sudah diterima/.test(page),
   "Otherwise a guest who paid half sees a smaller figure and thinks the first transfer vanished.");
ok("a settled invoice says so and hides the payment details",
   /outstanding <= 0[\s\S]{0,320}pay-block[\s\S]{0,60}add\("hidden"\)/.test(page));

console.log("\nPayment details, and the button that needs a number");
ok("bank details render as typed", /\$\("bank"\)\.textContent = pay\.bank/.test(page));
ok("the QRIS is only used when it is a real URL", page.includes("test(pay.qris)"));
ok("a blank WhatsApp number hides the button rather than building a broken link",
   /digits\.length < 8\) return null/.test(page));

console.log("\nThe settings that feed it");
ok("it reads the shared reservation appearance row",
   /\.in\("key", \["reserve_appearance", "reservation_form"\]\)/.test(page));
ok("it applies the reservation form background mode",
   /function applyReserveAppearance\(ra\)/.test(page) &&
   /data-rf-bg/.test(page) &&
   /cfg\.bg_style/.test(page));
ok("it applies the reservation form colours and logo height",
   /--rf-glass/.test(page) &&
   /--rf-solid/.test(page) &&
   /--primary/.test(page) &&
   /--rf-logo-max-h/.test(page));
ok("solid mode on the invoice drops the glass too",
   /:root\[data-rf-bg="solid"\] \.card[\s\S]*?backdrop-filter: none/.test(page) &&
   /:root\[data-rf-bg="solid"\] \.btn[\s\S]*?border-radius: 12px/.test(page));
for (const [id, label] of [["rff-bank", "bank details"], ["rff-wa", "WhatsApp number"],
                           ["rff-qris-file", "QRIS upload"], ["rff-qris-preview", "QRIS preview"]]) {
  ok(`${label} has a field`, new RegExp(`id="${id}"`).test(html));
}
ok("all three default to null", /bank_details: null,[\s\S]{0,200}qris_url: null,[\s\S]{0,200}wa_number: null,/.test(app));
ok("the WhatsApp number is stored as digits only", /wa_number:[\s\S]{0,140}replace\(\/\\D\/g, ""\)/.test(app));
ok("qris_url is NOT written by the form save", !/qris_url:\s*String\(document/.test(app),
   "Listing it there would blank the uploaded URL on every save.");

console.log("\nThe uploader saves immediately and merges one key");
ok("uploadDepositQris exists", /async function uploadDepositQris/.test(app));
ok("it writes through a single-key merge", /writeReservationFormValue\(\{ qris_url: url \}\)/.test(app),
   "Writing the whole form would save a colleague's half-typed screen.");
ok("the merge spreads the existing value",
   /const value = \{ \.\.\.\(APP_SETTINGS\.reservation_form \|\| \{\}\), \.\.\.patch \}/.test(app));
ok("it asks for the row back", /\.select\("value"\)/.test(app),
   "A write no policy permits updates zero rows and still answers 204.");
ok("the old image is deleted only after the new one is saved",
   /const ok = await writeReservationFormValue[\s\S]{0,120}removeBrandImageByUrl\(previous\)/.test(app));

console.log("\nEvery new phrase is translatable");
const dict = cfg.slice(cfg.indexOf("const ID_DICT = {"));
for (const phrase of ["Deposit payment details", "Bank transfer details", "QRIS image",
                      "No QRIS uploaded", "WhatsApp number for payment confirmation",
                      "QRIS updated", "QRIS removed"]) {
  ok(`"${phrase}" has an Indonesian entry`, dict.includes(`"${phrase}":`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
