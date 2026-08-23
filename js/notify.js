// ============================================================
// ONLINE RESERVATION NOTIFICATIONS (bell + toast + gong)
// Shows ONLY reservations created via the public form
// (reservation_source = 'Online Form'). Staff-created ones stay
// silent — no noise about their own actions.
//
// SOURCE OF TRUTH: the reservations table itself, not a per-browser
// cache. The bell is a live DB query, refetched on load, on opening
// the panel, on a background poll, and on realtime INSERT/UPDATE.
// Realtime only makes the badge feel instant while a tab is open; if
// it's missed (no tab open when the booking lands, a dropped socket,
// a reload window), the next refetch — even from a different PC —
// still finds it, because it lives in the database.
//
// THE BELL ANSWERS THREE SEPARATE QUESTIONS, in this order:
//
//   1. PERLU FOLLOW UP (red badge)
//      An online booking nobody has contacted yet. Fires the moment
//      the form is submitted, and keeps firing — any date, past or
//      future — until someone ticks "Sudah di-follow up". Survives
//      the PC being off overnight because it is a DB state, not an
//      event someone had to be awake to catch.
//
//   2. AKAN DATANG (amber badge)
//      A booking already followed up, now near its date. Reappears
//      from opening time on D-1, and again on D-day. This is not a
//      re-do of the follow-up, it is "call and confirm they are still
//      coming", so it clears with a lighter "Sudah dicek" mark, and
//      D-1 and D-day are acknowledged INDEPENDENTLY — confirming
//      yesterday does not silence today.
//
//   3. Everything else stays out of the panel entirely, so the list
//      is always "things needing a hand right now", never an archive.
//
// ---- BUG HISTORY (read before "simplifying" any filter here) -------
// 2026-08-15: bell was realtime-only + localStorage keyed by calendar
//   day. A booking with no tab listening left no trace anywhere — not
//   a missed alert, an alert that never existed. Two same-day bookings
//   got zero follow-up. Fixed by moving state into the DB.
// 2026-08-15 fix still filtered reservation_date = today, assuming
//   online bookings are same-day. reserve.html allows 90 days out, so
//   every future booking was permanently invisible. Bookings for
//   22 Aug, 23 Aug and 2 Sep produced zero notification. Fixed by
//   dropping the date filter.
// 2026-08-21: the "new booking" gong was gated on _resNotifySeenIds
//   being non-empty, used as a proxy for "not the first load". On a
//   quiet morning with no pending bookings the set stayed empty, so
//   the FIRST online booking of the day rang nothing — exactly the
//   shift where nobody is watching the screen. Fixed with an explicit
//   _resNotifyPrimed flag. Never go back to using set size for this.
// ============================================================

const RES_NOTIFY_MAX = 80; // pending-list cap
const RES_NOTIFY_POLL_MS = 3 * 60 * 1000; // background catch-up poll
const RES_NOTIFY_DEFAULT_OPEN = "10:00"; // fallback if app_settings hasn't loaded yet

let _resNotifyStarted = false;
let _resNotifyItems = []; // in-memory, refreshed from the DB
let _resNotifyPrimed = false; // has a first successful fetch completed?
let _resNotifySeenPending = new Set(); // booking ids already chimed for
let _resNotifySeenIncoming = new Set(); // "<id>:<date>" reminder slots already toasted
let _resNotifyLive = false; // realtime channel state, for the bell tooltip

// ---- local calendar helpers ------------------------------------
// Deliberately NOT toISOString().slice(0,10) — that is UTC, and at
// 07:00+ Jakarta it silently reports the wrong day. Front desk PCs
// run in Asia/Jakarta, so the browser's local date is the right one.
function _resNotifyYmd(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function _resNotifyToday() {
  return _resNotifyYmd(new Date());
}

function _resNotifyTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return _resNotifyYmd(d);
}

// Opening time drives when the D-1 reminder starts. Read fresh each
// time so a manager changing it in Settings takes effect without a
// reload, and so a not-yet-loaded APP_SETTINGS just falls back.
function _resNotifyOpenMinutes() {
  let raw = RES_NOTIFY_DEFAULT_OPEN;
  try {
    const v =
      typeof APP_SETTINGS !== "undefined" &&
      APP_SETTINGS &&
      APP_SETTINGS.reservation_hours &&
      APP_SETTINGS.reservation_hours.open;
    if (v) raw = v;
  } catch (_) {
    /* fall back */
  }
  const parts = String(raw).split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (Number.isFinite(h) ? h : 10) * 60 + (Number.isFinite(m) ? m : 0);
}

