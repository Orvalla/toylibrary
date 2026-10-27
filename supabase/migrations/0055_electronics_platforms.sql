-- 0055 — Electronics assembly kits round (2026-10-26, owner-directed
-- "Get all 6"): five new platforms for the electronic assembly /
-- robotics shelf — arduino, makeblock, ozobot, elenco (Snap
-- Circuits) and sparkfun — alongside the existing sphero expansion.
-- Platform CHECKs widened exactly as 0021/0022/0023/0027/0028/
-- 0030/0033/0051/0052/0053 did.

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
    'stonemaier', 'greaterthangames', 'aeg',
    'arduino', 'makeblock', 'ozobot', 'elenco', 'sparkfun'
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
    'stonemaier', 'greaterthangames', 'aeg',
    'arduino', 'makeblock', 'ozobot', 'elenco', 'sparkfun'
  ));

notify pgrst, 'reload schema';
