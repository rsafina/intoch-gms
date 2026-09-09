# Demo reset and seeds

For a fresh demo, run these whole files in Supabase SQL Editor in this order:

1. `migrations/ALL_IN_ONE.sql` (current database functions and columns).
2. `demo/00_wipe_except_staff.sql` (enable its explicit reset line first).
3. `demo/00_seed_areas_tables.sql` (optional floor-plan balancing).
4. `demo/01_seed_3_months.sql` (past three months of guest, visit and reservation history only).

Today and all future dates (including the next seven days) stay empty so you
can create your own stress-test reservations. The seed keeps 120 guests,
287 past visits, their completed reservations, and 24 memberships for reports.
Skip `03_upcoming_week.sql` when you want this clean calendar; it deliberately
adds today and future bookings. `02_topup_last_5_days.sql` is also optional.

Changing the seed does not remove bookings already in your database.
For a fresh test dataset, use the reset sequence above. Do not rerun the
three-month seed on populated data; its existing empty-database check will stop it.

## Balance the existing floor plan without resetting guests

Run **only `00_seed_areas_tables.sql`** after the current database migrations.
It can be applied to an already-seeded demo. It does not change reservation or
visit assignments, existing table IDs, existing table capacities, or archived flags.
Existing area booking rules and deposit settings are retained. Unlisted areas,
including VIP rooms, are left alone.

For the floor plan in the screenshots:

| Area | Existing table seats | Added seats | Final seats | Final active tables |
| --- | ---: | ---: | ---: | ---: |
| Indoor | 24 | 16 | 40 | 9 |
| Outdoor | 14 | 46 | 60 | 12 |
| Outdoor - Smoking | 20 | 0 | 20 | 5 |

The original T1-T8 and OS1-OS5 rows are reused. Added indoor tables use IN6-IN9
(four seats each). Added outdoor tables use OUT4-OUT12 (six six-seat tables,
two four-seat tables and one two-seat table). Existing names are never reused
for a different table; occupied names are skipped when allocating new names.

A rerun adds no duplicates. For a customized floor plan, the script calculates
the remaining gap from actual active tables rather than blindly adding the
screenshot quantities. It fills the existing area capacity; a zero capacity uses
the screenshot default. If existing table seats already exceed the area limit,
the limit is raised to match rather than reducing or removing tables.
Missing screenshot areas/tables are created. Archived tables stay archived.
Ambiguous duplicate area names or active tables without a valid capacity cause
a rollback with an explanation instead of guessing.

The script returns area totals and the complete resulting table list.
