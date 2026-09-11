-- Run BEFORE scripts/migrate-staff-auth.mjs. No live permissions changed yet.
begin;
alter table public.staff_users add column if not exists auth_user_id uuid unique references auth.users(id);
alter table public.staff_users alter column pin drop not null;
alter table public.staff_users drop constraint if exists staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check check (role in ('owner','admin','manager','staff'));
commit;
