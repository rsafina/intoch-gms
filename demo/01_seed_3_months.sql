-- ============================================================
-- DEMO SEED: three months of trading
-- ============================================================
-- Builds a restaurant that looks like it has been open for a quarter, so
-- every screen in the app has something real to show: dashboard, reports,
-- retention tiers, spending tiers, birthdays, membership, broadcast segments.
--
-- Run AFTER 00_wipe_except_staff.sql, on a demo database only.
-- Needs areas and tables to exist — the wipe script keeps them.
--
-- ── Size ──────────────────────────────────────────────────────────────
--   120 guests, 287 visits across 90 days (about 96 a month, roughly 460
--   covers a month), 119 reservations of which 28 are in the next five days,
--   24 members.
--
-- This replaced a 64-guest version on 2026-09-01. The visit volume is about
-- the same; the guest book nearly doubled, which is what the segments and the
-- guest list needed.
--
-- At roughly 3 visits a day, an individual day view is still quiet. That is
-- deliberate — it is what this volume of trading looks like — and it is what
-- demo/02_topup_last_5_days.sql exists for: run it before a presentation to
-- fill the last five days and the upcoming bookings.
--
-- ── The numbers are not invented ──────────────────────────────────────
-- The spend and party-size distributions come from a real restaurant, so the
-- reports look like a restaurant rather than like random numbers. Measured
-- against Blue Heron prod on 2026-09-01, over its own last 90 days:
--
--                        REAL          THIS SEED
--   visits / 90 days     685           287
--   distinct guests      597           120
--   visits per guest     1.15          2.4
--   average pax          4.56          5.01
--   median pax           3             3
--   median spend         672.000       659.000
--   p90 spend            1.996.000     1.886.000
--   High Spenders        38%           35%
--
-- The spend shape matches closely. VISITS PER GUEST deliberately does not:
-- a real restaurant is overwhelmingly one-time guests, and a demo seeded that
-- way has almost nothing in its loyal, VIP and at-risk segments. 2.4 is the
-- compromise, chosen 2026-09-01.
--
-- The per-pax figure is what the tuning is really about: the High Spender
-- threshold is Rp 300.000 per pax OR Rp 1.000.000 on one visit, and the real
-- median per-pax is Rp 192.000. So a realistic spread puts guests on BOTH
-- sides of the line. Seeding round numbers would either make everyone High or
-- nobody, and the tier badges would look broken in a demo.
--
-- ── Deterministic ─────────────────────────────────────────────────────
-- Wipe + re-seed gives you the SAME restaurant every time, down to the rupiah.
-- Rehearse a presentation, reset, and the guest you practised on is still
-- there with the same numbers.
--
-- This is NOT done with setseed(). The previous version of this file used
-- setseed() + random() and claimed to be reproducible; it was not. Three
-- resets in a row on 2026-09-01 produced three different restaurants (total
-- revenue 264.083.000 / 264.261.000 / 265.653.000). setseed fixes the SEQUENCE
-- of random numbers, but not which row gets which draw: guest ids are fresh
-- uuids on every run, they feed the joins, and the row order moves with them.
--
-- Instead every varying number is a hash of the row's OWN stable identity
-- (its guest index and visit number). Same input, same output, no matter what
-- order the planner walks the rows in. See pg_temp.rnd below.
--
-- ── Names ─────────────────────────────────────────────────────────────
-- Common Indonesian names, and INVENTED company names. Deliberately not real
-- companies: a screenshot with a real firm's name on a fake Rp 8 juta invoice
-- is not something to put in a sales deck.
--
-- The eight VIPs are hand-named and always come out the same, so you can
-- rehearse on "Budi Santoso" and he is still there after a reset. The other
-- 112 are built from name pools, because typing 120 literals is a place for
-- a duplicate to hide and a duplicate phone number would fail the insert.

-- Not idempotent, by nature: running it twice would give you 240 guests and
-- two of every visit. Refuse rather than quietly double the restaurant.
do $$
begin
  if (select count(*) from guests) > 0 then
    raise exception
      E'This database already has % guest(s).\n\nThis seed is not re-runnable — running it again would duplicate everything.\nRun demo/00_wipe_except_staff.sql first, then this file.',
      (select count(*) from guests);
  end if;
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
create function pg_temp.rnd(key text) returns numeric
language sql immutable as $fn$
  select (('x' || substr(md5(key), 1, 7))::bit(28)::int)::numeric / 268435456.0
$fn$;

