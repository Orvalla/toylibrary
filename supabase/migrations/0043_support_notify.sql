-- Support ticket email notifications (owner request
-- 2026-10-24): each filed report is also emailed to
-- support@toylibrary.store by the notify-support Edge
-- Function, with Reply-To set to whoever filed it, so a
-- ticket can be answered from a mail app like any other
-- email. notified_at is the claim flag that guarantees
-- exactly one email per report even if the ping repeats.

alter table public.support_reports
  add column notified_at timestamptz;
