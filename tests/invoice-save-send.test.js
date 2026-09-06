// Phase 3 of the managed-event flow: the invoice generator becomes save, link
// and send, and a guest opens the same document from WhatsApp.
//
// The decision this file protects, taken with Rere on 2026-09-06: the sheet has
// ONE definition. Before this, the markup, its CSS and the renderer all lived
// inside the staff page. Copying them to the guest page would have guaranteed
// the two drift, and the guest would download something that looks nothing like
// what staff previewed before pressing send.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const exists = (f) => fs.existsSync(path.join(root, f));

const sheetJs = read("js/invoice-sheet.js");
const sheetCss = read("css/invoice-sheet.css");
const invoiceJs = read("js/invoice.js");
const staff = read("index.html");
const guest = read("invoice-view.template.html");
const wa = read("js/wa.js");
const sql = read("migrations/ALL_IN_ONE.sql");
const build = read("build-config.js");
const gitignore = read(".gitignore");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}
// Comments are stripped wherever a check looks for the ABSENCE of something.
// This code explains at length what it deliberately does not do, and grepping
// raw text keeps flagging the explanation as the thing it warns against. That
// mistake has been made four times in this project.
const noJsComments = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
// The guest page is HTML with JS inside it, and both kinds of comment in it
// describe exactly what it must not do.
const noComments = (s) => noJsComments(s.replace(/<!--[\s\S]*?-->/g, ""));
const guestCode = noComments(guest);

