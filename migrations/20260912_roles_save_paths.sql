-- Targeted follow-up to Phase 1. Safe to rerun; do not rerun ALL_IN_ONE.
begin;
do $$ begin
  if to_regprocedure('public.app_staff_role()') is null then
    raise exception 'Apply Phase 1 role enforcement first';
  end if;
end $$;

-- FOR SHARE in this trigger requires table UPDATE visibility. Staff may
-- assign tables but cannot edit table settings. Run only the trigger with
-- its trusted owner, retaining its existing assignment/archival checks.
alter function public.normalize_table_assignment() security definer;
alter function public.normalize_table_assignment() set search_path = public, pg_temp;
revoke all on function public.normalize_table_assignment() from public, anon, authenticated;

-- The internal tier helper stays inaccessible as an RPC. Only the trigger
-- runs it after an RLS-authorized reservation/visit write.
alter function public.trigger_recalculate_guest_spending_tier() security definer;
alter function public.trigger_recalculate_guest_spending_tier() set search_path = public, pg_temp;
revoke all on function public.trigger_recalculate_guest_spending_tier() from public, anon, authenticated;

-- Direct reservation inserts must evaluate this read-only column default.
grant execute on function public.default_reservation_duration() to authenticated;
commit;
notify pgrst, 'reload schema';
