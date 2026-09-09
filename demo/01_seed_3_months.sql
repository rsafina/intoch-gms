-- DEMO SEED: 120 fictional guests, 287 visits, 24 members, historical
-- reservations only. Today and all future dates stay empty for stress testing.
-- History covers the rolling three calendar months before today in Jakarta.
-- Run the WHOLE file after demo/00_wipe_except_staff.sql on a demo database.
-- Requires the current migrations/ALL_IN_ONE.sql schema.
-- Staff, areas, tables, configuration and saved report filters are unchanged.
-- Spend and guest patterns are deterministic relative to the run date.
-- UUIDs and creation metadata may differ between resets.
-- Phone numbers are synthetic demo values, NOT guaranteed unassigned numbers.
-- This script does not send messages. Do not use demo contacts for outreach.
-- No upcoming bookings, deposit invoices or synthetic payments are created.
-- Campaigns and standalone vouchers stay empty; membership vouchers use the app function.
-- Failure rolls back the entire seed. If your SQL client leaves a failed
-- transaction open, run ROLLBACK before retrying either demo script.

begin;
set local search_path = public, pg_temp;
set local timezone = 'Asia/Jakarta';

-- Refuse a partial reset as well as an already populated guest book.
do $$
declare
  relation_name text;
  has_rows boolean;
begin
  foreach relation_name in array array[
    'guests', 'visits', 'reservations', 'members', 'member_transactions',
    'member_vouchers', 'standalone_vouchers', 'spin_submissions',
    'wa_campaigns', 'wa_campaign_audience', 'wa_outreach_log',
    'birthday_greetings', 'invoices', 'invoice_payments'
  ] loop
    execute format('select exists (select 1 from public.%I)', relation_name) into has_rows;
    if has_rows then
      raise exception 'Table % is not empty. Run demo/00_wipe_except_staff.sql before seeding.', relation_name;
    end if;
  end loop;
end $$;

-- The floor plan is client configuration, not seed data, so this file never
-- creates areas or tables. It does warn, because a demo where every booking
-- shows "no table" is a demo that looks broken.
do $$
begin
  if (select count(*) from areas) = 0 then
    raise warning 'No areas exist. Bookings will be seeded with no area. Build the floor plan first for a better demo.';
  end if;
  if (select count(*) from tables where is_active) = 0 then
    raise warning 'No active tables exist. Bookings will be seeded with no table. Build the floor plan first for a better demo.';
  end if;
end $$;

-- Deterministic pseudo-random in [0, 1) from a text key.
--
-- 7 hex digits is 28 bits, which cast to int is always positive. Taking 8 and
-- casting to bit(32)::int would be signed, and abs() on the minimum value
-- overflows, which is a once-in-4-billion crash that would be very hard to
-- explain the morning of a presentation.
create or replace function pg_temp.rnd(key text) returns numeric
language sql immutable as $fn$
  select (('x' || substr(md5(key), 1, 7))::bit(28)::int)::numeric / 268435456.0
$fn$;

-- Anchor every date to Jakarta, not UTC. Between midnight and 07:00 local the
-- server's current_date is still yesterday, which would shift the whole
-- quarter by a day and put "today" in the wrong place on the dashboard.
create temporary table _anchor on commit drop as
select today, (today - interval '3 months')::date as start_date,
       today - (today - interval '3 months')::date as history_days
from (select (now() at time zone 'Asia/Jakarta')::date as today) d;

-- The floor plan, numbered so visits can be dealt round it evenly instead of
-- every booking landing on the same table. Empty is tolerated: the joins
-- below are LEFT joins and the columns are nullable.
create temporary table _areas on commit drop as
select id, row_number() over (order by name, id) - 1 as n,
       count(*) over () as total
from areas;

create temporary table _tables on commit drop as
select t.id, t.area_id, row_number() over (order by t.name, t.id) - 1 as n,
       count(*) over () as total
from tables t where t.is_active;

