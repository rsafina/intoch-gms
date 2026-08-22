// ============================================================
// STANDALONE VOUCHERS
// ------------------------------------------------------------
// Gift vouchers issued outside the membership programme: a thank
// you to a top spender, a birthday for a friend of the house, a
// service-recovery gesture, or a block converted from a partner's
// leftover budget (tiket.com, July 2026).
//
// Table: standalone_vouchers. NOT member_vouchers — those are
// earned through stickers and every membership statistic counts
// them. Mixing the two would corrupt those numbers silently.
//
// Why this page writes to the database at all, when the Invoice
// page deliberately does not: a voucher is money, and it comes
// back. Without a stored code you cannot tell an original from a
// forwarded screenshot, cannot refuse an expired one, and cannot
// answer "how much of the partner's budget have we burned".
//
// Manager/admin only — see STAFF_ALLOWED_PAGES in config.js.
// Requires migrations/20260801_standalone_vouchers.
// ============================================================

const VCH_LIST_LIMIT = 60;

// Kept in sync with the occasion CHECK constraint in the migration.
// A value here that the database rejects is a broken page, so this
// list is the one place to change if the constraint changes.
const VCH_OCCASIONS = {
  top_spender: "Top spender thank you",
  top_visits: "Most visits thank you",
  birthday: "Birthday",
  partnership: "Partnership / company",
  apology: "Service recovery",
  other: "Other",
};

let vchValueType = "amount";
let vchPickedGuest = null; // { id, name, phone }
let vchGuestResults = [];
let vchRows = [];
let vchBatches = [];
let vchFilter = "open";
let vchLookedUp = null; // the voucher currently shown in the redeem card
let vchSearchTimer = null;
let vchBooted = false;

// ── Small helpers ───────────────────────────────────────────

function vchEl(id) {
  return document.getElementById(id);
}

function vchVal(id) {
  return (vchEl(id)?.value || "").trim();
}

// Rupiah in, rupiah out. Staff type "100.000", "Rp 100000" or
// "100000" depending on habit; only the digits matter.
function vchNum(value) {
  const digits = String(value == null ? "" : value).replace(/[^\d]/g, "");
  return digits === "" ? null : parseInt(digits, 10);
}

