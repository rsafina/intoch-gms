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
-- ── The numbers are not invented ──────────────────────────────────────
-- The spend and party-size distributions are taken from a real restaurant's
-- year of trading, so the reports look like a restaurant rather than like
-- random numbers:
--
--   median spend    ~Rp 680.000      p90  ~Rp 2.030.000
--   average pax      4.4             occasional groups of 20 to 40
--   spend per pax   ~Rp 298.000      which sits right on the High Spender line
--
-- That last one matters: the High Spender threshold is Rp 300.000 per pax, so
-- a realistic spread puts guests on BOTH sides of it. Seeding round numbers
-- would either make everyone High or nobody, and the tier badges would look
-- broken in a demo.
--
-- ── Deterministic ─────────────────────────────────────────────────────
-- setseed() fixes the random sequence, so wipe + re-seed gives you the SAME
-- restaurant every time. Rehearse a presentation, reset, and the guest you
-- practised on is still there with the same numbers. Change the seed below
-- if you want a different but equally plausible restaurant.
--
-- ── Names ─────────────────────────────────────────────────────────────
-- Common Indonesian names, and INVENTED company names. Deliberately not real
-- companies: a screenshot with a real firm's name on a fake Rp 8 juta invoice
-- is not something to put in a sales deck.

-- Not idempotent, by nature: running it twice would give you 128 guests and
-- two of every visit. Refuse rather than quietly double the restaurant.
do $$
begin
  if (select count(*) from guests) > 0 then
    raise exception
      E'This database already has % guest(s).\n\nThis seed is not re-runnable — running it again would duplicate everything.\nRun demo/00_wipe_except_staff.sql first, then this file.',
      (select count(*) from guests);
  end if;
end $$;

select setseed(0.4242);

-- Anchor every date to Jakarta, not UTC. Between midnight and 07:00 local the
-- server's current_date is still yesterday, which would shift the whole
-- quarter by a day and put "today" in the wrong place on the dashboard.
create temporary table _anchor as
select (now() at time zone 'Asia/Jakarta')::date as today;

-- ── The guest book ────────────────────────────────────────────────────
-- 64 guests with deliberate shapes, because the SEGMENTS are what a demo has
-- to show. Random guests would give one undifferentiated blob and the
-- retention report would say nothing.
--
--   pattern 'vip'        10+ visits across the quarter, big spend
--   pattern 'loyal'      5 to 9 visits
--   pattern 'return'     2 to 4 visits
--   pattern 'first'      exactly 1 visit, recent  -> "first timers" segment
--   pattern 'atrisk'     visited early, nothing since -> "at risk" segment
--   pattern 'corporate'  few visits, very large parties and bills
create temporary table _people (
  idx int, full_name text, gender text, company text, pattern text, birthday date
);

insert into _people (idx, full_name, gender, company, pattern, birthday)
select
  row_number() over () as idx,
  n.name, n.gender, n.company, n.pattern,
  -- Birthdays spread across the year, with a deliberate cluster in the
  -- CURRENT month so the birthday badge and follow-up list are not empty
  -- during the presentation.
  case when n.idx_in_group = 1
       then make_date(1985 + (n.ord % 15),
                      extract(month from (select today from _anchor))::int,
                      1 + (n.ord * 7) % 27)
       else make_date(1980 + (n.ord % 20), 1 + (n.ord * 5) % 12, 1 + (n.ord * 11) % 27)
  end
