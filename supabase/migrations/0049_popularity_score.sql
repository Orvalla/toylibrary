-- 0049: a unified popularity score per catalog item.
--
-- "Popular" used to mean raw sort_order, which is only a
-- within-brand listing position — across brands the numbers
-- are an ingestion sequence, so the sort was arbitrary
-- across the catalog. The score replaces it (owner design,
-- 2026-10-24): one number per item blending
--   * on-site behavior — how many families have / wish /
--     have had the item claimed (from the items table),
--   * manufacturer/store review scores (rating + count,
--     Bayesian-smoothed so a 5.0 from 2 reviews can't beat
--     a 4.8 from 2,000),
--   * rankings & lists — NYT bestseller weeks-on-list for
--     books today; more list sources slot into the same
--     component as they land (BGG when approved),
--   * the maker's own list order as the BASE every item
--     gets — the fallback ranking when an item has no
--     other data, which today is most of the catalog.
-- ingestor/popularity.mjs computes it (weekly, after the
-- ingest, and on demand); the client sorts Popular by it
-- and derives the same base itself for rows the scorer
-- hasn't reached yet. Components and weights live in that
-- script's header; this migration only stores the result.

alter table public.catalog_items
  add column popularity_score numeric;

comment on column public.catalog_items.popularity_score is
  'Unified popularity ranking score (ingestor/popularity.mjs); higher is more popular. NULL = not yet scored; clients fall back to the within-brand list-order base.';

-- Bulk writer for the scoring job: one call takes the whole
-- computed set ([{id, score}, ...]) and applies it in a
-- single statement. Service-role only — the job runs with
-- that key; no one else can execute it.
create function public.set_popularity_scores(p_scores jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.catalog_items c
     set popularity_score = s.score
    from jsonb_to_recordset(p_scores) as s(id uuid, score numeric)
   where c.id = s.id;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke all on function public.set_popularity_scores(jsonb) from public, anon, authenticated;
grant execute on function public.set_popularity_scores(jsonb) to service_role;
