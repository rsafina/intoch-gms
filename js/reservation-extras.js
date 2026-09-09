// Staff reservation tools. Online overview reads saved rows, not notification state.
let dashboardOnlineView = false;
let dashboardOnlineRequest = 0;
let reservationOnlineOnly = false;

function onlineReservationDays(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (["Cancelled", "Cancelled (No Show)", "No Show", "Deleted", "Completed"].includes(r.status)) continue;
    if (!groups.has(r.reservation_date)) groups.set(r.reservation_date, {date:r.reservation_date,count:0,expectedPax:0,pendingPax:0,waiting:0,incoming:0,latest:null});
    const day = groups.get(r.reservation_date);
    day.count++;
    if (r.status === "Waitlist") { day.waiting++; day.pendingPax += Number(r.pax) || 0; }
    else day.expectedPax += Number(r.pax) || 0;
    if (r.status === "Incoming") day.incoming++;
    if (r.created_at && (!day.latest || r.created_at > day.latest)) day.latest = r.created_at;
  }
  return [...groups.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

async function showDashboardOnlineReservations() {
  dashboardOnlineView = true;
  const request = ++dashboardOnlineRequest;
  // Invalidate any in-flight single-day render before switching the panel.
  ++dashboardReservationRequest;
  updateDashboardReservationTabs();
  const totals = document.getElementById("dashboard-reservation-totals");
  if (totals) totals.innerHTML = "";
  const pagination = document.getElementById("res-pagination-controls");
  if (pagination) pagination.innerHTML = "";
  const list = document.getElementById("dashboard-reservations-list");
  if (!list) return;
  const id = CURRENT_LANG === "id";
  list.innerHTML = `<p class="dash-res-empty">${id ? "Memuat reservasi online..." : "Loading online reservations..."}</p>`;
  const start = getDashboardDate(0), end = getDashboardDate(13);
  // Paginate explicitly: a busy fortnight must not silently hit PostgREST's row cap.
  const rows = [];
  let error = null;
  for (let offset=0; ; offset+=500) {
    const result = await supabaseQuery(() => db.from("reservations")
      .select("id,reservation_date,status,pax,created_at")
      .eq("reservation_source", "Online Form").gte("reservation_date",start).lte("reservation_date",end)
      .order("reservation_date").order("id").range(offset,offset+499), "Failed to load online reservations");
    if (request !== dashboardOnlineRequest || !dashboardOnlineView) return;
    if (result.error || !result.data) { error = result.error || true; break; }
    rows.push(...result.data);
    if (result.data.length < 500) break;
  }
  if (error) {
    list.innerHTML = `<p class="dash-res-empty">${id ? "Reservasi online tidak dapat dimuat." : "Online reservations could not be loaded."}</p><button class="btn-ghost" onclick="showDashboardOnlineReservations()">${id ? "Coba lagi" : "Retry"}</button>`;
    return;
  }
  const days = onlineReservationDays(rows);
  const label = date => new Date(date+"T00:00:00").toLocaleDateString(id ? "id-ID" : "en-GB", {weekday:"short",day:"numeric",month:"short"});
  list.innerHTML = `<div class="online-days-heading"><div><strong>${id ? "Reservasi online" : "Online form reservations"}</strong><p>${label(start)} &ndash; ${label(end)} &middot; ${id ? "Diperbarui" : "Updated"} ${new Date().toLocaleTimeString(id ? "id-ID" : "en-GB",{hour:"2-digit",minute:"2-digit"})}</p></div><button class="btn-ghost" onclick="showDashboardOnlineReservations()">${id ? "Muat ulang" : "Refresh"}</button></div>` +
    (days.length ? days.map(day=>`<button class="online-day" onclick="openOnlineReservationDay('${day.date}')">
      <span><strong>${label(day.date)}</strong><span>${day.count} ${id ? "reservasi online" : "online bookings"} &middot; ${day.expectedPax} ${id ? "pax diharapkan" : "expected pax"}</span>
      ${day.waiting ? `<span class="dash-res-waiting">${day.waiting} ${id ? "menunggu keputusan" : "awaiting decision"} &middot; ${day.pendingPax} ${id ? "pax belum dihitung" : "pax pending"}</span>` : ""}
      ${day.incoming ? `<span>${day.incoming} ${id ? "menunggu deposit" : "awaiting deposit"}</span>` : ""}
      ${day.latest ? `<small>${id ? "Form terbaru" : "Latest submission"}: ${escapeHtml(new Date(day.latest).toLocaleString(id ? "id-ID" : "en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}))}</small>` : ""}</span>
      <span>${id ? "Lihat tanggal" : "View day"} &rarr;</span></button>`).join("") : `<p class="dash-res-empty">${id ? "Tidak ada reservasi online dalam 14 hari ini." : "No upcoming online bookings in these 14 days."}</p>`);
}

function setReservationOnlineOnly(value) {
  reservationOnlineOnly = !!value;
  clearResSearch(true);
  loadReservations();
}

function openOnlineReservationDay(date) {
  clearResSearch(true);
  resSelectedDate = date;
  reservationOnlineOnly = true;
  resStatusFilter = "all";
  const checkbox = document.getElementById("res-online-only");
  if (checkbox) checkbox.checked = true;
  document.querySelectorAll(".status-filter-btn").forEach(btn => {
    btn.className = btn.dataset.status === "all" ? "status-filter-btn btn-primary text-xs px-3 py-1.5" : "status-filter-btn btn-ghost text-xs px-3 py-1.5";
  });
  navigateTo("reservations");
}

let staffDepositEdited = false;
let staffDepositManagedStatus = false;

function staffDepositDefaults(area, pax, maxPax) {
  const large = Number(pax) > Number(maxPax || 20);
  const amount = Number(area?.deposit_amount || 0);
  return {large, enabled:large || amount > 0, amount:large ? null : amount};
}

function updateStaffDepositDefaults(reset = false) {
  const panel = document.getElementById("res-staff-deposit");
  if (!panel) return;
  const editing = !!document.getElementById("res-edit-id")?.value;
  panel.hidden = editing;
  if (editing) return;
  if (reset) { staffDepositEdited = false; staffDepositManagedStatus = false; }
  const area = allAreas.find(a => a.id === document.getElementById("res-area")?.value);
  const defaults = staffDepositDefaults(area, document.getElementById("res-pax")?.value, APP_SETTINGS.reservation_hours?.max_pax);
  const enabled = document.getElementById("res-request-deposit");
  const amount = document.getElementById("res-deposit-amount");
  if (!staffDepositEdited) {
    enabled.checked = defaults.enabled;
    amount.value = defaults.amount > 0 ? Number(defaults.amount).toLocaleString("id-ID") : "";
  }
  amount.disabled = !enabled.checked;
  const status = document.getElementById("res-status");
  if (status) {
    const next = enabled.checked ? (defaults.large ? "Waitlist" : "Incoming") : (staffDepositManagedStatus ? "Reserved" : status.value);
    const changed = status.value !== next;
    status.value = next;
    status.disabled = enabled.checked;
    staffDepositManagedStatus = enabled.checked;
    if (changed && !reset) refreshResTableOccupancy();
  }
  const id = CURRENT_LANG === "id";
  document.getElementById("res-staff-deposit-help").textContent = enabled.checked
    ? (defaults.large
      ? (id ? "Masukkan deposit yang disepakati. Reservasi menunggu hingga deposit lunas. Gunakan invoice lengkap untuk beberapa pembayaran." : "Enter the agreed deposit. The booking stays Waitlist until it is paid. Use the full invoice for multiple payments.")
      : (id ? "Reservasi berstatus Incoming hingga deposit lunas. Jatuh tempo pada waktu reservasi; invoice sederhana digunakan." : "The booking stays Incoming until paid. Deposit is due at the booking time; a simplified invoice is used."))
    : (id ? "Tanpa permintaan deposit. Staf dapat mengaktifkan deposit untuk area mana pun." : "No deposit requested. Staff can enable a deposit for any area.");
}

function onStaffDepositChange() {
  staffDepositEdited = true;
  updateStaffDepositDefaults();
}

function readStaffDeposit() {
  if (document.getElementById("res-edit-id")?.value) return null;
  const enabled = !!document.getElementById("res-request-deposit")?.checked;
  const amount = enabled ? areaParseRupiah(document.getElementById("res-deposit-amount")?.value) : 0;
  if (enabled && (!Number.isFinite(amount) || amount <= 0)) {
    toast(CURRENT_LANG === "id" ? "Masukkan jumlah deposit yang valid" : "Enter a valid deposit amount", "error");
    return false;
  }
  const large = Number(document.getElementById("res-pax")?.value) > Number(APP_SETTINGS.reservation_hours?.max_pax || 20);
  const date = document.getElementById("res-date")?.value;
  const time = document.getElementById("res-time")?.value;
  const due = enabled && !large ? new Date(`${date}T${time}+07:00`) : null;
  if (due && !Number.isFinite(due.getTime())) {
    toast("Date and time are required", "error");
    return false;
  }
  return {
    is_large_party:large, deposit_required:enabled, deposit_expected:enabled ? amount : null,
    deposit_due_at:due ? due.toISOString() : null,
    ...(enabled ? {status:large ? "Waitlist" : "Incoming"} : {}),
  };
}

let reservationTicketContext = null;
function reservationTicketButton(res) {
  return res.status === "Reserved"
    ? `<button type="button" class="btn-ghost text-xs" onclick="issueReservationTicket('${res.id}')">${CURRENT_LANG === "id" ? "Terbitkan tiket" : "Issue ticket"}</button>` : "";
}

async function issueReservationTicket(resId) {
  const {data,error} = await supabaseQuery(() => db.rpc("issue_reservation_ticket",{p_reservation_id:resId}),"Failed to issue confirmation ticket");
  if (error || !data?.ok) {
    if (!error) toast(data?.message || "Could not issue ticket", "error");
    return;
  }
  const link = new URL("reservation-ticket.html?t="+encodeURIComponent(data.token),window.location.href).href;
  const result = await supabaseQuery(() => db.from("reservations").select("booking_name,reservation_date,reservation_time,pax,guests(name,phone)").eq("id",resId).single(),"Failed to load ticket details");
  if (result.error || !result.data) return;
  const res = result.data;
  const message = `Halo Bapak/Ibu ${res.booking_name || res.guests?.name || ""}, reservasi Anda di ${restaurantName()} telah dikonfirmasi untuk ${res.reservation_date}, pukul ${String(res.reservation_time).slice(0,5)}, ${res.pax} orang. Silakan lihat dan unduh tiket konfirmasi Anda di sini: ${link}`;
  reservationTicketContext = {link,message,phone:res.guests?.phone};
  const content = document.getElementById("reservation-ticket-content");
  const id = CURRENT_LANG === "id";
  content.innerHTML = `<p class="text-sm mb-4">${id ? "Tiket konfirmasi siap dibagikan. Tamu dapat mengunduhnya dari tautan ini." : "Your confirmation ticket is ready to share. Guests can download it from this link."}</p>
    <a class="btn-primary mb-3" href="${escapeHtml(link)}" target="_blank" rel="noopener">${id ? "Pratinjau tiket" : "Preview ticket"}</a>
    <input class="form-input mb-3" readonly aria-label="Ticket link" value="${escapeHtml(link)}" onclick="this.select()" />
    <div class="flex flex-wrap gap-2"><button class="btn-ghost" onclick="copyReservationTicketLink()">${id ? "Salin tautan" : "Copy link"}</button>
    ${res.guests?.phone ? `<button class="btn-primary" onclick="sendReservationTicket()">WhatsApp</button>` : ""}</div>
    <p class="text-xs text-[#687380] mt-4">${escapeHtml(message)}</p>`;
  showModal("modal-reservation-ticket");
}
async function copyReservationTicketLink() {
  if (!reservationTicketContext) return;
  try { await navigator.clipboard.writeText(reservationTicketContext.link); toast(CURRENT_LANG === "id" ? "Tautan disalin" : "Link copied"); }
  catch (_) { toast("Select and copy the ticket link above", "error"); }
}
function sendReservationTicket() {
  if (reservationTicketContext?.phone) waOpenChat(reservationTicketContext.phone,reservationTicketContext.message);
}