from (
  select *,
         row_number() over (partition by pattern order by ord) as idx_in_group
  from (values
    -- VIPs: the regulars a restaurant knows by name
    (1,'Budi Santoso','Male',null,'vip'),
    (2,'Siti Rahayu','Female',null,'vip'),
    (3,'Agus Salim','Male','PT Sinar Abadi Nusantara','vip'),
    (4,'Dewi Lestari','Female',null,'vip'),
    (5,'Hendra Gunawan','Male',null,'vip'),
    -- Loyal
    (6,'Rizky Pratama','Male',null,'loyal'),
    (7,'Ayu Ningsih','Female',null,'loyal'),
    (8,'Andi Wijaya','Male','CV Mitra Karya Jaya','loyal'),
    (9,'Sri Wahyuni','Female',null,'loyal'),
    (10,'Eko Prasetyo','Male',null,'loyal'),
    (11,'Nurul Hidayah','Female',null,'loyal'),
    (12,'Bambang Sutrisno','Male',null,'loyal'),
    (13,'Ratna Sari','Female','PT Bumi Sejahtera Mandiri','loyal'),
    -- Returning
    (14,'Joko Susilo','Male',null,'return'),
    (15,'Indah Permata','Female',null,'return'),
    (16,'Doni Setiawan','Male',null,'return'),
    (17,'Fitri Handayani','Female',null,'return'),
    (18,'Yusuf Maulana','Male',null,'return'),
    (19,'Lina Marlina','Female',null,'return'),
    (20,'Arif Rahman','Male','CV Cahaya Nusantara','return'),
    (21,'Maya Kusuma','Female',null,'return'),
    (22,'Taufik Hidayat','Male',null,'return'),
    (23,'Rina Puspita','Female',null,'return'),
    (24,'Slamet Riyadi','Male',null,'return'),
    (25,'Wulan Sari','Female',null,'return'),
    (26,'Iwan Kurniawan','Male',null,'return'),
    (27,'Diah Ayu Lestari','Female',null,'return'),
    (28,'Rudi Hermawan','Male','PT Graha Utama Persada','return'),
    (29,'Nanda Aprilia','Female',null,'return'),
    -- First timers, recent
    (30,'Fajar Nugroho','Male',null,'first'),
    (31,'Citra Anggraini','Female',null,'first'),
    (32,'Bayu Saputra','Male',null,'first'),
    (33,'Mega Silvia','Female',null,'first'),
    (34,'Reza Fahlevi','Male',null,'first'),
    (35,'Putri Amelia','Female',null,'first'),
    (36,'Dimas Anggara','Male',null,'first'),
    (37,'Sari Melati','Female',null,'first'),
    (38,'Ilham Ramadhan','Male',null,'first'),
    (39,'Tiara Ramadhani','Female',null,'first'),
    (40,'Galih Pratomo','Male',null,'first'),
    (41,'Vina Oktaviani','Female',null,'first'),
    -- At risk: came early in the quarter, never came back
    (42,'Hadi Purnomo','Male',null,'atrisk'),
    (43,'Ella Kartika','Female',null,'atrisk'),
    (44,'Surya Darma','Male',null,'atrisk'),
    (45,'Novi Ariyanti','Female',null,'atrisk'),
    (46,'Gunawan Saputro','Male',null,'atrisk'),
    (47,'Tuti Herawati','Female',null,'atrisk'),
    (48,'Adi Nugraha','Male',null,'atrisk'),
    (49,'Yuni Astuti','Female',null,'atrisk'),
    (50,'Firman Syah','Male',null,'atrisk'),
    (51,'Dina Marlina','Female',null,'atrisk'),
    -- Corporate bookers: few visits, big parties, big bills
    (52,'Ali Mustofa','Male','PT Rocker Kreasi Indonesia','corporate'),
    (53,'Wahyu Setiadi','Male','PT Anugerah Persada Utama','corporate'),
    (54,'Rani Oktaviani','Female','CV Sumber Rejeki Abadi','corporate'),
    (55,'Bagus Prakoso','Male','PT Tirta Kencana Lestari','corporate'),
    (56,'Silvia Hartono','Female','PT Bina Karsa Mandiri','corporate'),
    (57,'Teguh Wibowo','Male','CV Harapan Jaya Sentosa','corporate'),
    (58,'Ratih Kumala','Female','PT Cipta Karya Persada','corporate'),
    (59,'Anton Suryadi','Male','PT Mega Buana Sentosa','corporate'),
    -- A few more regulars to fill the book out
    (60,'Lukman Hakim','Male',null,'return'),
    (61,'Anisa Fitriani','Female',null,'return'),
    (62,'Deni Kurnia','Male',null,'loyal'),
    (63,'Ika Puspitasari','Female',null,'first'),
    (64,'Rahmat Hidayat','Male',null,'return')
  ) as v(ord, name, gender, company, pattern)
) n;

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
-- the Peak Traffic chart look like a restaurant instead of a flat line.
create temporary table _visits as
with p as (
  select g.id as guest_id, pe.pattern, pe.idx,
         (select today from _anchor) as today
  from guests g join _people pe on pe.full_name = g.name
),
n as (
  select guest_id, pattern, idx, today,
         case pattern
           when 'vip'       then 11 + (idx % 4)
           when 'loyal'     then 5 + (idx % 5)
           when 'return'    then 2 + (idx % 3)
           when 'corporate' then 2 + (idx % 2)
           when 'atrisk'    then 1 + (idx % 2)
           else 1
         end as visit_count
  from p
),
spread as (
  select n.*, generate_series(1, n.visit_count) as k from n
)
select
  guest_id, pattern, idx, k,
  (today - (
    case pattern
      -- At-risk guests stop 60 to 88 days ago, which is what puts them in the
      -- at-risk report instead of looking like ordinary regulars.
      when 'atrisk' then 60 + ((idx * 7 + k * 3) % 28)
      -- First timers came recently, so they land in the "new, not returned"
      -- segment rather than looking dormant.
      when 'first'  then 3 + ((idx * 5) % 25)
      else ((idx * 13 + k * 17) % 89)
    end
  ))::date as visit_date,
  pattern as pat
