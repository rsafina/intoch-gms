-- ============================================================
-- DEMO TOP-UP: the last 5 days, plus fresh upcoming bookings
-- ============================================================
-- The one to keep and re-run. A demo database goes stale: last week's
-- "upcoming reservations" are in the past, the dashboard shows nothing for
-- today, and the notification bell is empty. This refills the recent days and
-- the next few, using the guests that are already there.
--
-- SAFE TO RE-RUN, and safe to run days or weeks apart:
--   * each day is topped UP to a target, so a day already busy gets nothing
--   * upcoming bookings are topped up to a target, not blindly added
--   * it never creates guests, so the guest book stays the one you seeded
--
-- Needs guests to exist. Run demo/01_seed_3_months.sql first if this is a
-- fresh database.
--
-- ── The one thing to watch ────────────────────────────────────────────
-- This adds invented visits to whatever guests it finds. On a demo database
-- that is the point. On a database with REAL guests it would attach fake
-- spending to real people and quietly corrupt their tiers and reports, so
-- there is a guard below. It refuses if it sees more guests than a demo would
-- plausibly have.

do $$
declare
  v_guests int;
begin
  select count(*) into v_guests from guests;

  if v_guests = 0 then
    raise exception
      E'No guests in this database.\n\nRun demo/01_seed_3_months.sql first, then this file.';
  end if;

  -- A seeded demo has ~64 guests. A real restaurant has hundreds. 200 is well
  -- clear of the demo and well under any real book, so it catches the mistake
  -- that matters: pasting this into the wrong database.
  if v_guests > 200 then
    raise exception
      E'This database has % guests, which looks like a REAL restaurant rather than a demo.\n\nThis script attaches invented visits and spending to existing guests. On real data that corrupts their spending tiers, their visit history and every report built on them.\n\nIf you are certain, raise the limit in the guard at the top of this file.',
      v_guests;
  end if;
end $$;

select setseed(0.7788);

create temporary table _anchor as
select (now() at time zone 'Asia/Jakarta')::date as today;

-- ── Visits topped UP to a target for each of the last 5 days ──────────
-- Each day is filled to a target rather than skipped if it has anything at
-- all. That difference matters: run this straight after the three-month seed
-- and a "skip if not empty" rule would do nothing, because the seed already
-- put a couple of visits on those days. Topping up to a target is still
-- idempotent — a day already at target gets zero — and it actually produces a
-- busy recent week, which is the point of the script.
create temporary table _days as
select
  d::date as day,
  -- Weekends busier than weekdays, same shape as the seed.
  (case when extract(isodow from d) in (6, 7) then 9 else 5 end) as target,
  (select count(*) from visits v where v.visit_date = d::date) as have
from generate_series(
       (select today from _anchor) - 4,
       (select today from _anchor),
       interval '1 day'
     ) as d;

-- Guests are picked by a hash of their id and the day, so the same day always
-- draws the same people. Re-running after a wipe reproduces the same week
-- rather than a different one.
create temporary table _new_visits as
select
  d.day,
  g.id as guest_id,
  row_number() over (partition by d.day order by md5(g.id::text || d.day::text)) as slot,
  g.company is not null as is_corporate
from _days d
join lateral (
  select id, company
  from guests
  -- Offset by what the day already has, so a top-up draws DIFFERENT guests
  -- than the ones already seated that day rather than seating someone twice.
  order by md5(guests.id::text || d.day::text)
  offset d.have
  limit greatest(0, d.target - d.have)
) g on true;

insert into visits (
  guest_id, visit_type, visit_date, visit_time, pax, spend_amount,
  status, completed_at, assigned_area, table_id, created_at, updated_at
)
select
  nv.guest_id,
  case when nv.slot % 3 = 0 then 'Reservation' else 'Walk-In' end,
  nv.day,
  case when nv.slot % 3 = 0
       then time '11:30' + ((nv.slot * 19) % 90) * interval '1 minute'
       else time '18:00' + ((nv.slot * 27) % 150) * interval '1 minute'
  end,
  case when nv.is_corporate then 12 + (nv.slot * 3) % 17 else 2 + (nv.slot * 2) % 5 end,
  -- Same per-pax bands as the three-month seed, so a topped-up week does not
  -- suddenly look richer or poorer than the quarter behind it and skew the
  -- period-over-period deltas on the dashboard.
  round((
    (case when nv.is_corporate then 130000 + random() * 100000
          else 95000 + random() * 115000 end)
    * (case when extract(isodow from nv.day) in (6, 7) then 1.18 else 1.0 end)
    * (case when nv.is_corporate then 12 + (nv.slot * 3) % 17 else 2 + (nv.slot * 2) % 5 end)
  ) / 1000) * 1000,
  -- Some of today's tables are left ACTIVE rather than Done, so the front-desk
  -- dashboard has live covers on it during a demo instead of a finished day.
  --
  -- 'Active', not 'Open'. visits_status_check allows exactly ('Active','Done')
  -- and nothing else — the first draft used 'Open' and every insert for today
  -- was rejected, silently leaving the day empty.
  case when nv.day = (select today from _anchor) and nv.slot % 2 = 1
       then 'Active' else 'Done' end,
  case when nv.day = (select today from _anchor) and nv.slot % 2 = 1
       then null else (nv.day + time '21:00') at time zone 'Asia/Jakarta' end,
  (select id from areas order by name limit 1),
  (select id from tables where is_active order by name limit 1),
  (nv.day + time '19:00') at time zone 'Asia/Jakarta',
  (nv.day + time '21:00') at time zone 'Asia/Jakarta'
