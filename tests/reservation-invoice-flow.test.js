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
w.currentStaffId = () => 'staff-1';
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
    assert.ok(['invoices', 'reservations'].includes(table));
    const filters = []; let op = 'select', payload;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k,v]); return q; }, order() { return q; },
      insert(p) { op = 'insert'; payload = p; return q; }, update(p) { op = 'update'; payload = p; return q; },
      then(resolve) {
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
  console.log('Reservation invoice flow: prefill, save/send, reopen/edit, persisted preview, failure, context isolation and double-save passed');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => dom.window.close());
