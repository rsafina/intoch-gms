-- ============================================================
-- BLUE HERON — SEED FEATURED DISHES
-- Run AFTER 20260721_settings_feature.sql (needs the table).
--
-- Inserts the two dishes currently hardcoded on reserve.html so
-- managers can edit/hide them from Settings > Reservation
-- Configuration. Once these rows exist, the public page renders
-- from the database and the static fallback is no longer used.
--
-- image_url is a relative path into the deployed site's assets/
-- folder (works on your-site.example for both reserve.html
-- and the staff app, which live at the same root). Replacing a
-- photo from Settings uploads to the dish-images bucket instead.
--
-- Idempotent: skips any dish whose name already exists.
-- ============================================================

insert into featured_dishes (name, description, image_url, category, display_order, is_active)
select * from (values
  (
    'Sirloin Wagyu MB5',
    'Grilled sirloin wagyu marbling 5, disajikan dengan garlic confit, sauteed mushroom, pilihan kentang pendamping, sayuran dan saus.',
    'assets/sirloin-wagyu-web.jpg',
    'signature',
    1,
    true
  ),
  (
    'Butter Salmon',
    'Grilled Norwegian Salmon yang dimasak dengan bawang merah, bawang putih, cabai pilihan, smoked beef dan butter.',
    'assets/butter-salmon-web.jpg',
    'chef_recommendation',
    1,
    true
  )
) as seed(name, description, image_url, category, display_order, is_active)
where not exists (
  select 1 from featured_dishes fd where fd.name = seed.name
);
