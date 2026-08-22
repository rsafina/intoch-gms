# Migrations

**Filename order IS run order.** Apply top to bottom.

```
00_schema_from_blueheron.sql          base tables
20260602_customer_spending_tiers.sql
20260602_saved_segments.sql
20260705_01_membership_tables.sql     members, transactions, vouchers
20260705_02_fix_spending_tier_no_spend.sql
20260714_delete_void_feature.sql
20260717_favorite_menu.sql
20260718_broadcast_tables.sql         wa_templates, wa_outreach_log
20260719_public_reservation.sql       app_settings, create_public_reservation
20260721_01_settings_feature.sql      featured_dishes + storage bucket
20260721_02_seed_featured_dishes.sql  (needs the table above to exist first)
20260722_landing_page_config.sql
20260726_dashboard_reports.sql        booking_name, booking_alias, views
20260726_first_timer_template.sql
20260731_01_voucher_code_expiry.sql
20260731_02_wa_template.sql
20260801_01_broadcast_campaigns.sql
20260801_02_standalone_vouchers.sql
20260801_03_voucher_card_label.sql
20260809_backfill_visit_stickers.sql
20260815_reservation_follow_up.sql    follow_up_done
20260821_reservation_reminder_ack.sql D-1 / D-day reminder acks
20260822_admin_role_and_first_user.sql
```

`ALL_IN_ONE.sql` is every file above, concatenated in this order, for pasting into a
fresh project in a single go.

## Why the numbering looks odd

These were reconstructed on 2026-08-22, the first time anyone tried to build this
database from nothing. Three problems surfaced, all of which would have hit during a
client's onboarding:

1. **Seven migrations were not in the repo at all.** The membership tables and the
   broadcast tables lived in a folder outside it. An app pointed at a database built
   from the repo alone got 404s on `members`, `wa_templates` and `wa_outreach_log`.
2. **Filename order was not dependency order.** `20260721_seed_featured_dishes` sorts
   before `20260721_settings_feature`, but the seed inserts into a table the settings
   file creates. Renumbered with `_01` / `_02` suffixes so sorting is safe.
3. **The `admin` role was never in any migration**, though the code requires it. It had
   been added by hand in production. Fixed in the 20260822 file.

Assume more gaps like these exist. Re-run the whole set against an empty project and
open the app before onboarding any client, rather than trusting that it works.

## Applying safely to a database with real data

Wrap the whole thing in one `DO $$` block with `GET DIAGNOSTICS ROW_COUNT` assertions
per statement, run it once ending in `RAISE EXCEPTION 'DRY RUN OK'` to rehearse and roll
back, then re-run without the RAISE.
