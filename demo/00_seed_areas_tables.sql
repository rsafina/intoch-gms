-- DEMO FLOOR PLAN: balance table seats with the existing area capacities.
-- Run after migrations/ALL_IN_ONE.sql, before 01_seed_3_months.sql when resetting.
-- Also safe to run with existing demo bookings: IDs, table assignments, table
-- capacities, archived flags and existing area booking/deposit settings are kept.
-- Missing screenshot areas/tables are added; extra existing areas (including VIP)
-- are untouched. No guest, visit, reservation, invoice or payment is changed.
-- Re-running adds nothing once active seats match the area capacity.
begin;
set local search_path = public, pg_temp;
lock table public.areas, public.tables in share row exclusive mode;

create temporary table _floor_plan (
 name text, normalized text, default_capacity integer, min_spend numeric,
 deposit numeric, prefix text, next_number integer, max_table integer,
 area_id uuid, added integer default 0
) on commit drop;
insert into _floor_plan(name,normalized,default_capacity,min_spend,deposit,prefix,next_number,max_table) values
 ('Indoor','indoor',40,75000,50000,'IN',6,4),
 ('Outdoor','outdoor',60,75000,0,'OUT',4,6),
 ('Outdoor - Smoking','outdoorsmoking',20,null,0,'OS',6,4);

-- These are the tables already shown in the screenshots. Match by name and
-- retain the existing row rather than replacing it with a new UUID.
create temporary table _floor_originals(area text,name text,seats integer) on commit drop;
insert into _floor_originals values
 ('indoor','T1',4),('indoor','T2',4),('indoor','T3',4),('indoor','T4',6),('indoor','T5',6),
 ('outdoor','T6',4),('outdoor','T7',4),('outdoor','T8',6),
 ('outdoorsmoking','OS1',4),('outdoorsmoking','OS2',6),('outdoorsmoking','OS3',2),
 ('outdoorsmoking','OS4',4),('outdoorsmoking','OS5',4);

do $floor$
declare plan record; original record; area_key uuid; matches integer;
 active_seats integer; target integer; gap integer; table_seats integer;
 sequence_number integer; table_name text;
begin
 for plan in select * from _floor_plan order by name loop
  select count(*) into matches from public.areas
   where regexp_replace(lower(name),'[^a-z0-9]','','g')=plan.normalized;
  if matches>1 then
   raise exception 'Multiple areas match %. Resolve duplicate area names before running the floor seed.',plan.name;
  end if;
  select id into area_key from public.areas
   where regexp_replace(lower(name),'[^a-z0-9]','','g')=plan.normalized;
  if area_key is null then
   insert into public.areas(name,capacity,is_bookable_online,min_pax,min_spend,deposit_amount)
   values(plan.name,plan.default_capacity,true,2,plan.min_spend,plan.deposit) returning id into area_key;
  end if;
  update _floor_plan set area_id=area_key where normalized=plan.normalized;
  for original in select * from _floor_originals where area=plan.normalized loop
   if exists(select 1 from public.tables where area_id=area_key and lower(btrim(name))=lower(original.name)) then
    continue; -- Includes archived tables; do not reactivate them or change seats.
   end if;
   if exists(select 1 from public.tables where lower(btrim(name))=lower(original.name)) then
    raise warning 'Table % already exists in another area; preserving it there.',original.name;
    continue;
   end if;
   insert into public.tables(area_id,name,capacity,is_active,description)
   values(area_key,original.name,original.seats,true,'Demo floor plan - original table');
   update _floor_plan set added=added+1 where area_id=area_key;
  end loop;
  if exists(select 1 from public.tables where area_id=area_key and is_active and (capacity is null or capacity<=0)) then
   raise exception 'An active table in % has no positive capacity. Set its actual seats first; existing table capacities are never guessed.',plan.name;
  end if;
  select coalesce(sum(capacity),0)::integer into active_seats from public.tables where area_id=area_key and is_active;
  select greatest(coalesce(nullif(capacity,0),plan.default_capacity),active_seats) into target from public.areas where id=area_key;
  -- Never reduce an area's limit below its already-existing tables.
  update public.areas set capacity=target where id=area_key and capacity is distinct from target;
  gap:=target-active_seats;sequence_number:=plan.next_number;
  while gap>0 loop
   -- Mix two-, four- and six-seat tables. For custom odd-sized areas, use a
   -- three-seat table where possible instead of leaving a one-seat remainder.
   table_seats:=case when gap in (3,5,7) then 3
     when plan.max_table=6 and gap>10 then 6
     when gap>=4 then 4 else gap end;
   loop
    table_name:=plan.prefix||sequence_number;sequence_number:=sequence_number+1;
    exit when not exists(select 1 from public.tables where lower(btrim(name))=lower(table_name));
   end loop;
   insert into public.tables(area_id,name,capacity,is_active,description)
   values(area_key,table_name,table_seats,true,'Demo floor plan - added seats to balance area capacity');
   update _floor_plan set added=added+1 where area_id=area_key;
   gap:=gap-table_seats;
  end loop;
 end loop;
 if exists(select 1 from _floor_plan p join public.areas a on a.id=p.area_id
   where a.capacity<>(select coalesce(sum(t.capacity),0) from public.tables t where t.area_id=a.id and t.is_active)) then
  raise exception 'Floor-plan seat totals do not match area capacities.';
 end if;
end;
$floor$;

select a.name as area,a.capacity as area_capacity,
 count(t.id) filter(where t.is_active) as active_tables,
 coalesce(sum(t.capacity) filter(where t.is_active),0) as table_seats,
 p.added as tables_added_this_run
from _floor_plan p join public.areas a on a.id=p.area_id
left join public.tables t on t.area_id=a.id
group by a.id,a.name,a.capacity,p.added order by a.name;

select a.name as area,t.name as table_name,t.capacity as seats,t.is_active
from _floor_plan p join public.areas a on a.id=p.area_id
join public.tables t on t.area_id=a.id order by a.name,t.name;
commit;