// Which reminder slot, if any, is this booking sitting in right now?
// Returns "dday" | "d1" | null. Independent of whether it's acked —
// callers combine this with the ack columns.
function _resNotifySlot(dateStr) {
  if (dateStr === _resNotifyToday()) return "dday";
  if (dateStr === _resNotifyTomorrow()) {
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() >= _resNotifyOpenMinutes()) return "d1";
  }
  return null;
}

// pending  → nobody has followed up yet (red, highest priority)
// incoming → followed up, now in an unacknowledged reminder slot (amber)
// quiet    → nothing to do; hidden from the panel
function _resNotifyClassify(it) {
  if (!it.done) return "pending";
  const slot = _resNotifySlot(it.date);
  if (slot === "dday" && !it.ddayAck) return "incoming";
  if (slot === "d1" && !it.d1Ack) return "incoming";
  return "quiet";
}

// Held so logout can remove it. See the long note on _rtTodayChannel in
// app.js: re-subscribing a channel that is already open throws, and that
// throw used to take the whole bell down.
let _resNotifyChannel = null;

function teardownOnlineResNotify() {
  if (_resNotifyPollTimer) {
    clearInterval(_resNotifyPollTimer);
    _resNotifyPollTimer = null;
  }
  if (_resNotifyChannel) {
    try {
      db.removeChannel(_resNotifyChannel);
    } catch (e) {
      console.warn("[res-notify] teardown failed", e);
    }
    _resNotifyChannel = null;
  }
  // Reset the "already seen" set too. After a logout the next person at this
  // PC is a different shift: a booking they have never looked at must chime
  // for them, not be silently treated as old news.
  _resNotifySeenPending = new Set();
  _resNotifyPrimed = false;
  _resNotifyLive = false;
  // setupOnlineResNotify() refuses to run twice via this flag. Clearing it is
  // what lets the bell come back for the next person to log in; leaving it set
  // would trade a crash for a permanently silent bell, which is worse because
  // nothing on screen would say anything is wrong.
  _resNotifyStarted = false;
}

async function _resNotifyFetch() {
  const today = _resNotifyToday();

  const { data, error } = await db
    .from("reservations")
    .select(
      "id, reservation_date, reservation_time, pax, booking_name, follow_up_done, follow_up_done_at, follow_up_done_by, reminder_d1_ack_at, reminder_dday_ack_at, guests(name)",
    )
    .eq("reservation_source", "Online Form")
    .is("deleted_at", null)
    .in("status", ["Reserved", "Confirmed"])
    // Still-unhandled bookings of ANY date, plus anything dated today
    // or later (those can still enter a reminder slot). Past bookings
    // already followed up are done with — excluding them keeps old
    // rows from eating the row cap and burying a genuinely new one.
    .or("follow_up_done.eq.false,reservation_date.gte." + today)
    .order("reservation_date", { ascending: true })
    .order("reservation_time", { ascending: true })
    .limit(RES_NOTIFY_MAX);

  if (error) {
    console.error("[res-notify] fetch failed:", error);
    return null;
  }

  return data.map((row) => ({
    id: row.id,
    // booking_name is what the guest typed into the public form.
    // guests.name can be an older stored name (the RPC reuses guests
    // by phone and never renames), sometimes carrying the date-in-name
    // junk staff type at the front desk. Prefer the booker's own words.
    name: row.booking_name || row.guests?.name || "Tamu",
    date: row.reservation_date,
    time: String(row.reservation_time || "").slice(0, 5),
    pax: row.pax || 1,
    done: !!row.follow_up_done,
    doneAt: row.follow_up_done_at || null,
    doneBy: row.follow_up_done_by || null,
    d1Ack: !!row.reminder_d1_ack_at,
    ddayAck: !!row.reminder_dday_ack_at,
  }));
}

// Staff id -> display name, for the "handled by" line.
//
// Fetched separately rather than embedded in the reservations select
// (`staff_users!reservations_follow_up_done_by_fkey(display_name)`), because
// an embed depends on the foreign key having exactly the name PostgREST
// expects. This schema has now produced three columns that existed in the
// code and in no migration, so a hand-built client database is not something
// to bet a working notification bell on. A handful of staff rows, cached for
// the session, costs one query and cannot 400 the whole panel.
let _resNotifyStaffNames = null;

