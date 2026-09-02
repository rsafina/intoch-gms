-- ============================================================
-- DEMO: bookings for today and the next seven days
-- ============================================================
-- Separate from 01_seed_3_months.sql on purpose. That file builds a quarter
-- of TRADING HISTORY, which is what the reports need. This one fills the
-- FORWARD week, which is what the reservation list, the dashboard day tabs
-- and the Export Excel buttons need.
--
-- Run it whenever the upcoming days look thin. It is safe to run repeatedly:
-- see "Re-runnable" below.
--
-- Needs guests to exist. Run 01_seed_3_months.sql first.
--
-- ── What it is really for ─────────────────────────────────────────────
-- Exercising the reservation export. The export writes five columns — Name,
-- Phone Number, Date Time, Notes, Status — so the bookings below are shaped
-- to put something awkward in every one of them:
--
--   Name         a title to strip ("Ibu Alia" must export as "Alia"), a guest
--                who books under another name, and a very long name
--   Phone        one guest with NO phone at all, which must export blank
--                rather than the word null
--   Date Time    11:30 through 21:45, including exactly midday and a booking
--                at 00:30, so a d/m/y hh:mm format that silently drops the
--                afternoon would be visible
--   Notes        a comma, double quotes, a line break, a leading "=", an
--                empty note and a 300-character one
--   Status       every status the list can show, including the two cancelled
--                variants and one Deleted row that must NOT appear
--
-- The leading "=" is the one worth explaining. In a spreadsheet a cell
-- starting with = is a formula, so an export that writes notes carelessly can
-- turn a guest's note into a calculation, or worse. Verified on 2026-09-01
-- that SheetJS writes it as text (cell type "s", no <f> element), so the
-- .xlsx path is safe. The row is here so it stays safe.
--
-- ── Volume ────────────────────────────────────────────────────────────
-- The days are deliberately uneven, between 1 and 14 bookings. A flat 8 a day
-- would hide two real bugs: a dashboard export that only writes the visible
-- PAGE rather than the whole day, and a day view that breaks when a day has
-- almost nothing on it.
--
-- ── Re-runnable ───────────────────────────────────────────────────────
-- Every booking below is derived from stable inputs, so the same run produces
-- the same (guest, date, time) triples every time. The script deletes exactly
-- those triples before inserting, which means running it twice leaves the same
-- eight days and never duplicates. Bookings you made by hand are at different
-- times and survive untouched.

do $$
begin
  if (select count(*) from guests) = 0 then
    raise exception
      E'No guests in this database.\n\nRun demo/01_seed_3_months.sql first, then this file.';
  end if;
end $$;

-- Anchor to Jakarta, not UTC. Between midnight and 07:00 local the server's
-- current_date is still yesterday, and the whole week would land a day early.
create temporary table _anchor as
select (now() at time zone 'Asia/Jakarta')::date as today;

-- ── Guests that make the export interesting ───────────────────────────
-- Four guests whose NAMES and PHONES are the awkward part.
--
-- Matched on NAME, not phone. Matching on phone looked right and was wrong:
-- one of these four deliberately has no phone, so on the second run the
-- "does this phone already exist" test matched nothing and inserted her
-- again. Three runs, three Sinta Maharanis. Caught 2026-09-01 by running the
-- script three times and counting, which is the only way this kind of thing
-- ever shows up.
insert into guests (name, phone, gender, booking_alias, notes)
select v.name, v.phone, v.gender, v.alias, v.note
from (values
  -- The honorific must be stripped in the export, the same as on screen.
  ('Ibu Alia Kusumaningrum','081955000001','Female',null,
   'Demo: nama berawalan gelar, untuk menguji tampilan nama.'),
  -- Books the table under a company name. The export takes the canonical
  -- name plus the alias suffix, which is what guestDisplayName produces.
  ('Andi Wijaya','081955000002','Male','Rocker Kreasi',
   'Demo: booking atas nama perusahaan.'),
  -- Long enough to overflow a column that was sized by eye.
  ('Raden Mas Bagus Prakoso Adiwijaya Kusumaningrat','081955000003','Male',null,
   'Demo: nama panjang, untuk menguji lebar kolom.'),
  -- No phone at all. Must export as an empty cell, not the word null.
  ('Sinta Maharani',null,'Female',null,
   'Demo: tanpa nomor telepon, untuk menguji kolom kosong di export.')
) as v(name, phone, gender, alias, note)
where not exists (select 1 from guests g where g.name = v.name);

