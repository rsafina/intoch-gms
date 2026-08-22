// Standalone voucher tests.
//
// The database is faked (a small in-memory stand-in for the Supabase
// client) so the whole issue → card → redeem path can run headlessly.
// What is being checked is the part that costs real money if it is
// wrong: that a voucher cannot be redeemed twice, cannot be redeemed
// after expiry without a deliberate override, that a batch is one
// batch, and that the value written to the row matches what the card
// promises.
//
// The SQL guards are the real defence — this suite proves the client
// asks for the right thing and reacts correctly to each refusal.
//
// Run: node js/vouchers.test.js   (needs: npm i jsdom)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const dom = new JSDOM(read("index.html"), {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const w = dom.window;
global.window = w;
global.document = w.document;

let fails = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label}: ${actual}${ok ? "" : `  (expected ${expected})`}`,
  );
}

// ── Fake database ───────────────────────────────────────────
// Mirrors the parts of the migration the client depends on: the code
// trigger, the expiry default, and the three redeem guards.
const store = { rows: [], nextId: 1, guests: [] };

function applyDefaults(row) {
  const r = { ...row, id: store.nextId++ };
  if (!r.voucher_code) r.voucher_code = "BHV-" + String(r.id).padStart(5, "0");
  if (!r.issued_at) r.issued_at = new Date().toISOString();
  r.redeemed = !!r.redeemed;
  r.voided = !!r.voided;
  return r;
}

const rpcCalls = [];
const fakeDb = {
  from(table) {
    const q = {
      _table: table,
      _filters: [],
      select() {
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      eq(col, val) {
        q._filters.push([col, val]);
        return q;
      },
      // Good enough for the two shapes the app uses:
      // "col.ilike.%term%,col2.ilike.%term%"
      or(expr) {
        q._or = String(expr)
          .split(",")
          .map((part) => {
            const [col, , pattern] = part.split(".");
            return [col, (pattern || "").replace(/%/g, "").toLowerCase()];
          });
        return q;
      },
      insert(rows) {
        q._insert = rows;
        return q;
      },
      update(patch) {
        q._update = patch;
        return q;
      },
      _rows() {
        if (table === "guests") return store.guests;
        if (table === "app_settings")
          return [{ key: "vouchers", value: { standalone_validity_days: 60 } }];
        return store.rows;
      },
      _match() {
        let rows = q
          ._rows()
          .filter((r) => q._filters.every(([c, v]) => String(r[c]) === String(v)));
        if (q._or)
          rows = rows.filter((r) =>
            q._or.some(([col, needle]) =>
              String(r[col] || "").toLowerCase().includes(needle),
            ),
          );
        return rows;
      },
      maybeSingle() {
        return Promise.resolve({ data: q._match()[0] || null, error: null });
      },
      single() {
        return Promise.resolve({ data: q._match()[0] || null, error: null });
      },
      then(resolve) {
        if (q._update) {
          q._match().forEach((r) => Object.assign(r, q._update));
          return resolve({ data: null, error: null });
        }
        if (q._insert) {
          const made = q._insert.map(applyDefaults);
          store.rows.push(...made);
          return resolve({ data: made, error: null });
        }
        return resolve({ data: q._match(), error: null });
      },
    };
    return q;
  },
  rpc(name, args) {
    rpcCalls.push({ name, args });
    const row = store.rows.find(
      (r) => r.voucher_code === String(args.p_code || "").toUpperCase().trim(),
    );
    const fail = (code) => Promise.resolve({ data: null, error: { message: code } });
    if (!row) return fail("VOUCHER_NOT_FOUND");
    if (name === "void_standalone_voucher") {
      if (row.redeemed) return fail("VOUCHER_ALREADY_REDEEMED");
      row.voided = true;
      row.void_reason = args.p_reason;
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    if (row.voided) return fail("VOUCHER_VOIDED");
    if (row.redeemed) return fail("VOUCHER_ALREADY_REDEEMED");
    if (!args.p_allow_expired && row.expires_at && new Date(row.expires_at) < new Date())
      return fail("VOUCHER_EXPIRED");
    row.redeemed = true;
    row.redeemed_at = new Date().toISOString();
    row.redeemed_by = args.p_redeemed_by;
    return Promise.resolve({ data: { ok: true }, error: null });
  },
};

// ── Stubs for the bits of the app vouchers.js leans on ──────
const toasts = [];
w.db = fakeDb;
w.toast = (m, kind) => toasts.push({ msg: m, kind: kind || "success" });
w.loader = () => {};
w.currentStaffId = () => "staff-1";
w.showModal = (id) => document.getElementById(id)?.classList.remove("hidden");
w.hideModal = (id) => document.getElementById(id)?.classList.add("hidden");
w.supabaseQuery = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return { data: null, error: e };
  }
};
w.CURRENT_LANG = "en";
w.confirm = () => true;
w.prompt = () => "Issued by mistake";
// The card draws on a canvas jsdom does not implement; the drawing
// itself is the membership card's own concern.
w.vcPreloadFonts = async () => {};
w.vcRenderVoucher = async (data) => {
  w.__lastCard = data;
  // A real element, because the modal appends it to the DOM.
  const c = w.document.createElement("canvas");
  c.toDataURL = () => "data:image/png;base64,AA";
  return c;
};
w.waOpenChat = (phone, message) => {
  w.__lastWa = { phone, message };
};
w.waGreetName = (n) => n;

// The probe is the only way to read `let` bindings back out: they live
// in the eval's own scope, not on window. In the browser these are
// ordinary globals shared with the rest of the app.
w.eval(
  read("js/vouchers.js") +
    "\n;window.__probe = { get lookedUp() { return vchLookedUp; }," +
    " get rows() { return vchRows; }, get picked() { return vchPickedGuest; },"+
    " get matches() { return vchMatches; } };",
);

const $ = (id) => w.document.getElementById(id);
const set = (id, v) => {
  $(id).value = v;
  $(id).dispatchEvent(new w.Event("input", { bubbles: true }));
  $(id).dispatchEvent(new w.Event("change", { bubbles: true }));
};
const lastToast = () => toasts[toasts.length - 1] || {};
const ymdIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

(async () => {
  w.initVouchers();
  await new Promise((r) => setTimeout(r, 30));

  console.log("\n== 1. Issuing refuses what the database would refuse ==");
  set("vch-occasion", "top_spender");
  set("vch-expires", ymdIn(30));
  await w.vchIssue();
  check("no recipient is blocked", /Add a recipient/.test(lastToast().msg), "true");

  set("vch-name", "Ibu Anung");
  w.vchSetValueType("amount");
  set("vch-amount", "");
  await w.vchIssue();
  check("missing amount is blocked", /Enter the voucher amount/.test(lastToast().msg), "true");

  w.vchSetValueType("percent");
  set("vch-percent", "120");
  await w.vchIssue();
  check("percentage over 100 is blocked", /between 1 and 100/.test(lastToast().msg), "true");

  w.vchSetValueType("amount");
  set("vch-amount", "100.000");
  set("vch-expires", ymdIn(-1));
  await w.vchIssue();
  check("past expiry is blocked", /in the past/.test(lastToast().msg), "true");

  set("vch-occasion", "partnership");
  set("vch-partner", "");
  set("vch-expires", ymdIn(30));
  await w.vchIssue();
  check("partnership without a partner is blocked", /Name the partner/.test(lastToast().msg), "true");
  check("nothing was written", store.rows.length, 0);

  console.log("\n== 2. A single voucher ==");
  set("vch-occasion", "top_spender");
  set("vch-name", "Ibu Anung");
  set("vch-phone", "081234567890");
  set("vch-amount", "100.000");
  set("vch-min-spend", "500.000");
  set("vch-expires", ymdIn(30));
  await w.vchIssue();
  await new Promise((r) => setTimeout(r, 20));
  check("one row written", store.rows.length, 1);
  const v1 = store.rows[0];
  check("code generated", v1.voucher_code, "BHV-00001");
  check("amount parsed from a dotted figure", v1.value_idr, 100000);
  check("minimum spend stored", v1.min_spend_idr, 500000);
  check("expiry is end of day Jakarta", /T16:59:59/.test(v1.expires_at), "true");
  check("issuer recorded", v1.issued_by, "staff-1");
  check("card opened for a single voucher", w.__lastCard?.code, "BHV-00001");
  check("card shows the rupiah value", w.__lastCard?.valueText, "Rp 100.000");
  check("form cleared", $("vch-name").value, "");

  console.log("\n== 3. A batch is one batch ==");
  set("vch-occasion", "partnership");
  set("vch-partner", "tiket.com");
  set("vch-batch-label", "Tiket.com Agustus");
  set("vch-amount", "50.000");
  set("vch-qty", "25");
  set("vch-expires", ymdIn(60));
  const cardBefore = w.__lastCard;
  await w.vchIssue();
  await new Promise((r) => setTimeout(r, 20));
  const batch = store.rows.filter((r) => r.partner_name === "tiket.com");
  check("25 rows written", batch.length, 25);
  check("one batch_id across all of them", new Set(batch.map((r) => r.batch_id)).size, 1);
  check("codes are unique", new Set(batch.map((r) => r.voucher_code)).size, 25);
  check("bearer vouchers need no name", batch[0].recipient_name, "null");
  check("no card modal for a batch", w.__lastCard === cardBefore, "true");
  check("toast reports the count", /25 vouchers issued/.test(lastToast().msg), "true");

  console.log("\n== 4. A batch cannot be pinned to one guest ==");
  set("vch-occasion", "birthday");
  w.vchPickGuest(0); // nothing searched yet, so this must be a safe no-op
  check("picking nothing is harmless", $("vch-name").value, "");
  store.guests.push({ id: "guest-1", name: "Pak Budi", phone: "0811" });
  // Driven through the real search path: vchGuestResults is a module
  // binding the harness cannot assign to from outside.
  w.vchSearchGuests("Budi");
  await new Promise((r) => setTimeout(r, 350));
  w.vchPickGuest(0);
  check("guest linked", $("vch-name").value, "Pak Budi");
  set("vch-qty", "10");
  set("vch-amount", "50.000");
  await w.vchIssue();
  check("blocked", /batch cannot be linked to one guest/.test(lastToast().msg), "true");
  set("vch-qty", "1");
  set("vch-occasion", "birthday");
  await w.vchIssue();
  await new Promise((r) => setTimeout(r, 20));
  const linked = store.rows[store.rows.length - 1];
  check("guest_id stored", linked.guest_id, "guest-1");
  check("name snapshotted alongside it", linked.recipient_name, "Pak Budi");

  console.log("\n== 5. Redeeming ==");
  set("vch-redeem-code", "bhv-00001"); // lower case, as typed off a phone
  await w.vchLookup();
  check("found despite the case", w.__probe.lookedUp?.voucher_code, "BHV-00001");
  check("status is open", w.vchStatus(w.__probe.lookedUp), "open");
  check(
    "minimum spend surfaced before redeeming",
    /Minimum spend/.test($("vch-redeem-result").innerHTML),
    "true",
  );
  await w.vchRedeem(false);
  await new Promise((r) => setTimeout(r, 20));
  check("redeemed", store.rows[0].redeemed, "true");
  check("who redeemed it recorded", store.rows[0].redeemed_by, "staff-1");
  check("confirmation shown", /Redeemed BHV-00001/.test(lastToast().msg), "true");

  await w.vchRedeem(false);
  await new Promise((r) => setTimeout(r, 20));
  check("second attempt refused", /Already redeemed/.test(lastToast().msg), "true");

  console.log("\n== 6. Expiry ==");
  const expired = applyDefaults({
    occasion: "other",
    recipient_name: "Late Guest",
    value_type: "amount",
    value_idr: 75000,
    expires_at: new Date(Date.now() - 86400000).toISOString(),
  });
  store.rows.push(expired);
  set("vch-redeem-code", expired.voucher_code);
  await w.vchLookup();
  check("status is expired", w.vchStatus(w.__probe.lookedUp), "expired");
  check(
    "the override is labelled, not hidden",
    /Redeem anyway/.test($("vch-redeem-result").innerHTML),
    "true",
  );
  await w.vchRedeem(false);
  await new Promise((r) => setTimeout(r, 20));
  check("plain redeem refused", /Expired/.test(lastToast().msg), "true");
  check("still unredeemed", expired.redeemed, "false");
  await w.vchRedeem(true);
  await new Promise((r) => setTimeout(r, 20));
  check("override works", expired.redeemed, "true");
  check(
    "override is attributed to whoever did it",
    expired.redeemed_by,
    "staff-1",
  );

  console.log("\n== 7. Cancelling ==");
  const spare = store.rows.find((r) => !r.redeemed && !r.voided);
  set("vch-redeem-code", spare.voucher_code);
  await w.vchLookup();
  await w.vchVoid();
  await new Promise((r) => setTimeout(r, 20));
  check("voided", spare.voided, "true");
  check("reason recorded", spare.void_reason, "Issued by mistake");
  await w.vchRedeem(false);
  await new Promise((r) => setTimeout(r, 20));
  check("a cancelled voucher cannot be redeemed", spare.redeemed, "false");
  set("vch-redeem-code", store.rows[0].voucher_code); // already redeemed
  await w.vchLookup();
  await w.vchVoid();
  await new Promise((r) => setTimeout(r, 20));
  check(
    "a redeemed voucher cannot be cancelled",
    /cannot be cancelled/.test(lastToast().msg),
    "true",
  );

  console.log("\n== 8. Unknown codes explain themselves ==");
  set("vch-redeem-code", "BHV-99999");
  await w.vchLookup();
  check("says so plainly", /Nothing found for/.test($("vch-redeem-result").innerHTML), "true");
  set("vch-redeem-code", "BH-F21-0007");
  await w.vchLookup();
  check(
    "membership codes point at the right screen",
    /membership voucher code/.test($("vch-redeem-result").innerHTML),
    "true",
  );

  console.log("\n== 9. Percent and item vouchers ==");
  w.vchSetValueType("percent");
  set("vch-occasion", "birthday");
  w.vchClearGuest();
  set("vch-name", "Bu Yani's friend");
  set("vch-percent", "20");
  set("vch-percent-cap", "150.000");
  set("vch-qty", "1");
  set("vch-expires", ymdIn(30));
  await w.vchIssue();
  await new Promise((r) => setTimeout(r, 20));
  const pct = store.rows[store.rows.length - 1];
  check("percent stored", pct.value_percent, 20);
  check("cap stored", pct.percent_cap_idr, 150000);
  check("cap also counts as the budget figure", pct.value_idr, 150000);
  check("card reads as a discount", w.__lastCard.valueText, "20% OFF");
  check("list text carries the cap", w.vchValueText(pct), "20% (max Rp 150.000)");

  // Issuing clears the whole form, recipient included, so a second
  // voucher starts from scratch — as it should.
  w.vchSetValueType("item");
  set("vch-name", "Chef's colleague");
  set("vch-expires", ymdIn(30));
  set("vch-item", "One free dessert");
  set("vch-item-cost", "45.000");
  await w.vchIssue();
  await new Promise((r) => setTimeout(r, 20));
  const item = store.rows[store.rows.length - 1];
  check("item stored", item.value_item, "One free dessert");
  check("cost is the budget figure", item.value_idr, 45000);
  check("card prints the item", w.__lastCard.valueText, "One free dessert");

  console.log("\n== 10. WhatsApp hand-off ==");
  await w.vchOpenCard(store.rows[1]); // batch voucher, no phone
  await w.vchSendCardWA();
  check("no phone is refused", /No phone number/.test(lastToast().msg), "true");
  const withPhone = store.rows.find((r) => r.recipient_phone && !r.redeemed && !r.voided);
  await w.vchOpenCard(withPhone);
  await w.vchSendCardWA();
  check("message carries the code", w.__lastWa.message.includes(withPhone.voucher_code), "true");
  check("message carries the value", /Nilai:/.test(w.__lastWa.message), "true");
  // Redeemed under the modal, which is what a busy front desk does.
  withPhone.redeemed = true;
  await w.vchSendCardWA();
  check(
    "a spent voucher is not sent",
    /just redeemed/.test(lastToast().msg),
    "true",
  );

  console.log("\n== 11. Finding a voucher by name ==");
  // The till case: a guest says their name, nobody retypes a code.
  set("vch-redeem-code", "Anung");
  await w.vchLookup();
  check(
    "found by name",
    (w.__probe.lookedUp || {}).recipient_name || w.__probe.matches[0].recipient_name,
    "Ibu Anung",
  );
  set("vch-redeem-code", "tiket.com");
  await w.vchLookup();
  check("partner name matches the whole batch", w.__probe.matches.length > 1, "true");
  check("no voucher auto-selected when several match", w.__probe.lookedUp, "null");
  check(
    "the list is offered instead",
    /vouchers found\. Pick the right one/.test($("vch-redeem-result").innerHTML),
    "true",
  );
  check(
    "redeemable ones are listed first",
    w.vchStatus(w.__probe.matches[0]),
    "open",
  );
  w.vchPickMatch(0);
  check("picking one opens it", w.__probe.lookedUp.voucher_code.startsWith("BHV-"), "true");
  check(
    "and offers a way back to the list",
    /Back to the/.test($("vch-redeem-result").innerHTML),
    "true",
  );
  set("vch-redeem-code", "0812345");
  await w.vchLookup();
  check("phone works too", (w.__probe.lookedUp || {}).recipient_phone, "081234567890");
  set("vch-redeem-code", "");
  await w.vchLookup();
  check("an empty search clears the panel", $("vch-redeem-result").innerHTML, "");

  console.log("\n== 12. The line printed on the card ==");
  const anyRow = store.rows.find((r) => r.occasion === "top_spender");
  await w.vchOpenCard(anyRow);
  check("falls back to the occasion", w.__lastCard.typeLabel, "Top spender thank you");
  check("edit box is empty, showing the fallback as placeholder", $("vch-card-label-edit").value, "");
  check(
    "placeholder is the occasion",
    $("vch-card-label-edit").placeholder,
    "Top spender thank you",
  );
  $("vch-card-label-edit").value = "Terima kasih sudah jadi tamu setia kami";
  await w.vchSaveCardLabel();
  await new Promise((r) => setTimeout(r, 20));
  check("saved to the row, not just the preview", anyRow.card_label, "Terima kasih sudah jadi tamu setia kami");
  check("card redrawn with it", w.__lastCard.typeLabel, "Terima kasih sudah jadi tamu setia kami");
  check("occasion untouched, so reporting still groups", anyRow.occasion, "top_spender");
  $("vch-card-label-edit").value = "   ";
  await w.vchSaveCardLabel();
  await new Promise((r) => setTimeout(r, 20));
  check("blanking it restores the fallback", anyRow.card_label, "null");
  check("card shows the occasion again", w.__lastCard.typeLabel, "Top spender thank you");

  console.log("\n== 13. Status is derived, never stale ==");
  check("open", w.vchStatus({ expires_at: new Date(Date.now() + 8.64e7).toISOString() }), "open");
  check("expired", w.vchStatus({ expires_at: new Date(Date.now() - 8.64e7).toISOString() }), "expired");
  check("redeemed beats expired", w.vchStatus({ redeemed: true, expires_at: "2000-01-01" }), "redeemed");
  check("void beats everything", w.vchStatus({ voided: true, redeemed: true }), "void");

  console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
