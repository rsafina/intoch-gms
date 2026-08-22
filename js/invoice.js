// ============================================================
// INVOICE GENERATOR
// ------------------------------------------------------------
// Fill a form → see an A4 sheet → download it as PDF.
//
// Deliberate non-features (asked and confirmed with Rere,
// 2026-07-31):
//   • Nothing is written to Supabase. This is a document
//     generator, not a billing system. An invoice generated
//     here does NOT mean anyone owes or paid anything.
//   • The last 5 are kept in localStorage on this browser
//     only. A different laptop, or a cleared cache, sees an
//     empty list. That is expected — do not "fix" it by
//     adding a table without deciding first who is allowed
//     to edit an already-issued invoice.
//   • Receipt numbers are typed by hand. We can only warn
//     about repeats we happen to have in local history.
//
// Every calculated field (amount, subtotal, service, tax,
// total, DP) auto-fills but stays editable. Once a person
// types into one it is "locked" and calculations stop
// overwriting it — otherwise their correction would vanish
// on the next keystroke elsewhere. The small "auto" button
// next to each field unlocks it again.
// ============================================================

const INV_HISTORY_KEY = "bh_invoice_history_v1";
const INV_HISTORY_MAX = 5;

// Which computed fields the user has overridden by hand.
const invLocked = {
  subtotal: false,
  svc: false,
  tax: false,
  total: false,
  dp: false,
  settle: false,
};

let invItems = [];
let invNextItemId = 1;

// ── Formatting / parsing ────────────────────────────────────

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

// Re-formats a money field while it is being typed in. The caret
// is restored by counting DIGITS rather than characters — dots
// appear and disappear as the number grows, so a plain character
// offset would jump the cursor around mid-typing.
function invFormatMoneyField(el) {
  const raw = el.value;
  const caret = el.selectionStart === null ? raw.length : el.selectionStart;
  const digitsBeforeCaret = (raw.slice(0, caret).match(/\d/g) || []).length;

  const parsed = invParseNum(raw);
  const formatted = parsed === null ? "" : invGroup(parsed);
  if (formatted === raw) return;
  el.value = formatted;

  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBeforeCaret) {
    if (/\d/.test(formatted[pos])) seen++;
    pos++;
  }
  // Only text inputs expose a selection range; a number input
  // would throw here, which is why these fields are type="text"
  // with inputmode="numeric".
  try {
    el.setSelectionRange(pos, pos);
  } catch (err) {
    /* not a selectable field — the value is still correct */
  }
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