function vchPct(value) {
  const cleaned = String(value == null ? "" : value)
    .replace(/[^\d.,]/g, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function vchRupiah(n) {
  if (n === null || n === undefined || n === "") return "—";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function vchEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Local-time yyyy-mm-dd. Never toISOString(): that is UTC and
// would show yesterday before 07:00 Jakarta, the same bug already
// documented in config.js.
function vchYmd(date) {
  const d = date ? new Date(date) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function vchDateId(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(
    typeof CURRENT_LANG !== "undefined" && CURRENT_LANG === "en" ? "en-GB" : "id-ID",
    { day: "numeric", month: "short", year: "numeric" },
  );
}

// A voucher's state is derived, never stored twice: "expired" is a
// function of the clock, so a stored flag would go stale overnight.
function vchStatus(row) {
  if (row.voided) return "void";
  if (row.redeemed) return "redeemed";
  if (row.expires_at && new Date(row.expires_at) < new Date()) return "expired";
  return "open";
}

// "Active" rather than "Open": ID_DICT already maps Open to "Buka"
// (opening hours), and a voucher is active, not open.
const VCH_STATUS_LABEL = {
  open: "Active",
  redeemed: "Redeemed",
  expired: "Expired",
  void: "Void",
};

function vchStatusChip(row) {
  const s = vchStatus(row);
  return `<span class="vch-chip vch-chip-${s}">${VCH_STATUS_LABEL[s]}</span>`;
}

// One line describing what the holder actually gets.
function vchValueText(row) {
  if (row.value_type === "amount") return vchRupiah(row.value_idr);
  if (row.value_type === "percent") {
    const pct = Number(row.value_percent);
    const label = (pct % 1 === 0 ? pct : pct.toFixed(1)) + "%";
    return row.percent_cap_idr
      ? `${label} (max ${vchRupiah(row.percent_cap_idr)})`
      : label;
  }
  return row.value_item || "—";
}

function vchRecipientText(row) {
  return (
    row.recipient_name ||
    row.partner_name ||
    (row.guest_id ? "Guest" : "—")
  );
}

// ── Issue form ──────────────────────────────────────────────

function vchSetValueType(type) {
  vchValueType = type;
  ["amount", "percent", "item"].forEach((t) => {
    vchEl(`vch-v-${t}`).classList.toggle("hidden", t !== type);
  });
  document.querySelectorAll(".vch-vtab").forEach((b) => {
    b.classList.toggle("vch-vtab-on", b.dataset.vtype === type);
  });
  const note = vchEl("vch-value-note");
  if (note) {
    note.textContent =
      type === "amount"
        ? "A fixed rupiah discount. This is the only type where budget reporting is exact."
        : type === "percent"
          ? "A percentage of the bill. Set a maximum so an unusually large table cannot cost more than intended."
          : "A free item. The cost figure is what it costs the restaurant, and is what the batch report totals.";
  }
}

function vchOnOccasionChange() {
  const isPartner = vchVal("vch-occasion") === "partnership";
  vchEl("vch-partner-wrap").classList.toggle("hidden", !isPartner);
  vchOnQtyChange();
}

function vchOnQtyChange() {
  const qty = vchNum(vchVal("vch-qty")) || 1;
  const note = vchEl("vch-batch-note");
  if (!note) return;
  note.textContent =
    qty > 1
      ? `${qty} vouchers, each with its own code. Leave the recipient empty for bearer vouchers a partner hands out.`
      : "One voucher. A batch label is optional.";
  vchEl("vch-issue-btn").textContent =
    qty > 1 ? `Issue ${qty} vouchers` : "Issue voucher";
}

// Guest lookup. Debounced because it fires on every keystroke.
function vchSearchGuests(term) {
  clearTimeout(vchSearchTimer);
  const wrap = vchEl("vch-guest-results");
  const s = (term || "").trim();
  if (s.length < 2) {
    wrap.innerHTML = "";
    return;
  }
  vchSearchTimer = setTimeout(async () => {
    const { data } = await supabaseQuery(
      () =>
        db
          .from("guests")
          .select("id, name, phone")
          .or(`name.ilike.%${s}%,phone.ilike.%${s}%`)
          .limit(6),
      "Guest search failed",
    );
    // Results are held in a variable and referenced by index rather
    // than interpolated into the onclick. Guest names contain quotes
    // and apostrophes ("Bu Yani's"), which would break the handler
    // or, worse, execute.
    vchGuestResults = data || [];
    wrap.innerHTML = vchGuestResults
      .map(
        (g, i) => `
      <button onclick="vchPickGuest(${i})"
        class="w-full text-left px-3 py-2 text-[13px] border border-[#EDE9E3] rounded-xl mb-1 hover:border-[#5596CE] hover:bg-[#F8FBFE]">
        <span class="text-[#28547C] font-medium">${vchEscape(g.name)}</span>
        <span class="text-[#999] text-[11px] ml-2">${vchEscape(g.phone || "")}</span>
      </button>`,
      )
      .join("");
  }, 250);
}

function vchPickGuest(index) {
  const g = vchGuestResults[index];
  if (!g) return;
  const { id, name, phone } = g;
  vchPickedGuest = { id, name, phone };
  vchEl("vch-guest-results").innerHTML = "";
  vchEl("vch-guest-search").value = "";
  vchEl("vch-name").value = name || "";
  vchEl("vch-phone").value = phone || "";
  const picked = vchEl("vch-guest-picked");
  picked.classList.remove("hidden");
  picked.innerHTML = `
    <div class="flex items-center gap-2 text-[12px] bg-[#F4F9FD] border border-[#D7E5F2] rounded-xl px-3 py-2">
      <span class="text-[#1F5480] font-medium flex-1">Linked to ${vchEscape(name)}</span>
      <button onclick="vchClearGuest()" class="text-[#5596CE] hover:underline">Unlink</button>
    </div>`;
}

function vchClearGuest() {
  vchPickedGuest = null;
  vchEl("vch-guest-picked").classList.add("hidden");
  vchEl("vch-guest-picked").innerHTML = "";
}

// Everything the database will reject, caught here first with a
// sentence that says what to do about it.
function vchValidateIssue() {
  const qty = vchNum(vchVal("vch-qty")) || 1;
  if (qty < 1 || qty > 200) {
    return "How many must be between 1 and 200.";
  }
  const occasion = vchVal("vch-occasion");
  const partner = vchVal("vch-partner");
  const name = vchVal("vch-name");
  if (!vchPickedGuest && !name && !partner) {
    return "Add a recipient: pick a guest, type a name, or name the partner.";
  }
  if (occasion === "partnership" && !partner) {
    return "Name the partner or company this batch is for.";
  }
  if (vchValueType === "amount" && !vchNum(vchVal("vch-amount"))) {
    return "Enter the voucher amount.";
  }
  if (vchValueType === "percent") {
    const pct = vchPct(vchVal("vch-percent"));
    if (!pct || pct <= 0 || pct > 100) return "Enter a percentage between 1 and 100.";
  }
  if (vchValueType === "item" && !vchVal("vch-item")) {
    return "Describe the free item.";
  }
  const expires = vchVal("vch-expires");
  if (!expires) return "Set a valid-until date.";
  if (expires < vchYmd()) return "Valid until is in the past.";
  // A named recipient on a batch means every voucher carries the same
  // name, which is almost never what someone wants.
  if (qty > 1 && vchPickedGuest) {
    return "A batch cannot be linked to one guest. Unlink the guest, or issue them one voucher.";
  }
  return null;
}

async function vchIssue() {
  const problem = vchValidateIssue();
  if (problem) {
    toast(problem, "error");
    return;
  }

  const qty = vchNum(vchVal("vch-qty")) || 1;
  const occasion = vchVal("vch-occasion");
  const partner = vchVal("vch-partner") || null;
  const name = vchVal("vch-name") || null;

  // End of the chosen day, Jakarta time. A voucher marked "valid
  // until 30 September" must not start being refused at 07:00 that
  // morning with the guest standing there.
  const expiresAt = new Date(vchVal("vch-expires") + "T23:59:59+07:00").toISOString();

  const base = {
    occasion,
    partner_name: partner,
    guest_id: vchPickedGuest?.id || null,
    recipient_name: name,
    recipient_phone: vchVal("vch-phone") || null,
    value_type: vchValueType,
    value_idr:
      vchValueType === "amount"
        ? vchNum(vchVal("vch-amount"))
        : vchValueType === "item"
          ? vchNum(vchVal("vch-item-cost"))
          : vchNum(vchVal("vch-percent-cap")),
    value_percent: vchValueType === "percent" ? vchPct(vchVal("vch-percent")) : null,
    value_item: vchValueType === "item" ? vchVal("vch-item") : null,
    percent_cap_idr:
      vchValueType === "percent" ? vchNum(vchVal("vch-percent-cap")) : null,
    min_spend_idr: vchNum(vchVal("vch-min-spend")),
    // Empty means "use the occasion label", resolved at render time
    // rather than frozen here — so renaming an occasion label in the
    // code updates old cards that never had custom wording.
    card_label: vchVal("vch-card-label") || null,
    note: vchVal("vch-note") || null,
    batch_label: vchVal("vch-batch-label") || null,
    expires_at: expiresAt,
    issued_by: currentStaffId(),
  };

  // One batch_id for the whole insert. Generated here rather than
  // letting the column default fire per row, otherwise a batch of 50
  // would come back as 50 separate batches in the report.
  const batchId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const rows = Array.from({ length: qty }, () => ({ ...base, batch_id: batchId }));

  const btn = vchEl("vch-issue-btn");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Issuing…";
  loader(true);
  const { data, error } = await supabaseQuery(
    () => db.from("standalone_vouchers").insert(rows).select("*"),
    "Failed to issue vouchers",
  );
  loader(false);
  btn.disabled = false;
  btn.textContent = label;

  if (error) {
    toast(
      "Could not issue the voucher. If this keeps happening the database migration may not be applied yet.",
      "error",
    );
    return;
  }

  toast(
    qty > 1 ? `${qty} vouchers issued.` : `Voucher ${data[0].voucher_code} issued.`,
    "success",
  );
  vchResetIssueForm();
  await vchLoad();
  // A single voucher is almost always sent to someone straight away,
  // so open the card. A batch is not: those get handed to a partner
  // as a list, and 50 modals would be nobody's idea of help.
  if (qty === 1 && typeof vchOpenCard === "function") vchOpenCard(data[0]);
}

function vchResetIssueForm() {
  ["vch-partner", "vch-name", "vch-phone", "vch-amount", "vch-percent",
   "vch-percent-cap", "vch-item", "vch-item-cost", "vch-min-spend",
   "vch-note", "vch-batch-label", "vch-guest-search", "vch-card-label"].forEach((id) => {
    if (vchEl(id)) vchEl(id).value = "";
  });
  vchEl("vch-qty").value = "1";
  vchEl("vch-guest-results").innerHTML = "";
  vchClearGuest();
  vchSetDefaultExpiry();
  vchOnQtyChange();
}

// Default validity comes from app_settings so ops can change it in
// one place; the field stays editable for the odd case.
let vchValidityDays = 60;

async function vchLoadValidity() {
  const { data } = await supabaseQuery(
    () => db.from("app_settings").select("value").eq("key", "vouchers").maybeSingle(),
    "Could not read voucher settings",
  );
  const days = parseInt(data?.value?.standalone_validity_days, 10);
  if (days > 0) vchValidityDays = days;
  vchSetDefaultExpiry();
}

function vchSetDefaultExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + vchValidityDays);
  if (vchEl("vch-expires")) vchEl("vch-expires").value = vchYmd(d);
}

// ── Redeem ──────────────────────────────────────────────────

// Searching by name is the normal case. A guest arrives, says who
// they are, and staff find the voucher — nobody wants to retype
// VCH-00042 off a phone screen, and it cannot be pasted from a
// printed card at all. Codes still work for when the guest does
// show one.
let vchMatches = [];

function vchLooksLikeCode(term) {
  return /^\s*BH[V-]/i.test(term);
}

async function vchLookup() {
  const term = vchVal("vch-redeem-code");
  const box = vchEl("vch-redeem-result");
  if (!term) {
    box.innerHTML = "";
    vchLookedUp = null;
    vchMatches = [];
    return;
  }

  loader(true);
  const byCode = vchLooksLikeCode(term);
  const { data, error } = await supabaseQuery(
    () => {
      const q = db.from("standalone_vouchers").select("*");
      if (byCode) return q.eq("voucher_code", term.toUpperCase().trim());
      const s = term.replace(/[%,()]/g, " ").trim();
      return q
        .or(
          `recipient_name.ilike.%${s}%,partner_name.ilike.%${s}%,recipient_phone.ilike.%${s}%,batch_label.ilike.%${s}%`,
        )
        .order("issued_at", { ascending: false })
        .limit(25);
    },
    "Voucher lookup failed",
  );
  loader(false);

  if (error) {
    box.innerHTML = vchNotice("Could not reach the database. Try again.", "error");
    return;
  }

  const found = data ? (Array.isArray(data) ? data : [data]) : [];
  if (found.length === 0) {
    // A membership code looks different and lives on another screen.
    // Saying so is more useful than "not found" to someone standing
    // at the till holding a phone.
    const hint = /^\s*BH-/i.test(term)
      ? " That looks like a membership voucher code — check it on the Membership page."
      : "";
    box.innerHTML = vchNotice(
      `Nothing found for "${vchEscape(term)}".${hint}`,
      "error",
    );
    vchLookedUp = null;
    vchMatches = [];
    return;
  }

  // Redeemable ones first: when a regular gets their third voucher,
  // the one they can actually use should not be buried under two
  // spent ones.
  const rank = { open: 0, expired: 1, redeemed: 2, void: 3 };
  found.sort((a, b) => rank[vchStatus(a)] - rank[vchStatus(b)]);
  vchMatches = found;

  if (found.length === 1) {
    vchLookedUp = found[0];
    vchRenderLookup();
    return;
  }
  vchLookedUp = null;
  vchRenderMatches();
}

// More than one hit: never guess which voucher to redeem. Redeeming
// the wrong one is not correctable.
function vchRenderMatches() {
  const box = vchEl("vch-redeem-result");
  box.innerHTML = `
    <p class="text-[12px] text-[#777] mb-2">${vchMatches.length} vouchers found. Pick the right one.</p>
    ${vchMatches
      .map(
        (r, i) => `
      <button onclick="vchPickMatch(${i})"
        class="w-full text-left border border-[#EDE9E3] rounded-xl px-3 py-2 mb-2 hover:border-[#5596CE] hover:bg-[#F8FBFE]">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[13px] font-medium text-[#28547C] flex-1">${vchEscape(vchRecipientText(r))}</span>
          <span class="text-[13px] text-[#28547C]">${vchEscape(vchValueText(r))}</span>
          ${vchStatusChip(r)}
        </div>
        <div class="text-[11px] text-[#999] mt-0.5">
          <span class="font-mono">${vchEscape(r.voucher_code)}</span>
          · valid until ${vchDateId(r.expires_at)}
          ${r.batch_label ? "· " + vchEscape(r.batch_label) : ""}
        </div>
      </button>`,
      )
      .join("")}`;
}

function vchPickMatch(index) {
  vchLookedUp = vchMatches[index] || null;
  vchRenderLookup();
}

function vchNotice(text, kind) {
  const colors =
    kind === "error"
      ? "background:#FDECEC;border-color:#F5C6C6;color:#8E2C2C"
      : "background:#F4F9FD;border-color:#D7E5F2;color:#1F5480";
  return `<div class="rounded-xl border px-4 py-3 text-[13px]" style="${colors}">${text}</div>`;
}

function vchRenderLookup() {
  const row = vchLookedUp;
  const box = vchEl("vch-redeem-result");
  if (!row) {
    box.innerHTML = "";
    return;
  }
  const status = vchStatus(row);
  const detail = `
    ${
      vchMatches.length > 1
        ? `<button onclick="vchRenderMatches()" class="text-[12px] text-[#5596CE] hover:underline mb-2">← Back to the ${vchMatches.length} results</button>`
        : ""
    }
    <div class="rounded-xl border border-[#EDE9E3] p-4">
      <div class="flex items-start gap-3 flex-wrap">
        <div class="flex-1 min-w-[180px]">
          <p class="font-mono text-[13px] text-[#28547C] font-semibold">${vchEscape(row.voucher_code)}</p>
          <p class="text-[13px] text-[#555] mt-0.5">${vchEscape(vchRecipientText(row))}</p>
          <p class="text-[12px] text-[#999] mt-0.5">
            ${vchEscape(VCH_OCCASIONS[row.occasion] || row.occasion)}
            ${row.partner_name ? " · " + vchEscape(row.partner_name) : ""}
          </p>
        </div>
        <div class="text-right">
          <p class="text-[15px] font-semibold text-[#28547C]">${vchEscape(vchValueText(row))}</p>
          <p class="text-[11px] text-[#999] mt-0.5">Valid until ${vchDateId(row.expires_at)}</p>
          <div class="mt-1">${vchStatusChip(row)}</div>
        </div>
      </div>
      ${
        row.min_spend_idr
          ? `<p class="text-[12px] text-[#A35B12] mt-3">Minimum spend ${vchRupiah(row.min_spend_idr)}. Check the bill before redeeming.</p>`
          : ""
      }
      ${vchLookupAction(row, status)}
    </div>`;
  box.innerHTML = detail;
}

function vchLookupAction(row, status) {
  if (status === "redeemed") {
    return vchNoticeInline(
      `Already redeemed on ${vchDateId(row.redeemed_at)}. Nothing further to do.`,
    );
  }
  if (status === "void") {
    return vchNoticeInline(
      `This voucher was cancelled${row.void_reason ? ": " + vchEscape(row.void_reason) : ""}.`,
    );
  }
  const expired = status === "expired";
  return `
    <div class="mt-4 pt-3 border-t border-[#EDE9E3] flex flex-wrap gap-2 items-center">
      ${
        expired
          ? `<p class="text-[12px] text-[#A35B12] w-full mb-1">Expired on ${vchDateId(row.expires_at)}. Honouring it anyway is a service decision, and it will be recorded under your name.</p>`
          : ""
      }
      <button onclick="vchRedeem(${expired})" class="btn-primary">
        ${expired ? "Redeem anyway" : "Redeem"}
      </button>
      <button onclick="vchVoid()" class="border border-[#EDE9E3] text-[#555] text-sm font-medium px-4 py-2 rounded-xl hover:bg-[#F8F6F2]">
        Cancel this voucher
      </button>
    </div>`;
}

function vchNoticeInline(text) {
  return `<p class="text-[12px] text-[#777] mt-3 pt-3 border-t border-[#EDE9E3]">${text}</p>`;
}

async function vchRedeem(allowExpired) {
  const row = vchLookedUp;
  if (!row) return;
  const value = vchValueText(row);
  if (
    !confirm(
      `Redeem ${row.voucher_code} (${value}) for ${vchRecipientText(row)}?\n\nThis cannot be undone.`,
    )
  )
    return;

  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db.rpc("redeem_standalone_voucher", {
        p_code: row.voucher_code,
        p_redeemed_by: currentStaffId(),
        p_note: null,
        p_allow_expired: !!allowExpired,
      }),
    "Failed to redeem voucher",
  );
  loader(false);

  const msg = error?.message || "";
  if (msg.includes("VOUCHER_ALREADY_REDEEMED")) {
    toast("Already redeemed. Someone got there first.", "error");
  } else if (msg.includes("VOUCHER_EXPIRED")) {
    toast("Expired. Use 'Redeem anyway' if you are honouring it.", "error");
  } else if (msg.includes("VOUCHER_VOIDED")) {
    toast("This voucher was cancelled.", "error");
  } else if (error) {
    toast("Could not redeem. Try again.", "error");
  } else {
    toast(`Redeemed ${row.voucher_code}.`, "success");
  }
  await vchRefreshLookup();
  await vchLoad();
}

async function vchVoid() {
  const row = vchLookedUp;
  if (!row) return;
  const reason = prompt(
    `Cancel ${row.voucher_code}? The guest will not be able to use it.\n\nWhy? (recorded)`,
  );
  if (reason === null) return;

  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db.rpc("void_standalone_voucher", {
        p_code: row.voucher_code,
        p_voided_by: currentStaffId(),
        p_reason: reason || null,
      }),
    "Failed to cancel voucher",
  );
  loader(false);

  if (error?.message?.includes("VOUCHER_ALREADY_REDEEMED")) {
    toast("Already redeemed, so it cannot be cancelled.", "error");
  } else if (error) {
    toast("Could not cancel. Try again.", "error");
  } else {
    toast(`${row.voucher_code} cancelled.`, "success");
  }
  await vchRefreshLookup();
  await vchLoad();
}

// Re-reads the row rather than patching it in memory, so what the
// screen shows is what the database actually holds.
async function vchRefreshLookup() {
  if (!vchLookedUp) return;
  const { data } = await supabaseQuery(
    () =>
      db
        .from("standalone_vouchers")
        .select("*")
        .eq("id", vchLookedUp.id)
        .maybeSingle(),
    "Voucher refresh failed",
  );
  vchLookedUp = data || vchLookedUp;
  vchRenderLookup();
}

// ── List + batches ──────────────────────────────────────────

async function vchLoad() {
  const [list, batches] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("standalone_vouchers")
          .select("*")
          .order("issued_at", { ascending: false })
          .limit(VCH_LIST_LIMIT),
      "Could not load vouchers",
    ),
    supabaseQuery(
      () =>
        db
          .from("standalone_voucher_batches")
          .select("*")
          .order("issued_at", { ascending: false })
          .limit(12),
      "Could not load voucher batches",
    ),
  ]);

  if (list.error) {
    vchEl("vch-list").innerHTML = vchNotice(
      "Could not load vouchers. If this is the first run, the database migration may not be applied yet.",
      "error",
    );
    return;
  }
  vchRows = list.data || [];
  vchBatches = batches.data || [];
  vchRenderFilters();
  vchRenderList();
  vchRenderBatches();
}

