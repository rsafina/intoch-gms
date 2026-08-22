// Checks the Invoice Generator in Indonesian.
//
// Two things are being verified, and the second matters more than the
// first: (1) the form UI actually translates, and (2) the invoice sheet
// itself does NOT. The sheet is a guest-facing document; the language
// toggle is a staff preference, and a guest must never receive a
// half-Indonesian invoice because someone flipped a switch in the app.
//
// Run: node js/invoice.i18n.test.js   (needs: npm i jsdom)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Boots a fresh copy of the page in the given language. Two separate
// DOMs are needed because the app reads the language once at load and
// reloads the page to change it.
function bootPage(lang) {
  const dom = new JSDOM(read("index.html"), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const win = dom.window;
  global.window = win;
  global.document = win.document;
  win.localStorage.setItem("gms_lang", lang);
  // config.js opens a Supabase client at load; this test never touches
  // the network, so a stub is enough to get past line 12.
  win.supabase = { createClient: () => ({}) };
  Object.defineProperty(win.HTMLElement.prototype, "clientWidth", { value: 900 });

  // One eval, not three: `let`/`const` at the top level of an eval are
  // scoped to that eval, so loading the files separately would hide
  // CURRENT_LANG and ID_DICT from each other. In the browser they are
  // ordinary global scripts and see one another fine. The trailing
  // snippet is the only way to read those bindings back out afterwards.
  win.eval(
    [
      read("js/config.js"),
      read("js/i18n.js"),
      read("js/invoice.js"),
      // vouchers.js only defines functions at load, so it is safe to
      // include without a database: nothing here calls initVouchers().
      read("js/vouchers.js"),
      "window.__probe = { get lang() { return CURRENT_LANG; }, dict: ID_DICT };",
    ].join("\n;\n"),
  );
  return win;
}

const w = bootPage("id");

let fails = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label}: ${actual}${ok ? "" : `  (expected ${expected})`}`,
  );
}
const $ = (id) => w.document.getElementById(id);
const set = (id, v) => {
  $(id).value = v;
  $(id).dispatchEvent(new w.Event("input", { bubbles: true }));
  $(id).dispatchEvent(new w.Event("change", { bubbles: true }));
};
const itemIds = () =>
  [...w.document.querySelectorAll("#inv-items .inv-del")].map((b) =>
    parseInt(b.getAttribute("onclick").match(/\d+/)[0], 10),
  );
const addItem = (name, qty, price) => {
  w.invAddItem();
  const id = itemIds().pop();
  w.invOnItemInput(id, "name", name);
  w.invOnItemInput(id, "qty", qty);
  w.invOnItemInput(id, "price", price);
  return id;
};
const tick = () => new Promise((r) => setTimeout(r, 60));

// Terms that stay English on purpose: every one of them also appears on
// the printed sheet, so translating the form label would break the link
// between the box someone types in and the line it fills.
const STAYS_ENGLISH = new Set([
  "BILL TO :", "Bill to", "Name", "Table", "Pax", "Receipt no",
  "Payment date", "Payment Date", "Event date", "Event Date",
  "Items", "Qty", "Unit Price", "Unit price", "Amount", "Sub Total",
  "Service Charge", "Svc %", "Tax", "Tax %", "Total", "Down Payment",
  "DP %", "Settlement", "Invoice", "auto", "PDF",
  "We look forward to welcome you at Blue Heron :)",
]);

// Anything the dictionary already produces is, by definition, done —
// several Indonesian strings legitimately contain "invoice" or "item".
const translated = new Set(Object.values(w.__probe.dict));

(async () => {
  console.log("\n== Language defaults ==");
  // CURRENT_LANG is a `let` inside the eval scope, so it is read back
  // the same way the page's own scripts see it, not off window.
  check("app default language", w.__probe.lang, "id");

  w.initInvoice();
  set("inv-name", "Ibu Anung");
  addItem("Soto Buntut Betawi", "35", "136000");
  await tick();

  console.log("\n== 1. The form speaks Indonesian ==");
  const section = $("page-invoice");
  const text = section.textContent.replace(/\s+/g, " ");
  check("intro", /Tidak ada data yang disimpan ke sistem/.test(text), "true");
  check("date hint", /Kosongkan tanggalnya/.test(text), "true");
  check("amount hint", /Amount dihitung dari Qty × Unit Price/.test(text), "true");
  check("settlement hint", /Settlement adalah Total dikurangi Down Payment/.test(text), "true");
  check("service toggle", /Tampilkan baris service charge/.test(text), "true");
  check("tax toggle", /Tampilkan baris pajak/.test(text), "true");
  check("note label", /Catatan \(di kiri bawah invoice\)/.test(text), "true");
  check("preview label", /Pratinjau: persis seperti inilah tampilan PDF nanti/.test(text), "true");
  check("download button", /Unduh PDF/.test(text), "true");
  check("history empty state", /Belum ada\. 5 invoice terakhir/.test(text), "true");

  console.log("\n== 2. Strings carrying a figure or a count ==");
  $("inv-svc-on").checked = false;
  $("inv-svc-on").dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  check(
    "tax base note",
    /^Pajak dihitung dari Sub Total \(Rp [\d.]+\)\.$/.test(
      $("inv-tax-base-note").textContent.trim(),
    ),
    "true",
  );
  $("inv-svc-on").checked = true;
  $("inv-svc-on").dispatchEvent(new w.Event("change", { bubbles: true }));
  set("inv-svc-pct", "5");
  await tick();
  check(
    "tax base note with service",
    /^Pajak dihitung dari Sub Total \+ Service Charge \(Rp [\d.]+\)\.$/.test(
      $("inv-tax-base-note").textContent.trim(),
    ),
    "true",
  );
  addItem("Paket Prasmanan Lengkap Untuk Acara Ulang Tahun Perusahaan", "1", "1000");
  await tick();
  check(
    "long-name warning",
    /terlalu panjang untuk kolom Items dan akan terpotong/.test(
      $("inv-name-warning").textContent,
    ),
    "true",
  );

  console.log("\n== 3. Messages ==");
  set("inv-name", "");
  w.invDownloadPdf();
  await tick();
  check("guard toast", $("toast").textContent.trim(), "Isi nama tamu dulu.");

  console.log("\n== 4. The invoice sheet stays English ==");
  const sheet = $("inv-sheet").textContent.replace(/\s+/g, " ");
  check("BILL TO", /BILL TO/.test(sheet), "true");
  check("Sub Total", /Sub Total/.test(sheet), "true");
  check("Service Charge", /Service Charge/.test(sheet), "true");
  check("Down Payment", /Down Payment/.test(sheet), "true");
  check("closing line", /We look forward to welcome you at Blue Heron/.test(sheet), "true");
  check("no Indonesian leaked in", /Pajak|Catatan|Perhitungan|Unduh/.test(sheet), "false");

  console.log("\n== 5. Every visible form string is accounted for ==");
  // Anything still in English here is either a missing dictionary entry
  // or a deliberate exception. Listing them is the point: a silent gap
  // is how half-translated screens happen.
  const leftovers = [];
  const walker = w.document.createTreeWalker(section, w.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest("[data-i18n-skip]")) continue;
    const s = (node.nodeValue || "").trim().replace(/\s+/g, " ");
    if (!s || STAYS_ENGLISH.has(s) || translated.has(s)) continue;
    // Crude but effective: these words only appear in untranslated copy.
    if (/\b(the|this|and|with|you|your|will|line|show|item|invoice)\b/i.test(s))
      leftovers.push(s);
  }
  if (leftovers.length) {
    fails++;
    console.log("  FAIL untranslated strings still on the page:");
    leftovers.forEach((s) => console.log("        · " + s));
  } else {
    console.log("  ok   no untranslated copy left on the page");
  }

  console.log("\n== 6. The voucher page speaks Indonesian too ==");
  const vsec = $("page-vouchers");
  const vtext = vsec.textContent.replace(/\s+/g, " ");
  check("intro", /Voucher hadiah di luar program membership/.test(vtext), "true");
  check("redeem card", /Tukarkan voucher/.test(vtext), "true");
  check("issue card", /Terbitkan voucher/.test(vtext), "true");
  check("occasion options", /Terima kasih untuk top spender/.test(vtext), "true");
  // Written by vouchers.js, not present in the HTML, so this also
  // proves the MutationObserver reaches dynamically rendered copy.
  w.vchSetValueType("amount");
  await tick();
  check("value help", /Potongan rupiah tetap/.test(vsec.textContent), "true");
  w.vchSetValueType("percent");
  await tick();
  check("percent help", /Beri batas maksimal/.test(vsec.textContent), "true");
  check("batches card", /Berapa yang dibagikan/.test(vtext), "true");
  check(
    "no untranslated copy left",
    (() => {
      const walk = w.document.createTreeWalker(vsec, w.NodeFilter.SHOW_TEXT);
      const left = [];
      while (walk.nextNode()) {
        const t = (walk.currentNode.nodeValue || "").trim().replace(/\s+/g, " ");
        if (!t || STAYS_ENGLISH.has(t) || translated.has(t)) continue;
        if (/\b(the|this|and|with|you|your|will|line|show|item|invoice|voucher)\b/i.test(t))
          left.push(t);
      }
      if (left.length) console.log("        leftovers: " + left.join(" | "));
      return left.length === 0;
    })(),
    "true",
  );

  console.log("\n== 7. English mode is untouched ==");
  const en = bootPage("en");
  en.initInvoice();
  await tick();
  const enText = en.document.getElementById("page-invoice").textContent.replace(/\s+/g, " ");
  check("language", en.__probe.lang, "en");
  check("hints stay English", /Type over it if you need a different figure/.test(enText), "true");
  check("checkbox stays English", /Show a settlement line/.test(enText), "true");
  check("no Indonesian bleed", /Pratinjau|Bersihkan|Unduh PDF/.test(enText), "false");
  check(
    "sheet is English here too",
    /BILL TO/.test(en.document.getElementById("inv-sheet").textContent),
    "true",
  );

  console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
