-- Store logos for catalog items (owner request 2026-10-23):
-- platforms carry real brand logos in the app, and an item
-- whose platform has none — above all items parents added
-- themselves from a store the catalog doesn't carry — shows
-- that store's favicon instead. ingest-catalog stamps the
-- favicon URL (of the source link's host) into logo_url on
-- every user-grown row; tiles fall back to deriving it from
-- product_url, so bulk-ingested rows need no stamp. Copied
-- onto items at add-to-list time like product_url/asin.

alter table public.catalog_items add column if not exists logo_url text;
alter table public.items add column if not exists logo_url text;
