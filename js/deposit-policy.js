// Shared classification for the public form and staff defaults. Amounts are
// quoted by staff in pax mode; this is never an amount multiplied by guests.
function depositPolicy(form = {}, hours = {}) {
  const integer = (value, fallback, min) => Number.isInteger(Number(value)) && value != null && value !== "" && Number(value) >= min ? Number(value) : fallback;
  const basis = form.deposit_basis === "pax" ? "pax" : "area";
  const max = integer(basis === "pax" ? form.deposit_regular_max_pax : hours.max_pax, 20, 1);
  return {basis, max, free:Math.min(integer(form.deposit_free_pax, 1, 0), max)};
}
function depositBookingRule(pax, area, form = {}, hours = {}) {
  const policy = depositPolicy(form, hours);
  const large = Number(pax) > policy.max;
  const amount = policy.basis === "area" && !large ? Number(area?.deposit_amount || 0) : null;
  return {...policy, large, amount, required:policy.basis === "pax" ? Number(pax) > policy.free : large || amount > 0};
}
function usesDetailedDeposit(res, legacyLarge) {
  return res?.deposit_invoice_format === "detailed" || (res?.deposit_invoice_format == null && legacyLarge);
}

function depositFormatSelect() {
  const id = CURRENT_LANG === "id";
  return `<label class="block text-sm mt-3">${id ? "Format invoice" : "Invoice format"}<select id="lp-deposit-format" class="form-input mt-1"><option value="">${id ? "Pilih format" : "Choose a format"}</option><option value="simple">${id ? "Deposit sederhana" : "Simple deposit"}</option><option value="detailed">${id ? "Invoice rinci: deposit dan pelunasan" : "Detailed invoice: deposit and settlement"}</option></select></label>`;
}

async function chooseDepositFormat(format) {
  const res = depositActionRes;
  if (!res || !["simple","detailed"].includes(format)) return;
  loader(true);
  try {
    const {data,error} = await db.rpc("set_reservation_deposit_request", {p_reservation_id:res.id,p_amount:Number(res.deposit_expected),p_format:format});
    if (error || !data?.ok) { toast(error?.message || "Could not save invoice format", "error"); return; }
    hideModal("modal-deposit-format");
    await openDepositInvoice(res.id);
  } finally { loader(false); }
}