-- ── The guest book ────────────────────────────────────────────────────
-- 120 guests with deliberate shapes, because the SEGMENTS are what a demo has
-- to show. Random guests would give one undifferentiated blob and the
-- retention report would say nothing.
--
--   vip: 6 guests, 6-8 visits; loyal: 16 guests, 3-5 visits;
--   return: 30 guests, 2-3 visits; corporate: 10 guests, 3-4 visits;
--   atrisk: 25 guests, 1-2 visits; first: 33 guests, one recent visit.
create temporary table _people (
  idx int, full_name text, gender text, company text, pattern text, birthday date
) on commit drop;

-- The eight regulars a restaurant knows by name.
insert into _people (idx, full_name, gender, company, pattern)
values
  (1,'Budi Santoso','Male',null,'vip'),
  (2,'Siti Rahayu','Female',null,'vip'),
  (3,'Agus Salim','Male','PT Sinar Abadi Nusantara','vip'),
  (4,'Dewi Lestari','Female',null,'vip'),
  (5,'Hendra Gunawan','Male',null,'vip'),
  (6,'Rizky Pratama','Male',null,'vip'),
  (7,'Ayu Ningsih','Female',null,'loyal'),
  (8,'Bambang Sutrisno','Male',null,'loyal');

-- The other 112, built from pools. The name is picked by a coprime stride
-- through each pool so consecutive guests do not share a surname, and the
-- (first, last) pair is unique across the run — which the unique check at
-- the bottom of this block enforces rather than assumes.
insert into _people (idx, full_name, gender, company, pattern)
select
  8 + s.i,
  f.name || ' ' || l.name,
  f.gender,
  case
    when p.pattern = 'corporate'
      then (array[
        'PT Rocker Kreasi Indonesia','PT Anugerah Persada Utama','CV Sumber Rejeki Abadi',
        'PT Tirta Kencana Lestari','PT Bina Karsa Mandiri','CV Harapan Jaya Sentosa',
        'PT Cipta Karya Persada','PT Mega Buana Sentosa','CV Mitra Karya Jaya',
        'PT Bumi Sejahtera Mandiri','CV Cahaya Nusantara','PT Graha Utama Persada'
      ])[1 + (s.i % 12)]
    -- A few non-corporate guests carry a company too, which is what happens
    -- in practice and keeps the company filter from looking like it only ever
    -- matches the corporate segment.
    when s.i % 17 = 0
      then (array['PT Sentosa Abadi Jaya','CV Karya Bersama Mandiri','PT Kirana Cipta Lestari'])[1 + (s.i % 3)]
    else null
  end,
  p.pattern
from generate_series(1, 112) as s(i)
cross join lateral (
  select case
    when s.i <= 14 then 'loyal'
    when s.i <= 44 then 'return'
    when s.i <= 54 then 'corporate'
    when s.i <= 79 then 'atrisk'
    else 'first'
  end as pattern
) p
cross join lateral (
  select name, gender from (values
    ('Ahmad','Male'),('Rina','Female'),('Joko','Male'),('Indah','Female'),
    ('Doni','Male'),('Fitri','Female'),('Yusuf','Male'),('Lina','Female'),
    ('Arif','Male'),('Maya','Female'),('Taufik','Male'),('Wulan','Female'),
    ('Iwan','Male'),('Diah','Female'),('Rudi','Male'),('Nanda','Female'),
    ('Fajar','Male'),('Citra','Female'),('Bayu','Male'),('Mega','Female'),
    ('Reza','Male'),('Putri','Female'),('Dimas','Male'),('Sari','Female'),
    ('Ilham','Male'),('Tiara','Female'),('Galih','Male'),('Vina','Female'),
    ('Hadi','Male'),('Ella','Female'),('Surya','Male'),('Novi','Female'),
    ('Teguh','Male'),('Ratih','Female'),('Anton','Male'),('Yuni','Female'),
    ('Firman','Male'),('Dina','Female'),('Lukman','Male'),('Anisa','Female'),
    ('Deni','Male'),('Ika','Female'),('Rahmat','Male'),('Sinta','Female'),
    ('Bagas','Male'),('Laras','Female'),('Yoga','Male'),('Ayu','Female')
  ) as v(name, gender) offset ((s.i * 13) % 48) limit 1
) f
cross join lateral (
  select name from (values
    ('Wijaya'),('Kusuma'),('Pratama'),('Nugroho'),('Setiawan'),('Hidayat'),
    ('Saputra'),('Permana'),('Wibowo'),('Firdaus'),('Ramadhan'),('Syahputra'),
    ('Hartono'),('Suryadi'),('Kurniawan'),('Handoko'),('Maulana'),('Prakoso'),
    ('Anggraini'),('Puspita'),('Safitri'),('Utami'),('Rahmawati'),('Yuliani')
  ) as v(name) offset (((s.i * 7) / 48 + s.i * 5) % 24) limit 1
) l;