-- Anchor every date to Jakarta, not UTC. Between midnight and 07:00 local the
-- server's current_date is still yesterday, which would shift the whole
-- quarter by a day and put "today" in the wrong place on the dashboard.
create temporary table _anchor as
select (now() at time zone 'Asia/Jakarta')::date as today;

-- The floor plan, numbered so visits can be dealt round it evenly instead of
-- every booking landing on the same table. Empty is tolerated: the joins
-- below are LEFT joins and the columns are nullable.
create temporary table _areas as
select id, row_number() over (order by name) - 1 as n,
       count(*) over () as total
from areas;

create temporary table _tables as
select t.id, t.area_id, row_number() over (order by t.name) - 1 as n,
       count(*) over () as total
from tables t where t.is_active;

-- ── The guest book ────────────────────────────────────────────────────
-- 120 guests with deliberate shapes, because the SEGMENTS are what a demo has
-- to show. Random guests would give one undifferentiated blob and the
-- retention report would say nothing.
--
--   pattern 'vip'         8 guests, ~2 visits a week, big spend
--   pattern 'loyal'      20 guests, 12 to 16 visits across the quarter
--   pattern 'return'     40 guests, 5 to 8 visits
--   pattern 'corporate'  12 guests, few visits, very large parties and bills
--   pattern 'atrisk'     20 guests, visited early, nothing since
--   pattern 'first'      20 guests, exactly 1 visit, recent
--
-- Those counts are what make the volume land near 300 visits a month. Change
-- a pattern's visit count and the monthly total moves with it.
create temporary table _people (
  idx int, full_name text, gender text, company text, pattern text, birthday date
);

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
  -- Reserved-looking numbers that cannot collide with a real guest.
  '0812' || lpad((55000000 + p.idx)::text, 8, '0'),
  p.gender,
  p.birthday,
  p.company,
  case when p.pattern = 'corporate' then 'Sering booking untuk acara kantor.'
       when p.pattern = 'vip'       then 'Pelanggan tetap, kenal staf.'
       else null end
from _people p;

-- ── Visits ────────────────────────────────────────────────────────────
-- One row per visit, dated across the last 90 days.
--
-- Weekends carry roughly double the covers of a weekday, which is what makes
-- the Peak Traffic chart look like a restaurant instead of a flat line. That
-- weighting is applied by NUDGING a visit's date onto the nearest weekend for
-- a share of visits, rather than by choosing dates at random and hoping.
create temporary table _visits as
with p as (
  select g.id as guest_id, pe.pattern, pe.idx,
         (select today from _anchor) as today
  from guests g join _people pe on pe.full_name = g.name
),
n as (
  select guest_id, pattern, idx, today,
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
        -- Everyone else is spread across the whole 90 days. The stride is
        -- coprime-ish with 89 so a single guest's visits do not clump.
        else ((idx * 29 + k * 31) % 89)
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
     and base_date + (6 - extract(isodow from base_date)::int) <= today
      then (base_date + (6 - extract(isodow from base_date)::int))::date
    else base_date
  end as visit_date
from raw;

-- Party size and spend are derived twice below (once for the value, once
-- inside the spend formula), so they live here as one definition instead.
create temporary table _visit_rows as
select
  v.*,
  case
    -- Corporate events: the 20-to-40 groups a restaurant gets a few times a
    -- month. These are the reason p90 spend is three times the median, and
    -- without them the spend chart is a narrow band with no tail.
    when v.pat = 'corporate' then 8 + ((v.idx * 3 + v.k) % 13)
    -- Roughly one visit in 23 is a celebration: a family table of 8 to 15.
    when (v.idx * 7 + v.k * 11) % 20 = 0 then 8 + ((v.idx * 5 + v.k) % 7)
    -- Everything else is what a restaurant mostly serves, couples and small
    -- groups. A uniform 2-to-6 here pushed the average past 4.8 and, worse,
    -- gave most of the book a visit over the Rp 1.000.000 single-visit High
    -- Spender line, so 58% of guests came out High.
    when v.pat = 'vip' then 2 + ((v.idx + v.k) % 3)
    else 2 + ((v.idx * 2 + v.k) % 4)   -- 2 to 5, median 3, same as the real one
  end as pax,
  row_number() over (order by v.guest_id, v.k) - 1 as seq
from _visits v;

insert into visits (
  guest_id, visit_type, visit_date, visit_time, pax, spend_amount,
  status, completed_at, assigned_area, table_id, created_at, updated_at
)
select
  v.guest_id,
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
      when 'corporate' then 115000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') *  95000
      when 'vip'       then 132000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') * 158000
      when 'loyal'     then 114000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') * 132000
      else                  106000 + pg_temp.rnd(v.idx || ':' || v.k || ':s') * 128000
    end
    * (case when extract(isodow from v.visit_date) in (6, 7) then 1.18 else 1.0 end)
    * v.pax
  ) / 1000) * 1000 as spend_amount,
  'Done',
  (v.visit_date + time '21:00') at time zone 'Asia/Jakarta',
  a.id,
  t.id,
  (v.visit_date + time '19:00') at time zone 'Asia/Jakarta',
  (v.visit_date + time '21:00') at time zone 'Asia/Jakarta'
