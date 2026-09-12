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
 const ctx=vm.createContext({tablePickerContext:{actions:{}},document:{getElementById:id=>fields[id]},_resActionSelectedTables:['t1','t2'],
  _resActionReservation:{id:'booking',reservation_time:'13:00:00'},t:s=>s,toast:s=>notices.push(s),
  loader(){},hideModal(){},loadReservations(){},isViewingStaffDashboard:()=>false,supabaseQuery:fn=>fn(),
  db:{from:()=>({update(p){saved=p;return this;},eq(){return this;},select:async()=>({data:error?null:[{id:'booking'}],error})})}
 });
 vm.runInContext(['reservationTablesReady','timeToMinutes','readAreaBlock','reservationSaveError','saveResActionTable'].map(lift).join('\n'),ctx);
 await ctx.saveResActionTable('booking');assert.equal(saved.reservation_time,'18:00');assert.equal(saved.block_buffer_minutes,30);
 saved=null;fields['res-action-start-time'].value='22:00';await ctx.saveResActionTable('booking');assert.equal(saved,null,'end must follow edited start');
 fields['res-action-start-time'].value='';await ctx.saveResActionTable('booking');assert.equal(saved,null,'start is required');
 fields['res-action-start-time'].value='18:00';error={code:'PGRST204',message:"Could not find the 'block_buffer_minutes' column in the schema cache"};
 await ctx.saveResActionTable('booking');assert.match(notices.at(-1),/targeted migration/);assert.doesNotMatch(notices.at(-1),/Run migrations\/ALL_IN_ONE/);
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
 // Run the actual deposit function through Phase 1's verified-role wrapper.
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 grant usage on schema public,auth,storage to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table staff_users(id uuid primary key,auth_user_id uuid,username text,display_name text,role text,pin text,is_active boolean default true,created_at timestamptz);
 create table storage.objects(id uuid,name text,bucket_id text);
 create table app_settings(key text primary key,value jsonb);
 alter table reservations add column deposit_rule_note text;`);
 const schema=fs.readFileSync('migrations/ALL_IN_ONE.sql','utf8');
 await db.exec(schema.match(/create or replace function public\.waive_deposit\([\s\S]*?\$function\$[\s\S]*?\$function\$;/i)[0]);
 const actors={};for(const [i,role] of ['admin','manager','staff','owner'].entries()){
  actors[role]='10000000-0000-0000-0000-00000000000'+(i+1);
  await db.query('insert into staff_users(id,auth_user_id,username,role) values($1,$1,$2,$2)',[actors[role],role]);
 }
 await db.exec(fs.readFileSync('migrations/20260911_roles_enforce.sql','utf8'));
 const as=async role=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[actors[role]]);await db.exec('set role authenticated');};
 await as('staff');
 await db.exec("update reservations set deposit_expected=1000000,status='Waitlist'");
 await as('manager');await db.exec('delete from invoice_payments');await as('staff');
 const staffPay=async amount=>(await db.query('select record_deposit_payment($1,$2,current_date,null,null,null,$3) as result',[id,amount,actors.admin])).rows[0].result;
 assert.equal((await staffPay(400000)).locked,false);assert.equal(await status(),'Waitlist');
 assert.equal((await staffPay(600000)).locked,true);assert.equal(await status(),'Reserved');
 assert.equal((await db.query('select recorded_by from invoice_payments limit 1')).rows[0].recorded_by,actors.staff);
 await assert.rejects(()=>db.query("select waive_deposit($1,'test')",[id]),/cannot perform/);
 await as('owner');await assert.rejects(()=>staffPay(1),/cannot perform/);
 await as('manager');await db.query("select waive_deposit($1,'Approved waiver',$2)",[id,actors.admin]);
 assert.match((await db.query('select deposit_rule_note from reservations')).rows[0].deposit_rule_note,/manager/);
 assert.equal((await db.query('select count(*)::int as n from invoice_payments')).rows[0].n,2,'waiver preserves payment history');
 await as('staff');const small='00000000-0000-0000-0000-000000000002';
 await db.query("insert into reservations(id,status,deposit_required,deposit_expected,reservation_date,reservation_time) values($1,'Incoming',true,50000,current_date,'18:00')",[small]);
 const smallPay=async amount=>(await db.query('select record_deposit_payment($1,$2,current_date) as result',[small,amount])).rows[0].result;
 assert.equal((await smallPay(20000)).locked,false);assert.equal((await smallPay(30000)).locked,true);
 await db.exec('reset role');const permissionSql=fs.readFileSync('migrations/20260912_staff_deposit_waiver.sql','utf8');await db.exec(permissionSql);await db.exec(permissionSql);
 await as('staff');assert.equal((await db.query('select app_can_waive_deposit() as allowed')).rows[0].allowed,false);
 await assert.rejects(()=>db.query("select waive_deposit($1,'Test')",[small]),/cannot waive/);
 await as('admin');await db.query('update staff_users set can_waive_deposit=true where id=$1',[actors.staff]);
 await as('staff');assert.equal((await db.query('select app_can_waive_deposit() as allowed')).rows[0].allowed,true);
 assert.equal((await db.query("select waive_deposit($1,'') as result",[small])).rows[0].result.code,'reason_required');
 await db.query("select waive_deposit($1,'FO approved',$2)",[small,actors.admin]);
 assert.match((await db.query('select deposit_rule_note from reservations where id=$1',[small])).rows[0].deposit_rule_note,/staff/);
 await as('manager');await db.query('update staff_users set can_waive_deposit=false where id=$1',[actors.staff]);
 await as('staff');assert.equal((await db.query('select can_waive_deposit from staff_users')).rows[0].can_waive_deposit,true,'manager cannot alter individual permissions');
 await as('admin');await db.query('update staff_users set can_waive_deposit=false where id=$1',[actors.staff]);await db.query('update reservations set deposit_required=true where id=$1',[small]);
 await as('staff');await db.query('update staff_users set can_waive_deposit=true where id=$1',[actors.staff]);
 assert.equal((await db.query('select app_can_waive_deposit() as allowed')).rows[0].allowed,false,'staff cannot grant themselves permission');
 await assert.rejects(()=>db.query("select waive_deposit($1,'Stale session')",[small]),/cannot waive/);
 await assert.rejects(()=>db.query('update reservations set deposit_required=false where id=$1',[small]),/cannot waive/);
 await as('owner');assert.equal((await db.query('select app_can_waive_deposit() as allowed')).rows[0].allowed,false);
 console.log('Reservation start editing, schema error guidance, paid waitlist repair, partial/full deposits and deadline rescheduling passed');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
