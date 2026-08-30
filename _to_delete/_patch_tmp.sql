
-- ============================================================
-- ## 20260830_campaign_slug_and_promo_bucket.sql
-- ============================================================
-- Two more objects that exist in the live Blue Heron database and in no
-- migration. Found on 2026-08-30 by building this file onto an empty
-- Postgres and diffing the result against every table, column, RPC and
-- storage bucket the application code actually references.
--
-- Same root cause as the three defects recorded in migrations/README.md:
-- production was patched by hand, so nothing ever exercised this file.
--
-- What was broken on a database built from this file alone:
--
--   1. `wa_campaigns.slug` did not exist. Broadcast > Campaigns was
--      unusable end to end, not merely degraded. `ceUniqueSlug()` reads
--      `.select("slug").eq("slug", base)` before every save, and
--      `saveCampaign()` writes `slug` in the insert. Both 400.
--      So NO campaign could be created at all on a new client.
--
--   2. The `promo-images` storage bucket did not exist. Uploading a promo
--      image 404s, and because `cePromoImageUrl()` builds
--      /storage/v1/object/public/promo-images/<path> by hand, the WhatsApp
--      share card for every campaign would have resolved to nothing.
--
-- Idempotent, like the rest of this file. Safe to run twice.

-- ---------- 1. wa_campaigns.slug ----------
-- The slug is the only part of this system a paying guest ever sees: it is
-- the tail of the promo link forwarded in a WhatsApp thread. It is generated
-- by ceSlugify() as lowercase a-z, 0-9 and hyphens, capped at 40 characters.

alter table public.wa_campaigns
  add column if not exists slug text;

-- The unique index is not decoration. campaign-editor.js says so in a
-- comment and DEPENDS on it: ceUniqueSlug() asks the database whether a
-- slug is taken and only adds a random suffix when it is. Two racing saves
-- both read "free" and both write. Without the index the second one wins
-- silently and two campaigns share a promo link, which means one campaign's
-- WhatsApp card renders the other campaign's offer. With the index the
-- second insert fails loudly and the operator retries.
--
-- Partial rather than plain, because rows created before this column
-- existed have slug NULL and there can legitimately be many of those.
-- (Postgres already permits duplicate NULLs in a unique index; the WHERE
-- clause makes the intent explicit and keeps the index small.)
--
-- Applied through a guard rather than blind, because a unique index cannot
-- be created over data that already violates it. On the empty database this
-- file is meant to build there is nothing to violate; the guard exists so
-- that if it is ever run against a hand-patched database with duplicates it
-- names them instead of failing with a bare 23505.

do $$
declare
  dupes text;
begin
  select string_agg(slug || ' (x' || n || ')', ', ')
    into dupes
  from (
    select slug, count(*) as n
    from public.wa_campaigns
    where slug is not null
    group by slug
    having count(*) > 1
  ) d;

  if dupes is not null then
    raise exception
      'Cannot create the unique index on wa_campaigns.slug: these slugs are already duplicated: %. Two campaigns sharing a slug share a promo link, so fix the data first (rename the newer campaign), then re-run this file.',
      dupes;
  end if;

  create unique index if not exists wa_campaigns_slug_key
    on public.wa_campaigns (slug)
    where slug is not null;
end $$;

-- ---------- 2. promo-images storage bucket ----------
-- Public, for the same reason as dish-images and branding: the WhatsApp
-- crawler and the guest's phone fetch this image with no auth at all.
--
-- 2 MB ceiling, matching the other two buckets. The uploader re-encodes
-- every file to a 1200x630 JPEG and refuses anything over 600 KB before it
-- ever reaches Storage, so this limit is a backstop against a bug in the
-- client, not a working constraint.
--
-- SVG is deliberately NOT allowed, the same call made for the branding
-- bucket: an SVG is a script-capable document and this bucket is
-- world-writable under the current MVP policy model.
--
-- Yes, world-writable is wrong. It is wrong identically for all three
-- buckets and it gets fixed as part of backlog item 1 (RLS), not here.
-- Making this one bucket stricter than its siblings would leave the same
-- hole open and cost a day of debugging why only promo uploads fail.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promo-images', 'promo-images', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Public read - promo-images" on storage.objects;
create policy "Public read - promo-images" on storage.objects for select
  using (bucket_id = 'promo-images');

drop policy if exists "Public write - promo-images" on storage.objects;
create policy "Public write - promo-images" on storage.objects for insert
  with check (bucket_id = 'promo-images');

drop policy if exists "Public update - promo-images" on storage.objects;
create policy "Public update - promo-images" on storage.objects for update
  using (bucket_id = 'promo-images');

-- Delete matters here, unlike a nice-to-have. Replacing a promo image
-- writes a new timestamped path and then removes the old one; without this
-- policy every replacement leaks a file and the bucket grows forever.
drop policy if exists "Public delete - promo-images" on storage.objects;
create policy "Public delete - promo-images" on storage.objects for delete
  using (bucket_id = 'promo-images');

-- ---------- Confirm ----------
select 'wa_campaigns.slug' as checked, count(*) as found
from information_schema.columns
where table_schema = 'public' and table_name = 'wa_campaigns' and column_name = 'slug'
union all
select 'wa_campaigns_slug_key', count(*)
from pg_indexes
where schemaname = 'public' and indexname = 'wa_campaigns_slug_key'
union all
select 'promo-images bucket', count(*)
from storage.buckets where id = 'promo-images'
union all
select 'promo-images policies', count(*)
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like '%promo-images%';
-- expect: 1, 1, 1, 4
