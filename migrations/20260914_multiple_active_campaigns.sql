-- Up to ten sending campaigns; drafts do not consume slots.
begin;
lock table public.wa_campaigns in share row exclusive mode;
drop index if exists public.idx_one_open_campaign;
alter table public.wa_campaigns add column if not exists active_slot smallint;

-- Preserve slot assignments on reruns. Refuse over-cap legacy data without
-- silently closing campaigns or losing their audience/history.
do $$
declare campaign record; slot_number integer;
begin
  if (select count(*) from public.wa_campaigns where status = 'active') > 10 then
    raise exception 'Maksimal 10 campaign aktif. Selesaikan campaign tambahan dahulu.';
  end if;
  update public.wa_campaigns set active_slot = null where status is distinct from 'active';
  for campaign in select id from public.wa_campaigns where status = 'active' and active_slot is null loop
    select n into slot_number from generate_series(1,10) n
      where not exists (select 1 from public.wa_campaigns c where c.active_slot = n)
      order by n limit 1;
    update public.wa_campaigns set active_slot = slot_number, ended_at = null where id = campaign.id;
  end loop;
end $$;

create unique index if not exists idx_campaign_active_slot on public.wa_campaigns(active_slot);
alter table public.wa_campaigns drop constraint if exists campaign_active_slot_check;
alter table public.wa_campaigns add constraint campaign_active_slot_check check (
  (status = 'active' and active_slot is not null and active_slot between 1 and 10)
  or (status is distinct from 'active' and active_slot is null)
);

create or replace function public.assign_campaign_active_slot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' then
    perform pg_advisory_xact_lock(20260914, 10);
    if TG_OP = 'UPDATE' then
      if old.status = 'active' then
        new.active_slot := old.active_slot;
        new.ended_at := null;
        return new;
      end if;
    end if;
    select n into new.active_slot from generate_series(1,10) n
      where not exists (select 1 from public.wa_campaigns c where c.active_slot = n)
      order by n limit 1;
    if new.active_slot is null then
      raise exception 'Maksimal 10 campaign aktif. Selesaikan salah satu sebelum memulai campaign lain.';
    end if;
    new.ended_at := null;
  else
    new.active_slot := null;
    if new.status = 'done' then
      new.ended_at := coalesce(new.ended_at, now());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists campaign_active_slot on public.wa_campaigns;
create trigger campaign_active_slot before insert or update on public.wa_campaigns
  for each row execute function public.assign_campaign_active_slot();
commit;
