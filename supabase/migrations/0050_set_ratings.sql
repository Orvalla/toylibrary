-- 0050: bulk rating writer for the enrichment jobs.
--
-- The ratings backfills (ingestor/backfill-ratings-stores
-- .mjs, backfill-ratings-books.mjs) used to write through
-- per-row SQL statements shelled out to a local helper —
-- fine for supervised local runs, wrong for the background
-- jobs the full enrichment runs as (GitHub Actions). This
-- RPC is the write path there, mirroring
-- set_popularity_scores (0049): one call takes a batch of
-- {id, rating, rating_count, source_url?} and applies it in
-- a single statement. source_url is only overwritten when
-- the batch carries one (the books backfill records the
-- Open Library work link it matched, making the match
-- auditable); a null leaves the stored link alone.
-- Service-role only, like its sibling.

create function public.set_ratings(p_updates jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.catalog_items c
     set rating = u.rating,
         rating_count = u.rating_count,
         source_url = coalesce(u.source_url, c.source_url)
    from jsonb_to_recordset(p_updates) as u(
           id uuid, rating numeric, rating_count int, source_url text)
   where c.id = u.id;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.set_ratings(jsonb) from public, anon, authenticated;
grant execute on function public.set_ratings(jsonb) to service_role;
