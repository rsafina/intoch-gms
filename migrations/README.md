# Migrations

**One file: `ALL_IN_ONE.sql`.** Paste it into the Supabase SQL Editor and run it.

That is the whole procedure, for a brand new client and for an existing one.

## Reservation update errors (September 2026)

If saving a reservation reports a missing `block_buffer_minutes` column, run the
current **ALL_IN_ONE.sql** in Supabase SQL Editor before deploying/reloading the app.
Pushing the website does not execute database migrations. The full file includes
area buffers, timed capacity, simplified deposits, and Waitlist payment promotion.
Running only the latest incremental file does not install its prerequisites.

The payment repair also promotes existing waitlisted bookings whose recorded
payments cover the agreed deposit. Capacity checks still apply: SQL warnings list
bookings that need staff to resolve a table/time conflict. Partial deposits stay
waitlisted; no payment is invented or recorded by the repair.

## Why a single file

It is **idempotent**. Every `CREATE` is `IF NOT EXISTS`, every trigger and policy
drops itself first, every seed insert is guarded, and functions that change shape
are dropped before being redefined. So running it against a database that is
empty, half-built, or fully up to date all do the right thing.

That removes the usual "which migrations has this client had?" bookkeeping
entirely. There is nothing to track: you always run the same file.

## The one rule that keeps this working

**Anything you add to this file must be safe to run twice.**

- new table -> `create table if not exists`
- new column -> `alter table ... add column if not exists`
- new index -> `create index if not exists`
- new trigger or policy -> `drop ... if exists` immediately before creating it
- redefining a function with a different return type or arguments -> drop it first
- seed data -> `on conflict do nothing`, or `where not exists (...)`

Break that rule once and the file stops being re-runnable, which is the property
the whole approach depends on.

## Why the individual migration files are gone

They were deleted on 2026-08-23. Nothing was lost: `ALL_IN_ONE.sql` contains every
one of them verbatim, in dependency order, each under a `-- ## filename` header.
Git holds the originals if they are ever wanted.

They were deleted because they had stopped being trustworthy as a history. Building
a database from them for the first time on 2026-08-22 surfaced five separate
defects:

1. **Seven files were not in the repo at all.** The membership and WhatsApp tables
   lived in a folder outside it, so a database built from the repo alone was missing
   `members`, `wa_templates` and `wa_outreach_log`.
2. **Filename order was not dependency order.** A seed file sorted before the file
   that created the table it seeds.
3. **The `admin` role was in no migration**, though the code requires it. It had been
   added by hand in production.
4. **Nothing was re-runnable.** Plain `CREATE TABLE`, plain `CREATE TRIGGER`, and
   functions redefined with changing return types.
5. **14 columns, 2 views and 5 functions existed in production and in no file at all**,
   found by diffing against the live database.

A history that cannot rebuild the thing it claims to describe is not a history.

## Proving it before a client sees it

Reading this file cannot tell you whether it is complete. Building a database
from it and asking the application what it expects can.

Two steps, neither of which needs Postgres installed locally:

1. Run `ALL_IN_ONE.sql` on the empty Supabase project, exactly as client
   setup does.
2. Run `scripts/schema-dump.sql` in the same SQL editor, save the JSON it
   returns to a file, and run `npm run schema-check -- catalog.json`.

It compares every table, column, RPC argument and storage bucket the app code
references against what actually got built, and exits non-zero on any that is
missing. `scripts/schema-refs.js` documents what it does and does not cover:
it proves an object EXISTS, never that its type, nullability, default or
foreign key is right, and RLS and grants are out of scope entirely.

### Round 6, 2026-08-30

The first run of that check found two more of the same class, both of which
would have shipped:

6. **`wa_campaigns.slug` existed in no migration.** Broadcast > Campaigns was
   not degraded, it was unusable: `ceUniqueSlug()` selects on `slug` before
   every save and `saveCampaign()` writes it, so no campaign could be created
   at all on a new client. Its unique index was missing too, and the code
   depends on that index rather than merely benefiting from it.
7. **The `promo-images` storage bucket existed in no migration.** Promo image
   uploads 404, and because the public URL is built by hand in
   `cePromoImageUrl()`, every campaign's WhatsApp share card would have
   resolved to nothing.

Both are now in this file, and the file has been rebuilt from empty twice to
confirm it still runs clean and is still re-runnable.

Campaign concurrency now allows **10 active campaigns**, with unlimited drafts.
Run `20260914_multiple_active_campaigns.sql` (or the current `ALL_IN_ONE.sql`)
before using the updated editor. It removes the old one-open-campaign index
and enforces ten database slots. Starting/reopening never closes another
campaign. Sends remain attributed to their selected campaign; guests can
receive messages from multiple campaigns, with no cross-campaign cooldown.

### Round 7, 2026-08-30: an empty database is not a test

Round 6 was verified by building from empty, twice. That missed a defect that
only exists on a database with rows in it, and Rere hit it re-running the file
against her seeded Intoch database:

8. **`recalculate_guest_spending_tier` was defined 1,700 lines after the last
   redefinition of `calculate_guest_spending_tier`.** In between sits the
   `booking_name` backfill, an `update public.reservations`, which fires the
   reservations tier trigger, which calls the still-old text-expecting version
   of a function whose partner now returns `TABLE(tier, qualified_at)`. The
   row gets stringified to `(medium_spender,)` and fails
   `guests_spending_tier_check`. The whole run aborts.

   **On an empty database the backfill matches nothing, the trigger never
   fires, and the file runs clean.** That is the entire reason it survived.

   Fixed by moving the corrected definition to sit immediately beneath the
   last `calculate_guest_spending_tier`. Both functions now carry a comment
   saying they must move together.

**So: an empty-database run proves the file is syntactically sound and
re-runnable. It does NOT prove the file is safe on a client's database.**
Anything guarded by a `WHERE` that matches no rows on an empty database is
untested until you put rows there. Backfills and data repairs are exactly that
shape, and this file is full of them.

Rehearse a change like this on a database with at least: a guest, a visit
carrying real spend, and an Online Form reservation with a NULL
`booking_name`. That fixture alone reproduces this defect in seconds.

## Applying to a database with real data in it

Rehearse first. Wrap the whole thing in a single `DO $$` block with
`GET DIAGNOSTICS ROW_COUNT` assertions per statement, run it once ending in
`RAISE EXCEPTION 'DRY RUN OK'` so it rolls back, then re-run without the RAISE.

## When a migration history and a running database disagree

The running database is right. Read it with `pg_get_functiondef`,
`pg_get_viewdef`, `pg_indexes` and `information_schema.columns`, and correct the
file. That is how defect 5 above was found.

## Invoice deposit amounts

The current full migration derives each invoice request from its DP/settlement
checkboxes and synchronizes deposit invoices to the booking's deposit requirement.
A Rp 5.000.000 bill requesting Rp 2.500.000 DP confirms the booking when recorded
deposit payments reach Rp 2.500.000. It also corrects existing issued documents
and already-recorded payments; it does not create any payment records. Review SQL
warnings for legacy invoices that could not be repaired because of capacity or
invalid amounts. Separate settlement invoices do not rewrite the deposit.

## Table picker availability

Run the current ALL_IN_ONE.sql before deploying the staff table picker update.
It installs reservation_table_availability, which returns occupied table IDs for
the chosen date, hours, duration and preparation buffer. Existing reservations
are excluded from their own checks; waitlisted bookings do not hold tables.
The UI disables conflicting tables and prevents saving while availability is
loading or failed. Database capacity and overlap checks remain the final guard.