async function _resNotifyLoadStaffNames() {
  if (_resNotifyStaffNames) return _resNotifyStaffNames;
  try {
    const { data, error } = await db
      .from("staff_users")
      .select("id, display_name");
    if (error) throw error;
    _resNotifyStaffNames = Object.fromEntries(
      (data || []).map((r) => [r.id, r.display_name]),
    );
  } catch (e) {
    console.warn("[res-notify] staff names unavailable", e);
    _resNotifyStaffNames = {}; // rows just say "handled" with no name
  }
  return _resNotifyStaffNames;
}

async function _resNotifyRefresh({ chimeNew = false } = {}) {
  const items = await _resNotifyFetch();
  if (!items) return; // network hiccup — keep the last-known list rather than blanking it
  // Not awaited before the counts below: the badge must not wait on a
  // cosmetic lookup. It resolves before the panel is opened in practice, and
  // a row with no name still reads correctly.
  _resNotifyLoadStaffNames();

  const pending = items.filter((it) => _resNotifyClassify(it) === "pending");
  const incoming = items.filter((it) => _resNotifyClassify(it) === "incoming");

  if (chimeNew && _resNotifyPrimed) {
    // A brand new online booking: gong + toast. This is the one that
    // must never be missed, so it gets the loud treatment.
    const freshPending = pending.filter((it) => !_resNotifySeenPending.has(it.id));
    if (freshPending.length) {
      freshPending.forEach((it) => {
        if (typeof toast === "function") {
          toast(
            "Reservasi online baru: " +
              it.name +
              " · " +
              _resNotifyFmtDate(it.date) +
              " " +
              it.time +
              " (" +
              it.pax +
              " pax)",
          );
        }
      });
      _resNotifyChime();
    }

    // A reminder slot opening is a nudge, not news — toast only, no
    // gong. At opening time several D-1 reminders can land at once
    // and a burst of gongs in a quiet dining room is worse than useless.
    const freshIncoming = incoming.filter(
      (it) => !_resNotifySeenIncoming.has(it.id + ":" + it.date),
    );
    freshIncoming.forEach((it) => {
      if (typeof toast === "function") {
        const when = it.date === _resNotifyToday() ? "hari ini" : "besok";
        toast("Cek kehadiran " + when + ": " + it.name + " · " + it.time + " (" + it.pax + " pax)");
      }
    });
  }

  pending.forEach((it) => _resNotifySeenPending.add(it.id));
  incoming.forEach((it) => _resNotifySeenIncoming.add(it.id + ":" + it.date));
  _resNotifyPrimed = true;

  _resNotifyItems = items;
  _resNotifyRenderBadge();
  const panel = document.getElementById("res-alert-panel");
  if (panel && !panel.classList.contains("hidden")) _resNotifyRenderList();
}

function _resNotifyCounts() {
  let pending = 0;
  let incoming = 0;
  _resNotifyItems.forEach((it) => {
    const c = _resNotifyClassify(it);
    if (c === "pending") pending++;
    else if (c === "incoming") incoming++;
  });
  return { pending, incoming };
}

