-- 0056 — Electronics assembly kits round 2 (2026-10-26, owner-directed
-- "find me more makers" / "get everything workable"): 29 new platforms
-- from the maker survey — piper, wonderworkshop, elegoo, eblox,
-- chibitronics, circuitscribe, circuitcubes, squishycircuits, engino,
-- birdbrain, robolink, sunfounder, browndoggadgets, powerup, pimoroni,
-- picobricks, inventr, circuitmess, robotis, fischertechnik, adafruit,
-- dfrobot, kitronik, seeed, elecrow, cubelets, twinscience, robotical,
-- tinkeringlabs. Platform CHECKs widened exactly as 0055 did.
-- NOTE: this takes number 0056; the Claude-review security patch's
-- migration (0055_security_lockdown.sql in the patch) renumbers to
-- 0057 when that patch is applied.

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
    'tinkeringlabs'
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
    'tinkeringlabs'
  ));

notify pgrst, 'reload schema';
