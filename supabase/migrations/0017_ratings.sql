-- Ratings for catalog items, pulled from the sources the
-- catalog itself came from: Open Library work ratings for
-- books, and the aggregateRating JSON-LD the product stores
-- embed on their own product pages (backfilled by
-- ingestor/backfill-ratings-books.mjs and
-- ingestor/backfill-ratings-stores.mjs).
--
-- Both columns are nullable on purpose: a missing rating means
-- "the source doesn't publish one we could verify", and tiles
-- render nothing rather than a guessed number.
alter table public.catalog_items
  add column if not exists rating numeric(2,1),
  add column if not exists rating_count integer;
