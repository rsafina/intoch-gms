-- Phase 1 follow-up for voucher inserts that rely on database defaults.
-- Keep internal helpers inaccessible as RPCs and keep table RLS unchanged.
begin;
do $$ begin
 if to_regprocedure('public.app_staff_role()') is null then
  raise exception 'Apply Phase 1 role enforcement first';
 end if;
end $$;
alter function public.set_standalone_voucher_defaults() security definer;
alter function public.set_standalone_voucher_defaults() set search_path = public, pg_temp;
revoke all on function public.set_standalone_voucher_defaults() from public,anon,authenticated;
alter function public.set_member_voucher_defaults() security definer;
alter function public.set_member_voucher_defaults() set search_path = public, pg_temp;
revoke all on function public.set_member_voucher_defaults() from public,anon,authenticated;
commit;
notify pgrst, 'reload schema';
