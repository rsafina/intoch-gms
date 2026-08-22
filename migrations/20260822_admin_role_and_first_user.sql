-- ============================================================
-- ADMIN ROLE + FIRST STAFF USER
-- Date: 2026-08-22
--
-- WHY THIS EXISTS
-- The base schema allows only two roles:
--
--   role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager'))
--
-- but the application code checks for a third, 'admin' (owner dashboard,
-- ADMIN_ONLY_PAGES, the staff-dashboard view). No migration ever added it.
-- The original database had it widened by hand, outside the migration files,
-- so the migrations do NOT reproduce a working database from zero.
--
-- Inserting a user with role 'admin' on a fresh project fails the CHECK
-- constraint. That is the first real proof that this migration set needed
-- patching before it could stand up a new client. Keep this file in the set.
--
-- Also: a brand new database has no staff at all, and the app has no
-- sign-up screen by design. Somebody has to be created in SQL before anyone
-- can log in. That is what the second half does.
-- ============================================================

-- 1. Allow the third role the code already expects ------------
alter table public.staff_users
  drop constraint if exists staff_users_role_check;

alter table public.staff_users
  add constraint staff_users_role_check
  check (role in ('staff', 'manager', 'admin'));

-- 2. Create the first user ------------------------------------
-- PIN must be EXACTLY four digits: the column enforces ^[0-9]{4}$.
-- Login matches the username EXACTLY and is case sensitive, so keep it
-- lowercase and type it the same way on the login screen.
--
-- CHANGE THE PIN before using this anywhere real.
insert into public.staff_users (username, display_name, pin, role, is_active)
values ('rere', 'Rere', '1234', 'admin', true)
on conflict (username) do update
  set display_name = excluded.display_name,
      pin          = excluded.pin,
      role         = excluded.role,
      is_active    = true;

-- 3. Confirm ---------------------------------------------------
select username, display_name, role, is_active
from public.staff_users
order by username;
