// ============================================================
// DAY RUN SHEET
// ------------------------------------------------------------
// The paper that replaces the Google Calendar entry and the
// printed Excel sheet. Security reads it at the gate to know
// who is arriving; the greeter reads it to know where to walk
// them. Decisions taken with Rere, 2026-09-04, recorded in
// RESERVATION_DEPOSIT_SCOPE.md section 13.
//
//   • Ordered by TIME, with an area summary block at the top.
//     One sheet serves the gate and the floor.
//   • Follows the app language.
//   • Columns: time, name, pax, area, table when assigned,
//     notes, deposit.
//   • NO phone number and no vehicle plate. This sheet is
//     printed and circulates around the property.
//
// Why the status list is not written here: `RES_OCCUPANCY_STATUSES`
// in app.js is already the app's definition of "still expected",
// and a second list would be a fourth place that can disagree
// about who is coming. Note it did NOT contain "Confirmed"
// before this change; see the comment on that constant.
//
// Deposit state comes from the payment balance view, just like
// the reservation list, and is fetched fresh when opening the sheet.
// ============================================================

const RUN_SHEET_ROOT_ID = "run-sheet-root";

// Rupiah with no decimals, matching the invoice generator's habit.
function runSheetRupiah(n) {
  if (n === null || n === undefined || n === "") return "";
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  return "Rp " + Math.round(num).toLocaleString("id-ID");
}

