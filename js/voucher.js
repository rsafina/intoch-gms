// ============================================================
// VOUCHER CARD (downloadable image)
// ------------------------------------------------------------
// Staff opens a member card, presses "Download Voucher", checks
// the name / code / valid-until in the preview, downloads a PNG,
// then presses "Kirim WA" and attaches that PNG manually.
//
// Design v2 (2026-07-31, ops request): minimalist. The brand
// template (cream, blue logo + tagline, heron watermarks, blue
// social bar) is the background image; only type is drawn on top.
// Nothing is invented here — if the template file changes, the
// card changes with it.
//
// Downloading or sending a voucher does NOT redeem it. Redeem
// stays a separate, deliberate button.
// Changing "Valid Until" DOES write back to member_vouchers, so
// the printed date and the system can never disagree.
// ============================================================

// Matches assets/voucher-bg.jpg exactly. Do not change one without
// the other or every position below shifts.
const VC_W = 1084;
const VC_H = 1940;

const VC_NAVY = "#28547C";
const VC_BLUE = "#4795D0";
const VC_MUTED = "rgba(40,84,124,0.58)";
const VC_HAIR = "rgba(71,149,208,0.45)";

// Safe drawing band on the template: below the tagline arc,
// above the blue social bar (which starts at y=1704).
const VC_TOP = 470;
const VC_BOTTOM = 1660;

// The card background is now configurable: Settings > Branding uploads a
// replacement into the `branding` bucket and vcBackground() picks it up.
//
// It is still NOT a logo swap. This renderer draws text onto the artwork at
// fixed coordinates measured against VC_W x VC_H, so a replacement has to be
// exactly 1084 x 1940 and has to leave the middle band empty. The upload
// screen checks the pixel size and warns before accepting anything else.
// assets/voucher-bg.jpg stays as the fallback for a client who has not
// uploaded their own.
const VC_ASSETS = {
  bg: "assets/voucher-bg.jpg",
};

// brandAsset() lives in config.js and is absent in the node test harness,
// so this degrades to the bundled file rather than throwing.
function vcBackground() {
  try {
    if (typeof brandAsset === "function") return brandAsset("voucher") || VC_ASSETS.bg;
  } catch (_) {}
  return VC_ASSETS.bg;
}

// ── Small helpers ────────────────────────────────────────────
function vcRupiah(n) {
  const v = Number(n) || 0;
  return "Rp " + v.toLocaleString("id-ID");
}

function vcDateId(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// yyyy-mm-dd in LOCAL time, for <input type="date">. Not
// toISOString(): that is UTC and would show yesterday before
// 07:00 Jakarta — the same bug already logged in config.js.
function vcYmd(value) {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Shrink the font until the text fits, then wrap only if it still
// cannot fit at the minimum size. Long member names ("Bapak/Ibu
// Jonathan Sihombing") must never run off the card.
function vcFitLines(ctx, text, maxWidth, font, startPx, minPx) {
  let size = startPx;
  while (size > minPx) {
    ctx.font = font(size);
    if (ctx.measureText(text).width <= maxWidth) return { size, lines: [text] };
    size -= 2;
  }
  ctx.font = font(minPx);
  if (ctx.measureText(text).width <= maxWidth)
    return { size: minPx, lines: [text] };

  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const attempt = line ? line + " " + w : w;
    if (ctx.measureText(attempt).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = attempt;
    }
  });
  if (line) lines.push(line);
  return { size: minPx, lines: lines.slice(0, 2) };
}

// ctx.letterSpacing is not supported everywhere (and is ignored by
// some canvas implementations), so tracked text is drawn per glyph.
function vcTracked(ctx, text, cx, y, spacing) {
  const chars = [...String(text)];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total =
    widths.reduce((a, b) => a + b, 0) + spacing * Math.max(chars.length - 1, 0);
  let x = cx - total / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prev;
}

function vcRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Environment shim ─────────────────────────────────────────
// Browser by default; the node test harness passes its own.
function vcBrowserEnv() {
  return {
    createCanvas(w, h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    },
    loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        // A background served from Supabase Storage is cross-origin, and
        // drawing a cross-origin image onto a canvas TAINTS it: the draw
        // succeeds, and then toDataURL() throws a SecurityError and the
        // download button silently does nothing. Requesting it anonymously
        // (Storage answers with Access-Control-Allow-Origin) keeps the
        // canvas clean. Harmless for the bundled same-origin file.
        if (/^https?:\/\//i.test(String(src))) img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    },
  };
}

// Web fonts must be loaded before the canvas paints or it silently
// falls back to a system serif and the card looks off-brand.
async function vcPreloadFonts() {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  try {
    const base =
      "https://fonts.gstatic.com/s/dmsans/v15/rP2Hp2ywxg089UriCZa4ET-DNl0.woff2";
    const bold =
      "https://fonts.gstatic.com/s/dmsans/v15/rP2Cp2ywxg089UriAaIwXb-_lh2.woff2";
    const serif =
      "https://fonts.gstatic.com/s/cormorantgaramond/v22/co3WmX5slCNuHLi8bLeY9MK7whWMhyjQAllvuQ.woff2";
    await Promise.all([
      new FontFace("DMSans", `url(${base})`).load().then((f) => document.fonts.add(f)),
      new FontFace("DMSans", `url(${bold})`, { weight: "600" })
        .load()
        .then((f) => document.fonts.add(f)),
      new FontFace("Cormorant", `url(${serif})`, { weight: "500" })
        .load()
        .then((f) => document.fonts.add(f)),
    ]);
  } catch (e) {
    // System fonts are an acceptable degradation — never block the card.
    console.warn("voucher: font preload failed, using system fonts", e);
  }
}

// ============================================================
// THE CARD
// data = { name, code, amount, expiresAt, memberNumber, typeLabel }
// ============================================================
async function vcRenderVoucher(data, env) {
  env = env || vcBrowserEnv();
  const sans = (px, weight) =>
    `${weight || 400} ${px}px DMSans, "DM Sans", Helvetica, Arial, sans-serif`;
  const serif = (px) =>
    `500 ${px}px Cormorant, "Cormorant Garamond", Georgia, serif`;

  const canvas = env.createCanvas(VC_W, VC_H);
  const ctx = canvas.getContext("2d");

  // Cream first: if the template fails to load, the card is still a
  // readable cream voucher rather than a black rectangle.
  ctx.fillStyle = "#F9F5F2";
  ctx.fillRect(0, 0, VC_W, VC_H);

  // Falls back to the bundled artwork if the uploaded one fails to load, so
  // a broken storage URL costs the client a generic card, not a blank one.
  let bg = await env.loadImage(vcBackground()).catch(() => null);
  if (!bg && vcBackground() !== VC_ASSETS.bg)
    bg = await env.loadImage(VC_ASSETS.bg).catch(() => null);
  if (bg) ctx.drawImage(bg, 0, 0, VC_W, VC_H);

  const CX = VC_W / 2;
  const SAFE = 800; // max text width
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ── Title ─────────────────────────────────────────────────
  ctx.fillStyle = VC_HAIR;
  ctx.fillRect(CX - 32, VC_TOP + 20, 64, 2);

  ctx.fillStyle = VC_BLUE;
  ctx.font = sans(28, 600);
  vcTracked(ctx, "VOUCHER DINE IN", CX, VC_TOP + 96, 8);

  // ── Recipient ─────────────────────────────────────────────
  ctx.fillStyle = VC_MUTED;
  ctx.font = sans(23);
  vcTracked(ctx, "DIBERIKAN KEPADA", CX, VC_TOP + 200, 5);

  const name = (data.name || "").trim() || "Tamu " + restaurantName();
  const fit = vcFitLines(ctx, name, SAFE, serif, 88, 48);
  ctx.fillStyle = VC_NAVY;
  ctx.font = serif(fit.size);
  let y = VC_TOP + 300;
  fit.lines.forEach((ln, i) => ctx.fillText(ln, CX, y + i * (fit.size + 6)));
  y += (fit.lines.length - 1) * (fit.size + 6);

  ctx.fillStyle = VC_HAIR;
  ctx.fillRect(CX - 150, y + 46, 300, 1);

  // ── Amount ────────────────────────────────────────────────
  ctx.fillStyle = VC_MUTED;
  ctx.font = sans(22);
  vcTracked(ctx, "NILAI VOUCHER", CX, y + 132, 5);

  // Membership vouchers are always a rupiah amount. Standalone gift
  // vouchers (js/vouchers.js) can also be a percentage or a free item,
  // and pass the already-formatted text through valueText. Nothing else
  // about the card changes, so the two kinds look like the same brand.
  const amountText = data.valueText || vcRupiah(data.amount);
  // A free-item description is a sentence, not a figure — it needs to be
  // allowed to shrink much further before it wraps off the card.
  const afit = vcFitLines(ctx, amountText, SAFE, serif, 128, data.valueText ? 44 : 76);
  ctx.fillStyle = VC_NAVY;
  ctx.font = serif(afit.size);
  afit.lines.forEach((ln, i) =>
    ctx.fillText(ln, CX, y + 254 + i * (afit.size + 4)),
  );

  // ── Code ──────────────────────────────────────────────────
  ctx.fillStyle = VC_MUTED;
  ctx.font = sans(20);
  vcTracked(ctx, "KODE VOUCHER", CX, y + 336, 5);

  const code = (data.code || "").trim() || "—";
  const pillW = 520;
  const pillH = 88;
  const pillX = CX - pillW / 2;
  const pillY = y + 366;
  vcRoundRect(ctx, pillX, pillY, pillW, pillH, 12);
  ctx.strokeStyle = VC_HAIR;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = VC_NAVY;
  let codeSize = 40;
  ctx.font = sans(codeSize, 600);
  // Tracked text is wider than measureText suggests — budget for it.
  while (codeSize > 22 && ctx.measureText(code).width + code.length * 6 > pillW - 60) {
    codeSize -= 2;
    ctx.font = sans(codeSize, 600);
  }
  vcTracked(ctx, code, CX, pillY + pillH / 2 + codeSize / 3, 6);

  // ── Valid until ───────────────────────────────────────────
  const exp = vcDateId(data.expiresAt);
  ctx.fillStyle = VC_MUTED;
  ctx.font = sans(20);
  vcTracked(ctx, "VALID UNTIL", CX, pillY + pillH + 78, 5);

  ctx.fillStyle = exp ? VC_NAVY : VC_MUTED;
  ctx.font = serif(46);
  ctx.fillText(exp || "— tanggal belum diatur —", CX, pillY + pillH + 142);

  // ── Member + terms ────────────────────────────────────────
  const memberLine = [data.memberNumber, data.typeLabel].filter(Boolean).join("  ·  ");
  if (memberLine) {
    ctx.fillStyle = VC_MUTED;
    ctx.font = sans(23);
    ctx.fillText(memberLine, CX, pillY + pillH + 206);
  }

  ctx.fillStyle = "rgba(40,84,124,0.45)";
  ctx.font = sans(20);
  ctx.fillText(
    "Berlaku untuk satu kali transaksi. Tidak dapat diuangkan.",
    CX,
    pillY + pillH + 280,
  );
  ctx.fillText(
    "Tunjukkan voucher ini kepada staf kami saat pembayaran.",
    CX,
    pillY + pillH + 314,
  );

  return canvas;
}

// ============================================================
// UI: preview modal, download, WhatsApp hand-off
// ============================================================

// Fresh copy of the voucher + member being previewed. Always re-fetched
// on open — a voucher that was redeemed on another till 30 seconds ago
// must not be downloadable from a stale list.
let vcCurrent = null;
let vcRenderToken = 0;

function vcExpired(v) {
  return !!v.expires_at && new Date(v.expires_at) < new Date();
}

// focus = "wa" when opened from the "Kirim WA Follow Up" button: the
// image still has to be downloaded and attached by hand, so the modal
// is the same, but the WA button is ringed so staff sees where to go.
async function vcOpenCard(voucherId, focus) {
  loader(true);
  const { data: v, error } = await supabaseQuery(
    () =>
      db
        .from("member_vouchers")
        // "*" on purpose, not a column list: before the 20260731 migration
        // runs there is no voucher_code / expires_at column, and naming them
        // makes PostgREST reject the whole request (42703 -> 400). With "*"
        // the card simply opens without a code or an expiry date.
        .select(
          "*, members(id, guest_id, full_name, member_number, member_type, phone_number)",
        )
        .eq("id", voucherId)
        .single(),
    "Gagal memuat voucher",
  );
  loader(false);
  if (error || !v) return;

  // GUARDRAIL: a redeemed voucher must never be printed again — that is
  // how one voucher gets spent twice.
  if (v.redeemed) {
    toast(
      "Voucher ini sudah ditukar" +
        (v.redeemed_at ? ` pada ${fmt.date(v.redeemed_at)}` : "") +
        " — tidak bisa dicetak lagi.",
      "error",
    );
    return;
  }
  if (vcExpired(v)) {
    toast(
      `Voucher ini sudah kadaluarsa (${vcDateId(v.expires_at)}). Ubah tanggal Valid Until dulu kalau tetap mau diberikan.`,
      "error",
    );
    return;
  }

  vcCurrent = v;
  const m = v.members || {};
  document.getElementById("vc-name").value = m.full_name || "";
  document.getElementById("vc-code").value = v.voucher_code || "";
  document.getElementById("vc-code-warning").classList.add("hidden");

  const dateEl = document.getElementById("vc-expires");
  if (dateEl) {
    dateEl.value = vcYmd(v.expires_at);
    dateEl.min = vcYmd(); // today — never print a dead voucher
    document.getElementById("vc-date-status").textContent = "";
  }

  setText(
    "vc-meta",
    [vcRupiah(v.voucher_amount), m.member_number].filter(Boolean).join(" · "),
  );

  const waBtn = document.getElementById("vc-wa-btn");
  if (waBtn) {
    waBtn.classList.toggle("ring-2", focus === "wa");
    waBtn.classList.toggle("ring-[#1FAF5E]", focus === "wa");
  }

  showModal("modal-voucher-card");
  vcRefreshPreview();
}

function vcTypeLabel(type) {
  return (
    (typeof MEMBER_RULES !== "undefined" && MEMBER_RULES[type]?.label) ||
    (type ? `${type} Card` : null)
  );
}

function vcFormData() {
  const v = vcCurrent || {};
  const m = v.members || {};
  const typed = document.getElementById("vc-expires")?.value;
  return {
    name: document.getElementById("vc-name")?.value || m.full_name || "",
    code: document.getElementById("vc-code")?.value || v.voucher_code || "",
    amount: v.voucher_amount,
    // Preview follows the picker immediately; the DB catches up on save.
    expiresAt: typed ? `${typed}T23:59:59` : v.expires_at,
    memberNumber: m.member_number,
    typeLabel: vcTypeLabel(v.voucher_type || m.member_type),
  };
}

// Editing the code is allowed (staff sometimes need to match a printed
// batch) but a code that no longer matches the system record cannot be
// traced back, so say so loudly instead of silently accepting it.
function vcOnCodeInput() {
  const el = document.getElementById("vc-code-warning");
  if (!el || !vcCurrent) return;
  const typed = (document.getElementById("vc-code").value || "").trim();
  el.classList.toggle("hidden", typed === (vcCurrent.voucher_code || ""));
  vcRefreshPreview();
}

function vcResetCode() {
  if (!vcCurrent) return;
  document.getElementById("vc-code").value = vcCurrent.voucher_code || "";
  vcOnCodeInput();
}

// ── Valid Until ──────────────────────────────────────────────
// Saved to member_vouchers.expires_at, not just printed. A date that
// only exists on the image would let Redeem refuse a voucher whose
// printed date says it is still valid.
async function vcOnDateChange() {
  if (!vcCurrent) return;
  const el = document.getElementById("vc-expires");
  const status = document.getElementById("vc-date-status");
  const val = el?.value;

  if (!val) {
    status.className = "text-[11px] text-[#B45309] mt-1";
    status.textContent = "Tanggal tidak boleh kosong.";
    return;
  }
  // The picker's min attribute is not enough: it is trivially bypassed
  // by typing the date instead of clicking it.
  if (val < vcYmd()) {
    status.className = "text-[11px] text-[#B45309] mt-1";
    status.textContent = "Tanggal sudah lewat — pilih hari ini atau setelahnya.";
    el.value = vcYmd(vcCurrent.expires_at);
    vcRefreshPreview();
    return;
  }

  vcRefreshPreview();

  if (vcYmd(vcCurrent.expires_at) === val) {
    status.textContent = "";
    return;
  }

  status.className = "text-[11px] text-[#999] mt-1";
  status.textContent = "Menyimpan…";

  // End of that day, Jakarta, matching what the DB trigger stamps —
  // otherwise a voucher would die at midnight UTC, i.e. 07:00 local.
  const iso = new Date(`${val}T23:59:59+07:00`).toISOString();
  const { error } = await supabaseQuery(
    () =>
      db.from("member_vouchers").update({ expires_at: iso }).eq("id", vcCurrent.id),
    "Gagal menyimpan tanggal voucher",
  );

  if (error) {
    status.className = "text-[11px] text-red-500 mt-1";
    status.textContent = "Gagal menyimpan. Jangan dicetak dulu, coba lagi.";
    return;
  }

  vcCurrent.expires_at = iso;
  status.className = "text-[11px] text-[#1FAF5E] mt-1";
  status.textContent = "Tersimpan. Tanggal ini juga berlaku di sistem.";
  if (typeof viewMemberDetail === "function" && typeof currentMemberId !== "undefined" && currentMemberId)
    viewMemberDetail(currentMemberId);
}

let vcPreviewTimer = null;
function vcRefreshPreview() {
  clearTimeout(vcPreviewTimer);
  vcPreviewTimer = setTimeout(async () => {
    const token = ++vcRenderToken;
    const holder = document.getElementById("vc-preview");
    if (!holder) return;
    try {
      await vcPreloadFonts();
      const canvas = await vcRenderVoucher(vcFormData());
      // A slower earlier render must not overwrite a newer one.
      if (token !== vcRenderToken) return;
      canvas.className = "w-full rounded-xl shadow-md";
      holder.innerHTML = "";
      holder.appendChild(canvas);
      holder.dataset.ready = "1";
    } catch (e) {
      console.error("voucher render failed", e);
      holder.innerHTML =
        '<p class="text-xs text-red-500 p-4">Gagal membuat gambar voucher. Coba tutup dan buka lagi.</p>';
      holder.dataset.ready = "";
    }
  }, 180);
}

function vcSafeFileName(s) {
  return String(s || "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function vcDownload() {
  if (!vcCurrent) return;
  const btn = document.getElementById("vc-download-btn");
  const original = btn ? btn.innerHTML : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Menyiapkan…";
  }
  try {
    await vcPreloadFonts();
    const data = vcFormData();
    const canvas = await vcRenderVoucher(data);
    const link = document.createElement("a");
    link.download = `Voucher-${vcSafeFileName(data.code)}-${vcSafeFileName(data.name)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("Gambar voucher tersimpan. Lampirkan manual di WhatsApp ya.", "success");
  } catch (e) {
    console.error(e);
    toast("Gagal menyimpan gambar voucher.", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

function vcVoucherMessage(data, guestName) {
  return waRenderTemplate(waTemplateBody("voucher_ready"), {
    nama: waGreetName(guestName),
    resto: WA_RESTAURANT_NAME,
    nominal: vcRupiah(data.amount),
    kode: data.code || "-",
    berlaku: vcDateId(data.expiresAt) || "-",
  });
}

async function vcSendWA() {
  if (!vcCurrent) return;
  await waLoadTemplates();

  // Re-check status: the voucher may have been redeemed while this modal
  // sat open on a busy front desk.
  const { data: fresh } = await supabaseQuery(
    () => db.from("member_vouchers").select("*").eq("id", vcCurrent.id).single(),
    "Gagal cek status voucher",
  );
  if (fresh?.redeemed) {
    toast("Voucher ini baru saja ditukar — jangan dikirim.", "error");
    hideModal("modal-voucher-card");
    if (typeof viewMemberDetail === "function" && currentMemberId)
      viewMemberDetail(currentMemberId);
    return;
  }
  if (fresh && vcExpired(fresh)) {
    toast("Voucher ini sudah kadaluarsa — ubah tanggal Valid Until dulu.", "error");
    return;
  }

  const m = vcCurrent.members || {};
  const data = vcFormData();
  // The member's own name is edited on the card; the greeting should use
  // the same name staff just confirmed, not a stale DB value.
  const opened = waOpenChat(m.phone_number, vcVoucherMessage(data, data.name));
  if (opened) {
    waLogSend(m.guest_id, "voucher_ready", false);
    toast(
      "WhatsApp terbuka. Jangan lupa LAMPIRKAN gambar voucher sebelum kirim.",
      "success",
    );
  }
}

// Node harness export (browser ignores this)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { vcRenderVoucher, vcRupiah, vcDateId, vcYmd, vcFitLines, VC_ASSETS };
}
