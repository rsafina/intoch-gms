const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();try {
 await db.exec(`
 create role anon; create role authenticated;
 create table app_settings(key text primary key,value jsonb);
 insert into app_settings values ('reservation_hours','{"max_pax":100,"default_duration_minutes":180}');
 create function get_setting(k text) returns jsonb language sql stable as $$select value from app_settings where key=k$$;
 create function reservation_hours_for(d date) returns jsonb language sql as $$select '{"open":"00:00","close":"23:59","closed":false}'::jsonb$$;
 create table areas(id uuid primary key default gen_random_uuid(),name text,capacity integer,min_pax integer,min_spend numeric,deposit_amount numeric,is_bookable_online boolean default true);
 create table tables(id uuid primary key default gen_random_uuid(),area_id uuid references areas,name text,capacity integer,is_active boolean default true);
 create table guests(id uuid primary key default gen_random_uuid(),name text,phone text unique,company text,booking_alias text,updated_at timestamptz);
 create table reservations(id uuid primary key default gen_random_uuid(),guest_id uuid references guests,
 reservation_date date not null,reservation_time time not null,end_time time,pax integer not null,status text default 'Reserved',
 assigned_area uuid references areas,table_id uuid,table_ids uuid[] not null default '{}',deleted_at timestamptz,
 reservation_source text,notes text,booking_name text,deposit_required boolean,deposit_expected numeric,
 deposit_rule_note text,waitlist_reason text,deposit_due_at timestamptz);
 
 create role service_role;create schema auth;create schema storage;
 grant usage on schema public,auth,storage to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table staff_users(id uuid primary key,auth_user_id uuid,username text,display_name text,pin text,role text,is_active boolean default true,created_at timestamptz);
 create table storage.objects(id uuid,name text,bucket_id text);
 alter table reservations add column updated_at timestamptz;
 alter table reservations add column deposit_asked_at timestamptz;
 create table invoices(id uuid default gen_random_uuid(),reservation_id uuid,kind text,status text);
 create table invoice_payments(id uuid default gen_random_uuid(),reservation_id uuid,amount numeric,paid_on date,method text,reference text,note text,recorded_by uuid);
 insert into staff_users(id,auth_user_id,username,role) values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin','admin'),('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','staff','staff');
 `);
 for(const file of ['20260909_timed_table_capacity.sql','20260910_reservation_deposit_flow.sql','20260911_reservation_update_payment.sql','20260911_roles_enforce.sql'])await db.exec(fs.readFileSync('migrations/'+file,'utf8'));
 const migration=fs.readFileSync('migrations/20260913_deposit_policy.sql','utf8');await db.exec(migration);await db.exec(migration);
 const area=(await db.query("insert into areas(name,capacity,deposit_amount) values('Indoor',100,50000) returning id")).rows[0].id;
 const day=(await db.query("select (current_date+2)::text as d")).rows[0].d;
 const as=async role=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[role==='anon'?'':role==='staff'?'10000000-0000-0000-0000-000000000002':'10000000-0000-0000-0000-000000000001',role==='anon'?'anon':'authenticated']);await db.exec('set role '+(role==='anon'?'anon':'authenticated'));};
 let phone=8120000000;
 const book=async pax=>{await as('anon');return (await db.query("select create_public_reservation($1,$2,$3,$4,'12:00',null,$5) as r",['Test Guest',String(++phone),pax,day,area])).rows[0].r;};
 let old=await book(2);assert.equal(old.status,'Incoming');assert.equal(Number(old.deposit_expected),50000);assert.ok(old.deposit_due_at);
 await as('admin');await db.exec("insert into app_settings values('reservation_form','{\"deposit_basis\":\"pax\",\"deposit_free_pax\":1,\"deposit_regular_max_pax\":20}')");
 const one=await book(1);assert.equal(one.status,'Reserved');assert.equal(one.deposit_required,false);
 const small=await book(2);assert.equal(small.status,'Incoming');assert.equal(small.awaiting_quote,true);assert.equal(small.deposit_expected,null);assert.equal(small.deposit_due_at,null);
 const boundary=await book(20);assert.equal(boundary.status,'Incoming');
 const big=await book(21);assert.equal(big.status,'Waitlist');assert.equal(big.deposit_required,false);
 await as('admin');assert.equal((await db.query('select deposit_basis from reservations where id=$1',[old.reservation_id])).rows[0].deposit_basis,'area');
 await db.exec("update app_settings set value=value||'{\"deposit_free_pax\":0}' where key='reservation_form'");
 assert.equal((await book(1)).awaiting_quote,true);
 await as('admin');await db.query('update areas set capacity=30 where id=$1',[area]);
 const waiting=await book(10);assert.equal(waiting.status,'Waitlist');assert.equal(waiting.deposit_required,false);
 await as('admin');await db.query('update areas set capacity=100 where id=$1',[area]);
 await db.query("update reservations set status='Reserved' where id=$1",[waiting.reservation_id]);
 const accepted=(await db.query('select * from reservations where id=$1',[waiting.reservation_id])).rows[0];assert.equal(accepted.status,'Incoming');assert.equal(accepted.deposit_due_at,null);
 await as('staff');await db.query("select set_reservation_deposit_request($1,75000,'simple')",[small.reservation_id]);
 assert.equal((await db.query('select deposit_due_at from reservations where id=$1',[small.reservation_id])).rows[0].deposit_due_at,null,'quoting alone starts no deadline');
 await db.query('update reservations set deposit_asked_at=now() where id=$1',[small.reservation_id]);
 assert.ok((await db.query('select deposit_due_at from reservations where id=$1',[small.reservation_id])).rows[0].deposit_due_at);
 for(const [amount,locked] of [[25000,false],[50000,true]]) assert.equal((await db.query('select record_deposit_payment($1,$2,current_date) as r',[small.reservation_id,amount])).rows[0].r.locked,locked);
 await db.query("select set_reservation_deposit_request($1,2500000,'simple')",[big.reservation_id]);
 assert.equal((await db.query('select deposit_invoice_format from reservations where id=$1',[big.reservation_id])).rows[0].deposit_invoice_format,'simple');
 await db.query("select set_reservation_deposit_request($1,2500000,'detailed')",[big.reservation_id]);
 await db.query("insert into invoices(reservation_id,kind,status) values($1,'deposit','issued')",[big.reservation_id]);
 for(const [amount,locked] of [[1000000,false],[1500000,true]])assert.equal((await db.query('select record_deposit_payment($1,$2,current_date) as r',[big.reservation_id,amount])).rows[0].r.locked,locked);
 assert.equal((await db.query('select deposit_due_at from reservations where id=$1',[big.reservation_id])).rows[0].deposit_due_at,null,'large parties still have no automatic deadline');
 await assert.rejects(()=>db.query("update reservations set deposit_invoice_format='simple' where id=$1",[big.reservation_id]),/invoice already exists/);
 await as('anon');await assert.rejects(()=>db.query("select set_reservation_deposit_request($1,1,'simple')",[small.reservation_id]),/permission denied/);
 await as('admin');await assert.rejects(()=>db.exec("update app_settings set value=value||'{\"deposit_free_pax\":21}' where key='reservation_form'"),/No-deposit threshold/);
 assert.equal((await db.query('select deposit_required from reservations where id=$1',[one.reservation_id])).rows[0].deposit_required,false,'changing settings does not recalculate an existing no-deposit booking');
 console.log('Deposit policy SQL: area preservation, pax 0/1/2/20/21, capacity acceptance, quote deadlines, partial/full payment, invoice choice and permissions passed');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
