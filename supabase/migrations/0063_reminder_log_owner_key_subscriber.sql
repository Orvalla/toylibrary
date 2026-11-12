-- Reminder log: stop subscriber rows colliding with the owner
-- dedupe index (audit 2026-11-10, finding C-1).
--
-- 0020 made occasion_reminder_log_owner_key unique on
-- (occasion_id, occurrence_date) WHERE relative_id IS NULL, back
-- when "no relative" meant "owner digest". 0034 then added
-- subscriber rows, which ALSO have relative_id NULL (they carry
-- subscriber_id instead) — so a subscriber's log row for an
-- occasion and the owner's row for the same occurrence could not
-- coexist. The subscriber insert failed after the email had
-- already gone out, and the unchecked failure meant the same
-- subscriber was mailed again on every later run.
--
-- The owner stream is exactly the rows with NEITHER relative_id
-- NOR subscriber_id. Narrow the predicate to say so. Same index
-- name; occasion_reminder_log_relative_key (0020) and
-- occasion_reminder_log_subscriber_key (0034) are untouched.
--
-- Safe on a live database: the new predicate selects a SUBSET of
-- the rows the old one did, so rebuilding can never find a new
-- duplicate; the log is also empty until the first real send.

drop index if exists public.occasion_reminder_log_owner_key;

create unique index occasion_reminder_log_owner_key
  on public.occasion_reminder_log (occasion_id, occurrence_date)
  where relative_id is null and subscriber_id is null;