-- A duplicate name would collide on nothing (names are not unique) but would
-- make the membership join below pick the wrong guest, silently. Catch it
-- here, where the message can say so, rather than three screens later.
do $$
declare dup text;
begin
  select full_name into dup from _people group by full_name having count(*) > 1 limit 1;
  if dup is not null then
    raise exception 'Name pools produced a duplicate: %. Widen a pool or change a stride.', dup;
  end if;
end $$;

-- Birthdays spread across the year, with a deliberate cluster in the CURRENT
-- month so the birthday badge and follow-up list are not empty during the
-- presentation. Every 10th guest is forced into the current month; together
-- with the ones that land there naturally that is around 20 of 120, enough to
-- page through and not so many it looks fake.
update _people p set birthday =
  case when p.idx % 10 = 0
       then make_date(1985 + (p.idx % 15),
                      extract(month from (select today from _anchor))::int,
                      1 + (p.idx * 7) % 27)
       else make_date(1980 + (p.idx % 20), 1 + (p.idx * 5) % 12, 1 + (p.idx * 11) % 27)
  end;

insert into guests (name, phone, gender, birthday, company, notes)
select
  p.full_name,
  -- Synthetic demo phone values; not guaranteed to be unassigned.
  '0812' || lpad((55000000 + p.idx)::text, 8, '0'),
  p.gender,
  p.birthday,
  p.company,
  case when p.pattern = 'corporate' then 'Sering booking untuk acara kantor.'
       when p.pattern = 'vip'       then 'Pelanggan tetap, kenal staf.'
       else null end
from _people p;

-- ── Visits ────────────────────────────────────────────────────────────
-- One row per visit, dated within the previous three calendar months.
--
-- Weekends carry roughly double the covers of a weekday, which is what makes
-- the Peak Traffic chart look like a restaurant instead of a flat line. That
-- weighting is applied by NUDGING a visit's date onto the nearest weekend for
-- a share of visits, rather than by choosing dates at random and hoping.
create temporary table _visits on commit drop as
with p as (
  select g.id as guest_id, pe.pattern, pe.idx,
         (select today from _anchor) as today,
         (select history_days from _anchor) as history_days
  from guests g join _people pe on pe.full_name = g.name
),
n as (
  select guest_id, pattern, idx, today, history_days,
         case pattern
           when 'vip'       then 6 + (idx % 3)   -- roughly monthly
           when 'loyal'     then 3 + (idx % 3)
           when 'return'    then 2 + (idx % 2)
           when 'corporate' then 3 + (idx % 2)
           when 'atrisk'    then 1 + (idx % 2)
           else 1
         end as visit_count
  from p
),
spread as (
  select n.*, generate_series(1, n.visit_count) as k from n
),
raw as (
  select
    guest_id, pattern as pat, idx, k, today,
    (today - (
      case pattern
        -- At-risk guests stop 60 to 88 days ago, which is what puts them in
        -- the at-risk report instead of looking like ordinary regulars.
        when 'atrisk' then 60 + ((idx * 7 + k * 3) % 28)
        -- First timers came recently, so they land in the "new, not returned"
        -- segment rather than looking dormant.
        when 'first'  then 3 + ((idx * 5) % 25)
        -- Everyone else is spread across the rolling three-month window.
        else 1 + ((idx * 29 + k * 31) % history_days)
      end
    ))::date as base_date
  from spread
)
select
  guest_id, pat, idx, k,
  -- Pull a third of visits onto the following weekend. Left alone, the
  -- dates above are uniform across weekdays and the busiest-day chart is
  -- flat, which no restaurant's is.
  case
    when (idx * 3 + k * 7) % 3 = 0
     -- Monday to THURSDAY only. Including Friday drained it onto Saturday and
     -- left Friday the quietest night of the week, which no restaurant's is.
     and extract(isodow from base_date) between 1 and 4
     and base_date + (6 - extract(isodow from base_date)::int) < today
      then (base_date + (6 - extract(isodow from base_date)::int))::date
    else base_date
  end as visit_date
