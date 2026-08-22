-- ============================================================
-- STANDALONE VOUCHERS
-- 2026-08-01. Additive only: 1 new table, 1 settings key,
-- 2 functions, 1 reporting view. Nothing existing is touched.
-- NOT YET APPLIED — review first, then run on staging.
-- ============================================================
--
-- WHY A SEPARATE TABLE
-- --------------------
-- member_vouchers is earned: a member collects stickers, the
-- system issues a voucher, and members.available_vouchers is
-- decremented on redeem. Every membership statistic counts those
-- rows.
--
-- These vouchers are given, not earned: a thank-you to a top
-- spender, a birthday gift to a friend of the house, or a block
-- of vouchers converted from a partner's leftover budget
-- (tiket.com, July 2026). They belong to no member and must never
-- touch available_vouchers or the membership reports. Squeezing
-- them into member_vouchers with a null member_id would silently
-- corrupt every membership number in the app.
--
-- WHY IT IS TRACKED AT ALL
-- ------------------------
-- A voucher is money leaving the business, and unlike an invoice
-- it comes back. An image alone cannot answer:
--   • has this one already been used? (a forwarded screenshot
--     redeems just as well as the original)
--   • has it expired?
--   • how much of the partner's budget have we actually issued,
--     and how much has been burned?
-- Those three questions are the whole reason this table exists.
-- ============================================================

begin;

-- ── 1. Validity setting ──────────────────────────────────────
-- Its own key rather than reusing membership.voucher_validity_days:
-- a gift voucher and an earned voucher have no reason to expire on
-- the same schedule, and ops must be able to change one without
-- moving the other.
insert into app_settings (key, value)
values ('vouchers', jsonb_build_object('standalone_validity_days', 60))
on conflict (key) do update
set value = app_settings.value
          || jsonb_build_object(
               'standalone_validity_days',
               coalesce(app_settings.value->'standalone_validity_days', to_jsonb(60))
             );

create or replace function public.standalone_voucher_validity_days()
returns integer
language sql stable as $$
  select greatest(
    coalesce((get_setting('vouchers')->>'standalone_validity_days')::integer, 60),
    1
  );
$$;

-- ── 2. The table ─────────────────────────────────────────────
create table if not exists public.standalone_vouchers (
  id            bigint generated always as identity primary key,

  -- BHV-00001. The BHV prefix keeps these distinguishable at a
  -- glance from membership codes (BH-F21-0007), so staff reading a
  -- code a guest sent back know which screen to look on.
  voucher_code  text not null,

  -- Groups one issuing action. A single voucher gets its own
  -- batch_id too, so "show me everything from that tiket.com run"
  -- and "show me that one birthday voucher" are the same query.
  batch_id      uuid not null default gen_random_uuid(),
  batch_label   text,

  -- What it was for. Free-ish but constrained, because the whole
  -- point of the report is grouping by it.
  occasion      text not null default 'other'
                check (occasion in ('top_spender','top_visits','birthday',
                                    'partnership','apology','other')),
  -- 'tiket.com'. Only meaningful for partnership vouchers, but not
  -- constrained to them: a birthday voucher for a partner contact
  -- is a real case.
  partner_name  text,

  -- ── Recipient ──
  -- guest_id is the useful one: it lets the owner ask later whether
  -- the top spenders we sent vouchers to actually came back.
  -- recipient_name is still stored even when guest_id is set — it is
  -- a snapshot of the name printed on the card, and a guest record
  -- can be renamed or merged after the fact.
  guest_id        uuid references guests(id) on delete set null,
  recipient_name  text,
  recipient_phone text,

  -- ── Value ──
  -- Three shapes, one row. value_idr is filled for every type
  -- (for percent and item it is the expected cost) so budget
  -- reporting never has to special-case them.
  value_type    text not null check (value_type in ('amount','percent','item')),
  value_idr     numeric(12,0),
  value_percent numeric(5,2),
  value_item    text,
  -- Optional guard rails printed on the card
  percent_cap_idr numeric(12,0),
  min_spend_idr   numeric(12,0),
  note            text,

  -- The line printed under the date on the card. Defaults to the
  -- occasion label ("Top spender thank you") but is free text,
  -- because what reads well to a guest is not the same as what
  -- groups well in a report. "Terima kasih sudah jadi tamu setia
  -- kami" belongs on the card; `occasion` stays clean for grouping.
  card_label      text,

  -- ── Lifecycle ──
  issued_at   timestamptz not null default now(),
  issued_by   uuid references staff_users(id),
  expires_at  timestamptz,

  redeemed      boolean not null default false,
  redeemed_at   timestamptz,
  redeemed_by   uuid references staff_users(id),
  redeem_note   text,

  -- A mis-issued voucher is voided, never deleted: if a guest turns
  -- up holding the card, staff must be able to see what happened to
  -- it and who cancelled it.
  voided       boolean not null default false,
  voided_at    timestamptz,
  voided_by    uuid references staff_users(id),
  void_reason  text,

  -- A voucher must be attributable to somebody: a guest record, a
  -- named person, or a partner. The third case is deliberate — a
  -- block of tiket.com vouchers is a bearer instrument, handed out
  -- by the partner to people we will never know in advance. What
  -- must never exist is a voucher attributable to no one at all,
  -- because then nobody can say where the value went.
  constraint standalone_voucher_has_recipient
    check (guest_id is not null
           or nullif(btrim(coalesce(recipient_name, '')), '') is not null
           or nullif(btrim(coalesce(partner_name, '')), '') is not null),

  -- Each value type carries exactly the fields it needs. Without
  -- this a "20%" voucher could be saved with no percentage and
  -- print as a blank promise.
  constraint standalone_voucher_value_shape check (
    (value_type = 'amount'  and value_idr is not null and value_idr > 0)
    or (value_type = 'percent' and value_percent is not null
        and value_percent > 0 and value_percent <= 100)
    or (value_type = 'item' and nullif(btrim(coalesce(value_item, '')), '') is not null)
  ),

  -- Redeemed and voided are mutually exclusive states.
  constraint standalone_voucher_not_both
    check (not (redeemed and voided))
);

