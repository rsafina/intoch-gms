const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const seed=fs.readFileSync('demo/01_seed_3_months.sql','utf8');
const block=seed.slice(seed.indexOf('-- BEGIN UPCOMING DEMO FLOW'),seed.indexOf('-- END UPCOMING DEMO FLOW'));
// Minimal schema from the real capacity regression harness; real migration
// functions/triggers perform the allocation and payment checks below.
const capacityTest=fs.readFileSync('tests/timed-table-capacity.test.js','utf8');
const bootstrap=capacityTest.match(/await db.exec\(`([^]*?)`\);/)[1].replace('"max_pax":100','"max_pax":20');
(async()=>{
 for(const floor of ['normal','tiny','empty','balanced']){
  const db=new PGlite();try{
   await db.exec(bootstrap);
   await db.exec(`alter table reservations add column created_at timestamptz default now(),add column updated_at timestamptz;
   create table visits(visit_date date,status text,voided_at timestamptz,reservation_id uuid,table_id uuid,table_ids uuid[]);
   create table invoices(id uuid primary key default gen_random_uuid(),reservation_id uuid,guest_id uuid,kind text,status text default 'issued',bill_to_name text,pax integer,event_date date,total numeric,amount_due numeric,deposit_applied numeric,doc jsonb,invoice_no text,note text,created_at timestamptz default now());
   create table invoice_payments(id uuid default gen_random_uuid(),reservation_id uuid,amount numeric,paid_on date,method text,reference text,note text,recorded_by uuid);
   create sequence demo_invoice_seq;
   create function next_invoice_no() returns text language sql as $$select 'DEMO/'||nextval('demo_invoice_seq')$$;
   insert into guests(name,phone) select 'Demo Guest '||n,'080000'||n from generate_series(1,120)n;`);
   for(const file of ['20260909_timed_table_capacity','20260910_reservation_deposit_flow','20260911_reservation_update_payment','20260912_invoice_requested_deposit','20260913_table_picker_availability']) await db.exec(fs.readFileSync('migrations/'+file+'.sql','utf8'));
   if(floor==='normal') await db.exec(`insert into areas(name,capacity,deposit_amount) values ('A Indoor',8,50000),('B Outdoor',60,0);
    insert into tables(area_id,name,capacity) select id,'T'||n,case when name='A Indoor' then 4 else 6 end from areas cross join generate_series(1,10)n where name='B Outdoor' or n<=2;`);
   if(floor==='tiny') await db.exec("insert into areas(name,capacity,deposit_amount) values ('Tiny',4,50000);insert into tables(area_id,name,capacity) select id,'Only table',4 from areas");
   if(floor==='balanced'){
    await db.exec('alter table tables add column description text');
    await db.exec(fs.readFileSync('demo/00_seed_areas_tables.sql','utf8'));
   }
   const before=(await db.query('select row_to_json(a) as row from areas a order by name')).rows;
   await db.exec("begin;create temporary table _anchor on commit drop as select (now() at time zone 'Asia/Jakarta')::date as today;");
   await db.exec(block);
   const count=async sql=>Number((await db.query(sql)).rows[0].n);
   assert.equal(await count('select count(*) as n from reservations'),24,floor+' has 24 requests/bookings');
   assert.equal(await count('select count(*) as n from guests'),120);
   assert.deepEqual((await db.query('select row_to_json(a) as row from areas a order by name')).rows,before,'floor plan preserved');
   assert.equal(await count(`select count(*) as n from reservations a join reservations b on a.id<b.id and a.assigned_area=b.assigned_area and a.table_ids&&b.table_ids
    where a.status in ('Reserved','Incoming') and b.status in ('Reserved','Incoming')
    and reservation_hold_window(a.reservation_date,a.reservation_time,a.end_time,a.booking_duration_minutes,a.block_buffer_minutes)&&reservation_hold_window(b.reservation_date,b.reservation_time,b.end_time,b.booking_duration_minutes,b.block_buffer_minutes)`),0,'no overlapping held tables');
   assert.equal(await count("select count(*) as n from reservations where notes like 'DEMO: Large - partial%' and status='Waitlist' and deposit_expected=2500000 and deposit_due_at is null"),3);
   assert.equal(await count("select count(*) as n from reservations where notes like 'DEMO: Large - awaiting%' and not deposit_required and status='Waitlist'"),3);
   if(floor==='normal'||floor==='balanced'){
    assert.equal(await count("select count(*) as n from reservations where notes like 'DEMO: Large - deposit paid%' and status='Reserved' and deposit_expected=2500000"),3);
    assert.equal(await count("select count(*) as n from reservations where notes like 'DEMO: Small - awaiting%' and status='Incoming'"),3);
    assert.equal(await count("select count(*) as n from reservations where notes like 'DEMO: Capacity request%' and status='Waitlist' and not deposit_required and deposit_due_at is null"),3);
   }
   if(floor==='empty') assert.equal(await count("select count(*) as n from reservations where status='Waitlist' and assigned_area is null"),24);
   await db.exec('rollback');
   console.log('Upcoming seed SQL passed: '+floor+' floor plan');
  }finally{await db.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
