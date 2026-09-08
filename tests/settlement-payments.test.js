const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('js/app.js','utf8');
const sql = fs.readFileSync('migrations/ALL_IN_ONE.sql','utf8');
const extract = name => app.match(new RegExp('^async function '+name+'\\([^]*?^}', 'm'))[0];
(async () => {
  const fields = Object.fromEntries(['dep-pay-amount','dep-pay-date','dep-pay-method','dep-pay-ref','dep-pay-note','dep-pay-save-btn'].map(id=>[id,{value:'',disabled:false}]));
  fields['dep-pay-amount'].value='2500000';fields['dep-pay-date'].value='2026-09-08';
  const ledger = new Map(), calls = [];
  let loseFirstResponse = true;
  const ctx = vm.createContext({
    invoicePaymentContext:{invoiceId:'invoice-1',resId:'res-1',paymentId:'request-1'}, invoicePaymentSaving:false,
    document:{getElementById:id=>fields[id]}, TODAY:'2026-09-08', currentStaffId:()=> 'staff',
    t:s=>s, toast(){}, currentPage:'invoice', reservationDataRevision:0,
    loadReservations:async()=>{}, loadDashboard:async()=>{}, isViewingStaffDashboard:()=>false, hideModal(){},
    depositRupiah:String, supabaseQuery:fn=>fn(),
    db:{rpc:async(name,args)=>{
      assert.equal(name,'record_invoice_payment');calls.push(args);
      ledger.set(args.p_payment_id,args.p_amount);
      if(loseFirstResponse){loseFirstResponse=false;return {error:{message:'response lost'}};}
      return {data:{ok:true,outstanding:0},error:null};
    }},
  });
  vm.runInContext(extract('submitInvoicePayment'),ctx);
  await Promise.all([ctx.submitInvoicePayment(),ctx.submitInvoicePayment()]);
  assert.equal(calls.length,1,'concurrent clicks submit only once');
  assert.equal(ctx.invoicePaymentContext.paymentId,'request-1','a lost response retains the idempotency key');
  await ctx.submitInvoicePayment();
  assert.equal(ledger.size,1,'retry uses the same payment ID');
  assert.equal(calls[1].p_invoice_id,'invoice-1');
  assert.equal(calls[1].p_amount,2500000);
  assert.equal(ctx.invoicePaymentContext,null,'successful recording clears the completed operation');
  assert.equal(fields['dep-pay-save-btn'].disabled,false);
  ctx.invoicePaymentContext={invoiceId:'invoice-1',resId:'res-1',paymentId:'request-2'};
  fields['dep-pay-amount'].value='0';await ctx.submitInvoicePayment();assert.equal(calls.length,2,'zero payment is refused');
  fields['dep-pay-amount'].value='-500000';await ctx.submitInvoicePayment();assert.equal(calls[2].p_amount,-500000,'refund is a negative payment');
  const payment=sql.slice(sql.indexOf('create or replace function public.record_invoice_payment('));
  assert.match(payment,/where id = p_payment_id/);
  assert.match(payment,/existing_payment\.amount is distinct from p_amount/);
  assert.match(payment,/invoice_payments\(id, invoice_id, amount/,'invoice payments do not also attach to the reservation');
  const completion=sql.slice(sql.indexOf('create or replace function public.complete_billed_reservation('));
  assert.match(completion,/total_spend := base_amount \+ extra_amount/);
  assert.match(completion,/coalesce\(settlement_total, paid_total, 0\)/,'the final bill replaces, rather than adds to, recorded deposits');
  assert.match(completion,/for update/);
  assert.match(completion,/p_expected_base is distinct from base_amount/);
  assert.match(completion,/extra_spend_amount = extra_amount/);
  assert.match(completion,/set status = 'Completed'/);
  console.log('Settlement payments: invoice association, duplicate clicks, retry key, refunds and completion SQL guards passed');
})().catch(e=>{console.error(e);process.exitCode=1});