from _visit_rows v
-- Deal the bookings round the floor plan instead of stacking every one of
-- 900 visits on the first table, which would make area occupancy meaningless.
left join _areas  a on a.total > 0 and a.n = v.seq % a.total
left join _tables t on t.total > 0 and t.n = v.seq % t.total;

-- ── Reservations ──────────────────────────────────────────────────────
-- Past bookings that were honoured, plus a handful in the next few days so
-- the dashboard and the day view are not empty when you open them.
insert into reservations (
  guest_id, reservation_date, reservation_time, pax, occasion,
  reservation_source, status, notes, assigned_area, table_id, created_at
)
select
  v.guest_id, v.visit_date,
  time '19:00' + ((v.k * 19) % 120) * interval '1 minute',
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
  a.id, t.id,
  (v.visit_date - 2 + time '10:00') at time zone 'Asia/Jakarta'
from _visit_rows v
left join _areas  a on a.total > 0 and a.n = v.seq % a.total
left join _tables t on t.total > 0 and t.n = v.seq % t.total
where (v.idx + v.k) % 3 = 0;

-- Upcoming: today plus the next four days, 24 bookings so each day has a
-- handful rather than one lonely row.
insert into reservations (
  guest_id, reservation_date, reservation_time, pax, occasion,
  reservation_source, status, notes, assigned_area, table_id, created_at
)
select
  g.id,
  (select today from _anchor) + (r.n % 5),
  time '18:30' + ((r.n * 25) % 150) * interval '1 minute',
  2 + (r.n % 6),
  case r.n % 4 when 0 then 'Birthday' when 1 then 'Anniversary'
               when 2 then 'Business Dinner' else null end,
  case r.n % 4 when 0 then 'Online Form' when 1 then 'WhatsApp'
               when 2 then 'Instagram' else 'Telepon' end,
  'Reserved',
  case when r.n % 4 = 0 then 'Minta meja dekat jendela.' else null end,
  a.id, t.id,
  now() - (r.n || ' hours')::interval
from generate_series(1, 24) as r(n)
-- Pick by NAME, not by hashing the guest's uuid: uuids are regenerated on
-- every seed, so hashing them would hand tomorrow's bookings to different
-- guests each run and break the reproducibility above.
join lateral (
  select id from guests order by md5(name || ':up:' || r.n::text) limit 1
) g on true
left join _areas  a on a.total > 0 and a.n = r.n % a.total
left join _tables t on t.total > 0 and t.n = r.n % t.total;

-- ── Membership ────────────────────────────────────────────────────────
-- Cards on guests whose visit history justifies the card. A member with no
-- visits looks like test data, so these are all VIPs, loyals or corporates.
insert into members (member_number, member_type, full_name, phone_number, guest_id, is_active)
select
  'M-' || lpad(row_number() over (order by g.name)::text, 4, '0'),
  case when p.pattern = 'corporate' then 'Company' else 'Family' end,
  g.name, g.phone, g.id, true
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
      select spend_amount, visit_date
      from visits
      where guest_id = r.guest_id and spend_amount > 0
      order by visit_date
    loop
      perform add_member_transaction(
        r.member_id,
        v.spend_amount,
        (v.visit_date + time '20:00') at time zone 'Asia/Jakarta',
        null, null, 'Demo'
      );
    end loop;
  end loop;
end $$;

-- ── Confirm ───────────────────────────────────────────────────────────
select 'guests'                as what, count(*)::text as value from guests
union all select 'visits',              count(*)::text from visits
union all select '  visits per month',  to_char(count(*) / 3.0, 'FM990') from visits
union all select '  covers per month',  to_char(sum(pax) / 3.0, 'FM9990') from visits
union all select 'reservations',        count(*)::text from reservations
union all select '  of which upcoming', count(*)::text from reservations
         where reservation_date >= (select today from _anchor)
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
