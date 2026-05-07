-- Phase V: real-time Live Team widget.
--
-- The sidebar's `LiveTeamWidget` opens a postgres_changes channel filtered
-- on `member_presence` (status flips) and `brand_members` (invite/remove)
-- so its dots can update without a page refresh. Those channels only fire
-- if the underlying tables are members of the `supabase_realtime`
-- publication. They were not, so the widget was effectively poll-only —
-- it sat on stale data until its 60s safety resync ran, which is why
-- "I'm online but the widget says offline" persisted until the next
-- minute boundary.
--
-- Adding the two tables here. Idempotent: every other migration that
-- touches the publication uses the same `add table` pattern with no
-- "if not exists" guard (Postgres rejects duplicates with a clear
-- error, which we want to surface in CI rather than swallow).

alter publication supabase_realtime add table member_presence;
alter publication supabase_realtime add table brand_members;
