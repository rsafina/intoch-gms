// Headless check of the invoice logic against the real index.html markup.
// No Chrome in this sandbox, so this verifies the maths, the DOM wiring and
// the preview text — not the visual layout.
//
// Note: invoice.js declares its state with `let`, which in a browser is a
// global lexical binding but inside JSDOM's window.eval is scoped to the eval.
// So this harness only ever drives the module through its public functions,
// reading item ids back out of the rendered DOM — which is closer to what a
// real user does anyway.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Was an absolute path into a DIFFERENT repo on one particular machine, so
// this suite could never run anywhere else. Anchored to this repo instead.
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(ROOT + "/index.html", "utf8");
const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window: w } = dom;

global.window = w;
global.document = w.document;
global.localStorage = w.localStorage;
w.confirm = () => true;
w.toast = (m, kind) => console.log(`  toast[${kind || "ok"}]: ${m}`);
// config.js is not loaded here, so t() (the i18n lookup) is stubbed as a
// pass-through. Translation itself is covered by js/invoice.i18n.test.js.
w.t = (s) => s;
// Same reason: restaurantName() lives in config.js and reads app_settings.
// The invoice header is not what this suite measures, so a fixed name keeps
// the arithmetic under test isolated from the branding settings.
w.restaurantName = () => "Restoran";
w.currentPage = "invoice";
Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { value: 900 });

w.eval(fs.readFileSync(ROOT + "/js/invoice.js", "utf8"));

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
// Item ids as the UI knows them, scraped from the rendered remove buttons.
const num = (id) => w.invParseNum($(id).value);
const itemIds = () =>
  [...w.document.querySelectorAll("#inv-items .inv-del")].map((b) =>
    parseInt(b.getAttribute("onclick").match(/\d+/)[0], 10),
  );
const clearItems = () => {
  // invRemoveItem always leaves one blank row behind, by design.
  itemIds().forEach((id) => w.invRemoveItem(id));
};
const addItem = (name, qty, price) => {
  w.invAddItem();
  const id = itemIds().pop();
  w.invOnItemInput(id, "name", name);
  w.invOnItemInput(id, "qty", qty);
  w.invOnItemInput(id, "price", price);
  return id;
};

console.log("\n== 1. Ibu Anung sample reproduces the printed invoice ==");
w.initInvoice();
set("inv-name", "Ibu Anung");
set("inv-table", "Takeaway");
set("inv-pax", "35");
set("inv-receipt", "787873");
set("inv-paydate", "2026-07-24");
set("inv-eventdate", "2026-08-01");
clearItems();
addItem("Soto Buntut Betawi", "35", "136.000"); // typed with dots, on purpose
addItem("Aglio e Olio Pepperoncino", "35", "75000");
const thirdId = addItem("Aglio e Olio Pepperoncino", "10", "Rp 10.000"); // prefix, on purpose

check("sub total", num("inv-subtotal"), 7485000);
check("service charge (blank)", $("inv-svc").value, "");
check("tax 10%", num("inv-tax"), 748500);
check("total", num("inv-total"), 8233500);
check("down payment 50%", num("inv-dp"), 4116750);
check("payment date printed", w.invDateId("2026-07-24"), "24 Juli 2026");
check("event date printed", w.invDateId("2026-08-01"), "1 Agustus 2026");
check("row slots always 8+", $("inv-p-rows").children.length, 8);
check(
  "first row text",
  $("inv-p-rows").children[0].textContent.replace(/\s+/g, " ").trim(),
  "Soto Buntut Betawi 35 Rp 136.000 / Pax Rp 4.760.000",
);
console.log(
  "  preview totals: " +
    [...$("inv-p-totals").children]
      .map((r) => r.textContent.replace(/\s+/g, " ").trim())
      .join(" | "),
);
console.log(
  "  preview meta:   " +
    [...$("inv-p-meta-left").children, ...$("inv-p-meta-right").children]
      .map((r) => r.textContent.replace(/\s+/g, " ").trim())
      .join(" | "),
);

