// ============================================================
// THE INVOICE SHEET — shared by the staff generator and the guest page
// ============================================================
// The printed A4 document itself: its markup, the code that fills it from an
// invoice, and the PDF export. Its stylesheet is css/invoice-sheet.css.
//
// WHY THIS FILE EXISTS
// Until 2026-09-06 all of this lived inside js/invoice.js, which reads the
// staff form's inputs directly. Then invoices became things you save and send:
// staff fill the form, press send, and the guest opens a link and downloads the
// same document as a PDF. Two pages now draw it. Copying the renderer onto the
// second page would have guaranteed the two drift, and a guest would download
// something that looks nothing like what staff previewed before sending.
//
// So nothing in here reads a form field. Everything takes a SNAPSHOT: the plain
// object invSnapshot() produces, which is also exactly what is stored in
// invoices.doc. Staff preview, saved invoice, and guest page are then the same
// object rendered by the same function, and cannot disagree.
//
// This file must NOT depend on js/config.js. The guest page cannot load it —
// both declare `const SUPABASE_URL`, and the redeclaration kills the page, the
// same restriction js/guest-i18n.js is written around. So there is no t() and
// no toast() here; invSheetPdf reports through a callback the caller supplies.
//
// The sheet is deliberately English on both pages. It is a financial document,
// and invoice.i18n.test.js pins that.

// A4 at 96dpi. Change these and the jsPDF page size below must change too.
const INV_SHEET_W = 794;
const INV_SHEET_H = 1123;

// The printed sheet always shows 8 row slots, filled or not: that is how the
// original design looks, and an invoice with two items should not have a
// collapsed, half-empty table. More than 8 simply grows the table; past 11 it
// would run into the totals block, so the export warns instead of silently
// producing an overlapping page.
const INV_MIN_ROWS = 8;
const INV_MAX_ROWS = 11;
// The Items column is 44% of a 702px content area at 12.5px, so roughly 44
// characters fit. Anything longer is silently cut off by the cell.
const INV_MAX_NAME_CHARS = 44;

// Rupiah has no cents in practice here, and staff type it in
// every shape imaginable: "136000", "136.000", "Rp 136.000",
// "136,000". Strip everything that is not a digit and treat
// the rest as whole rupiah. A blank stays blank (null), which
// is different from zero — a blank Service Charge is hidden on
// the sheet, a zero is printed as Rp 0.
function invParseNum(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^\d]/g, "");
  if (digits === "") return null;
  return parseInt(digits, 10);
}

// Percentages may legitimately have a decimal (e.g. 11.5% tax).
function invParsePct(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^\d.,]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function invRupiah(n) {
  if (n === null || n === undefined) return "";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

// 2300000 → "2.300.000". Used inside the form fields themselves,
// not just the preview: seven unbroken digits are genuinely hard
// to read, and a mistyped extra zero is the one error on this
// page that reaches a guest as a wrong price.
function invGroup(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("id-ID");
}

// "2026-07-24" → "24 Juli 2026". Built from the yyyy-mm-dd
// parts, never through new Date(str).toLocaleDateString with a
// bare date string — that is parsed as UTC and prints the day
// before in Jakarta. Same bug already documented in config.js.
const INV_MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function invDateId(ymd) {
  if (!ymd) return "";
  const parts = String(ymd).split("-");
  if (parts.length !== 3) return String(ymd);
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!y || !m || !d || m < 1 || m > 12) return String(ymd);
  return `${d} ${INV_MONTHS_ID[m - 1]} ${y}`;
}

