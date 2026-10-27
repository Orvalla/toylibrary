-- 0059 — Shelves round (2026-10-27, owner-directed "flesh out
-- those two shelves"): 17 new platforms fleshing out the STEAM
-- and Arts & Crafts sections — ugears, plusplus, geomag,
-- zometool, knex, keva, arckit, robotime, metalearth (STEAM
-- building/engineering + mechanical models), ooly, fabercastell,
-- brightstripes, thepencilgrip, petitcollage, annwilliams,
-- pipsticks, rainbowloom (pure art/craft). Platform CHECKs
-- widened exactly as 0055/0056 did.
-- Also: maker base pricing (owner-directed same day — "get base
-- pricing on everything from the manufacturer so we're easily
-- able to spot good deals"). base_price_usd is the maker's own
-- listed USD price captured from their store/feed, with the date
-- it was checked. It is a deal-spotting reference anchor, never
-- a live price promise; null where the maker publishes no USD
-- price (e.g. EUR boutiques, showcase sites).

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
    'arduino', 'makeblock', 'ozobot', 'elenco', 'sparkfun',
    'piper', 'wonderworkshop', 'elegoo', 'eblox', 'chibitronics',
    'circuitscribe', 'circuitcubes', 'squishycircuits', 'engino',
    'birdbrain', 'robolink', 'sunfounder', 'browndoggadgets',
    'powerup', 'pimoroni', 'picobricks', 'inventr', 'circuitmess',
    'robotis', 'fischertechnik', 'adafruit', 'dfrobot', 'kitronik',
    'seeed', 'elecrow', 'cubelets', 'twinscience', 'robotical',
    'tinkeringlabs',
    'ugears', 'plusplus', 'geomag', 'zometool', 'knex', 'keva',
    'arckit', 'robotime', 'metalearth',
    'ooly', 'fabercastell', 'brightstripes', 'thepencilgrip',
    'petitcollage', 'annwilliams', 'pipsticks', 'rainbowloom'
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
    'arduino', 'makeblock', 'ozobot', 'elenco', 'sparkfun',
    'piper', 'wonderworkshop', 'elegoo', 'eblox', 'chibitronics',
    'circuitscribe', 'circuitcubes', 'squishycircuits', 'engino',
    'birdbrain', 'robolink', 'sunfounder', 'browndoggadgets',
    'powerup', 'pimoroni', 'picobricks', 'inventr', 'circuitmess',
    'robotis', 'fischertechnik', 'adafruit', 'dfrobot', 'kitronik',
    'seeed', 'elecrow', 'cubelets', 'twinscience', 'robotical',
    'tinkeringlabs',
    'ugears', 'plusplus', 'geomag', 'zometool', 'knex', 'keva',
    'arckit', 'robotime', 'metalearth',
    'ooly', 'fabercastell', 'brightstripes', 'thepencilgrip',
    'petitcollage', 'annwilliams', 'pipsticks', 'rainbowloom'
  ));

alter table public.catalog_items
  add column if not exists base_price_usd numeric,
  add column if not exists base_price_checked_at date;

comment on column public.catalog_items.base_price_usd is
  'Maker''s own listed USD price from their store/feed (deal-spotting reference anchor, not a live price). Null where the maker publishes no USD price.';
comment on column public.catalog_items.base_price_checked_at is
  'Date base_price_usd was captured from the maker source.';

notify pgrst, 'reload schema';
