-- 0051 — Crayola platform (toddler art round, owner request
-- 2026-10-24): the platform CHECKs on items and catalog_items
-- are widened exactly as 0021/0022/0023/0027/0028/0030/0033 did.

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
    'buffalogames', 'spinmaster', 'devir', 'crayola'
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
    'buffalogames', 'spinmaster', 'devir', 'crayola'
  ));

notify pgrst, 'reload schema';
