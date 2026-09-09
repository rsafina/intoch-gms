# Demo reset and seeds

For a fresh demo, run these whole files in Supabase SQL Editor in this order:

1. `migrations/ALL_IN_ONE.sql` (current database functions and columns).
2. `demo/00_wipe_except_staff.sql` (enable its explicit reset line first).
3. `demo/00_seed_areas_tables.sql` (optional floor-plan balancing).
4. `demo/01_seed_3_months.sql` (guest history and upcoming payment/request examples).

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
