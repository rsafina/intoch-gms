const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;
    create table guests(id uuid primary key,name text,phone text);
    create table areas(id uuid primary key,name text);
    create table reservations(id uuid primary key default gen_random_uuid(),guest_id uuid,assigned_area uuid,booking_name text,status text,deleted_at timestamptz,reservation_date date,reservation_time time,end_time time,pax integer,notes text);
    create function get_setting(text) returns jsonb language sql as $$select '"Test Restaurant"'::jsonb$$;
    insert into reservations(status,booking_name,reservation_date,reservation_time,pax,notes) values ('Reserved','Guest A','2026-09-30','19:00',4,'Private staff note'),('Waitlist','Guest B','2026-09-30','19:00',20,'Private');`);
  const sql=fs.readFileSync('migrations/20260915_reservation_tickets.sql','utf8');await db.exec(sql);await db.exec(sql);
  const rows=(await db.query('select id,status from reservations order by status')).rows;
  const issue=async id=>(await db.query('select issue_reservation_ticket($1) as ticket',[id])).rows[0].ticket;
  const reserved=rows.find(r=>r.status==='Reserved'),waiting=rows.find(r=>r.status==='Waitlist');
  const first=await issue(reserved.id);assert.equal(first.ok,true);assert.deepEqual(await issue(reserved.id),first);
  assert.equal((await issue(waiting.id)).ok,false);
  const read=async token=>(await db.query('select reservation_ticket_by_token($1) as ticket',[token])).rows[0].ticket;
  const ticket=await read(first.token);assert.equal(ticket.name,'Guest A');assert.equal(ticket.restaurant,'Test Restaurant');
  assert.equal(ticket.notes,undefined);assert.equal(ticket.phone,null);assert.equal(ticket.id,undefined);
  await db.query("update reservations set reservation_time='20:00',status='Cancelled' where id=$1",[reserved.id]);
  assert.equal((await read(first.token)).status,'Cancelled');assert.equal((await read(first.token)).time,'20:00:00');
  assert.equal((await issue(reserved.id)).ok,false);
  await db.query('update reservations set deleted_at=now() where id=$1',[reserved.id]);assert.equal(await read(first.token),null);
  console.log('Ticket SQL: reserved gate, stable links, current status, deleted bookings and restricted guest fields passed');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
