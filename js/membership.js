// ============================================================
// BLUE HERON GUEST BOOK — Membership (merged from Staff Portal)
// Tables: members, member_transactions, member_vouchers
// Business rules live in DB functions:
//   add_member_transaction() / redeem_member_voucher()
// ============================================================

// Display defaults only — the DB functions are the source of truth.
// Overridden from app_settings.membership by applyMembershipSettings()
// (called by loadAppSettings in app.js) so the UI copy always matches
// what a manager configured on Settings > Thresholds.
const MEMBER_RULES = {
  Family: { minSpend: 300000, voucherAmount: 100000, cap: 15, label: "Family Card" },
  Company: { minSpend: 2000000, voucherAmount: 500000, cap: null, label: "Company Card" },
};
let STICKERS_PER_VOUCHER = 5;

function applyMembershipSettings() {
  const mb = typeof APP_SETTINGS !== "undefined" ? APP_SETTINGS.membership : null;
  if (!mb) return;
  if (mb.stickers_per_voucher >= 1)
    STICKERS_PER_VOUCHER = Number(mb.stickers_per_voucher);
  for (const type of ["Family", "Company"]) {
    const cfg = mb[type];
    if (!cfg) continue;
    if (cfg.min_spend > 0) MEMBER_RULES[type].minSpend = Number(cfg.min_spend);
    if (cfg.voucher_amount > 0)
      MEMBER_RULES[type].voucherAmount = Number(cfg.voucher_amount);
    // cap: null is a valid value (= no cap), so copy it verbatim when the
    // key exists rather than testing truthiness.
    if ("cap" in cfg)
      MEMBER_RULES[type].cap = cfg.cap === null ? null : Number(cfg.cap);
    if (cfg.label) MEMBER_RULES[type].label = cfg.label;
  }
  // Keep the static "Add Member" card-type labels in sync so the form
  // never shows outdated minimums after a manager edits thresholds.
  const sel = document.getElementById("am-type");
  if (sel) {
    for (const opt of sel.options) {
      const rule = MEMBER_RULES[opt.value];
      if (rule)
        opt.textContent = `${rule.label} (min Rp ${Number(rule.minSpend).toLocaleString("id-ID")}/visit)`;
    }
  }
}

// ------------------------------------------------------------
// MEMBER BADGE (used across the whole app: lists, guest profile)
// Small cache: guest_id -> member. Loaded at startup, refreshed
// whenever membership data changes.
// ------------------------------------------------------------
let memberBadgeMap = {};

async function loadMemberBadgeMap() {
  const { data } = await supabaseQuery(
    () =>
      db
        .from("members")
        .select("id, guest_id, member_number, member_type, total_stickers, available_vouchers")
        .eq("is_active", true),
    "Failed to load member badges",
  );
  memberBadgeMap = {};
  (data || []).forEach((m) => {
    if (m.guest_id) memberBadgeMap[m.guest_id] = m;
  });
}

function memberBadge(guestId) {
  const m = guestId ? memberBadgeMap[guestId] : null;
  if (!m) return "";
  const family = m.member_type === "Family";
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style="background:${family ? "#FDF3E0" : "#EEF4FD"};color:${family ? "#8B6F47" : "#1F4E79"};border:1px solid ${family ? "#EBD9B4" : "#CBDDF2"}">⭐ ${m.member_number}</span>`;
}

document.addEventListener("DOMContentLoaded", () => {
  loadMemberBadgeMap();
});

let membersCache = [];
let memberSearchQuery = "";
let memberTypeFilter = "all";
let currentMemberId = null;