from raw;

-- Party size and spend are derived twice below (once for the value, once
-- inside the spend formula), so they live here as one definition instead.
create temporary table _visit_rows on commit drop as
select
  v.*,
  gen_random_uuid() as visit_id,
  gen_random_uuid() as reservation_id,
  case
    -- Corporate events: the 8-to-17 groups a restaurant gets a few times a
    -- month. These are the reason p90 spend is three times the median, and
    -- without them the spend chart is a narrow band with no tail.
    when v.pat = 'corporate' then 8 + ((v.idx * 3 + v.k) % 10)
    -- Roughly one visit in 20 is a celebration: a family table of 8 to 14.
    when (v.idx * 7 + v.k * 11) % 20 = 0 then 8 + ((v.idx * 5 + v.k) % 7)
    -- Everything else is what a restaurant mostly serves, couples and small
    -- groups. A uniform 2-to-6 here pushed the average past 4.8 and, worse,
    -- gave most of the book a visit over the Rp 1.000.000 single-visit High
    -- Spender line, so 58% of guests came out High.
    when v.pat = 'vip' then 2 + ((v.idx + v.k) % 3)
    else 2 + ((v.idx * 2 + v.k) % 4)   -- 2 to 5, median 3, same as the real one
  end as pax,
  row_number() over (order by v.idx, v.k) - 1 as seq
from _visits v;

insert into visits (
  id, guest_id, visit_type, visit_date, visit_time, pax, spend_amount,
  status, completed_at, assigned_area, table_id, created_at, updated_at
)
select
  v.visit_id, v.guest_id,
  case when (v.idx + v.k) % 3 = 0 then 'Reservation' else 'Walk-In' end,
  v.visit_date,
  -- Lunch and dinner services, not a uniform smear across the day.
  (case when (v.idx + v.k) % 3 = 0
        then time '11:30' + ((v.k * 17) % 90) * interval '1 minute'
        else time '18:00' + ((v.k * 23) % 150) * interval '1 minute'
   end),
  v.pax,
  -- Spend is built from a per-pax figure so it stays coherent with party
  -- size, then nudged by the weekday. A flat random total would produce
  -- 2-pax bills of Rp 4 juta and 20-pax bills of Rp 300k.
  round((
    -- Per-pax bands, tuned so the High Spender split lands near a quarter of
    -- the book rather than nearly all of it. The threshold is Rp 300.000 per
    -- pax OR Rp 1.000.000 on one visit, so bands that all START above 300k
    -- make every guest High and the tier badge stops meaning anything. An
    -- early attempt did exactly that: 56 of 64.
    case v.pat
      when 'corporate' then 106000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') *  87000
      when 'vip'       then 122000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') * 146000
      when 'loyal'     then 105000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') * 122000
      else                   98000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') * 119000
    end
    -- A "big night": wine, a set menu, a celebration. Roughly one visit in
    -- five, lifted 1.5x to 2.1x on the per-head figure.
    --
    -- Without this the bands above are near-uniform and top out around
    -- Rp 276.000 a head, so NO visit ever crossed the Rp 300.000 per-pax
    -- High Spender line and the "High Average Spend Per Person" report was
    -- permanently empty. Half the spending model went untested.
    --
    -- The real restaurant, measured 2026-09-02: 18% of visits are at or over
    -- Rp 300.000 a head, and 18% of guests AVERAGE above it, with a p90 of
    -- Rp 363.000. A uniform band cannot produce that shape; it needs a tail.
    -- NOT applied to corporate. A 20-cover banquet already produces a large
    -- bill through party size; stacking a wine-night multiplier on top of it
    -- pushed p90 spend to Rp 2.6jt against a real Rp 2.0jt, all of it from a
    -- handful of implausible invoices.
    * (case when v.pat <> 'corporate' and (v.idx * 11 + v.k * 7) % 4 = 0
            then 1.9 + pg_temp.rnd(v.idx || ':' || v.k || ':big') * 0.9
            else 1.0 end)
    * (case when extract(isodow from v.visit_date) in (6, 7) then 1.18 else 1.0 end)
    * v.pax
  ) / 1000) * 1000 as spend_amount,
  'Done',
  (v.visit_date + time '21:00') at time zone 'Asia/Jakarta',
  coalesce(t.area_id, a.id),
  t.id,
  (v.visit_date + time '10:00') at time zone 'Asia/Jakarta',
  (v.visit_date + time '21:00') at time zone 'Asia/Jakarta'
