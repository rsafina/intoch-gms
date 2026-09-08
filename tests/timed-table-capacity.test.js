const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const sql = fs.readFileSync('migrations/20260909_timed_table_capacity.sql','utf8');
const db = new PGlite();
(async () => {
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
 `);
 await db.exec(sql);
 await db.exec(sql); // rerunnable upgrade
 const {rows:[area]} = await db.query("insert into areas(name,capacity) values ('Outdoor',65) returning id");
 const {rows:tables} = await db.query("insert into tables(area_id,name,capacity) select $1,'T'||n,5 from generate_series(1,13)n returning id",[area.id]);
 const {rows:[day]} = await db.query("select (current_date+1)::text as date");
 const date=day.date;
 const q = (s,p=[]) => db.query(s,p);
 const cap = async (time='13:00',minutes=180) => (await q('select * from reservation_capacity($1,$2::date+$3::time,$2::date+$3::time+make_interval(mins=>$4))',[area.id,date,time,minutes])).rows[0];
 const add = async ({time='13:00',end='16:00',pax=40,ids=tables.slice(0,8).map(t=>t.id),status='Reserved',buffer=0,exclusive=false}={}) => (await q('insert into reservations(assigned_area,reservation_date,reservation_time,end_time,pax,table_ids,status,block_buffer_minutes,exclusive_area) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',[area.id,date,time,end,pax,ids,status,buffer,exclusive])).rows[0].id;
 const clear = () => db.exec('delete from reservations; delete from guests;');
 let event=await add();
 assert.equal((await cap()).available_capacity,25,'40 selected seats leaves 25');
 assert.equal((await cap('12:00')).available_capacity,25,'visit beginning earlier overlaps the event');
 assert.equal((await cap('16:00')).available_capacity,65,'end is exclusive');
 assert.equal((await cap('10:00')).available_capacity,65,'visit ending at start fits');
 await assert.rejects(add({pax:5,ids:[tables[0].id]}),/already reserved/,'same table cannot be booked twice');
 await add({pax:10,ids:[],end:'14:00'});
 assert.equal((await cap()).available_capacity,15,'unassigned bookings consume capacity');
 await add({pax:10,ids:[],time:'14:00',end:'15:00'});
 assert.equal((await cap()).available_capacity,15,'nonoverlapping unassigned groups count at peak, not their sum');
 await assert.rejects(add({pax:20,ids:[]}),/remaining capacity/);
 await q("update reservations set status='Cancelled' where id=$1",[event]);
 assert.equal((await cap()).available_capacity,55,'cancelled event releases tables');
 await clear(); await add({pax:40,ids:tables.slice(0,9).map(t=>t.id)});
 assert.equal((await cap()).available_capacity,20,'selected seats, not just pax');
 await clear(); await add({buffer:30});
 assert.equal((await cap('09:00',210)).available_capacity,65,'visit ends exactly at buffer start');
 assert.equal((await cap('10:00')).available_capacity,25,'buffer overlaps visit');
 await clear(); await add({status:'Waitlist'}); assert.equal((await cap()).available_capacity,65);
 await clear(); await add({status:'Incoming'}); assert.equal((await cap()).available_capacity,25);
 await clear(); await add({exclusive:true}); assert.equal((await cap()).available_capacity,0);
 await clear(); await add({ids:tables.map(t=>t.id)}); assert.equal((await cap()).available_capacity,0,'all tables selected holds all capacity');
 await clear();
 // The same exact table must be free for the entire visit, even if another
 // table becomes available halfway through.
 await add({pax:5,ids:[tables[0].id],end:'14:00'});
 await add({pax:5,ids:[tables[1].id],time:'14:00',end:'15:00'});
 assert.equal((await cap()).available_capacity,55);
 await clear();
 await q("update app_settings set value=value||'{\"default_duration_minutes\":120}' where key='reservation_hours'");
 event=await add({end:null});
 assert.equal((await q('select booking_duration_minutes as n from reservations where id=$1',[event])).rows[0].n,120);
 await q("update app_settings set value=value||'{\"default_duration_minutes\":180}' where key='reservation_hours'");
 assert.equal((await cap('15:00')).available_capacity,65,'existing booking keeps its snapshot');
 await clear();
 event=await add({time:'23:00',end:null});
 assert.equal((await q('select available_capacity from reservation_capacity($1,$2::date+1,$2::date+1+interval \'1 hour\')',[area.id,date])).rows[0].available_capacity,25,'overnight defaults carry into next date');
 await clear(); await add();
 const book = async (pax,phone,time='13:00') => (await q("select create_public_reservation('Test Guest',$1,$2,$3,$4,null,$5,null) as result",[phone,pax,date,time,area.id])).rows[0].result;
 let result=await book(30,'08111111111'); assert.equal(result.code,'time_full');
 assert.equal((await q('select count(*)::int as n from guests')).rows[0].n,0,'refusal creates no guest');
 result=await book(10,'08222222222'); assert.equal(result.ok,true);
 assert.equal((await cap()).available_capacity,15);
 result=await book(20,'08333333333'); assert.equal(result.code,'time_full','already-open form cannot overbook');
 result=await book(30,'08444444444','16:00'); assert.equal(result.ok,true,'event does not block the whole date');
 const slots=(await q('select * from area_slot_availability($1)',[date])).rows;
 assert.equal(slots.length,24);
 assert.deepEqual(Object.keys(slots[0]).sort(),['area_id','available_pax','duration_minutes','exclusive_block','slot_time','total_capacity'].sort(),'public response contains no guest data');
 await db.exec('set role anon');
 await q('select * from area_slot_availability($1)',[date]);
 await assert.rejects(cap(),/permission denied/,'private calculator cannot be queried by anonymous users');
 await db.exec('reset role');
 console.log('Timed capacity SQL: migration rerun, table holds, buffers, peak unassigned pax, overnight visits, duration snapshots, public submission and permissions passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
