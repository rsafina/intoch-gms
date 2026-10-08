/* Driver.js 1.9.0; vanilla DOM controller mounted outside page sections.
 * Policy: offer once per verified demo staff identity/browser/version. Every explicit
 * exit counts as seen; replay is always available. No server state or automatic writes.
 */
(function () {
  "use strict";
  const VERSION = 1;
  const text = (en, id) => typeof demoText === "function" ? demoText(en, id) : en;
  const anchor = name => `[data-tour="${name}"]`;
  const mobile = () => window.matchMedia("(max-width: 640px)").matches;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let identity = null, generation = 0, run = null, driverObj = null;
  let offered = false, internalNavigation = false, profileId = null;
  let dashboardReady = false, guestsReady = false, waitingCancel = null, welcomeTimer = null, dock = null;
  let observer = null, refreshTimer = null, lastFocus = null, pendingAction = null, actionTimer = null, readTimer = null;
  let searchSatisfied = false, profileSatisfied = false;
  const operationsReady = { reservations: false, walkins: false };
  let resetMenu = null, nudgeTimer = null;
  const sections = () => [
    ["operations", text("Dashboard, Reservations & Walk-Ins", "Dashboard, Reservasi & Walk-In")],
    ["guests", text("Guest Database", "Database Tamu")],
    ["online", text("Reservation from Online Form", "Reservasi dari Form Online")],
  ];

  function environment() { return window.INTOCH_DEMO_TOUR_ENV; }
  function eligible() {
    const env = environment();
    const staff = typeof getStaffSession === "function" ? getStaffSession() : null;
    return !!(env && env.origins?.includes(location.origin) && env.supabaseUrl &&
      typeof SUPABASE_URL !== "undefined" && env.supabaseUrl === SUPABASE_URL &&
      env.fictionalGuestNames?.some(name => typeof name === "string" && name) &&
      typeof demoEnabled === "function" && demoEnabled() && staff?.id != null &&
      ["admin", "manager", "staff", "finance"].includes(staff.role) &&
      typeof hasAccess === "function" && hasAccess("dashboard") && hasAccess("guests"));
  }
  function valid() {
    return identity !== null && eligible() && identity === String(getStaffSession().id);
  }
  function key(active = false) {
    return `intoch:demo-tour:v${VERSION}:${environment().supabaseUrl}:${identity}:${active ? "active" : "seen"}`;
  }
  function read(active = false) {
    try { return JSON.parse((active ? sessionStorage : localStorage).getItem(key(active))); }
    catch { return null; }
  }
  function store(status) {
    try { localStorage.setItem(key(), JSON.stringify({ status, version: VERSION })); } catch { /* Storage may be disabled. */ }
  }
  function persist() {
    if (!valid()) return;
    try {
      if (run) sessionStorage.setItem(key(true), JSON.stringify({ ...run, version: VERSION }));
      else sessionStorage.removeItem(key(true));
    } catch { /* A tour must also work without browser storage. */ }
  }
  function sample() {
    return { id: run?.guestId || null, name: run?.guestName || environment()?.fictionalGuestNames[0] };
  }
  function visible(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  function find(selector) { return [...document.querySelectorAll(selector)].find(visible); }
  function catalog() {
    const items = [
      { id: "dashboard", page: "dashboard", target: "dashboard-intro", title: text("Your front desk at a glance", "Ringkasan meja depan Anda"), copy: text("Start the day with bookings, walk-ins and seating in one place. This tour uses a fictional guest and never saves anything for you.", "Mulai hari dengan reservasi, walk-in, dan tempat duduk dalam satu layar. Tur ini menggunakan tamu fiktif dan tidak menyimpan data untuk Anda.") },
      { id: "reservations", page: "dashboard", target: "today-reservations", title: text("Plan for arriving guests", "Siapkan kedatangan tamu"), copy: text("Upcoming Reservations helps your team prepare before guests arrive. Today, Tomorrow and +2 Days let you look ahead without leaving the dashboard.", "Upcoming Reservations membantu tim bersiap sebelum tamu datang. Today, Tomorrow, dan +2 Days membantu Anda melihat hari berikutnya dari dashboard.") },
      { id: "walkins", page: "dashboard", target: "today-walkins", title: text("Keep walk-ins in view", "Pantau tamu walk-in"), copy: text("See today's walk-ins alongside your bookings. Your team can return here to update seating as the service changes.", "Lihat walk-in hari ini bersama reservasi Anda. Tim dapat kembali ke sini untuk memperbarui tempat duduk selama layanan berlangsung.") },
      { id: "occupancy", page: "dashboard", target: "area-occupancy", title: text("See the seating picture", "Lihat kondisi tempat duduk"), copy: text("Area occupancy compares assigned parties with area capacity. It is a seating overview; today's traffic also includes completed visits.", "Okupansi area membandingkan rombongan yang ditempatkan dengan kapasitas area. Ini adalah ringkasan tempat duduk; aktivitas hari ini juga mencakup kunjungan selesai.") },
      { id: "quick", page: "dashboard", target: "quick-walkin", title: text("A quick welcome for walk-ins", "Sambut walk-in dengan cepat"), copy: text("Quick Walk-In starts with a name, with phone and party size available here. You can add seating details later; no registration is needed for this tour.", "Quick Walk-In dimulai dengan nama, dengan telepon dan jumlah orang tersedia di sini. Detail tempat duduk bisa menyusul; tidak perlu mendaftarkan tamu untuk tur ini.") },
      ...(mobile() ? [{ id: "menu", page: "dashboard", target: "mobile-menu", action: "menu", title: text("Open navigation", "Buka navigasi"), copy: text("Tap the menu to explore reservations, walk-ins and guests. The guide will continue when navigation opens.", "Ketuk menu untuk menjelajahi reservasi, walk-in, dan tamu. Panduan akan berlanjut setelah navigasi terbuka.") }] : []),
      { id: "reservations-nav", page: "dashboard", destination: "reservations", target: "reservations-nav", action: "navigate", title: text("Explore reservations", "Jelajahi reservasi"), copy: text("Click Reservations to see how your team prepares bookings and manages arrivals. We will continue when the list loads.", "Klik Reservations untuk melihat persiapan reservasi dan pengelolaan kedatangan. Panduan berlanjut setelah daftar dimuat.") },
      { id: "reservation-controls", page: "reservations", target: "reservation-controls", title: text("Find the right booking", "Temukan reservasi yang tepat"), copy: text("Search for a guest or choose a date range to find bookings. Status filters help the team focus on the arrivals that need attention.", "Cari tamu atau pilih rentang tanggal untuk menemukan reservasi. Filter status membantu tim fokus pada kedatangan yang perlu ditangani.") },
      { id: "reservation-list", page: "reservations", target: "reservation-list", title: text("Manage the arrival", "Kelola kedatangan"), copy: text("The booking list brings guests, times, seating and status together. Available row actions let your team manage each booking; you do not need to change or save one during this tour.", "Daftar reservasi menyatukan tamu, waktu, tempat duduk, dan status. Tindakan pada baris membantu tim mengelola reservasi; Anda tidak perlu mengubah atau menyimpan apa pun selama tur.") },
      { id: "walkins-nav", page: "reservations", destination: "walkins", target: "walkins-nav", action: "navigate", title: text("Explore walk-ins", "Jelajahi walk-in"), copy: text("Click Walk-Ins to see the guests who arrived without a reservation. We will continue when the log loads.", "Klik Walk-Ins untuk melihat tamu yang datang tanpa reservasi. Panduan berlanjut setelah log dimuat.") },
      { id: "walkin-controls", page: "walkins", target: "walkin-controls", title: text("Review the service day", "Tinjau hari pelayanan"), copy: text("Choose a day to review its walk-ins. Register Walk-In is available for a new arrival; no registration is required to continue.", "Pilih hari untuk meninjau walk-in. Register Walk-In tersedia untuk kedatangan baru; tidak perlu mendaftarkan tamu untuk melanjutkan.") },
      { id: "walkin-list", page: "walkins", target: "walkin-list", title: text("Follow each walk-in", "Pantau setiap walk-in"), copy: text("The log shows arrivals and their progress. Your team can edit details or complete a real visit with the available controls. Use Reset Tour afterwards to explore the guest relationship.", "Log menampilkan kedatangan dan perkembangannya. Tim dapat mengedit detail atau menyelesaikan kunjungan nyata lewat kontrol yang tersedia. Gunakan Reset Tour setelahnya untuk menjelajahi hubungan pelanggan.") },
      { id: "guests-nav", page: "walkins", destination: "guests", target: "guests-nav", action: "navigate", title: text("Get to know your guests", "Kenali tamu Anda"), copy: text("Open Guest Database to see the relationships behind each visit. Click the highlighted navigation item to continue.", "Buka Guest Database untuk melihat hubungan di balik setiap kunjungan. Klik navigasi yang disorot untuk melanjutkan.") },
      { id: "search", page: "guests", target: "guest-search", action: "search", title: text("Find a familiar face", "Temukan tamu yang Anda kenal"), copy: () => text(`Search for ${sample().name}, our reviewed fictional example. The guide continues when their matching result has loaded.`, `Cari ${sample().name}, contoh tamu fiktif yang telah diperiksa. Panduan berlanjut setelah hasil yang sesuai dimuat.`) },
      { id: "open-profile", page: "guests", target: "guest-profile-open", action: "profile", title: text("Open the guest's story", "Buka cerita tamu"), copy: text("Click the highlighted eye button to open this guest's profile. We'll wait for their details and history to load successfully.", "Klik tombol mata yang disorot untuk membuka profil tamu ini. Kami menunggu detail dan riwayatnya berhasil dimuat.") },
      { id: "details", page: "guests", target: "profile-details", profile: true, title: text("Remember who they are", "Ingat siapa tamu Anda"), copy: text("Contact details keep the guest's identity together across visits. This example is fictional; you do not need to edit or contact anyone.", "Detail kontak menyatukan identitas tamu di setiap kunjungan. Contoh ini fiktif; Anda tidak perlu mengedit atau menghubungi siapa pun.") },
      { id: "spending", page: "guests", target: "profile-spending", profile: true, title: text("Understand recorded spending", "Pahami pengeluaran tercatat"), copy: text("Average Spend gives context from the guest's recorded spending history. Missing spending is different from a recorded zero.", "Average Spend memberi konteks dari riwayat pengeluaran tamu yang tercatat. Pengeluaran yang belum dicatat berbeda dengan nilai nol yang dicatat.") },
      { id: "preferences", page: "guests", target: "profile-preferences", profile: true, title: text("Make the next visit personal", "Buat kunjungan berikutnya lebih personal"), copy: text("Favorites, preferences and notes help the team remember what matters to this guest. Empty fields mean those details have not been recorded yet.", "Menu favorit, preferensi, dan catatan membantu tim mengingat hal penting bagi tamu. Kolom kosong berarti detail tersebut belum dicatat.") },
      { id: "history", page: "guests", target: "profile-history", profile: true, title: text("See the visits behind the relationship", "Lihat kunjungan di balik hubungan"), copy: text("Visit History shows the guest's recent attendance and recorded spending. A reservation alone does not mean the guest visited.", "Visit History menampilkan kedatangan terbaru dan pengeluaran tercatat. Reservasi saja tidak berarti tamu telah berkunjung.") },
      { id: "shortcuts", page: "guests", target: "profile-shortcuts", profile: true, title: text("Connect the next booking", "Hubungkan reservasi berikutnya"), copy: text("When available, these shortcuts connect this guest to reservations, deposits and invoices. Deposits belong to a reservation; nothing needs to be created or paid during this tour.", "Jika tersedia, pintasan ini menghubungkan tamu dengan reservasi, deposit, dan invoice. Deposit terhubung ke reservasi; tidak perlu membuat atau membayar apa pun selama tur.") },
      { id: "finish", page: "guests", target: "profile-close", profile: true, action: "finish", title: text("You're ready to explore", "Anda siap menjelajah"), copy: text("Finish the tour to explore at your own pace. Reset Tour is always visible so you can replay this section or choose another guide.", "Selesaikan tur untuk menjelajah sesuai keinginan Anda. Reset Tour selalu terlihat untuk mengulang bagian ini atau memilih panduan lain.") },
    ].filter(item => (!item.id.startsWith("reservation") || hasAccess("reservations")) &&
      (!item.id.startsWith("walkin-") && item.id !== "walkins-nav" || hasAccess("walkins")) &&
      (item.id !== "shortcuts" || hasAccess("reservations")))
      .map((item, index, items) => item.action === "navigate" ? { ...item, page: index ? items[index - 1].page : "dashboard" } : item);
    const guestStart = items.findIndex(item => item.id === "guests-nav");
    if (run?.section === "guests") {
      const guests = items.slice(guestStart);
      guests[0] = { ...guests[0], page: "dashboard" };
      if (mobile()) guests.unshift({ id: "menu", page: "dashboard", target: "mobile-menu", action: "menu", title: text("Open navigation", "Buka navigasi"), copy: text("Open the menu, then choose Guest Database to explore a fictional guest's story.", "Buka menu, lalu pilih Guest Database untuk melihat cerita tamu fiktif.") });
      return guests;
    }
    if (run?.section === "operations") {
      const operations = items.slice(0, guestStart);
      operations.push({ id: "operations-finish", page: operations.at(-1).page, target: operations.at(-1).target, action: "finish", title: text("Your front desk guide is complete", "Panduan meja depan selesai"), copy: text("Explore freely, or use Reset Tour to try Guest Database or the online reservation guide. Restarting a guide does not change demo data.", "Jelajahi dengan bebas, atau gunakan Reset Tour untuk mencoba Database Tamu atau panduan reservasi online. Mengulang panduan tidak mengubah data demo.") });
      return operations;
    }
    return items; // Recover an older, already-active full walkthrough without losing its place.
  }
  function step() { return catalog().find(item => item.id === run?.step); }
  function disposeOverlay() {
    ++generation;
    waitingCancel?.(); waitingCancel = null;
    clearTimeout(refreshTimer);
    clearTimeout(actionTimer); actionTimer = null;
    if (driverObj) { const old = driverObj; driverObj = null; old.destroy(); }
  }
  function button(label, action, className = "demo-tour-link") {
    const node = document.createElement("button");
    node.type = "button"; node.textContent = label; node.className = className;
    node.addEventListener("click", action);
    return node;
  }
  function controls(popover, current, welcome = false) {
    const previous = popover.previousButton;
    if (previous) {
      previous.disabled = welcome || current?.id === catalog()[0].id;
      previous.classList.toggle("driver-popover-btn-disabled", previous.disabled);
      if (!welcome) previous.style.display = "block";
    }
    const next = popover.nextButton;
    if (next) {
      next.disabled = !!current?.action && current.action !== "finish";
      next.classList.toggle("driver-popover-btn-disabled", next.disabled);
      next.textContent = welcome ? text("Start Guided Tour", "Mulai Tur Terpandu") :
        current?.action === "finish" ? text("Finish", "Selesai") : text("Next", "Lanjut");
    }
    const extras = document.createElement("div"); extras.className = "demo-tour-controls";
    if (!welcome) {
      const progress = document.createElement("span"); progress.className = "demo-tour-progress";
      const items = catalog();
      progress.textContent = `${items.findIndex(item => item.id === current.id) + 1} / ${items.length}`;
      extras.append(progress, button(text("Skip", "Lewati"), dismiss));
    }
    extras.append(button(text("Explore Independently", "Jelajahi Mandiri"), () => { welcome ? exit("skipped") : pause(); nudge(); }));
    if (welcome) {
      const choices = document.createElement("div"); choices.className = "demo-tour-sections";
      for (const [id, label] of sections()) {
        if (id !== "online" || hasAccess("reservations")) choices.append(button(label, () => choose(id)));
      }
      popover.description.append(choices);
      next.textContent = text("Start Dashboard Guide", "Mulai Panduan Dashboard");
    }
    popover.wrapper.append(extras);
    popover.wrapper.setAttribute("role", "dialog");
    popover.wrapper.setAttribute("aria-label", welcome ? text("Welcome to the Intoch demo", "Selamat datang di demo Intoch") : current.title);
    next?.focus({ preventScroll: true });
  }
  function driverFor(current, welcome = false) {
    if (!window.driver?.js?.driver) return null;
    return window.driver.js.driver({
      animate: !reduced(), smoothScroll: false, allowClose: true, allowKeyboardControl: false,
      overlayClickBehavior: "none", disableActiveInteraction: !["quick", "reservation-controls", "walkin-controls"].includes(current?.id) && (!current?.action || current.action === "finish"),
      overlayColor: getComputedStyle(document.documentElement).getPropertyValue("--brand-ink").trim() || "black",
      overlayOpacity: 0.38, stagePadding: 6, stageRadius: 12, popoverOffset: 12,
      popoverClass: "intoch-demo-tour", showProgress: false,
      showButtons: welcome ? ["next", "close"] : ["previous", "next", "close"],
      nextBtnText: text("Next", "Lanjut"), prevBtnText: text("Back", "Kembali"),
      onNextClick: () => welcome ? start() : next(), onDoneClick: () => welcome ? start() : next(),
      onPrevClick: back, onCloseClick: dismiss, onDestroyStarted: dismiss,
      onPopoverRender: popover => controls(popover, current, welcome),
      onHighlighted: clampPopover,
    });
  }
  function clampPopover() {
    const popover = document.querySelector(".intoch-demo-tour");
    if (!popover) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const setStyle = (name, value) => { if (popover.style[name] !== value) popover.style[name] = value; };
    setStyle("maxWidth", `${Math.max(0, Math.min(340, width - 24))}px`);
    setStyle("maxHeight", `${Math.max(0, height - 24)}px`);
    const placed = popover.getBoundingClientRect();
    // Driver may place via bottom/right. Combining those with our top/left
    // stretches the fixed box, so retain its position and remove the opposing edges.
    setStyle("bottom", "auto"); setStyle("right", "auto");
    const rect = popover.getBoundingClientRect();
    setStyle("left", `${Math.max(left + 12, Math.min(placed.left, left + width - rect.width - 12))}px`);
    setStyle("top", `${Math.max(top + 12, Math.min(placed.top, top + height - rect.height - 12))}px`);
  }
  function viewportChanged() {
    positionGuidance();
    if (!driverObj) return;
    document.body.style.setProperty("--demo-tour-viewport-width", `${window.visualViewport?.width || window.innerWidth}px`);
    document.body.style.setProperty("--demo-tour-viewport-left", `${window.visualViewport?.offsetLeft || 0}px`);
    driverObj?.refresh(); clampPopover();
  }
  function positionGuidance() {
    const view = window.visualViewport;
    const left = view?.offsetLeft || 0, width = view?.width || innerWidth;
    const top = view?.offsetTop || 0, height = view?.height || innerHeight;
    const set = (node, name, value) => { if (node && node.style[name] !== value) node.style[name] = value; };
    const panel = resetMenu?.querySelector("#demo-tour-sections");
    set(panel, "width", `${Math.min(340, Math.max(0, width - 32))}px`);
    set(panel, "maxHeight", `${Math.max(44, height - 130)}px`);
    for (const node of [resetMenu, ...document.querySelectorAll(".demo-tour-dock")].filter(Boolean)) {
      set(node, "boxSizing", "border-box"); set(node, "maxWidth", `${Math.max(0, width - 32)}px`);
      set(node, "right", "auto");
      set(node, "left", `${Math.max(left + 16, left + width - node.getBoundingClientRect().width - 16)}px`);
      set(node, "bottom", "auto");
      set(node, "top", `${Math.max(top + 16, top + height - node.getBoundingClientRect().height - (node === resetMenu ? 16 : 130))}px`);
    }
  }
  function addEntry() {
    if (!resetMenu) {
      resetMenu = document.createElement("aside"); resetMenu.id = "demo-tour-reset-menu";
      resetMenu.setAttribute("aria-label", text("Demo guides", "Panduan demo"));
      const toggle = button(text("Reset Tour", "Ulangi Tur"), openMenu); toggle.id = "demo-tour-reset";
      toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "demo-tour-sections");
      const panel = document.createElement("div"); panel.id = "demo-tour-sections"; panel.hidden = true;
      const heading = document.createElement("strong"); heading.textContent = text("Which guide would you like to revisit?", "Panduan mana yang ingin diulang?"); panel.append(heading);
      for (const [id, label] of sections()) {
        if (id === "online" && !hasAccess("reservations")) continue;
        const choice = button(label, () => choose(id)); choice.dataset.tourSection = id; panel.append(choice);
      }
      panel.append(button(text("Close", "Tutup"), closeMenu));
      const hint = document.createElement("span"); hint.id = "demo-tour-reset-hint"; hint.setAttribute("role", "status");
      resetMenu.append(panel, hint, toggle); document.body.append(resetMenu);
      positionGuidance();
    }
    const guide = document.getElementById("demo-guide");
    if (!guide || document.getElementById("demo-tour-restart")) return;
    const entry = button(text("Restart Tour", "Ulangi Tur"), event => {
      event.preventDefault(); event.stopPropagation(); openMenu();
    });
    entry.id = "demo-tour-restart"; entry.dataset.tour = "restart";
    guide.querySelector("summary")?.append(entry);
  }
  function closeMenu() {
    if (!resetMenu) return;
    const containedFocus = resetMenu.querySelector("#demo-tour-sections").contains(document.activeElement);
    resetMenu.querySelector("#demo-tour-sections").hidden = true;
    resetMenu.querySelector("#demo-tour-reset").setAttribute("aria-expanded", "false");
    if (containedFocus) resetMenu.querySelector("#demo-tour-reset").focus({ preventScroll: true });
  }
  function openMenu() {
    if (!valid()) return;
    const panel = resetMenu.querySelector("#demo-tour-sections");
    if (!panel.hidden) { closeMenu(); return; }
    panel.hidden = false; resetMenu.querySelector("#demo-tour-reset").setAttribute("aria-expanded", "true");
    panel.querySelector("button")?.focus({ preventScroll: true });
  }
  function choose(section) {
    if (!valid()) return;
    closeMenu();
    if (section === "online") { exit("skipped"); window.DemoBookingTour?.start(); }
    else start(section);
  }
  function nudge() {
    if (!valid() || !resetMenu) return;
    resetMenu.classList.add("demo-tour-reset-highlight");
    resetMenu.querySelector("#demo-tour-reset-hint").textContent = text("Restart any guide here ↓", "Ulangi panduan di sini ↓");
    clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => {
      resetMenu?.classList.remove("demo-tour-reset-highlight");
      if (resetMenu) resetMenu.querySelector("#demo-tour-reset-hint").textContent = "";
    }, 10000);
  }
  function dismiss() { exit("skipped"); nudge(); }
  function showDock(message) {
    dock?.remove();
    dock = document.createElement("aside"); dock.className = "demo-tour-dock";
    dock.setAttribute("aria-label", text("Demo tour", "Tur demo"));
    const label = document.createElement("span"); label.textContent = message;
    label.setAttribute("role", "status");
    dock.append(label, button(text("Resume Tour", "Lanjutkan Tur"), resume),
      button(text("Reset Tour", "Ulangi Tur"), openMenu), button(text("Close", "Tutup"), dismiss));
    document.body.append(dock);
  }
  function discardPendingProfile() {
    if ((pendingAction === "profile" || (step()?.profile && !profileSatisfied)) && typeof cancelGuestProfileRead === "function") cancelGuestProfileRead();
  }
  function pause(message = text("Tour paused. Explore freely, then resume whenever you like.", "Tur dijeda. Jelajahi dengan bebas, lalu lanjutkan kapan saja.")) {
    if (!run || !valid()) return;
    discardPendingProfile();
    disposeOverlay(); clearTimeout(readTimer); run.paused = true; persist(); pendingAction = null;
    showDock(message);
    nudge();
  }
  function restoreFocus() {
    if (visible(lastFocus)) lastFocus.focus({ preventScroll: true });
    else if (valid()) {
      const target = find(anchor("profile-close")) || find(anchor("guest-search")) || find(anchor("restart")) || find(anchor("mobile-menu"));
      target?.focus({ preventScroll: true });
    }
    lastFocus = null;
  }
  function exit(status = "skipped") {
    clearTimeout(welcomeTimer); welcomeTimer = null; offered = true;
    discardPendingProfile();
    if (identity) { store(status); run = null; persist(); }
    disposeOverlay(); clearTimeout(readTimer); dock?.remove(); dock = null; pendingAction = null;
    if (document.body.classList.contains("sidebar-drawer-open") && typeof toggleSidebarDrawer === "function") toggleSidebarDrawer(false);
    restoreFocus();
    if (status === "completed") nudge();
  }
  function welcome() {
    if (!valid() || run || offered || currentPage !== "dashboard" || !dashboardReady) return;
    offered = true; store("offered"); lastFocus = document.activeElement;
    driverObj = driverFor(null, true);
    driverObj?.highlight({ popover: {
      showButtons: ["next", "close"],
      title: text("Try Intoch at your own pace", "Coba Intoch sesuai keinginan Anda"),
      description: text("Choose a guide: front desk operations, guest relationships, or a booking from the online form. Explore independently whenever you like; Reset Tour lets you replay any section.", "Pilih panduan: operasional meja depan, hubungan tamu, atau reservasi dari form online. Jelajahi mandiri kapan saja; Reset Tour memungkinkan Anda mengulang bagian mana pun."),
    } });
  }
  function waitTarget(selector, token, timeout = 5000) {
    return new Promise(resolve => {
      let timer, poll, watch, completed = false;
      const finish = value => { if (completed) return; completed = true; clearTimeout(timer); clearInterval(poll); watch?.disconnect(); waitingCancel = null; resolve(value); };
      const check = () => {
        if (token !== generation || !valid()) return finish(null);
        const element = find(selector);
        if (element) finish(element);
      };
      waitingCancel = () => finish(null);
      watch = new MutationObserver(check); watch.observe(document.body, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(() => finish(null), timeout); poll = setInterval(check, 100); check();
    });
  }
  async function navigate(page) {
    internalNavigation = true;
    try { await navigateTo(page); } finally { internalNavigation = false; }
    return typeof currentPage !== "undefined" && currentPage === page;
  }
  async function show() {
    if (!run || !valid()) return;
    disposeOverlay(); dock?.remove(); dock = null;
    const token = generation, current = step();
    if (!current) return exit("skipped");
    run.paused = false; persist();
    if (currentPage !== current.page && !(await navigate(current.page))) return pause();
    if (token !== generation || !valid() || !run) return;
    if (document.body.classList.contains("sidebar-drawer-open") && (current.action !== "navigate" || !mobile())) toggleSidebarDrawer(false);
    if (current.page === "dashboard" && !dashboardReady) return pause(text("Dashboard data is unavailable. Retry the page, then resume.", "Data dashboard belum tersedia. Coba kembali halaman, lalu lanjutkan."));
    if (current.page in operationsReady && !operationsReady[current.page]) return pause();
    if (!current.profile && profileId && typeof hideModal === "function") {
      internalNavigation = true; hideModal("modal-profile"); profileId = null; profileSatisfied = false; internalNavigation = false;
    }
    if (current.action === "navigate" && mobile() && !document.body.classList.contains("sidebar-drawer-open")) toggleSidebarDrawer(true);
    if (current.profile && (!profileSatisfied || profileId !== sample().id)) {
      if (!sample().id) { run.step = "search"; return show(); }
      internalNavigation = true;
      try { await viewGuestProfile(sample().id); } finally { internalNavigation = false; }
      if (token !== generation || !valid() || !run) return;
      if (!profileSatisfied) return pause(text("Guest details are unavailable. Reopen the profile, then resume.", "Detail tamu belum tersedia. Buka kembali profil, lalu lanjutkan."));
    }
    if (current.profile && mobile()) {
      window.scrollTo({ left: 0, top: window.scrollY, behavior: "instant" });
      document.body.style.setProperty("--demo-tour-viewport-width", `${window.visualViewport?.width || window.innerWidth}px`);
      document.body.style.setProperty("--demo-tour-viewport-left", `${window.visualViewport?.offsetLeft || 0}px`);
    }
    let selector = anchor(current.target);
    if (current.id === "shortcuts") selector += '[data-tour-state="ready"]';
    if (current.id === "preferences" && !find(selector)) selector = anchor("profile-favorite");
    if (current.action === "profile") selector += `[data-tour-guest="${CSS.escape(sample().id)}"]`;
    const element = await waitTarget(selector, token);
    if (token !== generation || !valid() || !run) return;
    if (!element) return pause(text("This part of the demo is not available yet. Explore freely or retry with Resume Tour.", "Bagian demo ini belum tersedia. Jelajahi dengan bebas atau coba Lanjutkan Tur."));
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    driverObj = driverFor(current);
    if (!driverObj) return pause(text("The tour could not load. You can keep exploring.", "Tur belum dapat dimuat. Anda dapat terus menjelajah."));
    const copy = typeof current.copy === "function" ? current.copy() : current.copy;
    // Driver accepts HTML; all dynamic copy (including the reviewed sample name) is escaped.
    const escaped = document.createElement("span"); escaped.textContent = copy;
    driverObj.highlight({ element, popover: { showButtons: ["previous", "next", "close"], title: current.title, description: escaped.innerHTML, side: mobile() ? "bottom" : "right", align: "center" } });
  }
  function start(section = "operations") {
    if (!valid()) return;
    if (!["operations", "guests"].includes(section)) section = "operations";
    closeMenu(); clearTimeout(welcomeTimer); welcomeTimer = null; offered = true;
    if (window.DemoBookingTour) DemoBookingTour.exit();
    lastFocus = document.activeElement;
    searchSatisfied = false; profileSatisfied = false;
    run = { section, step: section === "guests" ? (mobile() ? "menu" : "guests-nav") : "dashboard", guestId: null, guestName: environment().fictionalGuestNames[0], paused: false };
    store("started"); persist(); show().catch(() => pause());
  }
  function resume() {
    if (!valid() || !run) return;
    // Recovery re-establishes successful search/profile reads instead of trusting saved flags.
    if (["open-profile", "search"].includes(run.step) && !searchSatisfied) run.step = "search";
    show().catch(() => pause());
  }
  function next(fromAction = false) {
    if (!valid() || !run || run.paused) return;
    const current = step();
    if (current.action && current.action !== "finish" && !fromAction) return;
    if (current.action === "search") document.querySelector(anchor("guest-search"))?.blur();
    if (current.id === "finish") { exit("completed"); hideModal("modal-profile"); find(anchor("guest-search"))?.focus({ preventScroll: true }); return; }
    if (current.id === "operations-finish") { exit("completed"); return; }
    const items = catalog(), position = items.findIndex(item => item.id === current.id);
    run.step = items[position + 1].id;
    pendingAction = null; clearTimeout(readTimer); persist(); show().catch(() => pause());
  }
  function back() {
    if (!valid() || !run || run.paused) return;
    const items = catalog(), position = items.findIndex(item => item.id === run.step);
    if (position <= 0) return;
    discardPendingProfile();
    run.step = items[position - 1].id; pendingAction = null; clearTimeout(readTimer);
    persist(); show().catch(() => pause());
  }
  function notify(type, detail = {}) {
    if (!valid()) return;
    const current = step();
    if (type === "dashboard-ready") dashboardReady = detail.ok === true;
    if (type === "page-changing") {
      if (detail.page === "guests") guestsReady = false;
      if (detail.page in operationsReady) operationsReady[detail.page] = false;
      if (run && !run.paused && !internalNavigation && current?.page !== detail.page) {
        if (current?.action === "navigate" && detail.page === current.destination && pendingAction === "navigate") disposeOverlay();
        else pause();
      }
    }
    if (type === "page-ready") {
      addEntry();
      if (!run && !offered && !read() && detail.page === "dashboard" && dashboardReady) {
        clearTimeout(welcomeTimer); welcomeTimer = setTimeout(welcome, 350);
      }
      if (run && !run.paused && current?.action === "navigate" && detail.page === current.destination && pendingAction === "navigate" && detail.ok) {
        if (current.destination === "guests" ? guestsReady : operationsReady[current.destination]) next(true);
        else pause(text("This page could not load. Retry it, then resume the tour.", "Halaman ini belum berhasil dimuat. Coba kembali, lalu lanjutkan tur."));
      }
    }
    if (type === "operations-ready" && detail.page in operationsReady) operationsReady[detail.page] = detail.ok === true;
    if (type === "guests-ready") {
      guestsReady = detail.ok === true;
      if (run && detail.ok && !run.guestId) {
        const selected = environment().fictionalGuestNames.map(name => detail.rows?.find(guest => guest.name === name)).find(Boolean);
        if (selected) { run.guestId = selected.id; run.guestName = selected.name; persist(); }
      }
      if (run && !run.paused && current?.action === "search") {
        const selected = sample();
        const matches = detail.ok && detail.search.trim().length >= 2 &&
          detail.rows?.some(guest => guest.id === selected.id && guest.name === selected.name);
        if (matches && find(`${anchor("guest-profile-open")}[data-tour-guest="${CSS.escape(selected.id)}"]`)) {
          searchSatisfied = true; next(true);
        } else if (!detail.ok) pause(text("Guest search could not load. Retry your search, then resume the tour.", "Pencarian tamu belum berhasil. Coba cari kembali, lalu lanjutkan tur."));
        else if (detail.search.trim().toLowerCase() === selected.name.toLowerCase()) pause(text("The sample guest is not in these results. Check the guest filters, then resume and search again.", "Tamu contoh tidak ada dalam hasil ini. Periksa filter tamu, lalu lanjutkan dan cari kembali."));
      }
    }
    if (type === "profile-ready") {
      profileId = detail.guestId;
      profileSatisfied = detail.ok === true && detail.guestId === sample()?.id && detail.name === sample()?.name;
      if (run && !run.paused && current?.action === "profile" && pendingAction === "profile") {
        if (profileSatisfied) next(true);
        else pause(text("The example profile did not load completely. Retry it, then resume.", "Profil contoh belum dimuat lengkap. Coba kembali, lalu lanjutkan."));
      } else if (run && !internalNavigation && detail.guestId !== sample()?.id) pause();
    }
    if (type === "profile-closed") {
      profileId = null; profileSatisfied = false;
      if (run && !internalNavigation && current?.profile) pause();
    }
  }
  function onClick(event) {
    if (!valid() || !run || run.paused) return;
    const current = step(), target = event.target.closest?.("[data-tour]");
    const loading = (current?.action === "navigate" && target?.dataset.tour === current.target) ||
      (current?.action === "profile" && target?.dataset.tour === "guest-profile-open" && target.dataset.tourGuest === sample().id);
    if (loading) {
      pendingAction = current.action; clearTimeout(readTimer);
      const requestedStep = run.step;
      readTimer = setTimeout(() => {
        if (valid() && run && !run.paused && run.step === requestedStep) pause(text("This is taking longer than expected. Explore freely, then retry with Resume Tour.", "Proses ini lebih lama dari biasanya. Jelajahi dengan bebas, lalu coba Lanjutkan Tur."));
      }, 8000);
    }
    if (current?.action === "menu" && target?.dataset.tour === "mobile-menu") {
      const token = generation;
      // A browser can flush microtasks between capture and the target's inline handler.
      // Check in the next task, after toggleSidebarDrawer has actually run.
      actionTimer = setTimeout(() => { if (token === generation && document.body.classList.contains("sidebar-drawer-open")) next(true); }, 0);
    }
  }
  function onKey(event) {
    if (event.key === "Escape" && driverObj) { event.preventDefault(); dismiss(); }
    else if (event.key === "Escape" && resetMenu && !resetMenu.querySelector("#demo-tour-sections").hidden) { closeMenu(); resetMenu.querySelector("#demo-tour-reset").focus({ preventScroll: true }); }
    if (driverObj && event.key === "Tab") {
      // Include the real action target (e.g. search field/eye) in keyboard traversal.
      const current = step(), target = driverObj.getActiveElement();
      const interactive = ["quick", "reservation-controls", "walkin-controls"].includes(current?.id);
      const nodes = [...(current?.action && target ? [target] : []),
        ...(interactive && target ? target.querySelectorAll("input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href]") : []),
        ...document.querySelectorAll(".intoch-demo-tour button:not(:disabled)")].filter(visible);
      if (!nodes.length) return;
      let position = nodes.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1);
      position = (position + nodes.length) % nodes.length;
      event.preventDefault(); event.stopImmediatePropagation(); nodes[position].focus({ preventScroll: true });
    }
  }
  function checkVisibility() {
    if (!valid()) return teardown();
    positionGuidance();
    if (driverObj) clampPopover();
    const current = step();
    if (driverObj && current?.profile && !visible(document.getElementById("modal-profile"))) notify("profile-closed");
    if (driverObj && current && !visible(driverObj.getActiveElement())) {
      clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (run && !run.paused) show().catch(() => pause()); }, 80);
    }
  }
  function resize() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!valid() || !run || run.paused) return;
      if (run.step === "menu" && !mobile()) run.step = catalog().find(item => item.action === "navigate").id;
      show().catch(() => pause());
    }, 180);
  }
  function sessionReady(staff) {
    teardown();
    // Called only by initializeApplication after verified login/restoration and settings loads.
    if (!eligible() || String(getStaffSession().id) !== String(staff?.id)) return;
    identity = String(staff.id); offered = !!read();
    const saved = read(true);
    if (["operations", "guests"].includes(saved?.section)) run = { section: saved.section };
    if (saved?.version === VERSION && catalog().some(item => item.id === saved.step) && environment().fictionalGuestNames.includes(saved.guestName)) {
      run = { section: saved.section, step: saved.step, guestId: saved.guestId, guestName: saved.guestName, paused: true };
      showDock(text("Your tour is saved. Resume whenever you're ready.", "Tur Anda tersimpan. Lanjutkan kapan saja Anda siap."));
    } else run = null;
    addEntry();
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", viewportChanged);
    window.visualViewport?.addEventListener("scroll", viewportChanged);
    observer = new MutationObserver(checkVisibility);
    observer.observe(document.body, { attributes: true, subtree: true, childList: true, attributeFilter: ["class", "hidden", "style"] });
  }
  function teardown() {
    discardPendingProfile();
    clearTimeout(welcomeTimer); welcomeTimer = null;
    clearTimeout(readTimer); readTimer = null;
    observer?.disconnect(); observer = null;
    // Logout clears recovery, but never clears the browser-local seen flag.
    if (identity) {
      try { sessionStorage.removeItem(key(true)); } catch { /* Storage may be disabled. */ }
      run = null;
    }
    disposeOverlay(); dock?.remove(); dock = null;
    document.getElementById("demo-tour-restart")?.remove();
    clearTimeout(nudgeTimer); resetMenu?.remove(); resetMenu = null;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", resize);
    window.visualViewport?.removeEventListener("resize", viewportChanged);
    window.visualViewport?.removeEventListener("scroll", viewportChanged);
    document.body.style.removeProperty("--demo-tour-viewport-width");
    document.body.style.removeProperty("--demo-tour-viewport-left");
    identity = null; offered = false; pendingAction = null; profileId = null;
    profileSatisfied = false; searchSatisfied = false; dashboardReady = false; guestsReady = false;
  }
  window.DemoTour = Object.freeze({ sessionReady, notify, teardown, start, resume, pause, exit, nudge, openMenu });
})();
