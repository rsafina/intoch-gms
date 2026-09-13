const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://demo.test/index.html' });
const w = dom.window;
w.t = s => s;
w.restaurantName = () => 'Demo';
w.toast = () => {};
w.confirm = () => true;
w.isManagerOrAdmin = () => true;
w.canManageInvoices = () => w.isManagerOrAdmin() || w.currentStaffRole() === 'finance';
w.currentStaffId = () => 'staff-1';
w.currentStaffRole = () => 'admin';
w.currentPage = 'invoice';
w.escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
w.reservationFormSettings = () => ({ bank_details: 'Demo bank' });
w.hideModal = () => {};
w.navigateTo = async page => { assert.equal(page, 'invoice'); w.initInvoice(); };
w.waPhone = p => p;
w.waLoadTemplates = async () => {};
w.waInvoiceMessage = x => x.link;
const chats = [];
w.waOpenChat = (p, msg) => { chats.push(msg); return true; };
w.depositInvoiceUrl = token => 'https://demo.test/deposit-invoice.html?t=' + token;
Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { value: 900 });
let rows = [], next = 0, failSave = false;
const writes = [];
w.db = {
  rpc: async () => ({ data: 'INV/' + (next + 1), error: null }),
  from(table) {
    assert.ok(['invoices', 'reservations', 'reservation_money'].includes(table));
    const filters = []; let op = 'select', payload;
    const q = {
      single() { return q; }, select() { return q; }, eq(k, v) { filters.push([k,v]); return q; }, order() { return q; },
      insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; },
      then(resolve) {
        if (table === 'reservation_money') return Promise.resolve(resolve({data: {paid_direct:1000000},error:null}));
        if (table === 'reservations') return Promise.resolve(resolve({data: [{id: res.id}], error: null}));
        const found = rows.filter(row => filters.every(([k,v]) => row[k] === v));
        if (op !== 'select') {
          if (failSave) return Promise.resolve(resolve({ data: [], error: null }));
          writes.push(structuredClone(payload));
          if (op === 'insert') {
            const row = { ...structuredClone(payload), id: 'invoice-' + ++next, token: 'token-' + next };
            rows.push(row); return Promise.resolve(resolve({ data: [row], error: null }));
          }
          found.forEach(row => Object.assign(row, structuredClone(payload)));
        }
        return Promise.resolve(resolve({ data: found, error: null }));
      }
    }; return q;
  }
};
w.supabaseQuery = async fn => await fn();
w.eval(fs.readFileSync('js/invoice-sheet.js','utf8') + '\n' + fs.readFileSync('js/invoice.js','utf8'));
const res = { id: 'reservation-1', guest_id: 'guest-1', booking_name: 'Event organiser', guests: { name: 'Guest', phone: '08123456789' }, pax: 25, reservation_date: '2026-10-01', deposit_expected: 1000000, tables: { name: 'Indoor 1' } };
(async () => {
  await w.invOpenReservation(res);
  assert.equal(w.document.getElementById('inv-name').value, 'Event organiser');
  assert.equal(w.document.getElementById('inv-pax').value, '25');
  assert.equal(w.document.getElementById('inv-table').value, 'Indoor 1');
  assert.equal(w.document.getElementById('inv-total').value.replace(/\D/g,''), '1000000');
  await w.invSaveInvoice(true);
  assert.equal(writes[0].reservation_id, res.id);
  assert.equal(writes[0].guest_id, res.guest_id);
  assert.equal(writes[0].kind, 'deposit');
  assert.equal(chats[0], 'https://demo.test/invoice-view.html?t=token-1');
  assert.equal(rows[0].doc.name, 'Event organiser');
  // Reopening from a booking reads persisted data, keeping its original token.
  await w.invOpenReservation(res);
  w.document.getElementById('inv-name').value = 'Updated organiser';
  await w.invSaveInvoice(false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, 'token-1');
  assert.equal(rows[0].doc.name, 'Updated organiser');
  assert.match(w.reservationInvoicesPanel(rows, null), /invoice-view.html\?t=token-1/);
  assert.match(w.reservationInvoicesPanel(rows, null), /invEditReservationInvoice/);
  assert.ok(!w.reservationInvoicesPanel([{...rows[0],status:'void'}], null).includes('href='));
  // Failed writes must not launch chat or claim a second saved document.
  failSave = true;
  await w.invSaveInvoice(true);
  assert.equal(chats.length, 1);
  assert.equal(w.document.getElementById('inv-send-btn').disabled, false);
  failSave = false;
  // Loading an unrelated local document must clear the reservation association.
  const copy = structuredClone(rows[0].doc);
  copy.name = 'Unrelated guest';
  w.invApplySnapshot(copy);
  await w.invSaveInvoice(false);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].reservation_id, null);
  assert.equal(rows[1].guest_id, null);
  assert.equal(rows[1].kind, 'general');
  // Double-clicking Save/Send cannot insert duplicate invoices.
  w.invApplySnapshot(copy);
  await Promise.all([w.invSaveInvoice(false), w.invSaveInvoice(false)]);
  assert.equal(rows.length, 3);
  // Legacy deposit links are upgraded in place instead of creating a second bill.
  rows = [{id:'legacy', token:'old-token', reservation_id:res.id, kind:'deposit', status:'issued', total:1000000}];
  await w.invOpenReservation(res);
  await w.invSaveInvoice(false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, 'old-token');
  assert.ok(rows[0].doc && rows[0].invoice_no);
  assert.equal(rows[0].guest_id, res.guest_id);
  // A settlement copies the detailed bill, deducts the actual deposit once,
  // and saves as its own invoice with its own remaining-payment balance.
  rows[0].doc.items[0].price = '3500000';
  rows[0].doc.total = rows[0].doc.subtotal = '3500000';
  await w.invOpenReservation(res, null, 'settlement');
  assert.equal(w.document.getElementById('inv-total').value.replace(/\D/g,''), '3500000');
  assert.equal(w.document.getElementById('inv-settle').value.replace(/\D/g,''), '2500000');
  await w.invSaveInvoice(false);
  const finalInvoice = rows.find(row => row.kind === 'settlement');
  assert.equal(finalInvoice.total,3500000);
  assert.equal(finalInvoice.deposit_applied,1000000);
  assert.equal(finalInvoice.amount_due,2500000);
  assert.equal(w.document.getElementById('inv-record-payment-btn').classList.contains('hidden'),false);
  assert.match(w.reservationInvoicesPanel([finalInvoice],null,[{invoice_id:finalInvoice.id,paid:2500000,outstanding:0}]),/openRecordInvoicePayment/);
  await w.invOpenReservation(res,null,'settlement');
  await w.invSaveInvoice(false);
  assert.equal(rows.filter(row=>row.kind==='settlement').length,1,'reopening preserves the final invoice');
  await w.invOpenReservation(res);
  const depositId = rows.find(row=>row.kind==='deposit').id;
  w.document.getElementById('inv-dp-on').checked=true;
  w.document.getElementById('inv-settle-on').checked=true;
  w.invRecalc();
  await w.invSaveInvoice(false);
  assert.equal(rows.find(row=>row.id===depositId).kind,'deposit','settlement checkbox preserves the original deposit invoice');
  assert.equal(rows.at(-1).kind,'settlement','settlement checkbox creates a separately payable remainder');
  // Regular staff can issue/edit a reservation deposit, but not a settlement or general invoice.
  w.isManagerOrAdmin = () => false;
  w.canIssueDepositInvoice = () => true;
  w.currentStaffRole = () => 'staff';
  await w.invOpenReservation(res);
  w.document.getElementById('inv-name').value = 'Staff deposit guest';
  const chatsBeforeStaff = chats.length;
  await w.invSaveInvoice(true);
  assert.equal(chats.length, chatsBeforeStaff + 1);
  assert.ok(rows.some(row => row.kind === 'deposit' && row.bill_to_name === 'Staff deposit guest'));
  const beforeStaffSettlement = rows.length;
  await w.invOpenReservation(res, null, 'settlement');
  assert.equal(rows.length, beforeStaffSettlement);
  w.invApplySnapshot(copy);
  assert.equal(await w.invSaveInvoice(false), undefined);
  assert.equal(rows.length, beforeStaffSettlement);
  w.currentStaffRole = () => 'finance';
  await w.invOpenReservation(res, null, 'settlement');
  w.document.getElementById('inv-name').value = 'Finance settlement';
  await w.invSaveInvoice(false);
  assert.ok(rows.some(row => row.kind === 'settlement' && row.bill_to_name === 'Finance settlement'));
  w.invApplySnapshot(copy);
  await w.invSaveInvoice(false);
  assert.ok(rows.some(row => row.kind === 'general'));
  console.log('Reservation invoice flow: prefill, save/send, reopen/edit, staff restrictions and Finance settlement/general invoices passed');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => dom.window.close());