function vchCounts() {
  return vchRows.reduce(
    (acc, r) => {
      acc.all++;
      acc[vchStatus(r)]++;
      return acc;
    },
    { all: 0, open: 0, redeemed: 0, expired: 0, void: 0 },
  );
}

function vchRenderFilters() {
  const counts = vchCounts();
  const tabs = [
    ["open", "Active"],
    ["redeemed", "Redeemed"],
    ["expired", "Expired"],
    ["void", "Cancelled"],
    ["all", "All"],
  ];
  vchEl("vch-filter-tabs").innerHTML = tabs
    .map(
      ([key, label]) =>
        `<button class="vch-ftab ${vchFilter === key ? "vch-ftab-on" : ""}"
           onclick="vchSetFilter('${key}')">${label} (${counts[key] || 0})</button>`,
    )
    .join("");
}

function vchSetFilter(key) {
  vchFilter = key;
  vchRenderFilters();
  vchRenderList();
}

function vchRenderList() {
  const search = (vchVal("vch-list-search") || "").toLowerCase();
  const rows = vchRows
    .filter((r) => vchFilter === "all" || vchStatus(r) === vchFilter)
    .filter((r) => {
      if (!search) return true;
      return [r.voucher_code, r.recipient_name, r.partner_name, r.batch_label]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(search));
    });

  if (rows.length === 0) {
    vchEl("vch-list").innerHTML = `<p class="text-[12px] text-[#999]">${
      vchRows.length === 0
        ? "No vouchers issued yet."
        : "Nothing matches this filter."
    }</p>`;
    return;
  }

  vchEl("vch-list").innerHTML = rows
    .map(
      (r) => `
    <div class="flex items-center gap-3 flex-wrap border-b border-[#F2EFE9] py-3">
      <div class="min-w-[140px]">
        <p class="font-mono text-[12px] text-[#28547C] font-semibold">${vchEscape(r.voucher_code)}</p>
        <p class="text-[11px] text-[#999]">${vchDateId(r.issued_at)}</p>
      </div>
      <div class="flex-1 min-w-[150px]">
        <p class="text-[13px] text-[#555]">${vchEscape(vchRecipientText(r))}</p>
        <p class="text-[11px] text-[#999]">
          ${vchEscape(VCH_OCCASIONS[r.occasion] || r.occasion)}${r.batch_label ? " · " + vchEscape(r.batch_label) : ""}
        </p>
      </div>
      <div class="text-right min-w-[110px]">
        <p class="text-[13px] text-[#28547C] font-medium">${vchEscape(vchValueText(r))}</p>
        <p class="text-[11px] text-[#999]">${vchDateId(r.expires_at)}</p>
      </div>
      <div class="min-w-[80px] text-right">${vchStatusChip(r)}</div>
      <button onclick="vchOpenCardByCode('${vchEscape(r.voucher_code)}')"
        class="text-[12px] text-[#5596CE] hover:underline">Card</button>
    </div>`,
    )
    .join("");
}