-- ── The bookings ──────────────────────────────────────────────────────
-- Built into a temp table first so the delete below can target exactly these
-- rows, and so the shape is readable in one place.
create temporary table _upcoming as
with days as (
  -- d = 0 is today. Eight days, so "the next seven" is fully covered even
  -- when it is already late in the evening today.
  select d, (select today from _anchor) + d as res_date,
         case d
           when 0 then 9    -- today: a working service, part of it already done
           when 1 then 12   -- tomorrow: the busiest day
           when 2 then 6
           when 3 then 14   -- deliberately over one page, to catch a dashboard
                            -- export that only writes the visible page
           when 4 then 1    -- deliberately almost empty
           when 5 then 8
           when 6 then 7
           else 5
         end as n
  from generate_series(0, 7) as d
),
slots as (
  select d.d, d.res_date, s.i
  from days d, lateral generate_series(1, d.n) as s(i)
),
-- Pick guests by NAME, never by hashing the uuid: guest ids are regenerated
-- by every reseed, so hashing them would hand the same slot to a different
-- guest each run and break the re-runnable property above.
picked as (
  select s.*,
         coalesce(
           -- Pin the four edge-case guests to a slot each. Leaving it to the
           -- hash looked fine and was not: on 2026-09-01 the guest with no
           -- phone drew no slot at all, so the blank-phone column went
           -- untested by the very script written to test it. The no-phone
           -- guest gets the 00:30 slot, so one booking covers two edges.
           case
             when s.d = 0 and s.i = 1 then (select id from guests where name = 'Ibu Alia Kusumaningrum')
             when s.d = 1 and s.i = 1 then (select id from guests where name = 'Andi Wijaya')
             when s.d = 2 and s.i = 1 then (select id from guests where name = 'Sinta Maharani')
             when s.d = 3 and s.i = 1 then (select id from guests where name = 'Raden Mas Bagus Prakoso Adiwijaya Kusumaningrat')
           end,
           (select g.id from guests g
             order by md5(g.name || ':up:' || s.d::text || ':' || s.i::text)
             limit 1)
         ) as guest_id
  from slots s
)
select
  p.d, p.i, p.res_date, p.guest_id,
  -- Lunch service, then dinner. One booking sits at exactly 12:00 and one at
  -- 00:30, which is the pair that catches a time format that has quietly lost
  -- its AM/PM or its 24-hour handling.
  case
    when p.d = 2 and p.i = 1 then time '00:30'
    when p.i % 3 = 1 then time '12:00' + ((p.i * 20) % 120) * interval '1 minute'
    else time '18:00' + ((p.i * 27) % 225) * interval '1 minute'
  end as res_time,
  2 + ((p.d * 3 + p.i * 5) % 9) as pax,
  case (p.d + p.i) % 6
    when 0 then 'Birthday' when 1 then 'Anniversary' when 2 then 'Business Dinner'
    when 3 then 'Family Gathering' when 4 then 'Business Lunch' else null end as occasion,
  case (p.d * 2 + p.i) % 5
    when 0 then 'Online Form' when 1 then 'WhatsApp' when 2 then 'Instagram'
    when 3 then 'Telepon' else 'Walk-in' end as source,
  -- Today is part-finished, which is what a real day looks like at 3pm.
  -- Later days are all still ahead, with a couple of cancellations, because a
  -- list with one status in it does not test a status column.
  case
    when p.d = 0 and p.i <= 3 then 'Completed'
    when p.d = 0 and p.i <= 5 then 'Arrived'
    when p.d = 1 and p.i = 4 then 'Cancelled'
    when p.d = 1 and p.i = 9 then 'Cancelled (No Show)'
    when p.d = 3 and p.i = 7 then 'Cancelled'
    when p.d = 5 and p.i = 2 then 'Confirmed'
    -- Exactly one Deleted row. Deleted means a staff data-entry mistake and
    -- must not appear in the list, the day view or the export. If it shows
    -- up anywhere, that is the bug this row exists to find.
    when p.d = 6 and p.i = 3 then 'Deleted'
    else 'Reserved'
  end as status,
  -- The notes rotate through the shapes that break exports.
  case (p.d * 4 + p.i) % 9
    when 0 then 'Meja dekat jendela, tolong siapkan kursi bayi'
    when 1 then 'Tanya "menu spesial" hari ini'
    when 2 then E'Alergi kacang.\nTolong catat di dapur.'
    when 3 then '=1+1 (uji formula, harus tampil apa adanya)'
    when 4 then null
    when 5 then '   '
    when 6 then 'Ulang tahun ke-40, minta lilin & kue. Tolong jangan dinyanyikan, tamunya malu.'
    when 7 then repeat('Catatan panjang untuk menguji lebar kolom dan pemotongan teks. ', 5)
    else 'Rombongan kantor, minta struk terpisah per divisi'
  end as notes