from _visit_rows v
-- Deal the bookings round the floor plan instead of stacking every one of
-- the visits on the first table, which would make area occupancy meaningless.
left join _areas  a on a.total > 0 and a.n = v.seq % a.total
left join _tables t on t.total > 0 and t.n = v.seq % t.total;

-- ── Reservations ──────────────────────────────────────────────────────
-- Completed historical bookings only; today and future dates stay clear.
insert into reservations (
  id, booking_name, guest_id, reservation_date, reservation_time, pax, occasion,
  reservation_source, status, notes, assigned_area, table_id, created_at
)
select
  v.reservation_id, (select name from guests where id = v.guest_id),
  v.guest_id, v.visit_date,
  time '11:30' + ((v.k * 17) % 90) * interval '1 minute',
  v.pax,
  case (v.idx + v.k) % 7
    when 0 then 'Birthday' when 1 then 'Business Lunch' when 2 then 'Anniversary'
    when 3 then 'Family Gathering' when 4 then 'Business Dinner' else null end,
  -- A realistic channel mix. Leaving this mostly null, which is what happens
  -- in practice, would make the channel report useless in a demo.
  case (v.idx * 3 + v.k) % 5
    when 0 then 'Online Form' when 1 then 'WhatsApp' when 2 then 'Instagram'
    when 3 then 'Telepon' else 'Walk-in' end,
  'Completed', null,
  coalesce(t.area_id, a.id), t.id,
  (v.visit_date - 2 + time '10:00') at time zone 'Asia/Jakarta'
from _visit_rows v
left join _areas  a on a.total > 0 and a.n = v.seq % a.total
left join _tables t on t.total > 0 and t.n = v.seq % t.total
where (v.idx + v.k) % 3 = 0;

-- Link completed bookings to their actual visit, so reports/backfill do not
-- treat them as two unrelated guest events.
update visits vi set reservation_id = v.reservation_id
from _visit_rows v
where vi.id = v.visit_id and (v.idx + v.k) % 3 = 0;

-- A historical guest should not look newly acquired on the seed date.
update guests g set created_at = first_visit.at - interval '2 days'
from (select guest_id, min(created_at) as at from visits group by guest_id) first_visit
where g.id = first_visit.guest_id;



-- ── Membership ────────────────────────────────────────────────────────
-- Cards on guests whose visit history justifies the card. A member with no
-- visits looks like test data, so these are all VIPs, loyals or corporates.
insert into members (member_number, member_type, full_name, phone_number, guest_id, is_active, created_at)
select
  'M-' || lpad(row_number() over (order by g.name)::text, 4, '0'),
  case when p.pattern = 'corporate' then 'Company' else 'Family' end,
  g.name, g.phone, g.id, true, g.created_at
from guests g
join _people p on p.full_name = g.name
where p.pattern in ('vip', 'corporate')
   or (p.pattern = 'loyal' and p.idx % 2 = 0);

-- A few nicknames, because the Membership page falls back to the full name
-- when there is none and a demo of the nickname feature needs some set.
-- Guarded: a database that has not had the 2026-08-31 section of
-- ALL_IN_ONE.sql run does not have this column, and the seed should say so
-- rather than abort 200 lines in.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'nickname'
  ) then
    update members set nickname = split_part(full_name, ' ', 1)
    where id in (select id from members order by member_number limit 6);
  else
    raise warning 'members.nickname is missing, so no nicknames were seeded. Re-run migrations/ALL_IN_ONE.sql to add it.';
  end if;