function vchRenderBatches() {
  if (vchBatches.length === 0) {
    vchEl("vch-batches").innerHTML =
      '<p class="text-[12px] text-[#999]">No batches yet.</p>';
    return;
  }
  vchEl("vch-batches").innerHTML = vchBatches
    .map((b) => {
      const label =
        b.batch_label || b.partner_name || VCH_OCCASIONS[b.occasion] || "Batch";
      // Outstanding is the number that matters: money promised but
      // not yet spent, and still spendable.
      return `
      <div class="border-b border-[#F2EFE9] py-3">
        <div class="flex items-baseline gap-2 flex-wrap">
          <p class="text-[13px] font-medium text-[#28547C] flex-1">${vchEscape(label)}</p>
          <p class="text-[11px] text-[#999]">${vchDateId(b.issued_at)}</p>
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1 mt-1 text-[12px]">
          <span class="text-[#777]">Issued <span class="text-[#28547C] font-medium">${b.issued_count}</span> · ${vchRupiah(b.issued_idr)}</span>
          <span class="text-[#777]">Redeemed <span class="text-[#2F6B3A] font-medium">${b.redeemed_count}</span> · ${vchRupiah(b.redeemed_idr)}</span>
          <span class="text-[#777]">Outstanding <span class="text-[#1F5480] font-medium">${b.open_count}</span> · ${vchRupiah(b.open_idr)}</span>
          ${b.expired_count ? `<span class="text-[#A35B12]">Expired ${b.expired_count}</span>` : ""}
          ${b.voided_count ? `<span class="text-[#999]">Cancelled ${b.voided_count}</span>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function vchOpenCardByCode(code) {
  const row = vchRows.find((r) => r.voucher_code === code);
  if (row && typeof vchOpenCard === "function") vchOpenCard(row);
}

// ── The card ────────────────────────────────────────────────
// Drawn by vcRenderVoucher() in js/voucher.js, the same function the
// membership card uses. Two renderers would drift apart and the
// restaurant would end up with two different-looking vouchers.

let vchCardRow = null;

// What is printed as the value. For a percentage the cap matters to
// the guest, so it goes on the card, not just in the log.
function vchCardValueText(row) {
  if (row.value_type === "amount") return vchRupiah(row.value_idr);
  if (row.value_type === "percent") {
    const pct = Number(row.value_percent);
    return (pct % 1 === 0 ? pct : pct.toFixed(1)) + "% OFF";
  }
  return row.value_item || "";
}

function vchCardName(row) {
  return row.recipient_name || row.partner_name || "Tamu " + restaurantName();
}

async function vchOpenCard(row) {
  vchCardRow = row;
  showModal("modal-standalone-voucher");
  vchEl("vch-card-meta").textContent = `${row.voucher_code} · ${
    VCH_OCCASIONS[row.occasion] || row.occasion
  }`;

  const terms = [];
  if (row.min_spend_idr) terms.push(`Minimum spend ${vchRupiah(row.min_spend_idr)}`);
  if (row.percent_cap_idr && row.value_type === "percent")
    terms.push(`Maximum discount ${vchRupiah(row.percent_cap_idr)}`);
  vchEl("vch-card-summary").innerHTML = `
    <p><span class="text-[#999]">For</span> ${vchEscape(vchCardName(row))}</p>
    <p><span class="text-[#999]">Worth</span> ${vchEscape(vchValueText(row))}</p>
    <p><span class="text-[#999]">Valid until</span> ${vchDateId(row.expires_at)}</p>
    <p><span class="text-[#999]">Status</span> ${vchStatusChip(row)}</p>
    ${terms.length ? `<p class="text-[12px] text-[#A35B12] pt-1">${terms.join(" · ")}</p>` : ""}`;

  // The edit box shows the custom wording only. Left empty it makes
  // the placeholder — the occasion label — visibly the fallback,
  // rather than looking like text someone typed.
  const labelEdit = vchEl("vch-card-label-edit");
  if (labelEdit) {
    labelEdit.value = row.card_label || "";
    labelEdit.placeholder = VCH_OCCASIONS[row.occasion] || row.occasion || "";
  }

  const preview = vchEl("vch-card-preview");
  preview.innerHTML = '<p class="text-[12px] text-[#999]">Drawing the card…</p>';
  try {
    if (typeof vcPreloadFonts === "function") await vcPreloadFonts();
    const canvas = await vcRenderVoucher(vchCardData(row));
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.borderRadius = "10px";
    preview.innerHTML = "";
    preview.appendChild(canvas);
  } catch (err) {
    console.error("[vouchers] card render failed", err);
    preview.innerHTML =
      '<p class="text-[12px] text-[#8E2C2C]">Could not draw the card.</p>';
  }
}

// The line under the date. Free text when someone has written one,
// otherwise the occasion label — which is a reporting category, and
// reads like one ("Top spender thank you"). Staff can say something
// warmer without disturbing how vouchers group in the batch report.
function vchCardLabel(row) {
  return (
    (row.card_label && row.card_label.trim()) ||
    VCH_OCCASIONS[row.occasion] ||
    row.occasion ||
    null
  );
}

function vchCardData(row) {
  return {
    name: vchCardName(row),
    code: row.voucher_code,
    valueText: vchCardValueText(row),
    expiresAt: row.expires_at,
    // The membership card prints the member number here; a gift
    // voucher has none, so the card line goes in its place.
    typeLabel: vchCardLabel(row),
    memberNumber: row.partner_name || null,
  };
}

// Written back to the row, not held in the modal: the guest may be
// sent the card today and a replacement next week, and both must say
// the same thing.
async function vchSaveCardLabel() {
  if (!vchCardRow) return;
  const label = (vchEl("vch-card-label-edit").value || "").trim();
  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db
        .from("standalone_vouchers")
        .update({ card_label: label || null })
        .eq("id", vchCardRow.id),
    "Could not save the card line",
  );
  loader(false);
  if (error) {
    toast("Could not save the card line.", "error");
    return;
  }
  vchCardRow = { ...vchCardRow, card_label: label || null };
  const inList = vchRows.find((r) => r.id === vchCardRow.id);
  if (inList) inList.card_label = label || null;
  toast("Card line saved.", "success");
  await vchOpenCard(vchCardRow);
}

async function vchDownloadCard() {
  if (!vchCardRow) return;
  const btn = vchEl("vch-card-download");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    if (typeof vcPreloadFonts === "function") await vcPreloadFonts();
    const canvas = await vcRenderVoucher(vchCardData(vchCardRow));
    const link = document.createElement("a");
    const who = (vchCardName(vchCardRow) || "").replace(/[^\p{L}\p{N}]+/gu, "-");
    link.download = `Voucher-${vchCardRow.voucher_code}-${who}.png`.slice(0, 80);
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("Card saved. Attach it in WhatsApp.", "success");
  } catch (err) {
    console.error("[vouchers] card download failed", err);
    toast("Could not save the card image.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function vchSendCardWA() {
  if (!vchCardRow) return;
  const phone = vchCardRow.recipient_phone;
  if (!phone) {
    toast("No phone number on this voucher. Add one, or send the image yourself.", "error");
    return;
  }

  // The voucher may have been redeemed at the till while this modal sat
  // open. Sending a spent voucher to a guest is worse than not sending.
  const { data: fresh } = await supabaseQuery(
    () =>
      db
        .from("standalone_vouchers")
        .select("redeemed, voided")
        .eq("id", vchCardRow.id)
        .maybeSingle(),
    "Could not check voucher status",
  );
  if (fresh?.redeemed || fresh?.voided) {
    toast(
      fresh.redeemed
        ? "This voucher was just redeemed — do not send it."
        : "This voucher was cancelled — do not send it.",
      "error",
    );
    hideModal("modal-standalone-voucher");
    vchLoad();
    return;
  }

  const name =
    typeof waGreetName === "function"
      ? waGreetName(vchCardRow.recipient_name || "")
      : vchCardRow.recipient_name || "";
  const message = [
    `Halo ${name}`.trim() + ",",
    "",
    `Terima kasih dari ${restaurantName()}. Ini voucher untuk Anda:`,
    `Nilai: ${vchValueText(vchCardRow)}`,
    `Kode: ${vchCardRow.voucher_code}`,
    `Berlaku sampai: ${vchDateId(vchCardRow.expires_at)}`,
    vchCardRow.min_spend_idr
      ? `Minimum transaksi: ${vchRupiah(vchCardRow.min_spend_idr)}`
      : null,
    "",
    "Tunjukkan kode ini kepada staf kami saat pembayaran ya.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  waOpenChat(phone, message);
}

// ── Boot ────────────────────────────────────────────────────

function initVouchers() {
  if (!vchBooted) {
    vchBooted = true;
    vchSetValueType("amount");
    vchOnOccasionChange();
    vchOnQtyChange();
    vchLoadValidity();
  }
  vchLoad();
}
