-- Keep the invoice request and the reservation's deposit requirement aligned.
-- Apply ALL_IN_ONE.sql if earlier migrations have not been installed.
begin;
create or replace function public.invoice_document_rupiah(value jsonb)
returns numeric language sql immutable set search_path = public as $function$
 select nullif(regexp_replace(coalesce(value #>> '{}', ''), '[^0-9]', '', 'g'), '')::numeric;
$function$;

create or replace function public.derive_invoice_requested_amount()
returns trigger language plpgsql set search_path = public as $function$
begin
 if new.doc is not null then
   if coalesce((new.doc->>'dpOn')::boolean, false) then
     if coalesce((new.doc->>'settleOn')::boolean, false) then
       new.amount_due := public.invoice_document_rupiah(new.doc->'settle');
       new.deposit_applied := public.invoice_document_rupiah(new.doc->'dp');
     else
       new.amount_due := public.invoice_document_rupiah(new.doc->'dp');
       new.deposit_applied := null;
     end if;
   else
     new.amount_due := new.total;
     new.deposit_applied := null;
   end if;
   if new.status = 'issued' and new.kind = 'deposit' and coalesce(new.amount_due,0) <= 0 then
     raise exception 'Enter a positive deposit amount before saving the invoice.';
   end if;
 end if;
 return new;
end;
$function$;
drop trigger if exists invoices_derive_requested_amount on public.invoices;
create trigger invoices_derive_requested_amount before insert or update of doc,total,status on public.invoices
for each row execute function public.derive_invoice_requested_amount();

create or replace function public.sync_invoice_deposit_requirement()
returns trigger language plpgsql security definer set search_path = public as $function$
declare booking record; paid numeric;
begin
 if new.kind <> 'deposit' or new.status <> 'issued' or new.doc is null or new.reservation_id is null then return new; end if;
 -- An older saved invoice is historical, not the active payment request.
 if exists(select 1 from public.invoices i where i.reservation_id=new.reservation_id
   and i.kind='deposit' and i.status='issued' and i.created_at > new.created_at) then return new; end if;
 select * into booking from public.reservations where id=new.reservation_id and deleted_at is null for update;
 -- A small capacity request must first be accepted by staff.
 if not found or not coalesce(booking.deposit_required,false) then return new; end if;
 update public.reservations set deposit_expected=new.amount_due, updated_at=now() where id=booking.id;
 select coalesce(sum(amount),0) into paid from public.invoice_payments where reservation_id=booking.id;
 -- Saving an invoice records no money. Only existing ledger payments can confirm it.
 if booking.status in ('Incoming','Waitlist') and paid >= new.amount_due and new.amount_due > 0 then
   update public.reservations set status='Reserved',updated_at=now() where id=booking.id;
 end if;
 return new;
end;
$function$;
revoke all on function public.sync_invoice_deposit_requirement() from public;
drop trigger if exists invoices_sync_deposit_requirement on public.invoices;
create trigger invoices_sync_deposit_requirement after insert or update of doc,total,amount_due,status on public.invoices
for each row execute function public.sync_invoice_deposit_requirement();

-- Reconcile existing documents and recorded payments without adding a payment.
-- Invalid legacy documents or capacity conflicts are reported for staff review.
do $repair$
declare invoice record;
begin
 for invoice in select id from public.invoices where doc is not null and status='issued' order by created_at loop
   begin
     update public.invoices set doc=doc where id=invoice.id;
   exception when raise_exception or check_violation or exclusion_violation then
     raise warning 'Invoice % needs review: %',invoice.id,SQLERRM;
   end;
 end loop;
end;
$repair$;
notify pgrst, 'reload schema';
commit;