create unique index if not exists standalone_vouchers_code_key
  on public.standalone_vouchers (voucher_code);
create index if not exists idx_standalone_vouchers_batch
  on public.standalone_vouchers (batch_id);
create index if not exists idx_standalone_vouchers_guest
  on public.standalone_vouchers (guest_id);
create index if not exists idx_standalone_vouchers_issued
  on public.standalone_vouchers (issued_at desc);
create index if not exists idx_standalone_vouchers_open
  on public.standalone_vouchers (expires_at)
  where redeemed = false and voided = false;

-- ── 3. Code + expiry on insert ───────────────────────────────
-- id is an IDENTITY column, so NEW.id is populated in a BEFORE
-- INSERT trigger. Both fields are only filled when null, so an
-- explicit value (a data repair, an import) is respected.
create or replace function public.set_standalone_voucher_defaults()
returns trigger
language plpgsql as $$
declare
  v_days integer;
begin
  if new.voucher_code is null then
    new.voucher_code := 'BHV-' || lpad(new.id::text, 5, '0');
  end if;

  if new.expires_at is null then
    v_days := standalone_voucher_validity_days();
    -- End of the last valid day in Jakarta time. Without this a
    -- voucher stamped "valid until 30 September" would start being
    -- refused at 07:00 that morning, in front of the guest.
    new.expires_at := ((
      ((new.issued_at at time zone 'Asia/Jakarta')::date + v_days)::timestamp
      + time '23:59:59'
    ) at time zone 'Asia/Jakarta');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_standalone_voucher_defaults on public.standalone_vouchers;
create trigger trg_standalone_voucher_defaults
  before insert on public.standalone_vouchers
  for each row execute function public.set_standalone_voucher_defaults();

-- ── 4. Redeem ────────────────────────────────────────────────
-- Looked up by CODE, not id: that is what the guest hands over.
-- Case and surrounding spaces are forgiven because the code will
-- arrive typed off a phone screen.
--
-- Every refusal is a distinct exception so the UI can explain what
-- actually happened. "Invalid voucher" at a busy till, with a guest
-- watching, is not good enough.
create or replace function public.redeem_standalone_voucher(
  p_code          text,
  p_redeemed_by   uuid    default null,
  p_note          text    default null,
  p_allow_expired boolean default false
)
returns jsonb
language plpgsql as $$
declare
  v_row public.standalone_vouchers;