console.log("\nThe sheet has one definition, not two");
ok("the shared renderer exists", exists("js/invoice-sheet.js"));
ok("the shared stylesheet exists", exists("css/invoice-sheet.css"));
ok(
  "the staff page no longer carries the sheet's CSS",
  !/#inv-sheet\s*\{/.test(staff),
  "A second copy of these rules is how the html2canvas colour trap comes " +
    "back: it would look right on screen and wrong in the guest's PDF.",
);
ok("the staff page links the shared stylesheet", /css\/invoice-sheet\.css/.test(staff));
ok("the guest page links the SAME stylesheet", /css\/invoice-sheet\.css/.test(guest));
ok(
  "neither page hand-writes the sheet's markup",
  !/inv-billto/.test(staff) && !/inv-billto/.test(guest),
  "Both must build it from invSheetMarkup(), or the two documents drift.",
);
ok("both pages build it from invSheetMarkup()", /invSheetMarkup\(\)/.test(invoiceJs) && /invSheetMarkup\(\)/.test(guest));
ok("both pages render it with invSheetRender()", /invSheetRender\(/.test(invoiceJs) && /invSheetRender\(/.test(guest));
ok(
  "the shared file loads before the file that calls into it",
  staff.indexOf("js/invoice-sheet.js") < staff.indexOf("js/invoice.js?"),
);

console.log("\nThe shared file can actually be loaded by the guest page");
ok(
  "it does not depend on config.js",
  !/\bt\(\s*"/.test(noJsComments(sheetJs)) && !/\btoast\(/.test(noJsComments(sheetJs)),
  "reserve.html cannot load config.js because both declare `const " +
    "SUPABASE_URL`, and neither can this page. A t() or toast() in here is a " +
    "page that dies on load.",
);
ok(
  "the PDF reports through a callback the caller supplies",
  /say\s*=\s*o\.say/.test(sheetJs) || /o\.say \|\|/.test(sheetJs),
);
ok(
  "the guest page does not load config.js",
  !/js\/config\.js/.test(guestCode),
);
ok(
  "the sheet is drawn from a snapshot, never from form fields",
  !/invVal\(/.test(sheetJs) && !/invEl\(/.test(sheetJs),
  "Reading an input here would work on the staff page and render an empty " +
    "document on the guest's.",
);

console.log("\nThe document, the saved row and the guest's copy are one object");
ok(
  "what is saved is what invSnapshot() produced",
  /doc: snap/.test(invoiceJs),
);
ok(
  "the summary columns are computed from that same snapshot",
  /function invSummaryFrom\(snap\)/.test(invoiceJs) &&
    /invSummaryFrom\(snap\)/.test(invoiceJs),
  "Computing them from the form separately is how the columns and the " +
    "document end up stating different numbers.",
);
ok(
  "the guest page renders the stored doc, not a rebuild",
  /invSheetRender\(SNAP\)/.test(guest) && /row\.doc/.test(guest),
);

console.log("\nSaving cannot silently do nothing");
const save = invoiceJs.slice(invoiceJs.indexOf("async function invSaveInvoice"), invoiceJs.indexOf("// ── Local history"));
ok("the insert asks for the row back", /\.insert\(payload\)\.select\(/.test(save));
ok("the update asks for the row back", /\.update\(payload\)[\s\S]{0,60}\.select\(/.test(save));
ok(
  "an empty result is treated as failure, not success",
  (save.match(/!data \|\| !data\.length/g) || []).length >= 2,
  "PostgREST answers 204 for a write that matched nothing, byte-identical " +
    "to success. This cost days of silently failing area saves in September.",
);
ok(
  "the number comes from the database, not the browser",
  /db\.rpc\("next_invoice_no"\)/.test(save),
  "Two staff saving at the same moment would otherwise both read the same " +
    "maximum and take the same number.",
);
ok(
  "re-saving keeps the number and the token",
  /invSavedId/.test(save) && !/payload\.invoice_no = /.test(save.slice(save.indexOf("if (invSavedId)"), save.indexOf("} else {"))),
  "A guest who already has the link must still reach the document, and " +
    "renumbering breaks the restaurant's own books.",
);

console.log("\nLoading a different invoice does not overwrite the last one");
ok(
  "applying a snapshot clears the saved-row handle",
  /function invApplySnapshot\(h\) \{[\s\S]{0,600}invSavedId = null/.test(invoiceJs),
  "Otherwise loading yesterday's invoice from the local history and pressing " +
    "Save rewrites yesterday's saved document, keeping its number, and the " +
    "guest holding that link sees somebody else's bill.",
);
ok(
  "clearing the form clears it too",
  /function invReset\(\) \{[\s\S]{0,700}invSavedId = null/.test(invoiceJs),
);

console.log("\nSending never gets ahead of saving");
ok(
  "the save happens before WhatsApp is opened",
  save.indexOf(".insert(payload)") < save.indexOf("waOpenChat"),
  "Opening the chat first means a link to an invoice that was never stored.",
);
ok(
  "a blocked popup does not lose the work",
  /copy the link/i.test(save),
  "The invoice exists either way; staff must be told so, and left the link.",
);
ok(
  "sending refuses without a usable number",
  /waPhone\(phone\)/.test(save),
);
ok(
  "saving does NOT require a phone number",
  save.indexOf("if (send && !waPhone(phone))") > 0,
  "A company order often has no number to hand, and the link can be copied.",
);
ok(
  "the invoice template uses {invoice}, never the broadcast {link}",
  // Bounded to the invoice_send entry itself. An open-ended window ran on
  // into the next template in the file, which legitimately carries {link}
  // because it IS a broadcast.
  (() => {
    const i = wa.indexOf("invoice_send: {");
    const entry = wa.slice(i, wa.indexOf("\n  },", i));
    return i > 0 && entry.includes("{invoice}") && !entry.includes("{link}");
  })(),
  "{link} belongs to the campaign page and is treated as such by the send " +
    "path; a transactional template carrying it ships a dead placeholder. " +
    "campaign-editor.test.js pins that separation.",
);
ok(
  "a template edited to drop the link still carries it",
  /msg\.includes\(ctx\.link\)/.test(wa),
);

console.log("\nThe guest page");
ok("it reads through the token function only", /invoice_by_token/.test(guest));
ok(
  "it never queries a table directly",
  !/\.from\(/.test(guest),
  "The anon key is public. A direct table read from this page is a way to " +
    "walk every invoice the restaurant has issued.",
);
ok(
  "a network failure is not reported as a dead link",
  /Periksa koneksi/.test(guest),
  "Telling a guest their invoice was cancelled because their wifi dropped " +
    "starts a phone call.",
);
ok("it is not indexed", /noindex/.test(guest));
ok(
  "it has no share card",
  !/<meta\s+property="og:/i.test(guest),
  "A WhatsApp preview would show the guest's name and what they owe to " +
    "everyone in the group before anyone opened it.",
);
ok(
  "the sheet is fitted AFTER it is made visible",
  // Comments stripped: the stylesheet comment at the top of the page names
  // invSheetFit, and indexOf found that instead of the call.
  guestCode.indexOf('show("invoice")') < guestCode.indexOf("invSheetFit"),
  "A hidden element has no width, so fitting it first scales it to zero.",
);
ok("the guest can download the PDF", /invSheetPdf\(/.test(guest));

console.log("\nOnly issued invoices are reachable");
const fn = sql.slice(sql.indexOf("create or replace function public.invoice_by_token"), sql.indexOf("grant execute on function public.invoice_by_token"));
ok("invoice_by_token exists", fn.length > 100);
ok("it is SECURITY DEFINER, so the page needs no table access", /security definer/.test(fn));
ok("a draft or voided invoice returns nothing", /status = 'issued'/.test(fn));
ok(
  "it exposes no phone number",
  !/phone/.test(fn),
  "The deposit page's function was written to the same rule.",
);
ok("it returns at most one row", /limit 1/.test(fn));

console.log("\nThe page is wired into the build");
ok("registered in build-config.js", /invoice-view\.template\.html/.test(build));
ok(
  "it requires every placeholder it contains",
  ["__SUPABASE_URL__", "__SUPABASE_ANON_KEY__", "__SITE_URL__", "__RESTAURANT_NAME__"].every(
    (p) => guest.includes(p) && build.includes(p),
  ),
  "A placeholder in the template that the build does not require ships to " +
    "guests as literal __SITE_URL__.",
);
ok("the built file is gitignored", /invoice-view\.html/.test(gitignore));
ok(
  "the link is built from the page's own address",
  /new URL\(\s*"invoice-view\.html/.test(invoiceJs),
  "A configured base URL that is wrong produces a link that 404s in a " +
    "guest's phone and nowhere anybody here would see it.",
);

console.log("\nThe stylesheet keeps its literal colours");
ok(
  "no CSS variable in the rasterised sheet",
  !/var\(--(?:brand|accent)/.test(sheetCss),
  "html2canvas cannot resolve custom properties. This is the one place a " +
    "var() looks right on screen and comes out wrong in the PDF.",
);
ok(
  "the file says why",
  /html2canvas/.test(sheetCss),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
