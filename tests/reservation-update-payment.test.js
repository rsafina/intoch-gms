const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const app = fs.readFileSync('js/app.js','utf8');
const lift = name => app.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}', 'm'))[0];
(async()=>{
 const fields={
  'res-action-area':{value:'area'},'res-action-start-time':{value:'18:00'},
  'res-action-end-time':{value:'21:00'},'res-action-exclusive-area':{checked:true},
  'res-action-block-buffer':{value:'30'},'res-action-duration':{value:'180'}
 };
 let saved, error=null;const notices=[];
 const ctx=vm.createContext({document:{getElementById:id=>fields[id]},_resActionSelectedTables:['t1','t2'],
  _resActionReservation:{id:'booking',reservation_time:'13:00:00'},t:s=>s,toast:s=>notices.push(s),
  loader(){},hideModal(){},loadReservations(){},isViewingStaffDashboard:()=>false,supabaseQuery:fn=>fn(),
  db:{from:()=>({update(p){saved=p;return this;},eq(){return this;},select:async()=>({data:error?null:[{id:'booking'}],error})})}
 });
 vm.runInContext(['timeToMinutes','readAreaBlock','reservationSaveError','saveResActionTable'].map(lift).join('\n'),ctx);
 await ctx.saveResActionTable('booking');assert.equal(saved.reservation_time,'18:00');assert.equal(saved.block_buffer_minutes,30);
 saved=null;fields['res-action-start-time'].value='22:00';await ctx.saveResActionTable('booking');assert.equal(saved,null,'end must follow edited start');
 fields['res-action-start-time'].value='';await ctx.saveResActionTable('booking');assert.equal(saved,null,'start is required');
 fields['res-action-start-time'].value='18:00';error={code:'PGRST204',message:"Could not find the 'block_buffer_minutes' column in the schema cache"};
 await ctx.saveResActionTable('booking');assert.match(notices.at(-1),/ALL_IN_ONE.sql/);
 assert.match(app,/id="res-action-start-time"[^\n]+res.reservation_time/,'start field displays saved online booking hour');
 const db=new PGlite();
 try {
 await db.exec(`create table reservations(id uuid primary key,status text,deposit_required boolean,deposit_expected numeric,deleted_at timestamptz,updated_at timestamptz,reservation_date date,reservation_time time,deposit_due_at timestamptz);
 create table invoice_payments(id uuid default gen_random_uuid(),reservation_id uuid,amount numeric,paid_on date,method text,reference text,note text,recorded_by uuid);
 insert into reservations values ('00000000-0000-0000-0000-000000000001','Waitlist',true,1000000,null,now(),current_date,'13:00',null);
 insert into invoice_payments(reservation_id,amount) values ('00000000-0000-0000-0000-000000000001',1000000);`);
 const sql=fs.readFileSync('migrations/20260911_reservation_update_payment.sql','utf8');
 await db.exec(sql);await db.exec(sql);
 const id='00000000-0000-0000-0000-000000000001';
 const status=async()=> (await db.query('select status from reservations where id=$1',[id])).rows[0].status;
 assert.equal(await status(),'Reserved','already-paid waitlist is repaired without another payment');
 assert.equal((await db.query('select count(*)::int as n from invoice_payments')).rows[0].n,1);
 await db.exec("delete from invoice_payments; update reservations set status='Waitlist'");
 const pay=async amount=>(await db.query('select record_deposit_payment($1,$2,current_date) as result',[id,amount])).rows[0].result;
 assert.equal((await pay(400000)).locked,false);assert.equal(await status(),'Waitlist');
 await db.exec(`create function block_test_capacity() returns trigger language plpgsql as $$begin
 if new.status='Reserved' then raise exception 'Not enough remaining capacity'; end if; return new; end;$$;
 create trigger test_capacity before update of status on reservations for each row execute function block_test_capacity();`);
 await assert.rejects(pay(600000),/remaining capacity/);
 assert.equal((await db.query('select sum(amount)::int as n from invoice_payments')).rows[0].n,400000,'capacity refusal rolls back payment and status together');
 await db.exec('drop trigger test_capacity on reservations');
 assert.equal((await pay(600000)).locked,true);assert.equal(await status(),'Reserved');
 await db.exec("update reservations set status='Incoming'; delete from invoice_payments");
 assert.equal((await pay(1000000)).locked,true);assert.equal(await status(),'Reserved');
 await db.exec("update reservations set status='Incoming',reservation_time='18:00'");
 assert.equal((await db.query("select deposit_due_at = (reservation_date+reservation_time) at time zone 'Asia/Jakarta' as matches from reservations")).rows[0].matches,true);
 await db.exec("update reservations set status='Waitlist',deposit_due_at=null,reservation_time='19:00'");
 assert.equal((await db.query('select deposit_due_at from reservations')).rows[0].deposit_due_at,null,'waitlists gain no deadline when rescheduled');
 console.log('Reservation start editing, schema error guidance, paid waitlist repair, partial/full deposits and deadline rescheduling passed');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