function _resNotifyRenderBadge() {
  const { pending, incoming } = _resNotifyCounts();

  const badge = document.getElementById("res-alert-badge");
  if (badge) {
    if (pending > 0) {
      badge.textContent = pending > 9 ? "9+" : String(pending);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  const badge2 = document.getElementById("res-alert-badge-2");
  if (badge2) {
    if (incoming > 0) {
      badge2.textContent = incoming > 9 ? "9+" : String(incoming);
      badge2.classList.remove("hidden");
    } else {
      badge2.classList.add("hidden");
    }
  }

  const bell = document.getElementById("res-alert-bell");
  if (bell) {
    const parts = [];
    if (pending) parts.push(pending + " perlu follow up");
    if (incoming) parts.push(incoming + " cek kehadiran");
    bell.title =
      (parts.length ? parts.join(" · ") : "Reservasi online") +
      (_resNotifyLive
        ? " (langsung terhubung)"
        : " (koneksi langsung terputus — daftar tetap diperbarui berkala)");
  }
}

// "Sudah ditangani": the third section (2026-08-23, Rere). A booking used to
// vanish from this panel the moment it was ticked, which meant nobody could
// see what the previous shift had already dealt with, and a mis-tick was
// invisible and unrecoverable from here.
//
// Scoped to today and later on purpose. The fetch already filters to that,
// and the panel has a row cap: letting last month's handled bookings in would
// push a genuinely new one off the bottom, which is the one failure this
// whole bell exists to prevent.
function _resNotifyHandledRow(it) {
  const who = it.doneBy && _resNotifyStaffNames ? _resNotifyStaffNames[it.doneBy] : null;
  const when = it.doneAt
    ? new Date(it.doneAt).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const by = [who, when].filter(Boolean).join(" · ");
  return `
      <div class="py-2 border-b border-[#F0EDE7] last:border-0 opacity-60">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-medium text-[#333] truncate">${escapeHtml(it.name || "Tamu")}</p>
            <p class="text-xs text-[#999]">${_resNotifyFmtDate(it.date)} · ${escapeHtml(it.time)} · ${it.pax} pax</p>
          </div>
          <span class="text-[10px] font-semibold text-[#1FAF5E] whitespace-nowrap">SUDAH</span>
        </div>
        <p class="text-[10px] text-[#aaa] mt-0.5">${by ? "Ditangani " + escapeHtml(by) : "Sudah ditangani"}</p>
        <button onclick="resNotifyToggleDone('${it.id}')" class="text-[11px] text-[#999] hover:underline mt-0.5">Batalkan</button>
      </div>`;
}

// Collapsed by default and remembered per browser. Open by default would push
// the two sections that need action below the fold on a busy day.
let _resNotifyHandledOpen = false;
try {
  _resNotifyHandledOpen = localStorage.getItem("resNotifyHandledOpen") === "1";
} catch (_) {}

function resNotifyToggleHandled() {
  _resNotifyHandledOpen = !_resNotifyHandledOpen;
  try {
    localStorage.setItem("resNotifyHandledOpen", _resNotifyHandledOpen ? "1" : "0");
  } catch (_) {}
  _resNotifyRenderList();
}

function _resNotifyRow(it, kind) {
  const label =
    kind === "pending"
      ? '<label class="flex items-center gap-1.5 mt-1 cursor-pointer text-xs text-[#888]">' +
        `<input type="checkbox" onchange="resNotifyToggleDone('${it.id}')" />` +
        "Sudah di-follow up</label>"
      : '<label class="flex items-center gap-1.5 mt-1 cursor-pointer text-xs text-[#888]">' +
        `<input type="checkbox" onchange="resNotifyAckReminder('${it.id}')" />` +
        "Sudah dicek</label>";

  const tag =
    kind === "incoming"
      ? it.date === _resNotifyToday()
        ? '<span class="text-[10px] font-semibold text-[#B7791F]">HARI INI</span>'
        : '<span class="text-[10px] font-semibold text-[#B7791F]">BESOK</span>'
      : "";

  return `
      <div class="py-2 border-b border-[#F0EDE7] last:border-0">
        <p class="text-sm font-medium text-[#333]">${escapeHtml(it.name || "Tamu")} ${tag}</p>
        <p class="text-xs text-[#999]">${_resNotifyFmtDate(it.date)} · ${escapeHtml(it.time)} · ${it.pax} pax</p>
        ${label}
      </div>`;
}

function _resNotifyRenderList() {
  const list = document.getElementById("res-alert-list");
  if (!list) return;

  const pending = _resNotifyItems.filter((it) => _resNotifyClassify(it) === "pending");
  const incoming = _resNotifyItems.filter((it) => _resNotifyClassify(it) === "incoming");
  const handled = _resNotifyItems.filter((it) => _resNotifyClassify(it) === "quiet");

  if (!pending.length && !incoming.length && !handled.length) {
    list.innerHTML =
      '<p class="text-xs text-[#bbb] text-center py-4">Belum ada reservasi online</p>';
    return;
  }

  let html = "";

  if (!pending.length && !incoming.length) {
    html +=
      '<p class="text-xs text-[#1FAF5E] text-center py-3">Semua reservasi online sudah ditangani ✓</p>';
  }

  if (pending.length) {
    html +=
      '<p class="text-[11px] font-semibold text-[#C0392B] mb-1">Perlu follow up (' +
      pending.length +
      ")</p>" +
      pending.map((it) => _resNotifyRow(it, "pending")).join("");
  }

  if (incoming.length) {
    html +=
      '<p class="text-[11px] font-semibold text-[#B7791F] mb-1 ' +
      (pending.length ? "mt-3 pt-3 border-t border-[#EDE9E3]" : "") +
      '">Cek kehadiran (' +
      incoming.length +
      ")</p>" +
      '<p class="text-[10px] text-[#999] mb-1 leading-snug">Hubungi tamu, pastikan jadi datang.</p>' +
      incoming.map((it) => _resNotifyRow(it, "incoming")).join("");
  }

  if (handled.length) {
    html +=
      '<button onclick="resNotifyToggleHandled()" class="w-full flex items-center justify-between text-left text-[11px] font-semibold text-[#777] ' +
      (pending.length || incoming.length ? "mt-3 pt-3 border-t border-[#EDE9E3]" : "") +
      '"><span>Sudah ditangani (' +
      handled.length +
      ")</span><span>" +
      (_resNotifyHandledOpen ? "&#9652;" : "&#9662;") +
      "</span></button>";
    if (_resNotifyHandledOpen) {
      html += handled.map((it) => _resNotifyHandledRow(it)).join("");
    }
  }

  list.innerHTML = html;
}

function _resNotifyFmtDate(iso) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch (_) {
    return iso;
  }
}

async function resNotifyToggleDone(id) {
  const item = _resNotifyItems.find((it) => it.id === id);
  if (!item) return;
  const newDone = !item.done;

  const nowIso = new Date().toISOString();
  const staff = typeof currentStaffId === "function" ? currentStaffId() : null;
  const payload = {
    follow_up_done: newDone,
    follow_up_done_at: newDone ? nowIso : null,
    follow_up_done_by: newDone ? staff : null,
  };

  // Guardrail: if the booking is ALREADY inside a reminder slot when
  // staff tick the follow-up (e.g. an online booking for tonight that
  // came in this morning), stamp that slot too. Otherwise the row would
  // jump straight from "perlu follow up" to "cek kehadiran" in the same
  // click and read as if the tick did nothing.
  const slot = newDone ? _resNotifySlot(item.date) : null;
  if (slot === "dday") {
    payload.reminder_dday_ack_at = nowIso;
    payload.reminder_dday_ack_by = staff;
  } else if (slot === "d1") {
    payload.reminder_d1_ack_at = nowIso;
    payload.reminder_d1_ack_by = staff;
  }

  // optimistic UI — this is a manual staff click, don't make them wait
  const prev = { done: item.done, d1Ack: item.d1Ack, ddayAck: item.ddayAck };
  item.done = newDone;
  if (slot === "dday") item.ddayAck = true;
  if (slot === "d1") item.d1Ack = true;
  _resNotifyRenderList();
  _resNotifyRenderBadge();

  const { error } = await db.from("reservations").update(payload).eq("id", id);

  if (error) {
    console.error("[res-notify] toggle failed:", error);
    item.done = prev.done;
    item.d1Ack = prev.d1Ack;
    item.ddayAck = prev.ddayAck;
    _resNotifyRenderList();
    _resNotifyRenderBadge();
    if (typeof toast === "function") toast("Gagal menyimpan status follow up. Coba lagi.");
  }
}

// "Mark as read" for the attendance reminder. Deliberately one-way:
// D-1 and D-day are separate columns, so acknowledging tomorrow's
// reminder leaves the day-of reminder to fire on its own.
async function resNotifyAckReminder(id) {
  const item = _resNotifyItems.find((it) => it.id === id);
  if (!item) return;
  const slot = _resNotifySlot(item.date);
  if (!slot) return; // slot closed between render and click — next refresh sorts it out

  const nowIso = new Date().toISOString();
  const staff = typeof currentStaffId === "function" ? currentStaffId() : null;
  const payload =
    slot === "dday"
      ? { reminder_dday_ack_at: nowIso, reminder_dday_ack_by: staff }
      : { reminder_d1_ack_at: nowIso, reminder_d1_ack_by: staff };

  const prev = { d1Ack: item.d1Ack, ddayAck: item.ddayAck };
  if (slot === "dday") item.ddayAck = true;
  else item.d1Ack = true;
  _resNotifyRenderList();
  _resNotifyRenderBadge();

  const { error } = await db.from("reservations").update(payload).eq("id", id);

  if (error) {
    console.error("[res-notify] reminder ack failed:", error);
    item.d1Ack = prev.d1Ack;
    item.ddayAck = prev.ddayAck;
    _resNotifyRenderList();
    _resNotifyRenderBadge();
    if (typeof toast === "function") toast("Gagal menyimpan tanda dicek. Coba lagi.");
  }
}

// "Gong" via WebAudio (no audio file needed): a strike transient plus
// layered low partials with a long ring-out. Browsers only allow sound
// after the user has interacted with the page — staff always click to
// log in, so this works in practice. Fails silently if blocked.
const RES_NOTIFY_VOLUME = 0.5; // 0..1 — turn this down if the gong annoys guests
let _resNotifyAudioCtx = null;
function _resNotifyChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_resNotifyAudioCtx) _resNotifyAudioCtx = new Ctx();
    const ctx = _resNotifyAudioCtx;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
      if (ctx.state === "suspended") return;
    }
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = RES_NOTIFY_VOLUME;
    master.connect(ctx.destination);

    // strike: short noise burst for the mallet hit
    const strikeLen = 0.06;
    const buf = ctx.createBuffer(1, ctx.sampleRate * strikeLen, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + strikeLen);
    noise.connect(noiseGain).connect(master);
    noise.start(now);

    // body: detuned low partials with slow decay = gong ring
    const partials = [
      [98, 1.0, 2.8],
      [147, 0.55, 2.2],
      [196, 0.4, 1.8],
      [261, 0.25, 1.4],
      [392, 0.15, 1.0],
    ];
    partials.forEach(([freq, amp, dur]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 1.02, now);
      osc.frequency.exponentialRampToValueAtTime(freq, now + 0.3);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(amp * 0.5, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(master);
      osc.start(now);
      osc.stop(now + dur + 0.1);
    });
  } catch (_) {
    /* sound is best-effort only */
  }
}