function invSafeFileName(s) {
  return String(s || "")
    .trim()
    .replace(/[^a-zA-Z0-9\-_ ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

// Qty × unit price, unless the person typed their own amount.
function invItemAmount(item) {
  if (item.amountLocked) return invParseNum(item.amount);
  const qty = invParseNum(item.qty);
  const price = invParseNum(item.price);
  if (qty === null || price === null) return null;
  return qty * price;
}

function invEscape(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 50 not 50.0, but 12.5 stays 12.5.
function invPctLabel(n) {
  return Number(n) % 1 === 0 ? String(Number(n)) : String(n).replace(".", ",");
}

// ── The sheet's own markup ──────────────────────────────────
// Returned as a string rather than written into both pages by hand. It used to
// be static markup inside index.html; the guest page needed the same nodes, and
// a second copy is a second thing to keep in step.
//
// The ids here are what invSheetRender fills. The labels are wrapped in spans
// so the export nudge (see .inv-exporting in the stylesheet) can move the text
// without moving the cells' white divider borders.
function invSheetMarkup() {
  return `
    <div class="inv-frame">
      <img class="inv-logo" data-brand-logo="full" src="assets/full-logo.png" alt="Logo" />
      <div class="inv-rule-top"></div>

      <div class="inv-billto">BILL TO :</div>
      <div class="inv-meta">
        <div class="inv-meta-col" id="inv-p-meta-left"></div>
        <div class="inv-meta-col" id="inv-p-meta-right"></div>
      </div>

      <div class="inv-thead">
        <div class="inv-c1"><span>Items</span></div>
        <div class="inv-c2"><span>Qty</span></div>
        <div class="inv-c3"><span>Unit Price</span></div>
        <div class="inv-c4"><span>Amount</span></div>
      </div>
      <div id="inv-p-rows"></div>

      <div class="inv-bottom">
        <div class="inv-note" id="inv-p-note"></div>
        <div class="inv-totals" id="inv-p-totals"></div>
      </div>

      <div class="inv-footer">
        <img class="inv-heron" data-brand-logo="small" src="assets/small-logo.png" alt="" />
        <div class="inv-welcome">
          We look forward to welcoming you :)
        </div>
        <div class="inv-rules">
          <div class="inv-rule-a"></div>
          <div class="inv-rule-b"></div>
          <div class="inv-rule-b"></div>
        </div>
        <!-- Filled by applyInvoiceStyle() from app_settings.invoice_style.
             EMPTY here on purpose: this used to carry one particular
             restaurant's real street address plus two unfilled placeholders,
             which a new client would have printed and sent to a guest. -->
        <div class="inv-address"></div>
      </div>
    </div>
  `;
}

// Fills #inv-sheet from a snapshot. Never reads an input, so the same call
// serves the live staff preview, a saved invoice reopened months later, and the
// guest's copy.
function invSheetRender(snap) {
  const el = (id) => document.getElementById(id);
  const s = snap || {};
  const items = s.items || [];

  const left = [
    ["Name", s.name],
    ["Table", s.table],
    ["Pax", s.pax],
  ];
  const right = [
    ["Receipt no", s.receipt],
    ["Payment Date", invDateId(s.paydate)],
    ["Event Date", invDateId(s.eventdate)],
  ];
  const metaHtml = (rows) =>
    rows
      .filter(([, v]) => String(v === undefined || v === null ? "" : v).trim() !== "")
      .map(
        ([k, v]) =>
          `<div class="inv-meta-row"><span class="inv-meta-k">${invEscape(k)}</span><span>: ${invEscape(v)}</span></div>`,
      )
      .join("");
  if (el("inv-p-meta-left")) el("inv-p-meta-left").innerHTML = metaHtml(left);
  if (el("inv-p-meta-right")) el("inv-p-meta-right").innerHTML = metaHtml(right);

  const filled = invSheetFilledItems(snap);
  const slots = Math.max(INV_MIN_ROWS, filled.length);
  let rowsHtml = "";
  for (let i = 0; i < slots; i++) {
    const it = filled[i];
    if (!it) {
      rowsHtml += `<div class="inv-row"><div class="inv-c1"></div><div class="inv-c2"></div><div class="inv-c3"></div><div class="inv-c4"></div></div>`;
      continue;
    }
    const qty = invParseNum(it.qty);
    const price = invParseNum(it.price);
    const unit = String(it.unit || "").trim();
    const unitText =
      price === null ? "" : invRupiah(price) + (unit ? ` / ${unit}` : "");
    rowsHtml += `<div class="inv-row">
      <div class="inv-c1">${invEscape(it.name)}</div>
      <div class="inv-c2">${qty === null ? "" : qty}</div>
      <div class="inv-c3">${invEscape(unitText)}</div>
      <div class="inv-c4">${invRupiah(invItemAmount(it))}</div>
    </div>`;
  }
  if (el("inv-p-rows")) el("inv-p-rows").innerHTML = rowsHtml;

  if (el("inv-p-note")) el("inv-p-note").textContent = s.note || "";

  const subtotal = invParseNum(s.subtotal);
  const svc = invParseNum(s.svc);
  const tax = invParseNum(s.tax);
  const taxPct = invParsePct(s.taxPct);
  const total = invParseNum(s.total);
  const dp = invParseNum(s.dp);
  const dpPct = invParsePct(s.dpPct);
  const settleOn = !!s.dpOn && !!s.settleOn;
  const settle = invParseNum(s.settle);

  // A switched-on line with a blank amount still prints its label: that is how
  // the sample invoice showed Service Charge. Switched off, the line is gone.
  let totalsHtml = `<div class="inv-trow"><span>Sub Total</span><span>${invRupiah(subtotal)}</span></div>`;
  if (s.svcOn) {
    totalsHtml += `<div class="inv-trow"><span>Service Charge</span><span>${invRupiah(svc)}</span></div>`;
  }
  if (s.taxOn) {
    totalsHtml += `<div class="inv-trow"><span>Tax${taxPct ? " " + invPctLabel(taxPct) + "%" : ""}</span><span>${invRupiah(tax)}</span></div>`;
  }
  totalsHtml += `<div class="inv-tbar"><span>Total</span><span>${invRupiah(total)}</span></div>`;
  if (s.dpOn) {
    // With a settlement line present the deposit has already been received, so
    // it shows as a settled amount: pale bar, and "Paid" in the label. Without
    // one, the invoice IS the request for the deposit, so it stays solid like
    // the Total.
    const dpPaidStyle = settleOn ? " inv-tbar-paid" : "";
    const dpLabel = settleOn ? "Down Payment Paid" : "Down Payment";
    totalsHtml += `<div class="inv-tbar${dpPaidStyle}"><span>${dpLabel}${dpPct === null ? "" : " " + invPctLabel(dpPct) + "%"}</span><span>${invRupiah(dp)}</span></div>`;
  }
  if (settleOn) {
    totalsHtml += `<div class="inv-tbar"><span>Settlement</span><span>${invRupiah(settle)}</span></div>`;
  }
  if (el("inv-p-totals")) el("inv-p-totals").innerHTML = totalsHtml;
}

// A row counts as filled if it has a name OR an amount. A priced line with no
// name is still money owed and must print.
function invSheetFilledItems(snap) {
  return ((snap && snap.items) || []).filter(
    (it) => String(it.name || "").trim() !== "" || invItemAmount(it) !== null,
  );
}

// Item names the Items column will silently cut off. Returned rather than
// rendered, so the staff form can warn while it is being typed and the guest
// page can ignore it: by then the document is already agreed.
function invSheetTooLongNames(snap) {
  return invSheetFilledItems(snap).filter(
    (it) => String(it.name || "").length > INV_MAX_NAME_CHARS,
  );
}

// The sheet is a fixed 794px wide. Scale it DOWN, never up, so it fits the
// column on smaller screens. The scale is undone during PDF capture so the
// export is always full resolution.
function invSheetFit(scalerEl) {
  const scaler = scalerEl || document.getElementById("inv-scaler");
  if (!scaler || !scaler.parentElement) return;
  const available = scaler.parentElement.clientWidth;
  if (!available) return;
  const scale = Math.min(1, available / INV_SHEET_W);
  scaler.style.transform = `scale(${scale})`;
  // A scaled element still reserves its unscaled height, which would otherwise
  // leave ~300px of dead space under the sheet.
  scaler.style.height = INV_SHEET_H * scale + "px";
}

// ── PDF ─────────────────────────────────────────────────────
// Rasterises the sheet and wraps it in an A4 page. Reports through opts.say
// rather than toast(), because this file cannot depend on js/config.js.
//
// Returns true when a file was produced. The caller owns its own button state:
// this function must not assume there is one, since the guest page has a
// different button from the staff page.
async function invSheetPdf(snap, opts) {
  const o = opts || {};
  const say = o.say || function () {};
  const scaler = o.scalerEl || document.getElementById("inv-scaler");
  const sheet = o.sheetEl || document.getElementById("inv-sheet");
  if (!sheet) {
    say("The invoice is not ready yet.", "error");
    return false;
  }
  if (typeof html2canvas === "undefined" || !window.jspdf) {
    say("PDF library did not load. Check the internet connection.", "error");
    return false;
  }

  const priorTransform = scaler ? scaler.style.transform : "";
  const priorHeight = scaler ? scaler.style.height : "";
  try {
    // html2canvas reads layout, not the CSS transform, so the scale must come
    // off before capture or the output is soft.
    if (scaler) {
      scaler.style.transform = "none";
      scaler.style.height = "";
    }
    // Baseline compensation, see .inv-exporting in css/invoice-sheet.css.
    sheet.classList.add("inv-exporting");

    const canvas = await html2canvas(sheet, {
      scale: 2, // ~192dpi: sharp when printed, still a sane file size
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: INV_SHEET_W,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(
      canvas.toDataURL("image/jpeg", 0.95),
      "JPEG",
      0,
      0,
      210,
      297,
      undefined,
      "FAST",
    );
    const who = invSafeFileName((snap && snap.name) || "") || "Guest";
    const receipt = invSafeFileName((snap && snap.receipt) || "");
    pdf.save(`Invoice-${receipt ? receipt + "-" : ""}${who}.pdf`);
    return true;
  } catch (err) {
    console.error("[invoice] PDF export failed", err);
    say("Could not build the PDF. Try again.", "error");
    return false;
  } finally {
    // Must run even if the capture threw, or the preview is left stuck at full
    // scale with the export nudge still applied.
    sheet.classList.remove("inv-exporting");
    if (scaler) {
      scaler.style.transform = priorTransform;
      scaler.style.height = priorHeight;
    }
    invSheetFit(scaler);
  }
}
