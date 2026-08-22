-- ============================================================
-- Favorite Menu / Recent Order
-- ============================================================
-- Adds a free-text field on guests to record what a guest typically
-- orders. Captured optionally at Complete Visit time (spend input
-- screen); overwritten each time staff enter a new value there.
-- Displayed on dashboard reservation/walk-in rows only once a guest
-- has more than 1 visit (first visit has no "recent order" yet).
--
-- Safe to run any time: additive column, nullable, no default,
-- no backfill, no trigger changes. Does not touch existing data.
-- ============================================================

ALTER TABLE guests ADD COLUMN IF NOT EXISTS favorite_menu TEXT;

COMMENT ON COLUMN guests.favorite_menu IS
  'Free-text favorite menu / recent order, staff-entered at visit completion. Overwritten on each new entry (most recent wins).';