console.log("\n== 2. Service charge feeds the tax base ==");
set("inv-svc-pct", "5");
check("service 5%", num("inv-svc"), 374250);
check("tax on subtotal + service", num("inv-tax"), 785925);
check("total", num("inv-total"), 7485000 + 374250 + 785925);
set("inv-svc-pct", "");
check("clearing service % blanks the line", $("inv-svc").value, "");
check("tax back to subtotal only", num("inv-tax"), 748500);
check("total back", num("inv-total"), 8233500);

console.log("\n== 3. Manual override survives, 'auto' releases it ==");
set("inv-total", "8000000");
check("manual total held", num("inv-total"), 8000000);
check("dp follows manual total", num("inv-dp"), 4000000);
w.invOnItemInput(thirdId, "qty", "12"); // a recalc elsewhere must not stomp it
check("still held after a recalc", num("inv-total"), 8000000);
const resetBtn = (k) =>
  [...w.document.querySelectorAll("[data-reset]")].find((b) => b.dataset.reset === k);
resetBtn("total").click();
check("auto recomputes total", num("inv-total"), Math.round(7505000 * 1.1));
set("inv-subtotal", "1000000");
check("manual subtotal drives tax", num("inv-tax"), 100000);
resetBtn("subtotal").click();
check("auto restores subtotal from items", num("inv-subtotal"), 7505000);

console.log("\n== 4. Odd rounding and non-round percentages ==");
clearItems();
addItem("Set menu", "3", "33333");
set("inv-tax-pct", "11");
set("inv-dp-pct", "33.3");
check("subtotal", num("inv-subtotal"), 99999);
check("tax 11% rounded", num("inv-tax"), 11000);
check("total", num("inv-total"), 110999);
check("dp 33.3% rounded", num("inv-dp"), Math.round(110999 * 0.333));
check("percent label 33.3", w.invPctLabel(33.3), "33,3");
check("percent label 50", w.invPctLabel(50), "50");
check(
  "dp label in preview",
  /Down Payment 33,3%/.test($("inv-p-totals").textContent),
  "true",
);

console.log("\n== 5. Down payment can be switched off ==");
$("inv-dp-on").checked = false;
$("inv-dp-on").dispatchEvent(new w.Event("change", { bubbles: true }));
check("no DP bar in preview", /Down Payment/.test($("inv-p-totals").textContent), "false");
check("DP fields hidden", $("inv-dp-fields").style.display, "none");

console.log("\n== 6. Empty form does not throw or print junk ==");
w.invReset();
check("subtotal blank", $("inv-subtotal").value, "");
check("tax blank", $("inv-tax").value, "");
check("dp blank", $("inv-dp").value, "");
check("preview rows have no Rp junk", /Rp/.test($("inv-p-rows").textContent), "false");
check("8 empty slots still drawn", $("inv-p-rows").children.length, 8);
check("meta hides empty lines", $("inv-p-meta-left").children.length, 0);
check("tax % back to 10", $("inv-tax-pct").value, 10);

console.log("\n== 7. History round-trip (last 5, newest first) ==");
set("inv-name", "Pak Budi");
set("inv-receipt", "999111");
clearItems();
addItem("Nasi Box", "20", "50000");
w.invSaveToHistory();
for (let i = 0; i < 6; i++) {
  set("inv-name", "Guest " + i);
  w.invSaveToHistory();
}
const hist = JSON.parse(localStorage.getItem("bh_invoice_history_v1"));
check("capped at 5", hist.length, 5);
check("newest first", hist[0].name, "Guest 5");
check("history buttons rendered", w.document.querySelectorAll("#inv-history button").length, 5);
// 7 saves, capped at 5 → index 4 is the oldest kept entry (Guest 1).
w.invLoadFromHistory(4);
check("reload restores name", $("inv-name").value, "Guest 1");
check("reload restores items", itemIds().length, 2);
check("reload restores totals", num("inv-total"), 1100000);
check(
  "reload restores item name in preview",
  /Nasi Box/.test($("inv-p-rows").textContent),
  "true",
);

console.log("\n== 8. Duplicate receipt number warns ==");
set("inv-receipt", "999111");
w.invCheckReceipt();
set("inv-receipt", "222333");
w.invCheckReceipt(); // must stay silent

