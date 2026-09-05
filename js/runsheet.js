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
// The Deposit column is a placeholder until the payment work
// lands. It reads from `deposit_required` / `deposit_expected`
// if those columns exist and prints a dash otherwise, so this
// file needs no edit when phase 1 adds them.
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
  // Placeholder until the payment work lands. `deposit_required` does not
  // exist yet, so every row prints a dash today and starts filling itself
  // the moment phase 1 adds the column.
  if (!r || r.deposit_required !== true) return "—";
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

  // NOTE for phase 1: when `deposit_required` and `deposit_expected` are
  // added to reservations, add them to this select and the Deposit column
  // fills itself. They are deliberately NOT requested yet — PostgREST
  // errors on an unknown column, so asking for them today would make every
  // open of this sheet fail once and log an error before recovering.
  const { data, error } = await supabaseQuery(
    () =>
      db
        .from("reservations")
        .select(
          "id, reservation_time, pax, notes, assigned_area, status, guests(name, booking_alias), areas(name), tables(name)",
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