function toggleResAlertPanel() {
  const panel = document.getElementById("res-alert-panel");
  const bdPanel = document.getElementById("bd-alert-panel");
  if (!panel) return;
  if (bdPanel) bdPanel.classList.add("hidden"); // one panel at a time
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening) {
    _resNotifyRenderList(); // show what we have immediately
    _resNotifyRefresh(); // then confirm against the DB
  }
}

function goToReservationsFromNotify() {
  document.getElementById("res-alert-panel")?.classList.add("hidden");
  if (typeof navigateTo === "function") navigateTo("reservations");
}

// Close the panel when clicking outside (same behavior as birthday panel)
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("bd-alert-wrap");
  const panel = document.getElementById("res-alert-panel");
  if (!wrap || !panel || panel.classList.contains("hidden")) return;
  if (!wrap.contains(e.target)) panel.classList.add("hidden");
});

let _resNotifyPollTimer = null;

function setupOnlineResNotify() {
  if (_resNotifyStarted) return;
  _resNotifyStarted = true;

  // Always fetch fresh from the DB on load — this alone fixes both
  // "nobody had a tab open when it came in" and "the PC was off all
  // night": it doesn't matter whose PC catches it or when, the next
  // person to open the app sees the true state.
  _resNotifyRefresh();

  if (typeof IS_DEV !== "undefined" && IS_DEV) return; // dev: no realtime/poll (same rule as app.js)

  // Background poll. Two jobs: catch anything a dropped or
  // never-established realtime socket would miss silently, AND roll
  // the D-1/D-day reminder slots open on a PC left running for days
  // without anyone reloading. Both are re-evaluated every tick.
  _resNotifyPollTimer = setInterval(
    () => _resNotifyRefresh({ chimeNew: true }),
    RES_NOTIFY_POLL_MS,
  );

  _resNotifyChannel = db.channel("rt-online-res-bell");
  _resNotifyChannel
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "reservations" },
      (payload) => {
        if (payload?.new?.reservation_source !== "Online Form") return;
        _resNotifyRefresh({ chimeNew: true });
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "reservations" },
      (payload) => {
        if (payload?.new?.reservation_source !== "Online Form") return;
        _resNotifyRefresh(); // e.g. follow-up or reminder toggled on another device
      },
    )
    .subscribe((status) => {
      _resNotifyLive = status === "SUBSCRIBED";
      _resNotifyRenderBadge();
    });
}
