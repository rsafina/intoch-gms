-- DEMO RESET: delete guest data; preserve staff, floor plan and configuration.
-- Run on a demo database in the Supabase SQL Editor, before 01_seed_3_months.sql.
-- Includes guest history, membership, vouchers, outreach, invoices and payments,
-- including unlinked invoices/vouchers that can contain copied guest details.
-- Keeps staff_users, areas, tables, app_settings, wa_templates, prizes,
-- featured_dishes, saved_segments (report filters), and reservation_exceptions.
-- Requires the current migrations/ALL_IN_ONE.sql schema.
-- No CASCADE: an unknown referencing table makes this fail without deleting data.

begin;
set local search_path = public, pg_temp;

-- Uncomment this line to allow the reset. Confirmation expires at transaction end.
-- set local demo.confirm = 'WIPE-EVERYTHING-EXCEPT-STAFF';

do $$
begin
  if coalesce(current_setting('demo.confirm', true), '') <> 'WIPE-EVERYTHING-EXCEPT-STAFF' then
    raise exception 'Reset not enabled. Uncomment SET LOCAL demo.confirm in demo/00_wipe_except_staff.sql and run the whole file.';
  end if;
end $$;

truncate table
  public.invoice_payments,
  public.invoices,
  public.birthday_greetings,
  public.member_vouchers,
  public.member_transactions,
  public.members,
  public.standalone_vouchers,
  public.spin_submissions,
  public.wa_campaign_audience,
  public.wa_outreach_log,
  public.wa_campaigns,
  public.visits,
  public.reservations,
  public.guests
restart identity;

select 'guests' as table_name, count(*) as rows_now from guests
union all select 'visits', count(*) from visits
union all select 'reservations', count(*) from reservations
union all select 'members', count(*) from members
union all select 'invoices', count(*) from invoices
union all select 'invoice_payments', count(*) from invoice_payments
union all select 'STAFF KEPT', count(*) from staff_users
union all select 'AREAS KEPT', count(*) from areas
union all select 'TABLES KEPT', count(*) from tables
union all select 'SETTINGS KEPT', count(*) from app_settings
union all select 'WA TEMPLATES KEPT', count(*) from wa_templates
union all select 'PRIZES KEPT', count(*) from prizes
union all select 'FEATURED DISHES KEPT', count(*) from featured_dishes
union all select 'SAVED SEGMENTS KEPT', count(*) from saved_segments
union all select 'RESERVATION EXCEPTIONS KEPT', count(*) from reservation_exceptions
order by 1;

commit;