begin
  select * into v_row
  from public.standalone_vouchers
  where voucher_code = upper(btrim(p_code))
  for update;

  if v_row.id is null then
    raise exception 'VOUCHER_NOT_FOUND';
  end if;
  if v_row.voided then
    raise exception 'VOUCHER_VOIDED';
  end if;
  if v_row.redeemed then
    raise exception 'VOUCHER_ALREADY_REDEEMED';
  end if;
  if not p_allow_expired and v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception 'VOUCHER_EXPIRED';
  end if;

  -- The row lock above plus `and redeemed = false` here are what
  -- stop a double-click, or two tills at once, redeeming twice.
  update public.standalone_vouchers
  set redeemed    = true,
      redeemed_at = now(),
      redeemed_by = p_redeemed_by,
      redeem_note = p_note
  where id = v_row.id and redeemed = false
  returning * into v_row;

  if v_row.id is null then
    raise exception 'VOUCHER_ALREADY_REDEEMED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'voucher_code', v_row.voucher_code,
    'recipient_name', v_row.recipient_name,
    'guest_id', v_row.guest_id,
    'value_type', v_row.value_type,
    'value_idr', v_row.value_idr,
    'value_percent', v_row.value_percent,
    'value_item', v_row.value_item,
    'was_expired', v_row.expires_at is not null and v_row.expires_at < now()
  );
end;
$$;

-- ── 5. Void ──────────────────────────────────────────────────
-- Cancelling a voucher issued by mistake. Refuses to void one that
-- has already been redeemed: that value is gone, and pretending
-- otherwise would make the budget report lie.
create or replace function public.void_standalone_voucher(
  p_code      text,
  p_voided_by uuid default null,
  p_reason    text default null
)
returns jsonb
language plpgsql as $$
declare
  v_row public.standalone_vouchers;
begin
  select * into v_row
  from public.standalone_vouchers
  where voucher_code = upper(btrim(p_code))
  for update;

  if v_row.id is null then
    raise exception 'VOUCHER_NOT_FOUND';
  end if;
  if v_row.redeemed then
    raise exception 'VOUCHER_ALREADY_REDEEMED';
  end if;
  if v_row.voided then
    return jsonb_build_object('ok', true, 'already_voided', true, 'id', v_row.id);
  end if;

  update public.standalone_vouchers
  set voided = true, voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
  where id = v_row.id;

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

-- ── 6. Budget report ─────────────────────────────────────────
-- One row per batch: what was handed out, what came back, what is
-- still outstanding. issued_idr is the exposure; redeemed_idr is
-- the actual cost so far.
create or replace view public.standalone_voucher_batches as
select
  batch_id,
  min(batch_label)                                          as batch_label,
  min(occasion)                                             as occasion,
  min(partner_name)                                         as partner_name,
  min(issued_at)                                            as issued_at,
  count(*)                                                  as issued_count,
  count(*) filter (where redeemed)                          as redeemed_count,
  count(*) filter (where voided)                            as voided_count,
  count(*) filter (where not redeemed and not voided
                     and expires_at < now())                as expired_count,
  count(*) filter (where not redeemed and not voided
                     and (expires_at is null or expires_at >= now()))
                                                            as open_count,
  coalesce(sum(value_idr), 0)                               as issued_idr,
  coalesce(sum(value_idr) filter (where redeemed), 0)       as redeemed_idr,
  coalesce(sum(value_idr) filter (where not redeemed and not voided
                     and (expires_at is null or expires_at >= now())), 0)
                                                            as open_idr
from public.standalone_vouchers
group by batch_id;

commit;

-- ── Verify ───────────────────────────────────────────────────
-- select voucher_code, occasion, recipient_name, value_type,
--        value_idr, value_percent, value_item, expires_at, redeemed
-- from standalone_vouchers order by id desc limit 20;
--
-- select * from standalone_voucher_batches order by issued_at desc;
--
-- Rollback (only safe while nothing has been issued):
--   drop view if exists standalone_voucher_batches;
--   drop function if exists redeem_standalone_voucher(text, uuid, text, boolean);
--   drop function if exists void_standalone_voucher(text, uuid, text);
--   drop trigger if exists trg_standalone_voucher_defaults on standalone_vouchers;
--   drop function if exists set_standalone_voucher_defaults();
--   drop table if exists standalone_vouchers;
--   drop function if exists standalone_voucher_validity_days();
