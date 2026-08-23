-- ============================================================
-- DEMO DATA: birthday follow-up
-- ============================================================
-- Eight fake guests that light up every state of the birthday feature, so
-- you can see it working without waiting for a real birthday.
--
-- NOT PART OF THE MIGRATION SET. Never run this on a client's database.
-- `migrations/ALL_IN_ONE.sql` must be run FIRST: this file writes into
-- birthday_greetings, which that file creates.
--
-- Everything is named "ZZ Demo ..." and every phone number starts 0899000,
-- so both are trivial to spot in the guest list and the cleanup at the
-- bottom of this file removes exactly these rows and nothing else.
--
-- Re-runnable: guarded by name, so running it twice changes nothing.
--
-- It is guarded by NAME and not only by `on conflict (phone)` because one of
-- these guests deliberately has no phone number, and in SQL a NULL never
-- conflicts with another NULL. With only the phone guard, that one guest was
-- duplicated on every re-run. Found by running this file twice against a
-- local Postgres before handing it over.
--
-- Note it does NOT update dates on a re-run, so if you seeded last month,
-- delete and re-seed rather than running it again.
--
-- ── The timezone line matters ──────────────────────────────────────────
-- Supabase runs in UTC. Jakarta is UTC+7, so between midnight and 07:00
-- local, `current_date` on the server is still YESTERDAY. The app decides
-- what "today" means from the front-desk browser's clock, so seeding with a
-- bare `current_date` would put the "birthday today" guest on the wrong day
-- for the first seven hours of every morning. Hence the explicit conversion.

begin;

-- Fail with a sentence a human can act on, rather than
-- `relation "birthday_greetings" does not exist` pointing at line 117.
-- Hit for real on 2026-08-23: ALL_IN_ONE.sql had been run BEFORE the
-- birthday section was added to it, so the app looked up to date and this
-- file blew up 100 lines in.
do $$
begin
  if to_regclass('public.birthday_greetings') is null then
    raise exception
      'birthday_greetings does not exist. Run migrations/ALL_IN_ONE.sql first (it is idempotent, so re-running a database that is already set up is safe), then run this file again.';
  end if;
end $$;

with anchor as (
  select (now() at time zone 'Asia/Jakarta')::date as today
),
bounds as (
  select
    today,
    extract(year  from today)::int  as yr,
    extract(month from today)::int  as mo,
    extract(day   from today)::int  as dy,
    extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int as last_dy
  from anchor
),
-- Every demo birthday is pinned INSIDE the current month on purpose: the
-- badge and both tables are month-scoped, so a date that spilled into next
-- month would just not appear and would look like a bug.
--
-- greatest/least keep the arithmetic inside the month at both ends. Near the
-- 1st there is no "earlier this month" day to use, and on the last day of the
-- month "tomorrow" and "in 3 days" collapse onto today. Both are handled
-- rather than crashing, and both are called out in the notes below.
d as (
  select
    yr, mo, dy, last_dy,
    least(dy, last_dy)                    as d_today,
    least(dy + 1, last_dy)                as d_tomorrow,
    least(dy + 3, last_dy)                as d_soon,
    last_dy                               as d_endmonth,
    greatest(dy - 5, 1)                   as d_passed
  from bounds
)
insert into guests (name, phone, gender, birthday, notes)
select * from (
  select
    'ZZ Demo - Ulang Tahun Hari Ini'  as name,
    '089900010001'                    as phone,
    'Female'                          as gender,
    make_date(1990, mo, d_today)      as birthday,
    'Demo data for the birthday feature. Safe to delete.' as notes
  from d
  union all
  select 'ZZ Demo - Besok', '089900010002', 'Male',
         make_date(1988, mo, d_tomorrow), 'Demo data for the birthday feature. Safe to delete.' from d
  union all
  select 'ZZ Demo - Beberapa Hari Lagi', '089900010003', 'Female',
         make_date(1995, mo, d_soon), 'Demo data for the birthday feature. Safe to delete.' from d
  union all
  select 'ZZ Demo - Akhir Bulan', '089900010004', 'Male',
         make_date(1992, mo, d_endmonth), 'Demo data for the birthday feature. Safe to delete.' from d
  union all
  -- Should appear in the list labelled "sudah lewat" and must NOT be in the
  -- red count: a birthday five days ago cannot be un-missed.
  select 'ZZ Demo - Sudah Lewat', '089900010005', 'Female',
         make_date(1985, mo, d_passed), 'Demo data for the birthday feature. Safe to delete.' from d
  union all
  -- No phone: listed, shows "Tanpa nomor" instead of a WhatsApp button, and
  -- is excluded from the red count because nobody can action it.
  select 'ZZ Demo - Tanpa Nomor HP', null, 'Male',
         make_date(1991, mo, least(dy + 2, last_dy)), 'Demo data for the birthday feature. Safe to delete.' from d
  union all
  -- Already greeted (the row is inserted below). Should render dimmed with
  -- "Sudah diucapkan" and an Undo link, and must not be in the red count.
  select 'ZZ Demo - Sudah Diucapkan', '089900010007', 'Female',
         make_date(1993, mo, least(dy + 4, last_dy)), 'Demo data for the birthday feature. Safe to delete.' from d
  union all
  -- Next month. Proves the month filter: this one must NOT show up until the
  -- calendar turns over.
  select 'ZZ Demo - Bulan Depan', '089900010008', 'Male',
         make_date(1994,
                   case when mo = 12 then 1 else mo + 1 end,
                   least(dy, 28)),
         'Demo data for the birthday feature. Safe to delete.' from d
) rows
-- The real re-run guard (see the note at the top). The phone conflict clause
-- below stays as a second line of defence, in case one of these demo numbers
-- ever collides with a real guest record.
where not exists (
  select 1 from guests existing where existing.name = rows.name
)
on conflict (phone) do nothing;

-- Mark one of them as already greeted this year, so you can see the
-- "done" state without having to click it yourself first.
insert into birthday_greetings (guest_id, birthday_year, greeted_by_name, method)
select g.id,
       extract(year from (now() at time zone 'Asia/Jakarta'))::int,
       'Demo data',
       'manual'
from guests g
where g.phone = '089900010007'
on conflict (guest_id, birthday_year) do nothing;

commit;

-- ── What you should see ───────────────────────────────────────────────
select
  name,
  to_char(birthday, 'DD Mon') as birthday,
  coalesce(phone, '(none)')   as phone,
  case
    when extract(month from birthday) <> extract(month from (now() at time zone 'Asia/Jakarta'))
      then 'not this month - should be hidden'
    when bg.guest_id is not null                     then 'greeted - listed, not counted'
    when phone is null                               then 'no phone - listed, not counted'
    when extract(day from birthday)
         < extract(day from (now() at time zone 'Asia/Jakarta'))
      then 'passed - listed, not counted'
    else 'STILL TO GREET - in the red badge'
  end as expected
from guests g
left join birthday_greetings bg
  on bg.guest_id = g.id
 and bg.birthday_year = extract(year from (now() at time zone 'Asia/Jakarta'))::int
where g.name like 'ZZ Demo -%'
order by expected, birthday;
-- Expect 4 rows saying STILL TO GREET, so the bell shows 4.


-- ============================================================
-- CLEANUP — run this when you are done looking
-- ============================================================
-- birthday_greetings has ON DELETE CASCADE on guest_id, so its rows go with
-- the guests. Matches only the demo names, so it cannot touch real guests.
--
--   delete from guests where name like 'ZZ Demo -%';
