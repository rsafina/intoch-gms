-- Phase 1 follow-up: invoice amount calculation is a pure JSON-to-number
-- conversion used by the invoice save trigger, not a privileged write RPC.
begin;
do $$ begin
  if to_regprocedure('public.app_staff_role()') is null then
    raise exception 'Apply Phase 1 role enforcement first';
  end if;
end $$;
grant execute on function public.invoice_document_rupiah(jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