console.log("\n== 9. Download guards ==");
set("inv-name", "");
w.invDownloadPdf(); // expects: name required
set("inv-name", "Someone");
clearItems();
w.invDownloadPdf(); // expects: at least one item
addItem("Item", "1", "1000");
for (let i = 0; i < 12; i++) addItem("Filler " + i, "1", "1000");
w.invDownloadPdf(); // expects: too many items
clearItems();
addItem("Item", "1", "1000");
w.invDownloadPdf(); // expects: library missing (html2canvas is absent in jsdom)

console.log("\n== 10. Corrupt history is survivable ==");
localStorage.setItem("bh_invoice_history_v1", "{not json");
check("reads as empty", w.invReadHistory().length, 0);
w.invRenderHistory();
check("renders the empty state", /Nothing yet/.test($("inv-history").textContent), "true");

console.log("\n== 11. Thousand separators in the form fields ==");
clearItems();
addItem("Item 1", "1", "2300000");
check("auto subtotal is grouped", $("inv-subtotal").value, "2.300.000");
check("auto tax is grouped", $("inv-tax").value, "230.000");
check("auto total is grouped", $("inv-total").value, "2.530.000");
const money = $("inv-total");
money.value = "1234567";
money.selectionStart = 7;
w.invFormatMoneyField(money);
check("typed value gets separators", money.value, "1.234.567");
check("caret stays after the last digit typed", money.selectionStart, 9);
money.value = "12.34a5";
money.selectionStart = 4;
w.invFormatMoneyField(money);
check("junk characters dropped", money.value, "12.345");
money.value = "";
w.invFormatMoneyField(money);
check("empty stays empty", money.value, "");

console.log("\n== 12b. Long item names are flagged, not silently cut ==");
clearItems();
addItem("Nasi Goreng", "1", "50000");
check("no warning for a normal name", $("inv-name-warning").classList.contains("hidden"), "true");
addItem("Paket Prasmanan Lengkap Untuk Acara Ulang Tahun Perusahaan", "1", "50000");
check("warning shown", $("inv-name-warning").classList.contains("hidden"), "false");
check("warning names the item", /Paket Prasmanan/.test($("inv-name-warning").textContent), "true");
check("item name renders as a bare cell", /<span/.test($("inv-p-rows").innerHTML), "false");

console.log("\n== 13. Filename is safe ==");
check("slashes and quotes stripped", w.invSafeFileName('Ibu "Anung" / PT. Maju'), "Ibu-Anung-PT-Maju");
check("empty stays empty", w.invSafeFileName(""), "");

console.log("\n== 14. Charge lines can be switched off entirely ==");
w.invReset();
clearItems();
addItem("Buffet package", "30", "100000");
check("baseline total with 10% tax", num("inv-total"), 3300000);
const toggle = (id, on) => {
  $(id).checked = on;
  $(id).dispatchEvent(new w.Event("change", { bubbles: true }));
};
toggle("inv-tax-on", false);
check("tax line gone from the invoice", /Tax/.test($("inv-p-totals").textContent), "false");
check("tax removed from the total, not just hidden", num("inv-total"), 3000000);
check("tax fields hidden in the form", $("inv-tax-fields").style.display, "none");
check("tax base note hidden", $("inv-tax-base-note").style.display, "none");
toggle("inv-svc-on", false);
check("service line gone", /Service Charge/.test($("inv-p-totals").textContent), "false");
check("sub total still prints", /Sub Total/.test($("inv-p-totals").textContent), "true");
toggle("inv-svc-on", true);
set("inv-svc-pct", "5");
check("service back in the total", num("inv-total"), 3150000);
toggle("inv-tax-on", true);
check("tax back, charged on subtotal + service", num("inv-total"), 3000000 + 150000 + 315000);
check("service label prints with no figure when % is blank", true, true);
toggle("inv-svc-on", false);
toggle("inv-tax-on", false);
check("both off leaves total equal to subtotal", num("inv-total"), 3000000);