end $$;

-- Transactions go through the app's OWN function rather than being inserted
-- directly, so stickers and vouchers are awarded by exactly the rules the app
-- uses. Hand-inserting them would produce counts that the app would never
-- have produced, and the membership screen would quietly disagree with itself.
do $$
declare
  r record;
  v record;
begin
  for r in select m.id as member_id, m.guest_id, m.member_type from members m loop
    for v in
      select id, spend_amount, visit_date
      from visits
      where guest_id = r.guest_id and spend_amount > 0
      order by visit_date, visit_time, id
    loop
      perform add_member_transaction(
        r.member_id,
        v.spend_amount,
        (v.visit_date + time '20:00') at time zone 'Asia/Jakarta',
        null, null, 'Demo', v.id
      );
    end loop;
  end loop;
end $$;

-- ── Confirm ───────────────────────────────────────────────────────────
-- Validate before committing; a broken seed rolls back instead of persisting.
do $$
begin
  if (select count(*) from guests) <> 120 or (select count(*) from visits) <> 287 then
    raise exception 'Unexpected demo guest/visit counts.';
  end if;
  if exists (
    select 1 from visits, _anchor
    where visit_date < start_date or visit_date >= today
  ) then
    raise exception 'A historical visit falls outside the three-month window.';
  end if;
  if exists (
    select 1 from visits v left join reservations r on r.id = v.reservation_id
    where v.visit_type = 'Reservation' and
      (r.id is null or r.guest_id <> v.guest_id or r.reservation_date <> v.visit_date
       or r.reservation_time <> v.visit_time or r.pax <> v.pax)
  ) then
    raise exception 'Reservation and visit histories do not match.';
  end if;
  if exists (
    select 1 from visits v join tables t on t.id = v.table_id
    where v.assigned_area is distinct from t.area_id
    union all
    select 1 from reservations r join tables t on t.id = r.table_id
    where r.assigned_area is distinct from t.area_id
  ) then
    raise exception 'A seeded table is assigned to the wrong area.';
  end if;
  if exists (
    select 1 from reservations, _anchor
    where reservation_date < start_date or reservation_date >= today
  ) then
    raise exception 'A seeded reservation falls outside the historical window; today onward must stay empty.';
  end if;
  if exists (select 1 from member_transactions where visit_id is null) then
    raise exception 'A membership transaction is missing its visit link.';
  end if;
end $$;

select 'guests'                as what, count(*)::text as value from guests
union all select 'visits',              count(*)::text from visits
union all select '  visits per month',  to_char(count(*) / 3.0, 'FM990') from visits
union all select '  covers per month',  to_char(sum(pax) / 3.0, 'FM9990') from visits
union all select 'reservations',        count(*)::text from reservations
union all select '  of which upcoming', count(*)::text from reservations
         where reservation_date >= (select today from _anchor)
union all select 'demo invoices', count(*)::text from invoices
union all select 'demo payments', count(*)::text from invoice_payments
union all select 'upcoming waitlisted', count(*)::text from reservations where status='Waitlist'
union all select 'upcoming awaiting deposit', count(*)::text from reservations where status='Incoming'
union all select 'members',             count(*)::text from members
union all select '  stickers awarded',  coalesce(sum(total_stickers),0)::text from members
union all select '  vouchers earned',   count(*)::text from member_vouchers
union all select 'High Spenders',       count(*)::text from guests where spending_tier = 'high_spender'
union all select 'Medium Spenders',     count(*)::text from guests where spending_tier = 'medium_spender'
union all select 'birthdays this month',count(*)::text from guests
         where birthday is not null
           and extract(month from birthday) = extract(month from (select today from _anchor))
union all select 'median spend',         to_char(percentile_disc(0.5) within group (order by spend_amount), 'FM999G999G999')
         from visits where spend_amount > 0
union all select 'p90 spend',            to_char(percentile_disc(0.9) within group (order by spend_amount), 'FM999G999G999')
         from visits where spend_amount > 0
union all select 'average pax',          to_char(avg(pax), 'FM990D0') from visits
union all select 'total revenue',        to_char(sum(spend_amount), 'FM999G999G999G999') from visits
order by 1;

commit;