from picked p;

-- Delete exactly what this script is about to write, and nothing else. A
-- blanket "delete every future reservation" would take out the bookings from
-- 01_seed_3_months.sql and anything you entered by hand while testing.
delete from reservations r
using _upcoming u
where r.guest_id = u.guest_id
  and r.reservation_date = u.res_date
  and r.reservation_time = u.res_time;

insert into reservations (
  guest_id, reservation_date, reservation_time, pax, occasion,
  reservation_source, status, notes, assigned_area, table_id, created_at
)
select
  u.guest_id, u.res_date, u.res_time, u.pax, u.occasion, u.source, u.status, u.notes,
  a.id, t.id,
  -- Booked between a day and a week ahead, so "created" never sits after the
  -- booking it describes.
  (now() at time zone 'Asia/Jakarta') - ((u.d + u.i) || ' hours')::interval
from _upcoming u
-- Deal the bookings round the floor plan instead of stacking them on one
-- table. Left joins: a database with no tables yet still seeds cleanly.
left join lateral (
  select id from areas order by name offset ((u.d + u.i) % greatest((select count(*) from areas), 1)) limit 1
) a on true
left join lateral (
  select id from tables where is_active order by name
   offset ((u.d * 3 + u.i) % greatest((select count(*) from tables where is_active), 1)) limit 1
) t on true;

-- ── Confirm ───────────────────────────────────────────────────────────
select
  to_char(reservation_date, 'Dy DD Mon') as day,
  count(*) filter (where status <> 'Deleted') as bookings,
  count(*) filter (where status = 'Deleted')  as hidden_deleted,
  sum(pax) filter (where status not in ('Deleted', 'Cancelled', 'Cancelled (No Show)')) as expected_pax,
  string_agg(distinct status, ', ' order by status) as statuses
from reservations
where reservation_date >= (select today from _anchor)
  and reservation_date <= (select today from _anchor) + 7
group by reservation_date
order by reservation_date;

select 'export edge cases now present' as check, count(*) as found
from reservations r
join guests g on g.id = r.guest_id
where r.reservation_date >= (select today from _anchor)
  and (g.phone is null
       or g.booking_alias is not null
       or g.name like 'Ibu %'
       or r.notes like '=%'
       or r.notes like '%"%'
       or r.notes like E'%\n%'
       or r.notes is null);
