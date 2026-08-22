-- ============================================================
-- BROADCAST CAMPAIGNS + EFFECTIVENESS REPORTING
-- 2026-08-01. Additive only: 2 new tables, 2 nullable columns.
-- No existing row is rewritten, no function/trigger touched.
-- Safe to run during opening hours.
-- ============================================================
--
-- WHY THIS EXISTS
-- ---------------
-- wa_outreach_log already records every WA click (guest_id,
-- template_key, is_broadcast, sent_at, sent_by). What it does NOT
-- record is WHAT was sent and WHICH BLAST it belonged to.
--
-- Templates are edited in place. If ops edits `medium_spender` to
-- offer a burger in August and a steak in September, both blasts
-- land in the log as "medium_spender" and are indistinguishable
-- forever. Marketing's actual question — "did the burger blast
-- work better than the steak blast?" — is unanswerable.
--
-- So: a campaign is created BEFORE sending, freezing the message
-- text and the eligible audience. Each send then points at it.
--
-- The audience snapshot is the part that makes the report honest.
-- Without it we could only say "48% of messaged guests came back",
-- which sounds great until you notice high spenders come back at
-- 40% anyway. With it we can say "48% of the ones we messaged vs
-- 16% of the identical guests we did not" — the same segment, the
-- same fortnight, the only difference being the message.
-- ============================================================

begin;

-- ── 1. Campaigns ─────────────────────────────────────────────
create table if not exists wa_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  -- What ops was actually promoting, in their own words
  -- ("Promo burger beli 1 gratis 1"). Free text on purpose: the
  -- report is read by humans, not joined on.
  note          text,
  -- Snapshot of the filter that produced the audience
  segment       text        not null,
  segment_tag   text,
  template_key  text        not null,
  -- FROZEN copy of the template body at campaign start. The
  -- wa_templates row may be edited tomorrow; this must not change.
  message_body  text        not null,
  started_at    timestamptz not null default now(),
  -- null = still sending. Set when ops finishes, or automatically
  -- when the next campaign starts (only one open at a time).
  ended_at      timestamptz,
  created_by    text
);

-- ── 2. Audience snapshot (the control group) ─────────────────
-- Every guest who MATCHED the filter at campaign start, whether or
-- not they ended up being messaged. Rows never sent become the
-- comparison group in the report.
--
-- has_wa is stored rather than derived later: a guest whose phone
-- number gets fixed next week was still unreachable during the
-- campaign, and the comparison must be between guests who were
-- equally reachable at the time.
create table if not exists wa_campaign_audience (
  campaign_id uuid    not null references wa_campaigns(id) on delete cascade,
  guest_id    uuid    not null references guests(id)       on delete cascade,
  has_wa      boolean not null default false,
  primary key (campaign_id, guest_id)
);

-- ── 3. Link the existing log to campaigns ────────────────────
-- Nullable by design. Transactional sends (thank_you, follow_up,
-- voucher_ready) have no campaign and never will. Ad-hoc broadcasts
-- sent without starting a campaign also stay null — they simply do
-- not appear in the effectiveness report, which is correct: we
-- cannot measure what we did not define.
alter table wa_outreach_log
  add column if not exists campaign_id uuid references wa_campaigns(id) on delete set null;

-- The exact text this guest received, after placeholder rendering.
-- Belt-and-braces next to wa_campaigns.message_body: it survives
-- even for campaign-less sends, and proves what a specific guest
-- was told if they ever ask.
alter table wa_outreach_log
  add column if not exists message_body text;

-- ── 4. Indexes ───────────────────────────────────────────────
create index if not exists idx_outreach_campaign  on wa_outreach_log (campaign_id);
create index if not exists idx_outreach_guest_sent on wa_outreach_log (guest_id, sent_at desc);
create index if not exists idx_campaigns_started   on wa_campaigns (started_at desc);
create index if not exists idx_campaign_audience_guest on wa_campaign_audience (guest_id);

-- ── 5. One open campaign at a time ───────────────────────────
-- Enforced in the DB, not just the UI: two open campaigns would
-- make "which campaign does this send belong to?" ambiguous, and
-- the app resolves that client-side.
create unique index if not exists idx_one_open_campaign
  on wa_campaigns ((ended_at is null)) where ended_at is null;

commit;
