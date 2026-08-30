# Migrations

**One file: `ALL_IN_ONE.sql`.** Paste it into the Supabase SQL Editor and run it.

That is the whole procedure, for a brand new client and for an existing one.

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

Note for whoever hits it next: `idx_one_open_campaign` allows only ONE
campaign with `ended_at IS NULL`. That is deliberate, and it will look like a
slug bug the first time it stops an insert.

## Applying to a database with real data in it

Rehearse first. Wrap the whole thing in a single `DO $$` block with
`GET DIAGNOSTICS ROW_COUNT` assertions per statement, run it once ending in
`RAISE EXCEPTION 'DRY RUN OK'` so it rolls back, then re-run without the RAISE.

## When a migration history and a running database disagree

The running database is right. Read it with `pg_get_functiondef`,
`pg_get_viewdef`, `pg_indexes` and `information_schema.columns`, and correct the
file. That is how defect 5 above was found.
