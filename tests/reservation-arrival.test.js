const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 try {
  const base=fs.readFileSync('tests/deposit-policy-sql.test.js','utf8');
  await db.exec(base.slice(base.indexOf('await db.exec(`')+15,base.indexOf('`);')));
  await db.exec(`create table visits(id uuid primary key default gen_random_uuid(),guest_id uuid,reservation_id uuid,
   visit_type text,visit_date date,visit_time time,pax int,assigned_area uuid,table_id uuid,table_ids uuid[],
   status text default 'Active',created_at timestamptz default now(),created_by uuid,spend_amount numeric,
   spend_input_amount numeric,spend_deposit_snapshot numeric,billing_base_amount numeric,extra_spend_amount numeric,
   notes text,completed_at timestamptz,voided_at timestamptz,void_reason text,updated_at timestamptz);
   create table member_transactions(id uuid default gen_random_uuid(),visit_id uuid);
   create function waive_deposit(p_reservation_id uuid,p_reason text,p_staff_id uuid default null) returns jsonb language sql security definer as $$select '{"ok":true}'::jsonb$$;`);
  for(const f of ['20260911_roles_enforce','20260912_staff_deposit_waiver','20260916_finance_role']) await db.exec(fs.readFileSync('migrations/'+f+'.sql','utf8'));
  const rid='7ca3463f-e671-4b47-8c83-1501e6cc43cb', keep='84175482-09f7-45a6-8b1d-93d9477bd7c7', dup='3aa4632b-6508-48c8-8a50-84f835ec80f8';
  await db.query("insert into reservations(id,reservation_date,reservation_time,pax,status) values($1,current_date,'12:00',2,'Arrived')",[rid]);
  await db.query("insert into visits(id,reservation_id,visit_type,visit_date,pax,created_at) values($1,$3,'Reservation',current_date,2,now()-interval '1 minute'),($2,$3,'Reservation',current_date,2,now())",[keep,dup,rid]);
  const migration=fs.readFileSync('migrations/20260920_reservation_arrival.sql','utf8');
  await assert.rejects(()=>db.exec(migration),/Duplicate reservation visits/);await db.exec('rollback');
  const repair=fs.readFileSync('scripts/repair_duplicate_reservation_visit.sql','utf8');
  await db.query('insert into member_transactions(visit_id) values($1)',[dup]);
  await assert.rejects(()=>db.exec(repair),/manual review/);await db.exec('rollback;delete from member_transactions');
  await db.query('update visits set spend_amount=0 where id=$1',[dup]);
  await assert.rejects(()=>db.exec(repair),/manual review/);await db.exec('rollback');
  await db.query('update visits set spend_amount=null where id=$1',[dup]);
  await db.exec(repair);await db.exec(repair);
  assert.equal((await db.query('select count(*) as n from visits')).rows[0].n,2,'repair preserves both rows');
  assert.equal((await db.query('select id from visits where voided_at is null')).rows[0].id,keep);
  await db.exec(migration);await db.exec(migration);
  await assert.rejects(()=>db.query("insert into visits(reservation_id) values($1)",[rid]),/unique/);
  await assert.rejects(()=>db.query('update visits set voided_at=null where id=$1',[dup]),/unique/);
  const as=async(role)=>{await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false)");await db.query("update staff_users set role=$1 where username='staff'",[role]);await db.exec("select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false),set_config('request.jwt.claim.role','authenticated',false);set role authenticated");};
  await as('staff');
  const arrive=async(id)=>(await db.query('select record_reservation_arrival($1) as r',[id])).rows[0].r;
  assert.equal((await arrive(rid)).visit_id,keep);assert.equal((await arrive(rid)).visit_id,keep);
  const fresh=(await db.query("insert into reservations(reservation_date,reservation_time,pax,status) values(current_date,'13:00',3,'Reserved') returning id")).rows[0].id;
  const first=await arrive(fresh);assert.equal((await arrive(fresh)).visit_id,first.visit_id);
  assert.equal((await db.query('select created_by from visits where id=$1',[first.visit_id])).rows[0].created_by,'10000000-0000-0000-0000-000000000002');
  await db.query("update visits set status='Done' where id=$1",[first.visit_id]);
  await assert.rejects(()=>arrive(fresh),/already completed/);
  await as('finance');assert.equal((await arrive(rid)).visit_id,keep);
  await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec(`create function reject_test_visit() returns trigger language plpgsql as $$begin if new.pax=99 then raise exception 'simulated visit failure'; end if; return new; end$$;
   create trigger reject_test_visit before insert on visits for each row execute function reject_test_visit();`);
  const failed=(await db.query("insert into reservations(reservation_date,reservation_time,pax,status) values(current_date,'14:00',99,'Reserved') returning id")).rows[0].id;
  await as('staff');await assert.rejects(()=>arrive(failed),/simulated visit failure/);
  assert.equal((await db.query('select status from reservations where id=$1',[failed])).rows[0].status,'Reserved','failed visit insert rolls back arrival status');
  await as('owner');await assert.rejects(()=>arrive(rid),/cannot perform/);
  await db.exec("reset role;select set_config('request.jwt.claim.role','anon',false);set role anon");await assert.rejects(()=>arrive(rid),/permission denied/);
 } finally {await db.close();}

 const src=fs.readFileSync('js/app.js','utf8'),lift=name=>src.match(new RegExp('^(?:async )?function '+name+'\\([\\s\\S]*?^}', 'm'))[0];
 const rows=[{id:'kept',voided_at:null,spend_amount:null,guests:{}},{id:'voided',voided_at:'2026-09-14',spend_amount:null}];
 let prepared=0,arrivals=0,asks=0;const messages=[];
 const q={select(){return this},eq(){return this},is(k,v){this.filter=[k,v];return this},async maybeSingle(){const matches=rows.filter(r=>!this.filter||r[this.filter[0]]===this.filter[1]);return matches.length>1?{error:{code:'PGRST116'}}:{data:matches[0]};}};
 const ctx=vm.createContext({console,db:{from(){q.filter=null;return q},rpc:async(name)=>{assert.equal(name,'record_reservation_arrival');arrivals++;return {data:{ok:true}}}},
  supabaseQuery:fn=>fn(),loader(){},toast:m=>messages.push(m),hideModal(){},showModal(){},resetCompleteArrivedAsk(){},resetCompleteOrderFields(){},
  fillCompleteOrderFields(){},prepareCompleteBilling:async()=>prepared++,loadReservations(){},isViewingStaffDashboard:()=>false,
  document:{getElementById:()=>({value:'',classList:{add(){},remove(){asks++}}})}});
 vm.runInContext(lift('openCompleteReservation')+'\n'+lift('updateResStatus'),ctx);
 await ctx.openCompleteReservation('r');assert.equal(prepared,1,'voided record does not block spending');assert.equal(asks,0,'existing visit does not ask whether guest arrived');
 rows.push({id:'duplicate',voided_at:null});await ctx.openCompleteReservation('r');assert.equal(prepared,1);assert.match(messages.at(-1),/Multiple visits/);
 await ctx.updateResStatus('r','Arrived');assert.equal(arrivals,1,'arrival uses atomic RPC, no direct visit insert');
 console.log('Arrival reuse, duplicate guards/repair, roles, and voided-visit spending lookup passed');
})().catch(e=>{console.error(e);process.exitCode=1});