function runSheetEscape(s) {
  return String(s === null || s === undefined ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// Long free-text notes are what make a printed row wrap into three
// lines and push the day onto a second page. Truncate for the sheet
// only; the full note stays on the reservation.
const RUN_SHEET_NOTE_MAX = 70;
function runSheetNote(s) {
  const txt = String(s || "").trim().replace(/\s+/g, " ");
  if (txt.length <= RUN_SHEET_NOTE_MAX) return txt;
  return txt.slice(0, RUN_SHEET_NOTE_MAX - 1) + "…";
}

function runSheetDateLabel(ymd) {
  // Same construction as loadReservations(): the "T00:00:00" suffix keeps
  // the date in local time. Parsing a bare "YYYY-MM-DD" is treated as UTC
  // and lands on the previous day for everyone east of Greenwich, which
  // is every client this product has.
  return new Date(ymd + "T00:00:00").toLocaleDateString(
    CURRENT_LANG === "id" ? "id-ID" : "en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );
}

// Built from allAreas rather than from the hardcoded "Indoor Dining" /
// "Outdoor Dining" helpers in app.js, which only work for one client's
// area names. Any restaurant's areas come out right here.
function runSheetAreaSummary(rows) {
  const byArea = {};
  let unplacedCount = 0;
  let unplacedPax = 0;

  rows.forEach((r) => {
    const pax = Number(r.pax) || 0;
    if (!r.assigned_area) {
      unplacedCount += 1;
      unplacedPax += pax;
      return;
    }
    if (!byArea[r.assigned_area]) byArea[r.assigned_area] = { count: 0, pax: 0 };
    byArea[r.assigned_area].count += 1;
    byArea[r.assigned_area].pax += pax;
  });

  // Areas with no bookings today are omitted rather than printed as zero:
  // the summary is a picture of the day, not an inventory of the venue.
  const cells = (allAreas || [])
    .filter((a) => byArea[a.id])
    .map((a) => {
      const s = byArea[a.id];
      return `<div class="rs-sum-cell">
        <span class="rs-sum-area">${runSheetEscape(a.name)}</span>
        <span class="rs-sum-figs">${s.pax} ${t("pax")} · ${s.count}</span>
      </div>`;
    });

  if (unplacedCount) {
    cells.push(`<div class="rs-sum-cell rs-sum-unplaced">
      <span class="rs-sum-area">${t("Not yet placed")}</span>
      <span class="rs-sum-figs">${unplacedPax} ${t("pax")} · ${unplacedCount}</span>
    </div>`);
  }

  return cells.join("");
}

function runSheetDepositCell(r) {
  if (!r || r.deposit_required !== true) return "—";
  const bal = r.deposit_balance;
  if (bal && bal.state === "none") return "—";
  if (bal && bal.state === "paid") return t("Deposit paid");
  if (bal) {
    const owed = t("Owed") + " " + runSheetRupiah(bal.outstanding);
    return bal.state === "partial" ? t("Part paid") + " · " + owed : owed;
  }
  const amount = runSheetRupiah(r.deposit_expected);
  return amount ? `${t("DP")} ${amount}` : t("DP");
}

function runSheetRow(r) {
  const name = r.guests ? formatGuestName(r.guests) : "—";
  const area =
    (r.areas && r.areas.name) ||
    (r.assigned_area ? "—" : `<span class="rs-muted">${t("Not yet placed")}</span>`);
  const table = (r.tables && r.tables.name) || "";
  return `<tr>
    <td class="rs-time">${runSheetEscape(String(r.reservation_time || "").slice(0, 5))}</td>
    <td class="rs-name">${runSheetEscape(name)}</td>
    <td class="rs-num">${runSheetEscape(r.pax)}</td>
    <td>${typeof area === "string" && area.startsWith("<") ? area : runSheetEscape(area)}</td>
    <td>${runSheetEscape(table)}</td>
    <td class="rs-notes">${runSheetEscape(runSheetNote(r.notes))}</td>
    <td class="rs-dep">${runSheetEscape(runSheetDepositCell(r))}</td>
  </tr>`;
}

async function openRunSheet() {
  const date = resSelectedDate || TODAY;

  if (!allAreas || !allAreas.length) await loadAreas();

  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select(
          "id, reservation_time, pax, notes, assigned_area, status, deposit_required, deposit_expected, guests(name, booking_alias), areas(name), tables(name)",
        )
        .eq("reservation_date", date)
        .in("status", RES_OCCUPANCY_STATUSES)
        .order("reservation_time"),
    "Failed to load the run sheet",
  );
  if (error) {
    toast(t("Could not load the run sheet."), "error");
    return;
  }
  const rows = data || [];
  const depositIds = rows.filter((r) => r.deposit_required).map((r) => r.id);
  if (depositIds.length) {
    const { data: balances, error: balanceError } = await supabaseQuery(
      () => db.from("reservation_deposit_balances")
        .select("reservation_id, outstanding, state")
        .in("reservation_id", depositIds),
      "Failed to load deposit balances",
    );
    // Keep balances local so opening the sheet cannot overwrite dashboard badges.
    if (!balanceError) {
      const byId = new Map((balances || []).map((b) => [b.reservation_id, b]));
      rows.forEach((r) => { r.deposit_balance = byId.get(r.id); });
    }
  }

  const root = document.getElementById(RUN_SHEET_ROOT_ID);
  if (!root) return;

  const totalPax = rows.reduce((sum, r) => sum + (Number(r.pax) || 0), 0);
  const summaryHtml = runSheetAreaSummary(rows);

  // An empty day still prints a usable sheet. A blank page tells the
  // person holding it nothing, not even which day they are holding.
  const body = rows.length
    ? `<table class="rs-table">
        <thead>
          <tr>
            <th class="rs-time">${t("Time")}</th>
            <th>${t("Name")}</th>
            <th class="rs-num">${t("Pax")}</th>
            <th>${t("Area")}</th>
            <th>${t("Table")}</th>
            <th class="rs-notes">${t("Notes")}</th>
            <th class="rs-dep">${t("Deposit")}</th>
          </tr>
        </thead>
        <tbody>${rows.map(runSheetRow).join("")}</tbody>
      </table>`
    : `<p class="rs-empty">${t("No bookings for this day.")}</p>`;

  root.innerHTML = `
    <div class="rs-toolbar">
      <button onclick="closeRunSheet()" class="btn-ghost">${t("Close")}</button>
      <button onclick="printRunSheet()" class="btn-primary">${t("Print")}</button>
    </div>
    <div class="rs-paper">
      <div class="rs-head">
        <div>
          <p class="rs-brand">${runSheetEscape(restaurantName())}</p>
          <p class="rs-title">${t("Day Run Sheet")}</p>
        </div>
        <div class="rs-head-right">
          <p class="rs-date">${runSheetEscape(runSheetDateLabel(date))}</p>
          <p class="rs-count">${rows.length} ${t("reservations")} · ${totalPax} ${t("pax")}</p>
        </div>
      </div>
      ${summaryHtml ? `<div class="rs-summary">${summaryHtml}</div>` : ""}
      ${body}
      <p class="rs-foot">${t("Printed")} ${runSheetEscape(new Date().toLocaleString(CURRENT_LANG === "id" ? "id-ID" : "en-GB"))}</p>
    </div>
  `;

  root.classList.remove("hidden");
  document.body.classList.add("run-sheet-open");
}

function closeRunSheet() {
  const root = document.getElementById(RUN_SHEET_ROOT_ID);
  if (root) root.classList.add("hidden");
  document.body.classList.remove("run-sheet-open");
}

function printRunSheet() {
  window.print();
}
