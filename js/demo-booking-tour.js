/* Optional online-booking guide. Same-tab recovery only; no automatic writes.
 * A verified playground staff member launches it. Public pages recheck Auth and
 * app_session_valid before showing guidance. Stored handoff data grants no access.
 */
(function () {
  "use strict";
  const VERSION = 1, TTL = 2 * 60 * 60 * 1000;
  let state = null, staffId = null, overlay = null, dock = null, observer = null;
  let epoch = 0, timer = null, authTimer = null, authSubscription = null, pending = false;
  let booking = null, ready = false, initialized = false;
  const env = () => window.INTOCH_DEMO_TOUR_ENV;
  const text = (en, id) => (typeof GUEST_LANG !== "undefined" ? GUEST_LANG : typeof CURRENT_LANG !== "undefined" ? CURRENT_LANG : "en") === "id" ? id : en;
  const key = () => `intoch:online-demo:v${VERSION}:${env()?.supabaseUrl}:active`;
  const isStaff = () => !!document.getElementById("page-dashboard");
  const isForm = () => !!document.getElementById("res-form");
  const permitted = () => !!(env()?.origins.includes(location.origin) && typeof SUPABASE_URL !== "undefined" && SUPABASE_URL === env().supabaseUrl);
  const staffAllowed = () => typeof getStaffSession === "function" && getStaffSession()?.id === staffId &&
    ["admin","manager","staff","finance"].includes(getStaffSession()?.role) && typeof demoEnabled === "function" && demoEnabled() && hasAccess("dashboard") && hasAccess("reservations");
  const valid = () => permitted() && ready && state?.staffId === staffId && state.expires > Date.now() && (!isStaff() || staffAllowed());
  const selector = name => `[data-booking-tour="${name}"]`;
  function read() {
    try {
      const value = JSON.parse(sessionStorage.getItem(key()));
      return value?.version === VERSION && value.expires > Date.now() && /^Intoch Demo [0-9a-f]{8}$/.test(value.name) && /^000\d{9}$/.test(value.phone) ? value : null;
    } catch { return null; }
  }
  function save() {
    try { state ? sessionStorage.setItem(key(), JSON.stringify(state)) : sessionStorage.removeItem(key()); return true; }
    catch { return false; }
  }
  function visible(node) {
    if (!node?.isConnected || !node.getBoundingClientRect().width || !node.getBoundingClientRect().height) return false;
    for (let parent = node; parent?.nodeType === 1; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }
  function target(name) {
    if (name === "day") return [...document.querySelectorAll(selector("day"))].find(node => node.dataset.bookingDate === state.date && visible(node));
    if (name === "row" || name === "status") return [...document.querySelectorAll(selector(name))].find(node => node.dataset.bookingId === state.reservationId && visible(node));
    return [...document.querySelectorAll(selector(name))].find(visible);
  }
  function catalog() {
    return [
      { id: "launch", context: "staff", target: "form-link", action: "launch", title: text("Book as a guest", "Reservasi sebagai tamu"), copy: text("Open the real online form. You will enter fictional details and submit the booking yourself, then return here to see how your team receives it. No payment or message is needed.", "Buka formulir online yang sebenarnya. Anda akan memasukkan detail fiktif dan mengirim reservasi sendiri, lalu kembali untuk melihat cara tim menerimanya. Tidak perlu pembayaran atau pesan.") },
      { id: "name", context: "form", target: "name", action: "input", title: text("Introduce your demo guest", "Perkenalkan tamu demo"), copy: text(`Enter ${state?.name}. This unique fictional name helps you recognize your booking later.`, `Masukkan ${state?.name}. Nama fiktif unik ini membantu Anda menemukan reservasi nanti.`) },
      { id: "phone", context: "form", target: "phone", action: "input", title: text("Use a fictional contact", "Gunakan kontak fiktif"), copy: text(`Enter ${state?.phone}, a demo-only number starting with 000. Use these fictional details throughout; no WhatsApp message is sent by this guide.`, `Masukkan ${state?.phone}, nomor khusus demo dengan awalan 000. Gunakan detail fiktif ini; panduan tidak mengirim pesan WhatsApp.`) },
      { id: "party", context: "form", target: "party", title: text("Choose the party size", "Pilih jumlah tamu"), copy: text("Keep this example to two guests. Party size and the chosen area determine available seating and any deposit conditions.", "Gunakan dua tamu untuk contoh ini. Jumlah tamu dan area menentukan ketersediaan tempat duduk dan ketentuan deposit.") },
      { id: "schedule", context: "form", target: "schedule", action: "schedule", title: text("Choose an available visit", "Pilih kunjungan yang tersedia"), copy: text("Choose an area if offered, a date within the next 14 days, and an available time. This keeps the example in the dashboard's online overview. Availability and any conditions come from the real form.", "Pilih area jika tersedia, tanggal dalam 14 hari ke depan, dan waktu yang tersedia. Contoh ini akan masuk ke ringkasan online dashboard. Ketersediaan dan ketentuan berasal dari formulir sebenarnya.") },
      { id: "submit", context: "form", target: "submit", action: "submit", title: text("Create the demo booking", "Buat reservasi demo"), copy: text("Click the form's submit button when ready. This creates a real booking in the fictional playground. The guide waits for the server to accept it; it never submits for you. If the form reports an error, correct it or go Back.", "Klik tombol kirim saat siap. Ini membuat reservasi nyata di playground fiktif. Panduan menunggu persetujuan server dan tidak mengirim untuk Anda. Jika formulir menampilkan kesalahan, perbaiki atau pilih Kembali.") },
      { id: "saved", context: "created", target: "confirmation", title: text("Read the booking outcome", "Baca hasil reservasi"), copy: () => statusCopy(state?.status) + " " + text("Return to the dashboard to find this exact booking. You can leave payment and contact buttons alone.", "Kembali ke dashboard untuk menemukan reservasi ini. Anda dapat melewati tombol pembayaran dan kontak.") },
      { id: "online", context: "staff", target: "online-tab", action: "online", title: text("See online bookings arrive", "Lihat reservasi online masuk"), copy: text("Click Online form · 14 days. This reads saved online bookings, grouped by date. A submitted booking is not yet a recorded restaurant visit.", "Klik Online form · 14 days. Daftar ini membaca reservasi online tersimpan, dikelompokkan menurut tanggal. Reservasi terkirim belum menjadi kunjungan restoran yang tercatat.") },
      { id: "day", context: "staff", target: "day", action: "day", title: text("Open your booking day", "Buka hari reservasi Anda"), copy: () => text(`Click ${state?.date}, the date you selected. Intoch opens Reservations with the online-only filter for that day.`, `Klik ${state?.date}, tanggal yang Anda pilih. Intoch membuka Reservations dengan filter online pada hari tersebut.`) },
      { id: "row", context: "staff", target: "row", title: text("Your guest's booking is here", "Reservasi tamu Anda ada di sini"), copy: () => text("This is the exact saved booking, with its time, party size and seating. Staff can manage it using the existing controls; this guide requires no further changes.", "Ini reservasi tersimpan yang sama, dengan waktu, jumlah tamu, dan tempat duduk. Staf dapat mengelolanya lewat kontrol yang tersedia; tidak perlu perubahan untuk panduan ini.") },
      { id: "status", context: "staff", target: "status", title: text("Understand its status", "Pahami statusnya"), copy: () => statusCopy(booking?.status) },
      { id: "bell", context: "staff", target: "bell", title: text("Know what needs follow-up", "Ketahui yang perlu ditindaklanjuti"), copy: text("The bell helps staff follow up online bookings and check upcoming arrivals. The saved booking remains in Reservations even after follow-up is recorded. No message or follow-up change is required here.", "Lonceng membantu staf menindaklanjuti reservasi online dan memeriksa kedatangan berikutnya. Reservasi tetap ada di Reservations setelah tindak lanjut dicatat. Tidak perlu mengirim pesan atau mengubah tindak lanjut di sini.") },
      { id: "finish", context: "staff", target: "row", title: text("Guest to front desk, connected", "Dari tamu ke meja depan"), copy: text("You created an online booking and found it in Intoch. Explore freely, or launch Online Reservation Guide again from the dashboard's demo guidance. Your fictional booking stays in the playground.", "Anda membuat reservasi online dan menemukannya di Intoch. Jelajahi dengan bebas atau buka Online Reservation Guide lagi dari panduan demo dashboard. Reservasi fiktif tetap tersimpan di playground.") },
    ];
  }
  function current() { return catalog().find(item => item.id === state?.step); }
  function statusCopy(status) {
    if (status === "Waitlist") return text("This is a waiting request, not a confirmed table. Staff must review availability.", "Ini permintaan menunggu, bukan meja terkonfirmasi. Staf perlu meninjau ketersediaan.");
    if (status === "Incoming") return text("This booking is awaiting its deposit or quote. It is not yet confirmed; staff can review the booking's payment conditions.", "Reservasi ini menunggu deposit atau penawaran. Reservasi belum terkonfirmasi; staf dapat meninjau ketentuan pembayarannya.");
    if (status === "Reserved") return text("The booking is reserved. Arrival and a completed visit are separate actions for staff when the guest actually comes.", "Reservasi berstatus Reserved. Kedatangan dan kunjungan selesai dicatat terpisah oleh staf saat tamu benar-benar datang.");
    return text(`Current booking status: ${status || "unavailable"}. Read the form's outcome and the staff status before promising a table.`, `Status reservasi saat ini: ${status || "belum tersedia"}. Baca hasil formulir dan status staf sebelum menjanjikan meja.`);
  }
  function dispose() { epoch++; clearTimeout(timer); if (overlay) { const old = overlay; overlay = null; old.destroy(); } }
  function button(label, handler) { const node = document.createElement("button"); node.type = "button"; node.className = "demo-tour-link"; node.textContent = label; node.addEventListener("click", handler); return node; }
  function clamp() {
    const node = document.querySelector(".intoch-online-tour"); if (!node) return;
    const view = window.visualViewport, x = view?.offsetLeft || 0, y = view?.offsetTop || 0, width = view?.width || innerWidth, height = view?.height || innerHeight;
    const style = (name, value) => { if (node.style[name] !== value) node.style[name] = value; };
    style("maxWidth", `${Math.min(340, width - 24)}px`); style("maxHeight", `${height - 24}px`);
    const box = node.getBoundingClientRect();
    const left = Math.max(x + 12, Math.min(box.left, x + width - box.width - 12));
    const top = Math.max(y + 12, Math.min(box.top, y + height - box.height - 12));
    style("right", "auto"); style("bottom", "auto");
    style("left", `${left}px`); style("top", `${top}px`);

  }
  function pause(message = text("Online guide paused. Explore freely, then resume when ready.", "Panduan online dijeda. Jelajahi dengan bebas, lalu lanjutkan saat siap.")) {
    if (!valid()) return;
    dispose(); pending = false; state.paused = true; save(); dock?.remove();
    dock = document.createElement("aside"); dock.className = "demo-tour-dock";
    const label = document.createElement("span"); label.textContent = message; label.setAttribute("role", "status");
    dock.append(label, button(text("Resume Online Guide", "Lanjutkan Panduan Online"), resume));
    if (!isStaff() && state.submissionAttempted) dock.append(button(text("Check Dashboard", "Periksa Dashboard"), () => { state.step = "online"; state.paused = true; save(); location.assign("/"); }));
    dock.append(button(text("Close", "Tutup"), dismiss));
    document.body.append(dock);
    nudgeReset();
  }
  function exit(status = "skipped") {
    if (state) { try { localStorage.setItem(`intoch:online-demo:v${VERSION}:${env().supabaseUrl}:${state.staffId}:seen`, status); } catch {} }
    dispose(); dock?.remove(); dock = null; state = null; save(); pending = false; booking = null;
    if (isStaff() && typeof toggleSidebarDrawer === "function") toggleSidebarDrawer(false);
    if (status === "completed" && isStaff()) window.DemoTour?.nudge();
  }
  function dismiss() {
    const allowed = valid(); exit("skipped");
    if (!allowed) return;
    nudgeReset();
  }
  function nudgeReset() {
    if (isStaff()) window.DemoTour?.nudge();
    else {
      document.getElementById("demo-public-reset")?.remove();
      const link = document.createElement("a"); link.id = "demo-public-reset"; link.className = "demo-public-reset demo-tour-link";
      link.href = "/"; link.textContent = text("Reset Tour — choose a guide on the dashboard", "Reset Tour — pilih panduan di dashboard");
      document.body.append(link);
    }
  }
  function move(step) { if (!valid()) return; state.step = step; state.paused = false; pending = false; save(); show().catch(() => pause()); }
  function next(action = false) {
    if (!valid() || state.paused) return;
    const item = current(); if (item.action && !action) return;
    if (item.id === "finish") return exit("completed");
    if (item.id === "saved") { state.step = "online"; state.autoResume = true; state.paused = false; save(); return location.assign("/"); }
    move(catalog()[catalog().findIndex(step => step.id === item.id) + 1].id);
  }
  function back() {
    if (!valid()) return;
    const item = current();
    // Never replay a successful save or encourage a second submission on Back.
    if (item.id === "saved" || item.id === "online" && state.reservationId) return;
    if (item.id === "name") { state.step = "launch"; state.paused = false; save(); return location.assign("/"); }
    move(catalog()[catalog().findIndex(step => step.id === item.id) - 1]?.id || "launch");
  }
  async function show() {
    if (!valid()) return teardown();
    dispose(); dock?.remove(); dock = null; state.paused = false; save();
    const item = current(), token = epoch;
    if (!item) return exit();
    if (isStaff()) {
      const page = ["row", "status", "bell", "finish"].includes(item.id) ? "reservations" : "dashboard";
      if (currentPage !== page) { pending = true; await navigateTo(page); pending = false; }
      if (!valid() || epoch !== token) return;
      if (matchMedia("(max-width: 640px)").matches && typeof toggleSidebarDrawer === "function") toggleSidebarDrawer(false);
    }
    const matchesContext = item.context === "staff" ? isStaff() : item.context === "form" ? isForm() : !!document.getElementById("created-title");
    if (!matchesContext) return pause(text("Return to the page where you left this guide, then resume.", "Kembali ke halaman tempat Anda meninggalkan panduan, lalu lanjutkan."));
    let node;
    for (let attempt = 0; attempt < 50; attempt++) { if (epoch !== token || !valid()) return; node = target(item.target); if (node) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    if (!node || isStaff() && ["row", "status", "finish"].includes(item.id) && !booking) return pause(text("The example is not visible yet. Refresh the online overview or check the date and filters, then resume.", "Contoh belum terlihat. Muat ulang ringkasan online atau periksa tanggal dan filter, lalu lanjutkan."));
    if (!window.driver?.js?.driver) return pause();
    node.scrollIntoView({block: item.id === "schedule" && matchMedia("(max-width: 640px)").matches ? "start" : "center",inline:"nearest",behavior:"instant"});
    if (isStaff() && matchMedia("(max-width: 640px)").matches) {
      window.scrollTo({left:0,top:window.scrollY,behavior:"instant"});
      const list = node.closest(selector("list-scroll"));
      if (list) {
        const view = window.visualViewport, left = view?.offsetLeft || 0, width = view?.width || innerWidth;
        const container = list.getBoundingClientRect(), box = node.getBoundingClientRect();
        const center = Math.max(left + 12 + box.width / 2, Math.min(container.left + container.width / 2, left + width - 12 - box.width / 2));
        list.scrollLeft += box.left + box.width / 2 - center;
      }
    }

    overlay = window.driver.js.driver({ animate: !matchMedia("(prefers-reduced-motion: reduce)").matches, smoothScroll:false, allowKeyboardControl:false, overlayClickBehavior:"none", overlayColor:getComputedStyle(document.documentElement).getPropertyValue("--brand-ink").trim() || "#173B64", overlayOpacity:.38, stagePadding:6, stageRadius:12,
      popoverClass:"intoch-demo-tour intoch-online-tour", disableActiveInteraction:!item.action && item.id !== "party",
      onNextClick:() => next(), onPrevClick:back, onCloseClick:dismiss, onDestroyStarted:dismiss, onHighlighted:() => {
        clamp();
        if (isStaff() && node.closest(selector("list-scroll")) && matchMedia("(max-width: 640px)").matches) requestAnimationFrame(() => {
          if (epoch !== token || !overlay) return;
          node.scrollIntoView({block:"center",inline:"center",behavior:"instant"}); overlay.refresh(); clamp();
        });
      },
      onPopoverRender:popover => {
        popover.wrapper.setAttribute("role","dialog"); popover.wrapper.setAttribute("aria-label",item.title);
        popover.nextButton.disabled = !!item.action; popover.nextButton.classList.toggle("driver-popover-btn-disabled",!!item.action);
        popover.previousButton.disabled = ["launch","saved","online"].includes(item.id);
        popover.previousButton.classList.toggle("driver-popover-btn-disabled",popover.previousButton.disabled);
        popover.nextButton.textContent = item.id === "saved" ? text("Return to Dashboard","Kembali ke Dashboard") : item.id === "finish" ? text("Finish","Selesai") : text("Next","Lanjut");
        popover.previousButton.textContent = text("Back","Kembali");
        const controls = document.createElement("div"); controls.className = "demo-tour-controls";
        const progress = document.createElement("span"); progress.className = "demo-tour-progress"; progress.textContent = `${catalog().findIndex(step => step.id === item.id)+1} / ${catalog().length}`;
        controls.append(progress,button(text("Skip","Lewati"),dismiss),button(text("Explore Independently","Jelajahi Mandiri"),() => { pause(); nudgeReset(); })); popover.wrapper.append(controls);
        (item.action ? node.querySelector("input") || node : popover.nextButton).focus({preventScroll:true});
      }
    });
    const escaped = document.createElement("span"); escaped.textContent = typeof item.copy === "function" ? item.copy() : item.copy;
    overlay.highlight({element:node,popover:{showButtons:["previous","next","close"],title:item.title,description:escaped.innerHTML,side:matchMedia("(max-width: 640px)").matches?"bottom":"right"}});
  }
  function scheduleValid() {
    const date = document.getElementById("f-date")?.value, time = document.getElementById("f-time")?.value;
    const now = new Date(), last = new Date(); last.setDate(last.getDate()+13);
    const day = value => typeof ymd === "function" ? ymd(value) : `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
    return date >= day(now) && date <= day(last) && !!time && document.getElementById("pax-value")?.value === "2" &&
      (typeof AREAS === "undefined" || !AREAS.length || typeof AREA_ID !== "undefined" && !!AREA_ID) &&
      (typeof AREA_BLOCK_DATE === "undefined" || AREA_BLOCK_DATE === date);
  }
  function inputAction() {
    if (!valid() || state.paused) return;
    if (state.step === "name" && document.getElementById("f-name")?.value.trim() === state.name) next(true);
    else if (state.step === "phone" && document.getElementById("f-phone")?.value.trim() === state.phone) next(true);
    else if (state.step === "schedule" && scheduleValid()) next(true);
  }
  function captureSubmit(event) {
    if (!valid() || state.paused || event.target.id !== "res-form") return;
    if (state.step !== "submit" || !scheduleValid() || document.getElementById("f-name")?.value.trim() !== state.name || document.getElementById("f-phone")?.value.trim() !== state.phone || state.reservationId) {
      event.preventDefault(); event.stopImmediatePropagation();
      pause(text("Use the fictional name and 000 contact, choose two guests and a valid date/time, then resume. The guide has not submitted anything.", "Gunakan nama fiktif dan kontak 000, pilih dua tamu serta tanggal/waktu yang valid, lalu lanjutkan. Panduan belum mengirim apa pun.")); return;
    }
    if (state.submissionAttempted) { event.preventDefault(); event.stopImmediatePropagation(); return pause(text("This submission may already have been saved. Check Dashboard before trying again.", "Pengiriman ini mungkin sudah tersimpan. Periksa Dashboard sebelum mencoba lagi.")); }
    state.submissionAttempted = true; state.date = document.getElementById("f-date").value; save();
    pending = true;
  }
  function reservationSaved(result, values) {
    if (!valid() || state.step !== "submit" || !pending || !result?.ok || !/^[0-9a-f-]{36}$/i.test(result.reservation_id || "") || values.name !== state.name || values.phone !== state.phone) return;
    state.submissionAttempted = false; state.reservationId = result.reservation_id; state.date = values.date; state.status = result.status;
    state.step = "saved"; state.paused = false; pending = false; save(); dispose();
  }
  function reservationFailed(uncertain = false) {
    if (!valid() || state.step !== "submit" || !pending) return;
    pending = false;
    if (uncertain) pause(text("The response was interrupted. The booking may have been saved. Use Check Dashboard before trying again.", "Respons terputus. Reservasi mungkin sudah tersimpan. Gunakan Periksa Dashboard sebelum mencoba lagi."));
    else { state.submissionAttempted = false; save(); }
  }
  function click(event) {
    if (!valid() || state.paused) return;
    const item = current(), node = event.target.closest?.("[data-booking-tour]");
    if (item.id === "launch" && node?.dataset.bookingTour === "form-link") {
      event.preventDefault(); state.step = "name"; save(); location.assign("/reserve.html");
    } else if (item.id === "online" && node?.dataset.bookingTour === "online-tab" || item.id === "day" && node?.dataset.bookingTour === "day" && node.dataset.bookingDate === state.date) {
      pending = true;
      clearTimeout(timer); timer = setTimeout(() => {if (pending && valid()) pause(text("The booking view is taking longer than expected. Retry it, then resume.","Daftar reservasi memerlukan waktu lebih lama. Coba lagi, lalu lanjutkan."));},8000);
    }
    if (isForm()) setTimeout(inputAction,0);
  }
  function notify(type, detail = {}) {
    if (!valid()) return;
    if (type === "page-ready" && state.autoResume) {
      state.autoResume = false; save(); if (detail.ok) resume(); else pause(); return;
    }
    if (state.paused) return;
    if (type === "page-changing" && !pending && overlay && ["online","day","row","status","bell","finish"].includes(state.step)) return pause();
    if (state.step === "online" && pending && type === "online-overview-ready") {
      if (detail.ok && detail.rows?.some(row => row.id === state.reservationId)) { clearTimeout(timer); next(true); }
      else pause(text("The saved booking is not in the upcoming online overview. Check its date/status or refresh, then resume. Do not submit another booking.", "Reservasi belum ada di ringkasan online mendatang. Periksa tanggal/status atau muat ulang, lalu lanjutkan. Jangan kirim reservasi lain."));
    }
    if (state.step === "day" && pending && type === "operations-ready" && detail.page === "reservations" && detail.ok) {
      const found = detail.rows?.find(row => row.id === state.reservationId && row.reservation_source === "Online Form");
      if (found) { booking = found; clearTimeout(timer); next(true); }
      else pause(text("The exact booking has not loaded. Check filters and retry; no new submission is needed.", "Reservasi yang sama belum dimuat. Periksa filter dan coba lagi; tidak perlu mengirim ulang."));
    }
  }
  async function fetchBooking() {
    if (!state?.reservationId && state?.submissionAttempted) {
      const guest = await db.from("guests").select("id").eq("phone",state.phone).maybeSingle();
      if (guest.error || !guest.data) return false;
      const result = await db.from("reservations").select("id,reservation_date,reservation_source,status")
        .eq("guest_id",guest.data.id).eq("reservation_source","Online Form").eq("reservation_date",state.date).gte("created_at",state.startedAt).limit(2);
      if (!valid() || result.error || result.data?.length !== 1) return false;
      state.reservationId = result.data[0].id;state.status = result.data[0].status;state.submissionAttempted = false;state.step = "online";save();
    }
    if (!state?.reservationId) return true;
    const token = epoch;
    const {data,error} = await db.from("reservations").select("id,reservation_date,reservation_source,status").eq("id",state.reservationId).single();
    if (token !== epoch || !valid()) return false;
    if (error || !data || data.reservation_source !== "Online Form" || data.reservation_date !== state.date) return false;
    booking = data; return true;
  }
  async function resume() {
    if (!valid()) return teardown();
    try {
    state.paused = false; save();
    if (isStaff() && !(await fetchBooking())) return pause(text("The booking read failed. Check your connection, then resume. No duplicate booking is needed.", "Reservasi gagal dibaca. Periksa koneksi, lalu lanjutkan. Tidak perlu membuat duplikat."));
    if (isStaff() && state.step === "day") {
      pending = true; if (currentPage !== "dashboard") await navigateTo("dashboard"); await showDashboardOnlineReservations(); pending = false;
    }
    if (isStaff() && ["row", "status", "bell", "finish"].includes(state.step)) {
      pending = true; await openOnlineReservationDay(state.date); pending = false;
    }
    show().catch(() => pause());
    } catch { pause(text("This read failed. Check your connection, then resume. Nothing has been submitted by the guide.", "Data gagal dibaca. Periksa koneksi, lalu lanjutkan. Panduan tidak mengirim apa pun.")); }
  }
  function addEntry() {
    const guide = document.getElementById("demo-guide"); if (!guide || document.getElementById("demo-online-guide")) return;
    const entry = button(text("Online Reservation Guide","Panduan Reservasi Online"), start); entry.id = "demo-online-guide";
    guide.querySelector(".demo-actions")?.append(entry);
  }
  async function start() {
    if (!ready || !permitted() || !isStaff() || !staffAllowed()) return;
    if (window.DemoTour) DemoTour.exit("skipped");
    exit();
    const bytes = new Uint8Array(4); crypto.getRandomValues(bytes); const suffix = [...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
    state = {version:VERSION,staffId,expires:Date.now()+TTL,startedAt:new Date().toISOString(),name:`Intoch Demo ${suffix}`,phone:`000${String(parseInt(suffix,16)).padStart(10,"0").slice(-9)}`,step:"launch",paused:false};
    if (!save()) { state = null; return; }
    await show();
  }
  async function publicVerify() {
    const token = epoch;
    try {
      const user = await db.auth.getUser(); if (user.error || !user.data?.user) return false;
      const active = await db.rpc("app_session_valid"); if (active.error || active.data !== true) return false;
      const profile = await db.from("staff_users").select("id,role,is_active").eq("auth_user_id",user.data.user.id).eq("is_active",true).maybeSingle();
      return token === epoch && !profile.error && profile.data?.id === (state?.staffId || staffId) && ["admin","manager","staff","finance"].includes(profile.data.role);
    } catch { return false; }
  }
  function keydown(event) {
    if (!overlay) return;
    if (event.key === "Escape") {event.preventDefault();dismiss();}
    if (event.key === "Tab") {
      const node = overlay.getActiveElement();
      const nodes = [...(current()?.action || state?.step === "party" ? node.querySelectorAll("input:not([type=hidden]):not(:disabled),select:not(:disabled),button:not(:disabled),a[href]") : []), ...(node.matches("button,a,input") ? [node] : []), ...document.querySelectorAll(".intoch-online-tour button:not(:disabled)")].filter(visible);
      if (!nodes.length) return; const position = (nodes.indexOf(document.activeElement)+(event.shiftKey?-1:1)+nodes.length)%nodes.length;
      event.preventDefault();event.stopImmediatePropagation();nodes[position].focus({preventScroll:true});
    }
  }
  function viewportChanged() { overlay?.refresh(); clamp(); }
  function listen() {
    if (initialized) return; initialized = true;
    document.addEventListener("click",click,true); document.addEventListener("input",inputAction); document.addEventListener("change",inputAction);
    document.addEventListener("submit",captureSubmit,true); document.addEventListener("keydown",keydown,true);
    window.addEventListener("resize",viewportChanged); window.visualViewport?.addEventListener("resize",viewportChanged); window.visualViewport?.addEventListener("scroll",viewportChanged);
    observer = new MutationObserver(()=>{if (overlay) clamp();}); observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","class","hidden"]});
  }
  function sessionReady(staff) {
    teardown(false);
    if (!permitted() || typeof demoEnabled !== "function" || !demoEnabled() || !staff?.id || !["admin","manager","staff","finance"].includes(staff.role) || !hasAccess("dashboard") || !hasAccess("reservations")) return;
    staffId = staff.id; ready = true; state = read(); if (state && state.staffId !== staffId) {state = null;save();}
    listen(); addEntry(); if (state && !state.autoResume) pause(text("Your online guide is saved. Resume when ready.","Panduan online tersimpan. Lanjutkan saat siap."));
  }
  async function publicBoot() {
    if (!permitted() || isStaff()) return;
    state = read(); if (!state) return;
    const verified = await Promise.race([publicVerify(),new Promise(resolve=>setTimeout(()=>resolve(false),6000))]);
    if (!verified) return teardown();
    staffId = state.staffId; ready = true; listen();
    authSubscription = db.auth.onAuthStateChange?.(event=>{if(event === "SIGNED_OUT") teardown();})?.data?.subscription;
    authTimer = setInterval(async()=>{if (!(await publicVerify())) teardown();},30000);
    if (state.submissionAttempted) pause(text("Your submission may already have been saved. Check Dashboard before trying again.","Reservasi mungkin sudah tersimpan. Periksa Dashboard sebelum mencoba lagi."));
    else if (state.paused) pause(); else show().catch(()=>pause());
  }
  function teardown(clear = true) {
    dispose(); clearInterval(authTimer); authTimer = null; authSubscription?.unsubscribe(); authSubscription = null;
    observer?.disconnect(); observer = null; dock?.remove(); dock = null;
    document.getElementById("demo-online-guide")?.remove();
    document.getElementById("demo-public-reset")?.remove();
    document.removeEventListener("click",click,true); document.removeEventListener("input",inputAction); document.removeEventListener("change",inputAction);
    document.removeEventListener("submit",captureSubmit,true); document.removeEventListener("keydown",keydown,true);
    window.removeEventListener("resize",viewportChanged); window.visualViewport?.removeEventListener("resize",viewportChanged); window.visualViewport?.removeEventListener("scroll",viewportChanged);
    if (clear) {state = null;save();} else state = null;
    initialized = false;staffId = null;ready = false;pending = false;booking = null;
  }
  window.DemoBookingTour = Object.freeze({sessionReady,notify,start,resume,teardown,reservationSaved,reservationFailed,pause,exit,publicBoot});
  if (!isStaff()) publicBoot();
})();
