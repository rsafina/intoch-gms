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



// Local-time yyyy-mm-dd for <input type="date">.
function invToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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


// The live preview. Everything the SHEET shows is drawn by invSheetRender from
// a snapshot, exactly as the guest page draws it, so the two cannot diverge.
// What stays here is the part that belongs to the form and not to the document:
// the too-long-name warning, and fitting the preview to the column.
function invRenderPreview() {
  const snap = invSnapshot();
  invSheetRender(snap);

  // Said while it is being typed, rather than discovered in a PDF already sent
  // to a guest.
  const tooLong = invSheetTooLongNames(snap);
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

  invFitPreview();
}

function invFitPreview() {
  invSheetFit(invEl("inv-scaler"));
}

window.addEventListener("resize", () => {
  if (typeof currentPage !== "undefined" && currentPage === "invoice")
    invFitPreview();
});

// ── PDF ─────────────────────────────────────────────────────

// The staff download. The document itself and the capture live in
// js/invoice-sheet.js so the guest gets the identical file; what stays here is
// what belongs to the staff form: the checks worth making BEFORE spending three
// seconds on a render, the button state, and the local history entry.
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
  // Refused rather than truncated. Past 11 rows the table runs into the totals
  // block, and the guest receives a page with figures printed over each other.
  if (filled.length > INV_MAX_ROWS) {
    toast(
      `Too many items for one page (${filled.length}). Keep it to ${INV_MAX_ROWS} or combine lines.`,
      "error",
    );
    return;
  }

  const btn = invEl("inv-download-btn");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const built = await invSheetPdf(invSnapshot(), { say: toast });
    // History only when a file actually reached the guest's disk. Recording a
    // failed export would put an invoice in the recent list that nobody has.
    if (built) {
      invSaveToHistory();
      toast("Invoice downloaded.");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}


// ── Save and send ───────────────────────────────────────────
// Until 2026-09-06 this page produced a picture and nothing else. The last five
// invoices lived in ONE staff member's browser, so a colleague could not see
// them, a cleared cache lost them, and none was attached to a booking.
//
// Saving writes the whole document to invoices.doc, gets a number from the
// database, and returns a token. Sending is that same save followed by
// WhatsApp, deliberately in that order: staff can never send a link to an
// invoice that was not stored.

// The row this page is currently editing, so a second click updates rather than
// creating a twin. Cleared by invReset() and by loading a different invoice.
let invSavedId = null;
let invSavedToken = null;
let invSavedNo = null;

// The public link, resolved against whatever address the staff app is served
// from. Deliberately NOT a configured base URL: a wrong one produces a link
// that 404s in a guest's phone and nowhere anybody here would see it.
function invPublicLink(token) {
  return new URL(
    "invoice-view.html?t=" + encodeURIComponent(token),
    window.location.href,
  ).href;
}

function invShowSavedLine() {
  const line = invEl("inv-saved-line");
  const no = invEl("inv-saved-no");
  if (!line || !no) return;
  if (!invSavedToken) {
    line.classList.add("hidden");
    return;
  }
  no.textContent = t("Saved as") + " " + (invSavedNo || "-");
  line.classList.remove("hidden");
}

function invCopyLink() {
  if (!invSavedToken) return;
  const url = invPublicLink(invSavedToken);
  // The clipboard API needs a secure context and can be refused outright, and a
  // silent failure here means staff paste the previous thing on their
  // clipboard into a guest's chat. Falling back to a prompt always works.
  const fallback = () => window.prompt(t("Copy this link"), url);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(
      () => toast(t("Link copied")),
      fallback,
    );
  } else {
    fallback();
  }
}

// The figures a screen needs to query without opening the document. Read from
// the SAME snapshot that is stored, in one place, so the columns and the
// document can never state different numbers.
function invSummaryFrom(snap) {
  const total = invParseNum(snap.total) || 0;
  const dp = snap.dpOn ? invParseNum(snap.dp) : null;
  const settleOn = !!snap.dpOn && !!snap.settleOn;
  return {
    subtotal: invParseNum(snap.subtotal),
    total,
    // Only when a settlement line is present is the deposit money already in.
    // Without one the invoice IS the deposit request, so nothing is applied yet
    // and the whole total is still due.
    deposit_applied: settleOn ? dp : null,
    amount_due: settleOn ? invParseNum(snap.settle) : total,
  };
}

