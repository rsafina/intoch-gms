# Database bootstrap and migration safety

This is the canonical sequence for the current repository (audit 2026-09-14).
No SQL is run by reading this document or by deploying frontend files.

> If migration terminology or the number of files is unfamiliar, first read
> [Intoch database migrations, explained simply](../docs/MIGRATIONS_EXPLAINED_SIMPLY.md).
> The short version: do not delete anything, do not run files by filename order, and inventory
> an existing database before applying any SQL.

## Never apply filename order blindly

Latest arrival fix: on the affected project only, review/run
`scripts/repair_duplicate_reservation_visit.sql` before `20260920_reservation_arrival.sql`.
The repair targets a specific reviewed pair, keeps both rows for audit, and refuses changed
financial/membership/booking details. Other projects must review their own duplicates;
never reuse the incident's IDs. Run the arrival migration before the matching frontend.
No Edge Function redeploy is required for this fix. The migration is additive and does not
replace the Financial Tracking or spending RPCs. Never bypass its duplicate preflight.

`ALL_IN_ONE.sql` consolidates historical schema, including capacity, requested invoice
amounts, table availability, ten campaigns and tickets. It contains repeated definitions;
the last one wins. It is **not** the full secured setup. Its guard rejects a database with
Phase 1 role helpers/audit. `20260911_roles_enforce.sql` also refuses a second application.

**Existing secured project: never rerun either file or bypass either guard.** Older standalone
feature SQL may redefine unwrapped public functions or restore grants; do not replay it onto
Phase 1 based only on its date. Inspect private implementations and wrapper preservation.

## Fresh client (empty, isolated project only)

Keep the client unavailable until security and smoke checks are complete. Confirm the target,
backup policy and an approved initial active Admin before touching data. Follow these steps:

1. Run `ALL_IN_ONE.sql` once on the fresh database. It is only the legacy/base stage.
2. Run `20260911_roles_prepare.sql` (Auth links/Owner role).
3. Link all initial staff accounts with `scripts/migrate-staff-auth.mjs` from a trusted
   terminal using server-only `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. The script preserves
   IDs and existing initial login credentials, resumes linked rows, and uses Auth's API.
   Initial provisioning is privileged setup, not permission to retain plaintext PINs in the
   finished system or in repo files. Do not expose the legacy stage publicly.
4. Run `20260911_roles_enforce.sql` ONCE. It requires linked accounts and an active Admin,
   clears/restricts legacy PIN storage, installs RLS/guards and wraps permitted RPCs.
5. Run `20260912_roles_save_paths.sql`.
6. Run `20260912_roles_invoice_amount.sql`.
7. Run `20260912_roles_voucher_defaults.sql`.
8. Run `20260912_staff_deposit_waiver.sql`.
9. Run `20260913_deposit_policy.sql`.
10. Run `20260916_finance_role.sql`.
11. Run `20260917_session_notifications.sql`.
12. Run `20260918_spending_deposit_choice.sql`.
13. Run `20260919_financial_tracking.sql`.
    Also run `20260920_reservation_arrival.sql` before deploying the current frontend.
14. Deploy the **current** `staff-account` Edge Function; current source requires the
    session-validity RPC from step 11. Configure server environment and disable public
    Auth signup/email password recovery for internal staff identities.
15. Build/deploy current frontend, then verify roles and guest flows before opening access.

The ALL_IN_ONE header documents the SQL/account-link sequence; the current function cannot
be used before its later session RPC exists. Its old ?alongside Phase 1? wording is historical
coordination, not permission to use current frontend/function with only the base schema.
Stop on any error (`psql -v ON_ERROR_STOP=1` when using psql). Never continue half-applied setup.

## Existing client with Phase 1 installed

Verify its actual schema/function definitions and applied history first. Do not infer this
from branch name or a commit. There is no fleet migration ledger in this repo.

| Requirement | Targeted update |
|---|---|
| Reservation/table normalization and spending-tier save helpers | `20260912_roles_save_paths.sql` |
| Invoice document amount helper permissions | `20260912_roles_invoice_amount.sql` |
| Voucher default trigger permissions | `20260912_roles_voucher_defaults.sql` |
| Per-account Staff waiver | `20260912_staff_deposit_waiver.sql` |
| Area/pax rules and selectable invoice format | `20260913_deposit_policy.sql` |
| Finance role | `20260916_finance_role.sql` after waiver; redeploy function/frontend |
| Session validity/PIN reset/checklist | `20260917_session_notifications.sql` after Finance |
| Explicit deposit-inclusive spending | `20260918_spending_deposit_choice.sql` |
| Independent deposit/spending toggles and skipped spending | `20260919_financial_tracking.sql` after spending deposit choice |

Apply only missing required updates in the dependency order above, with rehearsals/backups
appropriate to the change. Then deploy the matching function/frontend. Later session helpers
supersede earlier role helpers: do not rerun an older helper migration over newer ones.
For the latest update, use [SESSION_SPENDING_ROLLOUT](../docs/SESSION_SPENDING_ROLLOUT.md).
An unusual legacy project needs a reviewed upgrade plan, not a blind table of filenames.

## Why these safeguards exist

- Blanket public-function EXECUTE revocation in Phase 1 broke hidden trigger/default calls.
  Fixes used narrow grants for pure calculations and pinned SECURITY DEFINER trigger paths
  for privileged helpers. Never grant every helper to authenticated to make saves pass.
- `normalize_table_assignment()` took a row lock requiring visibility ordinary staff lacked;
  this produced misleading ?selected tables no longer exist? errors. Tier/default invoice/
  voucher helpers also caused save failures. The role follow-ups address those paths.
- `calculate_guest_spending_tier` changed its return shape while a stale
  `recalculate_guest_spending_tier` caller survived elsewhere in the consolidated file.
  A backfill triggered the mismatch only on populated data. Keep final definitions adjacent,
  inspect all callers and exercise real writes. Do not loosen a CHECK to accept corrupt data.
- A successful empty-schema run proves neither backfill correctness nor role safety. Test
  representative guest, visit, booking, payments and member data as real app roles.
- Waiver/Finance migrations patch function definitions using text replacement. Unexpected
  definition errors are stop signals; casual formatting can break downstream patches.

## Verification

Use relevant PGlite suites: role-enforcement, role-save-paths, role-membership-reports,
finance-role, deposit-policy-sql and session-spending-sql. Known harness limitations are
in [CURRENT_STATE](../docs/CURRENT_STATE.md). Local tests do not prove live Auth/Storage.

For an authorized schema inventory, `scripts/schema-dump.sql` produces a catalog JSON;
`npm run schema-check -- catalog.json` compares referenced objects to it. It checks existence,
not complete types/semantics or RLS/grants. Keep any live inventory private and out of static
assets. Do not follow old docs suggesting an env-only schema-check proves the whole database.

Demo wipes/seeds are not migrations. See [demo/README](../demo/README.md); never use them to
upgrade a client or as part of routine deployment.