from spread;

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
  case v.pat
    when 'corporate' then 12 + ((v.idx * 3 + v.k) % 17)
    when 'vip'       then 2 + ((v.idx + v.k) % 4)
    else 2 + ((v.idx * 2 + v.k) % 5)
  end as pax,
  -- Spend is built from a per-pax figure so it stays coherent with party
  -- size, then nudged by the weekday. A flat random total would produce
  -- 2-pax bills of Rp 4 juta and 20-pax bills of Rp 300k.
  round((
    -- Per-pax bands, tuned so the High Spender split lands near a quarter of
    -- the book rather than nearly all of it. The threshold is Rp 300.000 per
    -- pax OR Rp 1.000.000 on one visit, so bands that all START above 300k
    -- make every guest High and the tier badge stops meaning anything. First
    -- attempt did exactly that: 56 of 64.
    case v.pat
      when 'corporate' then 130000 + random() * 100000   -- crosses via party size
      when 'vip'       then 140000 + random() * 140000   -- some cross on the total
      when 'loyal'     then 110000 + random() * 100000
      else                   95000 + random() * 105000
    end
    * (case when extract(isodow from v.visit_date) in (6, 7) then 1.18 else 1.0 end)
    * (case v.pat
         when 'corporate' then 12 + ((v.idx * 3 + v.k) % 17)
         when 'vip'       then 2 + ((v.idx + v.k) % 4)
         else 2 + ((v.idx * 2 + v.k) % 5)
       end)
  ) / 1000) * 1000 as spend_amount,
  'Done',
  (v.visit_date + time '21:00') at time zone 'Asia/Jakarta',
  (select id from areas order by name limit 1),
  (select id from tables where is_active order by name limit 1),
  (v.visit_date + time '19:00') at time zone 'Asia/Jakarta',
  (v.visit_date + time '21:00') at time zone 'Asia/Jakarta'
from _visits v;

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
  case v.pat when 'corporate' then 12 + ((v.idx * 3 + v.k) % 17)
             else 2 + ((v.idx * 2 + v.k) % 5) end,
  case (v.idx + v.k) % 7
    when 0 then 'Birthday' when 1 then 'Business Lunch' when 2 then 'Anniversary'
    when 3 then 'Family Gathering' when 4 then 'Business Dinner' else null end,
  -- A realistic channel mix. Leaving this mostly null, which is what happens
  -- in practice, would make the channel report useless in a demo.
  case (v.idx * 3 + v.k) % 5
    when 0 then 'Online Form' when 1 then 'WhatsApp' when 2 then 'Instagram'
    when 3 then 'Telepon' else 'Walk-in' end,
  'Completed', null,
  (select id from areas order by name limit 1),
  (select id from tables where is_active order by name limit 1),
  (v.visit_date - 2 + time '10:00') at time zone 'Asia/Jakarta'
from _visits v
where (v.idx + v.k) % 3 = 0;

-- Upcoming: today plus the next four days.
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
  (select id from areas order by name limit 1),
  (select id from tables where is_active order by name limit 1),
  now() - (r.n || ' hours')::interval
from generate_series(1, 9) as r(n)
join lateral (
  select id from guests order by md5(id::text || r.n::text) limit 1
) g on true;

-- ── Membership ────────────────────────────────────────────────────────
-- Six Family cards and four Company cards, on guests whose visit history
-- justifies the card. A member with no visits looks like test data.
insert into members (member_number, member_type, full_name, phone_number, guest_id, is_active)
select
  'M-' || lpad(row_number() over (order by m.sort)::text, 4, '0'),
  m.member_type, g.name, g.phone, g.id, true
from (
  values
    ('Budi Santoso','Family',1),   ('Siti Rahayu','Family',2),
    ('Dewi Lestari','Family',3),   ('Hendra Gunawan','Family',4),
    ('Rizky Pratama','Family',5),  ('Sri Wahyuni','Family',6),
    ('Ali Mustofa','Company',7),   ('Wahyu Setiadi','Company',8),
    ('Rani Oktaviani','Company',9),('Bagus Prakoso','Company',10)
) as m(guest_name, member_type, sort)
join guests g on g.name = m.guest_name;

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