// ------------------------------------------------------------
// PAGE LOAD
// ------------------------------------------------------------
async function loadMembership() {
  loader(true);
  const [{ data: members }, { data: voucherStats }] = await Promise.all([
    supabaseQuery(
      () =>
        db
          .from("members")
          .select("*, guests(id, name, spending_tier)")
          .order("created_at", { ascending: false }),
      "Failed to load members",
    ),
    supabaseQuery(
      () => db.from("member_vouchers").select("id, redeemed"),
      "Failed to load voucher stats",
    ),
  ]);
  loader(false);

  membersCache = members || [];
  loadMemberBadgeMap(); // keep badges in sync

  const totalStickers = membersCache.reduce((s, m) => s + (m.total_stickers || 0), 0);
  const unredeemed = (voucherStats || []).filter((v) => !v.redeemed).length;

  setText("mbr-stat-total", membersCache.length);
  setText("mbr-stat-family", membersCache.filter((m) => m.member_type === "Family").length);
  setText("mbr-stat-company", membersCache.filter((m) => m.member_type === "Company").length);
  setText("mbr-stat-stickers", totalStickers);
  setText("mbr-stat-vouchers", unredeemed);

  renderMemberList();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function onMemberSearch() {
  memberSearchQuery = (document.getElementById("mbr-search")?.value || "").toLowerCase().trim();
  renderMemberList();
}

function setMemberTypeFilter(type) {
  memberTypeFilter = type;
  document.querySelectorAll("[data-mbr-filter]").forEach((b) => {
    const active = b.dataset.mbrFilter === type;
    b.className = active
      ? "px-3 py-1.5 text-xs font-medium rounded-full bg-[#28547C] text-white"
      : "px-3 py-1.5 text-xs font-medium rounded-full bg-[#F1EEE8] text-[#555] hover:bg-[#E7E4DE]";
  });
  renderMemberList();
}

function stickerDots(m) {
  const rule = MEMBER_RULES[m.member_type];
  const total = m.total_stickers || 0;
  const spv = STICKERS_PER_VOUCHER;
  const inRound = total % spv === 0 && total > 0 ? spv : total % spv;
  let dots = "";
  for (let i = 1; i <= 5; i++) {
    dots += `<span class="inline-block w-2.5 h-2.5 rounded-full mr-0.5 ${i <= inRound ? "bg-[#C8A96B]" : "bg-[#E7E4DE]"}"></span>`;
  }
  const capNote = rule.cap ? ` / ${rule.cap}` : "";
  return `${dots}<span class="ml-1.5 text-xs text-[#777]">${total}${capNote}</span>`;
}

function memberTypeBadge(type) {
  return type === "Family"
    ? '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EFF7EC] text-[#3F6C3F]">Family</span>'
    : '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EEF4FD] text-[#1F4E79]">Company</span>';
}

// Same rule the guest list uses: drop the leading title, keep
// everything after the name (see waStripHonorific in wa.js). Members
// carried 26 titles out of 34, so the Membership page was the last
// screen still reading "Ibu Alia" while every other page said "Alia".
//
// DISPLAY ONLY — members.full_name in the DB is untouched, and it is
// deliberately NOT cleaned on save, because the same field is synced to
// guests.name by saveMember and a silent rewrite there would propagate.
function memberReadingName(m) {
  const raw = (m && m.full_name) || "";
  if (typeof waStripHonorific !== "function") return raw;
  return waStripHonorific(raw) || raw;
}

function renderMemberList() {
  const tbody = document.getElementById("mbr-table-body");
  if (!tbody) return;

  let rows = membersCache;
  if (memberTypeFilter !== "all") rows = rows.filter((m) => m.member_type === memberTypeFilter);
  if (memberSearchQuery) {
    rows = rows.filter(
      (m) =>
        // Raw AND cleaned: staff who remember the guest as "Ibu Alia"
        // must still find her after the title stops being displayed.
        m.full_name.toLowerCase().includes(memberSearchQuery) ||
        memberReadingName(m).toLowerCase().includes(memberSearchQuery) ||
        m.member_number.toLowerCase().includes(memberSearchQuery) ||
        (m.phone_number || "").includes(memberSearchQuery),
    );
  }

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center text-sm text-[#999] py-8">No members found</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (m) => `
    <tr class="border-b border-[#F1EEE8] hover:bg-[#FBFAF7] cursor-pointer" onclick="viewMemberDetail(${m.id})">
      <td class="py-3 px-4 text-xs font-mono text-[#777]">${m.member_number}</td>
      <td class="py-3 px-4 text-sm font-medium text-[#333]">${escapeHtml(memberReadingName(m))}
        ${m.guests ? `<span class="block text-[11px] text-[#999]">Guest: ${formatGuestName(m.guests)}</span>` : '<span class="block text-[11px] text-red-400">no guest link</span>'}
      </td>
      <td class="py-3 px-4">${memberTypeBadge(m.member_type)}</td>
      <td class="py-3 px-4 text-sm text-[#555]">${fmt.phone(m.phone_number)}</td>
      <td class="py-3 px-4">${stickerDots(m)}</td>
      <td class="py-3 px-4 text-center">
        ${m.available_vouchers > 0 ? `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FDF3E0] text-[#8B6F47]">${m.available_vouchers} voucher${m.available_vouchers > 1 ? "s" : ""}</span>` : '<span class="text-xs text-[#CCC]">—</span>'}
      </td>
      <td class="py-3 px-4 text-right">
        <button onclick="event.stopPropagation(); openMemberTxn(${m.id})" class="text-xs font-medium text-white bg-[#28547C] hover:bg-[#1f4060] px-3 py-1.5 rounded-lg transition-colors">+ Spend</button>
      </td>
    </tr>`,
    )
    .join("");
}

// ------------------------------------------------------------
// ADD MEMBER (auto-links guest by exact phone match)
// ------------------------------------------------------------
let amSelectedGuest = null; // guest picked from autosuggest
let amSearchTimeout = null;

function openAddMember() {
  ["am-number", "am-name", "am-phone"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("am-type").value = "Family";
  document.getElementById("am-error").textContent = "";
  document.getElementById("am-guest-hint").textContent = "";
  amSelectedGuest = null;
  updateAmSelectedLabel();
  hideAmResults();
  showModal("modal-add-member");
}

function hideAmResults() {
  const el = document.getElementById("am-results");
  if (el) {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
}

function updateAmSelectedLabel() {
  const el = document.getElementById("am-guest-selected");
  if (!el) return;
  if (amSelectedGuest) {
    el.textContent = `✓ Linked to existing guest: ${amSelectedGuest.name}`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
    el.textContent = "";
  }
}

function onAmNameInput() {
  amSelectedGuest = null; // typing again = new-guest mode
  updateAmSelectedLabel();
  clearTimeout(amSearchTimeout);
  const term = (document.getElementById("am-name")?.value || "").trim();
  const resultsEl = document.getElementById("am-results");
  if (!resultsEl) return;

  if (term.length < 2) {
    hideAmResults();
    return;
  }

  amSearchTimeout = setTimeout(async () => {
    const { data: guests } = await supabaseQuery(
      () =>
        db
          .from("guests")
          .select("id, name, phone")
          .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
          .order("name")
          .limit(6),
      "Failed to search guests",
    );

    if (!guests?.length) {
      hideAmResults();
      return;
    }

    resultsEl.innerHTML = `
      <div class="rounded-xl border border-[#E0DDD7] bg-white shadow-lg overflow-hidden max-h-[200px] overflow-y-auto">
        ${guests
          .map((g) => {
            const already = memberBadgeMap[g.id];
            return `
          <button type="button" ${already ? "disabled" : `onclick='selectAmGuest(${JSON.stringify(g).replace(/'/g, "&#39;")})'`}
            class="w-full text-left px-3 py-2 border-b border-[#F0EDE8] last:border-0 ${already ? "opacity-50 cursor-not-allowed" : "hover:bg-[#F8F6F2]"} transition-colors">
            <p class="text-sm font-medium text-[#222] truncate">${escapeHtml(g.name)} ${memberBadge(g.id)}${already ? ' <span class="text-[10px] text-[#999]">(already a member)</span>' : ""}</p>
            ${g.phone ? `<p class="text-xs text-[#999] truncate">${escapeHtml(g.phone)}</p>` : ""}
          </button>`;
          })
          .join("")}
      </div>`;
    resultsEl.classList.remove("hidden");
  }, 300);
}

function selectAmGuest(g) {
  amSelectedGuest = g;
  const nameEl = document.getElementById("am-name");
  const phoneEl = document.getElementById("am-phone");
  if (nameEl) nameEl.value = g.name;
  if (phoneEl && g.phone) phoneEl.value = g.phone;
  hideAmResults();
  updateAmSelectedLabel();
  document.getElementById("am-guest-hint").textContent = "";
  document.getElementById("am-number")?.focus();
}

let amPhoneTimeout = null;
function onAddMemberPhoneInput() {
  clearTimeout(amPhoneTimeout);
  amPhoneTimeout = setTimeout(async () => {
    const phone = document.getElementById("am-phone").value.trim();
    const hint = document.getElementById("am-guest-hint");
    if (!phone || phone.length < 8) {
      hint.textContent = "";
      return;
    }
    const { data } = await supabaseQuery(
      () => db.from("guests").select("id, name").eq("phone", phone).maybeSingle(),
      "Guest lookup failed",
    );
    hint.textContent = data
      ? `Will be linked to existing guest: ${data.name}`
      : "No guest with this phone — a new guest profile will be created.";
    hint.className = data ? "text-xs text-[#3F6C3F] mt-1" : "text-xs text-[#999] mt-1";
  }, 400);
}

async function saveNewMember() {
  const member_number = document.getElementById("am-number").value.trim();
  const member_type = document.getElementById("am-type").value;
  const full_name = document.getElementById("am-name").value.trim();
  const phone_number = document.getElementById("am-phone").value.trim();
  const errEl = document.getElementById("am-error");
  errEl.textContent = "";

  if (!member_number) return (errEl.textContent = "Member number is required.");
  if (!full_name) return (errEl.textContent = "Name is required.");
  if (!phone_number || phone_number.replace(/\D/g, "").length < 8)
    return (errEl.textContent = "A valid phone number is required.");

  loader(true);
  try {
    // Duplicate member number?
    const { data: dup } = await supabaseQuery(
      () => db.from("members").select("id").eq("member_number", member_number).maybeSingle(),
      "Duplicate check failed",
    );
    if (dup) {
      errEl.textContent = `Member number ${member_number} already exists.`;
      return;
    }

    // Duplicate phone on another member?
    const { data: dupPhone } = await supabaseQuery(
      () => db.from("members").select("id, member_number").eq("phone_number", phone_number).maybeSingle(),
      "Phone check failed",
    );
    if (dupPhone) {
      errEl.textContent = `This phone already belongs to member ${dupPhone.member_number}.`;
      return;
    }

    // Guest picked from autosuggest > exact phone match > create new
    let guestId = null;
    if (amSelectedGuest && amSelectedGuest.name === full_name) {
      guestId = amSelectedGuest.id;
      // Guest had no phone on file? Save the member's phone to the profile
      // so future phone matching works.
      if (!amSelectedGuest.phone) {
        await supabaseQuery(
          () => db.from("guests").update({ phone: phone_number }).eq("id", guestId),
          "Failed to update guest phone",
        );
      }
    }
    const { data: guest } = guestId
      ? { data: null }
      : await supabaseQuery(
          () => db.from("guests").select("id").eq("phone", phone_number).maybeSingle(),
          "Guest lookup failed",
        );
    if (guest) {
      guestId = guest.id;
    } else if (!guestId) {
      const { data: newGuest, error: gErr } = await supabaseQuery(
        () =>
          db
            .from("guests")
            .insert({ name: full_name, phone: phone_number, created_by: currentStaffId() })
            .select("id")
            .single(),
        "Failed to create guest profile",
      );
      if (gErr) {
        errEl.textContent = "Could not create guest profile. Try again.";
        return;
      }
      guestId = newGuest.id;
    }

    const { data: newMember, error } = await supabaseQuery(
      () =>
        db
          .from("members")
          .insert({
            member_number,
            member_type,
            full_name,
            phone_number,
            guest_id: guestId,
          })
          .select("id")
          .single(),
      "Failed to create member",
    );
    if (error) {
      errEl.textContent = "Failed to save member. Try again.";
      return;
    }

    // Membership name is the source of truth: sync the guest profile name
    // (e.g. staff adds company info the guest record didn't have).
    if (guestId) {
      await supabaseQuery(
        () =>
          db
            .from("guests")
            .update({ name: full_name, updated_at: new Date().toISOString() })
            .eq("id", guestId)
            .neq("name", full_name),
        "Failed to sync guest name",
      );
    }

    // Refresh the badge cache NOW so the ⭐ shows without a page reload
    await loadMemberBadgeMap();

    hideModal("modal-add-member");
    toast(`Member ${member_number} created`, "success");
    loadMembership();
    // isViewingStaffDashboard() (app.js) rather than a currentPage check:
    // an admin can now be on #page-dashboard via the Staff Dashboard entry,
    // where currentPage is "staff-dashboard".
    if (
      typeof isViewingStaffDashboard === "function" &&
      isViewingStaffDashboard() &&
      typeof loadDashboard === "function"
    ) {
      loadDashboard();
    }

    // Existing guest just became a member? Offer to convert their history
    // right here, while the staff member is still with the guest. Opens
    // only if there is something eligible, and only for manager/admin.
    if (newMember?.id) cvOfferAfterSignup(newMember.id);
  } finally {
    loader(false);
  }
}

// ------------------------------------------------------------
// MEMBER DETAIL
// ------------------------------------------------------------
async function viewMemberDetail(memberId) {
  currentMemberId = memberId;
  loader(true);
  const [{ data: m }, { data: txns }, { data: vouchers }] = await Promise.all([
    supabaseQuery(
      () => db.from("members").select("*, guests(id, name, spending_tier)").eq("id", memberId).single(),
      "Failed to load member",
    ),
    supabaseQuery(
      () =>
        db
          .from("member_transactions")
          .select("*")
          .eq("member_id", memberId)
          .order("transaction_date", { ascending: false })
          .limit(50),
      "Failed to load transactions",
    ),
    supabaseQuery(
      () =>
        db
          .from("member_vouchers")
          .select("*")
          .eq("member_id", memberId)
          .order("issued_at", { ascending: false }),
      "Failed to load vouchers",
    ),
  ]);
  loader(false);
  if (!m) return;

  const rule = MEMBER_RULES[m.member_type];
  setText("md-name", memberReadingName(m));
  setText("md-number", m.member_number);
  document.getElementById("md-type").innerHTML = memberTypeBadge(m.member_type);
  setText("md-phone", fmt.phone(m.phone_number));
  document.getElementById("md-guest").innerHTML = m.guests
    ? `<button onclick="hideModal('modal-member-detail'); viewGuestProfile('${m.guests.id}')" class="text-[#28547C] underline">${formatGuestName(m.guests)}</button>`
    : '<span class="text-red-400">not linked</span>';
  document.getElementById("md-progress").innerHTML = stickerDots(m);
  setText("md-rule", `1 sticker per visit ≥ ${fmt.currency(rule.minSpend)} · ${fmt.currency(rule.voucherAmount)} voucher per ${STICKERS_PER_VOUCHER} stickers${rule.cap ? ` · max ${rule.cap} stickers` : ""}`);

  const capReached = rule.cap && (m.total_stickers || 0) >= rule.cap;
  document.getElementById("md-cap-warning").classList.toggle("hidden", !capReached);

  document.getElementById("md-txns").innerHTML = (txns || []).length
    ? txns
        .map(
          (t) => `
      <div class="flex items-center justify-between py-2 border-b border-[#F1EEE8] text-sm">
        <div>
          <span class="text-[#333]">${fmt.date(t.transaction_date)}</span>
          <span class="text-xs text-[#999] ml-2">${t.cashier_name || ""}${t.notes ? " · " + t.notes : ""}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-medium">${fmt.currency(t.transaction_amount)}</span>
          ${t.qualified_sticker ? '<span class="text-[11px] px-1.5 py-0.5 rounded bg-[#FDF3E0] text-[#8B6F47]">🏵 sticker</span>' : '<span class="text-[11px] text-[#CCC]">no sticker</span>'}
        </div>
      </div>`,
        )
        .join("")
    : '<p class="text-xs text-[#999] py-3">No transactions yet.</p>';

  document.getElementById("md-vouchers").innerHTML = (vouchers || []).length
    ? vouchers.map(renderVoucherRow).join("")
    : '<p class="text-xs text-[#999] py-3">No vouchers yet.</p>';

  showModal("modal-member-detail");
  // The "Konversi kunjungan lama" button is manager-only; re-apply after
  // the modal is shown so a staff login never sees it.
  if (typeof applyManagerOnlyUI === "function") applyManagerOnlyUI();
}

// ------------------------------------------------------------
// VOUCHER ROW
// ------------------------------------------------------------
// Three states, deliberately different shapes so a busy front desk
// cannot confuse them:
//   redeemed  → grey, no actions at all
//   expired   → amber, no Download/WA (never hand out a dead voucher),
//               Redeem still available for a manager decision
//   active    → Download Voucher + Kirim WA above the Redeem button
// expires_at / voucher_code are null until the 20260731 migration runs;
// the row degrades to the old look instead of breaking.
function voucherIsExpired(v) {
  return !v.redeemed && !!v.expires_at && new Date(v.expires_at) < new Date();
}

function renderVoucherRow(v) {
  const head = `<div class="flex items-center justify-between">
      <div>
        <span class="font-medium">${fmt.currency(v.voucher_amount)}</span>
        <span class="text-xs text-[#999] ml-2">issued ${fmt.date(v.issued_at)}</span>
      </div>
      ${
        v.redeemed
          ? `<span class="text-[11px] text-[#999]">redeemed ${fmt.date(v.redeemed_at)}</span>`
          : `<button onclick="redeemVoucherUI(${v.id})" class="text-xs font-medium text-white bg-[#3F6C3F] hover:bg-[#335933] px-3 py-1 rounded-lg">Redeem</button>`
      }
    </div>`;

  const sub = [
    v.voucher_code
      ? `<span class="font-mono text-[#777]">${escapeHtml(v.voucher_code)}</span>`
      : "",
    v.expires_at
      ? voucherIsExpired(v)
        ? `<span class="text-[#B45309] font-medium">kadaluarsa ${fmt.date(v.expires_at)}</span>`
        : `<span class="text-[#999]">berlaku sampai ${fmt.date(v.expires_at)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join('<span class="text-[#DDD] mx-2">·</span>');

  const actions =
    !v.redeemed && !voucherIsExpired(v)
      ? `<div class="flex flex-wrap gap-2 mt-2">
          <button onclick="vcOpenCard(${v.id})" class="text-xs font-medium text-white bg-[#C8A96B] hover:bg-[#b9985a] px-3 py-1.5 rounded-lg">Download Voucher</button>
          <button onclick="vcOpenCard(${v.id}, 'wa')" class="text-xs font-medium text-[#1FAF5E] border border-[#1FAF5E] hover:bg-[#F2FBF6] px-3 py-1.5 rounded-lg">Kirim WA Follow Up</button>
        </div>`
      : "";

  return `<div class="py-3 border-b border-[#F1EEE8] text-sm ${v.redeemed ? "opacity-60" : ""}">
    ${head}
    ${sub ? `<div class="text-[11px] mt-1">${sub}</div>` : ""}
    ${actions}
  </div>`;
}

// ------------------------------------------------------------
// RECORD SPEND (manual entry from Membership page)
// ------------------------------------------------------------
function openMemberTxn(memberId) {
  currentMemberId = memberId;
  const m = membersCache.find((x) => x.id === memberId);
  if (!m) return;
  const rule = MEMBER_RULES[m.member_type];
  setText("mt-member-label", `${m.member_number} — ${memberReadingName(m)} (${rule.label})`);
  setText("mt-min-hint", `Earns a sticker if ≥ ${fmt.currency(rule.minSpend)}`);
  document.getElementById("mt-amount").value = "";
  document.getElementById("mt-date").value = TODAY;
  document.getElementById("mt-notes").value = "";
  document.getElementById("mt-error").textContent = "";
  hideModal("modal-member-detail");
  showModal("modal-member-txn");
}

// Live thousand separators (id-ID style: 450.000) for amount inputs
function formatAmountInput(el) {
  const digits = (el.value || "").replace(/\D/g, "");
  el.value = digits ? Number(digits).toLocaleString("id-ID") : "";
}

function parseAmountInput(id) {
  const digits = (document.getElementById(id)?.value || "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : NaN;
}

async function saveMemberTxn() {
  const amount = parseAmountInput("mt-amount");
  const date = document.getElementById("mt-date").value;
  const notes = document.getElementById("mt-notes").value.trim() || null;
  const errEl = document.getElementById("mt-error");
  errEl.textContent = "";

  if (isNaN(amount) || amount <= 0) return (errEl.textContent = "Enter a valid amount.");
  if (!date) return (errEl.textContent = "Date is required.");
  if (date > TODAY) return (errEl.textContent = "Date cannot be in the future.");

  loader(true);
  const { data, error } = await supabaseQuery(
    () =>
      db.rpc("add_member_transaction", {
        p_member_id: currentMemberId,
        p_amount: amount,
        p_date: new Date(date + "T12:00:00").toISOString(),
        p_notes: notes,
        p_created_by: currentStaffId(),
      }),
    "Failed to record transaction",
  );
  loader(false);

  if (error) {
    errEl.textContent = "Failed to save. Try again.";
    return;
  }

  hideModal("modal-member-txn");
  announceStickerResult(data);
  loadMembership();
}

function announceStickerResult(r) {
  if (!r) return;
  if (r.skipped) return; // visit already recorded — silent
  if (r.vouchers_issued > 0) {
    toast(`🎉 Dapat stiker DAN voucher baru! Total stiker: ${r.new_total_stickers}`, "success");
  } else if (r.earned_sticker) {
    const capMsg = r.at_sticker_cap ? " — kartu sudah PENUH" : "";
    toast(`🏵 Stiker bertambah! Total: ${r.new_total_stickers}${capMsg}`, "success");
  } else if (r.sticker_reason === "cap_reached") {
    toast("Belanja tercatat, tapi TIDAK dapat stiker — kartu sudah penuh.", "success");
  } else {
    toast("Belanja tercatat. Di bawah minimum — tidak dapat stiker.", "success");
  }
}

// ------------------------------------------------------------
// VOUCHER REDEEM
// ------------------------------------------------------------
async function redeemVoucherUI(voucherId) {
  if (!confirm("Redeem this voucher? This cannot be undone.")) return;
  return doRedeemVoucher(voucherId, false);
}

async function doRedeemVoucher(voucherId, allowExpired) {
  loader(true);
  const { error } = await supabaseQuery(
    () =>
      db.rpc("redeem_member_voucher", {
        p_voucher_id: voucherId,
        p_redeemed_by: currentStaffId(),
        p_allow_expired: !!allowExpired,
      }),
    "Failed to redeem voucher",
  );
  loader(false);

  const msg = error?.message || "";
  if (msg.includes("VOUCHER_EXPIRED")) {
    // Not a hard block: an expired voucher is a service decision, not a
    // data error. Manager/admin may honour it; everyone else is told who
    // to ask, so nobody quietly overrides the rule.
    if (
      typeof isManagerOrAdmin === "function" &&
      isManagerOrAdmin() &&
      confirm(
        "Voucher ini sudah KADALUARSA.\n\nTetap ditukarkan? Tindakan ini tercatat atas nama Anda.",
      )
    ) {
      return doRedeemVoucher(voucherId, true);
    }
    toast(
      "Voucher sudah kadaluarsa — hanya manajer yang bisa tetap menukarkannya.",
      "error",
    );
    return;
  }
  if (error) {
    toast("Could not redeem — it may already be redeemed.", "error");
  } else {
    toast("Voucher redeemed", "success");
  }
  viewMemberDetail(currentMemberId);
  loadMembership();
}

// ============================================================
// CONVERT PAST VISITS INTO STICKERS  (cv*)
//
// Problem this solves: a guest who has been eating here for months
// signs up today, and their history is invisible to the card. Staff
// used to "fix" that with manual Record Spend entries, which have no
// visit_id — so the same meal could be counted twice and nobody could
// tell later which sticker came from where.
//
// The DB does the real work (convert_visits_to_stickers): it revalidates
// every visit, refuses visits belonging to another guest, respects the
// cap, issues vouchers through the same path as a normal visit, and runs
// as ONE transaction. This UI is a preview + a checklist.
//
// Manager/admin only: converting visits mints real vouchers.
// ============================================================
let cvMemberId = null;
let cvMember = null;
let cvVisits = []; // eligible candidates only
let cvIneligibleCount = 0;
let cvSelected = new Set();
let cvBusy = false;

const CV_REASON_LABEL = {
  already_counted: "sudah dihitung",
  not_done: "kunjungan belum selesai",
  voided: "dibatalkan",
  no_spend: "belanja belum diisi",
  below_minimum: "di bawah minimum",
  cap_reached: "kartu sudah penuh",
  other_guest: "bukan kunjungan tamu ini",
};

async function cvOpen(memberId, opts = {}) {
  if (typeof isManagerOrAdmin === "function" && !isManagerOrAdmin()) {
    toast("Hanya manajer yang bisa mengkonversi kunjungan lama.", "error");
    return;
  }
  cvMemberId = memberId;
  cvSelected = new Set();
  cvBusy = false;

  loader(true);
  const [{ data: m }, { data: rows, error }] = await Promise.all([
    supabaseQuery(
      () => db.from("members").select("*").eq("id", memberId).single(),
      "Failed to load member",
    ),
    supabaseQuery(
      () => db.rpc("list_member_backfill_visits", { p_member_id: memberId }),
      "Failed to load past visits",
    ),
  ]);
  loader(false);

  if (error || !m) {
    // Silent when this was the automatic offer after signup — a failure
    // here must never look like the member wasn't created.
    if (!opts.silentIfEmpty) toast("Gagal memuat kunjungan lama.", "error");
    return;
  }

  cvMember = m;
  const all = rows || [];
  cvVisits = all.filter((r) => r.eligible);
  cvIneligibleCount = all.length - cvVisits.length;

  if (!cvVisits.length) {
    if (opts.silentIfEmpty) return; // nothing to offer after signup
    toast(
      all.length
        ? "Tidak ada kunjungan lama yang memenuhi syarat."
        : "Tamu ini belum punya riwayat kunjungan.",
      "success",
    );
    return;
  }

  hideModal("modal-member-detail");
  cvRender();
  showModal("modal-convert-visits");
}

// Offered right after a member is created from an existing guest.
// Opens by itself only when there is something worth converting.
function cvOfferAfterSignup(memberId) {
  if (typeof isManagerOrAdmin === "function" && !isManagerOrAdmin()) return;
  cvOpen(memberId, { silentIfEmpty: true });
}

function cvRule() {
  const rule = MEMBER_RULES[cvMember?.member_type] || MEMBER_RULES.Family;
  return rule;
}

// How many of the checked visits actually turn into stickers, given the
// cap, and how many vouchers that mints. Mirrors the DB maths so the
// front desk sees the consequence BEFORE clicking, not after.
function cvPreview() {
  const rule = cvRule();
  const spv = STICKERS_PER_VOUCHER;
  const before = cvMember?.total_stickers || 0;
  const picked = cvSelected.size;
  const room = rule.cap === null || rule.cap === undefined ? picked : Math.max(0, rule.cap - before);
  const stickers = Math.min(picked, room);
  const after = before + stickers;
  const vouchers = Math.floor(after / spv) - Math.floor(before / spv);
  return { picked, stickers, after, vouchers, capped: picked - stickers, before };
}

function cvRender() {
  const listEl = document.getElementById("cv-list");
  if (!listEl) return;
  const rule = cvRule();

  setText(
    "cv-member-label",
    `${cvMember.member_number} — ${memberReadingName(cvMember)} (${rule.label})`,
  );
  setText(
    "cv-rule",
    `Hanya kunjungan ≥ ${fmt.currency(rule.minSpend)} yang bisa dikonversi · 1 stiker per kunjungan · ${fmt.currency(rule.voucherAmount)} voucher per ${STICKERS_PER_VOUCHER} stiker${rule.cap ? ` · maksimal ${rule.cap} stiker` : ""}`,
  );

  listEl.innerHTML = cvVisits
    .map((v) => {
      const checked = cvSelected.has(v.visit_id);
      return `
      <label class="flex items-center gap-3 py-2.5 px-3 border-b border-[#F1EEE8] last:border-0 cursor-pointer hover:bg-[#FBFAF7]">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="cvToggle('${v.visit_id}', this.checked)" class="w-4 h-4 accent-[#28547C]" />
        <span class="flex-1 min-w-0">
          <span class="block text-sm text-[#333]">${fmt.date(v.visit_date)}${v.visit_time ? ` <span class="text-[#999]">${String(v.visit_time).slice(0, 5)}</span>` : ""}</span>
          <span class="block text-[11px] text-[#999] truncate">${v.pax ? `${v.pax} pax` : ""}${v.notes ? ` · ${escapeHtml(v.notes)}` : ""}</span>
        </span>
        <span class="text-sm font-medium text-[#333] whitespace-nowrap">${fmt.currency(v.spend_amount)}</span>
      </label>`;
    })
    .join("");

  const noteEl = document.getElementById("cv-ineligible-note");
  if (noteEl) {
    noteEl.textContent = cvIneligibleCount
      ? `${cvIneligibleCount} kunjungan lain tidak ditampilkan (sudah dihitung, dibatalkan, atau di bawah minimum).`
      : "";
  }

  cvUpdateSummary();
}

function cvToggle(visitId, checked) {
  if (checked) cvSelected.add(visitId);
  else cvSelected.delete(visitId);
  cvUpdateSummary();
}

function cvSelectAll(select) {
  cvSelected = select ? new Set(cvVisits.map((v) => v.visit_id)) : new Set();
  cvRender();
}

function cvUpdateSummary() {
  const p = cvPreview();
  const rule = cvRule();
  const btn = document.getElementById("cv-save");
  const sum = document.getElementById("cv-summary");
  const warn = document.getElementById("cv-cap-warning");

  if (sum) {
    sum.innerHTML = p.picked
      ? `<span class="font-medium text-[#333]">${p.picked} kunjungan dipilih</span> → <span class="font-medium text-[#8B6F47]">+${p.stickers} stiker</span> (total ${p.after})${p.vouchers > 0 ? ` · <span class="font-semibold text-[#3F6C3F]">${p.vouchers} voucher ${fmt.currency(rule.voucherAmount)} terbit</span>` : ""}`
      : '<span class="text-[#999]">Belum ada kunjungan dipilih.</span>';
  }
  if (warn) {
    warn.classList.toggle("hidden", p.capped <= 0);
    if (p.capped > 0) {
      warn.textContent = `⚠️ ${p.capped} kunjungan tetap tercatat sebagai belanja tapi TIDAK dapat stiker — kartu sudah mencapai batas ${rule.cap}.`;
    }
  }
  if (btn) btn.disabled = p.picked === 0 || cvBusy;
}

async function cvSave() {
  if (cvBusy) return; // double-click guard: this mints vouchers
  if (typeof isManagerOrAdmin === "function" && !isManagerOrAdmin()) {
    toast("Hanya manajer yang bisa mengkonversi kunjungan lama.", "error");
    return;
  }
  const ids = Array.from(cvSelected);
  if (!ids.length) return;

  const p = cvPreview();
  const rule = cvRule();
  const lines = [
    `Konversi ${p.picked} kunjungan lama menjadi ${p.stickers} stiker?`,
    "",
    `Total stiker: ${p.before} → ${p.after}`,
  ];
  if (p.vouchers > 0) {
    lines.push(
      `Voucher terbit LANGSUNG: ${p.vouchers} × ${fmt.currency(rule.voucherAmount)}`,
    );
  }
  lines.push("", "Tindakan ini tidak bisa dibatalkan sendiri.");
  if (!confirm(lines.join("\n"))) return;

  cvBusy = true;
  cvUpdateSummary();
  loader(true);
  const { data, error } = await supabaseQuery(
    () =>
      db.rpc("convert_visits_to_stickers", {
        p_member_id: cvMemberId,
        p_visit_ids: ids,
        p_created_by: currentStaffId(),
      }),
    "Failed to convert visits",
  );
  loader(false);
  cvBusy = false;

  if (error) {
    const msg = error.message || "";
    if (msg.includes("MEMBER_INACTIVE")) toast("Member ini sudah tidak aktif.", "error");
    else if (msg.includes("MEMBER_NOT_LINKED"))
      toast("Member belum terhubung ke profil tamu.", "error");
    else toast("Gagal mengkonversi kunjungan. Coba lagi.", "error");
    cvUpdateSummary();
    return;
  }

  hideModal("modal-convert-visits");
  cvAnnounce(data);
  await loadMembership();
  viewMemberDetail(cvMemberId);
}

function cvAnnounce(r) {
  if (!r) return;
  const skipped = Array.isArray(r.skipped) ? r.skipped : [];
  if (r.vouchers_issued > 0) {
    toast(
      `🎉 ${r.stickers_awarded} stiker ditambahkan dan ${r.vouchers_issued} voucher terbit! Total stiker: ${r.new_total_stickers}`,
      "success",
    );
  } else if (r.stickers_awarded > 0) {
    toast(
      `🏵 ${r.stickers_awarded} stiker ditambahkan dari kunjungan lama. Total: ${r.new_total_stickers}`,
      "success",
    );
  } else {
    toast("Tidak ada stiker yang ditambahkan.", "error");
  }
  // Anything the server refused after the modal was rendered (a colleague
  // voided the visit, someone else counted it first) is reported plainly
  // instead of silently disappearing.
  if (skipped.length) {
    const counts = {};
    skipped.forEach((s) => (counts[s.reason] = (counts[s.reason] || 0) + 1));
    const detail = Object.entries(counts)
      .map(([k, n]) => `${n} ${CV_REASON_LABEL[k] || k}`)
      .join(", ");
    setTimeout(() => toast(`Dilewati: ${detail}.`, "error"), 400);
  }
}

// ------------------------------------------------------------
// AUTO-AWARD FROM VISIT SPEND (called from app.js flows)
// Fires when a visit's spend is saved and the guest is a member.
// Safe to call repeatedly: DB skips if visit already recorded.
// ------------------------------------------------------------
async function maybeAwardMembershipSticker(guestId, spendAmount, visitId) {
  if (!guestId || !spendAmount || spendAmount <= 0) return;
  try {
    const { data: member } = await supabaseQuery(
      () => db.from("members").select("id, member_number, is_active").eq("guest_id", guestId).maybeSingle(),
      "Member lookup failed",
    );
    if (!member || !member.is_active) return;

    const { data } = await supabaseQuery(
      () =>
        db.rpc("add_member_transaction", {
          p_member_id: member.id,
          p_amount: spendAmount,
          p_created_by: currentStaffId(),
          p_visit_id: visitId || null,
          p_notes: "Auto from visit",
        }),
      "Failed to award membership sticker",
    );
    announceStickerResult(data);
  } catch (e) {
    console.error("membership auto-award failed", e);
    // Never block the visit flow because of membership issues.
  }
}
