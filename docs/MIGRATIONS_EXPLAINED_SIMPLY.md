# Intoch database migrations, explained simply

## First: do not delete or run anything yet

The `migrations/` folder is a history of database changes. It is **not** a list where every
file should be run from top to bottom.

Some older files are already included in `ALL_IN_ONE.sql`. Some newer files upgrade the
security added later. Running the wrong older file on a newer database can replace protected
functions with older versions.

For now:

- Do not delete migration files.
- Do not run all files in filename order.
- Never rerun `ALL_IN_ONE.sql` on an existing secured database.
- Never rerun `20260911_roles_enforce.sql` on an existing secured database.
- Do not use a production/client database to experiment.

Deleting the files would not remove changes already installed in Supabase. It would only
remove our record of how databases were created and upgraded, and could break tests or make
older clients harder to diagnose.

## What is a migration?

A migration is an instruction that changes the structure or rules of one Supabase database.
For example, it might add a column, install a security policy or replace a protected payment
procedure.

```text
Migration file in Git --someone intentionally runs it--> one Supabase database
```

Uploading the website does not run migrations. Adding a migration to Git does not install it
anywhere. Each client database can therefore be at a different stage.

## The only decision to make first

Before choosing a file, place the target database in one of these groups:

| Database situation | What to do |
|---|---|
| Brand-new, empty Supabase project | Use the fresh-client sequence below |
| Existing database known to have secured roles/RLS | Inventory it, then apply only missing targeted updates |
| Existing database with unknown history | Do not run anything; inventory it first |

If there are already real guests, reservations or staff accounts, it is not a fresh empty
database.

## Fresh empty client: the approved order

This is only for a new, isolated database with no live client data. Keep the site unavailable
until security setup and testing are complete.

1. `ALL_IN_ONE.sql` — creates the historical/base application schema. Run once.
2. `20260911_roles_prepare.sql` — prepares staff Auth links and roles.
3. Run `scripts/migrate-staff-auth.mjs` from a trusted machine to create/link initial Auth
   users. Confirm there is an approved active Admin.
4. `20260911_roles_enforce.sql` — installs the secured RLS/role boundary. Run once.
5. `20260912_roles_save_paths.sql`
6. `20260912_roles_invoice_amount.sql`
7. `20260912_roles_voucher_defaults.sql`
8. `20260912_staff_deposit_waiver.sql`
9. `20260913_deposit_policy.sql`
10. `20260916_finance_role.sql`
11. `20260917_session_notifications.sql`
12. `20260918_spending_deposit_choice.sql`
13. `20260919_financial_tracking.sql`
14. `20260920_reservation_arrival.sql`
15. Deploy the current `staff-account` Edge Function.
16. Build/deploy the current frontend and test every role and public guest flow.

Stop immediately if any step reports an error. Do not continue with a half-installed setup.

## Why several dated files are not in that list

These older standalone feature migrations are retained as history, but their changes are
already consolidated into `ALL_IN_ONE.sql` for a fresh client:

- `20260908_area_time_blocks.sql`
- `20260909_timed_table_capacity.sql`
- `20260910_reservation_deposit_flow.sql`
- `20260911_reservation_update_payment.sql`
- `20260912_invoice_requested_deposit.sql`
- `20260913_table_picker_availability.sql`
- `20260914_multiple_active_campaigns.sql`
- `20260915_reservation_tickets.sql`

Do not run these again after `ALL_IN_ONE.sql`. Do not replay them casually on a secured
database: an older function definition may overwrite a later protected wrapper.

They remain useful for understanding history and possibly diagnosing an unusual legacy
client. “Not part of the fresh sequence” does not mean “safe to delete.”

## Existing client: there is no universal next file

For an existing client, the correct next migration depends on what that specific Supabase
project already has. Filename dates, the Git branch and the deployed website do not prove
database state.

The safe process is:

1. Confirm the exact client and Supabase project.
2. Take or confirm an appropriate backup/recovery point.
3. Produce a private schema inventory using `scripts/schema-dump.sql`.
4. Compare the inventory with repository expectations using
   `npm run schema-check -- catalog.json`.
5. Inspect the actual definitions of important functions, RLS policies and grants. The
   schema checker confirms object existence, not whether permissions/definitions are correct.
6. Build a written list of migrations positively confirmed as installed.
7. Rehearse only the missing required updates against representative data.
8. Apply the missing updates in dependency order and stop on the first error.
9. Test as anonymous, Staff, Finance, Manager, Admin and Owner before deploying matching
   frontend/function code.

The normal targeted dependency order after secured roles is:

```text
roles_save_paths
  -> roles_invoice_amount
  -> roles_voucher_defaults
  -> staff_deposit_waiver
  -> deposit_policy
  -> finance_role
  -> session_notifications
  -> spending_deposit_choice
  -> financial_tracking
  -> reservation_arrival
```

Apply only the missing entries. Never fill a gap by starting again from `ALL_IN_ONE.sql`.

`20260920_reservation_arrival.sql` performs a duplicate-arrival preflight. If it refuses to
run, investigate the actual duplicates. The incident-specific
`scripts/repair_duplicate_reservation_visit.sql` contains reviewed IDs for one known case and
must not be reused blindly on another database.

## Which files are safe to delete?

The safe answer today is: **none of them**.

Keeping a migration file does not cause it to run. The danger comes from running the wrong
file, not from leaving it in the repository.

We could reorganize historical files into clearer folders in a separate maintenance change,
but that should preserve Git history, tests, documentation links and deployment instructions.
It would be an organizational improvement, not a database operation.

## What record we are missing

Each client needs a private migration ledger like this:

| Client | Supabase project | Confirmed baseline | Last confirmed targeted migration | Edge Function version checked | Checked on/by |
|---|---|---|---|---|---|
| Example | project reference | secured roles | `20260920_reservation_arrival.sql` | current | date/name |

Do not put secret keys or private schema dumps in this table. Once this ledger exists, future
updates become “apply the next reviewed migration” instead of archaeology.

For the authoritative technical details and warnings, continue to
[`migrations/README.md`](../migrations/README.md). This page is the non-technical map; the
migration README remains the operational source of truth.