async function invSaveInvoice(send) {
  if (!invVal("inv-name").trim()) {
    toast(t("Fill in the guest name first."), "error");
    return;
  }
  if (invItems.filter((it) => String(it.name).trim() !== "").length === 0) {
    toast(t("Add at least one item."), "error");
    return;
  }
  const snap = invSnapshot();
  // Refused here for the same reason the PDF refuses it: past 11 rows the table
  // runs into the totals block and the guest opens a page with figures printed
  // over each other. Better to refuse the save than to store that.
  if (invSheetFilledItems(snap).length > INV_MAX_ROWS) {
    toast(
      t("Too many items for one page. Keep it to") + " " + INV_MAX_ROWS + ".",
      "error",
    );
    return;
  }
  const phone = invVal("inv-wa").trim();
  if (send && !waPhone(phone)) {
    toast(t("Add a WhatsApp number to send this, or use Copy guest link."), "error");
    return;
  }

  const btn = invEl(send ? "inv-send-btn" : "inv-save-btn");
  const label = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("Saving…");
  }
  try {
    const sums = invSummaryFrom(snap);
    const payload = {
      kind: "general",
      bill_to_name: snap.name || null,
      pax: invParseNum(snap.pax),
      event_date: snap.eventdate || null,
      note: snap.note || null,
      doc: snap,
      subtotal: sums.subtotal,
      total: sums.total,
      deposit_applied: sums.deposit_applied,
      amount_due: sums.amount_due,
      status: "issued",
    };

    let row = null;
    if (invSavedId) {
      // An edit of the invoice already on screen. The NUMBER and the token are
      // kept: a guest who already has the link must still reach the document,
      // and renumbering would break the restaurant's own books.
      const { data, error } = await supabaseQuery(
        () => db.from("invoices").update(payload).eq("id", invSavedId).select("id, token, invoice_no"),
        "Failed to update the invoice",
      );
      // PostgREST answers 204 for an update that matched nothing, which is
      // byte-identical to success. An empty result is a failure, always.
      if (error || !data || !data.length) {
        toast(t("Nothing was saved. The invoice may have been deleted."), "error");
        return;
      }
      row = data[0];
    } else {
      const { data: noData, error: noErr } = await supabaseQuery(
        () => db.rpc("next_invoice_no"),
        "Failed to allocate an invoice number",
      );
      if (noErr || !noData) {
        toast(t("Could not allocate an invoice number."), "error");
        return;
      }
      payload.invoice_no = noData;
      payload.issued_by = currentStaffId();
      const { data, error } = await supabaseQuery(
        () => db.from("invoices").insert(payload).select("id, token, invoice_no"),
        "Failed to save the invoice",
      );
      if (error || !data || !data.length) {
        toast(t("The invoice was not saved."), "error");
        return;
      }
      row = data[0];
    }

    invSavedId = row.id;
    invSavedToken = row.token;
    invSavedNo = row.invoice_no;
    invShowSavedLine();
    // Kept as well as the row: the local list is what staff use to pick up
    // where they left off, and it works with no connection.
    invSaveToHistory();

    if (!send) {
      toast(t("Invoice saved as") + " " + invSavedNo);
      return;
    }

    await waLoadTemplates();
    const link = invPublicLink(invSavedToken);
    const opened = waOpenChat(
      phone,
      waInvoiceMessage({
        guestName: snap.name,
        invoiceNo: invSavedNo,
        amountText: invRupiah(invParseNum(snap.total)),
        link,
      }),
    );
    // The invoice exists whether or not WhatsApp opened. A popup blocker must
    // not cost staff the work they just did, so say so and leave the link on
    // screen to copy.
    toast(
      opened
        ? t("Invoice saved and WhatsApp opened")
        : t("Invoice saved — copy the link and send it yourself"),
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
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
        class="w-full text-left border border-[#EDE9E3] rounded-xl px-3 py-2 mb-2 hover:border-[color:var(--brand)] hover:bg-[#F8FBFE] transition-colors">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[13px] font-medium text-[color:var(--brand-ink)] truncate">${invEscape(h.name || "(no name)")}</span>
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
  // Whatever row was on screen is no longer what the form holds, so the next
  // Save must create a new invoice rather than overwriting the previous one.
  // Without this, loading yesterday's invoice from the local history and
  // pressing Save would silently rewrite yesterday's saved document, keeping
  // its number, and the guest who has that link would see somebody else's bill.
  invSavedId = null;
  invSavedToken = null;
  invSavedNo = null;
  invShowSavedLine();
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
  // A cleared form is a new invoice. The saved row stays in the database with
  // its number and its link intact; this page just stops editing it.
  invSavedId = null;
  invSavedToken = null;
  invSavedNo = null;
  invShowSavedLine();
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
  // The sheet's markup is built here rather than sitting in index.html, so the
  // guest page can build the identical document from the same function.
  // Before applyInvoiceStyle and applyBranding, both of which reach into
  // nodes that do not exist until this line has run.
  const sheet = invEl("inv-sheet");
  if (sheet && !sheet.firstElementChild) sheet.innerHTML = invSheetMarkup();
  if (typeof applyBranding === "function") applyBranding(sheet || document);

  // Re-applied on every visit, not only the first: a manager can change the
  // design and come straight back here, and a stale sheet would send them
  // hunting for a bug that is not there.
  applyInvoiceStyle();
  if (invBooted) {
    invShowTab(invDefaultTab());
    invFitPreview();
    return;
  }
  invBooted = true;
  invShowTab(invDefaultTab());

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

// ============================================================
// INVOICE APPEARANCE (per-client, set in Settings)
// ============================================================
// Five colours, two logo sizes and the footer address, from
// app_settings.invoice_style.
//
// ── Why this writes a <style> block of LITERAL hex ────────────────────
// The obvious implementation is CSS custom properties, the way the
// reservation page does it. It is NOT used here, and the stylesheet says why
// at the top of the invoice section: html2canvas rasterises #inv-sheet for
// the PDF, and it is not reliable with variables. A colour that resolves
// perfectly on screen and silently falls back to black in the exported PDF is
// the worst possible failure for a document a guest receives.
//
// So every value is baked into a literal hex string before it reaches the
// page. Nothing in the invoice sheet depends on var() resolution at capture
// time, which sidesteps the question entirely.
const INVOICE_STYLE_DEFAULTS = {
  ink: "#173B64",
  accent: "#173B64",
  frame: "#A3C4EB",
  row_fill: "#DCEBFB",
  muted: "#2F5F92",
  logo_width: 172,
  mark_width: 62,
  address: "",
  phone: "",
  instagram: "",
};

const INVOICE_LOGO_MIN = 80;
const INVOICE_LOGO_MAX = 320;
const INVOICE_MARK_MIN = 24;
const INVOICE_MARK_MAX = 140;

let INVOICE_STYLE = null;

function invStyle() {
  const cfg = { ...INVOICE_STYLE_DEFAULTS, ...(INVOICE_STYLE || {}) };
  const hex = (v, fb) =>
    /^#[0-9a-f]{6}$/i.test(String(v || "").trim()) ? String(v).trim() : fb;
  ["ink", "accent", "frame", "row_fill", "muted"].forEach((k) => {
    cfg[k] = hex(cfg[k], INVOICE_STYLE_DEFAULTS[k]);
  });
  const num = (v, fb, lo, hi) => {
    const n = Number(v);
    return isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fb;
  };
  cfg.logo_width = num(cfg.logo_width, 172, INVOICE_LOGO_MIN, INVOICE_LOGO_MAX);
  cfg.mark_width = num(cfg.mark_width, 62, INVOICE_MARK_MIN, INVOICE_MARK_MAX);
  ["address", "phone", "instagram"].forEach((k) => {
    cfg[k] = String(cfg[k] || "").trim();
  });
  return cfg;
}

// Relative luminance, so text on a coloured bar can pick itself.
function invLuminance(hex) {
  const h = String(hex).trim();
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// The table header and the totals bar print text ON the accent colour. That
// text is NOT one of the five settings on purpose: it is not a design choice,
// it is a legibility requirement, and a client who picks a pale accent would
// otherwise produce an invoice with an invisible "Total" line. Dark text on a
// light bar, white on a dark one.
function invBarTextColor(fill, ink) {
  return invLuminance(fill) > 0.6 ? ink : "#FFFFFF";
}

async function invLoadStyle(preloaded) {
  if (preloaded && typeof preloaded === "object") {
    INVOICE_STYLE = preloaded;
    return INVOICE_STYLE;
  }
  try {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "invoice_style")
      .maybeSingle();
    INVOICE_STYLE = (data && data.value) || {};
  } catch (e) {
    // Never block the invoice on styling. A generator that refuses to open
    // because a colour would not load is worse than a default-coloured
    // invoice.
    console.warn("invoice style: load failed, using defaults", e);
    INVOICE_STYLE = {};
  }
  return INVOICE_STYLE;
}

function invStyleCss(cfg) {
  const barText = invBarTextColor(cfg.accent, cfg.ink);
  const paidText = invBarTextColor(cfg.row_fill, cfg.ink);
  return `
    #inv-sheet { color: ${cfg.ink}; }
    #inv-sheet .inv-frame { border-color: ${cfg.frame}; }
    #inv-sheet .inv-logo { width: ${cfg.logo_width}px; }
    #inv-sheet .inv-heron { width: ${cfg.mark_width}px; }
    #inv-sheet .inv-rule-top { background: ${cfg.accent}; }
    #inv-sheet .inv-meta-row { color: ${cfg.ink}; }
    #inv-sheet .inv-thead { background: ${cfg.accent}; color: ${barText}; }
    #inv-sheet .inv-row { background: ${cfg.row_fill}; color: ${cfg.ink}; }
    #inv-sheet .inv-note { color: ${cfg.ink}; }
    #inv-sheet .inv-trow { color: ${cfg.muted}; }
    #inv-sheet .inv-trow span:last-child { color: ${cfg.ink}; }
    #inv-sheet .inv-tbar { background: ${cfg.accent}; color: ${barText}; }
    #inv-sheet .inv-tbar-paid { background: ${cfg.row_fill}; color: ${paidText}; }
    #inv-sheet .inv-welcome { color: ${cfg.muted}; }
    #inv-sheet .inv-rule-a { background: ${cfg.accent}; }
    #inv-sheet .inv-rule-b { background: ${cfg.frame}; }
    #inv-sheet .inv-address { color: ${cfg.muted}; }
  `;
}

// The footer line. Built from the three fields rather than one blob so it can
// never print a half-filled template: a field left empty simply drops out,
// separators and all.
function invFooterText(cfg) {
  const parts = [];
  if (cfg.address) parts.push(cfg.address);
  if (cfg.phone) parts.push(`Reservation: ${cfg.phone}`);
  if (cfg.instagram) {
    const handle = cfg.instagram.startsWith("@") ? cfg.instagram : "@" + cfg.instagram;
    parts.push(`Instagram: ${handle}`);
  }
  return parts.join(". ");
}

function applyInvoiceStyle(override) {
  const cfg = override || invStyle();
  let el = document.getElementById("inv-style-overrides");
  if (!el) {
    el = document.createElement("style");
    el.id = "inv-style-overrides";
    // Appended last so it wins over the base rules without !important, which
    // html2canvas handles more predictably than specificity tricks.
    document.head.appendChild(el);
  }
  el.textContent = invStyleCss(cfg);

  const addr = document.querySelector("#inv-sheet .inv-address");
  if (addr) addr.textContent = invFooterText(cfg);
  return cfg;
}

// ============================================================
// INVOICE DESIGN TAB (manager+)
// ============================================================
// Two panes on one page, same shape as Vouchers: "Build Invoice" is the
// day-to-day work, "Invoice Design" is set up once per restaurant. Panes
// rather than separate pages so every existing inv* id and handler keeps
// working untouched.
const INV_TAB_KEY = "invLastTab";
const INV_COLOR_KEYS = ["ink", "accent", "frame", "row_fill", "muted"];

function invDefaultTab() {
  if (typeof isManagerOrAdmin === "function" && !isManagerOrAdmin()) return "build";
  return localStorage.getItem(INV_TAB_KEY) === "design" ? "design" : "build";
}

function invShowTab(tab) {
  if (tab === "design" && typeof isManagerOrAdmin === "function" && !isManagerOrAdmin()) {
    toast(t("Only a manager can change the invoice design"), "error");
    tab = "build";
  }
  const activeCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-[color:var(--brand-ink)] text-white transition";
  const idleCls =
    "px-4 py-2 rounded-full text-sm font-medium bg-white text-[#555] border border-[#E6E2DC] hover:bg-[#F8F6F2] transition";
  const design = tab === "design";

  // The BUILD pane is never hidden. It holds the invoice sheet itself, and
  // the design controls are worthless without something to look at — you
  // change a colour and watch the real page change under it.
  document.getElementById("inv-pane-design")?.classList.toggle("hidden", !design);
  const buildBtn = document.getElementById("inv-tab-build");
  const designBtn = document.getElementById("inv-tab-design");
  if (buildBtn) buildBtn.className = design ? idleCls : activeCls;
  if (designBtn) designBtn.className = (design ? activeCls : idleCls) + " manager-only-ui";
  if (typeof applyManagerOnlyUI === "function") applyManagerOnlyUI();

  localStorage.setItem(INV_TAB_KEY, design ? "design" : "build");
  if (design) invRenderStyleForm();
  invFitPreview();
}

function invStyleForm() {
  const color = (k) => {
    const v = document.getElementById(`inv-c-${k}`)?.value;
    return /^#[0-9a-f]{6}$/i.test(String(v || "").trim())
      ? v.trim().toUpperCase()
      : INVOICE_STYLE_DEFAULTS[k];
  };
  const num = (id, fb) => {
    const n = Number(document.getElementById(id)?.value);
    return isFinite(n) ? n : fb;
  };
  const text = (id) => String(document.getElementById(id)?.value || "").trim();
  const cfg = {
    logo_width: num("inv-logo-width", INVOICE_STYLE_DEFAULTS.logo_width),
    mark_width: num("inv-mark-width", INVOICE_STYLE_DEFAULTS.mark_width),
    address: text("inv-f-address"),
    phone: text("inv-f-phone"),
    instagram: text("inv-f-instagram"),
  };
  INV_COLOR_KEYS.forEach((k) => (cfg[k] = color(k)));
  return cfg;
}

function invRenderStyleForm() {
  const cfg = invStyle();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  INV_COLOR_KEYS.forEach((k) => {
    set(`inv-c-${k}`, cfg[k]);
    set(`inv-c-${k}-hex`, String(cfg[k]).toUpperCase());
  });
  set("inv-logo-width", cfg.logo_width);
  set("inv-mark-width", cfg.mark_width);
  set("inv-f-address", cfg.address);
  set("inv-f-phone", cfg.phone);
  set("inv-f-instagram", cfg.instagram);
  invPreviewStyle();
}

function invSyncColor(pickerId, textEl) {
  let v = String(textEl.value || "").trim();
  if (v && !v.startsWith("#")) {
    v = "#" + v;
    textEl.value = v;
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    const picker = document.getElementById(pickerId);
    if (picker) picker.value = v;
    invPreviewStyle();
  }
}

// Repaints the REAL sheet from the controls without saving. There is no
// separate mock-up: the thing on screen is the document that gets exported,
// which is the only preview worth having for a page a guest receives.
function invPreviewStyle() {
  const cfg = invStyleForm();

  INV_COLOR_KEYS.forEach((k) => {
    const hex = document.getElementById(`inv-c-${k}-hex`);
    if (hex && document.activeElement !== hex) hex.value = cfg[k];
  });
  const lw = document.getElementById("inv-logo-width-value");
  if (lw) lw.textContent = cfg.logo_width + "px";
  const mw = document.getElementById("inv-mark-width-value");
  if (mw) mw.textContent = cfg.mark_width + "px";

  const foot = document.getElementById("inv-footer-preview");
  if (foot) {
    const line = invFooterText(cfg);
    foot.textContent = line || t("Nothing filled in yet — the footer will be blank.");
    foot.className = line
      ? "text-[11px] text-[#555] leading-snug"
      : "text-[11px] text-[#B23B3B] leading-snug";
  }

  applyInvoiceStyle(cfg);
}

async function invSaveStyle() {
  if (typeof isManagerOrAdmin === "function" && !isManagerOrAdmin()) {
    toast(t("Only a manager can change the invoice design"), "error");
    return;
  }
  const cfg = invStyleForm();
  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db.from("app_settings").upsert({
        key: "invoice_style",
        value: cfg,
        updated_at: new Date().toISOString(),
      }),
    "Failed to save invoice design",
  );
  loader(false);
  if (error) {
    toast(error.message || t("Unable to save settings"), "error");
    return;
  }
  INVOICE_STYLE = cfg;
  applyInvoiceStyle(cfg);
  toast(t("Invoice design saved"));
}

async function invResetStyle() {
  if (!confirm(t("Put the invoice design back to the built-in one? The address is kept."))) return;
  // Address, phone and Instagram are the client's own details, not a design
  // choice. "Back to defaults" on a colour panel must not quietly wipe them.
  const keep = invStyle();
  INVOICE_STYLE = {
    ...INVOICE_STYLE_DEFAULTS,
    address: keep.address,
    phone: keep.phone,
    instagram: keep.instagram,
  };
  invRenderStyleForm();
  await invSaveStyle();
}