from _new_visits nv;

-- ── Upcoming bookings, topped up to a target ──────────────────────────
-- Counted first, then only the shortfall is added. Adding a fixed number
-- every run would pile up a hundred bookings by the third week.
do $$
declare
  v_today        date := (select (now() at time zone 'Asia/Jakarta')::date);
  v_have         int;
  v_target       int := 12;
  v_need         int;
  v_guest        uuid;
  v_area         uuid := (select id from areas order by name limit 1);
  v_table        uuid := (select id from tables where is_active order by name limit 1);
  i              int;
begin
  select count(*) into v_have
  from reservations
  where reservation_date >= v_today
    and status in ('Reserved', 'Confirmed')
    and deleted_at is null;

  v_need := greatest(0, v_target - v_have);

  for i in 1..v_need loop
    select id into v_guest
    from guests
    order by md5(guests.id::text || v_today::text || i::text)
    limit 1;

    insert into reservations (
      guest_id, reservation_date, reservation_time, pax, occasion,
      reservation_source, status, notes, assigned_area, table_id,
      follow_up_done, created_at
    ) values (
      v_guest,
      v_today + (i % 5),
      time '18:30' + ((i * 25) % 150) * interval '1 minute',
      2 + (i % 6),
      case i % 4 when 0 then 'Birthday' when 1 then 'Anniversary'
                 when 2 then 'Business Dinner' else null end,
      case i % 4 when 0 then 'Online Form' when 1 then 'WhatsApp'
                 when 2 then 'Instagram' else 'Telepon' end,
      'Reserved',
      case when i % 4 = 0 then 'Minta meja dekat jendela.' else null end,
      v_area, v_table,
      -- Every third online booking is left un-followed-up, so the
      -- notification bell has a red number and something to demonstrate.
      -- All of them marked done would make the bell look broken.
      (i % 3 <> 0),
      now() - (i || ' hours')::interval
    );
  end loop;

  raise notice 'upcoming bookings: had %, added %, now %', v_have, v_need, v_have + v_need;
end $$;

-- ── Membership transactions for the new visits ────────────────────────
-- Through the app's own function, so stickers and vouchers follow the same
-- rules the app applies. Only visits with no transaction yet are added, which
-- is what keeps this re-runnable.
do $$
declare
  r record;
begin
  for r in
    select m.id as member_id, v.spend_amount, v.visit_date
    from members m
    join visits v on v.guest_id = m.guest_id
    where v.spend_amount > 0
      and v.visit_date >= (select (now() at time zone 'Asia/Jakarta')::date) - 4
      and not exists (
        select 1 from member_transactions t
        where t.member_id = m.id
          and t.transaction_date::date = v.visit_date
      )
  loop
    perform add_member_transaction(
      r.member_id, r.spend_amount,
      (r.visit_date + time '20:00') at time zone 'Asia/Jakarta',
      null, null, 'Demo'
    );
  end loop;
end $$;

-- ---------- Confirm ----------
with a as (select (now() at time zone 'Asia/Jakarta')::date as today)
select 'visits today'            as what, count(*)::text as value
  from visits, a where visit_date = a.today
union all select 'visits last 5 days', count(*)::text
  from visits, a where visit_date between a.today - 4 and a.today
union all select 'live tables right now', count(*)::text
  from visits, a where visit_date = a.today and status = 'Active'
union all select 'upcoming bookings', count(*)::text
  from reservations, a where reservation_date >= a.today
   and status in ('Reserved','Confirmed') and deleted_at is null
union all select '  needing follow-up', count(*)::text
  from reservations, a where reservation_date >= a.today
   and reservation_source = 'Online Form' and coalesce(follow_up_done,false) = false
union all select 'revenue last 5 days', to_char(coalesce(sum(spend_amount),0), 'FM999G999G999G999')
  from visits, a where visit_date between a.today - 4 and a.today
order by 1;
