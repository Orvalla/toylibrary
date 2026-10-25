-- 0053 — Held-sets wave (2026-10-25): three new board-game
-- platforms (stonemaier, greaterthangames, aeg) whose catalogs were
-- dropped in earlier rounds for lack of age evidence, plus the
-- age_no_data flag the owner asked for: rows admitted without a
-- maker-stated age carry age_no_data = true (ages stay NULL) so a
-- later pass can find exactly those rows and iron the ages out.
-- Platform CHECKs widened exactly as 0021/0022/0023/0027/0028/
-- 0030/0033/0051/0052 did.

alter table public.catalog_items drop constraint if exists catalog_items_platform_check;
alter table public.catalog_items add constraint catalog_items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery',
    'melissaanddoug', 'littlepeople', 'brio', 'fatbrain',
    'lakeshore', 'learningresources', 'littletikes',
    'thamesandkosmos', 'thinkfun', 'ravensburger', 'kiwico',
    'eeboo', 'mudpuppy', 'sphero',
    'asmodee', 'pandasaurus', 'renegade', 'floodgate', 'catan',
    'blueorange', 'iello', 'capstone',
    'explodingkittens', 'hachette', 'goliath', 'relatable',
    'plantoys', 'hape', 'janod', 'letoyvan', 'tenderleaf',
    'greentoys', 'manhattantoy', 'tegu', 'guidecraft', 'unclegoose',
    'buffalogames', 'spinmaster', 'devir', 'crayola', 'djeco',
    'stonemaier', 'greaterthangames', 'aeg'
  ));

alter table public.items drop constraint if exists items_platform_check;
alter table public.items add constraint items_platform_check
  check (platform in (
    'tonies', 'yoto', 'leapfrog', 'projector', 'vtech', 'books',
    'other', 'storypod', 'osmo', 'lunii',
    'haba', 'magnatiles', 'smartgames', 'lovevery',
    'melissaanddoug', 'littlepeople', 'brio', 'fatbrain',
    'lakeshore', 'learningresources', 'littletikes',
    'thamesandkosmos', 'thinkfun', 'ravensburger', 'kiwico',
    'eeboo', 'mudpuppy', 'sphero',
    'asmodee', 'pandasaurus', 'renegade', 'floodgate', 'catan',
    'blueorange', 'iello', 'capstone',
    'explodingkittens', 'hachette', 'goliath', 'relatable',
    'plantoys', 'hape', 'janod', 'letoyvan', 'tenderleaf',
    'greentoys', 'manhattantoy', 'tegu', 'guidecraft', 'unclegoose',
    'buffalogames', 'spinmaster', 'devir', 'crayola', 'djeco',
    'stonemaier', 'greaterthangames', 'aeg'
  ));

alter table public.catalog_items
  add column if not exists age_no_data boolean not null default false;

notify pgrst, 'reload schema';
