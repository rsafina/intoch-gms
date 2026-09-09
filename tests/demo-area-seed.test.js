const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('demo/00_seed_areas_tables.sql','utf8');
const base=`create table areas(id uuid primary key default gen_random_uuid(),name text not null,capacity integer not null default 0,is_bookable_online boolean default false,min_pax integer,min_spend numeric,deposit_amount numeric);
create table tables(id uuid primary key default gen_random_uuid(),area_id uuid references areas(id),name text,capacity integer,is_active boolean default true,description text);
create table reservations(id uuid primary key default gen_random_uuid(),assigned_area uuid references areas(id),table_id uuid references tables(id),table_ids uuid[],pax integer);
create table visits(id uuid primary key default gen_random_uuid(),assigned_area uuid references areas(id),table_id uuid references tables(id),table_ids uuid[]);`;
(async()=>{
 for(const fixture of ['empty','existing','custom','archived']){
  const db=new PGlite();try{
   await db.exec(base);
   if(fixture!=='empty'){
    await db.exec(`insert into areas(name,capacity,is_bookable_online,min_pax,min_spend,deposit_amount) values
     ('Indoor',40,true,2,75000,50000),('Outdoor',60,true,2,75000,null),('Outdoor - Smoking',20,true,2,null,null),('VIP Room A',20,false,null,null,null);
    insert into tables(area_id,name,capacity) select a.id,b.name,b.seats from (values
     ('Indoor','T1',4),('Indoor','T2',4),('Indoor','T3',4),('Indoor','T4',6),('Indoor','T5',6),
     ('Outdoor','T6',4),('Outdoor','T7',4),('Outdoor','T8',6),
     ('Outdoor - Smoking','OS1',4),('Outdoor - Smoking','OS2',6),('Outdoor - Smoking','OS3',2),('Outdoor - Smoking','OS4',4),('Outdoor - Smoking','OS5',4),('VIP Room A','VIP A',20)
    )b(area,name,seats) join areas a on a.name=b.area;
    insert into reservations(assigned_area,table_id,table_ids,pax) select area_id,id,array[id],4 from tables where name='T1';
    insert into visits(assigned_area,table_id,table_ids) select area_id,id,array[id] from tables where name='T6';`);
    if(fixture==='custom')await db.exec("insert into tables(area_id,name,capacity) select id,'IN6',4 from areas where name='Indoor';update tables set capacity=8 where name='T8';update areas set min_pax=3,deposit_amount=100000 where name='Indoor'");
    if(fixture==='archived')await db.exec("update tables set is_active=false where name='T1'");
   }
   const rows=async table=>(await db.query('select * from '+table+' order by id')).rows;
   const oldTables=await rows('tables'),oldAreas=await rows('areas'),oldReservations=await rows('reservations'),oldVisits=await rows('visits');
   await db.exec(sql);
   assert.deepEqual(await rows('reservations'),oldReservations,'existing primary and secondary assignments preserved');
   assert.deepEqual(await rows('visits'),oldVisits);
   const tables=await rows('tables'),areas=await rows('areas');
   for(const old of oldTables)assert.deepEqual(tables.find(t=>t.id===old.id),old,'existing tables stay byte-for-byte unchanged');
   for(const old of oldAreas)assert.deepEqual(areas.find(a=>a.id===old.id),old,'existing capacities and settings preserved on these floor plans');
   for(const [name,capacity] of [['Indoor',40],['Outdoor',60],['Outdoor - Smoking',20]]){
    const area=areas.find(a=>a.name===name);assert.equal(area.capacity,capacity);
    assert.equal(tables.filter(t=>t.area_id===area.id&&t.is_active).reduce((n,t)=>n+t.capacity,0),capacity);
   }
   if(fixture==='existing'){
    assert.equal(tables.length-oldTables.length,13,'four indoor and nine outdoor tables added');
    assert.equal(tables.filter(t=>t.area_id===areas.find(a=>a.name==='VIP Room A').id).length,1,'VIP untouched');
   }
   await db.exec(sql);
   assert.deepEqual(await rows('tables'),tables,'rerun never duplicates or rewrites tables');assert.deepEqual(await rows('areas'),areas);
   console.log('Area seed passed: '+fixture+' floor plan, preserved assignments and repeat run');
  }finally{await db.close();}
 }
 const db=new PGlite();try{
  await db.exec(base+"insert into areas(name,capacity) values ('Indoor',40),(' indoor ',40)");
  await assert.rejects(db.exec(sql),/Multiple areas match/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from tables')).rows[0].n,0,'ambiguous matches roll back');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
