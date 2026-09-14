-- ONE reviewed incident only. Run manually in the affected project's SQL Editor.
-- Keeps the earlier visit. No deletes, payment changes or membership transfers.
-- Stop if any guard fails; do not weaken the checks to force the repair.
begin;
do $$
declare
 booking_id uuid := '7ca3463f-e671-4b47-8c83-1501e6cc43cb';
 keep_id uuid := '84175482-09f7-45a6-8b1d-93d9477bd7c7';
 duplicate_id uuid := '3aa4632b-6508-48c8-8a50-84f835ec80f8';
 kept public.visits%rowtype; duplicate public.visits%rowtype;
begin
 perform 1 from public.reservations where id=booking_id and deleted_at is null for update;
 if not found then raise exception 'Target reservation not found'; end if;
 perform 1 from public.visits where reservation_id=booking_id order by id for update;
 select * into kept from public.visits where id=keep_id and reservation_id=booking_id;
 select * into duplicate from public.visits where id=duplicate_id and reservation_id=booking_id;
 if kept.id is null or duplicate.id is null then raise exception 'Expected visit pair not found'; end if;
 if kept.voided_at is not null then raise exception 'The retained visit was voided; review required'; end if;
 if duplicate.voided_at is not null then raise notice 'Duplicate already voided; no changes'; return; end if;
 if (select count(*) from public.visits where reservation_id=booking_id and voided_at is null)<>2 then
  raise exception 'Visit count changed; review required';
 end if;
 if kept.status<>'Active' or duplicate.status<>'Active'
  or kept.spend_amount is not null or duplicate.spend_amount is not null
  or kept.spend_input_amount is not null or duplicate.spend_input_amount is not null
  or kept.spend_deposit_snapshot is not null or duplicate.spend_deposit_snapshot is not null
  or to_jsonb(kept)->>'spend_recording_status' is not null
  or to_jsonb(duplicate)->>'spend_recording_status' is not null
  or coalesce(kept.billing_base_amount,0)<>0 or coalesce(duplicate.billing_base_amount,0)<>0
  or coalesce(kept.extra_spend_amount,0)<>0 or coalesce(duplicate.extra_spend_amount,0)<>0
  or kept.completed_at is not null or duplicate.completed_at is not null
  or nullif(trim(kept.notes),'') is not null or nullif(trim(duplicate.notes),'') is not null
  or kept.created_at is null or duplicate.created_at is null or kept.created_at>=duplicate.created_at
  or row(kept.guest_id,kept.visit_type,kept.visit_date,kept.pax,kept.assigned_area,kept.table_id,kept.table_ids)
    is distinct from row(duplicate.guest_id,duplicate.visit_type,duplicate.visit_date,duplicate.pax,duplicate.assigned_area,duplicate.table_id,duplicate.table_ids)
  or exists(select 1 from public.member_transactions where visit_id in (keep_id,duplicate_id)) then
  raise exception 'Visit details or financial/membership history changed; manual review required';
 end if;
 update public.visits set voided_at=now(),updated_at=now(),
  void_reason='Duplicate reservation arrival; retained visit '||keep_id::text
 where id=duplicate_id;
end $$;
select id,reservation_id,status,spend_amount,voided_at,void_reason
from public.visits where reservation_id='7ca3463f-e671-4b47-8c83-1501e6cc43cb'
order by created_at;
commit;