console.log("\n== 15. Settlement line ==");
set("inv-dp-pct", "30");
check("dp 30%", num("inv-dp"), 900000);
check("settlement hidden by default", /Settlement/.test($("inv-p-totals").textContent), "false");
toggle("inv-settle-on", true);
check("settlement = total - dp", num("inv-settle"), 2100000);
check("settlement prints", /Settlement/.test($("inv-p-totals").textContent), "true");
set("inv-dp-pct", "50");
check("settlement follows the dp", num("inv-settle"), 1500000);
set("inv-dp", "1.000.000");
check("settlement follows a hand-typed dp", num("inv-settle"), 2000000);
set("inv-settle", "1.234.000");
check("settlement can be overridden", num("inv-settle"), 1234000);
set("inv-dp-pct", "40");
check("override released when the dp % changes", num("inv-settle"), 1800000);
toggle("inv-dp-on", false);
check("settlement goes with the down payment", /Settlement/.test($("inv-p-totals").textContent), "false");
check("settlement fields hidden too", $("inv-settle-fields").style.display, "none");
toggle("inv-dp-on", true);
check("settlement returns", /Settlement/.test($("inv-p-totals").textContent), "true");

console.log("\n== 15b. Paid deposit reads differently from money still owed ==");
const bars = () => [...$("inv-p-totals").querySelectorAll(".inv-tbar")].map((b) => ({
  label: b.firstElementChild.textContent,
  paid: b.classList.contains("inv-tbar-paid"),
}));
toggle("inv-settle-on", false);
check("no settlement: dp bar is solid", bars().some((b) => b.label.startsWith("Down Payment 4") && !b.paid), "true");
check("no settlement: label has no 'Paid'", /Paid/.test($("inv-p-totals").textContent), "false");
toggle("inv-settle-on", true);
const withSettle = bars();
check("dp bar marked as paid", withSettle.find((b) => /Down Payment/.test(b.label)).paid, "true");
check("dp label says Paid, keeps the %", withSettle.find((b) => /Down Payment/.test(b.label)).label, "Down Payment Paid 40%");
check("settlement bar stays solid", withSettle.find((b) => b.label === "Settlement").paid, "false");
check("total bar never marked paid", withSettle.find((b) => b.label === "Total").paid, "false");

console.log("\n== 16. Old saved invoices still open correctly ==");
localStorage.setItem(
  "bh_invoice_history_v1",
  JSON.stringify([{ savedAt: new Date().toISOString(), name: "Legacy", items: [], subtotal: "1.000.000", taxPct: "10", tax: "100.000", total: "1.100.000", dpOn: true, dpPct: "50", dp: "550.000" }]),
);
w.invRenderHistory();
w.invLoadFromHistory(0);
check("tax line assumed on for pre-toggle invoices", $("inv-tax-on").checked, "true");
check("service line assumed on", $("inv-svc-on").checked, "true");
check("settlement assumed off", $("inv-settle-on").checked, "false");
check("total unchanged on reopen", num("inv-total"), 1100000);

console.log("\n== 17. Export applies the baseline nudge, then cleans up ==");
(async () => {
  const sheet = $("inv-sheet");
  let classDuringCapture = null;
  w.html2canvas = async (node) => {
    classDuringCapture = node.className;
    return { toDataURL: () => "data:image/jpeg;base64,AA" };
  };
  let savedAs = null;
  w.jspdf = {
    jsPDF: class {
      addImage() {}
      save(name) {
        savedAs = name;
      }
    },
  };
  clearItems();
  set("inv-name", "Ibu Anung");
  set("inv-receipt", "787873");
  addItem("Soto Buntut Betawi", "1", "136000");
  await w.invDownloadPdf();
  check("nudge applied during capture", /inv-exporting/.test(classDuringCapture), "true");
  check("nudge removed afterwards", sheet.classList.contains("inv-exporting"), "false");
  check("preview scale restored", $("inv-scaler").style.transform !== "none", "true");
  check("filename", savedAs, "Invoice-787873-Ibu-Anung.pdf");
  check("download was added to history", w.invReadHistory()[0].name, "Ibu Anung");

  console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