// Local-time yyyy-mm-dd for <input type="date">.
function invToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function invSafeFileName(s) {
  return String(s || "")
    .trim()
    .replace(/[^a-zA-Z0-9\-_ ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

function invEl(id) {
  return document.getElementById(id);
}

function invVal(id) {
  const el = invEl(id);
  return el ? el.value : "";
}

// ── Items ───────────────────────────────────────────────────

function invBlankItem() {
  return {
    id: invNextItemId++,
    name: "",
    qty: "",
    price: "",
    unit: "Pax",
    amount: "", // blank = auto (qty × price)
    amountLocked: false,
  };
}

function invAddItem() {
  invItems.push(invBlankItem());
  invRenderItemInputs();
  invRecalc();
}

function invRemoveItem(id) {
  invItems = invItems.filter((it) => it.id !== id);
  // Never leave the form with zero rows — an empty items card
  // looks broken and there is no obvious way back except the
  // small "+ Add item" link.
  if (invItems.length === 0) invItems.push(invBlankItem());
  invRenderItemInputs();
  invRecalc();
}

function invOnItemInput(id, field, value) {
  const item = invItems.find((it) => it.id === id);
  if (!item) return;
  item[field] = value;
  if (field === "amount") item.amountLocked = value.trim() !== "";
  invRecalc();
}

// Qty × unit price, unless the person typed their own amount.
function invItemAmount(item) {
  if (item.amountLocked) return invParseNum(item.amount);
  const qty = invParseNum(item.qty);
  const price = invParseNum(item.price);
  if (qty === null || price === null) return null;
  return qty * price;
}

function invRenderItemInputs() {
  const wrap = invEl("inv-items");
  if (!wrap) return;
  wrap.innerHTML = invItems
    .map(
      (it) => `
    <div class="inv-item-row">
      <input class="form-input" placeholder="Item name"
             value="${invEscape(it.name)}"
             oninput="invOnItemInput(${it.id},'name',this.value)" />
      <input class="form-input" placeholder="Qty" inputmode="numeric"
             value="${invEscape(it.qty)}"
             oninput="invOnItemInput(${it.id},'qty',this.value)" />
      <input class="form-input" placeholder="Unit price" inputmode="numeric"
             value="${invEscape(it.price)}"
             oninput="invFormatMoneyField(this); invOnItemInput(${it.id},'price',this.value)" />
      <button class="inv-del" title="Remove" onclick="invRemoveItem(${it.id})">&times;</button>
      <input class="form-input" placeholder="per (Pax, pcs, …)"
             style="grid-column:1" value="${invEscape(it.unit)}"
             oninput="invOnItemInput(${it.id},'unit',this.value)" />
      <input class="form-input" placeholder="Amount (auto)" inputmode="numeric"
             style="grid-column:2 / span 2"
             value="${invEscape(it.amount)}"
             oninput="invFormatMoneyField(this); invOnItemInput(${it.id},'amount',this.value)" />
    </div>`,
    )
    .join("");
}

function invEscape(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Calculation ─────────────────────────────────────────────
//
// Tax base = Sub Total + Service Charge.
// On the sample invoice Service Charge was blank and Tax 10%
// came to exactly 10% of Sub Total, so both readings fit that
// document. Adding service to the base is the standard
// Indonesian restaurant rule (service is taxable). The note
// under the Tax field spells out which base was used, and the
// figure stays editable if a particular deal was quoted
// differently.
function invRecalc() {
  const itemsTotal = invItems.reduce((sum, it) => {
    const a = invItemAmount(it);
    return a === null ? sum : sum + a;
  }, 0);

  // A computed zero is shown as blank, not "0": on an empty or
  // half-filled form a row reading "Rp 0" looks like a real
  // quoted figure. A deliberate zero can still be typed in.
  // Everything written back into a field is grouped ("2.640.000")
  // so the form reads the same way the printed invoice does.
  const orBlank = (n) => (n ? invGroup(n) : "");

  if (!invLocked.subtotal) invEl("inv-subtotal").value = orBlank(itemsTotal);
  const subtotal = invParseNum(invVal("inv-subtotal")) || 0;

  // Service charge and tax each have their own switch: a buffet or
  // a plain takeaway order often carries neither, and an invoice
  // showing "Tax 10%  Rp 0" reads as a mistake. Switched off, the
  // line does not print at all AND drops out of every calculation
  // below — a hidden charge must never still be inside the total.
  const svcOn = invEl("inv-svc-on").checked;
  invEl("inv-svc-fields").style.display = svcOn ? "" : "none";
  const svcPct = invParsePct(invVal("inv-svc-pct"));
  if (svcOn && !invLocked.svc) {
    invEl("inv-svc").value =
      svcPct === null ? "" : orBlank(Math.round((subtotal * svcPct) / 100));
  }
  // null means "printed as a label with no figure", the way the
  // original invoice did it. Off is a different thing entirely.
  const svc = svcOn ? invParseNum(invVal("inv-svc")) : null;

  const taxOn = invEl("inv-tax-on").checked;
  invEl("inv-tax-fields").style.display = taxOn ? "" : "none";
  const taxBase = subtotal + (svc || 0);
  const taxPct = invParsePct(invVal("inv-tax-pct"));
  if (taxOn && !invLocked.tax) {
    invEl("inv-tax").value =
      taxPct === null ? "" : orBlank(Math.round((taxBase * taxPct) / 100));
  }
  const tax = taxOn ? invParseNum(invVal("inv-tax")) : null;

  const note = invEl("inv-tax-base-note");
  if (note) {
    note.style.display = taxOn ? "" : "none";
    note.textContent = svcOn
      ? `Tax is calculated on Sub Total + Service Charge (${invRupiah(taxBase)}).`
      : `Tax is calculated on Sub Total (${invRupiah(subtotal)}).`;
  }

  if (!invLocked.total)
    invEl("inv-total").value = orBlank(subtotal + (svc || 0) + (tax || 0));
  const total = invParseNum(invVal("inv-total")) || 0;

  const dpOn = invEl("inv-dp-on").checked;
  invEl("inv-dp-fields").style.display = dpOn ? "" : "none";
  const dpPct = invParsePct(invVal("inv-dp-pct"));
  if (dpOn && !invLocked.dp) {
    invEl("inv-dp").value =
      dpPct === null ? "" : orBlank(Math.round((total * dpPct) / 100));
  }
  const dp = dpOn ? invParseNum(invVal("inv-dp")) : null;

  // Settlement is what is left after the deposit. It only makes
  // sense alongside a down payment, so it rides with that switch.
  const settleOn = dpOn && invEl("inv-settle-on").checked;
  invEl("inv-settle-fields").style.display = settleOn ? "" : "none";
  if (settleOn && !invLocked.settle) {
    invEl("inv-settle").value = orBlank(total - (dp || 0));
  }

  invRenderPreview();
}

// ── Preview ─────────────────────────────────────────────────

// The printed sheet always shows 8 row slots, filled or not —
// that is how the original design looks and an invoice with
// two items should not have a collapsed, half-empty table.
// More than 8 items simply grows the table; anything past 11
// would run into the totals block, so we warn instead of
// silently producing an overlapping page.
const INV_MIN_ROWS = 8;
const INV_MAX_ROWS = 11;
const INV_MAX_NAME_CHARS = 44;

function invRenderPreview() {
  const left = [
    ["Name", invVal("inv-name")],
    ["Table", invVal("inv-table")],
    ["Pax", invVal("inv-pax")],
  ];
  const right = [
    ["Receipt no", invVal("inv-receipt")],
    ["Payment Date", invDateId(invVal("inv-paydate"))],
    ["Event Date", invDateId(invVal("inv-eventdate"))],
  ];
  const metaHtml = (rows) =>
    rows
      .filter(([, v]) => String(v).trim() !== "")
      .map(
        ([k, v]) =>
          `<div class="inv-meta-row"><span class="inv-meta-k">${invEscape(k)}</span><span>: ${invEscape(v)}</span></div>`,
      )
      .join("");
  invEl("inv-p-meta-left").innerHTML = metaHtml(left);
  invEl("inv-p-meta-right").innerHTML = metaHtml(right);

  const filled = invItems.filter(
    (it) => String(it.name).trim() !== "" || invItemAmount(it) !== null,
  );
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
  invEl("inv-p-rows").innerHTML = rowsHtml;

  // The Items column is 44% of a 702px content area at 12.5px, so
  // roughly 44 characters fit. Anything longer is silently cut off
  // by the cell — say so while it is being typed rather than
  // letting someone discover it in a PDF already sent to a guest.
  const tooLong = filled.filter((it) => String(it.name).length > INV_MAX_NAME_CHARS);
  const warn = invEl("inv-name-warning");
  if (warn) {
    warn.classList.toggle("hidden", tooLong.length === 0);
    if (tooLong.length) {
      warn.textContent =
        tooLong.length === 1
          ? `"${tooLong[0].name}" is too long for the Items column and will be cut off. Shorten it to ${INV_MAX_NAME_CHARS} characters.`
          : `${tooLong.length} item names are too long for the Items column and will be cut off. Keep each under ${INV_MAX_NAME_CHARS} characters.`;
    }
  }

  invEl("inv-p-note").textContent = invVal("inv-note");

  const subtotal = invParseNum(invVal("inv-subtotal"));
  const svcOn = invEl("inv-svc-on").checked;
  const svc = invParseNum(invVal("inv-svc"));
  const taxOn = invEl("inv-tax-on").checked;
  const tax = invParseNum(invVal("inv-tax"));
  const taxPct = invParsePct(invVal("inv-tax-pct"));
  const total = invParseNum(invVal("inv-total"));
  const dpOn = invEl("inv-dp-on").checked;
  const dp = invParseNum(invVal("inv-dp"));
  const dpPct = invParsePct(invVal("inv-dp-pct"));
  const settleOn = dpOn && invEl("inv-settle-on").checked;
  const settle = invParseNum(invVal("inv-settle"));

  // A switched-on line with a blank amount still prints its label —
  // that is how the sample invoice showed Service Charge. Switched
  // off, the line is gone completely.
  let totalsHtml = `<div class="inv-trow"><span>Sub Total</span><span>${invRupiah(subtotal)}</span></div>`;
  if (svcOn) {
    totalsHtml += `<div class="inv-trow"><span>Service Charge</span><span>${invRupiah(svc)}</span></div>`;
  }
  if (taxOn) {
    totalsHtml += `<div class="inv-trow"><span>Tax${taxPct ? " " + invPctLabel(taxPct) + "%" : ""}</span><span>${invRupiah(tax)}</span></div>`;
  }
  totalsHtml += `<div class="inv-tbar"><span>Total</span><span>${invRupiah(total)}</span></div>`;
  if (dpOn) {
    // With a settlement line present the deposit has already been
    // received, so it is shown as a settled amount: pale bar, and
    // "Paid" in the label. Without one, the invoice IS the request
    // for the deposit, so it stays solid like the Total.
    const dpPaidStyle = settleOn ? " inv-tbar-paid" : "";
    const dpLabel = settleOn ? "Down Payment Paid" : "Down Payment";
    totalsHtml += `<div class="inv-tbar${dpPaidStyle}"><span>${dpLabel}${dpPct === null ? "" : " " + invPctLabel(dpPct) + "%"}</span><span>${invRupiah(dp)}</span></div>`;
  }
  if (settleOn) {
    totalsHtml += `<div class="inv-tbar"><span>Settlement</span><span>${invRupiah(settle)}</span></div>`;
  }
  invEl("inv-p-totals").innerHTML = totalsHtml;

  invFitPreview();
}

// 50 not 50.0, but 12.5 stays 12.5.
function invPctLabel(n) {
  return Number(n) % 1 === 0 ? String(Number(n)) : String(n).replace(".", ",");
}

// The sheet is a fixed 794px wide. Scale it down (never up) so
// it fits the column on smaller screens. The scale is undone
// during PDF capture so the export is always full resolution.
function invFitPreview() {
  const scaler = invEl("inv-scaler");
  if (!scaler || !scaler.parentElement) return;
  const available = scaler.parentElement.clientWidth;
  if (!available) return;
  const scale = Math.min(1, available / 794);
  scaler.style.transform = `scale(${scale})`;
  // A scaled element still reserves its unscaled height, which
  // would leave ~300px of dead space under the sheet.
  scaler.style.height = 1123 * scale + "px";
}

window.addEventListener("resize", () => {
  if (typeof currentPage !== "undefined" && currentPage === "invoice")
    invFitPreview();
});

// ── PDF ─────────────────────────────────────────────────────

async function invDownloadPdf() {
  if (!invVal("inv-name").trim()) {
    toast("Fill in the guest name first.", "error");
    return;
  }
  if (invItems.filter((it) => String(it.name).trim() !== "").length === 0) {
    toast("Add at least one item.", "error");
    return;
  }
  const filled = invItems.filter(
    (it) => String(it.name).trim() !== "" || invItemAmount(it) !== null,
  );
  if (filled.length > INV_MAX_ROWS) {
    toast(
      `Too many items for one page (${filled.length}). Keep it to ${INV_MAX_ROWS} or combine lines.`,
      "error",
    );
    return;
  }
  if (typeof html2canvas === "undefined" || !window.jspdf) {
    toast("PDF library did not load. Check the internet connection.", "error");
    return;
  }

  const btn = invEl("inv-download-btn");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";

  const scaler = invEl("inv-scaler");
  const sheet = invEl("inv-sheet");
  const priorTransform = scaler.style.transform;
  const priorHeight = scaler.style.height;

  try {
    // html2canvas reads layout, not the CSS transform, so the
    // scale must come off before capture or the output is soft.
    scaler.style.transform = "none";
    scaler.style.height = "";
    // Baseline compensation — see .inv-exporting in index.html.
    sheet.classList.add("inv-exporting");

    const canvas = await html2canvas(invEl("inv-sheet"), {
      scale: 2, // ~192dpi: sharp when printed, still a sane file size
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: 794,
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
    const who = invSafeFileName(invVal("inv-name")) || "Guest";
    const receipt = invSafeFileName(invVal("inv-receipt"));
    pdf.save(`Invoice-${receipt ? receipt + "-" : ""}${who}.pdf`);

    invSaveToHistory();
    toast("Invoice downloaded.");
  } catch (err) {
    console.error("[invoice] PDF export failed", err);
    toast("Could not build the PDF. Try again.", "error");
  } finally {
    // Must run even if the capture threw, or the preview would be
    // left stuck at full scale with the export nudge applied.
    sheet.classList.remove("inv-exporting");
    scaler.style.transform = priorTransform;
    scaler.style.height = priorHeight;
    invFitPreview();
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ── Local history (last 5, this browser only) ───────────────

function invSnapshot() {
  return {
    savedAt: new Date().toISOString(),
    name: invVal("inv-name"),
    table: invVal("inv-table"),
    pax: invVal("inv-pax"),
    receipt: invVal("inv-receipt"),
    paydate: invVal("inv-paydate"),
    eventdate: invVal("inv-eventdate"),
    items: invItems.map((it) => ({
      name: it.name,
      qty: it.qty,
      price: it.price,
      unit: it.unit,
      amount: it.amount,
      amountLocked: it.amountLocked,
    })),
    subtotal: invVal("inv-subtotal"),
    svcOn: invEl("inv-svc-on").checked,
    svcPct: invVal("inv-svc-pct"),
    svc: invVal("inv-svc"),
    taxOn: invEl("inv-tax-on").checked,
    taxPct: invVal("inv-tax-pct"),
    tax: invVal("inv-tax"),
    total: invVal("inv-total"),
    dpOn: invEl("inv-dp-on").checked,
    dpPct: invVal("inv-dp-pct"),
    dp: invVal("inv-dp"),
    settleOn: invEl("inv-settle-on").checked,
    settle: invVal("inv-settle"),
    note: invVal("inv-note"),
    locked: { ...invLocked },
  };
}

function invReadHistory() {
  try {
    const raw = localStorage.getItem(INV_HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    // Corrupt or foreign data in the key must never take the
    // page down — the generator itself does not need history.
    console.warn("[invoice] history unreadable, ignoring", err);
    return [];
  }
}

function invSaveToHistory() {
  const list = invReadHistory();
  list.unshift(invSnapshot());
  try {
    localStorage.setItem(
      INV_HISTORY_KEY,
      JSON.stringify(list.slice(0, INV_HISTORY_MAX)),
    );
  } catch (err) {
    console.warn("[invoice] could not save history", err);
  }
  invRenderHistory();
}

function invRenderHistory() {
  const wrap = invEl("inv-history");
  if (!wrap) return;
  const list = invReadHistory();
  if (list.length === 0) {
    wrap.innerHTML = `<p class="text-[12px] text-[#999]">Nothing yet. The last ${INV_HISTORY_MAX} invoices you download appear here so you can re-open one.</p>`;
    return;
  }
  wrap.innerHTML = list
    .map((h, i) => {
      const when = new Date(h.savedAt);
      const stamp = isNaN(when)
        ? ""
        : when.toLocaleString("id-ID", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
      return `
      <button onclick="invLoadFromHistory(${i})"
        class="w-full text-left border border-[#EDE9E3] rounded-xl px-3 py-2 mb-2 hover:border-[#5596CE] hover:bg-[#F8FBFE] transition-colors">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[13px] font-medium text-[#28547C] truncate">${invEscape(h.name || "(no name)")}</span>
          <span class="text-[11px] text-[#999] flex-none">${invEscape(stamp)}</span>
        </div>
        <div class="text-[11px] text-[#999]">
          ${h.receipt ? "No. " + invEscape(h.receipt) + " · " : ""}${invEscape(invRupiah(invParseNum(h.total)) || "—")}
        </div>
      </button>`;
    })
    .join("");
}

function invLoadFromHistory(index) {
  const h = invReadHistory()[index];
  if (!h) return;
  invApplySnapshot(h);
  toast("Loaded. Edit anything, then download again.");
}

function invApplySnapshot(h) {
  invEl("inv-name").value = h.name || "";
  invEl("inv-table").value = h.table || "";
  invEl("inv-pax").value = h.pax || "";
  invEl("inv-receipt").value = h.receipt || "";
  invEl("inv-paydate").value = h.paydate || "";
  invEl("inv-eventdate").value = h.eventdate || "";
  invEl("inv-subtotal").value = h.subtotal || "";
  // Invoices saved before the toggles existed have no svcOn/taxOn
  // key. They were generated with both lines showing, so absent
  // means true — otherwise re-opening an old invoice would quietly
  // drop its tax line and change the amount owed.
  invEl("inv-svc-on").checked = h.svcOn !== false;
  invEl("inv-svc-pct").value = h.svcPct || "";
  invEl("inv-svc").value = h.svc || "";
  invEl("inv-tax-on").checked = h.taxOn !== false;
  invEl("inv-tax-pct").value = h.taxPct || "";
  invEl("inv-tax").value = h.tax || "";
  invEl("inv-total").value = h.total || "";
  invEl("inv-dp-on").checked = h.dpOn !== false;
  invEl("inv-dp-pct").value = h.dpPct || "";
  invEl("inv-dp").value = h.dp || "";
  // Settlement is opt-in, so absent means false here.
  invEl("inv-settle-on").checked = h.settleOn === true;
  invEl("inv-settle").value = h.settle || "";
  invEl("inv-note").value = h.note || "";
  // Reopening an invoice must never silently change what it says.
  // Normally the lock flags travel with the snapshot; if they are
  // missing (an entry saved by an older version, or hand-edited
  // storage) every figure that has a value is treated as fixed,
  // rather than letting the recalculation quietly rewrite amounts
  // a guest has already been shown.
  const fields = {
    subtotal: "inv-subtotal",
    svc: "inv-svc",
    tax: "inv-tax",
    total: "inv-total",
    dp: "inv-dp",
    settle: "inv-settle",
  };
  Object.keys(invLocked).forEach((k) => {
    invLocked[k] = h.locked
      ? !!h.locked[k]
      : String(invVal(fields[k]) || "").trim() !== "";
  });
  invItems = (h.items || []).map((it) => ({ ...it, id: invNextItemId++ }));
  if (invItems.length === 0) invItems.push(invBlankItem());
  invRenderItemInputs();
  invRecalc();
}

// ── Reset / boot ────────────────────────────────────────────

function invReset() {
  // A browser confirm() is not part of the DOM, so the i18n observer
  // cannot reach it — this one string has to be translated at the
  // source with t().
  if (!confirm(t("Clear the form and start a new invoice?"))) return;
  ["inv-name", "inv-table", "inv-pax", "inv-receipt", "inv-subtotal",
   "inv-svc", "inv-tax", "inv-total", "inv-dp", "inv-settle"].forEach((id) => {
    invEl(id).value = "";
  });
  invEl("inv-svc-pct").value = "";
  invEl("inv-tax-pct").value = "10";
  invEl("inv-dp-pct").value = "50";
  invEl("inv-svc-on").checked = true;
  invEl("inv-tax-on").checked = true;
  invEl("inv-dp-on").checked = true;
  invEl("inv-settle-on").checked = false;
  invEl("inv-note").value =
    "Pembayaran downpayment dapat dilakukan melalui QRIS " + restaurantName();
  invEl("inv-paydate").value = invToday();
  invEl("inv-eventdate").value = "";
  Object.keys(invLocked).forEach((k) => (invLocked[k] = false));
  invItems = [invBlankItem(), invBlankItem()];
  invRenderItemInputs();
  invRecalc();
}

// A hand-typed receipt number can collide with one already
// used. With no database we can only check what this browser
// has seen, so the warning is advisory, not a block.
function invCheckReceipt() {
  const val = invVal("inv-receipt").trim();
  if (!val) return;
  const clash = invReadHistory().some(
    (h) => String(h.receipt || "").trim() === val,
  );
  if (clash) toast(`Receipt no ${val} was already used recently.`, "error");
}

let invBooted = false;

function initInvoice() {
  if (invBooted) {
    invFitPreview();
    return;
  }
  invBooted = true;

  invEl("inv-paydate").value = invToday();
  invItems = [invBlankItem(), invBlankItem()];
  invRenderItemInputs();

  // Any plain field just re-renders; the computed ones also
  // flip their lock so a manual figure survives.
  ["inv-name", "inv-table", "inv-pax", "inv-receipt", "inv-note"].forEach((id) =>
    invEl(id).addEventListener("input", invRecalc),
  );
  ["inv-paydate", "inv-eventdate"].forEach((id) =>
    invEl(id).addEventListener("change", invRecalc),
  );
  invEl("inv-receipt").addEventListener("blur", invCheckReceipt);

  const computed = {
    "inv-subtotal": "subtotal",
    "inv-svc": "svc",
    "inv-tax": "tax",
    "inv-total": "total",
    "inv-dp": "dp",
    "inv-settle": "settle",
  };
  Object.entries(computed).forEach(([id, key]) => {
    invEl(id).addEventListener("input", () => {
      invFormatMoneyField(invEl(id));
      invLocked[key] = invVal(id).trim() !== "";
      invRecalc();
    });
  });

  // Changing a percentage means the person wants that figure
  // recomputed — releasing the lock here saves them pressing
  // "auto" every single time.
  invEl("inv-svc-pct").addEventListener("input", () => {
    invLocked.svc = false;
    invLocked.total = false;
    invLocked.dp = false;
    invLocked.settle = false;
    invRecalc();
  });
  invEl("inv-tax-pct").addEventListener("input", () => {
    invLocked.tax = false;
    invLocked.total = false;
    invLocked.dp = false;
    invLocked.settle = false;
    invRecalc();
  });
  invEl("inv-dp-pct").addEventListener("input", () => {
    invLocked.dp = false;
    invLocked.settle = false;
    invRecalc();
  });

  // Switching a charge off removes it from the total, so anything
  // downstream that was pinned by hand has to be recomputed —
  // otherwise the invoice would still be carrying a charge that no
  // longer appears anywhere on it.
  ["inv-svc-on", "inv-tax-on"].forEach((id) =>
    invEl(id).addEventListener("change", () => {
      invLocked.total = false;
      invLocked.dp = false;
      invLocked.settle = false;
      invRecalc();
    }),
  );
  invEl("inv-dp-on").addEventListener("change", () => {
    invLocked.settle = false;
    invRecalc();
  });
  invEl("inv-settle-on").addEventListener("change", () => {
    invLocked.settle = false;
    invRecalc();
  });

  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.reset;
      invLocked[key] = false;
      // Downstream figures depend on this one, so they go back
      // to auto too — otherwise pressing "auto" on Sub Total
      // leaves a stale Total sitting underneath it.
      if (key === "subtotal") {
        invLocked.svc = false;
        invLocked.tax = false;
        invLocked.total = false;
        invLocked.dp = false;
        invLocked.settle = false;
      }
      if (key === "svc" || key === "tax") {
        invLocked.total = false;
        invLocked.dp = false;
        invLocked.settle = false;
      }
      if (key === "total" || key === "dp") invLocked.settle = false;
      if (key === "total") invLocked.dp = false;
      invRecalc();
    });
  });

  invRenderHistory();
  invRecalc();
}
